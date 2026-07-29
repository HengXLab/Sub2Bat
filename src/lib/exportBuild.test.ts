import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBatchReportWorkbook,
  buildCpaArchive,
  buildOfficialAccountExportJson,
} from "./exportBuild";
import type { ExportBuildRequest, ExportBuildResponse } from "./exportBuildProtocol";

class SuccessfulWorker {
  static requests: ExportBuildRequest[] = [];
  onmessage: ((event: MessageEvent<ExportBuildResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  constructor(_url: URL, _options?: WorkerOptions) {}

  postMessage(request: ExportBuildRequest) {
    SuccessfulWorker.requests.push(request);
    const response = successfulResponse(request);
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<ExportBuildResponse>));
  }

  terminate() {}
}

class FailingWorker {
  onmessage: ((event: MessageEvent<ExportBuildResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  constructor(_url: URL, _options?: WorkerOptions) {}

  postMessage() {
    queueMicrotask(() => this.onmessage?.({
      data: { ok: false, error: "压缩内容超过上限。" },
    } as MessageEvent<ExportBuildResponse>));
  }

  terminate() {}
}

function successfulResponse(request: ExportBuildRequest): ExportBuildResponse {
  switch (request.kind) {
    case "accountJson":
      return { ok: true, kind: "accountJson", contents: "{\"accounts\": []}\n" };
    case "cpaArchive":
      return {
        ok: true,
        kind: "cpaArchive",
        result: { archive: new Uint8Array([1, 2, 3]), convertedCount: 1, skipped: [] },
      };
    case "batchReport":
      return { ok: true, kind: "batchReport", contents: new Uint8Array([4, 5, 6]) };
  }
}

afterEach(() => {
  SuccessfulWorker.requests = [];
  vi.unstubAllGlobals();
});

describe("background export builder", () => {
  it("routes account backup, CPA, and report builds through separate worker tasks", async () => {
    vi.stubGlobal("Worker", SuccessfulWorker);

    await expect(buildOfficialAccountExportJson({ accounts: [] })).resolves.toBe("{\"accounts\": []}\n");
    await expect(buildCpaArchive({ accounts: [] })).resolves.toMatchObject({ convertedCount: 1 });
    await expect(buildBatchReportWorkbook({ accounts: [], testStates: {}, columns: ["name"] })).resolves.toEqual(new Uint8Array([4, 5, 6]));

    expect(SuccessfulWorker.requests.map((request) => request.kind)).toEqual([
      "accountJson",
      "cpaArchive",
      "batchReport",
    ]);
  });

  it("surfaces a worker generation failure without running a synchronous fallback", async () => {
    vi.stubGlobal("Worker", FailingWorker);

    await expect(buildCpaArchive({ accounts: [] })).rejects.toThrow("压缩内容超过上限。");
  });

  it("reports an unsupported runtime instead of moving compression back to the main thread", async () => {
    vi.stubGlobal("Worker", undefined);

    await expect(buildBatchReportWorkbook({ accounts: [], testStates: {}, columns: ["name"] }))
      .rejects.toThrow("不支持后台导出任务");
  });
});
