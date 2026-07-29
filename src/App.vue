<script setup lang="ts">
import { LogOut } from "@lucide/vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AccountTable from "./components/AccountTable.vue";
import AutomationDeleteConfirmDialog from "./components/AutomationDeleteConfirmDialog.vue";
import AccountExportDialog from "./components/AccountExportDialog.vue";
import AccountOperationsPanel from "./components/AccountOperationsPanel.vue";
import AccountToolbar from "./components/AccountToolbar.vue";
import AppLogo from "./components/AppLogo.vue";
import AutomaticAutomationTask, { type AutomaticAutomationTaskPhase } from "./components/AutomaticAutomationTask.vue";
import BatchAutomationDialog from "./components/BatchAutomationDialog.vue";
import BatchAccountConcurrencyDialog from "./components/BatchAccountConcurrencyDialog.vue";
import BatchConverterDialog from "./components/BatchConverterDialog.vue";
import BatchReportDialog from "./components/BatchReportDialog.vue";
import BatchTestPanel from "./components/BatchTestPanel.vue";
import CancelBatchConfirmDialog from "./components/CancelBatchConfirmDialog.vue";
import CloseConfirmDialog from "./components/CloseConfirmDialog.vue";
import DeleteAccountsDialog from "./components/DeleteAccountsDialog.vue";
import LoginPanel from "./components/LoginPanel.vue";
import LogoutConfirmDialog from "./components/LogoutConfirmDialog.vue";
import MoveAccountsDialog from "./components/MoveAccountsDialog.vue";
import OperationNotice from "./components/OperationNotice.vue";
import PriorityAccountsDialog from "./components/PriorityAccountsDialog.vue";
import RefreshControl from "./components/RefreshControl.vue";
import RenameAccountsDialog from "./components/RenameAccountsDialog.vue";
import StartupSplash from "./components/StartupSplash.vue";
import WindowTitleBar from "./components/WindowTitleBar.vue";
import { useBatch, type AccountPlanTypeCatalog } from "./composables/useBatch";
import { useSession, type LoginRequest } from "./composables/useSession";
import type { AccountExportFormat } from "./lib/accountExport";
import {
  chooseAutomationOutputDirectory,
  chooseOutputDirectory,
  writeAutomationExportFile,
  writeExportFileInDirectory,
} from "./lib/automationFileExport";
import {
  removeAccountIdsFromSelection,
  resolveAccountOperation,
} from "./lib/accountOperations";
import { beginAutomaticScheduleRun, nextAutomaticScheduleRun } from "./lib/automaticSchedule";
import {
  filterAccountsForAutomation,
  filterAccountsForAutomationAction,
  getAutomationConditionPlatformConstraint,
  getAutomationValidationIssues,
  AUTOMATION_UNGROUPED_GROUP_VALUE,
  MAX_AUTOMATION_INTERVAL_SECONDS,
  MIN_AUTOMATION_INTERVAL_SECONDS,
  MAX_AUTOMATION_RULES,
  normalizeAutomationRule,
  persistAutomationRules,
  readAutomationRules,
  renderAutomationRename,
  type AutomationAction,
  type AutomationConditionalStep,
  type AutomationDeleteStatus,
  type AutomationRule,
  type AutomationStorageProfile,
  groupIdFromAutomationConditionValue,
} from "./lib/automation";
import {
  ALL_FILTER_VALUE,
  filterAccounts,
  filterAccountsByLatestTest,
  getAccountPlanTypes,
  getAccountRuntimeStatus,
  groupIdFromFilterValue,
  isUnrecognizedPlanType,
  type LatestTestFilter,
  UNASSIGNED_GROUP_FILTER_VALUE,
} from "./lib/accounts";
import type { AccountSortKey } from "./lib/accountTableColumns";
import { MAX_BATCH_REPORT_ROWS } from "./lib/batchReport";
import { DEFAULT_CONCURRENCY } from "./lib/defaults";
import {
  buildBatchReportWorkbook,
  buildCpaArchive,
  buildOfficialAccountExportJson,
} from "./lib/exportBuild";
import { formatExportFileName, getExportFileName } from "./lib/exportFile";
import { normalizeModelScope, shouldLoadModelScope } from "./lib/modelCatalogRequest";
import { resolveAvailableModelId } from "./lib/modelSelection";
import { DEFAULT_ACCOUNT_PAGE_SIZE, getPageCount, getPageItems, type PageSize, type SortDirection } from "./lib/pagination";
import type {
  Account,
  AccountFilterValue,
  AccountGroup,
  AccountOperationResult,
  AccountPageRequest,
  AccountStatusFilter,
  CreateGroupAndMoveAccountsResult,
  ModelCatalog,
  ModelOption,
} from "./types";

const sessionState = useSession();
const batch = useBatch();
const isDesktopShell = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
// Debug windows begin with native decorations. Once this renderer has loaded,
// it switches back to the app title bar; a failed navigation never reaches here.
const usesCustomTitleBar = ref(isDesktopShell && !import.meta.env.DEV);
const desktopWindow = isDesktopShell ? getCurrentWindow() : null;
const initializing = ref(true);
const STARTUP_MINIMUM_DURATION_MS = 820;
const CLOSE_CONFIRMATION_PREFERENCE_KEY = "sub2bat.close-confirmation.disabled.v1";
const search = ref("");
const platform = ref<AccountFilterValue>("all");
const accountType = ref<AccountFilterValue>("all");
const planType = ref<AccountFilterValue>("all");
const planTypeCatalog = ref<AccountPlanTypeCatalog | null>(null);
const planTypeCatalogRequestsInFlight = ref(0);
const group = ref<AccountFilterValue>("all");
const status = ref<AccountStatusFilter>("all");
const privacy = ref<AccountFilterValue>("all");
const accountFilterTransition = ref(false);
const accountPageNumber = ref(1);
const accountPageSize = ref<PageSize>(DEFAULT_ACCOUNT_PAGE_SIZE);
const accountSortKey = ref<AccountSortKey | null>(null);
const accountSortDirection = ref<SortDirection>("asc");
const latestTestFilter = ref<LatestTestFilter>("all");
const latestTestScopeAccounts = ref<Account[]>([]);
const latestTestScopeLoading = ref(false);
const latestTestScopeKey = ref("");
const latestTestFilterTransition = ref(false);
const selectedIds = ref<number[]>([]);
const selectedAccountMetadata = ref<Record<number, Account>>({});
const globalSelectionPending = ref(false);
const pendingAccountIds = ref<number[]>([]);
const deleteDialogOpen = ref(false);
const deleteError = ref<string | null>(null);
const moveDialogOpen = ref(false);
const moveError = ref<string | null>(null);
const priorityDialogOpen = ref(false);
const priorityError = ref<string | null>(null);
const accountConcurrencyDialogOpen = ref(false);
const accountConcurrencyError = ref<string | null>(null);
const renameDialogOpen = ref(false);
const renameError = ref<string | null>(null);
const accountExportDialogOpen = ref(false);
const accountExportError = ref<string | null>(null);
const accountExportAccountIds = ref<number[]>([]);
const accountExportBusy = ref(false);
const accountExportDirectory = ref("");
const accountExportDirectoryPickerBusy = ref(false);
const converterDialogOpen = ref(false);
const converterDialogKey = ref(0);
const automationDialogOpen = ref(false);
const automationRules = ref<AutomationRule[]>([]);
const automationBusy = ref(false);
const automationDeleteConfirmOpen = ref(false);
const pendingAutomationRunRule = ref<AutomationRule | null>(null);
const reportDialogOpen = ref(false);
const reportError = ref<string | null>(null);
const reportAccountIds = ref<number[]>([]);
const reportBusy = ref(false);
const reportDirectory = ref("");
const reportPhase = ref<"idle" | "testing" | "exporting">("idle");
const reportDirectoryPickerBusy = ref(false);
const batchCancelConfirmOpen = ref(false);
const closeConfirmOpen = ref(false);
const logoutConfirmOpen = ref(false);
const closePromptDisabled = ref(readClosePromptDisabled());
const groups = ref<AccountGroup[]>([]);
const moveGroups = ref<AccountGroup[]>([]);
const groupLoadError = ref<string | null>(null);
const accountActionBusy = ref(false);
const operationNotice = ref<string | null>(null);
const modelId = ref("");
const concurrency = ref(DEFAULT_CONCURRENCY);
const lastModelScope = ref("");
const modelScopeResolving = ref(false);
const MAX_GLOBAL_ACCOUNT_SELECTION = 10_000;
/** A model catalog can cover the same 1,000,000-account navigation ceiling. */
const MAX_MODEL_SCOPE_ACCOUNTS = 1_000_000;
/** Full local pagination is required because Sub2API has no plan-type query. */
const MAX_PLAN_TYPE_FILTER_ACCOUNTS = 1_000_000;
/** Latest-test state exists in this client, so the complete upper-filter scope is resolved locally. */
const MAX_LATEST_TEST_FILTER_ACCOUNTS = 1_000_000;
/** Keep individual Tauri payloads modest while still supporting a large scope. */
const MODEL_CATALOG_REQUEST_CHUNK_SIZE = 10_000;
const MAX_AUTOMATION_ACCOUNT_SCOPE = 10_000;
let operationNoticeTimer: ReturnType<typeof setTimeout> | undefined;
let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
let accountFilterReloadTimer: ReturnType<typeof setTimeout> | undefined;
let accountFilterRevision = 0;
const automationTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface AutomaticAutomationSchedule {
  fingerprint: string;
  /** Backend-issued generation for one explicit automatic start. */
  scheduleId: string;
  dueAt: number;
  waitingStartedAt: number;
  waitingDurationMs: number;
  /** Starts at one for each schedule generation. */
  cycle: number;
}

interface AutomationExecutionLeaseResult {
  status: "claimed" | "alreadyClaimed" | "busy";
  leaseId?: string;
}

interface AutomaticAutomationScheduleStartResult {
  scheduleId: string;
}

/**
 * Saving another rule can rebuild the active timer. Keep its due time and
 * cycle stable so that an already-claimed automatic execution is never
 * duplicated after a harmless save.
 */
const automaticAutomationSchedules = new Map<string, AutomaticAutomationSchedule>();
const AUTOMATIC_AUTOMATION_RETRY_MS = 10_000;
let dashboardEpoch = 0;
let groupsRequest = 0;
let moveGroupsRequest = 0;
let refreshInFlight: Promise<boolean> | null = null;
let modelScopeRequest = 0;
let modelScopeCollectionRequest = 0;
let planTypeCatalogRequest = 0;
let planTypeCatalogTask: Promise<boolean> | null = null;
let latestTestScopeRequest = 0;
// Every direct selection change invalidates a pending cross-page "select all".
// The collection request has its own guard too; this revision also protects
// against a result that reaches this component after the user cleared it.
let accountSelectionRevision = 0;
let dashboardHydrated = false;
let closeApproved = false;
let unlistenCloseRequested: (() => void) | undefined;
// This revision invalidates all in-flight work when the dashboard/session
// changes. The visible execution button targets only the currently active run.
let automationRunRevision = 0;
let nextAutomationRunId = 0;
const automationRunEpochs = new Map<number, number>();
const cancelledAutomationRunIds = new Set<number>();
let activeAutomationRuns = 0;
let automationTimerRevision = 0;
let nextAutomaticAutomationDispatchId = 0;
let activeAutomaticAutomationDispatchId: number | null = null;
const runningAutomaticAutomationRuleId = ref<string | null>(null);
let runningAutomaticAutomationRunId: number | null = null;
const runningAutomationRuleId = ref<string | null>(null);
let runningAutomationRunId: number | null = null;
// An interval is only configuration. The user explicitly starts automatic execution.
const automaticRuleId = ref<string | null>(null);
// The task becomes a compact main-page entry only after the user explicitly
// sends it to the background (or closes its dialog while it remains active).
const automationTaskBackgrounded = ref(false);
let activeAutomationExecutionLeaseId: string | null = null;
const automaticTaskProgressNow = ref(Date.now());
let automaticTaskProgressTimer: number | undefined;
// Reserves the operation surface while the automatic rule obtains its durable
// per-cycle claim, so no normal batch action overlaps that transition.
const automaticAutomationDispatching = ref(false);
// Dialog-granted filesystem paths exist only for this client run. Persisted
// rule settings must not silently regain access after an application restart.
const authorizedAutomationDirectories = new Set<string>();

const pageFilteredAccounts = computed(() =>
  filterAccounts(batch.accounts.value, {
    // The remaining filters are sent to the official paginated endpoint. These
    // local checks only refine fields the endpoint cannot express exactly.
    platform: ALL_FILTER_VALUE,
    accountType: ALL_FILTER_VALUE,
    planType: planType.value,
    group: ALL_FILTER_VALUE,
    status: status.value,
    privacy: privacy.value,
    search: "",
  }),
);
const latestTestFilterActive = computed(() => latestTestFilter.value !== ALL_FILTER_VALUE);
const latestTestScopeIdentity = computed(() => JSON.stringify({
  platform: platform.value,
  accountType: accountType.value,
  planType: planType.value,
  group: group.value,
  status: status.value,
  privacy: privacy.value,
  search: search.value.trim(),
  sortKey: accountSortKey.value,
  sortDirection: accountSortDirection.value,
}));
const latestTestScopeReady = computed(() => (
  latestTestScopeKey.value === latestTestScopeIdentity.value
  && !latestTestScopeLoading.value
));
const latestTestFilteredAccounts = computed(() => {
  if (!latestTestFilterActive.value || !latestTestScopeReady.value) return [];
  return filterAccountsByLatestTest(
    latestTestScopeAccounts.value,
    batch.testStates.value,
    latestTestFilter.value,
  );
});
const tableAccounts = computed(() => (
  latestTestFilterActive.value
    ? getPageItems(latestTestFilteredAccounts.value, accountPageNumber.value, accountPageSize.value)
    : pageFilteredAccounts.value
));
const tableAccountTotal = computed(() => (
  latestTestFilterActive.value ? latestTestFilteredAccounts.value.length : batch.accountPage.value.total
));
const tableAccountPageCount = computed(() => (
  latestTestFilterActive.value
    ? getPageCount(tableAccountTotal.value, accountPageSize.value)
    : batch.accountPage.value.pages
));
const tableAccountTruncated = computed(() => (
  latestTestFilterActive.value ? false : batch.accountPage.value.truncated
));
const tableLoading = computed(() => (
  latestTestFilterActive.value
    ? latestTestScopeLoading.value || !latestTestScopeReady.value || accountFilterTransition.value
    : batch.loadingAccounts.value || latestTestFilterTransition.value
));
const availablePlanTypes = computed(() => (
  planTypeCatalog.value?.planTypes ?? getAccountPlanTypes(batch.accounts.value)
));
const hasUnrecognizedPlanTypes = computed(() => (
  planTypeCatalog.value?.hasUnrecognizedPlanTypes
  ?? batch.accounts.value.some((account) => isUnrecognizedPlanType(account.planType))
));
const selectedCount = computed(() => selectedIds.value.length);
const automationBackgroundTask = computed<{
  id: string;
  name: string;
  phase: AutomaticAutomationTaskPhase;
  progress: number | null;
} | null>(() => {
  const ruleId = runningAutomationRuleId.value ?? automaticRuleId.value;
  if (!ruleId) return null;
  const rule = automationRules.value.find((item) => item.id === ruleId);
  if (!rule) return null;
  const phase: AutomaticAutomationTaskPhase = runningAutomationRuleId.value === ruleId
    ? "executing"
    : automaticRuleId.value === ruleId && automaticAutomationDispatching.value
      ? "claiming"
      : "waiting";
  const schedule = automaticAutomationSchedules.get(ruleId);
  const waitingDurationMs = schedule?.waitingDurationMs ?? 0;
  const progress = phase === "waiting"
    && schedule
    && Number.isFinite(waitingDurationMs)
    && waitingDurationMs > 0
    ? Math.max(0, Math.min(1, (automaticTaskProgressNow.value - schedule.waitingStartedAt) / waitingDurationMs))
    : null;
  return { id: rule.id, name: rule.name.trim() || "未命名自动化", phase, progress };
});
const accountWorkflowBusy = computed(() => (
  automationBusy.value || accountActionBusy.value || accountExportBusy.value || reportBusy.value || automaticAutomationDispatching.value
));
const pendingAccounts = computed(() => accountsForIds(pendingAccountIds.value));
const pendingOriginalPriorities = computed(() => pendingAccounts.value.map((account) => account.priority ?? null));
const pendingOriginalAccountConcurrencies = computed(() => pendingAccounts.value.map((account) => account.concurrency ?? null));
const pendingRenameAccounts = computed(() => pendingAccounts.value.map((account) => ({ id: account.id, name: account.name })));
const reportAccounts = computed(() => accountsForIds(reportAccountIds.value));
const pendingAutomationProtectedDeleteStatuses = computed(() => automationProtectedDeleteStatuses(pendingAutomationRunRule.value));

