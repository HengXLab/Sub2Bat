import type { TestRowState } from "./batch";
import type { Account, AccountFilters } from "../types";

export type { Account };

export interface AccountFixedFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface AccountFilterOptions {
  platforms: readonly AccountFixedFilterOption[];
  accountTypes: readonly AccountFixedFilterOption[];
  planTypes: string[];
  groups: string[];
  statuses: readonly AccountFixedFilterOption[];
  privacyStatuses: readonly AccountFixedFilterOption[];
}

export const ALL_FILTER_VALUE = "all";
export const UNASSIGNED_GROUP_FILTER_VALUE = "__unassigned__";
/** Internal account-type filter value for records with no recognizable plan type. */
export const UNRECOGNIZED_PLAN_TYPE_FILTER_VALUE = "__sub2bat_plan_type_unknown_v1";
export const UNRECOGNIZED_PLAN_TYPE_LABEL = "未识别";
const PLAN_TYPE_FILTER_VALUE_PREFIX = "__sub2bat_plan_type_known_v1:";
/**
 * The official account-list endpoint filters groups by numeric ID. Keep the
 * UI value distinct from a display name so two same-named groups cannot be
 * silently mapped to the wrong server-side filter.
 */
export const GROUP_ID_FILTER_PREFIX = "__group_id:";

export const PLATFORM_FILTER_OPTIONS = [
  { value: ALL_FILTER_VALUE, label: "全部平台" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "antigravity", label: "Antigravity" },
  { value: "grok", label: "Grok" },
] as const satisfies readonly AccountFixedFilterOption[];

export const ACCOUNT_TYPE_FILTER_OPTIONS = [
  { value: ALL_FILTER_VALUE, label: "全部类型" },
  { value: "oauth", label: "OAuth" },
  { value: "setup-token", label: "Setup Token" },
  { value: "apikey", label: "API Key" },
  { value: "bedrock", label: "AWS Bedrock" },
] as const satisfies readonly AccountFixedFilterOption[];

export const ACCOUNT_STATUS_FILTER_OPTIONS = [
  { value: ALL_FILTER_VALUE, label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "inactive", label: "停用" },
  { value: "error", label: "错误" },
  { value: "rate_limited", label: "限流中" },
  { value: "overloaded", label: "超载中" },
  { value: "temp_unschedulable", label: "临时不可调度" },
  { value: "unschedulable", label: "不可调度" },
] as const satisfies readonly AccountFixedFilterOption[];

export const PRIVACY_STATUS_FILTER_OPTIONS = [
  { value: ALL_FILTER_VALUE, label: "全部Privacy状态" },
  { value: "__unset__", label: "未设置" },
  { value: "training_off", label: "Privacy" },
  { value: "training_set_cf_blocked", label: "CF" },
  { value: "training_set_failed", label: "Fail" },
] as const satisfies readonly AccountFixedFilterOption[];

const platformAliases = createAliasMap(PLATFORM_FILTER_OPTIONS, {
  anthropic: ["claude"],
  openai: ["open ai", "open-ai", "open_ai", "chatgpt"],
  gemini: ["google", "google gemini", "google-gemini", "google_gemini"],
  antigravity: ["anti gravity", "anti-gravity", "anti_gravity"],
  grok: ["xai", "x.ai", "x-ai", "x_ai"],
});
const accountTypeAliases = createAliasMap(ACCOUNT_TYPE_FILTER_OPTIONS, {
  oauth: ["o-auth", "o_auth"],
  "setup-token": ["setup token", "setup_token", "setuptoken"],
  apikey: ["api key", "api-key", "api_key"],
  bedrock: ["aws bedrock", "aws-bedrock", "aws_bedrock"],
});
const statusAliases = createAliasMap(ACCOUNT_STATUS_FILTER_OPTIONS, {
  active: ["normal", "enabled", "正常", "启用"],
  inactive: ["disabled", "stopped", "停用", "禁用"],
  error: ["failed", "failure", "错误"],
  rate_limited: [
    "rate limited",
    "rate-limited",
    "rate limit",
    "ratelimited",
    "rate_limit",
    "limited",
    "quota_exhausted",
    "quota_exceeded",
    "usage_limit_reached",
    "限流中",
  ],
  overloaded: ["overload", "overloaded", "超载中"],
  temp_unschedulable: [
    "temporarily_unschedulable",
    "temporary_unschedulable",
    "temporarily unavailable",
    "temporarily_unavailable",
    "temporary unavailable",
    "temporary_unavailable",
    "临时不可调度",
  ],
  unschedulable: ["not_schedulable", "not-schedulable", "unavailable", "不可调度"],
});
const privacyStatusAliases = createAliasMap(PRIVACY_STATUS_FILTER_OPTIONS, {
  __unset__: ["unset", "none", "null", "undefined", "not set", "not-set", "not_set", "未设置"],
  training_off: ["privacy", "private", "privacy mode", "privacy-mode", "privacy_mode"],
  training_set_cf_blocked: ["cf", "cloudflare", "cloud flare", "cloud-flare", "cloud_flare"],
  training_set_failed: ["fail", "failed", "failure", "error"],
});

const optionCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function filterAccounts(accounts: Account[], filters: AccountFilters): Account[] {
  const search = normalizedValue(filters.search);

  return accounts.filter((account) => {
    const platformMatches = matchesFixedFilter(account.platform, filters.platform, platformAliases);
    const accountTypeMatches = matchesFixedFilter(account.accountType, filters.accountType, accountTypeAliases);
    const planTypeMatches = matchesAccountPlanTypeFilter(account.planType, filters.planType);
    const groupMatches = matchesGroupFilter(account, filters.group);
    const statusMatches = matchesSub2ApiStatusFilter(account, filters.status);
    const privacyMatches = matchesPrivacyStatusFilter(account.privacyMode ?? account.privacyStatus, filters.privacy);

    if (!platformMatches || !accountTypeMatches || !planTypeMatches || !groupMatches || !statusMatches || !privacyMatches) {
      return false;
    }
    if (!search) {
      return true;
    }

    return [
      account.name,
      account.platform,
      account.accountType,
      ...getAccountGroupNames(account),
      account.status,
      account.privacyMode ?? account.privacyStatus,
      String(account.id),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(search);
  });
}

export function getAccountFilterOptions(accounts: Account[]): AccountFilterOptions {
  return {
    platforms: PLATFORM_FILTER_OPTIONS,
    accountTypes: ACCOUNT_TYPE_FILTER_OPTIONS,
    planTypes: getAccountPlanTypes(accounts),
    groups: uniqueSortedValues(accounts.flatMap(getAccountGroupNames)),
    statuses: ACCOUNT_STATUS_FILTER_OPTIONS,
    privacyStatuses: PRIVACY_STATUS_FILTER_OPTIONS,
  };
}

/** Returns normalized, display-ready subscription labels from an account collection. */
export function getAccountPlanTypes(accounts: readonly Account[]): string[] {
  return uniqueSortedValues(accounts.map((account) => account.planType));
}

/** Missing, blank, or whitespace-only upstream plan labels are not a plan type. */
export function isUnrecognizedPlanType(value: string | null | undefined): boolean {
  return !displayValue(value);
}

/** Shared display label for the table and exported reports. */
export function getAccountPlanTypeLabel(value: string | null | undefined): string {
  return displayValue(value) || UNRECOGNIZED_PLAN_TYPE_LABEL;
}

/**
 * Builds collision-free UI values for dynamic plan labels. The original label
 * remains the display text, while filtering uses an encoded internal value.
 */
export function getAccountPlanTypeFilterOptions(
  planTypes: readonly string[],
  hasUnrecognizedPlanTypes: boolean,
): readonly AccountFixedFilterOption[] {
  const knownPlanTypes = uniqueSortedValues([...planTypes]);
  return [
    { value: ALL_FILTER_VALUE, label: "全部账户类型" },
    ...(hasUnrecognizedPlanTypes ? [{ value: UNRECOGNIZED_PLAN_TYPE_FILTER_VALUE, label: UNRECOGNIZED_PLAN_TYPE_LABEL }] : []),
    ...knownPlanTypes.map((planType) => ({
      value: `${PLAN_TYPE_FILTER_VALUE_PREFIX}${encodeURIComponent(normalizedValue(planType))}`,
      label: planType === UNRECOGNIZED_PLAN_TYPE_LABEL ? `${planType}（原始类型）` : planType,
    })),
  ];
}

/** Reuses the account-type catalog for automation conditions without an unsafe all-accounts option. */
export function getAccountPlanTypeConditionOptions(
  planTypes: readonly string[],
  hasUnrecognizedPlanTypes: boolean,
): readonly AccountFixedFilterOption[] {
  return getAccountPlanTypeFilterOptions(planTypes, hasUnrecognizedPlanTypes)
    .filter((option) => option.value !== ALL_FILTER_VALUE);
}

/** True only for the collision-safe values generated for dynamic account-type filters. */
export function isAccountPlanTypeFilterToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const raw = displayValue(value);
  if (raw === UNRECOGNIZED_PLAN_TYPE_FILTER_VALUE) return true;
  if (!raw.startsWith(PLAN_TYPE_FILTER_VALUE_PREFIX)) return false;

  try {
    return Boolean(displayValue(decodeURIComponent(raw.slice(PLAN_TYPE_FILTER_VALUE_PREFIX.length))));
  } catch {
    return false;
  }
}

