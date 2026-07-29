<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileDown,
  FileSpreadsheet,
  FolderInput,
  Gauge,
  GitBranch,
  ListOrdered,
  Minimize2,
  Pencil,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import {
  AUTOMATION_ACTION_OPTIONS,
  AUTOMATION_DELETE_STATUS_OPTIONS,
  AUTOMATION_FIELD_OPTIONS,
  AUTOMATION_UNGROUPED_GROUP_VALUE,
  MAX_AUTOMATION_ACTIONS_PER_STEP,
  MAX_AUTOMATION_CONDITIONS_PER_GROUP,
  MAX_AUTOMATION_INTERVAL_SECONDS,
  MIN_AUTOMATION_INTERVAL_SECONDS,
  MAX_AUTOMATION_RULES,
  MAX_AUTOMATION_STEPS_PER_RULE,
  automationGroupConditionValue,
  createDefaultAutomationAction,
  createDefaultAutomationCondition,
  createDefaultAutomationRule,
  createDefaultAutomationStep,
  automationAccountPlanTypeFilterValue,
  getAutomationComparatorOptions,
  getAutomationConditionPlatformConstraint,
  getAutomationFieldValueOptions,
  getAutomationValidationIssues,
  groupIdFromAutomationConditionValue,
  isAutomationAccountPlanTypeFilterValue,
  type AutomationAction,
  type AutomationActionKind,
  type AutomationCondition,
  type AutomationConditionGroup,
  type AutomationConditionNode,
  type AutomationConditionalStep,
  type AutomationField,
  type AutomationRule,
} from "../lib/automation";
import { REPORT_COLUMN_OPTIONS } from "../lib/batchReport";
import {
  ACCOUNT_TYPE_FILTER_OPTIONS,
  ALL_FILTER_VALUE,
  getAccountPlanTypeConditionOptions,
  getAccountPlanTypes,
  getAccountPlanTypeFilterTokenLabel,
  isAccountPlanTypeFilterToken,
  isUnrecognizedPlanType,
  PLATFORM_FILTER_OPTIONS,
} from "../lib/accounts";
import RefreshableFilterSelect, { type RefreshableFilterOption } from "./RefreshableFilterSelect.vue";
import type { Account, AccountGroup } from "../types";

type RuleId = AutomationRule["id"];
type DirectoryActionKind = "exportAccounts" | "exportReport";

interface DirectoryPickerRequest {
  stepId: string;
  actionIndex: number;
  actionKind: DirectoryActionKind;
  directory: string;
  /** Call this after the native directory chooser returns. */
  setDirectory: (directory: string) => void;
}

interface ConditionTreeEntry {
  node: AutomationConditionNode;
  parent: AutomationConditionGroup;
  index: number;
  /** The root group is level 0; its direct children are also displayed at 0. */
  depth: number;
}

const props = withDefaults(defineProps<{
  open: boolean;
  rules?: readonly AutomationRule[];
  groups?: readonly AccountGroup[];
  accounts?: readonly Account[];
  /** Subscription labels aggregated across the full account collection. */
  planTypes?: readonly string[];
  /** Whether the complete account collection contains missing plan labels. */
  hasUnrecognizedPlanTypes?: boolean;
  busy?: boolean;
  /** The rule currently running on its configured automatic interval. */
  automaticRuleId?: RuleId | null;
  /** The rule whose current execution can be ended from its primary button. */
  runningRuleId?: RuleId | null;
  validateRule?: (rule: AutomationRule) => string | null;
}>(), {
  rules: () => [],
  groups: () => [],
  accounts: () => [],
  planTypes: () => [],
  hasUnrecognizedPlanTypes: false,
  busy: false,
  automaticRuleId: null,
  runningRuleId: null,
});

const emit = defineEmits<{
  close: [];
  add: [rule: AutomationRule];
  edit: [payload: { id: RuleId; rule: AutomationRule }];
  delete: [rule: AutomationRule];
  run: [rule: AutomationRule];
  stop: [rule: AutomationRule];
  background: [];
  pickDirectory: [request: DirectoryPickerRequest];
}>();

const editorOpen = ref(false);
const editingRuleId = ref<RuleId | null>(null);
const draft = ref<AutomationRule>(createDefaultAutomationRule());
const editorError = ref<string | null>(null);
const pendingDeletion = ref<AutomationRule | null>(null);

const deletingRuleName = computed(() => pendingDeletion.value?.name.trim() || "此自动化");
const canSave = computed(() => !props.busy && draft.value.name.trim().length > 0);
const canCreateRule = computed(() => !props.busy && props.rules.length < MAX_AUTOMATION_RULES);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) return;
    editorOpen.value = false;
    pendingDeletion.value = null;
    editorError.value = null;
  },
);

function cloneRule(rule: AutomationRule): AutomationRule {
  return JSON.parse(JSON.stringify(rule)) as AutomationRule;
}

function openCreateEditor() {
  if (!canCreateRule.value) return;
  const next = createDefaultAutomationRule();
  next.name = "新建自动化";
  draft.value = next;
  editingRuleId.value = null;
  editorError.value = null;
  editorOpen.value = true;
}

function openEditEditor(rule: AutomationRule) {
  if (props.busy) return;
  draft.value = cloneRule(rule);
  editingRuleId.value = rule.id;
  editorError.value = null;
  editorOpen.value = true;
}

function closeEditor() {
  if (props.busy) return;
  editorOpen.value = false;
  editorError.value = null;
}

function closeDialog() {
  if (pendingDeletion.value) {
    pendingDeletion.value = null;
    return;
  }
  if (editorOpen.value) {
    closeEditor();
    return;
  }
  emit("close");
}

function saveDraft() {
  if (!canSave.value) return;
  const validation = validateDraft(draft.value);
  if (validation) {
    editorError.value = validation;
    return;
  }

  const output = cloneRule(draft.value);
  output.name = output.name.trim();
  // The interval selector determines whether this rule starts automatic execution.
  output.enabled = true;
  output.updatedAt = new Date().toISOString();
  const externalValidation = props.validateRule?.(output);
  if (externalValidation) {
    editorError.value = externalValidation;
    return;
  }
  if (editingRuleId.value === null) {
    emit("add", output);
  } else {
    emit("edit", { id: editingRuleId.value, rule: output });
  }
  editorOpen.value = false;
  editorError.value = null;
}

function validateDraft(rule: AutomationRule): string | null {
  if (rule.intervalSeconds !== null) {
    if (
      !Number.isSafeInteger(rule.intervalSeconds)
      || rule.intervalSeconds < MIN_AUTOMATION_INTERVAL_SECONDS
      || rule.intervalSeconds > MAX_AUTOMATION_INTERVAL_SECONDS
    ) {
      return `自动执行间隔应为 ${MIN_AUTOMATION_INTERVAL_SECONDS} 到 ${MAX_AUTOMATION_INTERVAL_SECONDS} 秒之间的整数。`;
    }

    for (const step of rule.steps) {
      if (step.kind !== "conditional") continue;
      for (const action of step.actions) {
        if ((action.kind === "exportAccounts" || action.kind === "exportReport") && !action.directory?.trim()) {
          return "自动执行中的导出动作必须先选择保存目录，避免运行时重复弹出目录窗口。";
        }
      }
    }
  }

  return getAutomationValidationIssues(rule)[0]?.message ?? null;
}

function requestDelete(rule: AutomationRule) {
  if (props.busy || isRuleAutomatic(rule)) return;
  pendingDeletion.value = rule;
}

function confirmDelete() {
  const rule = pendingDeletion.value;
  if (!rule || props.busy || isRuleAutomatic(rule)) return;
  emit("delete", rule);
  pendingDeletion.value = null;
}

function isRuleAutomatic(rule: AutomationRule): boolean {
  return props.automaticRuleId === rule.id;
}

function isRuleRunning(rule: AutomationRule): boolean {
  return props.runningRuleId === rule.id;
}

/** An automatic task stays stoppable while waiting, claiming, and executing. */
function isRuleStoppable(rule: AutomationRule): boolean {
  return isRuleAutomatic(rule) || isRuleRunning(rule);
}

function isRuleConfiguredForAutomaticExecution(rule: AutomationRule): boolean {
  return rule.intervalSeconds !== null && rule.intervalSeconds > 0;
}

function primaryActionTitle(rule: AutomationRule): string {
  if (isRuleStoppable(rule)) return "结束自动执行或当前自动化执行";
  return isRuleConfiguredForAutomaticExecution(rule) ? "启动自动执行" : "执行自动化";
}

function primaryActionLabel(rule: AutomationRule): string {
  if (isRuleStoppable(rule)) return "结束";
  return isRuleConfiguredForAutomaticExecution(rule) ? "启动" : "执行";
}

function addRefreshStep(index?: number) {
  if (props.busy || draft.value.steps.length >= MAX_AUTOMATION_STEPS_PER_RULE) return;
  const insertionIndex = index === undefined ? draft.value.steps.length : Math.max(0, Math.min(index, draft.value.steps.length));
  draft.value.steps.splice(insertionIndex, 0, createDefaultAutomationStep("refresh"));
}