interface PendingMoveSelection {
  platform: string | null;
  platformLabel: string | null;
  error: string | null;
}

const pendingMoveSelection = computed<PendingMoveSelection>(() => {
  if (!pendingAccountIds.value.length) {
    return { platform: null, platformLabel: null, error: null };
  }
  if (pendingAccounts.value.length !== pendingAccountIds.value.length) {
    return {
      platform: null,
      platformLabel: null,
      error: "部分已选账号不在当前列表中，无法确认平台，请刷新后按平台分别选择账号。",
    };
  }

  const platforms = new Map<string, string>();
  for (const account of pendingAccounts.value) {
    const platformKey = normalizePlatformKey(account.platform);
    if (!platformKey) {
      return {
        platform: null,
        platformLabel: null,
        error: "选中的账号缺少平台信息，无法安全移动到分组。",
      };
    }
    if (!platforms.has(platformKey)) platforms.set(platformKey, account.platform.trim());
  }

  if (platforms.size !== 1) {
    return {
      platform: null,
      platformLabel: null,
      error: `选中的账号包含 ${[...platforms.values()].join("、")} 等多个平台，分组移动只能在同一平台内进行，请按平台分别选择账号。`,
    };
  }

  const [platform, platformLabel] = platforms.entries().next().value as [string, string];
  return { platform, platformLabel, error: null };
});

const moveTargetGroups = computed(() => {
  const platformKey = pendingMoveSelection.value.platform;
  if (!platformKey) return [];
  return moveGroups.value.filter((item) => normalizePlatformKey(item.platform) === platformKey);
});

type DeleteProtectionKind = "normal" | "rateLimited" | "connectionInterrupted" | "other";

interface PendingDeleteProtection {
  protectedIds: number[];
  normalCount: number;
  rateLimitedCount: number;
  connectionInterruptedCount: number;
  otherCount: number;
}

const pendingDeleteProtection = computed<PendingDeleteProtection>(() => {
  const protection: PendingDeleteProtection = {
    protectedIds: [],
    normalCount: 0,
    rateLimitedCount: 0,
    connectionInterruptedCount: 0,
    otherCount: 0,
  };

  for (const account of pendingAccounts.value) {
    const kind = getDeleteProtectionKind(account);
    if (!kind) continue;

    protection.protectedIds.push(account.id);
    if (kind === "normal") protection.normalCount += 1;
    if (kind === "rateLimited") protection.rateLimitedCount += 1;
    if (kind === "connectionInterrupted") protection.connectionInterruptedCount += 1;
    if (kind === "other") protection.otherCount += 1;
  }

  return protection;
});
const modelScope = computed(() => normalizeModelScope(selectedIds.value).accountIds);
const modelScopeIdentity = computed(() => {
  const selectedScope = normalizeModelScope(selectedIds.value);
  if (selectedScope.accountIds.length) return `selected:${selectedScope.key}`;

  // The official endpoint cannot express every client-side predicate. Include
  // all visible filters in the identity so an in-flight full-range lookup is
  // invalidated immediately when the user changes any of them.
  return `filtered:${JSON.stringify({
    platform: platform.value,
    accountType: accountType.value,
    planType: planType.value,
    group: group.value,
    status: status.value,
    privacy: privacy.value,
    latestTest: latestTestFilter.value,
    search: search.value.trim(),
  })}`;
});
const modelOptions = computed<ModelOption[]>(() => (
  lastModelScope.value === modelScopeIdentity.value
    ? batch.modelCatalog.value.options
    : []
));
const modelDiscoveryLoading = computed(() => modelScopeResolving.value || batch.loadingModels.value);
const refreshControlLoading = computed(() => (
  batch.loadingAccounts.value
  || latestTestScopeLoading.value
  || latestTestFilterTransition.value
  || modelDiscoveryLoading.value
  || planTypeCatalogRequestsInFlight.value > 0
));
const defaultModelId = computed(() => sessionState.preferences.value.lastModelId.trim());
const defaultConcurrency = computed(() => sessionState.preferences.value.concurrency || DEFAULT_CONCURRENCY);
const automationStorageScope = computed<AutomationStorageProfile>(() => ({
  serverUrl: sessionState.session.value?.serverUrl,
  email: sessionState.session.value?.email,
}));
const globalSelectionDisabledReason = computed(() => {
  if (status.value !== ALL_FILTER_VALUE) {
    return "状态筛选包含客户端运行状态判断，只能安全选择当前页。";
  }
  if (privacy.value === "__unset__") {
    return "未设置 Privacy 状态需要客户端兼容判断，只能安全选择当前页。";
  }
  return "";
});
const globalSelectionEnabled = computed(() => !globalSelectionDisabledReason.value);
const pageOnlyReason = computed(() => {
  const reasons: string[] = [];
  if (status.value !== ALL_FILTER_VALUE) reasons.push("账号状态仅当前页");
  if (privacy.value === "__unset__") reasons.push("未设置 Privacy 状态仅当前页");
  if (accountSortKey.value === "group") reasons.push("分组排序仅当前页");
  return reasons.join("；");
});
const tableGlobalSelectionEnabled = computed(() => (
  latestTestFilterActive.value
    ? latestTestScopeReady.value && !latestTestScopeLoading.value
    : globalSelectionEnabled.value
));
const tableGlobalSelectionDisabledReason = computed(() => {
  if (!latestTestFilterActive.value) return globalSelectionDisabledReason.value;
  if (latestTestScopeLoading.value) return "正在读取当前筛选范围，请稍候。";
  if (!latestTestScopeReady.value) return "尚未完成当前范围的最新测试筛选。";
  return "";
});
const tablePageOnlyReason = computed(() => {
  if (!latestTestFilterActive.value) return pageOnlyReason.value;
  return accountSortKey.value === "group" ? "分组排序仅当前页" : "";
});
type RefreshMode = "manual" | "automatic" | "filter" | "automation";
type AutomationRunSource = "manual" | "automatic";
type AutomationRunOutcome = "completed" | "cancelled" | "failed";

interface AutomationDirectoryPickerRequest {
  directory: string;
  setDirectory: (directory: string) => void;
}

async function enableCustomTitleBar() {
  if (!desktopWindow || !import.meta.env.DEV) return;

  try {
    await desktopWindow.setDecorations(false);
    usesCustomTitleBar.value = true;
  } catch {
    // Leave native controls available if the debug window cannot be switched.
  }
}

function startAutomaticTaskProgressTimer() {
  if (automaticTaskProgressTimer) return;
  automaticTaskProgressTimer = window.setInterval(() => {
    automaticTaskProgressNow.value = Date.now();
  }, 250);
}

function stopAutomaticTaskProgressTimer() {
  if (!automaticTaskProgressTimer) return;
  window.clearInterval(automaticTaskProgressTimer);
  automaticTaskProgressTimer = undefined;
}

onMounted(async () => {
  startAutomaticTaskProgressTimer();
  await enableCustomTitleBar();
  registerCloseRequestListener();
  const startedAt = performance.now();
  try {
    await sessionState.restore();
    if (sessionState.authenticated.value) {
      await hydrateDashboard();
    }
  } catch {
    // Account-load errors are already recorded for the dashboard. Always
    // leave the startup state so the user can refresh or sign out.
  } finally {
    const remainingAnimationTime = STARTUP_MINIMUM_DURATION_MS - (performance.now() - startedAt);
    if (remainingAnimationTime > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, remainingAnimationTime));
    }
    initializing.value = false;
  }
});

function clearAccountFilterReloadTimer() {
  if (!accountFilterReloadTimer) return;
  clearTimeout(accountFilterReloadTimer);
  accountFilterReloadTimer = undefined;
}

function scheduleAccountFilterReload(delayMs: number) {
  if (!dashboardHydrated || !sessionState.authenticated.value) return;
  const revision = ++accountFilterRevision;
  accountPageNumber.value = 1;
  // Never leave rows from the previous query actionable while a new filter is
  // still being resolved. A stale visible selection could otherwise mutate an
  // account that is outside the filter the user now sees.
  accountFilterTransition.value = true;
  clearSelectedAccounts();
  invalidateLatestTestScope();
  batch.invalidateAccounts();
  clearAccountFilterReloadTimer();
  accountFilterReloadTimer = setTimeout(async () => {
    accountFilterReloadTimer = undefined;
    try {
      const reloaded = await reloadAccounts();
      if (reloaded && revision === accountFilterRevision && latestTestFilterActive.value) {
        await loadLatestTestScope();
      }
    } finally {
      if (revision === accountFilterRevision) accountFilterTransition.value = false;
    }
  }, delayMs);
}

watch([platform, accountType, planType, group, status, privacy], () => {
  scheduleAccountFilterReload(0);
});

watch(search, () => {
  // Avoid issuing a request for every keystroke while still keeping server-side
  // search responsive on large installations.
  scheduleAccountFilterReload(220);
});

watch(
  modelScopeIdentity,
  (next, previous) => {
    if (next !== previous) invalidateModelDiscovery();
  },
);

function readClosePromptDisabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLOSE_CONFIRMATION_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistClosePromptDisabled(disabled: boolean) {
  try {
    window.localStorage.setItem(CLOSE_CONFIRMATION_PREFERENCE_KEY, String(disabled));
  } catch {
    // The confirmation remains enabled when browser storage is unavailable.
  }
}

function registerCloseRequestListener() {
  if (!desktopWindow) return;

  void desktopWindow
    .onCloseRequested((event) => {
      if (closeApproved) return;
      event.preventDefault();
      requestWindowClose();
    })
    .then((unlisten) => {
      unlistenCloseRequested = unlisten;
    })
    .catch(() => undefined);
}

function requestWindowClose() {
  if (!desktopWindow || closeApproved || closeConfirmOpen.value) return;
  if (closePromptDisabled.value) {
    void closeWindow();
    return;
  }
  closeConfirmOpen.value = true;
}

function cancelWindowClose() {
  closeConfirmOpen.value = false;
}

function confirmWindowClose(skipFutureConfirmations: boolean) {
  if (skipFutureConfirmations) {
    closePromptDisabled.value = true;
    persistClosePromptDisabled(true);
  }
  closeConfirmOpen.value = false;
  void closeWindow();
}

async function closeWindow() {
  if (!desktopWindow || closeApproved) return;
  closeApproved = true;
  try {
    // The close-request listener intentionally intercepts normal system close
    // events so it can show the confirmation dialog. Once confirmed, bypass
    // that listener and close the only application window directly.
    await desktopWindow.destroy();
  } catch {
    closeApproved = false;
  }
}

async function hydrateDashboard() {
  const dashboardRequest = beginDashboardEpoch();
  dashboardHydrated = false;
  accountFilterRevision += 1;
  accountFilterTransition.value = false;
  batch.invalidateAccounts();
  invalidatePlanTypeCatalog();
  invalidateModelDiscovery();
  modelId.value = "";
  concurrency.value = sessionState.preferences.value.concurrency || DEFAULT_CONCURRENCY;
  await Promise.all([reloadAccounts(dashboardRequest), loadGroups(dashboardRequest)]);
  if (!isCurrentDashboard(dashboardRequest)) return;
  dashboardHydrated = true;
  loadAutomationRulesForCurrentSession();
  restartAutoRefreshTimer();
  restartAutomaticTimers();
  // Full account-type and model catalogs are intentionally loaded only after
  // the user opens the corresponding picker. A restored dashboard must not
  // begin a potentially million-account scan in the background.
}

function beginDashboardEpoch() {
  dashboardEpoch += 1;
  return dashboardEpoch;
}

function isCurrentDashboard(request: number) {
  return request === dashboardEpoch && sessionState.authenticated.value;
}

function invalidateDashboardRequests() {
  dashboardEpoch += 1;
  groupsRequest += 1;
  moveGroupsRequest += 1;
  accountSelectionRevision += 1;
  automationRunRevision += 1;
  refreshInFlight = null;
  latestTestFilterTransition.value = false;
  invalidateLatestTestScope();
  batch.invalidateAccounts();
  batch.invalidateAutomationCollection();
  invalidatePlanTypeCatalog();
  invalidateModelDiscovery();
}

function invalidateModelDiscovery() {
  modelScopeRequest += 1;
  modelScopeCollectionRequest += 1;
  modelScopeResolving.value = false;
  batch.invalidateModelScopeCollection();
  batch.invalidateModels();
  lastModelScope.value = "";
}

function invalidateLatestTestScope() {
  latestTestScopeRequest += 1;
  latestTestScopeAccounts.value = [];
  latestTestScopeKey.value = "";
  latestTestScopeLoading.value = false;
  batch.invalidateLatestTestCollection();
}

function optionalAccountFilter(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized !== ALL_FILTER_VALUE ? normalized : undefined;
}

function officialSortField(key: AccountSortKey | null): string | undefined {
  switch (key) {
    case "id": return "id";
    case "lastUsedAt": return "last_used_at";
    case "createdAt": return "created_at";
    // Sub2API cannot globally sort by its display-only group-name field.
    case "group":
    case null:
      return undefined;
  }
}

function accountListQuery(): Omit<AccountPageRequest, "page" | "pageSize"> {
  const groupId = groupIdFromFilterValue(group.value);
  const ungrouped = group.value === UNASSIGNED_GROUP_FILTER_VALUE;
  const sortBy = officialSortField(accountSortKey.value);

  return {
    platform: optionalAccountFilter(platform.value),
    accountType: optionalAccountFilter(accountType.value),
    status: optionalAccountFilter(status.value),
    groupId,
    ungrouped: ungrouped || undefined,
    search: search.value.trim() || undefined,
    // `__unset__` is a local compatibility predicate, not an official value.
    privacyMode: privacy.value === "__unset__" ? undefined : optionalAccountFilter(privacy.value),
    sortBy,
    sortOrder: sortBy ? accountSortDirection.value : undefined,
  };
}

function latestTestAccountListQuery(): Omit<AccountPageRequest, "page" | "pageSize"> {
  return {
    ...accountListQuery(),
    // Runtime statuses such as rate-limited and unschedulable are derived from
    // several account fields. Read the complete upper scope and apply that
    // predicate locally instead of asking the server for one raw status value.
    status: undefined,
  };
}

function accountPageRequest(page = accountPageNumber.value, pageSize = accountPageSize.value): AccountPageRequest {
  return { ...accountListQuery(), page, pageSize };
}

async function reloadAccounts(dashboardRequest = dashboardEpoch, refreshModels = true): Promise<boolean> {
  if (refreshModels) invalidateModelDiscovery();

  const requestedPage = accountPageNumber.value;
  const request = accountPageRequest(requestedPage);
  const loaded = planType.value === ALL_FILTER_VALUE
    ? await batch.loadAccountPage(request)
    : await batch.loadAccountPageForPlanType(request, planType.value, MAX_PLAN_TYPE_FILTER_ACCOUNTS);
  if (loaded === null || !isCurrentDashboard(dashboardRequest)) return false;

  // An account deletion or a changed filter can invalidate the page being
  // viewed. Fetch the server's final valid page instead of leaving an empty one.
  if (requestedPage > loaded.pages && loaded.pages > 0) {
    accountPageNumber.value = loaded.pages;
    return reloadAccounts(dashboardRequest, false);
  }

  accountPageNumber.value = loaded.page;
  refreshSelectedAccountMetadata(batch.accounts.value);
  return true;
}

async function loadLatestTestScope(dashboardRequest = dashboardEpoch): Promise<boolean> {
  if (!latestTestFilterActive.value || !isCurrentDashboard(dashboardRequest)) return false;

  const scopeKey = latestTestScopeIdentity.value;
  const request = ++latestTestScopeRequest;
  latestTestScopeAccounts.value = [];
  latestTestScopeKey.value = "";
  latestTestScopeLoading.value = true;
  batch.accountError.value = null;
  batch.invalidateLatestTestCollection();

  try {
    const candidates = await batch.collectLatestTestAccounts(
      latestTestAccountListQuery(),
      MAX_LATEST_TEST_FILTER_ACCOUNTS,
    );
    if (
      !candidates
      || request !== latestTestScopeRequest
      || !isCurrentDashboard(dashboardRequest)
      || scopeKey !== latestTestScopeIdentity.value
      || !latestTestFilterActive.value
    ) {
      return false;
    }

    latestTestScopeAccounts.value = filterAccounts(candidates, {
      // These predicates are already handled by the official account-list
      // query. The remaining fields require client-side compatibility logic.
      platform: ALL_FILTER_VALUE,
      accountType: ALL_FILTER_VALUE,
      planType: planType.value,
      group: ALL_FILTER_VALUE,
      status: status.value,
      privacy: privacy.value,
      search: "",
    });
    latestTestScopeKey.value = scopeKey;
    refreshSelectedAccountMetadata(latestTestScopeAccounts.value);
    return true;
  } catch (error) {
    if (request === latestTestScopeRequest && isCurrentDashboard(dashboardRequest)) {
      batch.accountError.value = readableActionError(error);
    }
    return false;
  } finally {
    if (request === latestTestScopeRequest) {
      latestTestScopeLoading.value = false;
    }
  }
}

