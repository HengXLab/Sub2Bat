import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { computed, onUnmounted, ref, shallowRef } from "vue";
import { hasAccountPlanTypeFilter, isUnrecognizedPlanType, matchesAccountPlanTypeFilter } from "../lib/accounts";
import { applyBatchEvent, createTestStates, type BatchEvent, type TestRowState } from "../lib/batch";
import { createModelCatalogRequestGuard } from "../lib/modelCatalogRequest";
import { DEFAULT_ACCOUNT_PAGE_SIZE } from "../lib/pagination";
import type {
  Account,
  AccountPage,
  AccountPageRequest,
  BatchCompletionStatus,
  BatchStartResult,
  BatchSummary,
  ModelCatalog,
} from "../types";

const emptySummary = (): BatchSummary => ({ total: 0, succeeded: 0, failed: 0, quotaExhausted: 0, connectionInterrupted: 0, cancelled: 0 });
const emptyAccountPage = (): AccountPage => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: DEFAULT_ACCOUNT_PAGE_SIZE,
  pages: 1,
  truncated: false,
  hasMore: false,
});

const ACCOUNT_COLLECTION_PAGE_SIZE = 200;
const planTypeCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const BATCH_COMPLETION_RECOVERY_POLL_MS = 2_000;
const BATCH_EVENT_IDLE_TIMEOUT_MS = 120_000;
const BATCH_CANCELLATION_GRACE_MS = 30_000;
let nextModelLoadRequestId = 0;

function createModelLoadRequestId() {
  nextModelLoadRequestId += 1;
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `model-catalog-${randomId}`
    : `model-catalog-${Date.now().toString(36)}-${nextModelLoadRequestId.toString(36)}`;
}

type AccountPageWire = Partial<AccountPage> & {
  has_more?: unknown;
  page_size?: unknown;
};

type AccountCollectionRequest = Omit<AccountPageRequest, "page" | "pageSize">;
type AccountCollectionGuard = ReturnType<typeof createModelCatalogRequestGuard>;
type AccountLocalFilterPredicate = (account: Account) => boolean;
type BatchCompletionEvent = Extract<BatchEvent, { kind: "complete" }>;
interface BatchCompletionResult {
  completion: BatchCompletionEvent;
  testStates: Record<number, TestRowState>;
}

interface BatchCompletionWaiter {
  resolve: (completion: BatchCompletionResult | null) => void;
  reject: (error: Error) => void;
}

export interface AccountPlanTypeCatalog {
  planTypes: string[];
  hasUnrecognizedPlanTypes: boolean;
}

interface AccountCollectionMessages {
  invalidMaximum: string;
  pageMismatch: (requestedPage: number, receivedPage: number) => string;
  emptyPageWithMore: string;
  maximumExceeded: (maximum: number) => string;
  duplicateAccount: string;
  pageLimitExceeded: string;
}

const selectionCollectionMessages: AccountCollectionMessages = {
  invalidMaximum: "全选上限无效，无法安全收集筛选结果。",
  pageMismatch: (requestedPage, receivedPage) => `账号列表返回了错误页码（请求第 ${requestedPage} 页，收到第 ${receivedPage} 页），已停止全选。`,
  emptyPageWithMore: "账号列表返回空页但仍声明存在下一页，已停止全选以避免遗漏账号。",
  maximumExceeded: (maximum) => `筛选结果超过 ${maximum.toLocaleString()} 个账号，无法安全一次全选。请进一步缩小筛选范围。`,
  duplicateAccount: "账号列表存在重复账号页，已停止全选以避免遗漏或重复操作。",
  pageLimitExceeded: "筛选结果超过可浏览的页码上限，无法安全一次全选。请进一步缩小筛选范围。",
};

const latestTestCollectionMessages: AccountCollectionMessages = {
  invalidMaximum: "最新测试筛选范围上限无效，无法读取完整账号范围。",
  pageMismatch: (requestedPage, receivedPage) => `账号列表返回了错误页码（请求第 ${requestedPage} 页，收到第 ${receivedPage} 页），已停止最新测试筛选。`,
  emptyPageWithMore: "账号列表返回空页但仍声明存在下一页，已停止最新测试筛选以避免遗漏账号。",
  maximumExceeded: (maximum) => `当前筛选范围超过 ${maximum.toLocaleString()} 个账号，无法完整筛选最新测试结果。请进一步缩小上方筛选范围。`,
  duplicateAccount: "账号列表存在重复账号页，已停止最新测试筛选以避免遗漏或重复账号。",
  pageLimitExceeded: "当前筛选范围超过可浏览的页码上限，无法完整筛选最新测试结果。请进一步缩小上方筛选范围。",
};

