import { getAccountRuntimeStatus } from "./accounts";
import { ACCOUNT_TABLE_COLUMNS } from "./accountTableColumns";
import {
  getAccountPlanTypeFilterTokenLabel,
  isAccountPlanTypeFilterToken,
  matchesAccountPlanTypeFilter,
} from "./accounts";
import { DEFAULT_REPORT_COLUMNS } from "./batchReport";
import type { TestRowState } from "./batch";
import type { Account } from "../types";

/**
 * Client-side automation rules deliberately live outside Sub2API. They only
 * describe which accounts a UI command should operate on; the existing
 * commands remain the sole place that performs account mutations.
 */
export const AUTOMATION_RULE_VERSION = 1 as const;
export const AUTOMATION_RULE_STORAGE_PREFIX = "sub2bat.automation.rules.v1";
export const AUTOMATION_GROUP_VALUE_PREFIX = "__automation_group_id:";
/** A real selectable value for accounts without any official group ID. */
export const AUTOMATION_UNGROUPED_GROUP_VALUE = "__automation_ungrouped__";
export const MAX_AUTOMATION_RULES = 200;
export const MAX_AUTOMATION_STEPS_PER_RULE = 40;
export const MAX_AUTOMATION_CONDITIONS_PER_GROUP = 30;
export const MAX_AUTOMATION_ACTIONS_PER_STEP = 20;
/**
 * The root condition group is depth 0. It may contain condition groups at
 * depth 1, but those groups may contain conditions only. Keeping this limit
 * here as well as in the editor prevents a stale saved rule from creating a
 * deeper expression that the UI cannot accurately show or edit.
 */
export const MAX_AUTOMATION_CONDITION_DEPTH = 2;
/** Ten seconds avoids a tight request loop while allowing short test intervals. */
export const MIN_AUTOMATION_INTERVAL_SECONDS = 10;
export const MAX_AUTOMATION_INTERVAL_SECONDS = 31 * 24 * 60 * 60;

export type AutomationField =
  | "name"
  | "id"
  | "planType"
  | "status"
  | "group"
  | "lastUsedAt"
  | "createdAt"
  | "latestTest"
  | "platform"
  | "accountType"
  | "priority"
  | "concurrency"
  | "testTime";

export type AutomationValueKind = "text" | "number" | "enum" | "date";
export type AutomationLogicalOperator = "and" | "or";
export type AutomationComparator =
  | "equals"
  | "notEquals"
  | "matches"
  | "notMatches"
  | "greaterOrEqual"
  | "lessOrEqual"
  | "between"
  | "outsideRange";

export interface AutomationFieldOption {
  value: AutomationField;
  label: string;
  description: string;
  valueKind: AutomationValueKind;
}

export interface AutomationOption<T extends string = string> {
  value: T;
  label: string;
  description: string;
}

export interface AutomationValueOption {
  value: string;
  label: string;
  count?: number;
}

export const AUTOMATION_FIELD_OPTIONS: readonly AutomationFieldOption[] = [
  { value: "name", label: "名称", description: "账号显示名称，支持 * 和 ? 通配符", valueKind: "text" },
  { value: "id", label: "账号 ID", description: "Sub2API 账号唯一编号", valueKind: "number" },
  { value: "planType", label: "账户类型", description: "账号订阅或账户标签，例如 free、k12", valueKind: "enum" },
  { value: "status", label: "旧状态", description: "Sub2API 当前账号运行状态", valueKind: "enum" },
  { value: "group", label: "分组", description: "账号所属分组", valueKind: "enum" },
  { value: "lastUsedAt", label: "最近使用", description: "账号最近一次使用时间", valueKind: "date" },
  { value: "createdAt", label: "创建时间", description: "账号创建时间", valueKind: "date" },
  { value: "latestTest", label: "最新测试", description: "本客户端当前会话内的最近测试状态", valueKind: "enum" },
  { value: "platform", label: "平台", description: "账号所属平台", valueKind: "enum" },
  { value: "accountType", label: "认证类型", description: "账号认证方式", valueKind: "enum" },
  { value: "priority", label: "优先级", description: "Sub2API 调度优先级", valueKind: "number" },
  { value: "concurrency", label: "并发上限", description: "Sub2API 单账号并发上限", valueKind: "number" },
  { value: "testTime", label: "测试时间", description: "本客户端最近一次测试完成时间", valueKind: "date" },
] as const;

const TEXT_COMPARATOR_OPTIONS: readonly AutomationOption<AutomationComparator>[] = [
  { value: "matches", label: "等于", description: "* 匹配任意长度文本，? 匹配单个字符" },
  { value: "notMatches", label: "不等于", description: "不匹配指定通配符模式" },
];

const NUMBER_COMPARATOR_OPTIONS: readonly AutomationOption<AutomationComparator>[] = [
  { value: "equals", label: "等于", description: "数值完全相等" },
  { value: "greaterOrEqual", label: "大于等于", description: "数值不小于输入值" },
  { value: "lessOrEqual", label: "小于等于", description: "数值不大于输入值" },
  { value: "between", label: "介于范围", description: "包含两个端点" },
  { value: "outsideRange", label: "不在范围内", description: "小于起点或大于终点" },
];

const ENUM_COMPARATOR_OPTIONS: readonly AutomationOption<AutomationComparator>[] = [
  { value: "equals", label: "等于", description: "等于所选字段值" },
  { value: "notEquals", label: "不等于", description: "不等于所选字段值" },
];

const DATE_COMPARATOR_OPTIONS: readonly AutomationOption<AutomationComparator>[] = [
  { value: "between", label: "在时间范围内", description: "包含两个时间端点" },
  { value: "outsideRange", label: "不在时间范围内", description: "早于起点或晚于终点" },
];

export const AUTOMATION_LOGICAL_OPERATOR_OPTIONS: readonly AutomationOption<AutomationLogicalOperator>[] = [
  { value: "and", label: "且", description: "所有条件都满足" },
  { value: "or", label: "或", description: "任一条件满足" },
];

export type AutomationLatestTestStatus =
  | "not_tested"
  | "testing"
  | "normal"
  | "rate_limited"
  | "connection_interrupted"
  | "error"
  | "cancelled";

export type AutomationAccountStatus =
  | "active"
  | "inactive"
  | "error"
  | "rate_limited"
  | "overloaded"
  | "temp_unschedulable"
  | "unschedulable"
  | "unknown";

export type AutomationDeleteStatus =
  | "normal"
  | "inactive"
  | "rate_limited"
  | "connection_interrupted"
  | "error"
  | "untested"
  | "cancelled"
  | "other";

export const AUTOMATION_STATUS_VALUE_OPTIONS: readonly AutomationValueOption[] = [
  { value: "active", label: "正常" },
  { value: "inactive", label: "停用" },
  { value: "error", label: "错误" },
  { value: "rate_limited", label: "限流中" },
  { value: "overloaded", label: "超载中" },
  { value: "temp_unschedulable", label: "临时不可调度" },
  { value: "unschedulable", label: "不可调度" },
  { value: "unknown", label: "未知" },
];

export const AUTOMATION_LATEST_TEST_VALUE_OPTIONS: readonly AutomationValueOption[] = [
  { value: "not_tested", label: "未测试" },
  { value: "testing", label: "测试中" },
  { value: "normal", label: "正常" },
  { value: "rate_limited", label: "限流中" },
  { value: "connection_interrupted", label: "连接异常" },
  { value: "error", label: "错误" },
  { value: "cancelled", label: "已取消" },
];

export const AUTOMATION_DELETE_STATUS_OPTIONS: readonly AutomationOption<AutomationDeleteStatus>[] = [
  { value: "normal", label: "正常", description: "测试正常或旧状态正常的账号" },
  { value: "inactive", label: "停用", description: "旧状态为停用的账号" },
  { value: "rate_limited", label: "限流中", description: "测试或旧状态显示限流的账号" },
  { value: "connection_interrupted", label: "连接异常", description: "测试出现非 401、非限流的状态码、超时或 EOF 的账号" },
  { value: "error", label: "错误", description: "测试返回 401，或旧状态为错误的账号" },
  { value: "untested", label: "未测试", description: "尚未得到可用测试结果的账号" },
  { value: "cancelled", label: "已取消", description: "测试被取消的账号" },
  { value: "other", label: "其他状态", description: "未归入上述分类的账号" },
];

export interface AutomationRangeValue {
  start: string;
  end: string;
}