function invalidatePlanTypeCatalog() {
  planTypeCatalogRequest += 1;
  planTypeCatalogTask = null;
  planTypeCatalog.value = null;
  batch.invalidatePlanTypeCollection();
}

/** Reads distinct subscription labels from every account page without retaining the account list. */
async function refreshPlanTypeCatalog(dashboardRequest = dashboardEpoch): Promise<boolean> {
  if (!isCurrentDashboard(dashboardRequest)) return false;
  if (planTypeCatalog.value) return true;
  // Multiple controls can request the catalog at once (for example, repeated
  // clicks while a picker opens). Share one guarded full scan instead of
  // restarting it for every caller.
  if (planTypeCatalogTask) return planTypeCatalogTask;

  const request = ++planTypeCatalogRequest;
  planTypeCatalogRequestsInFlight.value += 1;
  const task = batch.collectPlanTypes(MAX_MODEL_SCOPE_ACCOUNTS)
    .then((planTypeCatalogResult) => {
      if (!planTypeCatalogResult || !isCurrentDashboard(dashboardRequest) || request !== planTypeCatalogRequest) return false;
      planTypeCatalog.value = planTypeCatalogResult;
      return true;
    })
    .catch(() => {
      // Keep the visible-page fallback available when a full scan cannot finish.
      return false;
    });
  planTypeCatalogTask = task;
  void task.finally(() => {
    if (planTypeCatalogTask === task) planTypeCatalogTask = null;
    planTypeCatalogRequestsInFlight.value = Math.max(0, planTypeCatalogRequestsInFlight.value - 1);
  });
  return task;
}

async function reloadAccountsLightweight(dashboardRequest = dashboardEpoch) {
  return reloadAccounts(dashboardRequest, false);
}

async function loadGroups(dashboardRequest = dashboardEpoch) {
  const request = ++groupsRequest;
  try {
    const loadedGroups = await invoke<AccountGroup[]>("list_groups");
    if (!isCurrentDashboard(dashboardRequest) || request !== groupsRequest) return false;
    groups.value = loadedGroups;
    groupLoadError.value = null;
    return true;
  } catch (error) {
    if (!isCurrentDashboard(dashboardRequest) || request !== groupsRequest) return false;
    groupLoadError.value = readableActionError(error);
    return false;
  }
}

async function handleLogin(request: LoginRequest) {
  try {
    await sessionState.login(request);
    if (sessionState.authenticated.value) {
      await hydrateDashboard();
    }
  } catch {
    // The composable owns the human-readable error state.
  }
}

async function handleTotp(code: string) {
  try {
    await sessionState.completeTotp(code);
    if (sessionState.authenticated.value) {
      await hydrateDashboard();
    }
  } catch {
    // The composable owns the human-readable error state.
  }
}

function restartLogin() {
  void sessionState.restartLogin().catch(() => undefined);
}

function accountsOnCurrentPageById(): Map<number, Account> {
  return new Map(batch.accounts.value.map((account) => [account.id, account]));
}

function refreshSelectedAccountMetadata(accounts: readonly Account[]) {
  if (!selectedIds.value.length) return;
  const selected = new Set(selectedIds.value);
  const next = { ...selectedAccountMetadata.value };
  for (const account of accounts) {
    if (selected.has(account.id)) next[account.id] = account;
  }
  selectedAccountMetadata.value = next;
}

function invalidatePendingAccountSelection() {
  accountSelectionRevision += 1;
  globalSelectionPending.value = false;
  batch.invalidateAccountCollection();
  return accountSelectionRevision;
}

function addSelectedAccounts(
  accountIds: readonly number[],
  source: readonly Account[] = batch.accounts.value,
  invalidatePending = true,
): boolean {
  const nextIds = new Set(selectedIds.value);
  const nextMetadata = { ...selectedAccountMetadata.value };
  const sourceById = new Map(source.map((account) => [account.id, account]));

  for (const accountId of accountIds) {
    nextIds.add(accountId);
    const account = sourceById.get(accountId);
    if (account) nextMetadata[accountId] = account;
  }

  if (nextIds.size > MAX_GLOBAL_ACCOUNT_SELECTION) {
    batch.accountError.value = `一次最多选择 ${MAX_GLOBAL_ACCOUNT_SELECTION.toLocaleString()} 个账号，请缩小筛选范围后再操作。`;
    return false;
  }

  if (invalidatePending) invalidatePendingAccountSelection();
  selectedIds.value = [...nextIds];
  selectedAccountMetadata.value = nextMetadata;
  return true;
}

function addSelectedAccountRecords(accounts: readonly Account[], invalidatePending = true): boolean {
  return addSelectedAccounts(accounts.map((account) => account.id), accounts, invalidatePending);
}

function removeSelectedAccounts(accountIds: readonly number[]) {
  invalidatePendingAccountSelection();
  selectedIds.value = removeAccountIdsFromSelection(selectedIds.value, accountIds);
  const removed = new Set(accountIds);
  const next = { ...selectedAccountMetadata.value };
  for (const accountId of removed) delete next[accountId];
  selectedAccountMetadata.value = next;
}

/**
 * Applies a confirmed deletion immediately, including the cross-page latest
 * test cache. The normal account reload that follows remains the authority,
 * but the UI must not keep deleted rows selected while that request runs.
 */
function removeDeletedAccountState(accountIds: readonly number[]) {
  const deletedIds = accountIds.filter((accountId, index, all) => (
    Number.isSafeInteger(accountId) && accountId > 0 && all.indexOf(accountId) === index
  ));
  if (!deletedIds.length) return;

  removeSelectedAccounts(deletedIds);
  const deleted = new Set(deletedIds);
  latestTestScopeAccounts.value = latestTestScopeAccounts.value.filter((account) => !deleted.has(account.id));
}

function toggleAccount(accountId: number, selected: boolean) {
  if (selected) addSelectedAccounts([accountId], tableAccounts.value);
  else removeSelectedAccounts([accountId]);
}

function toggleAccountIds(accountIds: number[], selected: boolean) {
  if (selected) addSelectedAccounts(accountIds, tableAccounts.value);
  else removeSelectedAccounts(accountIds);
}

function selectAccountIds(accountIds: number[]) {
  addSelectedAccounts(accountIds, tableAccounts.value);
}

function clearSelectedAccounts() {
  invalidatePendingAccountSelection();
  selectedIds.value = [];
  selectedAccountMetadata.value = {};
}

function accountsForIds(accountIds: readonly number[]): Account[] {
  const accountsById = accountsOnCurrentPageById();
  return accountIds.flatMap((accountId) => {
    const account = selectedAccountMetadata.value[accountId] ?? accountsById.get(accountId);
    return account ? [account] : [];
  });
}

async function selectAllFilteredAccounts() {
  if (!tableGlobalSelectionEnabled.value) return;

  if (latestTestFilterActive.value) {
    if (latestTestFilteredAccounts.value.length > MAX_GLOBAL_ACCOUNT_SELECTION) {
      batch.accountError.value = `当前最新测试筛选结果超过 ${MAX_GLOBAL_ACCOUNT_SELECTION.toLocaleString()} 个账号，请进一步缩小筛选范围后再全选。`;
      return;
    }
    addSelectedAccountRecords(latestTestFilteredAccounts.value);
    return;
  }

  const selectionRequest = invalidatePendingAccountSelection();
  globalSelectionPending.value = true;

  try {
    const candidates = await batch.collectMatchingAccounts(accountListQuery(), MAX_GLOBAL_ACCOUNT_SELECTION);
    if (!candidates || selectionRequest !== accountSelectionRevision) return;
    const accounts = filterAccounts(candidates, {
      platform: platform.value,
      accountType: accountType.value,
      planType: planType.value,
      group: group.value,
      status: status.value,
      search: search.value,
      privacy: privacy.value,
    });
    addSelectedAccountRecords(accounts, false);
  } catch (error) {
    if (selectionRequest === accountSelectionRevision) {
      batch.accountError.value = readableActionError(error);
    }
  } finally {
    if (selectionRequest === accountSelectionRevision) {
      globalSelectionPending.value = false;
    }
  }
}

function setLatestTestFilter(nextFilter: LatestTestFilter) {
  if (latestTestFilter.value === nextFilter) return;
  latestTestFilter.value = nextFilter;
  accountPageNumber.value = 1;
  invalidateModelDiscovery();

  if (nextFilter !== ALL_FILTER_VALUE) {
    if (!latestTestScopeReady.value) void loadLatestTestScope();
    return;
  }

  invalidateLatestTestScope();
  if (!dashboardHydrated || !sessionState.authenticated.value) return;

  latestTestFilterTransition.value = true;
  batch.invalidateAccounts();
  void reloadAccounts().finally(() => {
    latestTestFilterTransition.value = false;
  });
}

function setAccountPage(page: number) {
  const nextPage = Math.max(1, Math.trunc(page) || 1);
  if (nextPage === accountPageNumber.value) return;
  accountPageNumber.value = nextPage;
  if (latestTestFilterActive.value) return;
  void reloadAccounts();
}

function setAccountPageSize(pageSize: PageSize) {
  if (pageSize === accountPageSize.value) return;
  accountPageSize.value = pageSize;
  accountPageNumber.value = 1;
  if (latestTestFilterActive.value) return;
  void reloadAccounts();
}

function setAccountSort(key: AccountSortKey | null, direction: SortDirection) {
  if (accountSortKey.value === key && accountSortDirection.value === direction) return;
  accountSortKey.value = key;
  accountSortDirection.value = direction;
  accountPageNumber.value = 1;
  if (latestTestFilterActive.value) {
    invalidateLatestTestScope();
    void loadLatestTestScope();
    return;
  }
  void reloadAccounts();
}

function normalizePlatformKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function getDeleteProtectionKind(account: Account): DeleteProtectionKind | null {
  const testStatus = batch.testStates.value[account.id]?.status;

  // A current-session test outcome is more precise than the server's previous runtime status.
  if (testStatus === "connectionInterrupted") return "connectionInterrupted";
  if (testStatus === "quotaExhausted") return "rateLimited";
  if (testStatus === "succeeded") return "normal";
  if (testStatus === "failed") return null;

  const runtimeStatus = getAccountRuntimeStatus(account);
  if (runtimeStatus === "inactive" || runtimeStatus === "error") return null;
  if (runtimeStatus === "rate_limited") return "rateLimited";
  return runtimeStatus === "active" ? "normal" : "other";
}

function openDeleteDialog() {
  if (!selectedIds.value.length || accountActionBusy.value) return;
  pendingAccountIds.value = [...selectedIds.value];
  deleteError.value = null;
  deleteDialogOpen.value = true;
}

function closeDeleteDialog() {
  if (accountActionBusy.value) return;
  deleteDialogOpen.value = false;
  deleteError.value = null;
  pendingAccountIds.value = [];
}

async function deletePendingAccounts() {
  await deleteAccounts(pendingAccountIds.value, "删除");
}

async function deletePendingAccountsExcludingProtected() {
  const protectedIds = new Set(pendingDeleteProtection.value.protectedIds);
  const accountIds = pendingAccountIds.value.filter((accountId) => !protectedIds.has(accountId));
  if (!accountIds.length) return;

  await deleteAccounts(accountIds, `排除受保护账号后删除（已保留 ${protectedIds.size} 个）`);
}

async function deleteAccounts(accountIds: number[], actionName: string) {
  if (!accountIds.length || accountActionBusy.value) return;

  const dashboardRequest = dashboardEpoch;
  accountActionBusy.value = true;
  deleteError.value = null;
  try {
    const result = await invoke<AccountOperationResult>("delete_accounts", {
      input: {
        accountIds,
      },
    });
    if (!isCurrentDashboard(dashboardRequest)) return;
    // Remove confirmed deletions before the follow-up account request so the
    // selected count and latest-test view reflect the mutation immediately.
    removeDeletedAccountState(resolveAccountOperation(result, accountIds).completedIds);
    await finishAccountOperation(result, actionName, deleteError, () => {
      deleteDialogOpen.value = false;
    }, accountIds, dashboardRequest);
  } catch (error) {
    if (isCurrentDashboard(dashboardRequest)) {
      deleteError.value = readableActionError(error);
    }
  } finally {
    accountActionBusy.value = false;
  }
}

async function openMoveDialog() {
  if (!selectedIds.value.length || accountActionBusy.value) return;
  const dashboardRequest = dashboardEpoch;
  const request = ++moveGroupsRequest;
  pendingAccountIds.value = [...selectedIds.value];
  moveGroups.value = [];
  moveError.value = null;

  const selection = pendingMoveSelection.value;
  if (selection.platform) {
    try {
      const loadedGroups = await invoke<AccountGroup[]>("list_groups_for_platform", {
        input: { platform: selection.platform },
      });
      if (!isCurrentDashboard(dashboardRequest) || request !== moveGroupsRequest) return;
      moveGroups.value = loadedGroups;
    } catch (error) {
      if (!isCurrentDashboard(dashboardRequest) || request !== moveGroupsRequest) return;
      moveError.value = `无法获取 ${selection.platformLabel || selection.platform} 平台分组：${readableActionError(error)}`;
    }
  }
  if (!isCurrentDashboard(dashboardRequest) || request !== moveGroupsRequest) return;
  moveDialogOpen.value = true;
}

function closeMoveDialog() {
  if (accountActionBusy.value) return;
  moveGroupsRequest += 1;
  moveDialogOpen.value = false;
  moveError.value = null;
  moveGroups.value = [];
  pendingAccountIds.value = [];
}

async function movePendingAccounts(groupId: number) {
  if (!pendingAccountIds.value.length || accountActionBusy.value) return;

  const dashboardRequest = dashboardEpoch;
  const accountIds = [...pendingAccountIds.value];
  accountActionBusy.value = true;
  moveError.value = null;
  try {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error("请选择有效的目标分组。");
    }
    const selection = pendingMoveSelection.value;
    if (selection.error || !selection.platform) {
      throw new Error(selection.error || "无法确认选中账号的平台，请刷新后重试。");
    }
    if (!moveTargetGroups.value.some((item) => item.id === groupId)) {
      throw new Error(`请选择 ${selection.platformLabel || selection.platform} 平台的有效目标分组。`);
    }

    const result = await invoke<AccountOperationResult>("move_accounts_to_group", {
      input: { accountIds, groupId },
    });
    if (!isCurrentDashboard(dashboardRequest)) return;
    await finishAccountOperation(result, "移动", moveError, () => {
      moveDialogOpen.value = false;
      moveGroups.value = [];
    }, accountIds, dashboardRequest);
  } catch (error) {
    if (isCurrentDashboard(dashboardRequest)) {
      moveError.value = `移动未完成：${readableActionError(error)}`;
    }
  } finally {
    accountActionBusy.value = false;
  }
}

async function createAndMovePendingAccounts(name: string) {
  if (!pendingAccountIds.value.length || accountActionBusy.value) return;

  const dashboardRequest = dashboardEpoch;
  const accountIds = [...pendingAccountIds.value];
  const normalizedName = name.trim();
  accountActionBusy.value = true;
  moveError.value = null;
  try {
    const selection = pendingMoveSelection.value;
    if (selection.error || !selection.platform) {
      throw new Error(selection.error || "无法确认选中账号的平台，请刷新后重试。");
    }
    if (!normalizedName) {
      throw new Error("请输入新分组名称。");
    }

    const result = await invoke<CreateGroupAndMoveAccountsResult>("create_group_and_move_accounts", {
      input: { accountIds, name: normalizedName, platform: selection.platform },
    });
    if (!isCurrentDashboard(dashboardRequest)) return;
    await finishAccountOperation(result.operation, `创建分组“${result.group.name || normalizedName}”并移动`, moveError, () => {
      moveDialogOpen.value = false;
      moveGroups.value = [];
    }, accountIds, dashboardRequest, result.cleanupNotice);
  } catch (error) {
    if (isCurrentDashboard(dashboardRequest)) {
      moveError.value = `创建或移动未完成：${readableActionError(error)}`;
    }
  } finally {
    accountActionBusy.value = false;
  }
}

function openPriorityDialog() {
  if (!selectedIds.value.length || accountActionBusy.value) return;
  pendingAccountIds.value = [...selectedIds.value];
  priorityError.value = null;
  priorityDialogOpen.value = true;
}

function closePriorityDialog() {
  if (accountActionBusy.value) return;
  priorityDialogOpen.value = false;
  priorityError.value = null;
  pendingAccountIds.value = [];
}

