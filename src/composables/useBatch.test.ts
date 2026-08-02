import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBatch } from "./useBatch";
import { matchesAccountRuntimeStatusFilter, UNRECOGNIZED_PLAN_TYPE_FILTER_VALUE } from "../lib/accounts";
import type { ModelCatalog } from "../types";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("vue", async (importOriginal) => {
  const vue = await importOriginal<typeof import("vue")>();
  return { ...vue, onMounted: vi.fn(), onUnmounted: vi.fn() };
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function mockModelLoads(...loads: Array<Promise<ModelCatalog>>) {
  let nextLoad = 0;
  invokeMock.mockImplementation((command: string) => {
    if (command === "cancel_model_load") return Promise.resolve();
    if (command === "load_models") return loads[nextLoad++];
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe("useBatch model discovery", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("keeps the latest catalog when an older load resolves last", async () => {
    const firstCatalog = deferred<ModelCatalog>();
    const secondCatalog = deferred<ModelCatalog>();
    const catalogA: ModelCatalog = {
      options: [{ id: "model-a", displayName: "Model A", availableOn: 1, requestedAccounts: 1, unknownAccounts: 0 }],
      unknownAccounts: 0,
    };
    const catalogB: ModelCatalog = {
      options: [{ id: "model-b", displayName: "Model B", availableOn: 1, requestedAccounts: 1, unknownAccounts: 0 }],
      unknownAccounts: 0,
    };
    mockModelLoads(firstCatalog.promise, secondCatalog.promise);

    const batch = useBatch();
    const firstLoad = batch.loadModels([1]);
    const secondLoad = batch.loadModels([2]);

    secondCatalog.resolve(catalogB);
    await expect(secondLoad).resolves.toEqual(catalogB);
    expect(invokeMock).toHaveBeenCalledWith("cancel_model_load", {
      requestId: expect.stringMatching(/^model-catalog-/),
    });

    firstCatalog.resolve(catalogA);
    const firstResult = await firstLoad;

    expect(batch.modelCatalog.value).toEqual(catalogB);
    expect(batch.loadingModels.value).toBe(false);
    expect(firstResult).toBeNull();
  });

  it("suppresses errors from a stale model load", async () => {
    const firstCatalog = deferred<ModelCatalog>();
    const secondCatalog = deferred<ModelCatalog>();
    const catalogB: ModelCatalog = {
      options: [{ id: "model-b", displayName: "Model B", availableOn: 1, requestedAccounts: 1, unknownAccounts: 0 }],
      unknownAccounts: 0,
    };
    mockModelLoads(firstCatalog.promise, secondCatalog.promise);

    const batch = useBatch();
    const firstLoad = batch.loadModels([1]);
    const secondLoad = batch.loadModels([2]);

    secondCatalog.resolve(catalogB);
    await expect(secondLoad).resolves.toEqual(catalogB);

    firstCatalog.reject(new Error("outdated request"));
    await expect(firstLoad).resolves.toBeNull();

    expect(batch.batchError.value).toBeNull();
    expect(batch.modelCatalog.value).toEqual(catalogB);
    expect(batch.loadingModels.value).toBe(false);
  });

  it("invalidates an in-flight model load without publishing its result", async () => {
    const catalog = deferred<ModelCatalog>();
    const staleCatalog: ModelCatalog = {
      options: [{ id: "model-a", displayName: "Model A", availableOn: 1, requestedAccounts: 1, unknownAccounts: 0 }],
      unknownAccounts: 0,
    };
    mockModelLoads(catalog.promise);

    const batch = useBatch();
    const load = batch.loadModels([1]);

    batch.invalidateModels();
    expect(batch.modelCatalog.value).toEqual({ options: [], unknownAccounts: 0 });
    expect(batch.loadingModels.value).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("cancel_model_load", {
      requestId: expect.stringMatching(/^model-catalog-/),
    });

    catalog.resolve(staleCatalog);
    await expect(load).resolves.toBeNull();
    expect(batch.modelCatalog.value).toEqual({ options: [], unknownAccounts: 0 });
  });

  it("keeps a fresh catalog after an invalidated load resolves late", async () => {
    const oldCatalog = deferred<ModelCatalog>();
    const freshCatalog = deferred<ModelCatalog>();
    const staleResult: ModelCatalog = {
      options: [{ id: "model-a", displayName: "Model A", availableOn: 1, requestedAccounts: 1, unknownAccounts: 0 }],
      unknownAccounts: 0,
    };
    const currentResult: ModelCatalog = {
      options: [{ id: "model-b", displayName: "Model B", availableOn: 1, requestedAccounts: 1, unknownAccounts: 0 }],
      unknownAccounts: 0,
    };
    mockModelLoads(oldCatalog.promise, freshCatalog.promise);

    const batch = useBatch();
    const oldLoad = batch.loadModels([1]);

    batch.invalidateModels();
    const freshLoad = batch.loadModels([2]);
    freshCatalog.resolve(currentResult);
    await expect(freshLoad).resolves.toEqual(currentResult);

    oldCatalog.resolve(staleResult);
    await expect(oldLoad).resolves.toBeNull();
    expect(batch.modelCatalog.value).toEqual(currentResult);
    expect(batch.loadingModels.value).toBe(false);
  });
});

describe("useBatch account plan types", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("collects distinct subscription labels across every account page", async () => {
    invokeMock.mockImplementation((_command: string, payload: { input: { page: number; pageSize: number } }) => {
      if (payload.input.page === 1) {
        return Promise.resolve({
          items: [
            { id: 1, name: "Free", platform: "openai", accountType: "oauth", planType: " free ", status: "active" },
            { id: 2, name: "Unset", platform: "openai", accountType: "oauth", status: "active" },
          ],
          total: 3,
          page: 1,
          pageSize: 200,
          pages: 2,
          hasMore: true,
        });
      }
      return Promise.resolve({
        items: [{ id: 3, name: "K12", platform: "openai", accountType: "oauth", planType: "k12", status: "active" }],
        total: 3,
        page: 2,
        pageSize: 200,
        pages: 2,
        hasMore: false,
      });
    });

    const batch = useBatch();

    await expect(batch.collectPlanTypes(10)).resolves.toEqual({
      planTypes: ["free", "k12"],
      hasUnrecognizedPlanTypes: true,
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_accounts_page", { input: { page: 1, pageSize: 200 } });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_accounts_page", { input: { page: 2, pageSize: 200 } });
  });

  it("locally paginates a selected subscription label across server pages", async () => {
    invokeMock.mockImplementation((_command: string, payload: { input: { page: number } }) => {
      if (payload.input.page === 1) {
        return Promise.resolve({
          items: [
            { id: 1, name: "Free", platform: "openai", accountType: "oauth", planType: "free", status: "active" },
            { id: 2, name: "K12 A", platform: "openai", accountType: "oauth", planType: "k12", status: "active" },
          ],
          total: 3,
          page: 1,
          pageSize: 200,
          pages: 2,
          hasMore: true,
        });
      }
      return Promise.resolve({
        items: [{ id: 3, name: "K12 B", platform: "openai", accountType: "oauth", planType: "K12", status: "active" }],
        total: 3,
        page: 2,
        pageSize: 200,
        pages: 2,
        hasMore: false,
      });
    });

    const batch = useBatch();
    const page = await batch.loadAccountPageForPlanType({ page: 1, pageSize: 20 }, " k12 ", 10);

    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 20, pages: 1, hasMore: false });
    expect(page?.items.map((account) => account.id)).toEqual([2, 3]);
    expect(batch.accounts.value.map((account) => account.id)).toEqual([2, 3]);
  });

  it("locally paginates unrecognized subscription labels across server pages", async () => {
    invokeMock.mockImplementation((_command: string, payload: { input: { page: number } }) => {
      if (payload.input.page === 1) {
        return Promise.resolve({
          items: [
            { id: 1, name: "Missing", platform: "openai", accountType: "oauth", status: "active" },
            { id: 2, name: "Literal", platform: "openai", accountType: "oauth", planType: "未识别", status: "active" },
            { id: 3, name: "Free", platform: "openai", accountType: "oauth", planType: "free", status: "active" },
          ],
          total: 5,
          page: 1,
          pageSize: 200,
          pages: 2,
          hasMore: true,
        });
      }
      return Promise.resolve({
        items: [
          { id: 4, name: "Blank", platform: "openai", accountType: "oauth", planType: " ", status: "active" },
          { id: 5, name: "Null", platform: "openai", accountType: "oauth", planType: null, status: "active" },
        ],
        total: 5,
        page: 2,
        pageSize: 200,
        pages: 2,
        hasMore: false,
      });
    });

    const batch = useBatch();
    const page = await batch.loadAccountPageForPlanType(
      { page: 1, pageSize: 2 },
      UNRECOGNIZED_PLAN_TYPE_FILTER_VALUE,
      10,
    );

    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2, pages: 2, hasMore: false });
    expect(page?.items.map((account) => account.id)).toEqual([1, 4]);
    expect(batch.accounts.value.map((account) => account.id)).toEqual([1, 4]);
  });

  it("locally paginates derived runtime status filters across every server page", async () => {
    invokeMock.mockImplementation((_command: string, payload: { input: { page: number } }) => {
      if (payload.input.page === 1) {
        return Promise.resolve({
          items: [
            { id: 1, name: "Normal", platform: "openai", accountType: "oauth", status: "active" },
            { id: 2, name: "Rate limited", platform: "openai", accountType: "oauth", status: "active", rateLimitResetAt: "2099-01-01T00:00:00Z" },
          ],
          total: 3,
          page: 1,
          pageSize: 200,
          pages: 2,
          hasMore: true,
        });
      }
      return Promise.resolve({
        items: [{ id: 3, name: "Rate limited B", platform: "openai", accountType: "oauth", status: "rate_limited" }],
        total: 3,
        page: 2,
        pageSize: 200,
        pages: 2,
        hasMore: false,
      });
    });

    const batch = useBatch();
    const page = await batch.loadAccountPageWithLocalFilter(
      { page: 1, pageSize: 20 },
      10,
      (account) => matchesAccountRuntimeStatusFilter(account, "rate_limited"),
      "账号状态",
    );

    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 20, pages: 1, hasMore: false });
    expect(page?.items.map((account) => account.id)).toEqual([2, 3]);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_accounts_page", {
      input: { page: 1, pageSize: 200 },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_accounts_page", {
      input: { page: 2, pageSize: 200 },
    });
  });
});