function addConditionalStep(index?: number) {
  if (props.busy || draft.value.steps.length >= MAX_AUTOMATION_STEPS_PER_RULE) return;
  const insertionIndex = index === undefined ? draft.value.steps.length : Math.max(0, Math.min(index, draft.value.steps.length));
  draft.value.steps.splice(insertionIndex, 0, createDefaultAutomationStep("conditional"));
}

function moveStep(index: number, offset: -1 | 1) {
  if (props.busy) return;
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= draft.value.steps.length) return;
  const [step] = draft.value.steps.splice(index, 1);
  draft.value.steps.splice(nextIndex, 0, step);
}

function removeStep(index: number) {
  if (props.busy || draft.value.steps.length <= 1) return;
  draft.value.steps.splice(index, 1);
}

function addCondition(group: AutomationConditionGroup) {
  if (props.busy || group.children.length >= MAX_AUTOMATION_CONDITIONS_PER_GROUP) return;
  group.children.push(createDefaultAutomationCondition("and"));
}

function removeConditionNode(group: AutomationConditionGroup, index: number) {
  // A group must always retain one node; otherwise its logical semantics are
  // ambiguous and rule validation rejects the entire automation.
  if (props.busy || group.children.length <= 1 || index < 0 || index >= group.children.length) return;
  group.children.splice(index, 1);
  const [first] = group.children;
  if (first) delete first.joinWithPrevious;
}

function setConditionJoin(node: AutomationConditionNode, value: string) {
  if (props.busy || (value !== "and" && value !== "or")) return;
  node.joinWithPrevious = value;
}

function conditionTreeEntries(root: AutomationConditionGroup): readonly ConditionTreeEntry[] {
  const entries: ConditionTreeEntry[] = [];
  const visit = (group: AutomationConditionGroup, depth: number) => {
    group.children.forEach((node, index) => {
      entries.push({ node, parent: group, index, depth });
      if (node.kind === "group") visit(node, depth + 1);
    });
  };
  visit(root, 0);
  return entries;
}

function conditionTreeIndent(depth: number): { marginLeft: string } {
  return { marginLeft: `${Math.max(0, depth) * 18}px` };
}

function addAction(step: AutomationConditionalStep) {
  if (props.busy || step.actions.length >= MAX_AUTOMATION_ACTIONS_PER_STEP) return;
  step.actions.push(createDefaultAutomationAction());
}

function removeAction(step: AutomationConditionalStep, index: number) {
  if (props.busy || step.actions.length <= 1) return;
  step.actions.splice(index, 1);
}

function replaceAction(step: AutomationConditionalStep, index: number, actionKind: string) {
  if (props.busy || !isActionKind(actionKind)) return;
  step.actions.splice(index, 1, createDefaultAutomationAction(actionKind));
}

function isActionKind(value: string): value is AutomationActionKind {
  return AUTOMATION_ACTION_OPTIONS.some((option) => option.value === value);
}

function conditionFieldKind(field: AutomationField): "text" | "number" | "date" | "select" {
  if (field === "name") return "text";
  if (field === "id" || field === "priority" || field === "concurrency") return "number";
  if (field === "lastUsedAt" || field === "createdAt" || field === "testTime") return "date";
  return "select";
}

function fieldLabel(field: AutomationField): string {
  return AUTOMATION_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field;
}

function actionLabel(action: AutomationAction): string {
  return AUTOMATION_ACTION_OPTIONS.find((option) => option.value === action.kind)?.label ?? action.kind;
}

function comparatorLabel(condition: AutomationCondition): string {
  return getAutomationComparatorOptions(condition.field).find((option) => option.value === condition.operator)?.label ?? condition.operator;
}

function conditionValueOptions(field: AutomationField) {
  if (field === "platform") {
    return PLATFORM_FILTER_OPTIONS
      .filter((option) => option.value !== ALL_FILTER_VALUE)
      .map((option) => ({ value: option.value, label: option.label }));
  }
  if (field === "accountType") {
    return ACCOUNT_TYPE_FILTER_OPTIONS
      .filter((option) => option.value !== ALL_FILTER_VALUE)
      .map((option) => ({ value: option.value, label: option.label }));
  }
  if (field === "group") {
    const options = props.groups
      .filter((group) => Number.isSafeInteger(group.id) && group.id > 0)
      .map((group) => ({
        value: automationGroupConditionValue(group.id),
        label: `${group.name || `分组 #${group.id}`}${group.platform ? `（${group.platform}）` : ""}`,
      }));
    return [...options, { value: AUTOMATION_UNGROUPED_GROUP_VALUE, label: "未分配分组" }];
  }
  if (field === "planType") {
    const planTypes = props.planTypes.length ? props.planTypes : getAccountPlanTypes(props.accounts);
    const hasUnrecognizedPlanTypes = props.hasUnrecognizedPlanTypes
      || props.accounts.some((account) => isUnrecognizedPlanType(account.planType));
    return getAccountPlanTypeConditionOptions(planTypes, hasUnrecognizedPlanTypes);
  }
  const fromAccounts = getAutomationFieldValueOptions(field, props.accounts);
  return fromAccounts;
}

/** Keep a persisted selection visible even when its type is not on the current page. */
function conditionValueOptionsWithCurrentValue(condition: AutomationCondition): readonly RefreshableFilterOption[] {
  const options = conditionValueOptions(condition.field);
  const selectedValue = conditionSingleValue(condition);
  if (!selectedValue || options.some((option) => option.value === selectedValue)) return options;
  return [{ value: selectedValue, label: selectedValue }, ...options];
}

function conditionUsesRange(condition: AutomationCondition): boolean {
  return condition.operator === "between" || condition.operator === "outsideRange";
}

function isRangeValue(value: AutomationCondition["value"]): value is { start: string; end: string } {
  return typeof value === "object"
    && value !== null
    && "start" in value
    && "end" in value;
}

function conditionSingleValue(condition: AutomationCondition): string {
  if (isRangeValue(condition.value)) return "";
  if (condition.field === "planType") {
    if (isAutomationAccountPlanTypeFilterValue(condition.value)) return condition.value.value;
    if (typeof condition.value !== "string") return "";

    // Legacy rules store literal labels. Display their current catalog option
    // without changing the draft until the user explicitly selects a value.
    const legacyValue = condition.value.trim();
    if (!legacyValue) return "";
    const legacyLabel = legacyValue === "未识别" ? `${legacyValue}（原始类型）` : legacyValue;
    return conditionValueOptions("planType").find((option) => (
      option.label.trim().toLocaleLowerCase() === legacyLabel.toLocaleLowerCase()
    ))?.value ?? legacyValue;
  }
  return typeof condition.value === "string" || typeof condition.value === "number" ? String(condition.value) : "";
}

function conditionRangeValue(condition: AutomationCondition, key: "start" | "end"): string {
  return isRangeValue(condition.value) ? condition.value[key] : "";
}

function setConditionField(condition: AutomationCondition, rawField: string) {
  if (props.busy || !isAutomationField(rawField)) return;
  condition.field = rawField;
  condition.operator = getAutomationComparatorOptions(rawField)[0]?.value ?? "equals";
  condition.value = defaultConditionValue(rawField);
}

function isAutomationField(value: string): value is AutomationField {
  return AUTOMATION_FIELD_OPTIONS.some((option) => option.value === value);
}

function defaultConditionValue(field: AutomationField): AutomationCondition["value"] {
  const kind = conditionFieldKind(field);
  if (kind === "number" || kind === "text" || kind === "date") return "";
  const value = String(conditionValueOptions(field)[0]?.value ?? "");
  return field === "planType" && isAccountPlanTypeFilterToken(value)
    ? automationAccountPlanTypeFilterValue(value)
    : value;
}

function setConditionOperator(condition: AutomationCondition, operator: string) {
  if (props.busy || !getAutomationComparatorOptions(condition.field).some((option) => option.value === operator)) return;
  condition.operator = operator as AutomationCondition["operator"];
  if (operator === "between" || operator === "outsideRange") {
    if (!isRangeValue(condition.value)) condition.value = { start: "", end: "" };
  } else if (isRangeValue(condition.value)) {
    condition.value = defaultConditionValue(condition.field);
  }
}

function setConditionSingleValue(condition: AutomationCondition, value: string) {
  if (props.busy) return;
  condition.value = condition.field === "planType" && isAccountPlanTypeFilterToken(value)
    ? automationAccountPlanTypeFilterValue(value)
    : value;
}

function setConditionRangeValue(condition: AutomationCondition, key: "start" | "end", value: string) {
  if (props.busy) return;
  const range = isRangeValue(condition.value) ? condition.value : { start: "", end: "" };
  condition.value = { ...range, [key]: value };
}