/** Gives persisted dynamic account-type filter values a human-readable label. */
export function getAccountPlanTypeFilterTokenLabel(value: string): string {
  if (value === UNRECOGNIZED_PLAN_TYPE_FILTER_VALUE) return UNRECOGNIZED_PLAN_TYPE_LABEL;
  if (!value.startsWith(PLAN_TYPE_FILTER_VALUE_PREFIX)) return displayValue(value);

  try {
    const label = displayValue(decodeURIComponent(value.slice(PLAN_TYPE_FILTER_VALUE_PREFIX.length)));
    if (!label) return displayValue(value);
    return label === UNRECOGNIZED_PLAN_TYPE_LABEL ? `${label}（原始类型）` : label;
  } catch {
    return displayValue(value);
  }
}

export function hasAccountPlanTypeFilter(filter: string | null | undefined): boolean {
  return resolveAccountPlanTypeFilter(filter).kind !== "all";
}

export function matchesAccountPlanTypeFilter(
  value: string | null | undefined,
  filter: string | null | undefined,
): boolean {
  const selected = resolveAccountPlanTypeFilter(filter);
  if (selected.kind === "all") return true;
  if (selected.kind === "unrecognized") return isUnrecognizedPlanType(value);
  return normalizedValue(value) === selected.value;
}

export function groupFilterValue(groupId: number): string {
  return `${GROUP_ID_FILTER_PREFIX}${groupId}`;
}

export function groupIdFromFilterValue(value: string | null | undefined): number | undefined {
  if (typeof value !== "string" || !value.startsWith(GROUP_ID_FILTER_PREFIX)) return undefined;
  const groupId = Number(value.slice(GROUP_ID_FILTER_PREFIX.length));
  return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : undefined;
}

export function getAccountGroupName(account: Account): string {
  return getAccountGroupNames(account).join(", ");
}

export function getAccountGroupNames(account: Account): string[] {
  const names = uniqueSortedValues(account.groupNames ?? []);
  if (names.length) return names;

  const fallback = displayValue(account.groupName) || displayValue(account.group);
  return fallback ? [fallback] : [];
}

export type AccountRuntimeStatus =
  | "active"
  | "inactive"
  | "error"
  | "rate_limited"
  | "temp_unschedulable"
  | "unschedulable"
  | "overloaded"
  | "unknown";

/** Mirrors the status precedence used by Sub2API's account status indicator. */
export function getAccountRuntimeStatus(account: Account, now = Date.now()): AccountRuntimeStatus {
  const status = resolveFixedFilterValue(account.status, statusAliases);
  if (status === "active") {
    if (isFutureDate(account.rateLimitResetAt, now)) return "rate_limited";
    if (isFutureDate(account.overloadUntil, now)) return "overloaded";
    if (isFutureDate(account.tempUnschedulableUntil, now)) return "temp_unschedulable";
    if (getAccountSchedulable(account) === false) return "unschedulable";
    return "active";
  }
  if (status === "inactive" || status === "error") return status;
  if (status === "rate_limited" || status === "overloaded" || status === "temp_unschedulable" || status === "unschedulable") return status;
  return "unknown";
}

export function getAccountStatusLabel(account: Account): string {
  const labels: Record<AccountRuntimeStatus, string> = {
    active: "正常",
    inactive: "停用",
    error: "错误",
    rate_limited: "限流中",
    temp_unschedulable: "临时不可调度",
    unschedulable: "不可调度",
    overloaded: "超载中",
    unknown: account.status || "未知",
  };
  return labels[getAccountRuntimeStatus(account)];
}

export type TestResultTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface LatestTestResult {
  label: string;
  tone: TestResultTone;
  httpStatus?: number;
  latencyMs?: number;
  message?: string;
  notice?: string;
}

export type LatestTestFilter =
  | "all"
  | "untested"
  | "normal"
  | "rateLimited"
  | "connectionInterrupted"
  | "error"
  | "queued"
  | "testing"
  | "cancelled";