describe("useBatch latest-test scope", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("collects every page while preserving the upper account filters", async () => {
    invokeMock.mockImplementation((_command: string, payload: { input: { page: number } }) => Promise.resolve({
      items: [{
        id: payload.input.page,
        name: `Account ${payload.input.page}`,
        platform: "openai",
        accountType: "oauth",
        status: "active",
      }],
      total: 2,
      page: payload.input.page,
      pageSize: 200,
      pages: 2,
      hasMore: payload.input.page === 1,
    }));

    const batch = useBatch();
    const accounts = await batch.collectLatestTestAccounts({ groupId: 42, platform: "openai" }, 100);

    expect(accounts?.map((account) => account.id)).toEqual([1, 2]);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_accounts_page", {
      input: { groupId: 42, platform: "openai", page: 1, pageSize: 200 },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_accounts_page", {
      input: { groupId: 42, platform: "openai", page: 2, pageSize: 200 },
    });
  });
});

describe("useBatch completion waiting", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for a buffered completion event and snapshots only that run's results", async () => {
    let emitBatchEvent!: (payload: unknown) => void;
    const started = deferred<{ runId: string }>();
    listenMock.mockImplementation(async (_eventName: string, callback: (event: { payload: unknown }) => void) => {
      emitBatchEvent = (payload) => callback({ payload });
      return vi.fn();
    });
    invokeMock.mockReturnValue(started.promise);

    const batch = useBatch();
    const completion = batch.startAndWaitForCompletion([11, 12], "model-a", 10);

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("start_batch_test", {
        input: { accountIds: [11, 12], modelId: "model-a", concurrency: 10 },
      });
    });

    // Tauri can deliver every event before start_batch_test returns its run ID.
    emitBatchEvent({ kind: "started", runId: "report-run", total: 2, modelId: "model-a" });
    emitBatchEvent({ kind: "finished", runId: "report-run", accountId: 11, status: "succeeded", httpStatus: 200, latencyMs: 42, message: "ok" });
    emitBatchEvent({ kind: "finished", runId: "report-run", accountId: 12, status: "failed", httpStatus: 401, latencyMs: 18, message: "unauthorized" });
    emitBatchEvent({ kind: "complete", runId: "report-run", succeeded: 1, failed: 1, cancelled: 0 });
    started.resolve({ runId: "report-run" });

    await expect(completion).resolves.toMatchObject({
      completion: { runId: "report-run", succeeded: 1, failed: 1, cancelled: 0 },
      testStates: {
        11: { status: "succeeded", httpStatus: 200, latencyMs: 42 },
        12: { status: "failed", httpStatus: 401, latencyMs: 18 },
      },
    });
  });

  it("settles a waiting report test when the session resets", async () => {
    let emitBatchEvent!: (payload: unknown) => void;
    listenMock.mockImplementation(async (_eventName: string, callback: (event: { payload: unknown }) => void) => {
      emitBatchEvent = (payload) => callback({ payload });
      return vi.fn();
    });
    invokeMock.mockResolvedValue({ runId: "report-run" });

    const batch = useBatch();
    const completion = batch.startAndWaitForCompletion([11], "model-a", 10);

    await vi.waitFor(() => {
      expect(batch.activeRunId.value).toBe("report-run");
    });
    emitBatchEvent({ kind: "started", runId: "report-run", total: 1, modelId: "model-a" });
    batch.resetTestResults();

    await expect(completion).resolves.toBeNull();
  });

  it("recovers a report test when only the terminal event is lost", async () => {
    vi.useFakeTimers();
    let emitBatchEvent!: (payload: unknown) => void;
    const started = deferred<{ runId: string }>();
    listenMock.mockImplementation(async (_eventName: string, callback: (event: { payload: unknown }) => void) => {
      emitBatchEvent = (payload) => callback({ payload });
      return vi.fn();
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "start_batch_test") return started.promise;
      if (command === "get_batch_completion") {
        return Promise.resolve({ kind: "complete", succeeded: 1, failed: 1, cancelled: 0 });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const batch = useBatch();
    const completion = batch.startAndWaitForCompletion([11, 12], "model-a", 10);

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("start_batch_test", {
        input: { accountIds: [11, 12], modelId: "model-a", concurrency: 10 },
      });
    });

    emitBatchEvent({ kind: "started", runId: "report-run", total: 2, modelId: "model-a" });
    emitBatchEvent({ kind: "finished", runId: "report-run", accountId: 11, status: "succeeded", httpStatus: 200, latencyMs: 42, message: "ok" });
    emitBatchEvent({ kind: "finished", runId: "report-run", accountId: 12, status: "failed", httpStatus: 401, latencyMs: 18, message: "unauthorized" });
    started.resolve({ runId: "report-run" });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(completion).resolves.toMatchObject({
      completion: { runId: "report-run", succeeded: 1, failed: 1, cancelled: 0 },
      testStates: {
        11: { status: "succeeded", httpStatus: 200, latencyMs: 42 },
        12: { status: "failed", httpStatus: 401, latencyMs: 18 },
      },
    });
    expect(batch.activeRunId.value).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("get_batch_completion", { runId: "report-run" });
  });
});