/** A collision-safe account-type filter value from the shared account catalog. */
export interface AutomationAccountPlanTypeFilterValue {
  kind: "accountPlanTypeFilter";
  value: string;
}

export type AutomationConditionValue = string | number | AutomationRangeValue | AutomationAccountPlanTypeFilterValue;

export function automationAccountPlanTypeFilterValue(value: string): AutomationAccountPlanTypeFilterValue {
  return { kind: "accountPlanTypeFilter", value };
}

export function isAutomationAccountPlanTypeFilterValue(
  value: unknown,
): value is AutomationAccountPlanTypeFilterValue {
  return isRecord(value)
    && value.kind === "accountPlanTypeFilter"
    && isAccountPlanTypeFilterToken(value.value);
}

export interface AutomationCondition {
  kind: "condition";
  id: string;
  /** Relation with the preceding sibling. The first sibling has no relation. */
  joinWithPrevious?: AutomationLogicalOperator;
  field: AutomationField;
  operator: AutomationComparator;
  value: AutomationConditionValue;
}

export interface AutomationConditionGroup {
  kind: "group";
  id: string;
  /** Relation with the preceding sibling. The root group has no relation. */
  joinWithPrevious?: AutomationLogicalOperator;
  children: AutomationConditionNode[];
}

export type AutomationConditionNode = AutomationCondition | AutomationConditionGroup;

export type AutomationActionKind =
  | "moveGroup"
  | "deleteAccounts"
  | "exportAccounts"
  | "setPriority"
  | "setConcurrency"
  | "rename"
  | "exportReport";

export interface AutomationActionBase {
  id: string;
  kind: AutomationActionKind;
}

export interface AutomationMoveGroupAction extends AutomationActionBase {
  kind: "moveGroup";
  /** Official Sub2API group ID. The name is a UI fallback only. */
  groupId: number | null;
  groupName?: string;
}

export interface AutomationDeleteAccountsAction extends AutomationActionBase {
  kind: "deleteAccounts";
  /** Only these final statuses can be deleted. The conservative default is error. */
  targetStatuses: AutomationDeleteStatus[];
}

export type AutomationAccountExportFormat = "sub2api" | "cpa";

export interface AutomationExportAccountsAction extends AutomationActionBase {
  kind: "exportAccounts";
  format: AutomationAccountExportFormat;
  includeProxies: boolean;
  directory: string;
  fileNameTemplate: string;
}

export interface AutomationSetPriorityAction extends AutomationActionBase {
  kind: "setPriority";
  priority: number | null;
}

export interface AutomationSetConcurrencyAction extends AutomationActionBase {
  kind: "setConcurrency";
  concurrency: number | null;
}

export interface AutomationRenameAction extends AutomationActionBase {
  kind: "rename";
  template: string;
  startIndex: number;
  padding: number;
}

export interface AutomationExportReportAction extends AutomationActionBase {
  kind: "exportReport";
  directory: string;
  fileNameTemplate: string;
  columns: string[];
}

export type AutomationAction =
  | AutomationMoveGroupAction
  | AutomationDeleteAccountsAction
  | AutomationExportAccountsAction
  | AutomationSetPriorityAction
  | AutomationSetConcurrencyAction
  | AutomationRenameAction
  | AutomationExportReportAction;

export const AUTOMATION_ACTION_OPTIONS: readonly AutomationOption<AutomationActionKind>[] = [
  { value: "moveGroup", label: "移动到分组", description: "将筛选出的账号移动到同平台分组" },
  { value: "deleteAccounts", label: "删除账号", description: "仅删除所选状态的账号，默认仅错误账号" },
  { value: "exportAccounts", label: "导出账号", description: "按 Sub2API JSON 或 CPA 格式导出账号" },
  { value: "setPriority", label: "设置优先级", description: "统一设置账号调度优先级" },
  { value: "setConcurrency", label: "设置账号并发", description: "统一设置单个账号并发上限" },
  { value: "rename", label: "重命名", description: "根据名称模板批量重命名账号" },
  { value: "exportReport", label: "导出测活报告", description: "按所选字段生成 Excel 测活报告" },
];

export interface AutomationRefreshStep {
  id: string;
  kind: "refresh";
}

export interface AutomationConditionalStep {
  id: string;
  kind: "conditional";
  condition: AutomationConditionGroup;
  actions: AutomationAction[];
}

export type AutomationStep = AutomationRefreshStep | AutomationConditionalStep;
export type AutomationStepKind = AutomationStep["kind"];

export const AUTOMATION_STEP_OPTIONS: readonly AutomationOption<AutomationStepKind>[] = [
  { value: "refresh", label: "刷新账号数据", description: "在此位置刷新账号、分组和最新状态" },
  { value: "conditional", label: "条件操作", description: "满足条件的账号执行一个或多个批量操作" },
];