function formatConditionValue(condition: AutomationCondition): string {
  if (isRangeValue(condition.value)) {
    return `${condition.value.start || "未设置"} 至 ${condition.value.end || "未设置"}`;
  }
  if (condition.field === "planType" && isAutomationAccountPlanTypeFilterValue(condition.value)) {
    return getAccountPlanTypeFilterTokenLabel(condition.value.value);
  }
  const rawValue = typeof condition.value === "string" || typeof condition.value === "number" ? String(condition.value) : "";
  if (condition.field === "group") {
    const groupId = groupIdFromAutomationConditionValue(rawValue);
    const group = groupId === null ? undefined : props.groups.find((candidate) => candidate.id === groupId);
    if (group) return `${group.name || `分组 #${group.id}`}${group.platform ? `（${group.platform}）` : ""}`;
  }
  if (conditionFieldKind(condition.field) === "select") {
    const optionLabel = conditionValueOptions(condition.field).find((option) => String(option.value) === rawValue)?.label;
    return optionLabel ?? (rawValue || "未设置");
  }
  return rawValue || "未设置";
}

function conditionNodeSummary(node: AutomationConditionNode, nested = false): string {
  if (node.kind === "condition") {
    return `${fieldLabel(node.field)} ${comparatorLabel(node)} ${formatConditionValue(node)}`;
  }

  if (!node.children.length) return "未配置条件";
  const summary = node.children.map((child, index) => {
    const childSummary = conditionNodeSummary(child, true);
    if (index === 0) return childSummary;
    return child.joinWithPrevious === "or" ? ` 或 ${childSummary}` : ` 且 ${childSummary}`;
  }).join("");
  return nested && node.children.length > 1 ? `（${summary}）` : summary;
}

function conditionSummary(step: AutomationConditionalStep): string {
  return conditionNodeSummary(step.condition);
}

function ruleConditionSummary(rule: AutomationRule): string {
  const parts = rule.steps
    .filter((step): step is AutomationConditionalStep => step.kind === "conditional")
    .map(conditionSummary);
  return parts.length ? parts.join("；") : "仅刷新账号数据";
}

function ruleActionSummary(rule: AutomationRule): string {
  const labels = rule.steps
    .filter((step): step is AutomationConditionalStep => step.kind === "conditional")
    .flatMap((step) => step.actions.map(actionLabel));
  const refreshes = rule.steps.filter((step) => step.kind === "refresh").length;
  const parts = labels.length ? labels : [];
  if (refreshes) parts.unshift(`刷新 ${refreshes} 次`);
  return parts.length ? parts.join("、") : "未配置动作";
}

function formatInterval(intervalSeconds: number | null): string {
  if (intervalSeconds === null || intervalSeconds <= 0) return "仅手动执行";
  if (intervalSeconds % 3600 === 0) return `${intervalSeconds / 3600} 小时`;
  if (intervalSeconds % 60 === 0) return `${intervalSeconds / 60} 分钟`;
  return `${intervalSeconds} 秒`;
}

function ruleIntervalLabel(rule: AutomationRule): string {
  if (isRuleAutomatic(rule)) return `自动执行中：间隔 ${formatInterval(rule.intervalSeconds)}`;
  return rule.intervalSeconds === null ? formatInterval(rule.intervalSeconds) : `自动执行间隔：${formatInterval(rule.intervalSeconds)}`;
}

function updateIntervalPreset(value: string) {
  if (props.busy) return;
  if (value === "custom") {
    draft.value.intervalSeconds = 120;
    draft.value.enabled = true;
    return;
  }
  const parsed = Number(value);
  draft.value.intervalSeconds = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  draft.value.enabled = true;
}

function intervalPresetValue(intervalSeconds: number | null): string {
  if (intervalSeconds === null || intervalSeconds <= 0) return "off";
  return [60, 300, 900, 1800, 3600].includes(intervalSeconds) ? String(intervalSeconds) : "custom";
}

function setCustomInterval(value: string) {
  if (props.busy) return;
  const parsed = Number(value);
  draft.value.intervalSeconds = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  draft.value.enabled = true;
}

function selectedDeleteStatus(action: AutomationAction, status: string): boolean {
  return action.kind === "deleteAccounts" && (action.targetStatuses as readonly string[]).includes(status);
}

function toggleDeleteStatus(action: AutomationAction, status: string, selected: boolean) {
  if (props.busy || action.kind !== "deleteAccounts") return;
  const next = new Set<string>(action.targetStatuses as readonly string[]);
  if (selected) next.add(status);
  else next.delete(status);
  action.targetStatuses = [...next] as typeof action.targetStatuses;
}

function stepPlatformConstraint(step: AutomationConditionalStep): string | null {
  return getAutomationConditionPlatformConstraint(step.condition);
}

function compatibleMoveGroups(step: AutomationConditionalStep): readonly AccountGroup[] {
  const platform = stepPlatformConstraint(step);
  if (!platform) return [];
  return props.groups.filter((group) => group.platform?.trim().toLocaleLowerCase() === platform);
}

function setActionGroup(step: AutomationConditionalStep, action: AutomationAction, value: string) {
  if (props.busy || action.kind !== "moveGroup") return;
  const group = compatibleMoveGroups(step).find((candidate) => String(candidate.id) === value);
  action.groupId = group?.id ?? null;
  action.groupName = group?.name;
}

function setActionNumber(action: AutomationAction, value: string) {
  if (props.busy || (action.kind !== "setPriority" && action.kind !== "setConcurrency")) return;
  const parsed = Number(value);
  const numeric = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  if (action.kind === "setPriority") action.priority = numeric;
  else action.concurrency = numeric;
}

function setRenameNumber(action: AutomationAction, property: "startIndex" | "padding", value: string) {
  if (props.busy || action.kind !== "rename") return;
  const parsed = Number(value);
  const minimum = property === "startIndex" ? 1 : 0;
  action[property] = Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : minimum;
}

function setActionDirectory(action: AutomationAction, directory: string) {
  if (action.kind !== "exportAccounts" && action.kind !== "exportReport") return;
  action.directory = directory;
}

function appendExportFileNameToken(action: AutomationAction, token: "{date}" | "{time}" | "{datetime}" | "{count}" | "{format}") {
  if (props.busy || (action.kind !== "exportAccounts" && action.kind !== "exportReport")) return;
  action.fileNameTemplate = `${action.fileNameTemplate}${token}`;
}

function requestDirectory(step: AutomationConditionalStep, action: AutomationAction, actionIndex: number) {
  if (props.busy || (action.kind !== "exportAccounts" && action.kind !== "exportReport")) return;
  emit("pickDirectory", {
    stepId: step.id,
    actionIndex,
    actionKind: action.kind,
    directory: action.directory ?? "",
    setDirectory: (directory) => setActionDirectory(action, directory),
  });
}

function reportColumnSelected(action: AutomationAction, columnId: string): boolean {
  return action.kind === "exportReport" && action.columns.includes(columnId);
}

function toggleReportColumn(action: AutomationAction, columnId: string, selected: boolean) {
  if (props.busy || action.kind !== "exportReport") return;
  const columns = new Set(action.columns);
  if (selected) columns.add(columnId);
  else columns.delete(columnId);
  action.columns = REPORT_COLUMN_OPTIONS.map((column) => column.id).filter((id) => columns.has(id));
}

function actionIcon(action: AutomationAction) {
  if (action.kind === "moveGroup") return FolderInput;
  if (action.kind === "deleteAccounts") return Trash2;
  if (action.kind === "exportAccounts") return FileDown;
  if (action.kind === "setPriority") return ListOrdered;
  if (action.kind === "setConcurrency") return Gauge;
  if (action.kind === "rename") return PencilLine;
  return FileSpreadsheet;
}
</script>

