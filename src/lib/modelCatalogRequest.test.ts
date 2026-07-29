import { describe, expect, it } from "vitest";
import {
  createModelCatalogRequestGuard,
  modelScopeKey,
  normalizeModelScope,
  shouldLoadModelScope,
} from "./modelCatalogRequest";

describe("model catalog requests", () => {
  it("normalizes duplicate account IDs into one stable scope key", () => {
    expect(modelScopeKey([3, 1, 3, 2])).toBe("1,2,3");
  });

  it("keeps canonical account IDs alongside the model scope key", () => {
    expect(normalizeModelScope([3, 1, 3, 2])).toEqual({
      key: "1,2,3",
      accountIds: [1, 2, 3],
    });
  });

  it("accepts only the most recently started request", () => {
    const guard = createModelCatalogRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidates an active request after a session boundary", () => {
    const guard = createModelCatalogRequestGuard();
    const request = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });

  it("skips a repeated scope after a nonempty catalog succeeds", () => {
    expect(shouldLoadModelScope("1,2", "1,2", true, false)).toBe(false);
  });

  it("retries a repeated scope after an empty catalog succeeds", () => {
    expect(shouldLoadModelScope("1,2", "1,2", false, false)).toBe(true);
  });

  it("retries a repeated scope when forced", () => {
    expect(shouldLoadModelScope("1,2", "1,2", true, true)).toBe(true);
  });
});
