import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, stat, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

export const MAX_LOCAL_JSON_FILES = 2_000;
export const MAX_LOCAL_JSON_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_LOCAL_JSON_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_LOCAL_OUTPUT_FILES = 10_000;
export const MAX_LOCAL_OUTPUT_BYTES = 128 * 1024 * 1024;
const FILE_READ_CONCURRENCY = 4;
const MAX_DIRECTORY_SCAN_DEPTH = 32;
const MAX_DIRECTORY_ENTRIES_PER_DIRECTORY = 10_000;

export interface LocalJsonSource {
  sourceName: string;
  text?: string;
  error?: string;
}

export interface DirectoryWriteEntry {
  fileName: string;
  contents: string | Uint8Array;
}

export async function chooseJsonFiles(title: string): Promise<LocalJsonSource[]> {
  const selected = await open({
    title,
    multiple: true,
    filters: [{ name: "JSON 文件", extensions: ["json"] }],
  });
  const paths = selectedPaths(selected);
  return readJsonFiles(paths);
}

export async function chooseJsonDirectory(title: string): Promise<LocalJsonSource[]> {
  const selected = await open({
    title,
    directory: true,
    multiple: false,
    recursive: true,
  });
  if (typeof selected !== "string") return [];
  const collected = await collectJsonPaths(selected);
  const sources = await readJsonFiles(collected.paths);
  if (collected.truncated) {
    sources.push({
      sourceName: selected,
      error: collected.truncatedReason
        ?? `目录中的 JSON 文件超过 ${MAX_LOCAL_JSON_FILES.toLocaleString()} 个，本次只读取前 ${MAX_LOCAL_JSON_FILES.toLocaleString()} 个。`,
    });
  }
  return sources;
}

export async function chooseDirectoryAndWriteFiles(title: string, entries: readonly DirectoryWriteEntry[]): Promise<string | null> {
  if (!entries.length) return null;
  if (entries.length > MAX_LOCAL_OUTPUT_FILES) {
    throw new Error(`一次最多导出 ${MAX_LOCAL_OUTPUT_FILES.toLocaleString()} 个文件。`);
  }

  const preparedEntries = prepareDirectoryWrites(entries);

  const selected = await open({
    title,
    directory: true,
    multiple: false,
    recursive: true,
  });
  if (typeof selected !== "string") return null;

  const usedNames = new Set<string>();
  const destinations: Array<{ path: string; contents: Uint8Array }> = [];
  for (const entry of preparedEntries) {
    const fileName = await uniqueDestinationFileName(selected, entry.fileName, usedNames);
    destinations.push({ path: await join(selected, fileName), contents: entry.contents });
  }

  let written = 0;
  try {
    for (const destination of destinations) {
      // `createNew` closes the race between the stat check and the write. An
      // existing user file must never be overwritten by a conversion export.
      await writeFile(destination.path, destination.contents, { createNew: true });
      written += 1;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知写入错误。";
    throw new Error(`导出中断，已安全写入 ${written} 个新文件，未覆盖已有文件：${detail}`);
  }
  return selected;
}

async function readJsonFiles(paths: readonly string[]): Promise<LocalJsonSource[]> {
  // The dialog can return an arbitrarily large path array. Retain and report
  // only the bounded import window instead of allocating one result slot per
  // unprocessed path.
  const boundedPaths = paths.slice(0, MAX_LOCAL_JSON_FILES);
  const results: Array<LocalJsonSource | undefined> = new Array(boundedPaths.length);
  const readable: Array<{ index: number; sourceName: string }> = [];
  let totalBytes = 0;

  for (const [index, sourceName] of boundedPaths.entries()) {
    try {
      const info = await stat(sourceName);
      if (!info.isFile) {
        results[index] = { sourceName, error: "不是普通文件，已跳过。" };
        continue;
      }
      if (info.size > MAX_LOCAL_JSON_FILE_BYTES) {
        results[index] = { sourceName, error: `文件超过单文件 ${formatBytes(MAX_LOCAL_JSON_FILE_BYTES)} 上限，已跳过。` };
        continue;
      }
      if (totalBytes + info.size > MAX_LOCAL_JSON_TOTAL_BYTES) {
        results[index] = { sourceName, error: `已达到单次导入 ${formatBytes(MAX_LOCAL_JSON_TOTAL_BYTES)} 总大小上限，已跳过。` };
        continue;
      }
      totalBytes += info.size;
      readable.push({ index, sourceName });
    } catch (error) {
      results[index] = { sourceName, error: error instanceof Error ? error.message : "无法读取文件信息。" };
    }
  }

  await runWithConcurrency(readable, FILE_READ_CONCURRENCY, async ({ index, sourceName }) => {
    try {
      results[index] = { sourceName, text: await readTextFile(sourceName) };
    } catch (error) {
      results[index] = { sourceName, error: error instanceof Error ? error.message : "无法读取文件。" };
    }
  });

  const sources = results.filter((result): result is LocalJsonSource => Boolean(result));
  if (paths.length > boundedPaths.length) {
    sources.push({
      sourceName: "本次选择",
      error: `已超过单次 ${MAX_LOCAL_JSON_FILES.toLocaleString()} 个文件的读取上限，其余 ${(paths.length - boundedPaths.length).toLocaleString()} 个文件未读取。`,
    });
  }
  return sources;
}

async function collectJsonPaths(
  directory: string,
  state: CollectedPaths = { paths: [], truncated: false },
  depth = 0,
): Promise<CollectedPaths> {
  if (state.paths.length >= MAX_LOCAL_JSON_FILES) {
    state.truncated = true;
    return state;
  }
  if (depth > MAX_DIRECTORY_SCAN_DEPTH) {
    state.truncated = true;
    state.truncatedReason = `目录层级超过 ${MAX_DIRECTORY_SCAN_DEPTH} 层，本次已停止继续扫描。`;
    return state;
  }
  const entries = await readDir(directory);
  if (entries.length > MAX_DIRECTORY_ENTRIES_PER_DIRECTORY) {
    state.truncated = true;
    state.truncatedReason = `单个目录超过 ${MAX_DIRECTORY_ENTRIES_PER_DIRECTORY.toLocaleString()} 项，本次只扫描前 ${MAX_DIRECTORY_ENTRIES_PER_DIRECTORY.toLocaleString()} 项。`;
  }

  for (const entry of entries.slice(0, MAX_DIRECTORY_ENTRIES_PER_DIRECTORY)) {
    if (state.paths.length >= MAX_LOCAL_JSON_FILES) {
      state.truncated = true;
      break;
    }
    const path = await join(directory, entry.name);
    if (entry.isDirectory) {
      await collectJsonPaths(path, state, depth + 1);
    } else if (entry.isFile && entry.name.toLocaleLowerCase().endsWith(".json")) {
      state.paths.push(path);
    }
  }

  return state;
}

function selectedPaths(value: string | string[] | null): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
}