export function matchesLatestTestFilter(
  testState: TestRowState | undefined,
  filter: LatestTestFilter,
): boolean {
  if (filter === "all") return true;
  if (!testState) return filter === "untested";

  const mapped: Record<TestRowState["status"], Exclude<LatestTestFilter, "all" | "untested">> = {
    succeeded: "normal",
    quotaExhausted: "rateLimited",
    connectionInterrupted: "connectionInterrupted",
    failed: "error",
    queued: "queued",
    testing: "testing",
    cancelled: "cancelled",
  };
  return mapped[testState.status] === filter;
}

export function filterAccountsByLatestTest(
  accounts: readonly Account[],
  testStates: Readonly<Record<number, TestRowState>>,
  filter: LatestTestFilter,
): Account[] {
  return accounts.filter((account) => matchesLatestTestFilter(testStates[account.id], filter));
}

export function getLatestTestResult(_account: Account, testState?: TestRowState): LatestTestResult {
  if (testState) {
    const httpStatus = normalizedHttpStatus(testState.httpStatus) ?? httpStatusFromMessage(testState.message);
    const common = {
      httpStatus,
      latencyMs: testState.latencyMs,
      message: testState.message,
    };

    switch (testState.status) {
      case "succeeded":
        return { label: "正常", tone: "success", ...common };
      case "quotaExhausted":
        return { label: "限流中", tone: "warning", ...common, httpStatus: httpStatus ?? 429 };
      case "connectionInterrupted":
        return {
          label: "连接中断（EOF）",
          tone: "info",
          ...common,
          notice: "这部分账号是连接中断，请勿轻易删除，可能是正常账号。",
        };
      case "failed":
        return { label: "错误", tone: "danger", ...common };
      case "testing":
        return { label: "测试中", tone: "info" };
      case "queued":
        return { label: "等待测试", tone: "neutral" };
      case "cancelled":
        return { label: "已取消", tone: "neutral" };
    }
  }

  return {
    label: "未测试",
    tone: "neutral",
  };
}

/** The official `schedulable` field is the non-mutating source of the 调度 display. */
export function getAccountSchedulable(account: Account): boolean | undefined {
  return normalizeSchedulingValue(account.schedulable ?? account.schedulingEnabled ?? account.scheduling);
}

