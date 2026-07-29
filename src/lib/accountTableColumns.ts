import { getAccountGroupName, getAccountPlanTypeLabel, getAccountSchedulable, getAccountStatusLabel, getLatestTestResult } from "./accounts";
import type { TestRowState } from "./batch";
import type { Account } from "../types";

export type AccountSortKey = "id" | "group" | "lastUsedAt" | "createdAt";

export type AccountTableColumnId =
  | "name"
  | "id"
  | "platform"
  | "accountType"
  | "planType"
  | "status"
  | "scheduling"
  | "priority"
  | "concurrency"
  | "currentConcurrency"
  | "loadFactor"
  | "rateMultiplier"
  | "privacy"
  | "proxy"
  | "proxyExpiresAt"
  | "group"
  | "sessionWindow"
  | "currentWindowCost"
  | "activeSessions"
  | "currentRpm"
  | "rateLimitedAt"
  | "rateLimitResetAt"
  | "overloadUntil"
  | "tempUnschedulableUntil"
  | "tempUnschedulableReason"
  | "expiresAt"
  | "autoPauseOnExpired"
  | "notes"
  | "errorMessage"
  | "lastUsedAt"
  | "createdAt"
  | "updatedAt"
  | "testResult"
  | "testTime"
  | "latency";

export interface AccountTableColumnDefinition {
  id: AccountTableColumnId;
  label: string;
  description: string;
  weight: number;
  sortKey?: AccountSortKey;
}

/** Canonical column model shared by the account table and batch-test report. */
export const ACCOUNT_TABLE_COLUMNS: readonly AccountTableColumnDefinition[] = [
  { id: "name", label: "名称", description: "账号显示名称", weight: 1.28 },
  { id: "id", label: "账号 ID", description: "账号唯一编号", weight: 0.65, sortKey: "id" },
  { id: "platform", label: "平台", description: "账号所属平台", weight: 0.85 },
  { id: "accountType", label: "认证类型", description: "账号认证方式", weight: 0.9 },
  { id: "planType", label: "账户类型", description: "订阅或账户标签", weight: 0.75 },
  { id: "status", label: "旧状态", description: "Sub2API 当前账号状态", weight: 0.8 },
  { id: "scheduling", label: "调度", description: "当前是否可调度", weight: 0.82 },
  { id: "priority", label: "优先级", description: "Sub2API 调度优先级", weight: 0.65 },
  { id: "concurrency", label: "并发上限", description: "单账号并发上限", weight: 0.85 },
  { id: "currentConcurrency", label: "当前并发", description: "当前运行并发数", weight: 0.78 },
  { id: "loadFactor", label: "负载系数", description: "账号负载系数", weight: 0.8 },
  { id: "rateMultiplier", label: "计费倍率", description: "账号计费倍率", weight: 0.82 },
  { id: "privacy", label: "Privacy 模式", description: "Sub2API Privacy 模式", weight: 0.95 },
  { id: "proxy", label: "代理", description: "当前代理及回退来源", weight: 1.1 },
  { id: "proxyExpiresAt", label: "代理到期", description: "代理到期时间", weight: 1.2 },
  { id: "group", label: "分组", description: "账号所属分组", weight: 0.95, sortKey: "group" },
  { id: "sessionWindow", label: "会话窗口", description: "当前会话窗口和状态", weight: 1.5 },
  { id: "currentWindowCost", label: "当前窗口费用", description: "当前会话窗口费用", weight: 1.05 },
  { id: "activeSessions", label: "活跃会话", description: "当前活跃会话数", weight: 0.9 },
  { id: "currentRpm", label: "当前 RPM", description: "当前每分钟请求数", weight: 0.9 },
  { id: "rateLimitedAt", label: "限流开始", description: "限流开始时间", weight: 1.2 },
  { id: "rateLimitResetAt", label: "限流恢复", description: "限流恢复时间", weight: 1.2 },
  { id: "overloadUntil", label: "超载截止", description: "超载状态截止时间", weight: 1.2 },
  { id: "tempUnschedulableUntil", label: "临时不可调度至", description: "临时不可调度结束时间", weight: 1.4 },
  { id: "tempUnschedulableReason", label: "临时不可调度原因", description: "临时不可调度说明", weight: 1.45 },
  { id: "expiresAt", label: "到期时间", description: "账号到期时间", weight: 1.2 },
  { id: "autoPauseOnExpired", label: "到期自动停用", description: "到期后自动停用设置", weight: 1.1 },
  { id: "notes", label: "备注", description: "账号备注", weight: 1.4 },
  { id: "errorMessage", label: "错误信息", description: "Sub2API 最近错误信息", weight: 1.5 },
  { id: "lastUsedAt", label: "最近使用", description: "最近一次使用时间", weight: 1.25, sortKey: "lastUsedAt" },
  { id: "createdAt", label: "创建时间", description: "账号创建时间", weight: 1.25, sortKey: "createdAt" },
  { id: "updatedAt", label: "更新时间", description: "账号最后更新时间", weight: 1.25 },
  { id: "testResult", label: "最新测试", description: "本客户端最新测试状态和 HTTP 状态码", weight: 1.25 },
  { id: "testTime", label: "测试时间", description: "本客户端最近一次测试完成时间", weight: 1.25 },
  { id: "latency", label: "响应耗时", description: "本客户端最新测试响应耗时", weight: 0.8 },
];

