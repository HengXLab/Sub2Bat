import { describe, expect, it } from "vitest";
import type { Account } from "../types";
import {
  ACCOUNT_STATUS_FILTER_OPTIONS,
  ACCOUNT_TYPE_FILTER_OPTIONS,
  getAccountPlanTypeConditionOptions,
  getAccountPlanTypeFilterOptions,
  getAccountPlanTypeLabel,
  getAccountRuntimeStatus,
  getAccountStatusLabel,
  getLatestTestResult,
  matchesLatestTestFilter,
  PLATFORM_FILTER_OPTIONS,
  PRIVACY_STATUS_FILTER_OPTIONS,
  UNRECOGNIZED_PLAN_TYPE_LABEL,
  UNASSIGNED_GROUP_FILTER_VALUE,
  filterAccounts,
  filterAccountsByLatestTest,
  getAccountFilterOptions,
  groupFilterValue,
} from "./accounts";
import { formatAccountTableColumnValue } from "./accountTableColumns";

const accounts: Account[] = [
  { id: 1, name: "Primary OpenAI", platform: "openai", accountType: "oauth", groupNames: ["生产组", "高优先级"], status: "active", privacyStatus: "Privacy" },
  { id: 2, name: "Gemini backup", platform: "gemini", accountType: "apikey", group: "备用组", status: "inactive", privacyStatus: "CF" },
  { id: 3, name: "OpenAI reserve", platform: "openai", accountType: "apikey", groupName: "生产组", status: "active" },
];

