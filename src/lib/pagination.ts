export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const;
/** Mirrors the account-page navigation cap enforced by the Tauri command. */
export const MAX_ACCOUNT_PAGE_NUMBER = 999_999;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_ACCOUNT_PAGE_SIZE: PageSize = PAGE_SIZE_OPTIONS[0];
export type PaginationItem = number | "ellipsis-start" | "ellipsis-end";
export type SortDirection = "asc" | "desc";

export interface PaginationRange {
  from: number;
  to: number;
}

export interface PageSelectionState {
  selectedCount: number;
  allSelected: boolean;
  indeterminate: boolean;
}

export function getPageCount(totalItems: number, pageSize: number): number {
  if (totalItems <= 0 || pageSize <= 0) return 1;
  return Math.min(MAX_ACCOUNT_PAGE_NUMBER, Math.ceil(totalItems / pageSize));
}

export function clampPage(page: number, pageCount: number): number {
  const boundedPageCount = Math.min(MAX_ACCOUNT_PAGE_NUMBER, Math.max(1, pageCount));
  return Math.min(Math.max(1, Math.trunc(page) || 1), boundedPageCount);
}

export function getPageItems<T>(items: readonly T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) return [];

  const safePage = clampPage(page, getPageCount(items.length, pageSize));
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** Gets account IDs for one page while preserving the supplied item order. */
export function getPageItemIds<T extends { id: number }>(items: readonly T[], page: number, pageSize: number): number[] {
  return getPageItems(items, page, pageSize).map((item) => item.id);
}

/** Computes selection state from just the IDs visible on the current page. */
export function getPageSelectionState(pageAccountIds: readonly number[], selectedIds: readonly number[]): PageSelectionState {
  const selected = new Set(selectedIds);
  const selectedCount = pageAccountIds.filter((accountId) => selected.has(accountId)).length;

  return {
    selectedCount,
    allSelected: pageAccountIds.length > 0 && selectedCount === pageAccountIds.length,
    indeterminate: selectedCount > 0 && selectedCount < pageAccountIds.length,
  };
}

/** Returns a stable local sort without changing the source collection. */
export function sortItems<T>(
  items: readonly T[],
  compare: (left: T, right: T) => number,
  direction: SortDirection,
): T[] {
  const multiplier = direction === "desc" ? -1 : 1;

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const result = compare(left.item, right.item);
      return result === 0 || Number.isNaN(result) ? left.index - right.index : result * multiplier;
    })
    .map(({ item }) => item);
}

export function getPageRange(totalItems: number, page: number, pageSize: number): PaginationRange {
  if (totalItems <= 0 || pageSize <= 0) return { from: 0, to: 0 };

  const safePage = clampPage(page, getPageCount(totalItems, pageSize));
  const from = (safePage - 1) * pageSize + 1;
  return { from, to: Math.min(from + pageSize - 1, totalItems) };
}

export function getPaginationItems(page: number, pageCount: number): PaginationItem[] {
  const safePageCount = Math.max(1, pageCount);
  const safePage = clampPage(page, safePageCount);

  if (safePageCount <= 7) {
    return Array.from({ length: safePageCount }, (_, index) => index + 1);
  }

  if (safePage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-end", safePageCount];
  }

  if (safePage >= safePageCount - 3) {
    return [1, "ellipsis-start", safePageCount - 4, safePageCount - 3, safePageCount - 2, safePageCount - 1, safePageCount];
  }

  return [1, "ellipsis-start", safePage - 1, safePage, safePage + 1, "ellipsis-end", safePageCount];
}
