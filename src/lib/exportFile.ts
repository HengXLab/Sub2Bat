import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export const FILE_NAME_TEMPLATE_TOKENS = ["{date}", "{time}", "{datetime}", "{count}", "{format}"] as const;

export interface ExportFileNameContext {
  count: number;
  format: string;
  extension: string;
  timestamp?: Date;
}

export interface SaveExportInput {
  title: string;
  fileName: string;
  extension: string;
  filterName: string;
  contents: string | Uint8Array;
}

export type ChooseExportPathInput = Omit<SaveExportInput, "contents">;

/** Expands a user-facing export template into a Windows-safe final file name. */
export function formatExportFileName(template: string, context: ExportFileNameContext): string {
  const timestamp = validDate(context.timestamp) ?? new Date();
  const extension = normalizeExtension(context.extension);
  const values: Record<string, string> = {
    date: `${timestamp.getFullYear()}-${pad2(timestamp.getMonth() + 1)}-${pad2(timestamp.getDate())}`,
    time: `${pad2(timestamp.getHours())}-${pad2(timestamp.getMinutes())}-${pad2(timestamp.getSeconds())}`,
    datetime: `${timestamp.getFullYear()}-${pad2(timestamp.getMonth() + 1)}-${pad2(timestamp.getDate())}_${pad2(timestamp.getHours())}-${pad2(timestamp.getMinutes())}-${pad2(timestamp.getSeconds())}`,
    count: String(normalizeCount(context.count)),
    format: sanitizeFileNameSegment(context.format) || extension,
  };
  const expanded = template.trim().replace(/\{(date|time|datetime|count|format)\}/gi, (_match, key: string) => values[key.toLowerCase()]);
  const base = sanitizeFileNameSegment(expanded) || "sub2api-export";
  return base.toLocaleLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

/** Opens the native save dialog so the user chooses the final directory and file. */
export async function chooseExportPath({ title, fileName, extension, filterName }: ChooseExportPathInput): Promise<string | null> {
  const normalizedExtension = normalizeExtension(extension);
  const path = await save({
    title,
    defaultPath: fileName,
    filters: [{ name: filterName, extensions: [normalizedExtension] }],
  });
  return path;
}

/** Writes export bytes only after the caller has validated that its session is still current. */
export async function writeExportFile(path: string, contents: string | Uint8Array): Promise<void> {
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  await writeFile(path, bytes);
}

/** Convenience wrapper for callers that do not need a guard between choosing and writing. */
export async function saveExportFile({ contents, ...input }: SaveExportInput): Promise<string | null> {
  const path = await chooseExportPath(input);
  if (!path) return null;
  await writeExportFile(path, contents);
  return path;
}

export function getExportFileName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || path;
}

function validDate(value: Date | undefined): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeExtension(value: string): string {
  return value.trim().replace(/^\.+/, "").toLocaleLowerCase() || "txt";
}

function sanitizeFileNameSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