export interface AutomationRule {
  version: typeof AUTOMATION_RULE_VERSION;
  id: string;
  name: string;
  /** Kept for v1 storage compatibility; the editor now writes this as true. */
  enabled: boolean;
  /** Null means only the user-triggered execute button can run the rule. */
  intervalSeconds: number | null;
  steps: AutomationStep[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationStorageProfile {
  serverUrl?: string | null;
  email?: string | null;
}

/** A profile identity isolates client-only rules between servers and logins. */
export type AutomationStorageScope = string | AutomationStorageProfile | null | undefined;

export interface AutomationEvaluationContext {
  testStates?: Readonly<Record<number, TestRowState>>;
  now?: number;
}

export interface AutomationRuleTarget {
  step: AutomationConditionalStep;
  action: AutomationAction;
  accounts: Account[];
}

export interface AutomationValidationIssue {
  path: string;
  message: string;
}

const EMPTY_TEST_STATES: Readonly<Record<number, TestRowState>> = {};
const FALLBACK_AUTOMATION_SCOPE = "default";
const MAX_TEXT_VALUE_LENGTH = 512;
const MAX_NAME_LENGTH = 100;
const MAX_TEMPLATE_LENGTH = 255;
const MAX_COLUMNS_PER_REPORT = 64;
const VALID_FIELDS = new Set<AutomationField>(AUTOMATION_FIELD_OPTIONS.map((option) => option.value));
const VALID_ACTION_KINDS = new Set<AutomationActionKind>(AUTOMATION_ACTION_OPTIONS.map((option) => option.value));
const VALID_DELETE_STATUSES = new Set<AutomationDeleteStatus>(AUTOMATION_DELETE_STATUS_OPTIONS.map((option) => option.value));
/** Reports intentionally use exactly the same known field IDs as table columns. */
const VALID_REPORT_COLUMNS = new Set<string>(ACCOUNT_TABLE_COLUMNS.map((column) => column.id));
const optionCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function createDefaultAutomationRule(): AutomationRule {
  const timestamp = new Date().toISOString();
  return {
    version: AUTOMATION_RULE_VERSION,
    id: createAutomationId("rule"),
    name: "未命名自动化",
    enabled: true,
    intervalSeconds: null,
    steps: [createDefaultAutomationStep("conditional")],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createDefaultAutomationStep(kind: AutomationStepKind = "conditional"): AutomationStep {
  if (kind === "refresh") {
    return { id: createAutomationId("step"), kind: "refresh" };
  }

  return {
    id: createAutomationId("step"),
    kind: "conditional",
    condition: createDefaultAutomationConditionGroup(),
    actions: [createDefaultAutomationAction()],
  };
}

export function createDefaultAutomationCondition(joinWithPrevious?: AutomationLogicalOperator): AutomationCondition {
  return {
    kind: "condition",
    id: createAutomationId("condition"),
    ...(joinWithPrevious ? { joinWithPrevious } : {}),
    field: "name",
    operator: "matches",
    // An empty pattern is intentionally invalid, preventing a newly added rule
    // from accidentally selecting every account.
    value: "",
  };
}

export function createDefaultAutomationConditionGroup(joinWithPrevious?: AutomationLogicalOperator): AutomationConditionGroup {
  return {
    kind: "group",
    id: createAutomationId("group"),
    ...(joinWithPrevious ? { joinWithPrevious } : {}),
    children: [createDefaultAutomationCondition()],
  };
}

export function createDefaultAutomationAction(kind: AutomationActionKind = "deleteAccounts"): AutomationAction {
  const id = createAutomationId("action");
  switch (kind) {
    case "moveGroup":
      return { id, kind, groupId: null };
    case "deleteAccounts":
      return { id, kind, targetStatuses: ["error"] };
    case "exportAccounts":
      return {
        id,
        kind,
        format: "sub2api",
        includeProxies: true,
        directory: "",
        fileNameTemplate: "账号导出-{format}-{datetime}-{count}",
      };
    case "setPriority":
      return { id, kind, priority: null };
    case "setConcurrency":
      return { id, kind, concurrency: null };
    case "rename":
      return { id, kind, template: "{{name}}", startIndex: 1, padding: 2 };
    case "exportReport":
      return {
        id,
        kind,
        directory: "",
        fileNameTemplate: "批量测活-{datetime}-{count}",
        columns: [...DEFAULT_REPORT_COLUMNS],
      };
  }
}

export function getAutomationFieldOption(field: AutomationField): AutomationFieldOption {
  return AUTOMATION_FIELD_OPTIONS.find((option) => option.value === field) ?? AUTOMATION_FIELD_OPTIONS[0];
}

export function getAutomationFieldValueKind(field: AutomationField): AutomationValueKind {
  return getAutomationFieldOption(field).valueKind;
}

export function getAutomationComparatorOptions(field: AutomationField): readonly AutomationOption<AutomationComparator>[] {
  switch (getAutomationFieldValueKind(field)) {
    case "text":
      return TEXT_COMPARATOR_OPTIONS;
    case "number":
      return NUMBER_COMPARATOR_OPTIONS;
    case "date":
      return DATE_COMPARATOR_OPTIONS;
    case "enum":
      return ENUM_COMPARATOR_OPTIONS;
  }
}

export function isAutomationComparatorAllowed(field: AutomationField, comparator: AutomationComparator): boolean {
  return getAutomationComparatorOptions(field).some((option) => option.value === comparator);
}

/**
 * Returns select-ready values for fields whose values come from current local
 * account data. The return shape is intentionally independent from UI code.
 */
export function getAutomationFieldValueOptions(
  field: AutomationField,
  accounts: readonly Account[] = [],
  testStates: Readonly<Record<number, TestRowState>> = EMPTY_TEST_STATES,
): AutomationValueOption[] {
  if (field === "status") return AUTOMATION_STATUS_VALUE_OPTIONS.map(cloneValueOption);
  if (field === "latestTest") return AUTOMATION_LATEST_TEST_VALUE_OPTIONS.map(cloneValueOption);
  if (getAutomationFieldValueKind(field) !== "enum") return [];

  const values = new Map<string, AutomationValueOption>();
  for (const account of accounts) {
    const rawValues = getAutomationFieldValues(account, field, testStates);
    for (const rawValue of rawValues) {
      if (typeof rawValue !== "string" || !rawValue.trim()) continue;
      const key = normalizeEnumValue(rawValue);
      const current = values.get(key);
      if (current) {
        current.count = (current.count ?? 0) + 1;
      } else {
        values.set(key, { value: rawValue, label: rawValue, count: 1 });
      }
    }
  }

  return [...values.values()].sort((left, right) => optionCollator.compare(left.label, right.label));
}

/** Resolves field values in one place so editor previews and execution agree. */
export function getAutomationFieldValues(
  account: Account,
  field: AutomationField,
  testStates: Readonly<Record<number, TestRowState>> = EMPTY_TEST_STATES,
  now?: number,
): Array<string | number> {
  const testState = testStates[account.id];
  switch (field) {
    case "name":
      return account.name?.trim() ? [account.name.trim()] : [];
    case "id":
      return Number.isSafeInteger(account.id) ? [account.id] : [];
    case "planType":
      return account.planType?.trim() ? [account.planType.trim()] : [];
    case "status":
      return [getAccountRuntimeStatus(account, now)];
    case "group":
      {
        const groupValues = (account.groupIds ?? [])
        .filter((groupId): groupId is number => Number.isSafeInteger(groupId) && groupId > 0)
        .map(automationGroupConditionValue);
        return groupValues.length ? groupValues : [AUTOMATION_UNGROUPED_GROUP_VALUE];
      }
    case "lastUsedAt":
      return account.lastUsedAt?.trim() ? [account.lastUsedAt] : [];
    case "createdAt":
      return account.createdAt?.trim() ? [account.createdAt] : [];
    case "latestTest":
      return [getAutomationLatestTestStatus(testState)];
    case "platform":
      return account.platform?.trim() ? [account.platform.trim()] : [];
    case "accountType":
      return account.accountType?.trim() ? [account.accountType.trim()] : [];
    case "priority":
      return finiteNumberValues(account.priority);
    case "concurrency":
      return finiteNumberValues(account.concurrency);
    case "testTime":
      return testState?.testedAt?.trim() ? [testState.testedAt] : [];
  }
}

export function getAutomationLatestTestStatus(testState: TestRowState | undefined): AutomationLatestTestStatus {
  if (!testState) return "not_tested";
  switch (testState.status) {
    case "succeeded":
      return "normal";
    case "quotaExhausted":
      return "rate_limited";
    case "connectionInterrupted":
      return "connection_interrupted";
    case "failed":
      return "error";
    case "cancelled":
      return "cancelled";
    case "queued":
    case "testing":
      return "testing";
  }
}

/**
 * Evaluates a single condition. Invalid or incomplete conditions never match,
 * which is important for an editor whose default field value is blank.
 */
export function evaluateAutomationCondition(
  condition: AutomationCondition,
  account: Account,
  context: AutomationEvaluationContext = {},
): boolean {
  if (!isAutomationConditionComplete(condition)) return false;

  if (condition.field === "planType" && isAutomationAccountPlanTypeFilterValue(condition.value)) {
    const matches = matchesAccountPlanTypeFilter(account.planType, condition.value.value);
    return condition.operator === "equals"
      ? matches
      : condition.operator === "notEquals" && !matches;
  }

  const values = getAutomationFieldValues(account, condition.field, context.testStates ?? EMPTY_TEST_STATES, context.now);
  if (!values.length) return false;
  const kind = getAutomationFieldValueKind(condition.field);

  switch (kind) {
    case "text":
      return evaluateTextCondition(values, condition.operator, condition.value);
    case "number":
      return evaluateNumberCondition(values, condition.operator, condition.value);
    case "date":
      return evaluateDateCondition(values, condition.operator, condition.value);
    case "enum":
      return evaluateEnumCondition(values, condition.operator, condition.value);
  }
}

export function evaluateAutomationConditionNode(
  node: AutomationConditionNode,
  account: Account,
  context: AutomationEvaluationContext = {},
): boolean {
  return evaluateAutomationConditionNodeAtDepth(node, account, context, 0, true);
}

function evaluateAutomationConditionNodeAtDepth(
  node: AutomationConditionNode,
  account: Account,
  context: AutomationEvaluationContext,
  depth: number,
  isRoot: boolean,
): boolean {
  if (!isAutomationConditionNodeExecutable(node, depth, isRoot)) return false;
  if (node.kind === "condition") return evaluateAutomationCondition(node, account, context);

  return evaluateJoinedConditionNodes(
    node.children,
    (child) => evaluateAutomationConditionNodeAtDepth(child, account, context, depth + 1, false),
  );
}

export function evaluateAutomationConditionGroup(
  group: AutomationConditionGroup,
  account: Account,
  context: AutomationEvaluationContext = {},
): boolean {
  if (!isRecord(group) || group.kind !== "group") return false;
  return evaluateAutomationConditionNode(group, account, context);
}

function getJoinWithPrevious(node: unknown, index: number): AutomationLogicalOperator | null {
  if (!isRecord(node)) return null;
  if (index === 0) return hasOwn(node, "joinWithPrevious") ? null : "and";
  return hasOwn(node, "joinWithPrevious") && (node.joinWithPrevious === "and" || node.joinWithPrevious === "or")
    ? node.joinWithPrevious
    : null;
}

/** Evaluates `且` before `或`; nested groups provide explicit parentheses. */
function evaluateJoinedConditionNodes(
  nodes: readonly AutomationConditionNode[],
  evaluateNode: (node: AutomationConditionNode) => boolean,
): boolean {
  if (!nodes.length || getJoinWithPrevious(nodes[0]!, 0) === null) return false;

  let conjunction = evaluateNode(nodes[0]!);
  let disjunction = false;
  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const joinWithPrevious = getJoinWithPrevious(node, index);
    if (joinWithPrevious === null) return false;
    const matches = evaluateNode(node);
    if (joinWithPrevious === "and") {
      conjunction = conjunction && matches;
    } else {
      disjunction = disjunction || conjunction;
      conjunction = matches;
    }
  }
  return disjunction || conjunction;
}

const NO_PLATFORM_CONSTRAINT = Symbol("no-platform-constraint");
const IMPOSSIBLE_PLATFORM_CONSTRAINT = Symbol("impossible-platform-constraint");
type AutomationPlatformConstraint = string | typeof NO_PLATFORM_CONSTRAINT | typeof IMPOSSIBLE_PLATFORM_CONSTRAINT;

/**
 * Returns a platform only when every account matched by the expression is
 * guaranteed to be on that platform. This keeps automatic group moves scoped
 * to one official Sub2API platform.
 */
export function getAutomationConditionPlatformConstraint(node: AutomationConditionNode): string | null {
  if (!isAutomationConditionNodeExecutable(node, 0, true)) return null;
  const constraint = resolveAutomationPlatformConstraint(node);
  return typeof constraint === "string" ? constraint : null;
}

function resolveAutomationPlatformConstraint(
  node: AutomationConditionNode,
  depth = 0,
): AutomationPlatformConstraint {
  if (node.kind === "condition") {
    return node.field === "platform"
      && node.operator === "equals"
      && typeof node.value === "string"
      && node.value.trim()
      ? node.value.trim().toLocaleLowerCase()
      : NO_PLATFORM_CONSTRAINT;
  }
  if (depth >= MAX_AUTOMATION_CONDITION_DEPTH || !node.children.length || getJoinWithPrevious(node.children[0]!, 0) === null) {
    return NO_PLATFORM_CONSTRAINT;
  }

  let conjunction = resolveAutomationPlatformConstraint(node.children[0]!, depth + 1);
  let disjunction: AutomationPlatformConstraint = IMPOSSIBLE_PLATFORM_CONSTRAINT;
  for (let index = 1; index < node.children.length; index += 1) {
    const child = node.children[index]!;
    const joinWithPrevious = getJoinWithPrevious(child, index);
    if (joinWithPrevious === null) return NO_PLATFORM_CONSTRAINT;
    const constraint = resolveAutomationPlatformConstraint(child, depth + 1);
    if (joinWithPrevious === "and") {
      conjunction = combineAutomationPlatformAnd(conjunction, constraint);
    } else {
      disjunction = combineAutomationPlatformOr(disjunction, conjunction);
      conjunction = constraint;
    }
  }
  return combineAutomationPlatformOr(disjunction, conjunction);
}

function combineAutomationPlatformAnd(
  left: AutomationPlatformConstraint,
  right: AutomationPlatformConstraint,
): AutomationPlatformConstraint {
  if (left === IMPOSSIBLE_PLATFORM_CONSTRAINT || right === IMPOSSIBLE_PLATFORM_CONSTRAINT) return IMPOSSIBLE_PLATFORM_CONSTRAINT;
  if (left === NO_PLATFORM_CONSTRAINT) return right;
  if (right === NO_PLATFORM_CONSTRAINT) return left;
  return left === right ? left : IMPOSSIBLE_PLATFORM_CONSTRAINT;
}

function combineAutomationPlatformOr(
  left: AutomationPlatformConstraint,
  right: AutomationPlatformConstraint,
): AutomationPlatformConstraint {
  if (left === IMPOSSIBLE_PLATFORM_CONSTRAINT) return right;
  if (right === IMPOSSIBLE_PLATFORM_CONSTRAINT) return left;
  return typeof left === "string" && left === right ? left : NO_PLATFORM_CONSTRAINT;
}

export function filterAccountsForAutomation(
  accounts: readonly Account[],
  condition: AutomationConditionGroup,
  context: AutomationEvaluationContext = {},
): Account[] {
  return accounts.filter((account) => evaluateAutomationConditionGroup(condition, account, context));
}

/**
 * Latest-test status and test time are intentionally session-only. A rule
 * containing either field must not resume an automatic schedule after the
 * renderer has restarted and forgotten those outcomes.
 */
export function automationRuleUsesSessionTestState(rule: AutomationRule): boolean {
  return rule.steps.some((step) => (
    step.kind === "conditional" && automationConditionUsesSessionTestState(step.condition)
  ));
}

export function automationConditionUsesSessionTestState(node: AutomationConditionNode): boolean {
  if (!isRecord(node)) return false;
  if (node.kind === "condition") {
    return node.field === "latestTest" || node.field === "testTime";
  }
  return node.kind === "group" && Array.isArray(node.children)
    ? node.children.some((child) => automationConditionUsesSessionTestState(child as AutomationConditionNode))
    : false;
}

/** Applies the conservative delete-status setting to an already matched set. */
export function filterAccountsForAutomationAction(
  accounts: readonly Account[],
  action: AutomationAction,
  context: AutomationEvaluationContext = {},
): Account[] {
  if (action.kind !== "deleteAccounts") return [...accounts];
  const allowed = new Set(action.targetStatuses);
  return accounts.filter((account) => allowed.has(getAutomationDeleteStatus(account, context.testStates?.[account.id])));
}

export function getAutomationDeleteStatus(account: Account, testState: TestRowState | undefined): AutomationDeleteStatus {
  // The refreshed server-side status is authoritative for destructive work.
  // A client-side result can be old by the time a timer fires, so it may only
  // classify accounts whose current Sub2API state is genuinely unknown.
  switch (getAccountRuntimeStatus(account)) {
    case "active":
      return "normal";
    case "inactive":
      return "inactive";
    case "rate_limited":
      return "rate_limited";
    case "error":
      return "error";
    case "overloaded":
    case "temp_unschedulable":
    case "unschedulable":
      return "other";
    case "unknown":
      break;
  }

  if (testState) {
    switch (getAutomationLatestTestStatus(testState)) {
      case "normal":
        return "normal";
      case "rate_limited":
        return "rate_limited";
      case "connection_interrupted":
        return "connection_interrupted";
      case "error":
        return "error";
      case "cancelled":
        return "cancelled";
      case "not_tested":
      case "testing":
        return "untested";
    }
  }
  return "other";
}

/** Returns actionable account sets for each conditional action in a rule. */
export function collectAutomationRuleTargets(
  rule: AutomationRule,
  accounts: readonly Account[],
  context: AutomationEvaluationContext = {},
): AutomationRuleTarget[] {
  // Callers may invoke this helper before the editor has persisted a draft.
  // Never let a partial or malformed rule produce an action target.
  if (!isAutomationRuleExecutable(rule)) return [];
  const targets: AutomationRuleTarget[] = [];
  for (const step of rule.steps) {
    if (step.kind !== "conditional") continue;
    const matched = filterAccountsForAutomation(accounts, step.condition, context);
    for (const action of step.actions) {
      targets.push({
        step,
        action,
        accounts: filterAccountsForAutomationAction(matched, action, context),
      });
    }
  }
  return targets;
}

export function isAutomationConditionComplete(condition: AutomationCondition): boolean {
  if (!isRecord(condition)
    || condition.kind !== "condition"
    || !isAutomationFieldValue(condition.field)
    || typeof condition.operator !== "string"
    || !hasOwn(condition, "value")) {
    return false;
  }
  if (!isAutomationComparatorAllowed(condition.field, condition.operator)) return false;
  const kind = getAutomationFieldValueKind(condition.field);
  if (kind === "text") {
    if (typeof condition.value !== "string" || !condition.value.trim()) return false;
    return true;
  }
  if (kind === "enum") {
    if (condition.field === "planType" && isAutomationAccountPlanTypeFilterValue(condition.value)) return true;
    if (typeof condition.value !== "string" || !condition.value.trim()) return false;
    return condition.field !== "group"
      || groupIdFromAutomationConditionValue(condition.value) !== null
      || condition.value === AUTOMATION_UNGROUPED_GROUP_VALUE;
  }
  if (kind === "number") {
    if (condition.operator === "between" || condition.operator === "outsideRange") {
      const range = toNumericRange(condition.value);
      return range !== null;
    }
    return toFiniteNumber(condition.value) !== null;
  }

  const range = toDateRange(condition.value);
  return range !== null;
}

/**
 * Evaluation is intentionally stricter than display-only tree traversal. A
 * persisted legacy group must first pass normalization, and every executable
 * edge must carry its own connector. This prevents malformed JSON from being
 * interpreted as an implicit AND expression.
 */
function isAutomationConditionNodeExecutable(
  node: unknown,
  depth: number,
  isRoot: boolean,
): node is AutomationConditionNode {
  if (!isRecord(node)) return false;
  if (node.kind === "condition") return isAutomationConditionComplete(node as unknown as AutomationCondition);
  if (node.kind !== "group" || depth >= MAX_AUTOMATION_CONDITION_DEPTH) return false;
  if (hasOwn(node, "operator") || (isRoot && hasOwn(node, "joinWithPrevious"))) return false;
  if (!Array.isArray(node.children)
    || !node.children.length
    || node.children.length > MAX_AUTOMATION_CONDITIONS_PER_GROUP) {
    return false;
  }

  return node.children.every((child, index) => (
    getJoinWithPrevious(child, index) !== null
    && isAutomationConditionNodeExecutable(child, depth + 1, false)
  ));
}

export function getAutomationValidationIssues(rule: AutomationRule): AutomationValidationIssue[] {
  try {
    return collectAutomationValidationIssues(rule);
  } catch {
    // Rules normally arrive through normalizeAutomationRule. Keep this guard
    // for direct callers so a corrupt in-memory draft can never become an
    // executable account operation merely because validation threw first.
    return [{ path: "rule", message: "自动化规则格式无效。" }];
  }
}

function collectAutomationValidationIssues(rule: AutomationRule): AutomationValidationIssue[] {
  const issues: AutomationValidationIssue[] = [];
  if (!rule.name.trim()) {
    issues.push({ path: "name", message: "请输入自动化名称。" });
  }
  if (!rule.steps.length) {
    issues.push({ path: "steps", message: "请至少添加一个自动化步骤。" });
  }
  if (rule.steps.length > MAX_AUTOMATION_STEPS_PER_RULE) {
    issues.push({ path: "steps", message: `单个自动化最多包含 ${MAX_AUTOMATION_STEPS_PER_RULE} 个步骤。` });
  }
  if (rule.intervalSeconds !== null && !isValidInterval(rule.intervalSeconds)) {
    issues.push({ path: "intervalSeconds", message: `自动执行间隔必须是 ${MIN_AUTOMATION_INTERVAL_SECONDS} 到 ${MAX_AUTOMATION_INTERVAL_SECONDS} 秒之间的整数。` });
  }

  for (const [stepIndex, step] of rule.steps.entries()) {
    if (step.kind === "refresh") continue;
    if (step.kind !== "conditional") {
      issues.push({ path: `steps.${stepIndex}`, message: "自动化步骤类型无效。" });
      continue;
    }
    if (!isRecord(step.condition) || step.condition.kind !== "group") {
      issues.push({ path: `steps.${stepIndex}.condition`, message: "条件根节点必须是条件组。" });
    } else {
      collectConditionValidationIssues(step.condition, `steps.${stepIndex}.condition`, issues);
    }
    if (!step.actions.length) {
      issues.push({ path: `steps.${stepIndex}.actions`, message: "条件操作至少需要一个执行动作。" });
    }
    if (step.actions.length > MAX_AUTOMATION_ACTIONS_PER_STEP) {
      issues.push({ path: `steps.${stepIndex}.actions`, message: `单个条件步骤最多包含 ${MAX_AUTOMATION_ACTIONS_PER_STEP} 个动作。` });
    }
    for (const [actionIndex, action] of step.actions.entries()) {
      collectActionValidationIssues(action, `steps.${stepIndex}.actions.${actionIndex}`, issues);
    }
  }
  return issues;
}

export function isAutomationRuleExecutable(rule: AutomationRule): boolean {
  return getAutomationValidationIssues(rule).length === 0;
}

/** Concise card text for the automation list; it never reveals account credentials. */
export function summarizeAutomationRule(rule: AutomationRule): string {
  if (!rule.steps.length) return "尚未配置步骤";

  return rule.steps.map((step) => {
    if (step.kind === "refresh") return "刷新账号数据";
    const condition = summarizeAutomationConditionNode(step.condition);
    const actions = step.actions.length
      ? step.actions.map(summarizeAutomationAction).join("、")
      : "未设置动作";
    return `如果 ${condition}，执行 ${actions}`;
  }).join("；");
}

export function summarizeAutomationAction(action: AutomationAction): string {
  switch (action.kind) {
    case "moveGroup":
      return action.groupName?.trim() ? `移动到分组 ${action.groupName.trim()}` : "移动到分组";
    case "deleteAccounts":
      return `删除 ${action.targetStatuses.map(deleteStatusLabel).join("、") || "错误"} 账号`;
    case "exportAccounts":
      return `导出账号（${action.format === "cpa" ? "CPA" : "Sub2API"}）`;
    case "setPriority":
      return action.priority === null ? "设置优先级" : `设置优先级为 ${action.priority}`;
    case "setConcurrency":
      return action.concurrency === null ? "设置账号并发" : `设置账号并发为 ${action.concurrency}`;
    case "rename":
      return "批量重命名";
    case "exportReport":
      return "导出测活报告";
  }
}

/** Uses the same tokens as the existing batch-rename dialog. */
export function renderAutomationRename(
  template: string,
  account: Pick<Account, "id" | "name">,
  offset: number,
  startIndex: number,
  padding: number,
): string {
  const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const safeStartIndex = Number.isSafeInteger(startIndex) && startIndex > 0 ? startIndex : 1;
  const safePadding = Number.isSafeInteger(padding) ? Math.min(Math.max(padding, 0), 12) : 0;
  const index = String(safeStartIndex + safeOffset).padStart(safePadding, "0");
  const sourceName = account.name?.trim() || "未命名账号";
  return trimToLength(template, MAX_TEMPLATE_LENGTH)
    .split("{{name}}").join(sourceName)
    .split("{{id}}").join(String(account.id))
    .split("{{index}}").join(index)
    .trim();
}

export function summarizeAutomationConditionNode(node: AutomationConditionNode): string {
  return summarizeAutomationConditionNodeInternal(node, false, 0, true);
}

function summarizeAutomationConditionNodeInternal(
  node: AutomationConditionNode,
  nested: boolean,
  depth: number,
  isRoot: boolean,
): string {
  if (!isRecord(node)) return "无效条件";
  if (node.kind === "condition") return summarizeAutomationCondition(node as AutomationCondition);
  if (node.kind !== "group" || depth >= MAX_AUTOMATION_CONDITION_DEPTH) return "条件组格式无效";
  if (hasOwn(node, "operator") || (isRoot && hasOwn(node, "joinWithPrevious"))) return "条件组格式无效";
  if (!Array.isArray(node.children) || !node.children.length) return "未设置条件";
  const summary = node.children.map((child, index) => {
    const childSummary = summarizeAutomationConditionNodeInternal(child as AutomationConditionNode, true, depth + 1, false);
    if (index === 0) return childSummary;
    const joinWithPrevious = getJoinWithPrevious(child, index);
    if (joinWithPrevious === null) return `（未设置关系）${childSummary}`;
    return joinWithPrevious === "or" ? ` 或 ${childSummary}` : ` 且 ${childSummary}`;
  }).join("");
  return nested && node.children.length > 1 ? `（${summary}）` : summary;
}

export function summarizeAutomationCondition(condition: AutomationCondition): string {
  if (!isRecord(condition) || condition.kind !== "condition" || !isAutomationFieldValue(condition.field)) {
    return "无效条件";
  }
  const field = getAutomationFieldOption(condition.field).label;
  const operator = typeof condition.operator === "string"
    ? getAutomationComparatorOptions(condition.field).find((option) => option.value === condition.operator)?.label ?? "未设置判断"
    : "未设置判断";
  const value = condition.field === "planType" && isAutomationAccountPlanTypeFilterValue(condition.value)
    ? getAccountPlanTypeFilterTokenLabel(condition.value.value)
    : condition.field === "group" && typeof condition.value === "string"
      ? summarizeAutomationGroupValue(condition.value)
      : summarizeConditionValue(condition.value);
  return value ? `${field} ${operator} ${value}` : `${field} ${operator} 未设置`;
}

/** Encodes a server-side group ID without relying on a display name. */
export function automationGroupConditionValue(groupId: number): string {
  return Number.isSafeInteger(groupId) && groupId > 0 ? `${AUTOMATION_GROUP_VALUE_PREFIX}${groupId}` : "";
}

/** Decodes only the exact private format used by the automation condition editor. */
export function groupIdFromAutomationConditionValue(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value.startsWith(AUTOMATION_GROUP_VALUE_PREFIX)) return null;
  const groupId = Number(value.slice(AUTOMATION_GROUP_VALUE_PREFIX.length));
  return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
}

function summarizeAutomationGroupValue(value: string): string {
  if (value === AUTOMATION_UNGROUPED_GROUP_VALUE) return "未分配分组";
  const groupId = groupIdFromAutomationConditionValue(value);
  return groupId === null ? "" : `分组 #${groupId}`;
}

/** Creates an isolated storage key without storing raw profile credentials. */
export function getAutomationRulesStorageKey(scope: AutomationStorageScope = undefined): string {
  return `${AUTOMATION_RULE_STORAGE_PREFIX}.${stableScopeHash(normalizeAutomationStorageScope(scope))}`;
}

export function normalizeAutomationStorageScope(scope: AutomationStorageScope = undefined): string {
  if (typeof scope === "string") {
    return scope.trim().toLocaleLowerCase() || FALLBACK_AUTOMATION_SCOPE;
  }
  if (!scope) return FALLBACK_AUTOMATION_SCOPE;

  const server = normalizeAutomationServerUrl(scope.serverUrl);
  const email = typeof scope.email === "string" ? scope.email.trim().toLocaleLowerCase() : "";
  return `${server || "unknown-server"}|${email || "unknown-email"}`;
}

/** Safe read: malformed, unavailable, or stale storage cannot stop the app. */
export function readAutomationRules(scope: AutomationStorageScope = undefined): AutomationRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getAutomationRulesStorageKey(scope));
    return raw ? normalizeAutomationRules(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Safe write: callers retain in-memory rules if persistent storage is unavailable. */
export function persistAutomationRules(scope: AutomationStorageScope, rules: readonly AutomationRule[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    const normalized = normalizeAutomationRules(rules);
    window.localStorage.setItem(getAutomationRulesStorageKey(scope), JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function removeAutomationRules(scope: AutomationStorageScope = undefined): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(getAutomationRulesStorageKey(scope));
    return true;
  } catch {
    return false;
  }
}

export function normalizeAutomationRules(value: unknown): AutomationRule[] {
  if (!Array.isArray(value)) return [];
  const rules: AutomationRule[] = [];
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (rules.length >= MAX_AUTOMATION_RULES) break;
    const rule = normalizeAutomationRule(item, index);
    if (!rule) continue;
    while (ids.has(rule.id)) rule.id = createAutomationId("rule");
    ids.add(rule.id);
    rules.push(rule);
  }
  return rules;
}

/**
 * Accepts persisted JSON only when every condition and action can be restored
 * without changing its meaning. In particular, never drop one half of an AND
 * group or replace a missing delete status with a more permissive default.
 *
 * Empty editor values are intentionally preserved when their shape is valid:
 * validation keeps those draft rules from executing until the user completes
 * them. Malformed persisted data, however, drops the entire rule.
 */
export function normalizeAutomationRule(value: unknown, fallbackIndex = 0): AutomationRule | null {
  if (!isRecord(value) || value.version !== AUTOMATION_RULE_VERSION || typeof value.enabled !== "boolean") return null;
  if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > MAX_AUTOMATION_STEPS_PER_RULE) return null;

  const steps: AutomationStep[] = [];
  for (const rawStep of value.steps) {
    const step = normalizeAutomationStep(rawStep);
    // Do not silently remove malformed steps. A surviving step could otherwise
    // write to accounts under a different condition than the user configured.
    if (!step) return null;
    steps.push(step);
  }

  const now = new Date().toISOString();
  // The editor now models scheduling solely through intervalSeconds. Preserve
  // old paused rules as manual-only instead of unexpectedly enabling them.
  const intervalSeconds = value.enabled ? normalizeInterval(value.intervalSeconds) : null;
  return {
    version: AUTOMATION_RULE_VERSION,
    id: normalizeId(value.id, `rule-${fallbackIndex + 1}`) ?? createAutomationId("rule"),
    name: trimToLength(readString(value.name) || "未命名自动化", MAX_NAME_LENGTH),
    enabled: true,
    intervalSeconds,
    steps,
    createdAt: normalizeIsoTimestamp(value.createdAt) ?? now,
    updatedAt: normalizeIsoTimestamp(value.updatedAt) ?? now,
  };
}

export function normalizeAutomationStep(value: unknown): AutomationStep | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id, "step") ?? createAutomationId("step");
  if (value.kind === "refresh") return { id, kind: "refresh" };
  if (value.kind !== "conditional") return null;
  if (!Array.isArray(value.actions) || !value.actions.length || value.actions.length > MAX_AUTOMATION_ACTIONS_PER_STEP) return null;

  const condition = normalizeAutomationConditionGroup(value.condition);
  if (!condition) return null;

  const actions: AutomationAction[] = [];
  for (const rawAction of value.actions) {
    const action = normalizeAutomationAction(rawAction);
    // One missing action is enough to change the sequence of writes, so do not
    // preserve a partial step from local storage.
    if (!action) return null;
    actions.push(action);
  }

  return {
    id,
    kind: "conditional",
    condition,
    actions,
  };
}