export const DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS: readonly AccountTableColumnId[] = [
  "name",
  "id",
  "platform",
  "planType",
  "status",
  "group",
  "createdAt",
  "testResult",
  "latency",
];

const PREVIOUS_DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS: readonly AccountTableColumnId[] = [
  "name",
  "id",
  "platform",
  "accountType",
  "planType",
  "status",
  "scheduling",
  "priority",
  "concurrency",
  "currentConcurrency",
  "group",
  "lastUsedAt",
  "createdAt",
  "testResult",
  "latency",
];

export const ACCOUNT_TABLE_DATE_COLUMN_IDS: readonly AccountTableColumnId[] = [
  "rateLimitedAt",
  "proxyExpiresAt",
  "rateLimitResetAt",
  "overloadUntil",
  "tempUnschedulableUntil",
  "expiresAt",
  "lastUsedAt",
  "createdAt",
  "updatedAt",
  "testTime",
];

export const FIXED_RIGHT_ACCOUNT_TABLE_COLUMN_IDS = ["testResult", "latency"] as const satisfies readonly AccountTableColumnId[];
export const ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY = "sub2bat.account-table.visible-columns.v2";
const PREVIOUS_ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY = "sub2bat.account-table.visible-columns.v1";
const LEGACY_ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY = "sub2api-batch-tester.account-table.visible-columns.v1";

export function readVisibleAccountTableColumnIds(): AccountTableColumnId[] {
  const fallback = [...DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS];
  if (typeof window === "undefined") return fallback;

  try {
    const saved = window.localStorage.getItem(ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY);
    if (saved !== null) return normalizeVisibleColumnIds(saved) ?? fallback;

    const previousSaved = window.localStorage.getItem(PREVIOUS_ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY);
    const legacySaved = previousSaved === null ? window.localStorage.getItem(LEGACY_ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY) : null;
    const savedForMigration = previousSaved ?? legacySaved;
    const migrated = savedForMigration === null ? null : normalizeVisibleColumnIds(savedForMigration);
    if (!migrated) return fallback;

    const columnIds = isPreviousDefaultVisibleColumnIds(migrated) ? fallback : migrated;

    try {
      window.localStorage.setItem(ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY, JSON.stringify(columnIds));
    } catch {
      // The previous preference remains usable for this session when migration cannot persist.
    }
    return columnIds;
  } catch {
    return fallback;
  }
}

export function persistVisibleAccountTableColumnIds(columnIds: readonly AccountTableColumnId[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ACCOUNT_TABLE_COLUMN_PREFERENCE_KEY, JSON.stringify(columnIds));
  } catch {
    // Column preferences remain available for the current session when storage is unavailable.
  }
}

function normalizeVisibleColumnIds(serialized: string): AccountTableColumnId[] | null {
  try {
    const values: unknown = JSON.parse(serialized);
    if (!Array.isArray(values)) return null;

    const requested = new Set(values.filter((value): value is string => typeof value === "string"));
    for (const columnId of FIXED_RIGHT_ACCOUNT_TABLE_COLUMN_IDS) requested.add(columnId);
    return ACCOUNT_TABLE_COLUMNS.map((column) => column.id).filter((id) => requested.has(id));
  } catch {
    return null;
  }
}

