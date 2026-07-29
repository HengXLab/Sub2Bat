import { describe, expect, it } from "vitest";
import {
  AUTOMATION_UNGROUPED_GROUP_VALUE,
  MIN_AUTOMATION_INTERVAL_SECONDS,
  automationAccountPlanTypeFilterValue,
  automationRuleUsesSessionTestState,
  collectAutomationRuleTargets,
  createDefaultAutomationAction,
  createDefaultAutomationRule,
  evaluateAutomationCondition,
  evaluateAutomationConditionGroup,
  getAutomationDeleteStatus,
  isAutomationRuleExecutable,
  normalizeAutomationRule,
  normalizeAutomationRules,
  summarizeAutomationConditionNode,
} from "./automation";
import { getAccountPlanTypeConditionOptions } from "./accounts";
import type { Account } from "../types";
import type { AutomationCondition, AutomationConditionGroup, AutomationRule } from "./automation";

function account(status: string): Account {
  return {
    id: 1,
    name: "automation-test",
    platform: "openai",
    accountType: "oauth",
    status,
  };
}

function condition(
  id: string,
  field: AutomationCondition["field"],
  operator: AutomationCondition["operator"],
  value: AutomationCondition["value"],
  joinWithPrevious?: "and" | "or",
): AutomationCondition {
  return {
    kind: "condition",
    id,
    ...(joinWithPrevious ? { joinWithPrevious } : {}),
    field,
    operator,
    value,
  };
}

describe("automation deletion safeguards", () => {
  it("keeps a currently normal account out of an old failed-test delete scope", () => {
    expect(getAutomationDeleteStatus(account("active"), {
      status: "failed",
      testedAt: "2026-07-15T00:00:00.000Z",
    })).toBe("normal");
  });

  it("uses the current server error state even after a prior successful test", () => {
    expect(getAutomationDeleteStatus(account("error"), {
      status: "succeeded",
      testedAt: "2026-07-15T00:00:00.000Z",
    })).toBe("error");
  });

  it("retains a connection interruption only when the current server state is unknown", () => {
    expect(getAutomationDeleteStatus(account("provider_pending"), {
      status: "connectionInterrupted",
      testedAt: "2026-07-15T00:00:00.000Z",
    })).toBe("connection_interrupted");
  });
});

describe("automation session and group conditions", () => {
  it("starts a report action with usable report columns", () => {
    const action = createDefaultAutomationAction("exportReport");

    expect(action.kind).toBe("exportReport");
    if (action.kind === "exportReport") expect(action.columns.length).toBeGreaterThan(0);
  });

  it("recognizes a scheduled rule that depends on session-only test state", () => {
    const rule = createDefaultAutomationRule();
    const step = rule.steps[0];
    if (step.kind !== "conditional") throw new Error("expected a conditional default step");
    step.condition.children[0] = {
      kind: "condition",
      id: "session-test-condition",
      field: "latestTest",
      operator: "equals",
      value: "error",
    };

    expect(automationRuleUsesSessionTestState(rule)).toBe(true);
  });

  it("matches an ungrouped account through the explicit group value", () => {
    expect(evaluateAutomationCondition({
      kind: "condition",
      id: "ungrouped-condition",
      field: "group",
      operator: "equals",
      value: AUTOMATION_UNGROUPED_GROUP_VALUE,
    }, account("active"))).toBe(true);
  });

  it("matches the configured per-account concurrency limit instead of runtime concurrency", () => {
    const configuredAccount: Account = {
      ...account("active"),
      concurrency: 5,
      currentConcurrency: 0,
    };

    expect(evaluateAutomationCondition({
      kind: "condition",
      id: "concurrency-limit-condition",
      field: "concurrency",
      operator: "equals",
      value: 5,
    }, configuredAccount)).toBe(true);
  });

  it("matches name conditions with * and ? wildcard patterns", () => {
    const namedAccount = { ...account("active"), name: "Test-42" };

    expect(evaluateAutomationCondition({
      kind: "condition",
      id: "name-wildcard",
      field: "name",
      operator: "matches",
      value: "test-??",
    }, namedAccount)).toBe(true);
    expect(evaluateAutomationCondition({
      kind: "condition",
      id: "name-exact-boundary",
      field: "name",
      operator: "matches",
      value: "Test",
    }, namedAccount)).toBe(false);
    expect(evaluateAutomationCondition({
      kind: "condition",
      id: "name-not-matches",
      field: "name",
      operator: "notMatches",
      value: "other-*",
    }, namedAccount)).toBe(true);
  });
});