export function normalizeAutomationAction(value: unknown): AutomationAction | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !VALID_ACTION_KINDS.has(value.kind as AutomationActionKind)) {
    return null;
  }
  const kind = value.kind as AutomationActionKind;
  const id = normalizeId(value.id, "action") ?? createAutomationId("action");
  switch (kind) {
    case "moveGroup": {
      if (!hasOwn(value, "groupId") || (value.groupId !== null && positiveSafeInteger(value.groupId) === null)) return null;
      const groupName = hasOwn(value, "groupName") ? normalizeOptionalShortString(value.groupName) : undefined;
      if (groupName === null) return null;
      return {
        id,
        kind,
        groupId: positiveSafeInteger(value.groupId),
        ...(groupName ? { groupName } : {}),
      };
    }
    case "deleteAccounts": {
      const targetStatuses = normalizeDeleteStatuses(value.targetStatuses);
      if (!targetStatuses) return null;
      return {
        id,
        kind,
        targetStatuses,
      };
    }
    case "exportAccounts": {
      const directory = normalizeRequiredTemplateString(value.directory);
      const fileNameTemplate = normalizeRequiredTemplateString(value.fileNameTemplate);
      if ((value.format !== "sub2api" && value.format !== "cpa") || typeof value.includeProxies !== "boolean" || directory === null || fileNameTemplate === null) {
        return null;
      }
      return {
        id,
        kind,
        format: value.format,
        includeProxies: value.includeProxies,
        directory,
        fileNameTemplate,
      };
    }
    case "setPriority": {
      const priority = normalizeNullableNonNegativeInteger(value, "priority");
      return priority === undefined ? null : { id, kind, priority };
    }
    case "setConcurrency": {
      const concurrency = normalizeNullableNonNegativeInteger(value, "concurrency");
      return concurrency === undefined ? null : { id, kind, concurrency };
    }
    case "rename": {
      const template = normalizeRequiredTemplateString(value.template);
      const startIndex = positiveSafeInteger(value.startIndex);
      const padding = boundedInteger(value.padding, 0, 12);
      if (template === null || startIndex === null || padding === null) return null;
      return {
        id,
        kind,
        template,
        startIndex,
        padding,
      };
    }
    case "exportReport": {
      const directory = normalizeRequiredTemplateString(value.directory);
      const fileNameTemplate = normalizeRequiredTemplateString(value.fileNameTemplate);
      const columns = normalizeColumns(value.columns);
      if (directory === null || fileNameTemplate === null || columns === null) return null;
      return {
        id,
        kind,
        directory,
        fileNameTemplate,
        columns,
      };
    }
  }
}