<template>
  <div v-if="open" class="automation-dialog-backdrop">
    <section class="automation-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-automation-title" tabindex="-1" @keydown.esc="closeDialog">
      <header class="automation-dialog__header">
        <div class="automation-dialog__title">
          <span class="automation-dialog__icon"><GitBranch :size="20" aria-hidden="true" /></span>
          <div>
            <div class="automation-dialog__heading">
              <h2 id="batch-automation-title">批量自动化</h2>
              <span class="automation-help" role="img" aria-label="自动化说明" title="按条件筛选账号，按顺序执行刷新和批量操作。保存后不会立即执行。"><CircleHelp :size="15" aria-hidden="true" /></span>
            </div>
          </div>
        </div>
        <button class="automation-dialog__close" type="button" title="关闭" aria-label="关闭" @click="closeDialog">
          <X :size="18" />
        </button>
      </header>

      <div class="automation-dialog__toolbar">
        <button class="button button--primary" type="button" :disabled="!canCreateRule" @click="openCreateEditor">
          <Plus :size="16" />
          <span>添加自动化</span>
        </button>
        <span class="automation-help" role="img" aria-label="执行规则说明" title="设置执行间隔后，完成保存只会保留配置；回到规则列表点击“启动”后才会自动重复运行。同一自动化不会重叠执行。单个条件步骤最多处理 10,000 个候选账号。"><CircleHelp :size="15" aria-hidden="true" /></span>
      </div>

      <section v-if="rules.length" class="automation-rule-list" aria-label="已保存的自动化">
        <article v-for="rule in rules" :key="rule.id" class="automation-rule-card">
          <div class="automation-rule-card__main">
            <div class="automation-rule-card__heading">
              <div>
                <h3>{{ rule.name }}</h3>
              </div>
              <span class="automation-rule-card__interval"><Clock3 :size="14" />{{ ruleIntervalLabel(rule) }}</span>
            </div>
            <dl class="automation-rule-card__summary">
              <div>
                <dt>条件</dt>
                <dd>{{ ruleConditionSummary(rule) }}</dd>
              </div>
              <div>
                <dt>执行</dt>
                <dd>{{ ruleActionSummary(rule) }}</dd>
              </div>
            </dl>
          </div>
          <div class="automation-rule-card__actions">
            <button
              :class="['button', isRuleStoppable(rule) ? 'button--danger' : 'button--primary']"
              type="button"
              :disabled="busy && !isRuleStoppable(rule)"
              :title="primaryActionTitle(rule)"
              @click="isRuleStoppable(rule) ? emit('stop', rule) : emit('run', rule)"
            >
              <Square v-if="isRuleStoppable(rule)" :size="14" fill="currentColor" />
              <Play v-else :size="15" />
              <span>{{ primaryActionLabel(rule) }}</span>
            </button>
            <button
              v-if="isRuleStoppable(rule)"
              class="button button--secondary automation-rule-card__background-button"
              type="button"
              title="仅隐藏窗口到右下角；不会启动、停止或改变任务执行状态"
              @click="emit('background')"
            >
              <Minimize2 :size="15" />
              <span>后台运行</span>
            </button>
            <button class="automation-rule-card__icon-button" type="button" title="编辑自动化" aria-label="编辑自动化" :disabled="busy" @click="openEditEditor(rule)">
              <Pencil :size="16" />
            </button>
            <button class="automation-rule-card__icon-button automation-rule-card__icon-button--danger" type="button" title="删除自动化" aria-label="删除自动化" :disabled="busy || isRuleAutomatic(rule)" @click="requestDelete(rule)">
              <Trash2 :size="16" />
            </button>
          </div>
        </article>
      </section>

      <section v-else class="automation-dialog__empty">
        <GitBranch :size="22" aria-hidden="true" />
        <div>
          <strong>还没有自动化流程</strong>
        </div>
      </section>
    </section>

    <div v-if="editorOpen" class="automation-editor-backdrop">
      <section class="automation-editor" role="dialog" aria-modal="true" aria-labelledby="automation-editor-title" tabindex="-1" @keydown.esc.stop="closeEditor">
        <header class="automation-editor__header">
          <div class="automation-dialog__title">
            <span class="automation-dialog__icon automation-dialog__icon--editor"><Settings2 :size="20" aria-hidden="true" /></span>
            <div>
              <div class="automation-dialog__heading">
                <h2 id="automation-editor-title">{{ editingRuleId === null ? "添加批量自动化" : "编辑批量自动化" }}</h2>
                <span class="automation-help" role="img" aria-label="保存说明" title="选择“不自动执行”时，此规则只能手动运行；设置执行间隔后，需回到规则列表点击“启动”才会自动执行。"><CircleHelp :size="15" aria-hidden="true" /></span>
              </div>
            </div>
          </div>
          <button class="automation-dialog__close" type="button" title="关闭编辑器" aria-label="关闭编辑器" :disabled="busy" @click="closeEditor">
            <X :size="18" />
          </button>
        </header>

        <div class="automation-editor__body">
        <label class="automation-field automation-field--name">
          <span>自动化名称</span>
          <input v-model="draft.name" :disabled="busy" maxlength="100" placeholder="例如：每日清理错误账号" />
        </label>

        <section class="automation-workflow" aria-labelledby="automation-workflow-title">
          <div class="automation-workflow__heading">
            <div class="automation-heading-with-help">
              <h3 id="automation-workflow-title">执行流程</h3>
              <span class="automation-help" role="img" aria-label="流程说明" title="步骤从上到下依次执行。刷新步骤可插入任意位置，也可重复添加。"><CircleHelp :size="15" aria-hidden="true" /></span>
            </div>
            <div class="automation-workflow__add-buttons">
              <button class="button button--secondary" type="button" :disabled="busy || draft.steps.length >= MAX_AUTOMATION_STEPS_PER_RULE" @click="addRefreshStep()"><RefreshCw :size="15" />添加刷新</button>
              <button class="button button--secondary" type="button" :disabled="busy || draft.steps.length >= MAX_AUTOMATION_STEPS_PER_RULE" @click="addConditionalStep()"><Plus :size="15" />添加条件动作</button>
            </div>
          </div>

          <ol class="automation-step-list">
            <li v-for="(step, stepIndex) in draft.steps" :key="step.id" class="automation-step">
              <div class="automation-step__controls">
                <button class="automation-step__insert automation-step__insert--refresh" type="button" :disabled="busy || draft.steps.length >= MAX_AUTOMATION_STEPS_PER_RULE" @click="addRefreshStep(stepIndex)"><RefreshCw :size="13" />在此处插入刷新</button>
              </div>

              <article v-if="step.kind === 'refresh'" class="automation-step__card automation-step__card--refresh">
                <div class="automation-step__header">
                  <div class="automation-step__title"><RefreshCw :size="17" /><strong>刷新账号数据</strong><span class="automation-help" role="img" aria-label="刷新说明" title="从 Sub2API 重新读取账号和分组，再继续后续步骤。"><CircleHelp :size="14" aria-hidden="true" /></span></div>
                  <div class="automation-step__header-actions">
                    <button class="automation-step__icon-button" type="button" title="上移" aria-label="上移" :disabled="busy || stepIndex === 0" @click="moveStep(stepIndex, -1)"><ArrowUp :size="15" /></button>
                    <button class="automation-step__icon-button" type="button" title="下移" aria-label="下移" :disabled="busy || stepIndex === draft.steps.length - 1" @click="moveStep(stepIndex, 1)"><ArrowDown :size="15" /></button>
                    <button class="automation-step__icon-button automation-step__icon-button--danger" type="button" title="删除步骤" aria-label="删除步骤" :disabled="busy || draft.steps.length === 1" @click="removeStep(stepIndex)"><Trash2 :size="15" /></button>
                  </div>
                </div>
              </article>

              <article v-else class="automation-step__card automation-step__card--conditional">
                <div class="automation-step__header">
                  <div class="automation-step__title"><GitBranch :size="17" /><strong>条件判断与动作</strong></div>
                  <div class="automation-step__header-actions">
                    <button class="automation-step__icon-button" type="button" title="上移" aria-label="上移" :disabled="busy || stepIndex === 0" @click="moveStep(stepIndex, -1)"><ArrowUp :size="15" /></button>
                    <button class="automation-step__icon-button" type="button" title="下移" aria-label="下移" :disabled="busy || stepIndex === draft.steps.length - 1" @click="moveStep(stepIndex, 1)"><ArrowDown :size="15" /></button>
                    <button class="automation-step__icon-button automation-step__icon-button--danger" type="button" title="删除步骤" aria-label="删除步骤" :disabled="busy || draft.steps.length === 1" @click="removeStep(stepIndex)"><Trash2 :size="15" /></button>
                  </div>
                </div>

                <div class="automation-conditions automation-flow-section automation-flow-section--conditions">
                  <div class="automation-conditions__heading">
                    <span class="automation-heading-with-help">如果账号符合以下条件<span class="automation-help" role="img" aria-label="条件说明" title="在每个条件之间选择“且”或“或”；同级条件中“且”优先于“或”。"><CircleHelp :size="14" aria-hidden="true" /></span></span>
                  </div>

                  <div class="automation-condition-tree">
                    <template v-for="entry in conditionTreeEntries(step.condition)" :key="entry.node.id">
                      <div v-if="entry.index > 0" class="automation-condition-connector" :style="conditionTreeIndent(entry.depth)" role="group" aria-label="与上一条件的关系">
                        <span aria-hidden="true"></span>
                        <div class="automation-condition-connector__choices">
                          <button type="button" :class="{ 'automation-condition-connector__choice--active': entry.node.joinWithPrevious !== 'or' }" :disabled="busy" :aria-pressed="entry.node.joinWithPrevious !== 'or'" @click="setConditionJoin(entry.node, 'and')">且</button>
                          <button type="button" :class="{ 'automation-condition-connector__choice--active': entry.node.joinWithPrevious === 'or' }" :disabled="busy" :aria-pressed="entry.node.joinWithPrevious === 'or'" @click="setConditionJoin(entry.node, 'or')">或</button>
                        </div>
                        <span aria-hidden="true"></span>
                      </div>
                      <div
                        v-if="entry.node.kind === 'condition'"
                        class="automation-condition-row"
                        :class="{ 'automation-condition-row--nested': entry.depth > 0 }"
                        :style="conditionTreeIndent(entry.depth)"
                      >
                        <template v-if="entry.node.kind === 'condition'">
                          <select :value="entry.node.field" :disabled="busy" aria-label="条件字段" @change="setConditionField(entry.node, ($event.target as HTMLSelectElement).value)">
                            <option v-for="field in AUTOMATION_FIELD_OPTIONS" :key="field.value" :value="field.value">{{ field.label }}</option>
                          </select>
                          <select :value="entry.node.operator" :disabled="busy" aria-label="判断方式" @change="setConditionOperator(entry.node, ($event.target as HTMLSelectElement).value)">
                            <option v-for="operator in getAutomationComparatorOptions(entry.node.field)" :key="operator.value" :value="operator.value">{{ operator.label }}</option>
                          </select>

                          <template v-if="conditionUsesRange(entry.node)">
                            <input
                              :type="conditionFieldKind(entry.node.field) === 'date' ? 'datetime-local' : 'number'"
                              :value="conditionRangeValue(entry.node, 'start')"
                              :disabled="busy"
                              :placeholder="conditionFieldKind(entry.node.field) === 'date' ? '开始时间' : '最小值'"
                              @input="setConditionRangeValue(entry.node, 'start', ($event.target as HTMLInputElement).value)"
                            />
                            <input
                              :type="conditionFieldKind(entry.node.field) === 'date' ? 'datetime-local' : 'number'"
                              :value="conditionRangeValue(entry.node, 'end')"
                              :disabled="busy"
                              :placeholder="conditionFieldKind(entry.node.field) === 'date' ? '结束时间' : '最大值'"
                              @input="setConditionRangeValue(entry.node, 'end', ($event.target as HTMLInputElement).value)"
                            />
                          </template>
                          <RefreshableFilterSelect
                            v-else-if="conditionFieldKind(entry.node.field) === 'select'"
                            class="automation-condition-value-select"
                            :model-value="conditionSingleValue(entry.node)"
                            :options="conditionValueOptionsWithCurrentValue(entry.node)"
                            :label="fieldLabel(entry.node.field)"
                            :title="entry.node.field === 'planType' ? '账户类型选项会从全部账号分页汇总。' : undefined"
                            :disabled="busy || !conditionValueOptions(entry.node.field).length"
                            @update:model-value="setConditionSingleValue(entry.node, $event)"
                          />
                          <input
                            v-else
                            :type="conditionFieldKind(entry.node.field) === 'number' ? 'number' : 'text'"
                            :inputmode="conditionFieldKind(entry.node.field) === 'number' ? 'numeric' : undefined"
                            :value="conditionSingleValue(entry.node)"
                            :disabled="busy"
                            :placeholder="entry.node.field === 'name' ? '名称模式：* 任意字符，? 单个字符' : '输入条件值'"
                            :title="entry.node.field === 'name' ? '支持 * 匹配任意长度文本，? 匹配单个字符' : undefined"
                            @input="setConditionSingleValue(entry.node, ($event.target as HTMLInputElement).value)"
                          />
                          <button class="automation-condition-row__remove" type="button" title="移除此条件" aria-label="移除此条件" :disabled="busy || entry.parent.children.length === 1" @click="removeConditionNode(entry.parent, entry.index)"><Trash2 :size="15" /></button>
                        </template>
                      </div>

                      <section
                        v-else
                        class="automation-condition-group"
                        :style="conditionTreeIndent(entry.depth)"
                        :aria-label="`嵌套条件组，第 ${entry.depth + 1} 层`"
                      >
                        <div class="automation-condition-group__heading">
                          <div>
                            <strong>嵌套条件组</strong>
                            <small>第 {{ entry.depth + 1 }} 层</small>
                          </div>
                          <button class="automation-condition-row__remove" type="button" title="删除此条件组" aria-label="删除此条件组" :disabled="busy || entry.parent.children.length === 1" @click="removeConditionNode(entry.parent, entry.index)"><Trash2 :size="15" /></button>
                        </div>
                        <div class="automation-condition-group__add">
                          <button class="automation-inline-add" type="button" :disabled="busy || entry.node.children.length >= MAX_AUTOMATION_CONDITIONS_PER_GROUP" @click="addCondition(entry.node)"><Plus :size="14" />添加条件</button>
                        </div>
                      </section>
                    </template>
                  </div>

                  <div class="automation-conditions__root-actions">
                    <button class="automation-inline-add" type="button" :disabled="busy || step.condition.children.length >= MAX_AUTOMATION_CONDITIONS_PER_GROUP" @click="addCondition(step.condition)"><Plus :size="14" />添加条件</button>
                  </div>
                </div>

                <div class="automation-actions automation-flow-section automation-flow-section--actions">
                  <div class="automation-actions__heading"><span class="automation-heading-with-help">那么执行<span class="automation-help" role="img" aria-label="动作说明" title="同一步骤中的动作按从上到下的顺序执行。"><CircleHelp :size="14" aria-hidden="true" /></span></span></div>
                  <div v-for="(action, actionIndex) in step.actions" :key="`${step.id}-${actionIndex}-${action.kind}`" class="automation-action-card">
                    <div class="automation-action-card__select-row">
                      <component :is="actionIcon(action)" :size="16" aria-hidden="true" />
                      <select :value="action.kind" :disabled="busy" aria-label="执行动作" @change="replaceAction(step, actionIndex, ($event.target as HTMLSelectElement).value)">
                        <option v-for="option in AUTOMATION_ACTION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                      </select>
                      <button class="automation-action-card__remove" type="button" title="移除此动作" aria-label="移除此动作" :disabled="busy || step.actions.length === 1" @click="removeAction(step, actionIndex)"><Trash2 :size="15" /></button>
                    </div>

                    <section class="automation-action-card__config-panel" aria-label="所选动作的配置">
                      <div class="automation-action-card__config-heading">
                        <strong>动作配置</strong>
                        <small>随上方动作类型变化</small>
                      </div>

                      <div v-if="action.kind === 'moveGroup'" class="automation-action-card__config">
                        <label class="automation-field" :title="stepPlatformConstraint(step) ? '仅显示与条件中平台一致的分组，避免跨平台移动账号。' : '请在本条件中添加“平台 等于 …”，再选择同平台的目标分组。'"><span class="automation-field__label">移动到分组<span class="automation-help" role="img" aria-label="移动分组说明"><CircleHelp :size="14" aria-hidden="true" /></span></span>
                          <select :value="action.groupId ?? ''" :disabled="busy || !compatibleMoveGroups(step).length" @change="setActionGroup(step, action, ($event.target as HTMLSelectElement).value)">
                            <option value="" disabled>{{ stepPlatformConstraint(step) ? "选择目标分组" : "请先限定平台" }}</option>
                            <option v-for="group in compatibleMoveGroups(step)" :key="group.id" :value="group.id">{{ group.name }}{{ group.platform ? `（${group.platform}）` : "" }}</option>
                          </select>
                        </label>
                      </div>

                      <div v-else-if="action.kind === 'deleteAccounts'" class="automation-action-card__config">
                        <div class="automation-delete-statuses">
                          <strong class="automation-heading-with-help">删除范围<span class="automation-help" role="img" aria-label="删除范围说明" title="未勾选的状态会被排除。默认只选择错误账号。"><CircleHelp :size="14" aria-hidden="true" /></span></strong>
                          <div>
                            <label v-for="status in AUTOMATION_DELETE_STATUS_OPTIONS" :key="status.value">
                              <input :checked="selectedDeleteStatus(action, status.value)" type="checkbox" :disabled="busy" @change="toggleDeleteStatus(action, status.value, ($event.target as HTMLInputElement).checked)" />
                              <span>{{ status.label }}</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      <div v-else-if="action.kind === 'setPriority'" class="automation-action-card__config">
                        <label class="automation-field" title="优先级数值越小，越优先调用。"><span class="automation-field__label">统一设置为优先级<span class="automation-help" role="img" aria-label="优先级说明"><CircleHelp :size="14" aria-hidden="true" /></span></span><input type="number" min="0" step="1" :value="action.priority ?? ''" :disabled="busy" placeholder="输入非负整数" @input="setActionNumber(action, ($event.target as HTMLInputElement).value)" /></label>
                      </div>

                      <div v-else-if="action.kind === 'setConcurrency'" class="automation-action-card__config">
                        <label class="automation-field" title="只修改单个账号的并发上限，不会修改批量测试的总并发。"><span class="automation-field__label">统一设置单个账号并发<span class="automation-help" role="img" aria-label="账号并发说明"><CircleHelp :size="14" aria-hidden="true" /></span></span><input type="number" min="0" step="1" :value="action.concurrency ?? ''" :disabled="busy" placeholder="输入非负整数" @input="setActionNumber(action, ($event.target as HTMLInputElement).value)" /></label>
                      </div>

                      <div v-else-if="action.kind === 'rename'" class="automation-action-card__config automation-action-card__config--rename">
                        <label class="automation-field" title="可使用 {{index}}、{{id}}、{{name}} 等批量重命名模板字段。"><span class="automation-field__label">重命名模板<span class="automation-help" role="img" aria-label="重命名模板说明"><CircleHelp :size="14" aria-hidden="true" /></span></span><input v-model="action.template" :disabled="busy" maxlength="255" :placeholder="'例如：{{name}}-{{index}}'" /></label>
                        <label class="automation-field"><span>起始编号</span><input type="number" min="1" step="1" :value="action.startIndex" :disabled="busy" @input="setRenameNumber(action, 'startIndex', ($event.target as HTMLInputElement).value)" /></label>
                        <label class="automation-field"><span>补零位数</span><input type="number" min="0" step="1" :value="action.padding" :disabled="busy" @input="setRenameNumber(action, 'padding', ($event.target as HTMLInputElement).value)" /></label>
                      </div>

                      <div v-else-if="action.kind === 'exportAccounts'" class="automation-action-card__config automation-action-card__config--export">
                        <label class="automation-field"><span>导出格式</span><select v-model="action.format" :disabled="busy"><option value="sub2api">Sub2API 官方备份 JSON</option><option value="cpa">CPA ZIP</option></select></label>
                        <label class="automation-field"><span>文件名称模板</span><input v-model="action.fileNameTemplate" :disabled="busy" maxlength="255" placeholder="账号导出-{datetime}-{count}" /></label>
                        <div class="automation-template-tokens" aria-label="文件名称快捷字段"><span>快捷字段</span><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{date}')">日期</button><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{time}')">时间</button><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{count}')">数量</button><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{format}')">格式</button></div>
                        <label class="automation-field automation-field--directory"><span>保存目录</span><div><input :value="action.directory ?? ''" :disabled="busy" readonly placeholder="请通过右侧按钮选择目录" /><button class="button button--secondary" type="button" :disabled="busy" @click="requestDirectory(step, action, actionIndex)"><FolderInput :size="15" />选择目录</button></div></label>
                        <label v-if="action.format === 'sub2api'" class="automation-checkbox"><input v-model="action.includeProxies" type="checkbox" :disabled="busy" /><span>同时导出关联代理</span></label>
                      </div>

                      <div v-else-if="action.kind === 'exportReport'" class="automation-action-card__config automation-action-card__config--report">
                        <label class="automation-field"><span>文件名称模板</span><input v-model="action.fileNameTemplate" :disabled="busy" maxlength="255" placeholder="批量测活-{datetime}-{count}" /></label>
                        <div class="automation-template-tokens" aria-label="文件名称快捷字段"><span>快捷字段</span><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{date}')">日期</button><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{time}')">时间</button><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{count}')">数量</button><button type="button" :disabled="busy" @click="appendExportFileNameToken(action, '{format}')">格式</button></div>
                        <label class="automation-field automation-field--directory"><span>保存目录</span><div><input :value="action.directory ?? ''" :disabled="busy" readonly placeholder="请通过右侧按钮选择目录" /><button class="button button--secondary" type="button" :disabled="busy" @click="requestDirectory(step, action, actionIndex)"><FolderInput :size="15" />选择目录</button></div></label>
                        <details class="automation-report-fields">
                          <summary>报告字段（已选 {{ action.columns.length }} 项）<ChevronDown :size="15" /></summary>
                          <div>
                            <label v-for="column in REPORT_COLUMN_OPTIONS" :key="column.id" :title="column.description"><input :checked="reportColumnSelected(action, column.id)" type="checkbox" :disabled="busy" @change="toggleReportColumn(action, column.id, ($event.target as HTMLInputElement).checked)" /><span><strong>{{ column.label }}</strong></span></label>
                          </div>
                        </details>
                      </div>
                    </section>
                  </div>
                  <button class="automation-inline-add" type="button" :disabled="busy || step.actions.length >= MAX_AUTOMATION_ACTIONS_PER_STEP" @click="addAction(step)"><Plus :size="14" />添加动作</button>
                </div>
              </article>

              <div v-if="stepIndex === draft.steps.length - 1" class="automation-step__controls automation-step__controls--after">
                <button class="automation-step__insert automation-step__insert--refresh" type="button" :disabled="busy || draft.steps.length >= MAX_AUTOMATION_STEPS_PER_RULE" @click="addRefreshStep(stepIndex + 1)"><RefreshCw :size="13" />在此后插入刷新</button>
              </div>
            </li>
          </ol>
        </section>

        <section class="automation-schedule" aria-labelledby="automation-schedule-title">
          <div class="automation-schedule__heading">
            <div class="automation-schedule__title"><Clock3 :size="17" /><div class="automation-heading-with-help"><h3 id="automation-schedule-title">自动执行间隔</h3><span class="automation-help" role="img" aria-label="自动执行说明" title="选择“不自动执行”时，此规则只能手动运行；设置执行间隔后，保存不会启动任务，需回到规则列表点击“启动”。首轮完成后才会开始按间隔等待下一轮。执行间隔可设置为 10 秒到 31 天。自动执行的导出动作必须指定保存目录；重启客户端后需重新选择目录以恢复写入授权。"><CircleHelp :size="15" aria-hidden="true" /></span></div></div>
          </div>
          <div class="automation-schedule__controls">
            <label class="automation-field automation-schedule__interval"><span>执行间隔</span><select :value="intervalPresetValue(draft.intervalSeconds)" :disabled="busy" @change="updateIntervalPreset(($event.target as HTMLSelectElement).value)"><option value="off">不自动执行</option><option value="60">1 分钟</option><option value="300">5 分钟</option><option value="900">15 分钟</option><option value="1800">30 分钟</option><option value="3600">1 小时</option><option value="custom">自定义间隔</option></select></label>
            <label v-if="intervalPresetValue(draft.intervalSeconds) === 'custom'" class="automation-field automation-schedule__custom-seconds"><span>自定义秒数</span><input type="number" :min="MIN_AUTOMATION_INTERVAL_SECONDS" :max="MAX_AUTOMATION_INTERVAL_SECONDS" step="1" :value="draft.intervalSeconds ?? ''" :disabled="busy" @input="setCustomInterval(($event.target as HTMLInputElement).value)" /></label>
          </div>
        </section>

        <p v-if="editorError" class="automation-editor__error" role="alert">{{ editorError }}</p>

        <footer class="automation-editor__actions">
          <button class="button button--secondary" type="button" :disabled="busy" @click="closeEditor">取消</button>
          <button class="button button--primary" type="button" :disabled="!canSave" @click="saveDraft">{{ busy ? "正在保存..." : "完成并保存" }}</button>
        </footer>
        </div>
      </section>
    </div>

    <div v-if="pendingDeletion" class="automation-confirm-backdrop">
      <section class="automation-confirm" role="alertdialog" aria-modal="true" aria-labelledby="automation-delete-title" tabindex="-1" @keydown.esc.stop="pendingDeletion = null">
        <div class="automation-confirm__icon"><Trash2 :size="19" aria-hidden="true" /></div>
        <div>
          <h2 id="automation-delete-title">删除批量自动化？</h2>
          <p>“{{ deletingRuleName }}”及其条件、动作和自动执行设置将被删除，且不能恢复。</p>
        </div>
        <footer class="automation-confirm__actions">
          <button class="button button--secondary" type="button" :disabled="busy" @click="pendingDeletion = null">取消</button>
          <button class="button button--danger" type="button" :disabled="busy" @click="confirmDelete"><Trash2 :size="15" />确认删除</button>
        </footer>
      </section>
    </div>

  </div>
