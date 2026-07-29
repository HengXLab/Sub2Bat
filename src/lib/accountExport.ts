import { strToU8, zipSync } from "fflate";
import { convertSub2apiDocument, MAX_CONVERSION_RECORDS } from "./accountConversion";

export type AccountExportFormat = "sub2api" | "cpa";

/** Keep official JSON exports and generated CPA archives within one bounded payload budget. */
export const MAX_ACCOUNT_EXPORT_RECORDS = MAX_CONVERSION_RECORDS;
export const MAX_ACCOUNT_EXPORT_ARCHIVE_BYTES = 128 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export interface CpaSkippedAccount {
  label: string;
  reason: string;
}

export interface CpaArchiveResult {
  archive: Uint8Array;
  convertedCount: number;
  skipped: CpaSkippedAccount[];
}

/** Serializes the unmodified data payload returned by Sub2API's official export endpoint. */
export function createOfficialAccountExportJson(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error("服务器没有返回有效的账号导出数据。");
  }

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  ensureByteLimit(serialized, "账号备份");
  return serialized;
}

/**
 * Converts the official backup payload into CPA files with the same mapping as
 * the local Sub2API <-> CPA converter. Keeping a single mapping prevents the
 * two export paths from silently producing different credentials or expiry
 * fields for the same source account.
 */
export function createCpaArchive(payload: unknown): CpaArchiveResult {
  const document = requireRecord(payload, "服务器没有返回有效的账号导出数据。");
  const rawAccounts = document.accounts;
  if (!Array.isArray(rawAccounts)) {
    throw new Error("账号导出数据缺少 accounts 数组。");
  }
  if (rawAccounts.length > MAX_ACCOUNT_EXPORT_RECORDS) {
    throw new Error(`一次最多生成 ${MAX_ACCOUNT_EXPORT_RECORDS.toLocaleString()} 个 CPA 账号文件。请分批导出。`);
  }

  const conversion = convertSub2apiDocument(document, { sourceName: "官方账号导出" });
  const skipped: CpaSkippedAccount[] = conversion.skipped.map((item, index) => ({
    label: item.entryLabel || item.sourceName || `accounts[${index}]`,
    reason: item.reason,
  }));
  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  let sourceBytes = 0;

  for (const [index, record] of conversion.converted.entries()) {
    const fileName = uniqueFileName(record.outputFileName || `converted-${index + 1}.cpa.json`, usedNames);
    const serialized = `${JSON.stringify(record.document, null, 2)}\n`;
    const serializedBytes = utf8ByteLength(serialized);
    if (serializedBytes > MAX_ACCOUNT_EXPORT_ARCHIVE_BYTES - sourceBytes) {
      throw new Error(`CPA 导出内容超过 ${formatMegabytes(MAX_ACCOUNT_EXPORT_ARCHIVE_BYTES)} MB 上限。请分批导出。`);
    }
    sourceBytes += serializedBytes;
    files[fileName] = strToU8(serialized);
  }

  if (!conversion.converted.length) {
    const details = skipped.slice(0, 3).map((item) => `${item.label}：${item.reason}`).join("；");
    throw new Error(details ? `没有可导出的 CPA 账号。${details}` : "没有可导出的 CPA 账号。");
  }

  const archive = zipSync(files, { level: 6 });
  if (archive.byteLength > MAX_ACCOUNT_EXPORT_ARCHIVE_BYTES) {
    throw new Error(`CPA 压缩包超过 ${formatMegabytes(MAX_ACCOUNT_EXPORT_ARCHIVE_BYTES)} MB 上限。请分批导出。`);
  }

  return {
    archive,
    convertedCount: conversion.converted.length,
    skipped,
  };
}

function ensureByteLimit(value: string, label: string) {
  if (utf8ByteLength(value) > MAX_ACCOUNT_EXPORT_ARCHIVE_BYTES) {
    throw new Error(`${label}超过 ${formatMegabytes(MAX_ACCOUNT_EXPORT_ARCHIVE_BYTES)} MB 上限。请缩小选择范围后重试。`);
  }
}

function uniqueFileName(fileName: string, usedNames: Set<string>): string {
  const extension = ".cpa.json";
  const base = fileName.toLocaleLowerCase().endsWith(extension) ? fileName.slice(0, -extension.length) : fileName;
  let candidate = fileName;
  let sequence = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${base}-${sequence}${extension}`;
    sequence += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function formatMegabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