export function normalizeAutomationConditionGroup(
  value: unknown,
  depth = 0,
  isRoot = depth === 0,
): AutomationConditionGroup | null {
  if (!isRecord(value) || value.kind !== "group" || depth >= MAX_AUTOMATION_CONDITION_DEPTH) return null;
  if (!Array.isArray(value.children) || !value.children.length || value.children.length > MAX_AUTOMATION_CONDITIONS_PER_GROUP) {
    return null;
  }

  const legacyOperator = hasOwn(value, "operator") ? normalizeAutomationLogicalOperator(value.operator) : undefined;
  const joinWithPrevious = hasOwn(value, "joinWithPrevious") ? normalizeAutomationLogicalOperator(value.joinWithPrevious) : undefined;
  if (legacyOperator === null || joinWithPrevious === null || (isRoot && joinWithPrevious !== undefined)) return null;

  // Older v1 records used `group.operator` for every edge in that group. A
  // record must be wholly old-style or wholly per-node. Mixing the two leaves
  // no unambiguous user intent, so reject rather than choose a broader branch.
  const nonFirstChildren = value.children.slice(1);
  const hasPerNodeConnector = nonFirstChildren.some((child) => isRecord(child) && hasOwn(child, "joinWithPrevious"));
  const hasMissingPerNodeConnector = nonFirstChildren.some((child) => !isRecord(child) || !hasOwn(child, "joinWithPrevious"));
  if (legacyOperator !== undefined && hasPerNodeConnector) return null;
  if (legacyOperator === undefined && hasMissingPerNodeConnector) return null;

  const children: AutomationConditionNode[] = [];
  for (const [index, rawChild] of value.children.entries()) {
    const child = normalizeAutomationConditionNode(rawChild, depth + 1);
    // Dropping a malformed child or changing an edge relation could broaden a
    // destructive rule, so reject the entire record instead.
    if (!child) return null;
    if (index === 0) {
      if (child.joinWithPrevious !== undefined) return null;
    } else if (legacyOperator !== undefined) {
      // Convert only a pure legacy group. This preserves the old all-AND or
      // all-OR expression without flattening nested condition groups.
      child.joinWithPrevious = legacyOperator;
    } else if (child.joinWithPrevious === undefined) {
      return null;
    }
    children.push(child);
  }

  return {
    kind: "group",
    id: normalizeId(value.id, "group") ?? createAutomationId("group"),
    ...(joinWithPrevious ? { joinWithPrevious } : {}),
    children,
  };
}

