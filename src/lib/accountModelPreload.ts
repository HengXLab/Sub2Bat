import type { Account } from "../types";

export const MAX_ACCOUNT_MODEL_PRELOAD_IDS = 1_000_000;

interface AccountModelPreloadCallbacks {
  loadAccounts: () => Promise<Account[] | null>;
  invalidateModels: () => void;
  getSelectedIds: () => number[];
  preloadModels: (accountIds: number[]) => Promise<unknown>;
}

export async function reloadAccountsWithModelPreload({
  loadAccounts,
  invalidateModels,
  getSelectedIds,
  preloadModels,
}: AccountModelPreloadCallbacks): Promise<number[] | null> {
  invalidateModels();
  const accounts = await loadAccounts();
  if (accounts === null) {
    return null;
  }
  invalidateModels();

  const availableIds = new Set(accounts.map((account) => account.id));
  const selectedIds = getSelectedIds().filter((id) => availableIds.has(id));

  // This compatibility path follows the same 1,000,000-account ceiling as
  // the backend. The backend itself keeps network fan-out bounded.
  if (selectedIds.length && selectedIds.length <= MAX_ACCOUNT_MODEL_PRELOAD_IDS) {
    void preloadModels(selectedIds).catch(() => {});
  }
  return selectedIds;
}