async function uniqueDestinationFileName(directory: string, fileName: string, usedNames: Set<string>): Promise<string> {
  const normalized = fileName.trim() || "converted.json";
  const dot = normalized.lastIndexOf(".");
  const cpaExtension = ".cpa.json";
  const hasCpaExtension = normalized.toLocaleLowerCase().endsWith(cpaExtension);
  const base = hasCpaExtension ? normalized.slice(0, -cpaExtension.length) : (dot > 0 ? normalized.slice(0, dot) : normalized);
  const extension = hasCpaExtension ? cpaExtension : (dot > 0 ? normalized.slice(dot) : "");
  let candidate = normalized;
  let index = 2;
  while (usedNames.has(candidate.toLocaleLowerCase()) || await pathExists(await join(directory, candidate))) {
    candidate = `${base}-${index}${extension}`;
    index += 1;
    if (index > MAX_LOCAL_OUTPUT_FILES + 1) {
      throw new Error("目标目录中存在过多同名文件，无法生成安全文件名。");
    }
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface CollectedPaths {
  paths: string[];
  truncated: boolean;
  truncatedReason?: string;
}

interface PreparedDirectoryWrite {
  fileName: string;
  contents: Uint8Array;
}

function prepareDirectoryWrites(entries: readonly DirectoryWriteEntry[]): PreparedDirectoryWrite[] {
  const prepared: PreparedDirectoryWrite[] = [];
  let totalBytes = 0;

  for (const entry of entries) {
    const fileName = normalizeOutputFileName(entry.fileName);
    const contents = typeof entry.contents === "string" ? new TextEncoder().encode(entry.contents) : entry.contents;
    if (totalBytes + contents.byteLength > MAX_LOCAL_OUTPUT_BYTES) {
      throw new Error(`导出内容超过 ${formatBytes(MAX_LOCAL_OUTPUT_BYTES)} 上限。请分批导出。`);
    }
    totalBytes += contents.byteLength;
    prepared.push({ fileName, contents });
  }

  return prepared;
}

function normalizeOutputFileName(value: string): string {
  const name = value.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new Error("导出文件名无效。");
  }
  return name;
}

async function runWithConcurrency<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