export function normalizeAutomationCondition(value: unknown): AutomationCondition | null {
  if (!isRecord(value) || value.kind !== "condition" || typeof value.field !== "string") {
    return null;
  }
  const field = normalizeAutomationField(value.field);
  if (!field) return null;
  if (typeof value.operator !== "string" || !isAutomationComparatorAllowed(field, value.operator as AutomationComparator) || !hasOwn(value, "value")) {
    return null;
  }
  const operator = value.operator as AutomationComparator;
  const normalizedValue = normalizeAutomationConditionValue(field, operator, value.value);
  if (normalizedValue === null) return null;
  const joinWithPrevious = hasOwn(value, "joinWithPrevious") ? normalizeAutomationLogicalOperator(value.joinWithPrevious) : undefined;
  if (joinWithPrevious === null) return null;

  return {
    kind: "condition",
    id: normalizeId(value.id, "condition") ?? createAutomationId("condition"),
    ...(joinWithPrevious ? { joinWithPrevious } : {}),
    field,
    operator,
    value: normalizedValue,
  };
}

function normalizeAutomationLogicalOperator(value: unknown): AutomationLogicalOperator | null {
  return value === "and" || value === "or" ? value : null;
}

function normalizeAutomationField(value: string): AutomationField | null {
  // Earlier editor builds exposed the runtime current_concurrency field. The
  // automation contract is the configured per-account limit, so safely migrate
  // persisted rules to the official concurrency field during loading.
  const canonicalField = value === "currentConcurrency" ? "concurrency" : value;
  return isAutomationFieldValue(canonicalField) ? canonicalField : null;
}

