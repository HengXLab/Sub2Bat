import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { stat, writeFile } from "@tauri-apps/plugin-fs";

const MAX_FILE_NAME_COLLISION_ATTEMPTS = 10_000;

export interface DirectoryExportWriteInput {
  directory: string;
  fileName: string;
  contents: string | Uint8Array;
}

export interface OutputDirectoryPickerInput {
  title: string;
  defaultPath?: string;
}

/** Opens a native folder picker for an export that will write directly into that folder. */
export async function chooseOutputDirectory({ title, defaultPath }: OutputDirectoryPickerInput): Promise<string | null> {
  const selected = await open({
    title,
    defaultPath: defaultPath?.trim() || undefined,
    directory: true,
    multiple: false,
    recursive: true,
  });
  return typeof selected === "string" ? selected : null;
}

/** Lets an automation rule retain an explicitly user-approved output folder. */
export function chooseAutomationOutputDirectory(defaultPath?: string): Promise<string | null> {
  return chooseOutputDirectory({ title: "选择批量自动化导出目录", defaultPath });
}

/**
 * Writes a new file below a previously selected folder without silently
 * overwriting an earlier export. The directory itself is never
 * interpolated into the generated filename.
 */
export async function writeExportFileInDirectory({ directory, fileName, contents }: DirectoryExportWriteInput): Promise<string> {
  const normalizedDirectory = directory.trim();
  if (!normalizedDirectory) {
    throw new Error("请先选择导出目录。");
  }

  const normalizedName = normalizeOutputFileName(fileName);
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  const { base, extension } = splitFileName(normalizedName);

  for (let suffix = 1; suffix <= MAX_FILE_NAME_COLLISION_ATTEMPTS; suffix += 1) {
    const candidate = suffix === 1 ? normalizedName : `${base}-${suffix}${extension}`;
    const destination = await join(normalizedDirectory, candidate);
    if (await pathExists(destination)) continue;

    try {
      await writeFile(destination, bytes, { createNew: true });
      return destination;
    } catch (error) {
      // A parallel process can create the file after the stat check. Retrying
      // only known collision failures preserves the no-overwrite guarantee.
      if (isAlreadyExistsError(error)) continue;
      throw error;
    }
  }

  throw new Error("目标目录中存在过多同名文件，无法生成安全的导出文件名。");
}

/** Backwards-compatible name for automation actions that write to a selected folder. */
export const writeAutomationExportFile = writeExportFileInDirectory;

function normalizeOutputFileName(value: string): string {
  const name = value.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new Error("导出文件名无效。");
  }
  return name;
}

function splitFileName(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { base: fileName, extension: "" };
  return { base: fileName.slice(0, dot), extension: fileName.slice(dot) };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|file exists|存在|exists/i.test(message);
}