const modelScopeCollectionMessages: AccountCollectionMessages = {
  invalidMaximum: "测试模型范围上限无效，无法安全收集账号。",
  pageMismatch: (requestedPage, receivedPage) => `账号列表返回了错误页码（请求第 ${requestedPage} 页，收到第 ${receivedPage} 页），已停止读取测试模型范围。`,
  emptyPageWithMore: "账号列表返回空页但仍声明存在下一页，已停止读取测试模型范围以避免遗漏账号。",
  maximumExceeded: (maximum) => `筛选范围超过 ${maximum.toLocaleString()} 个账号，无法安全读取测试模型。请进一步缩小筛选范围或先选择账号。`,
  duplicateAccount: "账号列表存在重复账号页，已停止读取测试模型范围以避免遗漏或重复操作。",
  pageLimitExceeded: "筛选结果超过可浏览的页码上限，无法安全读取测试模型范围。请进一步缩小筛选范围。",
};

const automationCollectionMessages: AccountCollectionMessages = {
  invalidMaximum: "自动化账号范围上限无效，无法安全收集符合条件的账号。",
  pageMismatch: (requestedPage, receivedPage) => `账号列表返回了错误页码（请求第 ${requestedPage} 页，收到第 ${receivedPage} 页），已停止自动化账号收集。`,
  emptyPageWithMore: "账号列表返回空页但仍声明存在下一页，已停止自动化账号收集以避免遗漏账号。",
  maximumExceeded: (maximum) => `自动化匹配范围超过 ${maximum.toLocaleString()} 个账号，已停止执行。请缩小规则范围后重试。`,
  duplicateAccount: "账号列表存在重复账号页，已停止自动化账号收集以避免遗漏或重复操作。",
  pageLimitExceeded: "自动化匹配范围超过可浏览的页码上限，已停止执行。请缩小规则范围后重试。",
};