describe("automation account-type conditions", () => {
  it("matches the shared account-type menu tokens, including missing plan types", () => {
    const options = getAccountPlanTypeConditionOptions(["free", "k12", "未识别"], true);
    const k12 = options.find((option) => option.label === "k12");
    const missing = options.find((option) => option.label === "未识别");
    const literalUnrecognized = options.find((option) => option.label === "未识别（原始类型）");

    expect(k12).toBeDefined();
    expect(missing).toBeDefined();
    expect(literalUnrecognized).toBeDefined();

    const k12Condition = condition("k12", "planType", "equals", automationAccountPlanTypeFilterValue(k12!.value));
    const missingCondition = condition("missing", "planType", "equals", automationAccountPlanTypeFilterValue(missing!.value));
    const literalCondition = condition("literal", "planType", "equals", automationAccountPlanTypeFilterValue(literalUnrecognized!.value));

    expect(evaluateAutomationCondition(k12Condition, { ...account("active"), planType: "K12" })).toBe(true);
    expect(evaluateAutomationCondition(missingCondition, account("active"))).toBe(true);
    expect(evaluateAutomationCondition(literalCondition, { ...account("active"), planType: "未识别" })).toBe(true);
    expect(evaluateAutomationCondition(missingCondition, { ...account("active"), planType: "未识别" })).toBe(false);
  });
});