function isAutomationFieldValue(value: unknown): value is AutomationField {
  return typeof value === "string" && VALID_FIELDS.has(value as AutomationField);
}

function normalizeAutomationConditionNode(value: unknown, depth: number): AutomationConditionNode | null {
  if (!isRecord(value)) return null;
  return value.kind === "group"
    ? normalizeAutomationConditionGroup(value, depth, false)
    : normalizeAutomationCondition(value);
}

function normalizeAutomationConditionValue(
  field: AutomationField,
  operator: AutomationComparator,
  value: unknown,
): AutomationConditionValue | null {
  if (field === "planType" && isAutomationAccountPlanTypeFilterValue(value)) {
    return automationAccountPlanTypeFilterValue(value.value);
  }
  const kind = getAutomationFieldValueKind(field);
  if (kind === "text" || kind === "enum") {
    return normalizeBoundedString(value, MAX_TEXT_VALUE_LENGTH);
  }
  if (kind === "number") {
    if (operator === "between" || operator === "outsideRange") {
      return normalizeRangeValue(value, false);
    }
    if (typeof value === "string" && !value.trim()) return "";
    return toFiniteNumber(value);
  }
  return normalizeRangeValue(value, true);
}

function normalizeRangeValue(value: unknown, isDate: boolean): AutomationRangeValue | null {
  if (!isRecord(value) || !hasOwn(value, "start") || !hasOwn(value, "end")) return null;
  const start = isDate ? normalizeDateConditionValue(value.start) : normalizeNumericConditionValue(value.start);
  const end = isDate ? normalizeDateConditionValue(value.end) : normalizeNumericConditionValue(value.end);
  if (start === null || end === null) return null;
  return {
    start,
    end,
  };
}

function evaluateTextCondition(values: readonly (string | number)[], operator: AutomationComparator, conditionValue: AutomationConditionValue): boolean {
  if (typeof conditionValue !== "string" || !conditionValue.trim()) return false;
  const match = (value: string | number) => wildcardMatches(String(value), conditionValue);
  return operator === "matches" ? values.some(match) : operator === "notMatches" && values.every((value) => !match(value));
}

function evaluateEnumCondition(values: readonly (string | number)[], operator: AutomationComparator, conditionValue: AutomationConditionValue): boolean {
  if (typeof conditionValue !== "string" || !conditionValue.trim()) return false;
  const expected = normalizeEnumValue(conditionValue);
  const matches = (value: string | number) => normalizeEnumValue(String(value)) === expected;
  return operator === "equals" ? values.some(matches) : operator === "notEquals" && values.every((value) => !matches(value));
}

function evaluateNumberCondition(values: readonly (string | number)[], operator: AutomationComparator, conditionValue: AutomationConditionValue): boolean {
  const numbers = values.map(toFiniteNumber).filter((value): value is number => value !== null);
  if (!numbers.length) return false;
  if (operator === "between" || operator === "outsideRange") {
    const range = toNumericRange(conditionValue);
    if (!range) return false;
    const within = (value: number) => value >= range.start && value <= range.end;
    return operator === "between" ? numbers.some(within) : numbers.every((value) => !within(value));
  }
  const expected = toFiniteNumber(conditionValue);
  if (expected === null) return false;
  switch (operator) {
    case "equals":
      return numbers.some((value) => value === expected);
    case "greaterOrEqual":
      return numbers.some((value) => value >= expected);
    case "lessOrEqual":
      return numbers.some((value) => value <= expected);
    default:
      return false;
  }
}

function evaluateDateCondition(values: readonly (string | number)[], operator: AutomationComparator, conditionValue: AutomationConditionValue): boolean {
  if (operator !== "between" && operator !== "outsideRange") return false;
  const range = toDateRange(conditionValue);
  if (!range) return false;
  const timestamps = values.map(parseAutomationDate).filter((value): value is number => value !== null);
  if (!timestamps.length) return false;
  const within = (value: number) => value >= range.start && value <= range.end;
  return operator === "between" ? timestamps.some(within) : timestamps.every((value) => !within(value));
}

function collectConditionValidationIssues(
  node: AutomationConditionNode,
  path: string,
  issues: AutomationValidationIssue[],
  depth = 0,
  isRoot = true,
) {
  if (!isRecord(node)) {
    issues.push({ path, message: "条件格式无效。" });
    return;
  }
  if (node.kind === "condition") {
    if (!isAutomationConditionComplete(node as AutomationCondition)) {
      const field = isAutomationFieldValue(node.field) ? getAutomationFieldOption(node.field).label : "未知字段";
      issues.push({ path, message: `请完整设置条件“${field}”。` });
    }
    return;
  }
  if (node.kind !== "group") {
    issues.push({ path, message: "条件节点类型无效。" });
    return;
  }
  if (hasOwn(node, "operator")) {
    issues.push({ path, message: "条件组仍使用旧版统一连接关系，请重新保存该规则。" });
  }
  if (isRoot && hasOwn(node, "joinWithPrevious")) {
    issues.push({ path, message: "根条件组不能设置连接关系。" });
  }
  if (!Array.isArray(node.children) || !node.children.length) {
    issues.push({ path, message: "条件组至少需要一个条件。" });
    return;
  }
  if (node.children.length > MAX_AUTOMATION_CONDITIONS_PER_GROUP) {
    issues.push({ path, message: `单个条件组最多包含 ${MAX_AUTOMATION_CONDITIONS_PER_GROUP} 个条件。` });
  }
  if (depth >= MAX_AUTOMATION_CONDITION_DEPTH) {
    issues.push({ path, message: "条件组嵌套层级过深。" });
    return;
  }
  node.children.forEach((child, index) => {
    if (getJoinWithPrevious(child, index) === null) {
      issues.push({ path: `${path}.children.${index}.joinWithPrevious`, message: "请设置与上一条件的关系。" });
    }
    collectConditionValidationIssues(child, `${path}.children.${index}`, issues, depth + 1, false);
  });
}