async function setPendingAccountsPriority(priority: number) {
  if (!pendingAccountIds.value.length || accountActionBusy.value) return;
  if (!Number.isSafeInteger(priority) || priority < 0) {
    priorityError.value = "优先级必须是非负整数。";
    return;
  }

  const dashboardRequest = dashboardEpoch;
  const accountIds = [...pendingAccountIds.value];
  accountActionBusy.value = true;
  priorityError.value = null;
  try {
    const result = await invoke<AccountOperationResult>("set_accounts_priority", {
      input: { accountIds, priority },
    });
    if (!isCurrentDashboard(dashboardRequest)) return;
    await finishAccountOperation(result, "设置优先级", priorityError, () => {
      priorityDialogOpen.value = false;
    }, accountIds, dashboardRequest);
  } catch (error) {
    if (isCurrentDashboard(dashboardRequest)) {
      priorityError.value = `设置优先级未完成：${readableActionError(error)}`;
    }
  } finally {
    accountActionBusy.value = false;
  }
}

function openAccountConcurrencyDialog() {
  if (!selectedIds.value.length || accountActionBusy.value) return;
  pendingAccountIds.value = [...selectedIds.value];
  accountConcurrencyError.value = null;
  accountConcurrencyDialogOpen.value = true;
}

function closeAccountConcurrencyDialog() {
  if (accountActionBusy.value) return;
  accountConcurrencyDialogOpen.value = false;
  accountConcurrencyError.value = null;
  pendingAccountIds.value = [];
}

async function setPendingAccountConcurrency(accountConcurrency: number) {
  if (!pendingAccountIds.value.length || accountActionBusy.value) return;
  if (!Number.isSafeInteger(accountConcurrency) || accountConcurrency < 0) {
    accountConcurrencyError.value = "账号并发必须是非负整数。";
    return;
  }

  const dashboardRequest = dashboardEpoch;
  const accountIds = [...pendingAccountIds.value];
  accountActionBusy.value = true;
  accountConcurrencyError.value = null;
  try {
    const result = await invoke<AccountOperationResult>("set_accounts_concurrency", {
      input: { accountIds, concurrency: accountConcurrency },
    });
    if (!isCurrentDashboard(dashboardRequest)) return;
    await finishAccountOperation(result, "设置账号并发", accountConcurrencyError, () => {
      accountConcurrencyDialogOpen.value = false;
    }, accountIds, dashboardRequest);
  } catch (error) {
    if (isCurrentDashboard(dashboardRequest)) {
      accountConcurrencyError.value = `设置账号并发未完成：${readableActionError(error)}`;
    }
  } finally {
    accountActionBusy.value = false;
  }
}

function openRenameDialog() {
  if (!selectedIds.value.length || accountActionBusy.value) return;
  pendingAccountIds.value = [...selectedIds.value];
  renameError.value = null;
  renameDialogOpen.value = true;
}

function closeRenameDialog() {
  if (accountActionBusy.value) return;
  renameDialogOpen.value = false;
  renameError.value = null;
  pendingAccountIds.value = [];
}

async function renamePendingAccounts(payload: { items: Array<{ accountId: number; name: string }> }) {
  if (!pendingAccountIds.value.length || accountActionBusy.value) return;
  const selectedIdSet = new Set(pendingAccountIds.value);
  const payloadIdSet = new Set(payload.items.map((item) => item.accountId));
  if (
    payload.items.length !== selectedIdSet.size
    || payloadIdSet.size !== selectedIdSet.size
    || [...selectedIdSet].some((accountId) => !payloadIdSet.has(accountId))
    || payload.items.some((item) => !item.name.trim())
  ) {
    renameError.value = "重命名列表与已选账号不一致，请关闭后重新打开。";
    return;
  }

  const dashboardRequest = dashboardEpoch;
  const accountIds = [...pendingAccountIds.value];
  accountActionBusy.value = true;
  renameError.value = null;
  try {
    const result = await invoke<AccountOperationResult>("rename_accounts", {
      input: { accounts: payload.items.map((item) => ({ accountId: item.accountId, name: item.name.trim() })) },
    });
    if (!isCurrentDashboard(dashboardRequest)) return;
    await finishAccountOperation(result, "重命名", renameError, () => {
      renameDialogOpen.value = false;
    }, accountIds, dashboardRequest);
  } catch (error) {
    if (isCurrentDashboard(dashboardRequest)) {
      renameError.value = `重命名未完成：${readableActionError(error)}`;
    }
  } finally {
    accountActionBusy.value = false;
  }
}

function openReportDialog() {
  if (!selectedIds.value.length || accountWorkflowBusy.value) return;
  reportAccountIds.value = [...selectedIds.value];
  reportDirectory.value = "";
  reportPhase.value = "idle";
  reportError.value = null;
  reportDialogOpen.value = true;
}

async function pickReportDirectory() {
  if (!reportDialogOpen.value || reportBusy.value || reportDirectoryPickerBusy.value) return;

  reportDirectoryPickerBusy.value = true;
  try {
    const directory = await chooseOutputDirectory({
      title: "选择批量测活报告保存目录",
      defaultPath: reportDirectory.value,
    });
    if (!directory || !reportDialogOpen.value) return;
    reportDirectory.value = directory;
    reportError.value = null;
  } catch (error) {
    if (reportDialogOpen.value) {
      reportError.value = `无法选择保存目录：${readableActionError(error)}`;
    }
  } finally {
    reportDirectoryPickerBusy.value = false;
  }
}

function openAccountExportDialog() {
  if (!selectedIds.value.length || accountWorkflowBusy.value) return;
  accountExportAccountIds.value = [...selectedIds.value];
  accountExportDirectory.value = "";
  accountExportError.value = null;
  accountExportDialogOpen.value = true;
}

async function pickAccountExportDirectory() {
  if (!accountExportDialogOpen.value || accountExportBusy.value || accountExportDirectoryPickerBusy.value) return;

  accountExportDirectoryPickerBusy.value = true;
  try {
    const directory = await chooseOutputDirectory({
      title: "选择账号导出保存目录",
      defaultPath: accountExportDirectory.value,
    });
    if (!directory || !accountExportDialogOpen.value) return;
    accountExportDirectory.value = directory;
    accountExportError.value = null;
  } catch (error) {
    if (accountExportDialogOpen.value) {
      accountExportError.value = `无法选择保存目录：${readableActionError(error)}`;
    }
  } finally {
    accountExportDirectoryPickerBusy.value = false;
  }
}

function openConverterDialog() {
  if (batch.running.value) return;
  converterDialogOpen.value = true;
}

async function openAutomationDialog() {
  if (accountWorkflowBusy.value || batch.running.value) return;
  const dashboardRequest = dashboardEpoch;
  automationTaskBackgrounded.value = false;
  automationDialogOpen.value = true;
  // Open immediately, then populate the reactive account-type catalog in the
  // background. Cached data is invalidated only by real account changes.
  const [refreshed, planTypesRefreshed] = await Promise.all([
    refreshAccounts("filter"),
    refreshPlanTypeCatalog(dashboardRequest),
  ]);
  if (!isCurrentDashboard(dashboardRequest) || accountWorkflowBusy.value || batch.running.value) return;
  if (!refreshed || !planTypesRefreshed) {
    showOperationNotice("账号数据或账户类型目录刷新失败，自动化编辑器将保留上次可用选项。");
  }
}

function openAutomationBackgroundTask() {
  if (!automationBackgroundTask.value) return;
  // The task panel must remain available while a run owns the operation lock,
  // so the user can inspect it or end it from the same primary control.
  automationTaskBackgrounded.value = false;
  automationDialogOpen.value = true;
}

function moveAutomationTaskToBackground() {
  if (!automationBackgroundTask.value) return;
  automationTaskBackgrounded.value = true;
  automationDialogOpen.value = false;
}

function closeAutomationDialog() {
  automationDialogOpen.value = false;
  // Do not strand a still-active automatic task behind a closed dialog: its
  // compact entry is the way to return to its controls while the operation
  // surface remains locked.
  if (automationBackgroundTask.value) automationTaskBackgrounded.value = true;
}

function loadAutomationRulesForCurrentSession() {
  if (!sessionState.authenticated.value) {
    automationRules.value = [];
    return;
  }
  automationRules.value = readAutomationRules(automationStorageScope.value);
}

function saveAutomationRules(nextRules: readonly AutomationRule[], restartTimers = true): boolean {
  const normalized: AutomationRule[] = [];
  const seenIds = new Set<string>();
  for (const candidate of nextRules) {
    if (normalized.length >= MAX_AUTOMATION_RULES) break;
    const rule = normalizeAutomationRule(candidate);
    if (!rule || seenIds.has(rule.id)) continue;
    seenIds.add(rule.id);
    normalized.push(rule);
  }

  automationRules.value = normalized;
  const persisted = sessionState.authenticated.value
    ? persistAutomationRules(automationStorageScope.value, normalized)
    : false;
  if (restartTimers && !automaticAutomationDispatching.value) restartAutomaticTimers();
  if (!persisted && sessionState.authenticated.value) {
    showOperationNotice("自动化规则已更新，但无法写入本地保存区；关闭客户端后需要重新设置。");
  }
  return persisted;
}

function validateAutomationRuleForSave(rule: AutomationRule): string | null {
  const issue = getAutomationValidationIssues(rule)[0];
  if (issue) return issue.message;
  if (rule.intervalSeconds !== null && rule.intervalSeconds < MIN_AUTOMATION_INTERVAL_SECONDS) {
    return `自动执行间隔至少为 ${MIN_AUTOMATION_INTERVAL_SECONDS} 秒。`;
  }
  if (rule.intervalSeconds !== null) {
    const automaticSafetyIssue = automaticExecutionSafetyIssue(rule);
    if (automaticSafetyIssue) return automaticSafetyIssue;
  }
  for (const step of rule.steps) {
    if (step.kind !== "conditional") continue;
    const deleteIndex = step.actions.findIndex((action) => action.kind === "deleteAccounts");
    if (deleteIndex >= 0 && deleteIndex !== step.actions.length - 1) {
      return "删除账号必须放在同一条件步骤的最后一个动作；删除后请使用新的条件步骤。";
    }
    const sourcePlatform = automationStepPlatformConstraint(step);
    for (const action of step.actions) {
      if (action.kind !== "moveGroup") continue;
      if (!sourcePlatform) {
        return "移动到分组的条件必须包含“平台 等于 …”，以防跨平台移动账号。";
      }
      const target = action.groupId === null ? undefined : groups.value.find((group) => group.id === action.groupId);
      const targetPlatform = normalizePlatformKey(target?.platform);
      if (targetPlatform && targetPlatform !== sourcePlatform) {
        return `目标分组属于 ${target?.platform || "其他"} 平台，请将条件平台改为与目标分组一致。`;
      }
    }
  }
  return null;
}

function addAutomationRule(rule: AutomationRule) {
  if (automationBusy.value || automaticAutomationDispatching.value) return;
  if (automationRules.value.length >= MAX_AUTOMATION_RULES) {
    showOperationNotice(`最多可保存 ${MAX_AUTOMATION_RULES} 个批量自动化。`);
    return;
  }
  const validation = validateAutomationRuleForSave(rule);
  if (validation) {
    showOperationNotice(`自动化未保存：${validation}`);
    return;
  }
  const normalized = normalizeAutomationRule({ ...rule, updatedAt: new Date().toISOString() });
  if (!normalized) {
    showOperationNotice("自动化规则格式无效，未保存。");
    return;
  }
  const automaticIssue = automaticConfigurationIssue(normalized);
  if (automaticIssue) {
    showOperationNotice(`自动化未保存：${automaticIssue}`);
    return;
  }
  if (!saveAutomationRules([...automationRules.value, normalized], false)) return;
  const savedRule = automationRules.value.find((item) => item.id === normalized.id);
  if (!savedRule) return;
  showAutomationRuleSavedNotice(savedRule, false);
}

function editAutomationRule(payload: { id: string; rule: AutomationRule }) {
  if (automationBusy.value || automaticAutomationDispatching.value) return;
  const validation = validateAutomationRuleForSave(payload.rule);
  if (validation) {
    showOperationNotice(`自动化未保存：${validation}`);
    return;
  }
  const normalized = normalizeAutomationRule({ ...payload.rule, id: payload.id, updatedAt: new Date().toISOString() });
  if (!normalized) {
    showOperationNotice("自动化规则格式无效，未保存。");
    return;
  }
  const currentRule = automationRules.value.find((rule) => rule.id === payload.id);
  if (!currentRule) {
    showOperationNotice("找不到要编辑的自动化，请关闭后重新打开。");
    return;
  }
  const automaticIssue = automaticConfigurationIssue(normalized);
  if (automaticIssue) {
    showOperationNotice(`自动化未保存：${automaticIssue}`);
    return;
  }
  const rules = automationRules.value.map((rule) => rule.id === payload.id ? normalized : rule);
  const wasAutomatic = automaticRuleId.value === currentRule.id;
  if (!saveAutomationRules(rules, false)) return;
  const savedRule = automationRules.value.find((rule) => rule.id === payload.id);
  if (!savedRule) return;
  stopEditedAutomaticRule(savedRule, wasAutomatic);
  showAutomationRuleSavedNotice(savedRule, wasAutomatic);
}

function deleteAutomationRule(rule: AutomationRule) {
  if (automationBusy.value || automaticAutomationDispatching.value) return;
  if (automaticRuleId.value === rule.id) {
    showOperationNotice("此自动化正在自动执行，请先点击“结束”后再删除。");
    return;
  }
  const nextRules = automationRules.value.filter((item) => item.id !== rule.id);
  if (nextRules.length === automationRules.value.length) return;
  saveAutomationRules(nextRules);
  showOperationNotice(`已删除自动化“${rule.name}”。`);
}

async function pickAutomationDirectory(request: AutomationDirectoryPickerRequest) {
  if (automationBusy.value || automaticAutomationDispatching.value) return;
  try {
    const directory = await chooseAutomationOutputDirectory(request.directory);
    if (directory) {
      authorizedAutomationDirectories.add(automationDirectoryKey(directory));
      request.setDirectory(directory);
    }
  } catch (error) {
    showOperationNotice(`无法选择自动化导出目录：${readableActionError(error)}`);
  }
}

function automaticConfigurationIssue(rule: AutomationRule): string | null {
  const intervalSeconds = rule.intervalSeconds;
  if (intervalSeconds === null) return null;
  if (
    !Number.isSafeInteger(intervalSeconds)
    || intervalSeconds < MIN_AUTOMATION_INTERVAL_SECONDS
    || intervalSeconds > MAX_AUTOMATION_INTERVAL_SECONDS
  ) {
    return `自动执行间隔应为 ${MIN_AUTOMATION_INTERVAL_SECONDS} 到 ${MAX_AUTOMATION_INTERVAL_SECONDS} 秒之间的整数。`;
  }
  return automaticExecutionDirectoryAuthorizationIssue(rule);
}

function stopEditedAutomaticRule(rule: AutomationRule, wasAutomatic: boolean) {
  if (!wasAutomatic) return;

  const runId = runningAutomaticAutomationRuleId.value === rule.id
    ? runningAutomaticAutomationRunId
    : null;
  if (runId !== null) {
    cancelledAutomationRunIds.add(runId);
    batch.invalidateAutomationCollection();
  }
  clearAutomaticTimers();
}

function showAutomationRuleSavedNotice(rule: AutomationRule, wasAutomatic: boolean) {
  const intervalSeconds = rule.intervalSeconds;
  if (intervalSeconds !== null) {
    const stoppedNotice = wasAutomatic ? "原自动执行已停止，" : "";
    showOperationNotice(`已保存自动化“${rule.name}”，${stoppedNotice}自动执行间隔：${formatAutomaticInterval(intervalSeconds)}。请点击“启动”后开始。`);
    return;
  }
  showOperationNotice(wasAutomatic
    ? `已更新自动化“${rule.name}”，自动执行已停止。`
    : `已保存自动化“${rule.name}”。`);
}

function formatAutomaticInterval(intervalSeconds: number): string {
  if (intervalSeconds % 3600 === 0) return `${intervalSeconds / 3600} 小时`;
  if (intervalSeconds % 60 === 0) return `${intervalSeconds / 60} 分钟`;
  return `${intervalSeconds} 秒`;
}

