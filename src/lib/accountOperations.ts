import type { AccountOperationResult } from "../types";

export interface AccountOperationResolution {
  attemptedIds: number[];
  completedIds: number[];
  failedIds: number[];
  pendingIds: number[];
}

function validAccountIds(accountIds: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const accountId of accountIds) {
    if (Number.isSafeInteger(accountId) && accountId > 0) unique.add(accountId);
  }
  return [...unique];
}

/**
 * Resolves per-account operation state without trusting IDs outside the
 * requested set. Compatible servers may return either detailed IDs/results
 * or exact aggregate totals, so the latter is used only when no detail exists.
 */
export function resolveAccountOperation(
  result: AccountOperationResult,
  attemptedAccountIds: readonly number[],
): AccountOperationResolution {
  const attemptedIds = validAccountIds(attemptedAccountIds);
  const attempted = new Set(attemptedIds);
  const completed = new Set<number>();
  const failed = new Set<number>();

  for (const accountId of result.successIds ?? []) {
    if (attempted.has(accountId)) completed.add(accountId);
  }
  for (const accountId of result.failedIds ?? []) {
    if (attempted.has(accountId)) failed.add(accountId);
  }

  for (const item of result.results ?? []) {
    if (!attempted.has(item.accountId)) continue;
    if (item.success) {
      if (!failed.has(item.accountId)) completed.add(item.accountId);
    } else {
      failed.add(item.accountId);
      completed.delete(item.accountId);
    }
  }

  // Some compatible servers omit all per-account details but provide exact
  // aggregate totals. Only infer the all-success/all-failure cases, never a
  // partial result whose individual IDs cannot be identified safely.
  if (completed.size === 0 && failed.size === 0 && (result.results?.length ?? 0) === 0) {
    if (result.success === attemptedIds.length && result.failed === 0) {
      for (const accountId of attemptedIds) completed.add(accountId);
    } else if (result.failed === attemptedIds.length && result.success === 0) {
      for (const accountId of attemptedIds) failed.add(accountId);
    }
  }

  return {
    attemptedIds,
    completedIds: attemptedIds.filter((accountId) => completed.has(accountId)),
    failedIds: attemptedIds.filter((accountId) => failed.has(accountId)),
    pendingIds: attemptedIds.filter((accountId) => !completed.has(accountId)),
  };
}

/** Returns a selection with server-confirmed account IDs removed. */
export function removeAccountIdsFromSelection(
  selectedIds: readonly number[],
  removedIds: readonly number[],
): number[] {
  const removed = new Set(removedIds);
  return selectedIds.filter((accountId) => !removed.has(accountId));
}
