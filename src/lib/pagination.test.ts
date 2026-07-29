import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  clampPage,
  getPageCount,
  getPageItemIds,
  getPageItems,
  getPageRange,
  getPageSelectionState,
  getPaginationItems,
  sortItems,
} from "./pagination";

describe("pagination", () => {
  it("uses ten accounts as the default page size", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 20, 50, 100, 200]);
    expect(DEFAULT_ACCOUNT_PAGE_SIZE).toBe(10);
  });

  it("returns the requested page slice and its visible range", () => {
    const items = Array.from({ length: 46 }, (_, index) => index + 1);

    expect(getPageItems(items, 2, 20)).toEqual(items.slice(20, 40));
    expect(getPageRange(items.length, 3, 20)).toEqual({ from: 41, to: 46 });
  });

  it("returns IDs from the supplied page order for page-level selection", () => {
    const sortedAccounts = [
      { id: 8, name: "First" },
      { id: 3, name: "Second" },
      { id: 11, name: "Third" },
      { id: 1, name: "Fourth" },
    ];

    expect(getPageItemIds(sortedAccounts, 2, 2)).toEqual([11, 1]);
    expect(sortedAccounts.map((account) => account.id)).toEqual([8, 3, 11, 1]);
  });

  it("computes all and indeterminate states from only the current page", () => {
    const pageIds = [11, 4, 8];

    expect(getPageSelectionState(pageIds, [4, 99])).toEqual({
      selectedCount: 1,
      allSelected: false,
      indeterminate: true,
    });
    expect(getPageSelectionState(pageIds, [11, 4, 8, 99])).toEqual({
      selectedCount: 3,
      allSelected: true,
      indeterminate: false,
    });
    expect(getPageSelectionState([], [11])).toEqual({
      selectedCount: 0,
      allSelected: false,
      indeterminate: false,
    });
  });

  it("keeps a stale page within the available page bounds", () => {
    expect(getPageCount(0, 20)).toBe(1);
    expect(clampPage(9, 2)).toBe(2);
    expect(clampPage(0, 2)).toBe(1);
    expect(getPageItems([1, 2, 3], 9, 2)).toEqual([3]);
  });

  it("uses ellipses only when a page list is long", () => {
    expect(getPaginationItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPaginationItems(6, 12)).toEqual([1, "ellipsis-start", 5, 6, 7, "ellipsis-end", 12]);
  });

  it("sorts locally without mutating the source and preserves equal-item order", () => {
    const items = [
      { id: "first", score: 2 },
      { id: "second", score: 1 },
      { id: "third", score: 2 },
    ];

    expect(sortItems(items, (left, right) => left.score - right.score, "asc").map((item) => item.id))
      .toEqual(["second", "first", "third"]);
    expect(sortItems(items, (left, right) => left.score - right.score, "desc").map((item) => item.id))
      .toEqual(["first", "third", "second"]);
    expect(items.map((item) => item.id)).toEqual(["first", "second", "third"]);
  });
});