async function startAutomaticRule(rule: AutomationRule) {
  const intervalSeconds = rule.intervalSeconds;
  if (intervalSeconds === null) return;

  // First establish a durable schedule generation. A fresh explicit start can
  // then use cycle one without being mistaken for a completed old schedule.
  clearAutomaticTimers();
  const timerRevision = automationTimerRevision;
  const automaticDashboard = dashboardEpoch;
  automaticRuleId.value = rule.id;
  automationTaskBackgrounded.value = false;
  automaticAutomationSchedules.clear();

  let scheduleStart: AutomaticAutomationScheduleStartResult;
  try {
    scheduleStart = await invoke<AutomaticAutomationScheduleStartResult>("begin_scheduled_automation_execution", {
      input: {
        ruleId: rule.id,
        updatedAt: rule.updatedAt,
      },
    });
  } catch (error) {
    if (
      timerRevision === automationTimerRevision
      && automaticRuleId.value === rule.id
      && isCurrentDashboard(automaticDashboard)
    ) {
      clearAutomaticRuleState(rule.id);
      showOperationNotice(`自动执行“${rule.name}”未启动：${readableActionError(error)}`);
    }
    return;
  }

  if (
    timerRevision !== automationTimerRevision
    || automaticRuleId.value !== rule.id
    || !isCurrentDashboard(automaticDashboard)
  ) {
    return;
  }

  const scheduleRun = beginAutomaticScheduleRun(scheduleStart.scheduleId);
  if (!scheduleRun) {
    clearAutomaticRuleState(rule.id);
    showOperationNotice(`自动执行“${rule.name}”未启动：未获得有效的调度标识。`);
    return;
  }

  // The first cycle starts immediately. Later cycles are scheduled only after
  // the preceding cycle has completed, using the configured fixed delay.
  const waitingStartedAt = Date.now();
  const waitingDurationMs = 1;
  automaticAutomationSchedules.set(rule.id, {
    fingerprint: automationTimerFingerprint(rule),
    scheduleId: scheduleRun.scheduleId,
    dueAt: waitingStartedAt + waitingDurationMs,
    waitingStartedAt,
    waitingDurationMs,
    cycle: scheduleRun.cycle,
  });
  scheduleAutomaticTimer(rule.id, waitingDurationMs);
  showOperationNotice(`已启动自动执行“${rule.name}”，正在开始首轮执行；后续每轮完成后等待 ${formatAutomaticInterval(intervalSeconds)}。`);
}

function automaticExecutionDirectoryAuthorizationIssue(rule: AutomationRule): string | null {
  for (const step of rule.steps) {
    if (step.kind !== "conditional") continue;
    for (const action of step.actions) {
      if (action.kind !== "exportAccounts" && action.kind !== "exportReport") continue;
      const directory = action.directory?.trim();
      if (!directory) return "自动化导出尚未选择保存目录。";
      if (!authorizedAutomationDirectories.has(automationDirectoryKey(directory))) {
        return "自动化导出目录需要在本次启动后重新选择一次，才能获得写入授权。请编辑该自动化并点击“选择目录”。";
      }
    }
  }
  return null;
}

function beginAutomaticAutomationDispatch(): number {
  const dispatchId = ++nextAutomaticAutomationDispatchId;
  activeAutomaticAutomationDispatchId = dispatchId;
  automaticAutomationDispatching.value = true;
  return dispatchId;
}

function endAutomaticAutomationDispatch(dispatchId: number) {
  if (activeAutomaticAutomationDispatchId !== dispatchId) return;
  activeAutomaticAutomationDispatchId = null;
  automaticAutomationDispatching.value = false;
}