</template>

<style scoped>
.automation-dialog-backdrop { position: fixed; z-index: 30; inset: var(--window-titlebar-height) 0 0; display: grid; place-items: center; padding: var(--dialog-backdrop-padding); background: var(--shadow-lift); }
.automation-dialog { width: min(100%, 1040px); height: min(620px, var(--dialog-content-max-height)); max-height: var(--dialog-content-max-height); overflow-y: auto; padding: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.automation-dialog__header, .automation-editor__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.automation-dialog__title { display: flex; align-items: flex-start; min-width: 0; gap: 11px; }
.automation-dialog__title h2 { margin: 1px 0 4px; color: var(--heading); font-size: 16px; line-height: 1.35; }
.automation-dialog__heading, .automation-heading-with-help, .automation-field__label { display: inline-flex; align-items: center; min-width: 0; gap: 6px; }
.automation-help { display: inline-grid; flex: 0 0 auto; place-items: center; color: var(--muted-soft); cursor: help; line-height: 1; }
.automation-help:hover { color: var(--brand); }
.automation-dialog__icon { display: inline-grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px; color: var(--violet); border-radius: 7px; background: var(--brand-subtle); }
.automation-dialog__icon--editor { color: var(--cyan); background: var(--cyan-subtle); }
.automation-dialog__close, .automation-rule-card__icon-button, .automation-step__icon-button, .automation-condition-row__remove, .automation-action-card__remove { display: inline-grid; flex: 0 0 auto; place-items: center; padding: 0; color: var(--muted); border-radius: 5px; background: transparent; cursor: pointer; }
.automation-dialog__close { width: 30px; height: 30px; }
.automation-dialog__close:hover:not(:disabled), .automation-rule-card__icon-button:hover:not(:disabled), .automation-step__icon-button:hover:not(:disabled), .automation-condition-row__remove:hover:not(:disabled), .automation-action-card__remove:hover:not(:disabled) { color: var(--brand); background: var(--surface-hover); }
.automation-dialog__toolbar { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; padding: 12px; gap: 14px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-subtle); }
.automation-dialog__toolbar .button, .automation-rule-card__actions .button, .automation-workflow__add-buttons .button, .automation-editor__actions .button, .automation-confirm__actions .button { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; gap: 7px; }
.automation-rule-list { display: grid; margin-top: 14px; gap: 10px; }
.automation-rule-card { display: flex; align-items: stretch; justify-content: space-between; min-width: 0; padding: 14px; gap: 14px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
.automation-rule-card:hover { border-color: var(--border-hover); box-shadow: 0 6px 16px var(--shadow-soft); }
.automation-rule-card__main { min-width: 0; }
.automation-rule-card__heading { display: flex; align-items: center; justify-content: space-between; min-width: 0; gap: 12px; }
.automation-rule-card__heading > div { display: flex; align-items: center; min-width: 0; gap: 8px; }
.automation-rule-card h3 { overflow: hidden; margin: 0; color: var(--heading); font-size: 14px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.automation-rule-card__interval { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; color: var(--brand-ink); font-size: 12px; white-space: nowrap; }
.automation-rule-card__summary { display: grid; margin: 10px 0 0; gap: 5px; }
.automation-rule-card__summary div { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; font-size: 12px; line-height: 1.45; }
.automation-rule-card__summary dt { color: var(--muted); }
.automation-rule-card__summary dd { overflow: hidden; margin: 0; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.automation-rule-card__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
.automation-rule-card__background-button { min-width: 94px; }
.automation-rule-card__icon-button { width: 34px; height: 34px; }
.automation-rule-card__icon-button--danger:hover:not(:disabled), .automation-step__icon-button--danger:hover:not(:disabled), .automation-condition-row__remove:hover:not(:disabled), .automation-action-card__remove:hover:not(:disabled) { color: var(--danger); background: var(--danger-subtle); }
.automation-dialog__empty { display: flex; align-items: flex-start; margin-top: 14px; padding: 22px; gap: 11px; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 7px; background: var(--surface-subtle); }
.automation-dialog__empty svg { flex: 0 0 auto; color: var(--brand); }
.automation-dialog__empty strong { display: block; color: var(--text); font-size: 13px; }
.automation-editor-backdrop, .automation-confirm-backdrop { position: fixed; z-index: 31; inset: var(--window-titlebar-height) 0 0; display: grid; overflow: hidden; place-items: center; padding: var(--dialog-backdrop-padding); background: color-mix(in srgb, var(--ink) 35%, transparent); }
.automation-editor { --automation-editor-padding: 20px; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(100%, 960px); height: min(900px, var(--dialog-content-max-height)); overflow: hidden; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); box-shadow: 0 24px 64px var(--shadow-lift); outline: 0; }
.automation-editor__header { padding: var(--automation-editor-padding) var(--automation-editor-padding) 14px; border-bottom: 1px solid var(--divider); background: var(--surface); }
.automation-editor__body { min-width: 0; min-height: 0; overflow: auto; padding: 0 var(--automation-editor-padding) var(--automation-editor-padding); scrollbar-color: var(--brand) var(--surface-subtle); scrollbar-width: thin; }
.automation-field { display: grid; min-width: 0; gap: 7px; color: var(--text); font-size: 12px; font-weight: 650; }
.automation-field--name { margin-top: 16px; }
.automation-field input, .automation-field select, .automation-condition-row input, .automation-condition-row select, .automation-conditions__logic select, .automation-action-card__select-row select { width: 100%; min-width: 0; height: 38px; padding: 0 9px; color: var(--text-strong); border: 1px solid var(--control-border); border-radius: 6px; background: var(--surface); color-scheme: light; outline: 0; font: inherit; font-size: 13px; }
.automation-field select option, .automation-condition-row select option, .automation-conditions__logic select option, .automation-action-card__select-row select option { color: var(--text-strong); background: var(--surface); }
.automation-field input:focus, .automation-field select:focus, .automation-condition-row input:focus, .automation-condition-row select:focus, .automation-conditions__logic select:focus, .automation-action-card__select-row select:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus-soft); }
.automation-workflow { margin-top: 18px; padding: 14px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-subtle); }
.automation-workflow__heading, .automation-schedule__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.automation-workflow h3, .automation-schedule h3 { margin: 0; color: var(--heading); font-size: 14px; line-height: 1.35; }
.automation-workflow__add-buttons { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.automation-step-list { display: grid; margin: 14px 0 0; padding: 0; gap: 0; list-style: none; }
.automation-step { display: grid; gap: 8px; }
.automation-step__controls { display: flex; align-items: center; min-height: 32px; padding-left: 13px; border-left: 2px solid var(--surface-selected-hover); }
.automation-step__controls--after { min-height: 26px; }
.automation-step__insert { display: inline-flex; align-items: center; min-height: 28px; padding: 0 9px; gap: 5px; color: var(--cyan); border: 1px dashed var(--cyan-border); border-radius: 5px; background: var(--cyan-subtle); font-size: 11px; font-weight: 650; cursor: pointer; }
.automation-step__insert:hover:not(:disabled) { color: var(--cyan-hover); border-color: var(--cyan); background: var(--surface); }
.automation-step__card { padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
.automation-step__card--refresh { border-color: var(--cyan-border); background: var(--cyan-subtle); }
.automation-step__card--conditional { border-color: var(--border-strong); }
.automation-step__header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.automation-step__card--conditional > .automation-step__header { padding-bottom: 10px; border-bottom: 1px solid var(--divider); }
.automation-step__title { display: inline-flex; align-items: center; gap: 7px; color: var(--heading); font-size: 13px; }
.automation-step__card--refresh .automation-step__title { color: var(--cyan); }
.automation-step__header-actions { display: flex; align-items: center; gap: 3px; }
.automation-step__icon-button { width: 28px; height: 28px; }
.automation-flow-section { margin-top: 12px; padding: 12px; border: 1px solid var(--divider); border-radius: 6px; }
.automation-flow-section--conditions { border-color: var(--cyan-border); background: var(--cyan-subtle); }
.automation-flow-section--actions { border-color: var(--border-hover); background: var(--brand-subtle); }
.automation-conditions__heading, .automation-actions__heading { display: flex; align-items: center; justify-content: space-between; min-height: 30px; padding-bottom: 9px; gap: 10px; color: var(--text); border-bottom: 1px solid var(--divider); font-size: 13px; font-weight: 650; }
.automation-conditions__heading { justify-content: flex-start; }
.automation-flow-section--conditions .automation-conditions__heading { border-color: var(--cyan-border); }
.automation-flow-section--actions .automation-actions__heading { border-color: var(--border-hover); }
.automation-conditions__logic { display: block; min-width: 145px; }
.automation-conditions__logic select { height: 30px; font-size: 12px; }
.automation-condition-tree { display: grid; margin-top: 7px; gap: 7px; }
.automation-condition-tree .automation-condition-row { margin-top: 0; }
.automation-condition-connector { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; min-height: 30px; gap: 8px; }
.automation-condition-connector > span { height: 1px; background: var(--cyan-border); }
.automation-condition-connector__choices { display: inline-flex; overflow: hidden; border: 1px solid var(--cyan-border); border-radius: 5px; background: var(--surface); }
.automation-condition-connector__choices button { min-width: 34px; height: 24px; padding: 0 8px; color: var(--muted); border-right: 1px solid var(--cyan-border); background: transparent; font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; }
.automation-condition-connector__choices button:last-child { border-right: 0; }
.automation-condition-connector__choices button:hover:not(:disabled) { color: var(--cyan); background: var(--cyan-subtle); }
.automation-condition-connector__choices button:disabled { color: var(--disabled-text); cursor: not-allowed; }
.automation-condition-connector__choice--active { color: var(--surface) !important; background: var(--cyan) !important; }
.automation-condition-row { display: grid; grid-template-columns: minmax(100px, 0.9fr) minmax(110px, 1fr) minmax(0, 1.3fr) auto; align-items: center; margin-top: 7px; gap: 7px; }
.automation-condition-row:has(input + input) { grid-template-columns: minmax(100px, 0.78fr) minmax(110px, 0.9fr) minmax(0, 1fr) minmax(0, 1fr) auto; }
.automation-condition-row--nested { padding: 7px; border: 1px solid var(--divider); border-left: 3px solid var(--brand-subtle); border-radius: 6px; background: var(--surface-subtle); }
.automation-condition-value-select { min-width: 0; }
.automation-condition-row :deep(.automation-condition-value-select .refreshable-filter-select__trigger) { height: 38px; border-radius: 6px; color-scheme: light; font-size: 13px; }
.automation-condition-row :deep(.automation-condition-value-select .refreshable-filter-select__menu) { z-index: 40; width: 100%; max-width: none; color-scheme: light; }
.automation-condition-row :deep(.automation-condition-value-select .refreshable-filter-select__option) { min-height: 36px; font-size: 13px; white-space: normal; }
.automation-condition-group { min-width: 0; padding: 10px; border: 1px solid var(--border); border-left: 3px solid var(--brand); border-radius: 6px; background: var(--surface-subtle); }
.automation-condition-group__heading { display: flex; align-items: center; justify-content: space-between; min-width: 0; gap: 10px; }
.automation-condition-group__heading > div:first-child { display: inline-flex; align-items: baseline; min-width: 0; gap: 7px; }
.automation-condition-group__heading strong { color: var(--text); font-size: 12px; }
.automation-condition-group__heading small { color: var(--muted); font-size: 11px; white-space: nowrap; }
.automation-condition-group__controls, .automation-condition-group__add, .automation-conditions__root-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.automation-condition-group__controls .automation-conditions__logic { min-width: 140px; }
.automation-condition-group__add { margin-top: 8px; }
.automation-condition-group__add .automation-inline-add, .automation-conditions__root-actions .automation-inline-add { margin-top: 0; }
.automation-conditions__root-actions { margin-top: 9px; }
.automation-condition-row__remove, .automation-action-card__remove { width: 30px; height: 30px; }
.automation-inline-add { display: inline-flex; align-items: center; min-height: 28px; margin-top: 9px; padding: 0 7px; gap: 4px; color: var(--brand); border: 1px dashed var(--border-hover); border-radius: 5px; background: var(--surface); font-size: 12px; font-weight: 650; cursor: pointer; }
.automation-inline-add:hover:not(:disabled) { background: var(--brand-hover-subtle); }
.automation-action-card { margin-top: 10px; padding: 10px; border: 1px solid var(--divider); border-radius: 6px; background: var(--surface); }
.automation-action-card__select-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; color: var(--brand); }
.automation-action-card__select-row select { background: var(--surface); }
.automation-action-card__config-panel { margin-top: 12px; padding: 10px; border: 1px solid var(--border); border-left: 3px solid var(--brand); border-radius: 6px; background: var(--surface-subtle); }
.automation-action-card__config-heading { display: flex; align-items: baseline; min-width: 0; padding: 0 1px 9px; gap: 8px; border-bottom: 1px dashed var(--border-hover); }
.automation-action-card__config-heading strong { color: var(--heading); font-size: 12px; }
.automation-action-card__config-heading small { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.automation-action-card__config { display: grid; margin-top: 10px; gap: 9px; }
.automation-action-card__config--rename { grid-template-columns: minmax(0, 1.6fr) minmax(0, 0.7fr) minmax(0, 0.7fr); }
.automation-action-card__config--rename > :first-child { grid-column: 1 / -1; }
.automation-action-card__config--export { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.5fr); }
.automation-action-card__config--export .automation-field--directory, .automation-action-card__config--export .automation-checkbox, .automation-action-card__config--export .automation-template-tokens { grid-column: 1 / -1; }
.automation-field--directory > div { display: flex; min-width: 0; gap: 7px; }
.automation-field--directory input { flex: 1 1 auto; }
.automation-field--directory .button { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 38px; gap: 5px; white-space: nowrap; }
.automation-checkbox { display: inline-flex; align-items: center; min-height: 30px; gap: 7px; color: var(--text); font-size: 12px; font-weight: 500; cursor: pointer; }
.automation-template-tokens { display: flex; align-items: center; flex-wrap: wrap; min-height: 28px; gap: 5px; color: var(--muted); font-size: 11px; }
.automation-template-tokens > span { margin-right: 2px; }
.automation-template-tokens button { min-height: 25px; padding: 0 7px; color: var(--brand-ink); border: 1px solid var(--border-hover); border-radius: 4px; background: var(--surface); font: inherit; font-weight: 650; cursor: pointer; }
.automation-template-tokens button:hover:not(:disabled) { border-color: var(--brand); background: var(--brand-hover-subtle); }
.automation-template-tokens button:disabled { opacity: 0.5; cursor: not-allowed; }
.automation-checkbox input, .automation-delete-statuses input, .automation-report-fields input { width: 15px; height: 15px; margin: 0; accent-color: var(--brand); }
.automation-delete-statuses { padding: 10px; border: 1px solid var(--warning-border); border-radius: 6px; background: var(--warning-subtle); }
.automation-delete-statuses strong { color: var(--warning); font-size: 12px; }
.automation-delete-statuses > div { display: flex; flex-wrap: wrap; margin-top: 8px; gap: 6px 12px; }
.automation-delete-statuses label { display: inline-flex; align-items: center; gap: 5px; color: var(--text); font-size: 12px; cursor: pointer; }
.automation-report-fields { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.automation-report-fields summary { display: flex; align-items: center; justify-content: space-between; min-height: 35px; padding: 0 9px; color: var(--text); font-size: 12px; font-weight: 650; cursor: pointer; }
.automation-report-fields summary::-webkit-details-marker { display: none; }
.automation-report-fields summary svg { transition: transform 0.15s ease; }
.automation-report-fields[open] summary { border-bottom: 1px solid var(--divider); }
.automation-report-fields[open] summary svg { transform: rotate(180deg); }
.automation-report-fields > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.automation-report-fields label { display: flex; align-items: flex-start; min-width: 0; padding: 8px 9px; gap: 7px; border-bottom: 1px solid var(--divider); cursor: pointer; }
.automation-report-fields label:nth-child(odd) { border-right: 1px solid var(--divider); }
.automation-report-fields label:nth-last-child(-n + 2):nth-child(odd), .automation-report-fields label:last-child { border-bottom: 0; }
.automation-report-fields span { display: grid; min-width: 0; gap: 1px; }
.automation-report-fields strong { color: var(--text); font-size: 12px; line-height: 1.3; }
.automation-schedule { margin-top: 16px; padding: 13px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-subtle); }
.automation-schedule__heading { align-items: center; justify-content: flex-start; }
.automation-schedule__title { display: inline-flex; align-items: center; gap: 8px; }
.automation-schedule__title > svg { flex: 0 0 auto; color: var(--brand); }
.automation-schedule__controls { display: flex; align-items: flex-end; flex-wrap: wrap; margin-top: 11px; gap: 10px 14px; }
.automation-schedule__interval { flex: 0 1 270px; width: min(270px, 100%); }
.automation-schedule__custom-seconds { flex: 0 1 220px; width: min(220px, 100%); }
.automation-editor__error { margin: 14px 0 0; padding: 10px 12px; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 6px; background: var(--danger-subtle); font-size: 13px; line-height: 1.5; }
.automation-editor__actions, .automation-confirm__actions { display: flex; justify-content: flex-end; margin-top: 18px; gap: 8px; }
.automation-confirm { display: grid; grid-template-columns: auto minmax(0, 1fr); width: min(100%, 440px); padding: 20px; gap: 11px; border: 1px solid var(--danger-border); border-radius: 8px; background: var(--surface); box-shadow: 0 20px 56px var(--shadow-lift); outline: 0; }
.automation-confirm__icon { display: inline-grid; place-items: center; width: 34px; height: 34px; color: var(--danger); border-radius: 7px; background: var(--danger-subtle); }
.automation-confirm h2 { margin: 2px 0 4px; color: var(--heading); font-size: 15px; line-height: 1.35; }
.automation-confirm p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.automation-confirm__actions { grid-column: 1 / -1; margin-top: 5px; }
@media (max-width: 760px) { .automation-dialog-backdrop { align-items: center; padding: var(--dialog-backdrop-padding-top) 12px var(--dialog-viewport-gap); } .automation-editor-backdrop, .automation-confirm-backdrop { align-items: end; padding: 12px; } .automation-dialog { height: min(560px, var(--dialog-content-max-height)); max-height: var(--dialog-content-max-height); padding: 16px; } .automation-editor { --automation-editor-padding: 16px; max-height: calc(100dvh - var(--window-titlebar-height) - 24px); } .automation-editor__header { padding-bottom: 12px; } .automation-dialog__toolbar, .automation-workflow__heading, .automation-schedule__heading { align-items: flex-start; flex-direction: column; } .automation-workflow__add-buttons { justify-content: flex-start; } .automation-rule-card { flex-direction: column; } .automation-rule-card__actions { justify-content: flex-end; } .automation-condition-row, .automation-condition-row:has(input + input) { grid-template-columns: 1fr 1fr auto; } .automation-condition-row input, .automation-condition-row select:nth-of-type(2) { grid-column: span 1; } .automation-condition-row input + input { grid-column: 1 / span 2; } .automation-action-card__config--rename, .automation-action-card__config--export { grid-template-columns: 1fr; } .automation-schedule__controls { width: 100%; align-items: stretch; flex-direction: column; } .automation-schedule__interval, .automation-schedule__custom-seconds { flex-basis: auto; width: 100%; } .automation-action-card__config--rename > :first-child, .automation-action-card__config--export .automation-field--directory, .automation-action-card__config--export .automation-checkbox { grid-column: auto; } }
@media (max-width: 500px) { .automation-rule-card__heading { align-items: flex-start; flex-direction: column; gap: 5px; } .automation-condition-row, .automation-condition-row:has(input + input) { grid-template-columns: 1fr auto; } .automation-condition-row > select, .automation-condition-row > input { grid-column: 1; } .automation-condition-row__remove { grid-column: 2; grid-row: 1 / span 4; align-self: center; } .automation-report-fields > div { grid-template-columns: 1fr; } .automation-report-fields label:nth-child(odd) { border-right: 0; } .automation-report-fields label:nth-last-child(-n + 2):nth-child(odd) { border-bottom: 1px solid var(--divider); } .automation-report-fields label:last-child { border-bottom: 0; } .automation-field--directory > div { align-items: stretch; flex-direction: column; } .automation-field--directory .button { justify-content: center; } }
</style>