describe("account filters", () => {
  it("combines a status filter with a case-insensitive search", () => {
    const result = filterAccounts(accounts, { status: "active", search: "reserve" });

    expect(result.map((account) => account.id)).toEqual([3]);
  });

  it("returns every account for the all status filter", () => {
    expect(filterAccounts(accounts, { status: "all", search: "" })).toHaveLength(3);
  });

  it("finds untested accounts across the complete filtered scope", () => {
    const scope = Array.from({ length: 100 }, (_, index): Account => ({
      id: index + 1,
      name: `Account ${index + 1}`,
      platform: "openai",
      accountType: "oauth",
      status: "active",
    }));
    const tested = Object.fromEntries(
      scope.slice(0, 10).map((account) => [account.id, { status: account.id % 2 ? "succeeded" as const : "failed" as const }]),
    );

    expect(filterAccountsByLatestTest(scope, tested, "untested")).toHaveLength(90);
    expect(filterAccountsByLatestTest(scope, tested, "normal")).toHaveLength(5);
    expect(filterAccountsByLatestTest(scope, tested, "error")).toHaveLength(5);
    expect(matchesLatestTestFilter(undefined, "untested")).toBe(true);
  });

  it("shows a precise connection-exception reason in latest test results", () => {
    expect(getLatestTestResult(accounts[0], {
      status: "connectionInterrupted",
      httpStatus: 403,
      message: "HTTP 403: region unsupported",
    }).label).toBe("连接异常（403）");

    expect(getLatestTestResult(accounts[0], {
      status: "connectionInterrupted",
      message: "test stream ended with EOF",
    }).label).toBe("连接异常（EOF）");

    expect(getLatestTestResult(accounts[0], {
      status: "connectionInterrupted",
      message: "request timed out",
    }).label).toBe("连接异常（超时）");

    expect(getLatestTestResult(accounts[0], {
      status: "connectionInterrupted",
      message: "Test request failed: error sending request for url (https://example.test)",
      latencyMs: 90_008,
    }).label).toBe("连接异常（超时）");

    expect(getLatestTestResult(accounts[0], {
      status: "connectionInterrupted",
      message: "Test request failed: error sending request for url (https://example.test)",
    }).label).toBe("连接异常（网络错误）");

    expect(getLatestTestResult(accounts[0], {
      status: "connectionInterrupted",
      message: "Test stream ended before reaching a final result",
    }).label).toBe("连接异常（流提前结束）");

    expect(getLatestTestResult(accounts[0], {
      status: "connectionInterrupted",
    }).label).toBe("连接异常（未知原因）");
  });

  it("keeps the all option first in every fixed filter list", () => {
    expect(PLATFORM_FILTER_OPTIONS[0]).toEqual({ value: "all", label: "全部平台" });
    expect(ACCOUNT_TYPE_FILTER_OPTIONS[0]).toEqual({ value: "all", label: "全部类型" });
    expect(ACCOUNT_STATUS_FILTER_OPTIONS[0]).toEqual({ value: "all", label: "全部状态" });
    expect(PRIVACY_STATUS_FILTER_OPTIONS[0]).toEqual({ value: "all", label: "全部Privacy状态" });
  });

  it("includes the current Sub2API platform and account-type values", () => {
    expect(PLATFORM_FILTER_OPTIONS).toContainEqual({ value: "composite", label: "Composite" });
    expect(ACCOUNT_TYPE_FILTER_OPTIONS).toContainEqual({ value: "upstream", label: "Upstream" });
    expect(ACCOUNT_TYPE_FILTER_OPTIONS).toContainEqual({ value: "service_account", label: "Service Account" });
  });

  it("combines platform, type, group, and status filters", () => {
    const result = filterAccounts(accounts, {
      platform: "OPENAI",
      accountType: "apikey",
      group: "生产组",
      status: "active",
      search: "",
    });

    expect(result.map((account) => account.id)).toEqual([3]);
  });

  it("matches fixed filters against their display labels and compatible aliases", () => {
    const result = filterAccounts([
      ...accounts,
      {
        id: 4,
        name: "Grok temporary backup",
        platform: "x.ai",
        accountType: "setup-token",
        groupName: "备用组",
        status: "temporarily_unavailable",
        privacyStatus: "cloudflare",
      },
    ], {
      platform: "Grok",
      accountType: "Setup Token",
      group: "备用组",
      status: "临时不可调度",
      privacy: "CF",
      search: "",
    });

    expect(result.map((account) => account.id)).toEqual([4]);
  });

  it("treats missing Privacy values as the fixed unset status", () => {
    const result = filterAccounts(accounts, { status: "all", privacy: "未设置", search: "" });

    expect(result.map((account) => account.id)).toEqual([3]);
  });

  it("labels and filters missing account plan types without colliding with real labels", () => {
    const planAccounts: Account[] = [
      { id: 4, name: "Missing", platform: "openai", accountType: "oauth", status: "active" },
      { id: 5, name: "Null", platform: "openai", accountType: "oauth", planType: null, status: "active" },
      { id: 6, name: "Blank", platform: "openai", accountType: "oauth", planType: "  ", status: "active" },
      { id: 7, name: "Free", platform: "openai", accountType: "oauth", planType: "free", status: "active" },
      { id: 8, name: "Literal label", platform: "openai", accountType: "oauth", planType: "未识别", status: "active" },
      { id: 9, name: "Literal all", platform: "openai", accountType: "oauth", planType: "all", status: "active" },
    ];
    const options = getAccountPlanTypeFilterOptions(["free", "未识别", "all"], true);
    const conditionOptions = getAccountPlanTypeConditionOptions(["free", " K12", "k12", "未识别", "all"], true);
    const unrecognized = options.find((option) => option.label === UNRECOGNIZED_PLAN_TYPE_LABEL);
    const literalUnrecognized = options.find((option) => option.label === "未识别（原始类型）");
    const literalAll = options.find((option) => option.label === "all");

    expect(getAccountPlanTypeLabel(undefined)).toBe(UNRECOGNIZED_PLAN_TYPE_LABEL);
    expect(getAccountPlanTypeLabel(null)).toBe(UNRECOGNIZED_PLAN_TYPE_LABEL);
    expect(getAccountPlanTypeLabel("  ")).toBe(UNRECOGNIZED_PLAN_TYPE_LABEL);
    expect(formatAccountTableColumnValue(planAccounts[0]!, undefined, "planType")).toBe(UNRECOGNIZED_PLAN_TYPE_LABEL);
    expect(unrecognized?.value).toBeTruthy();
    expect(literalUnrecognized?.value).toBeTruthy();
    expect(literalAll?.value).not.toBe("all");
    expect(unrecognized?.value).not.toBe(literalUnrecognized?.value);
    expect(conditionOptions.some((option) => option.value === "all")).toBe(false);
    expect(conditionOptions).toEqual(getAccountPlanTypeFilterOptions(["free", " K12", "k12", "未识别", "all"], true).slice(1));
    expect(new Set(conditionOptions.map((option) => option.value)).size).toBe(conditionOptions.length);
    expect(filterAccounts(planAccounts, { status: "all", search: "", planType: unrecognized?.value }).map((account) => account.id)).toEqual([4, 5, 6]);
    expect(filterAccounts(planAccounts, { status: "all", search: "", planType: literalUnrecognized?.value }).map((account) => account.id)).toEqual([8]);
    expect(filterAccounts(planAccounts, { status: "all", search: "", planType: literalAll?.value }).map((account) => account.id)).toEqual([9]);
  });

  it("maps quota exhaustion and usage-limit aliases to the rate-limited option", () => {
    const result = filterAccounts([
      { id: 4, name: "Quota", platform: "openai", accountType: "oauth", status: "quota_exhausted" },
      { id: 5, name: "Usage limit", platform: "openai", accountType: "oauth", status: "usage_limit_reached" },
    ], { status: "限流中", search: "" });

    expect(result.map((account) => account.id)).toEqual([4, 5]);
  });

  it("uses Sub2API runtime fields to derive each scheduler status filter", () => {
    const now = new Date("2026-07-13T12:00:00Z").getTime();
    const runtimeAccounts: Account[] = [
      { id: 4, name: "Normal", platform: "openai", accountType: "oauth", status: "active", schedulable: true },
      { id: 5, name: "Rate limited", platform: "openai", accountType: "oauth", status: "active", schedulable: true, rateLimitResetAt: "2099-07-13T12:30:00Z" },
      { id: 6, name: "Temporary", platform: "openai", accountType: "oauth", status: "active", schedulable: true, tempUnschedulableUntil: "2099-07-13T12:30:00Z" },
      { id: 7, name: "Paused", platform: "openai", accountType: "oauth", status: "active", schedulable: false },
      { id: 8, name: "Disabled", platform: "openai", accountType: "oauth", status: "inactive", schedulable: true },
      { id: 9, name: "Error", platform: "openai", accountType: "oauth", status: "error", schedulable: true },
    ];

    expect(getAccountRuntimeStatus(runtimeAccounts[1], now)).toBe("rate_limited");
    expect(getAccountRuntimeStatus(runtimeAccounts[2], now)).toBe("temp_unschedulable");
    expect(getAccountRuntimeStatus(runtimeAccounts[3], now)).toBe("unschedulable");
    expect(getAccountStatusLabel(runtimeAccounts[1])).toBe("限流中");

    expect(filterAccounts(runtimeAccounts, { status: "active", search: "" }).map((account) => account.id)).toEqual([4]);
    expect(filterAccounts(runtimeAccounts, { status: "rate_limited", search: "" }).map((account) => account.id)).toEqual([5]);
    expect(filterAccounts(runtimeAccounts, { status: "temp_unschedulable", search: "" }).map((account) => account.id)).toEqual([6]);
    expect(filterAccounts(runtimeAccounts, { status: "unschedulable", search: "" }).map((account) => account.id)).toEqual([7]);
    expect(filterAccounts(runtimeAccounts, { status: "inactive", search: "" }).map((account) => account.id)).toEqual([8]);
    expect(filterAccounts(runtimeAccounts, { status: "error", search: "" }).map((account) => account.id)).toEqual([9]);
  });

  it("reads official privacy_mode values before legacy privacy aliases", () => {
    const result = filterAccounts([
      { id: 4, name: "Privacy", platform: "openai", accountType: "oauth", status: "active", privacyMode: "training_off", privacyStatus: "Fail" },
      { id: 5, name: "CF", platform: "openai", accountType: "oauth", status: "active", privacyMode: "training_set_cf_blocked" },
      { id: 6, name: "Fail", platform: "openai", accountType: "oauth", status: "active", privacyMode: "training_set_failed" },
    ], { privacy: "Privacy", status: "all", search: "" });

    expect(result.map((account) => account.id)).toEqual([4]);
  });

  it("filters an account by each of its individual groups", () => {
    const result = filterAccounts(accounts, { group: "高优先级", status: "all", search: "" });

    expect(result.map((account) => account.id)).toEqual([1]);
  });

  it("filters opaque group selections by numeric group ID", () => {
    const result = filterAccounts([
      { id: 4, name: "Selected", platform: "openai", accountType: "oauth", groupIds: [42], groupNames: ["同名分组"], status: "active" },
      { id: 5, name: "Other", platform: "openai", accountType: "oauth", groupIds: [99], groupNames: ["同名分组"], status: "active" },
    ], { group: groupFilterValue(42), status: "all", search: "" });

    expect(result.map((account) => account.id)).toEqual([4]);
  });

  it("filters accounts with no group using the unassigned-group value", () => {
    const result = filterAccounts([
      ...accounts,
      { id: 4, name: "No group", platform: "anthropic", accountType: "oauth", status: "active", groupName: "" },
    ], { group: UNASSIGNED_GROUP_FILTER_VALUE, status: "all", search: "" });

    expect(result.map((account) => account.id)).toEqual([4]);
  });

  it("returns fixed options and only derives groups from loaded accounts", () => {
    const options = getAccountFilterOptions([
      ...accounts,
      { id: 4, name: "Duplicate", platform: " OpenAI ", accountType: "oauth", groupName: "", status: "active" },
      { id: 5, name: "Unlisted platform", platform: "mistral", accountType: "session", status: "unknown" },
    ]);

    expect(options.platforms).toEqual(PLATFORM_FILTER_OPTIONS);
    expect(options.accountTypes).toEqual(ACCOUNT_TYPE_FILTER_OPTIONS);
    expect(options.groups).toEqual(["备用组", "高优先级", "生产组"]);
    expect(options.statuses).toEqual(ACCOUNT_STATUS_FILTER_OPTIONS);
    expect(options.privacyStatuses).toEqual(PRIVACY_STATUS_FILTER_OPTIONS);
  });
});