function validPersistedRule() {
  return {
    version: 1,
    id: "rule-safe",
    name: "只处理指定账号",
    enabled: true,
    intervalSeconds: 60,
    steps: [{
      id: "step-safe",
      kind: "conditional",
      condition: {
        kind: "group",
        id: "group-safe",
        children: [{
          kind: "condition",
          id: "condition-safe",
          field: "name",
          operator: "matches",
          value: "safe-*",
        }],
      },
      actions: [{
        id: "action-safe",
        kind: "deleteAccounts",
        targetStatuses: ["error"],
      }],
    }],
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function persistedConditionalStep(rule: ReturnType<typeof validPersistedRule>): Record<string, unknown> {
  return rule.steps[0] as unknown as Record<string, unknown>;
}

function persistedCondition(rule: ReturnType<typeof validPersistedRule>): Record<string, unknown> {
  return persistedConditionalStep(rule).condition as Record<string, unknown>;
}

function persistedDeleteAction(rule: ReturnType<typeof validPersistedRule>): Record<string, unknown> {
  const step = persistedConditionalStep(rule);
  return (step.actions as Record<string, unknown>[])[0];
}

describe("automation persistence fail-closed normalization", () => {
  it("accepts a ten-second automatic interval and rejects a shorter one", () => {
    const minimum = validPersistedRule();
    minimum.intervalSeconds = MIN_AUTOMATION_INTERVAL_SECONDS;
    expect(normalizeAutomationRule(minimum)?.intervalSeconds).toBe(MIN_AUTOMATION_INTERVAL_SECONDS);

    const tooShort = validPersistedRule();
    tooShort.intervalSeconds = MIN_AUTOMATION_INTERVAL_SECONDS - 1;
    expect(normalizeAutomationRule(tooShort)?.intervalSeconds).toBeNull();
  });

  it("keeps a newly created empty-condition draft editable but non-executable", () => {
    const normalized = normalizeAutomationRule(createDefaultAutomationRule());

    expect(normalized).not.toBeNull();
    expect(normalized?.steps).toHaveLength(1);
    expect(isAutomationRuleExecutable(normalized!)).toBe(false);
  });

  it("drops the complete rule when a condition uses an illegal comparator", () => {
    const rule = validPersistedRule();
    const children = persistedCondition(rule).children as Record<string, unknown>[];
    children[0].operator = "equals";

    expect(normalizeAutomationRule(rule)).toBeNull();
  });

  it("drops the complete rule instead of removing an invalid condition child", () => {
    const rule = validPersistedRule();
    const children = persistedCondition(rule).children as Record<string, unknown>[];
    children.push({
      kind: "condition",
      id: "condition-corrupt",
      field: "not-a-real-field",
      operator: "matches",
      value: "*",
    });

    expect(normalizeAutomationRule(rule)).toBeNull();
  });

  it("drops a rule with a missing condition instead of inserting a default condition", () => {
    const rule = validPersistedRule();
    Reflect.deleteProperty(persistedConditionalStep(rule), "condition");

    expect(normalizeAutomationRule(rule)).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["empty", []],
    ["unknown", ["error", "not-a-status"]],
  ])("drops a rule with %s delete target statuses", (_label, targetStatuses) => {
    const rule = validPersistedRule();
    const action = persistedDeleteAction(rule);
    if (targetStatuses === undefined) Reflect.deleteProperty(action, "targetStatuses");
    else action.targetStatuses = targetStatuses;

    expect(normalizeAutomationRule(rule)).toBeNull();
  });

  it("keeps only fully valid records when loading a persisted rule list", () => {
    const valid = validPersistedRule();
    const malformed = validPersistedRule();
    (persistedCondition(malformed).children as Record<string, unknown>[])[0].operator = "equals";

    const loaded = normalizeAutomationRules([valid, malformed]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("rule-safe");
  });

  it("migrates the older runtime concurrency condition to the configured limit", () => {
    const rule = validPersistedRule();
    const condition = (persistedCondition(rule).children as Record<string, unknown>[])[0]!;
    condition.field = "currentConcurrency";
    condition.operator = "equals";
    condition.value = 5;

    const normalized = normalizeAutomationRule(rule);
    const step = normalized?.steps[0];
    if (!step || step.kind !== "conditional") throw new Error("expected a conditional step");
    const migrated = step.condition.children[0];
    if (!migrated || migrated.kind !== "condition") throw new Error("expected a migrated condition");

    expect(migrated.field).toBe("concurrency");
  });

  it("keeps a legacy paused schedule as manual-only after removing the schedule toggle", () => {
    const rule = validPersistedRule();
    rule.enabled = false;
    rule.intervalSeconds = 60;

    const normalized = normalizeAutomationRule(rule);

    expect(normalized?.enabled).toBe(true);
    expect(normalized?.intervalSeconds).toBeNull();
  });
});

describe("automation condition connectors and nesting", () => {
  it("evaluates a connector on each node with AND precedence and summarizes it", () => {
    const expression: AutomationConditionGroup = {
      kind: "group",
      id: "root-connectors",
      children: [
        condition("name", "name", "matches", "never-matches"),
        condition("priority", "priority", "greaterOrEqual", 10, "or"),
        condition("concurrency", "concurrency", "greaterOrEqual", 5, "and"),
      ],
    };

    expect(evaluateAutomationConditionGroup(expression, {
      ...account("active"),
      priority: 10,
      concurrency: 5,
    })).toBe(true);
    expect(evaluateAutomationConditionGroup(expression, {
      ...account("active"),
      priority: 10,
      concurrency: 4,
    })).toBe(false);

    const summary = summarizeAutomationConditionNode(expression);
    expect(summary).toContain("或");
    expect(summary).toContain("且");
  });

  it("keeps one nested group as explicit parentheses", () => {
    const expression: AutomationConditionGroup = {
      kind: "group",
      id: "root-nested",
      children: [
        condition("name", "name", "matches", "never-matches"),
        {
          kind: "group",
          id: "nested",
          joinWithPrevious: "or",
          children: [
            condition("priority", "priority", "greaterOrEqual", 10),
            condition("concurrency", "concurrency", "greaterOrEqual", 5, "and"),
          ],
        },
      ],
    };

    expect(evaluateAutomationConditionGroup(expression, {
      ...account("active"),
      priority: 10,
      concurrency: 5,
    })).toBe(true);
    expect(summarizeAutomationConditionNode(expression)).toContain("（");
  });

  it("migrates a pure legacy group operator to every following node connector", () => {
    const rule = validPersistedRule();
    const root = persistedCondition(rule);
    root.operator = "or";
    (root.children as Record<string, unknown>[]).push({
      kind: "condition",
      id: "condition-legacy-second",
      field: "name",
      operator: "matches",
      value: "legacy-*",
    });

    const normalized = normalizeAutomationRule(rule);
    const step = normalized?.steps[0];
    if (!step || step.kind !== "conditional") throw new Error("expected a conditional step");
    const second = step.condition.children[1];
    if (!second || second.kind !== "condition") throw new Error("expected a migrated condition");

    expect(second.joinWithPrevious).toBe("or");
    expect("operator" in step.condition).toBe(false);
    expect(evaluateAutomationConditionGroup(step.condition, {
      ...account("active"),
      name: "legacy-account",
    })).toBe(true);
  });

  it("migrates a legacy nested group without changing its parent connector", () => {
    const rule = validPersistedRule();
    const root = persistedCondition(rule);
    root.children = [
      condition("root-condition", "name", "matches", "safe-*"),
      {
        kind: "group",
        id: "legacy-nested",
        joinWithPrevious: "or",
        operator: "and",
        children: [
          condition("nested-priority", "priority", "greaterOrEqual", 10),
          condition("nested-concurrency", "concurrency", "greaterOrEqual", 5),
        ],
      },
    ];

    const normalized = normalizeAutomationRule(rule);
    const step = normalized?.steps[0];
    if (!step || step.kind !== "conditional") throw new Error("expected a conditional step");
    const nested = step.condition.children[1];
    if (!nested || nested.kind !== "group") throw new Error("expected a nested group");
    const nestedSecond = nested.children[1];
    if (!nestedSecond || nestedSecond.kind !== "condition") throw new Error("expected a nested condition");

    expect(nested.joinWithPrevious).toBe("or");
    expect(nestedSecond.joinWithPrevious).toBe("and");
    expect("operator" in nested).toBe(false);
  });

  it("rejects an ambiguous hybrid of legacy group operator and node connectors", () => {
    const rule = validPersistedRule();
    const root = persistedCondition(rule);
    root.operator = "and";
    (root.children as Record<string, unknown>[]).push({
      kind: "condition",
      id: "condition-hybrid",
      joinWithPrevious: "or",
      field: "name",
      operator: "matches",
      value: "safe-*",
    });

    expect(normalizeAutomationRule(rule)).toBeNull();
  });

  it("rejects missing per-node connectors and a root connector", () => {
    const missingConnector = validPersistedRule();
    (persistedCondition(missingConnector).children as Record<string, unknown>[]).push({
      kind: "condition",
      id: "condition-no-connector",
      field: "name",
      operator: "matches",
      value: "safe-*",
    });
    expect(normalizeAutomationRule(missingConnector)).toBeNull();

    const rootConnector = validPersistedRule();
    persistedCondition(rootConnector).joinWithPrevious = "and";
    expect(normalizeAutomationRule(rootConnector)).toBeNull();
  });

  it("rejects legacy trees deeper than the one nested group supported by the editor", () => {
    const rule = validPersistedRule();
    persistedConditionalStep(rule).condition = {
      kind: "group",
      id: "root",
      children: [{
        kind: "group",
        id: "first-nested",
        children: [{
          kind: "group",
          id: "too-deep",
          children: [condition("deep", "name", "matches", "safe-*")],
        }],
      }],
    };

    expect(normalizeAutomationRule(rule)).toBeNull();
  });

  it("fails closed instead of treating a missing connector as implicit AND", () => {
    const malformed = {
      kind: "group",
      id: "malformed-root",
      children: [
        condition("first", "name", "matches", "*"),
        condition("second", "id", "equals", 1),
      ],
    } as unknown as AutomationConditionGroup;

    expect(evaluateAutomationConditionGroup(malformed, account("error"))).toBe(false);
    expect(summarizeAutomationConditionNode(malformed)).toContain("未设置关系");
    expect(evaluateAutomationConditionGroup(
      condition("not-a-group", "name", "matches", "*") as unknown as AutomationConditionGroup,
      account("error"),
    )).toBe(false);
  });

  it("never produces action targets from an incomplete connector tree", () => {
    const rule = createDefaultAutomationRule();
    const step = rule.steps[0];
    if (step.kind !== "conditional") throw new Error("expected a conditional default step");
    step.condition.children = [
      condition("first", "name", "matches", "*"),
      condition("second", "id", "equals", 1),
    ];
    step.actions = [createDefaultAutomationAction("deleteAccounts")];

    expect(collectAutomationRuleTargets(rule, [account("error")])).toEqual([]);
    expect(isAutomationRuleExecutable(rule)).toBe(false);
  });

  it("treats an unreadable in-memory rule as non-executable", () => {
    const malformed = {} as AutomationRule;

    expect(isAutomationRuleExecutable(malformed)).toBe(false);
    expect(collectAutomationRuleTargets(malformed, [account("error")])).toEqual([]);
  });
});