function httpStatusFromMessage(message: string | undefined): number | undefined {
  if (!message) return undefined;

  const patterns = [
    /\bHTTP(?:\/\d(?:\.\d)?)?(?:[\s_-]+status(?:[\s_-]+code)?)?\s*[:=]?\s*(\d{3})\b/i,
    /\b(?:http[\s_-]*)?status(?:[\s_-]*code)?\s*["']?\s*[:=]?\s*["']?(\d{3})\b/i,
    /\b(?:http|error)?[\s_-]*code\s*["']?\s*[:=]?\s*["']?(\d{3})\b/i,
    /\breturned\s+(\d{3})\b/i,
    /\bresponded\s+with\s+(\d{3})\b/i,
    /\((\d{3})\)/,
  ];

  for (const pattern of patterns) {
    const status = Number(message.match(pattern)?.[1]);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }

  return undefined;
}

function normalizedHttpStatus(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function matchesFixedFilter(
  value: string | null | undefined,
  filter: string | null | undefined,
  aliases: ReadonlyMap<string, string>,
): boolean {
  const resolvedFilter = resolveFixedFilterValue(filter, aliases);
  if (!resolvedFilter || resolvedFilter === ALL_FILTER_VALUE) {
    return true;
  }

  return resolveFixedFilterValue(value, aliases) === resolvedFilter;
}

function matchesSub2ApiStatusFilter(account: Account, filter: string | null | undefined): boolean {
  const selected = resolveFixedFilterValue(filter, statusAliases);
  if (!selected || selected === ALL_FILTER_VALUE) return true;

  const rawStatus = resolveFixedFilterValue(account.status, statusAliases);
  const rateLimited = isFutureDate(account.rateLimitResetAt);
  const overloaded = isFutureDate(account.overloadUntil);
  const temporarilyUnschedulable = isFutureDate(account.tempUnschedulableUntil);
  const schedulable = getAccountSchedulable(account);

  switch (selected) {
    case "active":
      return rawStatus === "active"
        && !rateLimited
        && !overloaded
        && !temporarilyUnschedulable
        && schedulable !== false;
    case "rate_limited":
      return rawStatus === "rate_limited" || (rawStatus === "active" && rateLimited && !temporarilyUnschedulable);
    case "overloaded":
      return rawStatus === "overloaded" || (rawStatus === "active" && !rateLimited && overloaded);
    case "temp_unschedulable":
      return rawStatus === "temp_unschedulable"
        || (rawStatus === "active" && !rateLimited && !overloaded && temporarilyUnschedulable);
    case "unschedulable":
      return rawStatus === "unschedulable"
        || (rawStatus === "active"
          && schedulable === false
          && !rateLimited
          && !overloaded
          && !temporarilyUnschedulable);
    default:
      return rawStatus === selected;
  }
}

function matchesPrivacyStatusFilter(value: string | null | undefined, filter: string | null | undefined): boolean {
  const resolvedFilter = resolveFixedFilterValue(filter, privacyStatusAliases);
  if (!resolvedFilter || resolvedFilter === ALL_FILTER_VALUE) {
    return true;
  }

  return resolveFixedFilterValue(value, privacyStatusAliases, "__unset__")
    === resolvedFilter;
}

function matchesGroupFilter(account: Account, filter: string | null | undefined): boolean {
  const normalizedFilter = normalizedValue(filter);
  if (!normalizedFilter || normalizedFilter === ALL_FILTER_VALUE) {
    return true;
  }

  // The group picker uses an opaque ID token so groups with the same display
  // name remain distinct. Cross-page selection applies this local predicate
  // after collecting the server-filtered accounts, so compare IDs here rather
  // than accidentally comparing the token with a group name.
  const groupId = groupIdFromFilterValue(normalizedFilter);
  if (groupId !== undefined) {
    return account.groupIds?.some((accountGroupId) => accountGroupId === groupId) ?? false;
  }

  const groupNames = getAccountGroupNames(account);
  if (normalizedFilter === UNASSIGNED_GROUP_FILTER_VALUE || normalizedFilter === "未分配分组") {
    return groupNames.length === 0;
  }

  return groupNames.some((groupName) => normalizedValue(groupName) === normalizedFilter);
}

function uniqueSortedValues(values: Array<string | null | undefined>): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const display = displayValue(value);
    const key = normalizedValue(display);
    if (key && !unique.has(key)) {
      unique.set(key, display);
    }
  }
  return [...unique.values()].sort(optionCollator.compare);
}

function displayValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedValue(value: string | null | undefined): string {
  return displayValue(value).toLocaleLowerCase();
}

type AccountPlanTypeFilter =
  | { kind: "all" }
  | { kind: "unrecognized" }
  | { kind: "known"; value: string };

function resolveAccountPlanTypeFilter(filter: string | null | undefined): AccountPlanTypeFilter {
  const raw = displayValue(filter);
  const normalized = normalizedValue(raw);
  if (!normalized || normalized === ALL_FILTER_VALUE) return { kind: "all" };
  if (raw === UNRECOGNIZED_PLAN_TYPE_FILTER_VALUE) return { kind: "unrecognized" };

  if (raw.startsWith(PLAN_TYPE_FILTER_VALUE_PREFIX)) {
    try {
      const decoded = normalizedValue(decodeURIComponent(raw.slice(PLAN_TYPE_FILTER_VALUE_PREFIX.length)));
      if (decoded) return { kind: "known", value: decoded };
    } catch {
      // Fall through to the legacy raw-value branch below.
    }
  }

  // Preserve compatibility with filters created before dynamic plan values were encoded.
  return { kind: "known", value: normalized };
}

function normalizedAliasKey(value: string | null | undefined): string {
  return normalizedValue(value).replace(/[\s._-]+/g, "");
}

function createAliasMap(
  options: readonly AccountFixedFilterOption[],
  aliases: Record<string, readonly string[]>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const option of options) {
    for (const alias of [option.value, option.label, ...(aliases[option.value] ?? [])]) {
      map.set(normalizedAliasKey(alias), option.value);
    }
  }
  return map;
}

function resolveFixedFilterValue(
  value: string | null | undefined,
  aliases: ReadonlyMap<string, string>,
  emptyValue = "",
): string {
  const key = normalizedAliasKey(value);
  return key ? aliases.get(key) ?? key : emptyValue;
}

function normalizeSchedulingValue(value: Account["schedulable"] | Account["schedulingEnabled"] | Account["scheduling"] | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLocaleLowerCase();
  if (["true", "1", "enabled", "active", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "disabled", "inactive", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function isFutureDate(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;

  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) && value.trim() !== "" && numeric < 100_000_000_000 ? numeric * 1000 : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now;
}