function collectActionValidationIssues(action: AutomationAction, path: string, issues: AutomationValidationIssue[]) {
  switch (action.kind) {
    case "moveGroup":
      if (!isPositiveSafeInteger(action.groupId)) issues.push({ path, message: "请选择有效的目标分组。" });
      break;
    case "deleteAccounts":
      if (!action.targetStatuses.length) issues.push({ path, message: "请至少选择一种可删除状态。" });
      else if (action.targetStatuses.some((status) => !VALID_DELETE_STATUSES.has(status))) {
        issues.push({ path, message: "删除状态包含不支持的值。" });
      }
      break;
    case "exportAccounts":
      if (action.format !== "sub2api" && action.format !== "cpa") issues.push({ path: `${path}.format`, message: "请选择有效的账号导出格式。" });
      if (typeof action.includeProxies !== "boolean") issues.push({ path: `${path}.includeProxies`, message: "代理导出设置无效。" });
      if (!action.directory.trim()) issues.push({ path: `${path}.directory`, message: "请选择账号导出目录。" });
      if (!action.fileNameTemplate.trim()) issues.push({ path: `${path}.fileNameTemplate`, message: "请输入账号导出名称模板。" });
      break;
    case "setPriority":
      if (!isNonNegativeSafeInteger(action.priority)) issues.push({ path: `${path}.priority`, message: "请输入非负整数优先级。" });
      break;
    case "setConcurrency":
      if (!isNonNegativeSafeInteger(action.concurrency)) issues.push({ path: `${path}.concurrency`, message: "请输入非负整数账号并发数。" });
      break;
    case "rename":
      if (!action.template.trim()) issues.push({ path: `${path}.template`, message: "请输入重命名模板。" });
      if (!isPositiveSafeInteger(action.startIndex)) issues.push({ path: `${path}.startIndex`, message: "重命名起始序号必须是正整数。" });
      if (!isBoundedSafeInteger(action.padding, 0, 12)) issues.push({ path: `${path}.padding`, message: "重命名补零位数必须是 0 到 12 的整数。" });
      break;
    case "exportReport":
      if (!action.directory.trim()) issues.push({ path: `${path}.directory`, message: "请选择测活报告导出目录。" });
      if (!action.fileNameTemplate.trim()) issues.push({ path: `${path}.fileNameTemplate`, message: "请输入测活报告名称模板。" });
      if (!action.columns.length) issues.push({ path: `${path}.columns`, message: "请至少选择一个测活报告字段。" });
      else if (action.columns.some((column) => !VALID_REPORT_COLUMNS.has(column))) {
        issues.push({ path: `${path}.columns`, message: "测活报告包含不支持的字段。" });
      }
      break;
    default:
      issues.push({ path, message: "执行动作类型无效。" });
  }
}

function normalizeDeleteStatuses(value: unknown): AutomationDeleteStatus[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const selected = new Set<AutomationDeleteStatus>();
  for (const status of value) {
    if (typeof status !== "string" || !VALID_DELETE_STATUSES.has(status as AutomationDeleteStatus)) return null;
    selected.add(status as AutomationDeleteStatus);
  }
  return selected.size ? [...selected] : null;
}

function normalizeColumns(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_COLUMNS_PER_REPORT) return null;
  const columns = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const column = item.trim();
    if (!column || !VALID_REPORT_COLUMNS.has(column)) return null;
    columns.add(column);
  }
  return [...columns];
}

/** Returns a trimmed string only when persisted JSON carried a string at all. */
function normalizeBoundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized : null;
}

function normalizeOptionalShortString(value: unknown): string | null {
  return normalizeBoundedString(value, MAX_NAME_LENGTH);
}

/** Empty strings are valid editor drafts; missing/non-string properties are not. */
function normalizeRequiredTemplateString(value: unknown): string | null {
  return normalizeBoundedString(value, MAX_TEMPLATE_LENGTH);
}

function normalizeNullableNonNegativeInteger(
  value: Record<string, unknown>,
  property: string,
): number | null | undefined {
  if (!hasOwn(value, property)) return undefined;
  if (value[property] === null) return null;
  return nonNegativeInteger(value[property]) ?? undefined;
}

function normalizeNumericConditionValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.length > MAX_TEXT_VALUE_LENGTH) return null;
  }
  const numeric = toFiniteNumber(value);
  return numeric === null ? null : String(numeric);
}

function normalizeDateConditionValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = typeof value === "string" ? value.trim() : String(value);
  if (!normalized) return "";
  if (normalized.length > MAX_TEXT_VALUE_LENGTH || parseAutomationDate(normalized) === null) return null;
  return normalized;
}

function normalizeInterval(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const interval = positiveSafeInteger(value);
  return interval !== null && interval >= MIN_AUTOMATION_INTERVAL_SECONDS && interval <= MAX_AUTOMATION_INTERVAL_SECONDS ? interval : null;
}

function isValidInterval(value: number): boolean {
  return Number.isSafeInteger(value) && value >= MIN_AUTOMATION_INTERVAL_SECONDS && value <= MAX_AUTOMATION_INTERVAL_SECONDS;
}

function toNumericRange(value: AutomationConditionValue): { start: number; end: number } | null {
  if (!isRangeValue(value)) return null;
  const start = toFiniteNumber(value.start);
  const end = toFiniteNumber(value.end);
  if (start === null || end === null || start > end) return null;
  return { start, end };
}

function toDateRange(value: AutomationConditionValue): { start: number; end: number } | null {
  if (!isRangeValue(value)) return null;
  const start = parseAutomationDate(value.start);
  const end = parseAutomationDate(value.end);
  if (start === null || end === null || start > end) return null;
  return { start, end };
}

function isRangeValue(value: AutomationConditionValue): value is AutomationRangeValue {
  return typeof value === "object" && value !== null && "start" in value && "end" in value;
}

function parseAutomationDate(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? normalizeDateNumber(value) : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) return normalizeDateNumber(numeric);
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeDateNumber(value: number): number {
  return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
}

function wildcardMatches(value: string, pattern: string): boolean {
  const source = pattern.trim();
  if (!source || source.length > MAX_TEXT_VALUE_LENGTH) return false;
  let expression = "^";
  for (const character of source) {
    if (character === "*") expression += ".*";
    else if (character === "?") expression += ".";
    else expression += escapeRegularExpression(character);
  }
  expression += "$";
  try {
    return new RegExp(expression, "iu").test(value.trim());
  } catch {
    return false;
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function finiteNumberValues(value: number | null | undefined): number[] {
  return typeof value === "number" && Number.isFinite(value) ? [value] : [];
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveSafeInteger(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  return numeric !== null && Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  return numeric !== null && Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const numeric = toFiniteNumber(value);
  return numeric !== null && Number.isSafeInteger(numeric) && numeric >= minimum && numeric <= maximum ? numeric : null;
}

function isBoundedSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function normalizeEnumValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function cloneValueOption(option: AutomationValueOption): AutomationValueOption {
  return { ...option };
}

function deleteStatusLabel(status: AutomationDeleteStatus): string {
  return AUTOMATION_DELETE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function summarizeConditionValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  if (!isRecord(value) || typeof value.start !== "string" || typeof value.end !== "string") return "";
  const start = value.start.trim();
  const end = value.end.trim();
  return start && end ? `${start} 至 ${end}` : "";
}

function normalizeAutomationServerUrl(value: string | null | undefined): string {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source) return "";
  try {
    const url = new URL(source);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.protocol.toLocaleLowerCase()}//${url.host.toLocaleLowerCase()}${pathname}`;
  } catch {
    return source.replace(/\/+$/, "").toLocaleLowerCase();
  }
}

function stableScopeHash(value: string): string {
  // FNV-1a keeps the localStorage key compact and avoids leaking an email in it.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeId(value: unknown, prefix: string): string | null {
  const source = readString(value);
  if (!source) return null;
  const normalized = trimToLength(source.replace(/[^a-zA-Z0-9_-]/g, ""), 96);
  return normalized || `${prefix}-${createAutomationId("id")}`;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  const source = readString(value);
  if (!source) return null;
  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function createAutomationId(prefix: string): string {
  const cryptoValue = typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${cryptoValue}`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimToLength(value: string, maximum: number): string {
  return value.slice(0, maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}