export function useBatch() {
  const accounts = ref<Account[]>([]);
  const accountPage = ref<AccountPage>(emptyAccountPage());
  const loadingAccounts = ref(false);
  const accountError = ref<string | null>(null);
  const modelCatalog = ref<ModelCatalog>({ options: [], unknownAccounts: 0 });
  const loadingModels = ref(false);
  // Keeps the latest result for every account for the lifetime of this client session.
  const testStates = ref<Record<number, TestRowState>>({});
  // Tracks only the active or most recently completed batch for progress statistics.
  const runStates = ref<Record<number, TestRowState>>({});
  const activeRunId = ref<string | null>(null);
  // This is a pre-test account-state snapshot, not a test outcome. Keeping it
  // separate prevents cancellation from ever being displayed as "停用".
  const selectedInactiveCount = ref(0);
  const summary = ref<BatchSummary>(emptySummary());
  const batchError = ref<string | null>(null);
  const accountRequests = createModelCatalogRequestGuard();
  const accountCollectionRequests = createModelCatalogRequestGuard();
  const latestTestCollectionRequests = createModelCatalogRequestGuard();
  const planTypeCollectionRequests = createModelCatalogRequestGuard();
  const modelScopeCollectionRequests = createModelCatalogRequestGuard();
  const automationCollectionRequests = createModelCatalogRequestGuard();
  const modelRequests = createModelCatalogRequestGuard();
  const activeModelLoadRequestIds = new Set<string>();
  const ignoredRunIds = new Set<string>();
  const settledRunCompletions = new Map<string, BatchCompletionResult | null>();
  const settledRunErrors = new Map<string, string>();
  const completionWaiters = new Map<string, BatchCompletionWaiter>();
  // Preserve the pending batch object's identity while start_batch_test is resolving.
  // A normal ref proxies objects, which would make the identity guard below reject
  // the active batch and drop all of its progress events.
  const pendingStart = shallowRef<{ bufferedEvents: BatchEvent[] } | null>(null);
  let unlisten: UnlistenFn | undefined;
  let disposed = false;
  let cancelRequestedWhileStarting = false;
  let batchListenerError: string | null = null;
  let batchCompletionRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let batchCompletionRecoveryInFlight = false;
  let activeRunLastEventAt = 0;
  let recoveryCancellationRequestedAt = 0;
  const batchListenerReady = registerBatchEventListener();

  const running = computed(() => activeRunId.value !== null || pendingStart.value !== null);

  async function loadAccountPage(input: AccountPageRequest): Promise<AccountPage | null> {
    const request = accountRequests.begin();
    loadingAccounts.value = true;
    accountError.value = null;
    try {
      const loadedPage = normalizeAccountPage(await invoke<unknown>("list_accounts_page", { input }), input);
      if (!accountRequests.isCurrent(request)) {
        return null;
      }
      accounts.value = loadedPage.items;
      accountPage.value = loadedPage;
      return loadedPage;
    } catch (error) {
      if (!accountRequests.isCurrent(request)) {
        return null;
      }
      accountError.value = readableError(error);
      throw error;
    } finally {
      if (accountRequests.isCurrent(request)) {
        loadingAccounts.value = false;
      }
    }
  }

  /**
   * Scans a bounded official account scope and publishes one locally filtered
   * page. This is needed for predicates that the list endpoint cannot express
   * exactly, such as subscription labels and derived runtime states.
   */
  async function loadAccountPageWithLocalFilter(
    input: AccountPageRequest,
    maximum: number,
    predicate: AccountLocalFilterPredicate,
    filterLabel: string,
  ): Promise<AccountPage | null> {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error(`${filterLabel}筛选上限无效，无法安全遍历账号。`);
    }

    const request = accountRequests.begin();
    loadingAccounts.value = true;
    accountError.value = null;
    try {
      const requestedPage = positiveInteger(input.page) ?? 1;
      const requestedPageSize = positiveInteger(input.pageSize) ?? DEFAULT_ACCOUNT_PAGE_SIZE;
      const matches: Account[] = [];
      const seenIds = new Set<number>();
      let scanned = 0;
      let sourcePage = 1;
      let hasMore = true;
      let truncated = false;

      while (hasMore) {
        const sourceRequest = { ...input, page: sourcePage, pageSize: ACCOUNT_COLLECTION_PAGE_SIZE };
        const source = normalizeAccountPage(await invoke<unknown>("list_accounts_page", {
          input: sourceRequest,
        }), sourceRequest);
        if (!accountRequests.isCurrent(request)) return null;
        if (source.page !== sourcePage) {
          throw new Error(`账号列表返回了错误页码（请求第 ${sourcePage} 页，收到第 ${source.page} 页），已停止${filterLabel}筛选。`);
        }
        if (source.hasMore && source.items.length === 0) {
          throw new Error(`账号列表返回空页但仍声明存在下一页，已停止${filterLabel}筛选以避免遗漏账号。`);
        }

        truncated ||= source.truncated;
        for (const account of source.items) {
          if (!seenIds.add(account.id)) {
            throw new Error(`账号列表存在重复账号页，已停止${filterLabel}筛选以避免遗漏或重复账号。`);
          }
          scanned += 1;
          if (scanned > maximum) {
            throw new Error(`${filterLabel}筛选范围超过 ${maximum.toLocaleString()} 个账号，无法安全在本地分页。请先缩小其他筛选条件。`);
          }
          if (predicate(account)) {
            matches.push(account);
          }
        }

        hasMore = source.hasMore;
        if (!hasMore) break;
        sourcePage += 1;
        if (sourcePage > 999_999) {
          throw new Error(`${filterLabel}筛选范围超过可浏览的页码上限，无法安全遍历账号。`);
        }
      }

      const pages = Math.max(1, Math.ceil(matches.length / requestedPageSize));
      const page = Math.min(requestedPage, pages);
      const offset = (page - 1) * requestedPageSize;
      const filteredPage: AccountPage = {
        items: matches.slice(offset, offset + requestedPageSize),
        total: matches.length,
        page,
        pageSize: requestedPageSize,
        pages,
        truncated,
        hasMore: false,
      };
      accounts.value = filteredPage.items;
      accountPage.value = filteredPage;
      return filteredPage;
    } catch (error) {
      if (!accountRequests.isCurrent(request)) return null;
      accountError.value = readableError(error);
      throw error;
    } finally {
      if (accountRequests.isCurrent(request)) {
        loadingAccounts.value = false;
      }
    }
  }

  /** Compatibility wrapper retained for existing plan-type callers. */
  async function loadAccountPageForPlanType(
    input: AccountPageRequest,
    planType: string,
    maximum: number,
  ): Promise<AccountPage | null> {
    if (!hasAccountPlanTypeFilter(planType)) return loadAccountPage(input);
    return loadAccountPageWithLocalFilter(
      input,
      maximum,
      (account) => matchesAccountPlanTypeFilter(account.planType, planType),
      "账户类型",
    );
  }

  /** Compatibility wrapper for callers that only need the first bounded page. */
  async function loadAccounts(): Promise<Account[] | null> {
    const page = await loadAccountPage({ page: 1, pageSize: 100 });
    return page?.items ?? null;
  }

  /**
   * Resolves an explicit, bounded selection without changing the page currently
   * displayed in the account table. Bulk actions accept account IDs, so the
   * caller must never infer unseen IDs from a reported total.
   */
  async function collectMatchingAccounts(
    requestInput: AccountCollectionRequest,
    maximum: number,
  ): Promise<Account[] | null> {
    return collectAccountPages(
      requestInput,
      maximum,
      accountCollectionRequests,
      selectionCollectionMessages,
    );
  }

  /** Resolves the complete upper-filter scope for client-session test results. */
  async function collectLatestTestAccounts(
    requestInput: AccountCollectionRequest,
    maximum: number,
  ): Promise<Account[] | null> {
    return collectAccountPages(
      requestInput,
      maximum,
      latestTestCollectionRequests,
      latestTestCollectionMessages,
    );
  }

  /**
   * Builds the global subscription-label catalog without retaining every
   * account in the renderer. This keeps type pickers complete across pages.
   */
  async function collectPlanTypes(maximum: number): Promise<AccountPlanTypeCatalog | null> {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error("账户类型读取上限无效，无法安全遍历账号。");
    }

    const request = planTypeCollectionRequests.begin();
    const values = new Map<string, string>();
    const seenIds = new Set<number>();
    let hasUnrecognizedPlanTypes = false;
    let scanned = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const pageRequest: AccountPageRequest = { page, pageSize: ACCOUNT_COLLECTION_PAGE_SIZE };
      const result = normalizeAccountPage(await invoke<unknown>("list_accounts_page", {
        input: pageRequest,
      }), pageRequest);
      if (!planTypeCollectionRequests.isCurrent(request)) return null;
      if (result.page !== page) {
        throw new Error(`账号列表返回了错误页码（请求第 ${page} 页，收到第 ${result.page} 页），已停止读取账户类型。`);
      }
      if (result.hasMore && result.items.length === 0) {
        throw new Error("账号列表返回空页但仍声明存在下一页，已停止读取账户类型以避免遗漏账号。");
      }

      for (const account of result.items) {
        if (!seenIds.add(account.id)) {
          throw new Error("账号列表存在重复账号页，已停止读取账户类型以避免遗漏或重复账号。");
        }
        scanned += 1;
        if (scanned > maximum) {
          throw new Error(`账户类型范围超过 ${maximum.toLocaleString()} 个账号，无法安全完整读取。请先缩小服务器数据范围。`);
        }
        if (isUnrecognizedPlanType(account.planType)) {
          hasUnrecognizedPlanTypes = true;
          continue;
        }
        const display = account.planType?.trim();
        const key = normalizedPlanType(display);
        if (display && key && !values.has(key)) values.set(key, display);
      }

      hasMore = result.hasMore;
      if (!hasMore) break;
      page += 1;
      if (page > 999_999) {
        throw new Error("账户类型范围超过可浏览的页码上限，无法安全遍历账号。");
      }
    }

    return {
      planTypes: [...values.values()].sort(planTypeCollator.compare),
      hasUnrecognizedPlanTypes,
    };
  }

  /**
   * Resolves only IDs for the complete official filter scope used for model
   * discovery. Keeping account records out of this collection allows the
   * 1,000,000-account model ceiling without retaining a second full table.
   */
  async function collectModelScopeAccountIds(
    requestInput: AccountCollectionRequest,
    maximum: number,
    predicate?: AccountLocalFilterPredicate,
  ): Promise<number[] | null> {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error(modelScopeCollectionMessages.invalidMaximum);
    }
    const request = modelScopeCollectionRequests.begin();
    const pageSize = 200;
    const accountIds: number[] = [];
    const seenIds = new Set<number>();
    let scanned = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const pageRequest = { ...requestInput, page, pageSize };
      const result = normalizeAccountPage(await invoke<unknown>("list_accounts_page", {
        input: pageRequest,
      }), pageRequest);
      if (!modelScopeCollectionRequests.isCurrent(request)) return null;
      if (result.page !== page) {
        throw new Error(modelScopeCollectionMessages.pageMismatch(page, result.page));
      }
      if (result.hasMore && result.items.length === 0) {
        throw new Error(modelScopeCollectionMessages.emptyPageWithMore);
      }
      for (const account of result.items) {
        if (seenIds.has(account.id)) {
          throw new Error(modelScopeCollectionMessages.duplicateAccount);
        }
        seenIds.add(account.id);
        scanned += 1;
        if (scanned > maximum) {
          throw new Error(modelScopeCollectionMessages.maximumExceeded(maximum));
        }
        if (predicate && !predicate(account)) continue;
        accountIds.push(account.id);
      }
      hasMore = result.hasMore;
      if (!hasMore) break;
      page += 1;
      if (page > 999_999) {
        throw new Error(modelScopeCollectionMessages.pageLimitExceeded);
      }
    }

    return accountIds;
  }

  /**
   * Resolves the current official account-query scope for an automation run.
   * It deliberately owns a request guard so rule execution cannot cancel a
   * pending "select all" or test-model scope lookup.
   */
  async function collectAutomationAccounts(
    requestInput: AccountCollectionRequest,
    maximum: number,
  ): Promise<Account[] | null> {
    return collectAccountPages(
      requestInput,
      maximum,
      automationCollectionRequests,
      automationCollectionMessages,
    );
  }

  async function collectAccountPages(
    requestInput: AccountCollectionRequest,
    maximum: number,
    requestGuard: AccountCollectionGuard,
    messages: AccountCollectionMessages,
  ): Promise<Account[] | null> {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error(messages.invalidMaximum);
    }
    const request = requestGuard.begin();
    const pageSize = 200;
    const collected: Account[] = [];
    const seenIds = new Set<number>();
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const pageRequest = { ...requestInput, page, pageSize };
      const result = normalizeAccountPage(await invoke<unknown>("list_accounts_page", {
        input: pageRequest,
      }), pageRequest);
      if (!requestGuard.isCurrent(request)) {
        return null;
      }

      if (result.page !== page) {
        throw new Error(messages.pageMismatch(page, result.page));
      }
      if (result.hasMore && result.items.length === 0) {
        throw new Error(messages.emptyPageWithMore);
      }

      if (collected.length + result.items.length > maximum) {
        throw new Error(messages.maximumExceeded(maximum));
      }
      for (const account of result.items) {
        if (seenIds.has(account.id)) {
          throw new Error(messages.duplicateAccount);
        }
        seenIds.add(account.id);
        collected.push(account);
      }
      hasMore = result.hasMore;
      if (!hasMore) break;
      page += 1;
      if (page > 999_999) {
        throw new Error(messages.pageLimitExceeded);
      }
    }

    return collected;
  }

  function invalidateAccounts() {
    accountRequests.invalidate();
    accountCollectionRequests.invalidate();
    latestTestCollectionRequests.invalidate();
    modelScopeCollectionRequests.invalidate();
    automationCollectionRequests.invalidate();
    accounts.value = [];
    accountPage.value = emptyAccountPage();
    accountError.value = null;
    loadingAccounts.value = false;
  }

  function invalidatePlanTypeCollection() {
    planTypeCollectionRequests.invalidate();
  }

  /** Cancels a pending cross-page selection without disturbing the visible page. */
  function invalidateAccountCollection() {
    accountCollectionRequests.invalidate();
  }

  /** Cancels a pending complete-scope scan used by the latest-test view. */
  function invalidateLatestTestCollection() {
    latestTestCollectionRequests.invalidate();
  }

  /** Cancels a pending full-filter collection used only by model discovery. */
  function invalidateModelScopeCollection() {
    modelScopeCollectionRequests.invalidate();
  }

  /** Cancels a pending cross-page collection used only by automation execution. */
  function invalidateAutomationCollection() {
    automationCollectionRequests.invalidate();
  }

  async function loadModels(
    accountIds: number[],
    shouldPublish: () => boolean = () => true,
  ): Promise<ModelCatalog | null> {
    cancelActiveModelLoads();
    const request = modelRequests.begin();
    const requestId = createModelLoadRequestId();
    activeModelLoadRequestIds.add(requestId);
    loadingModels.value = true;
    try {
      const catalog = await invoke<ModelCatalog>("load_models", { accountIds, requestId });
      if (!modelRequests.isCurrent(request) || !shouldPublish()) {
        return null;
      }
      modelCatalog.value = catalog;
      return catalog;
    } catch (error) {
      if (!modelRequests.isCurrent(request) || !shouldPublish()) {
        return null;
      }
      batchError.value = readableError(error);
      throw error;
    } finally {
      if (modelRequests.isCurrent(request)) {
        loadingModels.value = false;
      }
      activeModelLoadRequestIds.delete(requestId);
    }
  }

  function invalidateModels() {
    modelRequests.invalidate();
    cancelActiveModelLoads();
    modelCatalog.value = { options: [], unknownAccounts: 0 };
    loadingModels.value = false;
  }

  function cancelActiveModelLoads() {
    const requestIds = [...activeModelLoadRequestIds];
    activeModelLoadRequestIds.clear();
    for (const requestId of requestIds) {
      // Cancellation is best-effort on a session/logout boundary. The stale
      // request guard still protects the view if IPC is already unavailable.
      void invoke<void>("cancel_model_load", { requestId }).catch(() => undefined);
    }
  }

  async function start(accountIds: number[], modelId: string, concurrency: number, inactiveCount = 0) {
    // Only one batch can run at a time, so completed manual runs never need to
    // stay around once a new run begins.
    settledRunCompletions.clear();
    settledRunErrors.clear();
    clearBatchCompletionRecovery();
    batchError.value = null;
    await batchListenerReady;
    if (batchListenerError) {
      batchError.value = batchListenerError;
      throw new Error(batchListenerError);
    }
    const previousTestStates = testStates.value;
    const previousInactiveCount = selectedInactiveCount.value;
    const nextRunStates = createTestStates(accountIds);
    const pending = { bufferedEvents: [] as BatchEvent[] };
    cancelRequestedWhileStarting = false;
    pendingStart.value = pending;
    runStates.value = nextRunStates;
    testStates.value = { ...previousTestStates, ...nextRunStates };
    selectedInactiveCount.value = normalizeInactiveCount(inactiveCount);
    summary.value = { ...emptySummary(), total: accountIds.length };
    try {
      const result = await invoke<BatchStartResult>("start_batch_test", {
        input: { accountIds, modelId, concurrency },
      });

      // A logout/reset can happen while the command is in flight. Do not revive that session.
      if (pendingStart.value !== pending) {
        ignoredRunIds.add(result.runId);
        settleRunCompletion(result.runId, null);
        return result.runId;
      }

      activeRunId.value = result.runId;
      pendingStart.value = null;
      activeRunLastEventAt = Date.now();
      recoveryCancellationRequestedAt = 0;
      const shouldCancel = cancelRequestedWhileStarting;
      cancelRequestedWhileStarting = false;
      for (const event of pending.bufferedEvents) {
        if (event.runId === result.runId) {
          consumeActiveRunEvent(event);
        }
      }
      if (shouldCancel && activeRunId.value === result.runId) {
        await requestBackendCancellation(result.runId);
      }
      if (activeRunId.value === result.runId) {
        armBatchCompletionRecovery(result.runId);
      }
      return result.runId;
    } catch (error) {
      if (pendingStart.value !== pending) {
        throw error;
      }

      pendingStart.value = null;
      cancelRequestedWhileStarting = false;
      batchError.value = readableError(error);
      testStates.value = previousTestStates;
      runStates.value = {};
      selectedInactiveCount.value = previousInactiveCount;
      summary.value = emptySummary();
      throw error;
    }
  }

  /**
   * Starts a batch and resolves only after its matching completion event. A
   * null result means the session was reset before that completion arrived.
   */
  async function startAndWaitForCompletion(
    accountIds: number[],
    modelId: string,
    concurrency: number,
    inactiveCount = 0,
  ): Promise<BatchCompletionResult | null> {
    const runId = await start(accountIds, modelId, concurrency, inactiveCount);
    return waitForRunCompletion(runId);
  }

  function waitForRunCompletion(runId: string): Promise<BatchCompletionResult | null> {
    const error = settledRunErrors.get(runId);
    if (error) {
      settledRunErrors.delete(runId);
      return Promise.reject(new Error(error));
    }
    if (settledRunCompletions.has(runId)) {
      const completion = settledRunCompletions.get(runId) ?? null;
      settledRunCompletions.delete(runId);
      return Promise.resolve(completion);
    }

    return new Promise((resolve, reject) => {
      completionWaiters.set(runId, { resolve, reject });
    });
  }

  function settleRunCompletion(runId: string, completion: BatchCompletionEvent | null) {
    const result: BatchCompletionResult | null = completion
      ? { completion, testStates: { ...runStates.value } }
      : null;
    const waiter = completionWaiters.get(runId);
    if (waiter) {
      completionWaiters.delete(runId);
      waiter.resolve(result);
      return;
    }
    settledRunCompletions.set(runId, result);
  }

  function failRunCompletion(runId: string, message: string) {
    const waiter = completionWaiters.get(runId);
    if (waiter) {
      completionWaiters.delete(runId);
      waiter.reject(new Error(message));
      return;
    }
    settledRunErrors.set(runId, message);
  }

  async function cancel() {
    const runId = activeRunId.value;
    if (!runId) {
      // The button changes as soon as startup begins. Remember a cancellation
      // requested during that short interval and send it once the backend
      // returns the run ID.
      if (pendingStart.value) {
        cancelRequestedWhileStarting = true;
      }
      return;
    }

    await requestBackendCancellation(runId);
  }

  async function requestBackendCancellation(runId: string): Promise<boolean | null> {
    try {
      return await invoke<boolean>("cancel_batch", { runId });
    } catch (error) {
      batchError.value = readableError(error);
      return null;
    }
  }

  function consume(event: BatchEvent) {
    if (ignoredRunIds.has(event.runId)) {
      if (event.kind === "complete") {
        ignoredRunIds.delete(event.runId);
      }
      return;
    }
    if (activeRunId.value) {
      if (event.runId === activeRunId.value) {
        consumeActiveRunEvent(event);
      }
      return;
    }

    // Tauri may deliver the first event before start_batch_test resolves with its run ID.
    // Buffer it briefly, then replay only events that match that confirmed run.
    pendingStart.value?.bufferedEvents.push(event);
  }

  function consumeActiveRunEvent(event: BatchEvent) {
    activeRunLastEventAt = Date.now();
    if (event.kind === "started") {
      activeRunId.value = event.runId;
      summary.value = { ...emptySummary(), total: event.total };
      return;
    }
    if (event.kind === "complete") {
      completeActiveRun(event);
      return;
    }

    runStates.value = applyBatchEvent(runStates.value, event);
    testStates.value = applyBatchEvent(testStates.value, event);
    summary.value = summarizeTestStates(runStates.value, summary.value.total);
  }

  function runStatesAreTerminal() {
    const states = Object.values(runStates.value);
    return states.length > 0 && states.every((state) => state.status !== "queued" && state.status !== "testing");
  }

  function completeActiveRun(completion: BatchCompletionEvent) {
    if (activeRunId.value !== completion.runId) return;

    clearBatchCompletionRecovery();
    summary.value = summarizeTestStates(runStates.value, summary.value.total);
    activeRunId.value = null;
    if (!runStatesAreTerminal()) {
      const message = "批量测试已结束，但部分逐账号结果未同步，无法安全生成报告。请刷新后重新测试。";
      batchError.value = message;
      failRunCompletion(completion.runId, message);
      return;
    }
    settleRunCompletion(completion.runId, completion);
  }

  function abandonActiveRun(runId: string, message: string) {
    if (activeRunId.value !== runId) return;
    clearBatchCompletionRecovery();
    ignoredRunIds.add(runId);
    activeRunId.value = null;
    batchError.value = message;
    failRunCompletion(runId, message);
  }

  function clearBatchCompletionRecovery() {
    if (batchCompletionRecoveryTimer) {
      clearTimeout(batchCompletionRecoveryTimer);
      batchCompletionRecoveryTimer = undefined;
    }
    recoveryCancellationRequestedAt = 0;
  }

  function armBatchCompletionRecovery(runId: string, delayMs = BATCH_COMPLETION_RECOVERY_POLL_MS) {
    if (disposed || activeRunId.value !== runId) return;
    if (batchCompletionRecoveryTimer) clearTimeout(batchCompletionRecoveryTimer);
    batchCompletionRecoveryTimer = setTimeout(() => {
      batchCompletionRecoveryTimer = undefined;
      void recoverBatchCompletion(runId);
    }, delayMs);
  }

  async function recoverBatchCompletion(runId: string) {
    if (disposed || activeRunId.value !== runId) return;
    if (batchCompletionRecoveryInFlight) {
      armBatchCompletionRecovery(runId);
      return;
    }

    batchCompletionRecoveryInFlight = true;
    try {
      const status = await invoke<BatchCompletionStatus>("get_batch_completion", { runId });
      if (activeRunId.value !== runId) return;
      if (status.kind === "complete") {
        completeActiveRun({
          kind: "complete",
          runId,
          succeeded: status.succeeded,
          failed: status.failed,
          cancelled: status.cancelled,
        });
        return;
      }
      if (status.kind === "missing") {
        abandonActiveRun(runId, "批量测试已结束，但未找到最终结果。请刷新后确认结果，再重新测试。");
        return;
      }
      await recoverUnresponsiveBatch(runId);
    } catch {
      // A transient IPC failure must not leave an export dialog permanently
      // busy. Apply the same bounded cancellation path as a silent backend.
      await recoverUnresponsiveBatch(runId);
    } finally {
      batchCompletionRecoveryInFlight = false;
    }
  }

  async function recoverUnresponsiveBatch(runId: string) {
    if (activeRunId.value !== runId) return;
    const idleMs = Date.now() - activeRunLastEventAt;
    if (idleMs < BATCH_EVENT_IDLE_TIMEOUT_MS) {
      armBatchCompletionRecovery(runId);
      return;
    }

    if (!recoveryCancellationRequestedAt) {
      recoveryCancellationRequestedAt = Date.now();
      batchError.value = "批量测试长时间未返回进度，正在请求安全取消。";
      const cancelled = await requestBackendCancellation(runId);
      if (activeRunId.value !== runId) return;
      // A false response means the backend already released this run. Query
      // again promptly so a persisted final aggregate can recover the result.
      armBatchCompletionRecovery(
        runId,
        cancelled === false ? Math.min(250, BATCH_COMPLETION_RECOVERY_POLL_MS) : BATCH_CANCELLATION_GRACE_MS,
      );
      return;
    }

    if (Date.now() - recoveryCancellationRequestedAt >= BATCH_CANCELLATION_GRACE_MS) {
      abandonActiveRun(
        runId,
        "批量测试长时间未返回最终结果，已停止等待。请刷新后确认结果，再重新测试。",
      );
      return;
    }
    armBatchCompletionRecovery(runId, BATCH_CANCELLATION_GRACE_MS);
  }

  function resetTestResults() {
    // A batch can finish after logout. Ignore its remaining events so they cannot restore cleared results.
    const activeRun = activeRunId.value;
    if (activeRun) {
      ignoredRunIds.add(activeRun);
      settleRunCompletion(activeRun, null);
    }
    clearBatchCompletionRecovery();
    pendingStart.value = null;
    cancelRequestedWhileStarting = false;
    testStates.value = {};
    runStates.value = {};
    activeRunId.value = null;
    selectedInactiveCount.value = 0;
    summary.value = emptySummary();
    batchError.value = null;
  }

  onUnmounted(() => {
    disposed = true;
    cancelActiveModelLoads();
    clearBatchCompletionRecovery();
    if (activeRunId.value) {
      ignoredRunIds.add(activeRunId.value);
      settleRunCompletion(activeRunId.value, null);
    }
    pendingStart.value = null;
    for (const waiter of completionWaiters.values()) {
      waiter.resolve(null);
    }
    completionWaiters.clear();
    settledRunCompletions.clear();
    unlisten?.();
    unlisten = undefined;
  });

  async function registerBatchEventListener() {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    try {
      const registered = await listen<BatchEvent>("batch://event", (event) => consume(event.payload));
      if (disposed) {
        registered();
        return;
      }
      unlisten = registered;
    } catch (error) {
      batchListenerError = `无法监听批量测试进度：${readableError(error)}`;
    }
  }

  return {
    accountPage,
    accountError,
    accounts,
    activeRunId,
    batchError,
    cancel,
    collectAutomationAccounts,
    collectLatestTestAccounts,
    collectMatchingAccounts,
    collectModelScopeAccountIds,
    collectPlanTypes,
    invalidateAccountCollection,
    invalidateAutomationCollection,
    invalidateLatestTestCollection,
    invalidateModelScopeCollection,
    invalidateModels,
    invalidatePlanTypeCollection,
    invalidateAccounts,
    loadAccountPage,
    loadAccountPageWithLocalFilter,
    loadAccountPageForPlanType,
    loadAccounts,
    loadModels,
    loadingAccounts,
    loadingModels,
    modelCatalog,
    resetTestResults,
    running,
    selectedInactiveCount,
    start,
    startAndWaitForCompletion,
    summary,
    testStates,
  };
}

