import { strToU8, zipSync } from "fflate";
import {
  ACCOUNT_TABLE_COLUMNS,
  DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS,
  formatAccountTableColumnValue,
  type AccountTableColumnId,
} from "./accountTableColumns";
import type { TestRowState } from "./batch";
import type { Account } from "../types";

/** The report picker intentionally exposes the exact same field set as table column settings. */
export const REPORT_COLUMN_OPTIONS = ACCOUNT_TABLE_COLUMNS;
export type ReportColumnId = AccountTableColumnId;
export const DEFAULT_REPORT_COLUMNS: readonly ReportColumnId[] = [
  ...DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS,
  "testTime",
];
export const MAX_BATCH_REPORT_ROWS = 10_000;
const MAX_EXCEL_CELL_CHARACTERS = 32_767;
const MAX_BATCH_REPORT_CELL_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_REPORT_WORKSHEET_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_REPORT_ARCHIVE_BYTES = 64 * 1024 * 1024;

interface ByteBudget {
  used: number;
  limit: number;
  message: string;
}

export interface BatchReportInput {
  accounts: readonly Account[];
  testStates: Readonly<Record<number, TestRowState>>;
  columns: readonly string[];
}

/** Creates an Excel workbook for the accounts currently selected in the dashboard. */
export function createBatchReportWorkbook({ accounts, testStates, columns }: BatchReportInput): Uint8Array {
  const selectedColumns = uniqueReportColumns(columns);
  if (!selectedColumns.length) {
    throw new Error("请至少选择一项报告内容。");
  }
  if (accounts.length > MAX_BATCH_REPORT_ROWS) {
    throw new Error(`一次最多导出 ${MAX_BATCH_REPORT_ROWS.toLocaleString()} 个账号的测活报告。请分批导出。`);
  }

  const cellTextBudget: ByteBudget = {
    used: 0,
    limit: MAX_BATCH_REPORT_CELL_TEXT_BYTES,
    message: `报告文本超过 ${formatMegabytes(MAX_BATCH_REPORT_CELL_TEXT_BYTES)} MB 上限。请缩小账号或列选择范围。`,
  };
  const rows: Array<Array<string | number>> = [
    selectedColumns.map((column) => safeExcelValue(column.label, cellTextBudget)),
  ];
  for (const account of accounts) {
    rows.push(selectedColumns.map((column) => safeExcelValue(
      formatAccountTableColumnValue(account, testStates[account.id], column.id),
      cellTextBudget,
    )));
  }
  return createXlsxWorkbook(
    rows,
    selectedColumns.map((column) => columnWidth(column)),
    "测活报告",
  );
}

function uniqueReportColumns(columns: readonly string[]) {
  const requested = new Set(columns);
  return REPORT_COLUMN_OPTIONS.filter((column) => requested.has(column.id));
}

function safeExcelValue(value: string | number, budget: ByteBudget): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = sanitizeXml10Text(String(value));
  const clipped = text.length > MAX_EXCEL_CELL_CHARACTERS ? `${text.slice(0, MAX_EXCEL_CELL_CHARACTERS - 3)}...` : text;
  const escapedFormula = /^\s*[=+@-]/.test(clipped) ? `'${clipped}` : clipped;
  addToBudget(budget, utf8ByteLength(escapedFormula));
  return escapedFormula;
}

function columnWidth(column: (typeof REPORT_COLUMN_OPTIONS)[number]): number {
  return Math.min(42, Math.max(12, Math.ceil(column.label.length * 2.3 + column.weight * 5)));
}

/**
 * The report only needs a single, write-only worksheet. Keeping the small XLSX
 * writer here avoids shipping a general-purpose spreadsheet parser in the app.
 */
function createXlsxWorkbook(rows: ReadonlyArray<ReadonlyArray<string | number>>, columnWidths: readonly number[], sheetName: string): Uint8Array {
  const columnCount = columnWidths.length;
  const rowCount = Math.max(rows.length, 1);
  const lastColumn = xlsxColumnName(Math.max(columnCount, 1) - 1);
  const dimension = `A1:${lastColumn}${rowCount}`;
  const columns = columnWidths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const sheetRows: string[] = [];
  const worksheetBudget: ByteBudget = {
    used: 0,
    limit: MAX_BATCH_REPORT_WORKSHEET_BYTES,
    message: `报告工作表超过 ${formatMegabytes(MAX_BATCH_REPORT_WORKSHEET_BYTES)} MB 上限。请缩小账号或列选择范围。`,
  };
  for (const [rowIndex, row] of rows.entries()) {
    const rowXml = `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => xlsxCell(value, `${xlsxColumnName(columnIndex)}${rowIndex + 1}`)).join("")}</row>`;
    addToBudget(worksheetBudget, utf8ByteLength(rowXml));
    sheetRows.push(rowXml);
  }
  const filter = columnCount > 0 ? `<autoFilter ref="${dimension}"/>` : "";
  const worksheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="${dimension}"/><cols>${columns}</cols><sheetData>${sheetRows.join("")}</sheetData>${filter}`
    + "</worksheet>";
  if (utf8ByteLength(worksheet) > MAX_BATCH_REPORT_WORKSHEET_BYTES) {
    throw new Error(`报告工作表超过 ${formatMegabytes(MAX_BATCH_REPORT_WORKSHEET_BYTES)} MB 上限。请缩小账号或列选择范围。`);
  }

  const files = {
    "[Content_Types].xml": xmlDocument(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '</Types>',
    ),
    "_rels/.rels": xmlDocument(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
    ),
    "xl/workbook.xml": xmlDocument(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`
        + '</workbook>',
    ),
    "xl/_rels/workbook.xml.rels": xmlDocument(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '</Relationships>',
    ),
    "xl/worksheets/sheet1.xml": xmlDocument(worksheet),
  };

  const archive = zipSync(files, { level: 6 });
  if (archive.byteLength > MAX_BATCH_REPORT_ARCHIVE_BYTES) {
    throw new Error(`报告压缩包超过 ${formatMegabytes(MAX_BATCH_REPORT_ARCHIVE_BYTES)} MB 上限。请缩小账号或列选择范围。`);
  }
  return archive;
}

function xlsxCell(value: string | number, reference: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }

  const text = String(value);
  const preserveWhitespace = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}" t="inlineStr"><is><t${preserveWhitespace}>${escapeXml(text)}</t></is></c>`;
}

function xlsxColumnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function xmlDocument(body: string): Uint8Array {
  return strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`);
}

function escapeXml(value: string): string {
  return sanitizeXml10Text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeXml10Text(value: string): string {
  let sanitized = "";

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        sanitized += value[index] + value[index + 1];
        index += 1;
      } else {
        sanitized += "\uFFFD";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      sanitized += "\uFFFD";
      continue;
    }

    const isAllowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
    const isAllowedBmpCharacter = (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd);
    sanitized += isAllowedControl || isAllowedBmpCharacter ? value[index] : "\uFFFD";
  }

  return sanitized;
}

function addToBudget(budget: ByteBudget, bytes: number) {
  if (bytes > budget.limit - budget.used) {
    throw new Error(budget.message);
  }
  budget.used += bytes;
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
