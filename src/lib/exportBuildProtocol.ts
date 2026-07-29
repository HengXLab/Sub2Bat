import type { CpaArchiveResult } from "./accountExport";
import type { BatchReportInput } from "./batchReport";

export type ExportBuildRequest =
  | { kind: "accountJson"; payload: unknown }
  | { kind: "cpaArchive"; payload: unknown }
  | { kind: "batchReport"; input: BatchReportInput };

export type ExportBuildResponse =
  | { ok: true; kind: "accountJson"; contents: string }
  | { ok: true; kind: "cpaArchive"; result: CpaArchiveResult }
  | { ok: true; kind: "batchReport"; contents: Uint8Array }
  | { ok: false; error: string };