function summarizeTestStates(states: Record<number, TestRowState>, fallbackTotal: number): BatchSummary {
  const rows = Object.values(states);
  return {
    total: rows.length || fallbackTotal,
    succeeded: rows.filter((row) => row.status === "succeeded").length,
    failed: rows.filter((row) => row.status === "failed").length,
    quotaExhausted: rows.filter((row) => row.status === "quotaExhausted").length,
    connectionInterrupted: rows.filter((row) => row.status === "connectionInterrupted").length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
  };
}

function normalizeInactiveCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function normalizeAccountPage(raw: unknown, requested: AccountPageRequest): AccountPage {
  if (!raw || typeof raw !== "object") {
    throw new Error("账号列表返回格式无效。");
  }

  const page = raw as AccountPageWire;
  if (!Array.isArray(page.items)) {
    throw new Error("账号列表缺少账号数组。");
  }

  const requestedPage = positiveInteger(requested.page) ?? 1;
  const requestedPageSize = positiveInteger(requested.pageSize) ?? DEFAULT_ACCOUNT_PAGE_SIZE;
  const pageNumber = positiveInteger(page.page) ?? requestedPage;
  const pageSize = positiveInteger(page.pageSize) ?? positiveInteger(page.page_size) ?? requestedPageSize;
  const total = nonNegativeInteger(page.total) ?? page.items.length;
  const reportedPages = positiveInteger(page.pages);
  const pagesFromTotal = total > 0 ? Math.ceil(total / pageSize) : 1;
  const hasMore = booleanValue(page.hasMore) ?? booleanValue(page.has_more)
    ?? (reportedPages !== undefined ? pageNumber < reportedPages : page.items.length === pageSize);
  const pages = Math.min(999_999, Math.max(1, reportedPages ?? pagesFromTotal, hasMore ? pageNumber + 1 : pageNumber));

  return {
    items: page.items as Account[],
    total,
    page: pageNumber,
    pageSize,
    pages,
    truncated: booleanValue(page.truncated) ?? false,
    hasMore,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizedPlanType(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readableError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "操作未完成，请检查网络和登录状态。";
}
