import { createCpaArchive, createOfficialAccountExportJson } from "./accountExport";
import { createBatchReportWorkbook } from "./batchReport";
import type { ExportBuildRequest, ExportBuildResponse } from "./exportBuildProtocol";

interface ExportWorkerScope {
  onmessage: ((event: MessageEvent<ExportBuildRequest>) => void) | null;
  postMessage(message: ExportBuildResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as ExportWorkerScope;

scope.onmessage = (event) => {
  try {
    switch (event.data.kind) {
      case "accountJson":
        scope.postMessage({
          ok: true,
          kind: "accountJson",
          contents: createOfficialAccountExportJson(event.data.payload),
        });
        return;
      case "cpaArchive": {
        const result = createCpaArchive(event.data.payload);
        scope.postMessage(
          { ok: true, kind: "cpaArchive", result },
          transferFor(result.archive),
        );
        return;
      }
      case "batchReport": {
        const contents = createBatchReportWorkbook(event.data.input);
        scope.postMessage(
          { ok: true, kind: "batchReport", contents },
          transferFor(contents),
        );
        return;
      }
    }
  } catch (error) {
    scope.postMessage({ ok: false, error: readableWorkerError(error) });
  }
};

function transferFor(bytes: Uint8Array): Transferable[] | undefined {
  return bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : undefined;
}

function readableWorkerError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "后台导出内容生成失败。";
}
