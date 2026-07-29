import { describe, expect, it } from "vitest";
import type { AccountOperationResult } from "../types";
import { removeAccountIdsFromSelection, resolveAccountOperation } from "./accountOperations";

function operation(overrides: Partial<AccountOperationResult>): AccountOperationResult {
  return {
    total: 0,
    success: 0,
    failed: 0,
    successIds: [],
    failedIds: [],
    results: [],
    ...overrides,
  };
}

describe("account operation resolution", () => {
  it("removes only the 40 deleted accounts from a 100-account selection", () => {
    const selected = Array.from({ length: 100 }, (_, index) => index + 1);
    const deleted = selected.slice(0, 40);
    const resolved = resolveAccountOperation(
      operation({
        total: 100,
        success: 40,
        failed: 60,
        successIds: deleted,
        failedIds: selected.slice(40),
      }),
      selected,
    );

    expect(removeAccountIdsFromSelection(selected, resolved.completedIds)).toHaveLength(60);
    expect(removeAccountIdsFromSelection(selected, resolved.completedIds)).toEqual(selected.slice(40));
  });

  it("does not remove unrelated selected IDs from an untrusted response", () => {
    const resolved = resolveAccountOperation(
      operation({ total: 1, success: 1, successIds: [999] }),
      [1, 2],
    );

    expect(resolved.completedIds).toEqual([]);
    expect(resolved.pendingIds).toEqual([1, 2]);
  });

  it("supports exact aggregate success totals when details are omitted", () => {
    const resolved = resolveAccountOperation(
      operation({ total: 2, success: 2 }),
      [11, 12],
    );

    expect(resolved.completedIds).toEqual([11, 12]);
  });
});