function isPreviousDefaultVisibleColumnIds(columnIds: readonly AccountTableColumnId[]): boolean {
  return columnIds.length === PREVIOUS_DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS.length
    && columnIds.every((columnId, index) => columnId === PREVIOUS_DEFAULT_VISIBLE_ACCOUNT_TABLE_COLUMN_IDS[index]);
}

export function formatAccountTableColumnValue(
  account: Account,
  testState: TestRowState | undefined,
  columnId: AccountTableColumnId,
): string | number {
  const result = getLatestTestResult(account, testState);

  switch (columnId) {
    case "name":
      return account.name || `账号 ${account.id}`;
    case "id":
      return account.id;
    case "platform":
      return textValue(account.platform);
    case "accountType":
      return textValue(account.accountType);
    case "planType":
      return getAccountPlanTypeLabel(account.planType);
    case "status":
      return getAccountStatusLabel(account);
    case "scheduling":
      return schedulingValue(account);
    case "priority":
      return textValue(account.priority);
    case "concurrency":
      return textValue(account.concurrency);
    case "currentConcurrency":
      return textValue(account.currentConcurrency);
    case "loadFactor":
      return textValue(account.loadFactor);
    case "rateMultiplier":
      return rateMultiplierValue(account.rateMultiplier);
    case "privacy":
      return textValue(account.privacyMode);
    case "proxy":
      return proxyValue(account);
    case "proxyExpiresAt":
      return dateValue(account.proxyExpiresAt);
    case "group":
      return textValue(getAccountGroupName(account));
    case "sessionWindow":
      return sessionWindowValue(account);
    case "currentWindowCost":
      return currencyValue(account.currentWindowCost);
    case "activeSessions":
      return textValue(account.activeSessions);
    case "currentRpm":
      return textValue(account.currentRpm);
    case "rateLimitedAt":
      return dateValue(account.rateLimitedAt);
    case "rateLimitResetAt":
      return dateValue(account.rateLimitResetAt);
    case "overloadUntil":
      return dateValue(account.overloadUntil);
    case "tempUnschedulableUntil":
      return dateValue(account.tempUnschedulableUntil);
    case "tempUnschedulableReason":
      return textValue(account.tempUnschedulableReason);
    case "expiresAt":
      return dateValue(account.expiresAt);
    case "autoPauseOnExpired":
      return booleanValue(account.autoPauseOnExpired);
    case "notes":
      return textValue(account.notes);
    case "errorMessage":
      return textValue(account.errorMessage);
    case "lastUsedAt":
      return dateValue(account.lastUsedAt);
    case "createdAt":
      return dateValue(account.createdAt);
    case "updatedAt":
      return dateValue(account.updatedAt);
    case "testResult":
      return `${result.label}${result.httpStatus === undefined ? "" : `（${result.httpStatus}）`}`;
    case "testTime":
      return dateValue(testState?.testedAt);
    case "latency":
      return formatLatency(result.latencyMs);
  }
}

function textValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function dateValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";

  const numeric = typeof value === "number" ? value : Number(value);
  const timestamp = Number.isFinite(numeric) && String(value).trim() !== "" && numeric < 100_000_000_000 ? numeric * 1000 : value;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//g, "-");
}

function schedulingValue(account: Account): string {
  const schedulable = getAccountSchedulable(account);
  return schedulable === true ? "可调度" : schedulable === false ? "不可调度" : "-";
}

function sessionWindowValue(account: Account): string {
  const window = account.usageWindow;
  if (!window) return "-";

  const dates = [window.start, window.end]
    .filter((value): value is string => Boolean(value))
    .map((value) => dateValue(value));
  const range = dates.join(" - ");
  const status = window.status?.trim() ?? "";
  return [range, status].filter(Boolean).join(" · ") || "-";
}

function rateMultiplierValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}x` : "-";
}

function currencyValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "-";
}

function proxyValue(account: Account): string {
  const proxy = account.proxyName?.trim() || (account.proxyId === null || account.proxyId === undefined ? "" : `#${account.proxyId}`);
  if (!proxy) return "-";
  const fallback = account.proxyFallbackOriginName?.trim();
  return fallback ? `${proxy} · 回退自 ${fallback}` : proxy;
}

function booleanValue(value: boolean | null | undefined): string {
  return value === true ? "是" : value === false ? "否" : "-";
}

function formatLatency(latencyMs: number | undefined): string {
  return latencyMs === undefined || !Number.isFinite(latencyMs) ? "-" : `${Math.max(0, Math.round(latencyMs))} ms`;
}
