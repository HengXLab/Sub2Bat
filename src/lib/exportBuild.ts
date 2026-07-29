import type { CpaArchiveResult } from "./accountExport";
import type { BatchReportInput } from "./batchReport";
import type { ExportBuildRequest, ExportBuildResponse } from "./exportBuildProtocol";

/** Builds potentially expensive export payloads off the WebView main thread. */
export async function buildOfficialAccountExportJson(payload: unknown): Promise<string> {
  const result = await runExportWorker({ kind: "accountJson", payload });
  if (result.ok && result.kind === "accountJson") return result.contents;
  throw new Error("后台账号备份任务返回了无效结果。");
}

/** Converts official backup data into a CPA archive without blocking the UI. */
export async function buildCpaArchive(payload: unknown): Promise<CpaArchiveResult> {
  const result = await runExportWorker({ kind: "cpaArchive", payload });
  if (result.ok && result.kind === "cpaArchive") return result.result;
  throw new Error("后台 CPA 导出任务返回了无效结果。");
}

/** Creates an XLSX report without blocking the UI while XML and ZIP data are built. */
export async function buildBatchReportWorkbook(input: BatchReportInput): Promise<Uint8Array> {
  const result = await runExportWorker({ kind: "batchReport", input });
  if (result.ok && result.kind === "batchReport") return result.contents;
  throw new Error("后台测活报告任务返回了无效结果。");
}

function runExportWorker(request: ExportBuildRequest): Promise<ExportBuildResponse> {
  if (typeof Worker !== "function") {
    return Promise.reject(new Error("当前运行环境不支持后台导出任务。"));
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./exportBuild.worker.ts", import.meta.url), {
        type: "module",
        name: "sub2bat-export-builder",
      });
    } catch (error) {
      reject(new Error(`无法启动后台导出任务：${readableWorkerError(error)}`));
      return;
    }

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      callback();
    };

    worker.onmessage = (event: MessageEvent<ExportBuildResponse>) => {
      const result = event.data;
      finish(() => {
        if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
          reject(new Error("后台导出任务返回了无效结果。"));
          return;
        }
        if (!result.ok) {
          reject(new Error(result.error || "后台导出内容生成失败。"));
          return;
        }
        resolve(result);
      });
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(`后台导出任务失败：${event.message || "未知错误"}`)));
    };
    worker.onmessageerror = () => {
      finish(() => reject(new Error("后台导出任务返回了无法读取的数据。")));
    };

    try {
      worker.postMessage(request);
    } catch (error) {
      finish(() => reject(new Error(`无法提交后台导出任务：${readableWorkerError(error)}`)));
    }
  });
}

function readableWorkerError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "未知错误";
}