function createAutomaticExecutionLeaseId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `automatic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function releaseAutomationExecutionLease(leaseId: string) {
  if (activeAutomationExecutionLeaseId === leaseId) {
    activeAutomationExecutionLeaseId = null;
  }
  try {
    await invoke("release_scheduled_automation_execution", { input: { leaseId } });
  } catch {
    // Closing the desktop process also releases its OS-backed lease. The next
    // scheduled attempt will remain safely blocked if this IPC response fails.
  }
}

function clearAutomaticTimers(clearSchedules = true) {
  automationTimerRevision += 1;
  for (const timer of automationTimers.values()) {
    clearTimeout(timer);
  }
  automationTimers.clear();
  if (clearSchedules) {
    automaticAutomationSchedules.clear();
    automaticRuleId.value = null;
    if (runningAutomationRuleId.value === null) automationTaskBackgrounded.value = false;
    activeAutomaticAutomationDispatchId = null;
    automaticAutomationDispatching.value = false;
  }
}

function clearAutomaticRuleState(ruleId: string) {
  automaticAutomationSchedules.delete(ruleId);
  if (automaticRuleId.value === ruleId) {
    automaticRuleId.value = null;
    if (runningAutomationRuleId.value === null) automationTaskBackgrounded.value = false;
  }
}

function clearAutomationState() {
  automationRunRevision += 1;
  clearAutomaticTimers();
  runningAutomaticAutomationRuleId.value = null;
  runningAutomaticAutomationRunId = null;
  automaticAutomationDispatching.value = false;
  authorizedAutomationDirectories.clear();
  batch.invalidateAutomationCollection();
  // Do not release the operation lock while an old-session export is still
  // unwinding. That prevents a new login from overlapping its local file work.
  if (activeAutomationRuns === 0) {
    automationBusy.value = false;
    accountActionBusy.value = false;
  }
  automationDialogOpen.value = false;
  automationDeleteConfirmOpen.value = false;
  pendingAutomationRunRule.value = null;
  automationRules.value = [];
}

function restartAutomaticTimers() {
  // Only an explicit user start arms the timer. Persisted settings still do
  // not revive automatically after restart because local
  // export-directory authorization is scoped to the current client session.
  // Do not rebuild while a cycle is claiming or running: a re-armed timer
  // could otherwise retry the same already-claimed cycle after it completes.
  if (automaticAutomationDispatching.value) return;
  clearAutomaticTimers(false);
  if (!dashboardHydrated || !sessionState.authenticated.value) {
    automaticRuleId.value = null;
    automationTaskBackgrounded.value = false;
    automaticAutomationSchedules.clear();
    return;
  }

  const ruleId = automaticRuleId.value;
  if (!ruleId) return;
  const rule = automationRules.value.find((item) => item.id === ruleId);
  if (!rule || !rule.enabled || rule.intervalSeconds === null || rule.intervalSeconds < MIN_AUTOMATION_INTERVAL_SECONDS) {
    automaticRuleId.value = null;
    automationTaskBackgrounded.value = false;
    automaticAutomationSchedules.clear();
    return;
  }

  const now = Date.now();
  const fingerprint = automationTimerFingerprint(rule);
  const currentSchedule = automaticAutomationSchedules.get(rule.id);
  // A missing activation is not revived after a restart. A changed activation
  // is re-armed directly by the rule-save transition above.
  if (!currentSchedule || currentSchedule.fingerprint !== fingerprint) {
    clearAutomaticRuleState(rule.id);
    return;
  }
  scheduleAutomaticTimer(rule.id, Math.max(1, currentSchedule.dueAt - now));
}

function scheduleAutomaticTimer(ruleId: string, remainingMs: number, timerRevision = automationTimerRevision) {
  const maximumDelayMs = 2_147_000_000;
  const delayMs = Math.max(1, Math.min(remainingMs, maximumDelayMs));
  const timer = setTimeout(async () => {
    if (timerRevision !== automationTimerRevision || automaticRuleId.value !== ruleId) return;
    automationTimers.delete(ruleId);
    const remaining = remainingMs - delayMs;
    if (remaining > 0) {
      scheduleAutomaticTimer(ruleId, remaining, timerRevision);
      return;
    }

    const automaticSchedule = automaticAutomationSchedules.get(ruleId);
    if (!automaticSchedule) {
      clearAutomaticRuleState(ruleId);
      return;
    }
    if (accountWorkflowBusy.value || batch.running.value || accountExportDialogOpen.value || reportDialogOpen.value) {
      // Retrying an occupied slot must retain the same cycle identity. A new
      // claim revision here would make a completed cycle indistinguishable
      // from a duplicate attempt.
      automaticSchedule.waitingStartedAt = Date.now();
      automaticSchedule.waitingDurationMs = AUTOMATIC_AUTOMATION_RETRY_MS;
      automaticSchedule.dueAt = automaticSchedule.waitingStartedAt + automaticSchedule.waitingDurationMs;
      scheduleAutomaticTimer(ruleId, AUTOMATIC_AUTOMATION_RETRY_MS, timerRevision);
      return;
    }
    const persistedRule = readAutomationRules(automationStorageScope.value).find((item) => item.id === ruleId);
    if (!persistedRule || !persistedRule.enabled || persistedRule.intervalSeconds === null) {
      clearAutomaticRuleState(ruleId);
      loadAutomationRulesForCurrentSession();
      return;
    }
    if (automaticSchedule.fingerprint !== automationTimerFingerprint(persistedRule)) {
      clearAutomaticRuleState(ruleId);
      loadAutomationRulesForCurrentSession();
      return;
    }
    const directoryAuthorizationIssue = automaticExecutionDirectoryAuthorizationIssue(persistedRule);
    if (directoryAuthorizationIssue) {
      clearAutomaticRuleState(ruleId);
      showOperationNotice(`自动执行“${persistedRule.name}”已停止：${directoryAuthorizationIssue}`);
      return;
    }

    const automaticDashboard = dashboardEpoch;
    const dispatchId = beginAutomaticAutomationDispatch();
    try {
      const leaseId = createAutomaticExecutionLeaseId();
      let claimResult: AutomationExecutionLeaseResult;
      try {
        claimResult = await invoke<AutomationExecutionLeaseResult>("claim_scheduled_automation_execution", {
          input: {
            ruleId: persistedRule.id,
            updatedAt: persistedRule.updatedAt,
            scheduleId: automaticSchedule.scheduleId,
            scheduleCycle: automaticSchedule.cycle,
            leaseId,
          },
        });
      } catch (error) {
        if (timerRevision === automationTimerRevision && isCurrentDashboard(automaticDashboard)) {
          clearAutomaticRuleState(ruleId);
          showOperationNotice(`自动执行“${persistedRule.name}”已停止：无法获得本周期执行锁。${readableActionError(error)}`);
        }
        return;
      }

      if (timerRevision !== automationTimerRevision || automaticRuleId.value !== ruleId || !isCurrentDashboard(automaticDashboard)) {
        if (claimResult.status === "claimed" && claimResult.leaseId === leaseId) {
          await releaseAutomationExecutionLease(leaseId);
        }
        return;
      }
      if (claimResult.status === "busy") {
        // Another local Sub2Bat window is running an automatic task. Keep the
        // same cycle and retry after it releases its lease instead of running
        // a different rule in parallel.
        automaticSchedule.waitingStartedAt = Date.now();
        automaticSchedule.waitingDurationMs = AUTOMATIC_AUTOMATION_RETRY_MS;
        automaticSchedule.dueAt = automaticSchedule.waitingStartedAt + automaticSchedule.waitingDurationMs;
        scheduleAutomaticTimer(ruleId, AUTOMATIC_AUTOMATION_RETRY_MS, timerRevision);
        return;
      }
      if (claimResult.status !== "claimed" || claimResult.leaseId !== leaseId) {
        clearAutomaticRuleState(ruleId);
        loadAutomationRulesForCurrentSession();
        showOperationNotice(`自动执行“${persistedRule.name}”已由另一个客户端执行，本窗口已停止以避免重复运行。`);
        return;
      }
      activeAutomationExecutionLeaseId = leaseId;
      try {
        const rule = currentAutomaticRule(ruleId, persistedRule.updatedAt);
        if (!rule) return;
        const outcome = await runAutomationRule(rule, "automatic");
        if (
          outcome === "completed"
          && timerRevision === automationTimerRevision
          && automaticRuleId.value === ruleId
          && isCurrentDashboard(automaticDashboard)
        ) {
          scheduleNextAutomaticCycle(rule, timerRevision);
        }
      } finally {
        await releaseAutomationExecutionLease(leaseId);
      }
    } finally {
      // The timer revision can change after an unrelated rule save. The
      // dispatch token, rather than that revision, identifies the state this
      // callback owns and prevents an old callback from clearing a newer one.
      endAutomaticAutomationDispatch(dispatchId);
    }
  }, delayMs);
  automationTimers.set(ruleId, timer);
}

function scheduleNextAutomaticCycle(rule: AutomationRule, timerRevision: number) {
  const intervalSeconds = rule.intervalSeconds;
  if (intervalSeconds === null || intervalSeconds < MIN_AUTOMATION_INTERVAL_SECONDS) {
    clearAutomaticRuleState(rule.id);
    return;
  }
  const currentSchedule = automaticAutomationSchedules.get(rule.id);
  if (!currentSchedule || currentSchedule.fingerprint !== automationTimerFingerprint(rule)) {
    clearAutomaticRuleState(rule.id);
    return;
  }
  // Fixed-delay scheduling: start this wait only after the entire prior run
  // has completed, so a slow cycle can never overlap the next one.
  const waitingStartedAt = Date.now();
  const waitingDurationMs = intervalSeconds * 1_000;
  const dueAt = waitingStartedAt + waitingDurationMs;
  const nextScheduleRun = nextAutomaticScheduleRun(currentSchedule);
  if (!nextScheduleRun) {
    clearAutomaticRuleState(rule.id);
    return;
  }
  automaticAutomationSchedules.set(rule.id, {
    ...currentSchedule,
    scheduleId: nextScheduleRun.scheduleId,
    dueAt,
    waitingStartedAt,
    waitingDurationMs,
    cycle: nextScheduleRun.cycle,
  });
  scheduleAutomaticTimer(rule.id, waitingDurationMs, timerRevision);
}

function currentAutomaticRule(ruleId: string, expectedUpdatedAt: string): AutomationRule | null {
  // Read storage again so another open client cannot silently change an armed
  // rule before this cycle starts.
  const persistedRules = readAutomationRules(automationStorageScope.value);
  const current = persistedRules.find((item) => item.id === ruleId);
  if (
    !current
    || current.updatedAt !== expectedUpdatedAt
    || !current.enabled
    || current.intervalSeconds === null
    || current.intervalSeconds < MIN_AUTOMATION_INTERVAL_SECONDS
  ) {
    clearAutomaticRuleState(ruleId);
    loadAutomationRulesForCurrentSession();
    return null;
  }

  return current;
}

function automationTimerFingerprint(rule: AutomationRule): string {
  return `${rule.id}:${rule.updatedAt}:${rule.intervalSeconds ?? "manual"}:${rule.enabled ? "enabled" : "paused"}`;
}

async function runAutomationRuleFromUi(rule: AutomationRule) {
  if (automaticRuleId.value === rule.id || runningAutomationRuleId.value === rule.id) {
    stopAutomationRuleFromUi(rule);
    return;
  }
  if (automationBusy.value || automaticAutomationDispatching.value) return;
  const current = automationRules.value.find((item) => item.id === rule.id);
  if (!current) {
    showOperationNotice("找不到要执行的自动化，请关闭后重新打开。");
    return;
  }
  if (automaticRuleId.value && automaticRuleId.value !== current.id) {
    showOperationNotice("当前已有其他自动化正在等待或执行，请先结束该任务后再运行此自动化。");
    return;
  }
  if (current.intervalSeconds !== null) {
    const automaticIssue = automaticConfigurationIssue(current);
    if (automaticIssue) {
      showOperationNotice(`自动执行无法启动：${automaticIssue}`);
      return;
    }
    await startAutomaticRule(current);
    return;
  }
  if (automationRuleHasDeleteAction(current)) {
    pendingAutomationRunRule.value = current;
    automationDeleteConfirmOpen.value = true;
    return;
  }
  await runManualAutomationRuleWithLease(current);
}

async function runManualAutomationRuleWithLease(rule: AutomationRule) {
  const leaseId = createAutomaticExecutionLeaseId();
  let leaseResult: AutomationExecutionLeaseResult;
  try {
    leaseResult = await invoke<AutomationExecutionLeaseResult>("acquire_automation_execution_lease", {
      input: { leaseId },
    });
  } catch (error) {
    showOperationNotice(`无法获得自动化执行锁：${readableActionError(error)}`);
    return;
  }
  if (leaseResult.status !== "claimed" || leaseResult.leaseId !== leaseId) {
    showOperationNotice("另一窗口正在执行自动化，请等待其结束后再运行。");
    return;
  }

  activeAutomationExecutionLeaseId = leaseId;
  try {
    await runAutomationRule(rule, "manual");
  } finally {
    await releaseAutomationExecutionLease(leaseId);
  }
}

function stopAutomationRuleFromUi(rule: AutomationRule) {
  const stopsAutomaticExecution = automaticRuleId.value === rule.id;
  const runId = runningAutomationRuleId.value === rule.id ? runningAutomationRunId : null;
  const stopsCurrentRun = runId !== null && !cancelledAutomationRunIds.has(runId);
  if (!stopsAutomaticExecution && !stopsCurrentRun) return;

  if (stopsCurrentRun && runId !== null) {
    cancelledAutomationRunIds.add(runId);
    // Account mutations cannot be rolled back, but the run stops before its
    // next step as soon as the current request settles.
    batch.invalidateAutomationCollection();
  }

  if (stopsAutomaticExecution) {
    const wasClaiming = automaticAutomationDispatching.value;
    clearAutomaticTimers();
    if (stopsCurrentRun) {
      showOperationNotice(`正在结束自动执行“${rule.name}”；当前请求完成后不会继续下一步或下一轮。`);
    } else if (wasClaiming) {
      showOperationNotice(`正在停止自动执行“${rule.name}”；本轮执行锁确认后不会开始任务。`);
    } else {
      showOperationNotice(`已结束自动执行“${rule.name}”；不会再启动下一轮。`);
    }
    return;
  }

  showOperationNotice(`正在结束自动化“${rule.name}”；当前请求完成后不会继续下一步。`);
}

function cancelAutomationRunConfirmation() {
  if (automationBusy.value) return;
  automationDeleteConfirmOpen.value = false;
  pendingAutomationRunRule.value = null;
}

async function confirmAutomationRun() {
  const rule = pendingAutomationRunRule.value;
  if (!rule || automationBusy.value || automaticAutomationDispatching.value) return;
  automationDeleteConfirmOpen.value = false;
  pendingAutomationRunRule.value = null;
  await runManualAutomationRuleWithLease(rule);
}

async function runAutomationRule(rule: AutomationRule, source: AutomationRunSource): Promise<AutomationRunOutcome> {
  const validation = validateAutomationRuleForSave(rule);
  if (validation) {
    if (source === "manual") {
      showOperationNotice(`自动化无法执行：${validation}`);
    } else {
      clearAutomaticRuleState(rule.id);
      showOperationNotice(`自动执行“${rule.name}”已停止：${validation}`);
    }
    return "failed";
  }
  if (source === "automatic") {
    const safetyIssue = automaticExecutionSafetyIssue(rule);
    if (safetyIssue) {
      clearAutomaticRuleState(rule.id);
      showOperationNotice(`自动执行“${rule.name}”已停止：${safetyIssue}`);
      return "failed";
    }
  }
  if (!dashboardHydrated || !sessionState.authenticated.value) {
    if (source === "automatic") clearAutomaticRuleState(rule.id);
    return "cancelled";
  }
  const ownsAutomaticDispatch = source === "automatic" && automaticAutomationDispatching.value;
  if ((accountWorkflowBusy.value || batch.running.value || accountExportDialogOpen.value || reportDialogOpen.value) && !ownsAutomaticDispatch) {
    if (source === "manual") {
      showOperationNotice("当前已有批量操作或测试正在进行，请完成后再执行自动化。");
    } else {
      clearAutomaticRuleState(rule.id);
      showOperationNotice(`自动执行“${rule.name}”已停止：执行开始前已有其他批量操作占用。`);
    }
    return "failed";
  }

  const runId = ++nextAutomationRunId;
  automationRunEpochs.set(runId, automationRunRevision);
  const dashboardRequest = dashboardEpoch;
  const outcomes: string[] = [];
  runningAutomationRuleId.value = rule.id;
  runningAutomationRunId = runId;
  if (source === "manual") automationTaskBackgrounded.value = false;
  if (source === "automatic") {
    runningAutomaticAutomationRuleId.value = rule.id;
    runningAutomaticAutomationRunId = runId;
  }
  activeAutomationRuns += 1;
  automationBusy.value = true;
  accountActionBusy.value = true;
  try {
    for (const step of rule.steps) {
      if (!isAutomationRunCurrent(runId, dashboardRequest)) return "cancelled";
      if (step.kind === "refresh") {
        const refreshed = await refreshAccounts("automation");
        if (!isAutomationRunCurrent(runId, dashboardRequest)) return "cancelled";
        if (!refreshed) throw new Error("刷新账号数据失败。");
        outcomes.push("已刷新账号数据");
        continue;
      }

      const snapshot = await batch.collectAutomationAccounts(
        automationAccountCollectionQuery(step),
        MAX_AUTOMATION_ACCOUNT_SCOPE,
      );
      if (!isAutomationRunCurrent(runId, dashboardRequest)) return "cancelled";
      if (snapshot === null) throw new Error("读取自动执行账号范围已取消。");
      // A condition step is a branch: resolve its target set after all prior
      // steps, then apply that branch's ordered actions to the same accounts.
      const matchedAccounts = filterAccountsForAutomation(snapshot, step.condition, {
        testStates: batch.testStates.value,
      });
      for (const action of step.actions) {
        if (!isAutomationRunCurrent(runId, dashboardRequest)) return "cancelled";
        const actionAccounts = filterAccountsForAutomationAction(matchedAccounts, action, {
          testStates: batch.testStates.value,
        });
        outcomes.push(await executeAutomationAction(action, actionAccounts, dashboardRequest, runId, source));
      }
    }

    if (!isAutomationRunCurrent(runId, dashboardRequest)) return "cancelled";
    const refreshed = await refreshAccounts("automation");
    if (!isAutomationRunCurrent(runId, dashboardRequest)) return "cancelled";
    if (!refreshed) throw new Error("操作完成后刷新账号列表失败。");
    if (source === "manual") {
      showOperationNotice(`自动化“${rule.name}”已完成：${outcomes.join("；") || "没有可执行的账号"}`);
    } else {
      showOperationNotice(`自动执行“${rule.name}”本次已完成；执行间隔：${formatAutomaticInterval(rule.intervalSeconds ?? MIN_AUTOMATION_INTERVAL_SECONDS)}。${outcomes.join("；") || "没有可执行的账号"}`);
    }
    return "completed";
  } catch (error) {
    if (isAutomationRunCurrent(runId, dashboardRequest)) {
      if (source === "automatic") {
        clearAutomaticRuleState(rule.id);
        showOperationNotice(`自动执行“${rule.name}”未完成，已停止：${readableActionError(error)}`);
      } else {
        showOperationNotice(`自动化未完成“${rule.name}”：${readableActionError(error)}`);
      }
      return "failed";
    }
    return "cancelled";
  } finally {
    if (source === "automatic" && runningAutomaticAutomationRunId === runId) {
      runningAutomaticAutomationRuleId.value = null;
      runningAutomaticAutomationRunId = null;
    }
    if (runningAutomationRunId === runId) {
      runningAutomationRuleId.value = null;
      runningAutomationRunId = null;
    }
    automationRunEpochs.delete(runId);
    cancelledAutomationRunIds.delete(runId);
    activeAutomationRuns = Math.max(0, activeAutomationRuns - 1);
    if (activeAutomationRuns === 0) {
      automationBusy.value = false;
      accountActionBusy.value = false;
    }
  }
}

/** Automatic deletion is intentionally narrower than an explicitly manual run. */
function automaticExecutionSafetyIssue(rule: AutomationRule): string | null {
  for (const step of rule.steps) {
    if (step.kind !== "conditional") continue;
    for (const action of step.actions) {
      if (action.kind !== "deleteAccounts") continue;
      if (action.targetStatuses.some((status) => status !== "error" && status !== "inactive")) {
        return "自动执行删除仅允许错误或停用账号；请改为手动执行，或取消其他删除状态。";
      }
    }
  }
  return null;
}

function automationRuleHasDeleteAction(rule: AutomationRule): boolean {
  return rule.steps.some((step) => step.kind === "conditional" && step.actions.some((action) => action.kind === "deleteAccounts"));
}

function automationProtectedDeleteStatuses(rule: AutomationRule | null): AutomationDeleteStatus[] {
  if (!rule) return [];
  const protectedStatuses = new Set<AutomationDeleteStatus>();
  for (const step of rule.steps) {
    if (step.kind !== "conditional") continue;
    for (const action of step.actions) {
      if (action.kind !== "deleteAccounts") continue;
      for (const status of action.targetStatuses) {
        if (status !== "error" && status !== "inactive") protectedStatuses.add(status);
      }
    }
  }
  return [...protectedStatuses];
}

function isAutomationRunCurrent(runId: number, dashboardRequest: number) {
  return automationRunEpochs.get(runId) === automationRunRevision
    && !cancelledAutomationRunIds.has(runId)
    && isCurrentDashboard(dashboardRequest);
}

function requireCurrentAutomationRun(runId: number, dashboardRequest: number) {
  if (!isAutomationRunCurrent(runId, dashboardRequest)) {
    throw new Error("自动化执行已取消。");
  }
}

async function executeAutomationAction(
  action: AutomationAction,
  accounts: readonly Account[],
  dashboardRequest: number,
  runId: number,
  source: AutomationRunSource,
): Promise<string> {
  const accountIds = automationAccountIds(accounts);
  if (!accountIds.length) return `${automationActionLabel(action)}：没有符合条件的账号`;

  switch (action.kind) {
    case "moveGroup": {
      if (action.groupId === null) throw new Error("移动操作未设置目标分组。");
      const targetGroup = await resolveAutomationTargetGroup(action.groupId, dashboardRequest, runId);
      if (!targetGroup) return "移动到分组：操作已取消";
      const targetPlatform = normalizePlatformKey(targetGroup.platform);
      if (!targetPlatform) throw new Error("目标分组未返回平台信息，无法安全移动账号。");
      const compatibleAccounts = accounts.filter((account) => normalizePlatformKey(account.platform) === targetPlatform);
      const compatibleIds = automationAccountIds(compatibleAccounts);
      if (compatibleIds.length !== accountIds.length) {
        throw new Error("自动化移动范围包含跨平台账号，已拒绝执行。请编辑规则并添加与目标分组一致的平台条件。");
      }
      const result = await invoke<AccountOperationResult>("move_accounts_to_group", {
        input: { accountIds: compatibleIds, groupId: targetGroup.id },
      });
      requireCurrentAutomationRun(runId, dashboardRequest);
      ensureAutomationOperationSucceeded(`移动到分组“${targetGroup.name}”`, result, compatibleIds.length);
      return `已移动 ${compatibleIds.length} 个账号到“${targetGroup.name}”`;
    }
    case "deleteAccounts": {
      const currentDeleteAccounts = source === "automatic"
        ? accounts.filter((account) => {
          const status = getAccountRuntimeStatus(account);
          return (status === "error" && action.targetStatuses.includes("error"))
            || (status === "inactive" && action.targetStatuses.includes("inactive"));
        })
        : accounts;
      const currentDeleteIds = automationAccountIds(currentDeleteAccounts);
      if (!currentDeleteIds.length) {
        return source === "automatic"
          ? "删除账号：没有当前仍为错误或停用的账号"
          : "删除账号：没有符合条件的账号";
      }
      const result = await invoke<AccountOperationResult>("delete_accounts", {
        input: {
          accountIds: currentDeleteIds,
          // An error/inactive-only rule is fail-closed for both manual and
          // automatic execution. Rules that deliberately include protected
          // statuses still use the explicit manual double-confirmation path.
          ...(action.targetStatuses.every((status) => status === "error" || status === "inactive")
            ? { requiredStatuses: [...action.targetStatuses] }
            : {}),
        },
      });
      requireCurrentAutomationRun(runId, dashboardRequest);
      removeDeletedAccountState(confirmedAutomationSuccessIds(result, currentDeleteIds));
      ensureAutomationOperationSucceeded("删除账号", result, currentDeleteIds.length);
      return `已删除 ${currentDeleteIds.length} 个账号`;
    }
    case "setPriority": {
      if (action.priority === null || !Number.isSafeInteger(action.priority) || action.priority < 0) {
        throw new Error("自动化优先级必须是非负整数。");
      }
      const result = await invoke<AccountOperationResult>("set_accounts_priority", {
        input: { accountIds, priority: action.priority },
      });
      requireCurrentAutomationRun(runId, dashboardRequest);
      ensureAutomationOperationSucceeded("设置优先级", result, accountIds.length);
      return `已将 ${accountIds.length} 个账号的优先级设为 ${action.priority}`;
    }
    case "setConcurrency": {
      if (action.concurrency === null || !Number.isSafeInteger(action.concurrency) || action.concurrency < 0) {
        throw new Error("自动化账号并发必须是非负整数。");
      }
      const result = await invoke<AccountOperationResult>("set_accounts_concurrency", {
        input: { accountIds, concurrency: action.concurrency },
      });
      requireCurrentAutomationRun(runId, dashboardRequest);
      ensureAutomationOperationSucceeded("设置账号并发", result, accountIds.length);
      return `已将 ${accountIds.length} 个账号的并发设为 ${action.concurrency}`;
    }
    case "rename": {
      const renamedAccounts = accounts.map((account, index) => ({
        accountId: account.id,
        name: renderAutomationRename(action.template, account, index, action.startIndex, action.padding),
      }));
      if (renamedAccounts.some((account) => !account.name)) {
        throw new Error("重命名模板生成了空名称，请修改模板后重试。");
      }
      const result = await invoke<AccountOperationResult>("rename_accounts", { input: { accounts: renamedAccounts } });
      requireCurrentAutomationRun(runId, dashboardRequest);
      ensureAutomationOperationSucceeded("批量重命名", result, renamedAccounts.length);
      return `已重命名 ${renamedAccounts.length} 个账号`;
    }
    case "exportAccounts": {
      requireAutomationDirectoryAuthorization(action.directory);
      const data = await invoke<unknown>("export_accounts_data", {
        input: { accountIds, includeProxies: action.includeProxies },
      });
      requireCurrentAutomationRun(runId, dashboardRequest);
      const extension = action.format === "cpa" ? "zip" : "json";
      const fileName = formatExportFileName(action.fileNameTemplate, {
        count: accountIds.length,
        format: action.format,
        extension,
      });
      if (action.format === "cpa") {
        const archive = await buildCpaArchive(data);
        requireCurrentAutomationRun(runId, dashboardRequest);
        const path = await writeAutomationExportFile({ directory: action.directory, fileName, contents: archive.archive });
        requireCurrentAutomationRun(runId, dashboardRequest);
        const skipped = archive.skipped.length ? `，跳过 ${archive.skipped.length} 个` : "";
        return `已导出 CPA：${getExportFileName(path)}（${archive.convertedCount} 个${skipped}）`;
      }
      const contents = await buildOfficialAccountExportJson(data);
      requireCurrentAutomationRun(runId, dashboardRequest);
      const path = await writeAutomationExportFile({
        directory: action.directory,
        fileName,
        contents,
      });
      requireCurrentAutomationRun(runId, dashboardRequest);
      return `已导出账号：${getExportFileName(path)}`;
    }
    case "exportReport": {
      requireAutomationDirectoryAuthorization(action.directory);
      const fileName = formatExportFileName(action.fileNameTemplate, {
        count: accountIds.length,
        format: "xlsx",
        extension: "xlsx",
      });
      const workbook = await buildBatchReportWorkbook({
        accounts: [...accounts],
        testStates: batch.testStates.value,
        columns: action.columns,
      });
      requireCurrentAutomationRun(runId, dashboardRequest);
      const path = await writeAutomationExportFile({ directory: action.directory, fileName, contents: workbook });
      requireCurrentAutomationRun(runId, dashboardRequest);
      return `已导出测活报告：${getExportFileName(path)}`;
    }
  }
}

function automationDirectoryKey(directory: string): string {
  return directory.trim().toLocaleLowerCase();
}

function requireAutomationDirectoryAuthorization(directory: string) {
  const key = automationDirectoryKey(directory);
  if (!key) throw new Error("自动化导出尚未选择保存目录。");
  if (!authorizedAutomationDirectories.has(key)) {
    throw new Error("自动化导出目录需要在本次启动后重新选择一次，才能获得写入授权。请编辑该自动化并点击“选择目录”。");
  }
}

async function resolveAutomationTargetGroup(groupId: number, dashboardRequest: number, runId: number): Promise<AccountGroup | null> {
  let target = groups.value.find((group) => group.id === groupId);
  if (target) return target;
  const loaded = await loadGroups(dashboardRequest);
  if (!loaded || !isAutomationRunCurrent(runId, dashboardRequest)) return null;
  target = groups.value.find((group) => group.id === groupId);
  if (!target) throw new Error("未找到自动化设置的目标分组，请编辑规则后重新选择分组。");
  return target;
}

function automationAccountIds(accounts: readonly Account[]): number[] {
  const ids = new Set<number>();
  for (const account of accounts) {
    if (Number.isSafeInteger(account.id) && account.id > 0) ids.add(account.id);
  }
  return [...ids];
}

/**
 * Push only exact predicates represented by the official account-list API.
 * Remaining predicates are still evaluated locally against the full returned
 * candidate range, so no derived runtime status is incorrectly omitted.
 */
function automationAccountCollectionQuery(step: AutomationConditionalStep): Omit<AccountPageRequest, "page" | "pageSize"> {
  const query: Omit<AccountPageRequest, "page" | "pageSize"> = {};
  // A mixed expression cannot be represented by the official list API. Keep
  // its candidate set broad and apply the exact expression locally.
  if (step.condition.children.some((node, index) => (
    node.kind !== "condition" || (index > 0 && node.joinWithPrevious !== "and")
  ))) return query;

  for (const node of step.condition.children) {
    if (node.kind !== "condition" || node.operator !== "equals" || typeof node.value !== "string") continue;
    const value = node.value.trim();
    if (!value) continue;
    if (node.field === "platform") query.platform = value;
    if (node.field === "accountType") query.accountType = value;
    if (node.field === "group") {
      const groupId = groupIdFromAutomationConditionValue(value);
      if (groupId !== null) query.groupId = groupId;
      if (value === AUTOMATION_UNGROUPED_GROUP_VALUE) query.ungrouped = true;
    }
  }
  return query;
}

function automationStepPlatformConstraint(step: AutomationConditionalStep): string | null {
  return getAutomationConditionPlatformConstraint(step.condition);
}

function ensureAutomationOperationSucceeded(actionName: string, result: AccountOperationResult, attempted: number) {
  const succeeded = Math.max(0, Math.min(attempted, Number.isSafeInteger(result.success) ? result.success : 0));
  const failed = Math.max(0, Number.isSafeInteger(result.failed) ? result.failed : 0);
  const unconfirmed = Math.max(0, attempted - succeeded - failed);
  if (succeeded !== attempted || failed > 0 || unconfirmed > 0) {
    throw new Error(`${actionName}仅完成 ${succeeded} 个账号；${failed} 个失败，${unconfirmed} 个未获得服务端确认。`);
  }
}

/** Clears only IDs the server has actually confirmed as deleted. */
function confirmedAutomationSuccessIds(result: AccountOperationResult, attemptedAccountIds: readonly number[]): number[] {
  return resolveAccountOperation(result, attemptedAccountIds).completedIds;
}

function automationActionLabel(action: AutomationAction): string {
  switch (action.kind) {
    case "moveGroup": return "移动到分组";
    case "deleteAccounts": return "删除账号";
    case "setPriority": return "设置优先级";
    case "setConcurrency": return "设置账号并发";
    case "rename": return "批量重命名";
    case "exportAccounts": return "导出账号";
    case "exportReport": return "导出测活报告";
  }
}

function closeAccountExportDialog() {
  if (accountExportBusy.value) return;
  accountExportDialogOpen.value = false;
  accountExportError.value = null;
  accountExportAccountIds.value = [];
  accountExportDirectory.value = "";
}

async function exportAccounts(payload: { fileName: string; includeProxies: boolean; format: AccountExportFormat }) {
  if (!accountExportAccountIds.value.length || accountExportBusy.value) return;
  if (!accountExportDirectory.value.trim()) {
    accountExportError.value = "请先选择保存目录。";
    return;
  }
  if (automationBusy.value || accountActionBusy.value || reportBusy.value) {
    accountExportError.value = "当前有其他批量操作正在执行，请完成后再导出账号。";
    return;
  }

  accountExportBusy.value = true;
  accountExportError.value = null;
  const dashboardRequest = dashboardEpoch;
  const accountIds = [...accountExportAccountIds.value];
  const directory = accountExportDirectory.value.trim();
  try {
    const data = await invoke<unknown>("export_accounts_data", {
      input: {
        accountIds,
        includeProxies: payload.includeProxies,
      },
    });
    if (!isCurrentDashboard(dashboardRequest)) return;

    let contents: string | Uint8Array;
    let successNotice: string;
    if (payload.format === "cpa") {
      const result = await buildCpaArchive(data);
      contents = result.archive;
      const skippedText = result.skipped.length ? `，已转换 ${result.convertedCount} 个，跳过 ${result.skipped.length} 个` : `，共 ${result.convertedCount} 个账号`;
      successNotice = `CPA 已导出：${skippedText}`;
    } else {
      contents = await buildOfficialAccountExportJson(data);
      successNotice = "账号已导出：";
    }
    if (!isCurrentDashboard(dashboardRequest)) return;

    const savedPath = await writeExportFileInDirectory({ directory, fileName: payload.fileName, contents });
    if (!isCurrentDashboard(dashboardRequest)) return;

    showOperationNotice(payload.format === "cpa"
      ? `${successNotice.replace("：", `：${getExportFileName(savedPath)}`)}`
      : `${successNotice}${getExportFileName(savedPath)}`);

    accountExportDialogOpen.value = false;
    accountExportAccountIds.value = [];
    accountExportDirectory.value = "";
  } catch (error) {
    accountExportError.value = readableActionError(error);
  } finally {
    accountExportBusy.value = false;
  }
}

function closeReportDialog() {
  if (reportBusy.value) return;
  reportDialogOpen.value = false;
  reportError.value = null;
  reportAccountIds.value = [];
  reportDirectory.value = "";
  reportPhase.value = "idle";
}

function requestReportTestCancel() {
  if (reportPhase.value !== "testing" || !batch.running.value) return;
  requestBatchCancel();
}

async function generateReport(payload: { columns: string[]; fileName: string; testBeforeExport: boolean }) {
  if (!reportAccountIds.value.length || reportBusy.value) return;
  if (!reportDirectory.value.trim()) {
    reportError.value = "请先选择保存目录。";
    return;
  }
  if (automationBusy.value || accountActionBusy.value || accountExportBusy.value || batch.running.value) {
    reportError.value = "当前有其他批量操作正在执行，请完成后再导出测活报告。";
    return;
  }

  reportBusy.value = true;
  reportPhase.value = "idle";
  reportError.value = null;
  const dashboardRequest = dashboardEpoch;
  const accountIds = [...reportAccountIds.value];
  const directory = reportDirectory.value.trim();
  try {
    const accountsForReport = [...reportAccounts.value];
    if (accountsForReport.length !== accountIds.length) {
      throw new Error("部分已选账号已不在当前列表中，请关闭后重新打开报告。");
    }
    if (accountsForReport.length > MAX_BATCH_REPORT_ROWS) {
      throw new Error(`一次最多导出 ${MAX_BATCH_REPORT_ROWS.toLocaleString()} 个账号的测活报告。请分批导出。`);
    }

    let testStates = { ...batch.testStates.value };
    if (payload.testBeforeExport) {
      if (!modelId.value.trim()) {
        throw new Error("请先选择测试模型后再执行导出前测试。");
      }
      reportPhase.value = "testing";
      const result = await batch.startAndWaitForCompletion(
        accountIds,
        modelId.value,
        concurrency.value,
        countSelectedInactiveAccounts(accountIds),
      );
      if (!result || !isCurrentDashboard(dashboardRequest)) return;
      if (result.completion.cancelled > 0) {
        reportError.value = "本次测试已取消，未生成报告。";
        return;
      }
      testStates = result.testStates;
    }

    if (!isCurrentDashboard(dashboardRequest)) return;
    reportPhase.value = "exporting";
    const workbook = await buildBatchReportWorkbook({
      accounts: accountsForReport,
      testStates,
      columns: payload.columns,
    });
    if (!isCurrentDashboard(dashboardRequest)) return;
    const savedPath = await writeExportFileInDirectory({
      directory,
      fileName: payload.fileName,
      contents: workbook,
    });
    if (!isCurrentDashboard(dashboardRequest)) return;

    showOperationNotice(`报告已生成：${getExportFileName(savedPath)}`);
    reportDialogOpen.value = false;
    reportAccountIds.value = [];
    reportDirectory.value = "";
  } catch (error) {
    reportError.value = readableActionError(error);
  } finally {
    reportBusy.value = false;
    reportPhase.value = "idle";
  }
}

async function finishAccountOperation(
  result: AccountOperationResult,
  actionName: string,
  errorTarget: { value: string | null },
  closeDialog: () => void,
  attemptedAccountIds: readonly number[] = pendingAccountIds.value,
  dashboardRequest = dashboardEpoch,
  outcomeNotice?: string | null,
) {
  if (!isCurrentDashboard(dashboardRequest)) return;
  const resolution = resolveAccountOperation(result, attemptedAccountIds);
  const attemptedIds = resolution.attemptedIds;
  const failedIds = new Set(resolution.failedIds);
  const completedIds = new Set(resolution.completedIds);

  removeSelectedAccounts([...completedIds]);
  pendingAccountIds.value = attemptedIds.filter((accountId) => !completedIds.has(accountId));

  let refreshWarning = "";
  if (completedIds.size > 0) {
    const accountsReloaded = await reloadAccounts(dashboardRequest).catch(() => false);
    const groupsReloaded = await loadGroups(dashboardRequest);
    // Account mutations can change the global type set. Keep the visible-page
    // fallback until the user next opens the account-type picker.
    invalidatePlanTypeCatalog();
    if (!accountsReloaded || !groupsReloaded) {
      refreshWarning = "操作已完成，但列表刷新失败，请手动刷新后确认最新数据。";
    }
  }

  if (!isCurrentDashboard(dashboardRequest)) return;

  if (pendingAccountIds.value.length > 0) {
    const failedCount = attemptedIds.filter((accountId) => failedIds.has(accountId)).length;
    const unconfirmedCount = pendingAccountIds.value.length - failedCount;
    const notice = outcomeNotice?.trim() ? ` ${outcomeNotice.trim()}` : "";
    errorTarget.value = unconfirmedCount > 0
      ? `${actionName}完成 ${completedIds.size} 个账号；${failedCount} 个失败，${unconfirmedCount} 个未获得服务端确认。${notice}`
      : `${actionName}完成 ${completedIds.size} 个账号，${failedCount} 个账号未完成。${notice}`;
    return;
  }

  const notice = outcomeNotice?.trim() ? ` ${outcomeNotice.trim()}` : "";
  showOperationNotice(`${actionName}成功：已处理 ${completedIds.size} 个账号。${refreshWarning}${notice}`);
  closeDialog();
  pendingAccountIds.value = [];
}

function showOperationNotice(message: string) {
  operationNotice.value = message;
  if (operationNoticeTimer) clearTimeout(operationNoticeTimer);
  operationNoticeTimer = setTimeout(() => {
    operationNotice.value = null;
  }, 5_000);
}

function dismissOperationNotice() {
  operationNotice.value = null;
  if (operationNoticeTimer) clearTimeout(operationNoticeTimer);
  operationNoticeTimer = undefined;
}

function readableActionError(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "请检查网络和登录状态后重试。";
}

async function openModels() {
  const dashboardRequest = dashboardEpoch;
  const scopeKey = modelScopeIdentity.value;
  batch.batchError.value = null;
  try {
    if (modelScope.value.length) {
      await loadModelsForScope(modelScope.value, scopeKey, false, dashboardRequest);
      return;
    }

    if (latestTestFilterActive.value) {
      if (!latestTestScopeReady.value) {
        const loaded = await loadLatestTestScope(dashboardRequest);
        if (!loaded) return;
      }
      const filteredAccountIds = latestTestFilteredAccounts.value.map((account) => account.id);
      if (!filteredAccountIds.length) {
        batch.batchError.value = "当前最新测试筛选条件下没有账号。";
        return;
      }
      await loadModelsForScope(
        filteredAccountIds,
        scopeKey,
        false,
        dashboardRequest,
        () => latestTestScopeReady.value && modelScopeIdentity.value === scopeKey,
      );
      return;
    }

    if (!globalSelectionEnabled.value) {
      batch.batchError.value = "当前筛选包含仅当前页可判断的条件，无法统计完整账号范围。请先选择账号，或清除这些筛选后重试。";
      return;
    }

    await loadModelsForFilteredScope(dashboardRequest);
  } catch (error) {
    if (isCurrentDashboard(dashboardRequest) && modelScopeIdentity.value === scopeKey) {
      batch.batchError.value = readableActionError(error);
    }
  }
}

async function loadModelsForFilteredScope(dashboardRequest = dashboardEpoch) {
  const scopeKey = modelScopeIdentity.value;
  const hasCurrentOptions = lastModelScope.value === scopeKey && batch.modelCatalog.value.options.length > 0;
  if (!shouldLoadModelScope(lastModelScope.value, scopeKey, hasCurrentOptions, false)) {
    return batch.modelCatalog.value;
  }
  const collectionRequest = ++modelScopeCollectionRequest;
  // This is an explicit refresh for the unselected, full filtered range.
  // Clear a previous catalog before the potentially multi-page ID lookup.
  modelScopeRequest += 1;
  batch.invalidateModelScopeCollection();
  batch.invalidateModels();
  lastModelScope.value = "";
  modelScopeResolving.value = true;
  try {
    const accountIds = await batch.collectModelScopeAccountIds(accountListQuery(), MAX_MODEL_SCOPE_ACCOUNTS);
    const scopeStillCurrent = () => (
      collectionRequest === modelScopeCollectionRequest
      && !modelScope.value.length
      && isCurrentDashboard(dashboardRequest)
      && modelScopeIdentity.value === scopeKey
    );
    if (!accountIds || !scopeStillCurrent()) return null;

    return loadModelsForScope(
      accountIds,
      scopeKey,
      false,
      dashboardRequest,
      scopeStillCurrent,
    );
  } finally {
    if (collectionRequest === modelScopeCollectionRequest) {
      modelScopeResolving.value = false;
    }
  }
}

async function loadModelsForScope(
  accountIds: number[],
  scopeKey: string,
  force: boolean,
  dashboardRequest = dashboardEpoch,
  scopeGuard: () => boolean = () => modelScopeIdentity.value === scopeKey,
) {
  const scope = normalizeModelScope(accountIds);
  const request = ++modelScopeRequest;
  if (!scope.key || !isCurrentDashboard(dashboardRequest) || !scopeGuard()) return null;
  if (scope.accountIds.length > MAX_MODEL_SCOPE_ACCOUNTS) {
    batch.batchError.value = `一次最多读取 ${MAX_MODEL_SCOPE_ACCOUNTS} 个账号的测试模型，请缩小范围后重试。`;
    return null;
  }
  const hasCurrentOptions = lastModelScope.value === scopeKey && batch.modelCatalog.value.options.length > 0;
  if (!shouldLoadModelScope(lastModelScope.value, scopeKey, hasCurrentOptions, force)) return null;

  const canPublish = () => (
    request === modelScopeRequest
    && isCurrentDashboard(dashboardRequest)
    && scopeGuard()
  );
  let catalog: ModelCatalog | null = null;
  if (scope.accountIds.length <= MODEL_CATALOG_REQUEST_CHUNK_SIZE) {
    catalog = await batch.loadModels(scope.accountIds, canPublish);
  } else {
    let merged: ModelCatalog | null = null;
    for (let start = 0; start < scope.accountIds.length; start += MODEL_CATALOG_REQUEST_CHUNK_SIZE) {
      const chunk = scope.accountIds.slice(start, start + MODEL_CATALOG_REQUEST_CHUNK_SIZE);
      const loaded = await batch.loadModels(chunk, canPublish);
      if (!loaded || !canPublish()) return null;
      merged = mergeModelCatalogChunk(merged, loaded, scope.accountIds.length);
      // Keep the already-read portion available to the open picker while the
      // remaining bounded chunks continue in the background.
      batch.modelCatalog.value = merged;
    }
    catalog = merged;
  }
  if (
    !catalog
    || request !== modelScopeRequest
    || !isCurrentDashboard(dashboardRequest)
    || !scopeGuard()
  ) return null;

  lastModelScope.value = scopeKey;
  modelId.value = resolveAvailableModelId(catalog.options, modelId.value);
  return catalog;
}

function mergeModelCatalogChunk(
  current: ModelCatalog | null,
  next: ModelCatalog,
  requestedAccounts: number,
): ModelCatalog {
  const optionsById = new Map<string, ModelOption>();
  const optionOrder: string[] = [];
  const merge = (option: ModelOption) => {
    const previous = optionsById.get(option.id);
    if (!previous) {
      optionsById.set(option.id, {
        ...option,
        requestedAccounts,
        unknownAccounts: 0,
      });
      optionOrder.push(option.id);
      return;
    }
    previous.availableOn += option.availableOn;
    // A non-ID display name carries more information than the fallback name.
    if (previous.displayName === previous.id && option.displayName !== option.id) {
      previous.displayName = option.displayName;
    }
  };

  for (const option of current?.options ?? []) merge(option);
  for (const option of next.options) merge(option);
  const unknownAccounts = (current?.unknownAccounts ?? 0) + next.unknownAccounts;
  return {
    options: optionOrder.map((id) => ({
      ...optionsById.get(id)!,
      requestedAccounts,
      unknownAccounts,
    })),
    unknownAccounts,
  };
}

async function startSelected() {
  if (accountWorkflowBusy.value) {
    showOperationNotice("当前有批量操作正在执行，请完成后再开始测试。");
    return;
  }
  await startBatch(selectedIds.value);
}

function requestBatchCancel() {
  if (!batch.running.value) return;
  batchCancelConfirmOpen.value = true;
}

async function confirmBatchCancel() {
  batchCancelConfirmOpen.value = false;
  await batch.cancel();
}

async function setDefaultModel(nextModelId: string) {
  nextModelId = nextModelId.trim();
  if (!nextModelId) return;

  modelId.value = nextModelId;
  try {
    await sessionState.setDefaultModel(nextModelId);
  } catch {
    // The session composable restores the previous default and records the error.
  }
}

async function setDefaultConcurrency(nextConcurrency: number) {
  if (![5, 10, 20, 50, 100].includes(nextConcurrency)) return;

  concurrency.value = nextConcurrency;
  try {
    await sessionState.setDefaultConcurrency(nextConcurrency);
  } catch {
    // The session composable restores the previous default and records the error.
  }
}

async function setAutoRefreshSeconds(nextSeconds: number) {
  try {
    await sessionState.setAutoRefreshSeconds(nextSeconds);
  } catch {
    // The session composable restores the previous setting and records the error.
  }
}

async function startBatch(accountIds: number[]) {
  if (accountWorkflowBusy.value || latestTestScopeLoading.value) {
    showOperationNotice("当前有批量操作正在执行，请完成后再开始测试。");
    return;
  }
  if (!modelId.value.trim()) {
    showOperationNotice("请先选择测试模型。");
    return;
  }
  try {
    await batch.start(accountIds, modelId.value, concurrency.value, countSelectedInactiveAccounts(accountIds));
  } catch {
    // The error band below provides the recovery message.
  }
}

async function refreshAccounts(mode: RefreshMode = "manual"): Promise<boolean> {
  const dashboardRequest = dashboardEpoch;
  if (!isCurrentDashboard(dashboardRequest)) {
    return false;
  }
  if (refreshInFlight) return refreshInFlight;
  if ((batch.loadingAccounts.value && mode !== "automation") || (mode === "automatic" && batch.running.value) || (accountWorkflowBusy.value && mode !== "automation")) {
    return false;
  }

  const task = (async () => {
    try {
      // Filter menus need fresh account and group values without reloading model metadata.
      const [accountsReloaded, groupsReloaded] = await Promise.all([
        mode === "manual" || mode === "automation" ? reloadAccounts(dashboardRequest) : reloadAccountsLightweight(dashboardRequest),
        loadGroups(dashboardRequest),
      ]);
      if ((mode === "manual" || mode === "automation") && accountsReloaded && isCurrentDashboard(dashboardRequest)) {
        // Refreshing account data can change the global labels, but never
        // start the full label scan until a user opens a dependent picker.
        invalidatePlanTypeCatalog();
      }
      // A latest-test view requires a full scoped scan. Do not repeat that
      // potentially large scan on every short automatic refresh interval.
      const latestTestReloaded = latestTestFilterActive.value && mode !== "automatic"
        ? await loadLatestTestScope(dashboardRequest)
        : true;
      return Boolean(accountsReloaded && groupsReloaded && latestTestReloaded && isCurrentDashboard(dashboardRequest));
    } catch {
      // The error band below provides the recovery message.
      return false;
    }
  })();
  refreshInFlight = task;
  try {
    return await task;
  } finally {
    if (refreshInFlight === task) {
      refreshInFlight = null;
    }
  }
}

function countSelectedInactiveAccounts(accountIds: readonly number[]): number {
  const visibleAccounts = accountsOnCurrentPageById();
  let inactive = 0;
  for (const accountId of accountIds) {
    const account = selectedAccountMetadata.value[accountId] ?? visibleAccounts.get(accountId);
    if (account && getAccountRuntimeStatus(account) === "inactive") inactive += 1;
  }
  return inactive;
}

function refreshFilterOptions() {
  return refreshAccounts("filter");
}

function clearAutoRefreshTimer() {
  if (!autoRefreshTimer) return;
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = undefined;
}

function restartAutoRefreshTimer() {
  clearAutoRefreshTimer();

  const seconds = sessionState.preferences.value.autoRefreshSeconds;
  if (!dashboardHydrated || !sessionState.authenticated.value || !Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
    return;
  }

  autoRefreshTimer = setInterval(() => {
    void refreshAccounts("automatic");
  }, seconds * 1_000);
}

watch(
  [() => sessionState.authenticated.value, () => sessionState.preferences.value.autoRefreshSeconds],
  restartAutoRefreshTimer,
  { immediate: true },
);

watch(
  () => sessionState.authenticated.value,
  (authenticated, wasAuthenticated) => {
    if (!authenticated && wasAuthenticated) {
      clearDashboardAfterSessionEnded();
    }
  },
);

onBeforeUnmount(() => {
  unlistenCloseRequested?.();
  stopAutomaticTaskProgressTimer();
  clearAutoRefreshTimer();
  invalidateLatestTestScope();
  // This also invalidates an in-flight automatic run after its current request
  // returns, so closing the window cannot advance to another action or cycle.
  clearAutomationState();
  clearAccountFilterReloadTimer();
  dismissOperationNotice();
});

function clearDashboardAfterSessionEnded() {
  clearAutoRefreshTimer();
  clearAutomationState();
  clearAccountFilterReloadTimer();
  accountFilterRevision += 1;
  accountFilterTransition.value = false;
  dashboardHydrated = false;
  invalidateDashboardRequests();
  latestTestFilter.value = "all";
  dismissOperationNotice();
  clearSelectedAccounts();
  pendingAccountIds.value = [];
  groups.value = [];
  moveGroups.value = [];
  groupLoadError.value = null;
  deleteDialogOpen.value = false;
  moveDialogOpen.value = false;
  priorityDialogOpen.value = false;
  accountConcurrencyDialogOpen.value = false;
  renameDialogOpen.value = false;
  accountExportDialogOpen.value = false;
  accountExportAccountIds.value = [];
  accountExportDirectory.value = "";
  accountExportDirectoryPickerBusy.value = false;
  reportDialogOpen.value = false;
  reportAccountIds.value = [];
  reportDirectory.value = "";
  reportPhase.value = "idle";
  reportDirectoryPickerBusy.value = false;
  batchCancelConfirmOpen.value = false;
  if (activeAutomationRuns === 0) accountActionBusy.value = false;
  batch.accounts.value = [];
  accountPageNumber.value = 1;
  batch.resetTestResults();
}

async function handleLogout() {
  clearAutoRefreshTimer();
  clearAutomationState();
  clearAccountFilterReloadTimer();
  accountFilterRevision += 1;
  accountFilterTransition.value = false;
  dashboardHydrated = false;
  invalidateDashboardRequests();
  latestTestFilter.value = "all";
  dismissOperationNotice();
  clearSelectedAccounts();
  deleteDialogOpen.value = false;
  moveDialogOpen.value = false;
  moveGroups.value = [];
  pendingAccountIds.value = [];
  await sessionState.logout();
  groups.value = [];
  groupLoadError.value = null;
  priorityDialogOpen.value = false;
  accountConcurrencyDialogOpen.value = false;
  renameDialogOpen.value = false;
  accountExportDialogOpen.value = false;
  accountExportAccountIds.value = [];
  accountExportDirectory.value = "";
  accountExportDirectoryPickerBusy.value = false;
  accountExportError.value = null;
  converterDialogOpen.value = false;
  converterDialogKey.value += 1;
  reportDialogOpen.value = false;
  reportAccountIds.value = [];
  reportDirectory.value = "";
  reportPhase.value = "idle";
  reportDirectoryPickerBusy.value = false;
  reportError.value = null;
  batchCancelConfirmOpen.value = false;
  batch.accounts.value = [];
  accountPageNumber.value = 1;
  batch.resetTestResults();
}

function requestLogout() {
  logoutConfirmOpen.value = true;
}

async function confirmLogout() {
  logoutConfirmOpen.value = false;
  await handleLogout();
}
</script>

<template>
  <div class="application-root" :class="{ 'application-root--frameless': usesCustomTitleBar }">
    <WindowTitleBar v-if="usesCustomTitleBar" @request-close="requestWindowClose" />
    <div class="application-root__content">
      <StartupSplash v-if="initializing" />

      <LoginPanel
        v-else-if="!sessionState.authenticated.value"
        :preferences="sessionState.preferences.value"
        :busy="sessionState.busy.value"
        :message="sessionState.message.value"
        :totp-required="sessionState.totpRequired.value"
        :user-email-masked="sessionState.userEmailMasked.value"
        @login="handleLogin"
        @complete-totp="handleTotp"
        @restart="restartLogin"
      />

      <div v-else class="dashboard-shell">
      <header class="app-header">
        <AppLogo />
        <div class="app-header__session">
          <div>
            <strong>{{ sessionState.session.value?.email }}</strong>
            <span>{{ sessionState.session.value?.serverUrl }}</span>
          </div>
          <button class="icon-button" type="button" title="退出登录" @click="requestLogout"><LogOut :size="18" /></button>
        </div>
      </header>

      <main class="dashboard-content">
        <div class="dashboard-utility">
          <BatchTestPanel
            :model-id="modelId"
            :default-model-id="defaultModelId"
            :concurrency="concurrency"
            :default-concurrency="defaultConcurrency"
            :model-options="modelOptions"
            :loading-models="modelDiscoveryLoading"
            :selected-count="selectedCount"
            :running="batch.running.value"
            :disabled="accountWorkflowBusy || accountFilterTransition || batch.loadingAccounts.value || latestTestScopeLoading"
            :summary="batch.summary.value"
            :inactive-count="batch.selectedInactiveCount.value"
            @update:model-id="modelId = $event"
            @set-default-model="setDefaultModel"
            @set-default-concurrency="setDefaultConcurrency"
            @update:concurrency="concurrency = $event"
            @open-models="openModels"
            @test-selected="startSelected"
            @cancel="requestBatchCancel"
          />
          <AccountOperationsPanel
            :selected-count="selectedCount"
            :running="batch.running.value || accountWorkflowBusy || accountFilterTransition || batch.loadingAccounts.value || latestTestScopeLoading"
            @delete-selected="openDeleteDialog"
            @move-selected="openMoveDialog"
            @set-priority="openPriorityDialog"
            @set-concurrency="openAccountConcurrencyDialog"
            @rename-selected="openRenameDialog"
            @export-accounts="openAccountExportDialog"
            @export-report="openReportDialog"
            @open-converter="openConverterDialog"
            @open-automation="openAutomationDialog"
          />
          <RefreshControl
            :loading="refreshControlLoading"
            :disabled="accountWorkflowBusy"
            :auto-refresh-seconds="sessionState.preferences.value.autoRefreshSeconds"
            @refresh="refreshAccounts"
            @set-auto-refresh-seconds="setAutoRefreshSeconds"
          />
        </div>

        <p v-if="batch.accountError.value || batch.batchError.value" class="dashboard-message" role="alert">
          {{ batch.accountError.value || batch.batchError.value }}
        </p>

        <AccountToolbar
          :accounts="batch.accounts.value"
          :groups="groups"
          :search="search"
          :platform="platform"
          :account-type="accountType"
          :plan-type="planType"
          :plan-types="availablePlanTypes"
          :has-unrecognized-plan-types="hasUnrecognizedPlanTypes"
          :group="group"
          :status="status"
          :privacy="privacy"
          :refresh-options="refreshFilterOptions"
          :refresh-plan-types="refreshPlanTypeCatalog"
          @update:search="search = $event"
          @update:platform="platform = $event"
          @update:account-type="accountType = $event"
          @update:plan-type="planType = $event"
          @update:group="group = $event"
          @update:status="status = $event"
          @update:privacy="privacy = $event"
        />

        <AccountTable
          :accounts="tableAccounts"
          :selected-ids="selectedIds"
          :test-states="batch.testStates.value"
          :page="accountPageNumber"
          :page-size="accountPageSize"
          :total="tableAccountTotal"
          :page-count="tableAccountPageCount"
          :truncated="tableAccountTruncated"
          :sort-key="accountSortKey"
          :sort-direction="accountSortDirection"
          :global-selection-enabled="tableGlobalSelectionEnabled"
          :global-selection-disabled-reason="tableGlobalSelectionDisabledReason"
          :global-selection-pending="globalSelectionPending"
          :interactions-disabled="accountFilterTransition || tableLoading"
          :loading="tableLoading"
          :latest-test-filter="latestTestFilter"
          :page-only-reason="tablePageOnlyReason"
          @toggle="toggleAccount"
          @toggle-page="toggleAccountIds"
          @select-page="selectAccountIds"
          @select-all-filtered="selectAllFilteredAccounts"
          @clear-selection="clearSelectedAccounts"
          @update:latest-test-filter="setLatestTestFilter"
          @update-page="setAccountPage"
          @update-page-size="setAccountPageSize"
          @update-sort="setAccountSort"
        />
      </main>

      <AutomaticAutomationTask
        v-if="automationBackgroundTask && automationTaskBackgrounded"
        :rule-name="automationBackgroundTask.name"
        :phase="automationBackgroundTask.phase"
        :progress="automationBackgroundTask.progress"
        :notice-visible="Boolean(operationNotice)"
        @open="openAutomationBackgroundTask"
      />

      <DeleteAccountsDialog
        :open="deleteDialogOpen"
        :selected-count="pendingAccountIds.length"
        :normal-count="pendingDeleteProtection.normalCount"
        :rate-limited-count="pendingDeleteProtection.rateLimitedCount"
        :connection-interrupted-count="pendingDeleteProtection.connectionInterruptedCount"
        :other-count="pendingDeleteProtection.otherCount"
        :busy="accountActionBusy"
        :error="deleteError"
        @cancel="closeDeleteDialog"
        @delete-all="deletePendingAccounts"
        @exclude-protected="deletePendingAccountsExcludingProtected"
      />
      <MoveAccountsDialog
        :open="moveDialogOpen"
        :selected-count="pendingAccountIds.length"
        :groups="moveTargetGroups"
        :platform-label="pendingMoveSelection.platformLabel"
        :selection-error="pendingMoveSelection.error"
        :busy="accountActionBusy"
        :error="moveError"
        @cancel="closeMoveDialog"
        @move="movePendingAccounts"
        @create="createAndMovePendingAccounts"
      />
      <PriorityAccountsDialog
        :open="priorityDialogOpen"
        :selected-count="pendingAccountIds.length"
        :original-priorities="pendingOriginalPriorities"
        :minimum="0"
        priority-range-text="0 及以上的整数（Sub2API 未设置固定业务上限）"
        priority-order-text="数值越小，越优先调用。"
        :busy="accountActionBusy"
        :error="priorityError"
        @cancel="closePriorityDialog"
        @apply="setPendingAccountsPriority"
      />
      <BatchAccountConcurrencyDialog
        :open="accountConcurrencyDialogOpen"
        :selected-count="pendingAccountIds.length"
        :original-concurrencies="pendingOriginalAccountConcurrencies"
        :minimum="0"
        concurrency-range-text="0 及以上的整数（Sub2API 未设置固定业务上限）"
        concurrency-order-text="该上限分别作用于每个账号。"
        help-text="该值会覆盖所有已选账号当前的单个账号并发设置，不会修改左侧批量测试的总并发。"
        :busy="accountActionBusy"
        :error="accountConcurrencyError"
        @cancel="closeAccountConcurrencyDialog"
        @apply="setPendingAccountConcurrency"
      />
      <RenameAccountsDialog
        :open="renameDialogOpen"
        :accounts="pendingRenameAccounts"
        :busy="accountActionBusy"
        :error="renameError"
        @cancel="closeRenameDialog"
        @apply="renamePendingAccounts"
      />
      <AccountExportDialog
        :open="accountExportDialogOpen"
        :selected-count="accountExportAccountIds.length"
        :directory="accountExportDirectory"
        :busy="accountExportBusy"
        :error="accountExportError"
        @cancel="closeAccountExportDialog"
        @pick-directory="pickAccountExportDirectory"
        @export="exportAccounts"
      />
      <BatchConverterDialog :key="converterDialogKey" :open="converterDialogOpen" @cancel="converterDialogOpen = false" />
      <BatchAutomationDialog
        :open="automationDialogOpen"
        :rules="automationRules"
        :groups="groups"
        :accounts="batch.accounts.value"
        :plan-types="availablePlanTypes"
        :has-unrecognized-plan-types="hasUnrecognizedPlanTypes"
        :busy="automationBusy || automaticAutomationDispatching"
        :automatic-rule-id="automaticRuleId"
        :running-rule-id="runningAutomationRuleId"
        :validate-rule="validateAutomationRuleForSave"
        @close="closeAutomationDialog"
        @add="addAutomationRule"
        @edit="editAutomationRule"
        @delete="deleteAutomationRule"
        @run="runAutomationRuleFromUi"
        @stop="stopAutomationRuleFromUi"
        @background="moveAutomationTaskToBackground"
        @pick-directory="pickAutomationDirectory"
      />
      <AutomationDeleteConfirmDialog
        :open="automationDeleteConfirmOpen"
        :rule-name="pendingAutomationRunRule?.name || '此自动化'"
        :protected-statuses="pendingAutomationProtectedDeleteStatuses"
        :busy="automationBusy"
        @cancel="cancelAutomationRunConfirmation"
        @confirm="confirmAutomationRun"
      />
      <BatchReportDialog
        :open="reportDialogOpen"
        :selected-count="reportAccountIds.length"
        :directory="reportDirectory"
        :busy="reportBusy"
        :testing="reportPhase === 'testing'"
        :error="reportError"
        @cancel="closeReportDialog"
        @cancel-test="requestReportTestCancel"
        @pick-directory="pickReportDirectory"
        @generate="generateReport"
      />
      <CancelBatchConfirmDialog
        :open="batchCancelConfirmOpen"
        @cancel="batchCancelConfirmOpen = false"
        @confirm="confirmBatchCancel"
      />
      <OperationNotice :message="operationNotice" @dismiss="dismissOperationNotice" />
      <LogoutConfirmDialog :open="logoutConfirmOpen" @cancel="logoutConfirmOpen = false" @confirm="confirmLogout" />
      </div>
    </div>
    <CloseConfirmDialog :open="closeConfirmOpen" @cancel="cancelWindowClose" @confirm="confirmWindowClose" />
  </div>
</template>
