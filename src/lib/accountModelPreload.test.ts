import { describe, expect, it } from "vitest";
import type { Account } from "../types";
import { reloadAccountsWithModelPreload } from "./accountModelPreload";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("account model preload", () => {
  it("invalidates around account loading and preloads the new account IDs without waiting", async () => {
    const accounts = deferred<Account[]>();
    const preload = deferred<unknown>();
    const calls: string[] = [];
    let preloadedIds: number[] = [];
    let preloadSettled = false;
    preload.promise.then(() => {
      preloadSettled = true;
    });

    const refresh = reloadAccountsWithModelPreload({
      invalidateModels: () => calls.push("invalidate"),
      loadAccounts: () => {
        calls.push("load");
        return accounts.promise;
      },
      getSelectedIds: () => [1, 2],
      preloadModels: (accountIds) => {
        calls.push("preload");
        preloadedIds = accountIds;
        return preload.promise;
      },
    });

    expect(calls).toEqual(["invalidate", "load"]);

    accounts.resolve([
      { id: 2, name: "Current", platform: "openai", accountType: "oauth", status: "active" },
      { id: 3, name: "New", platform: "openai", accountType: "apikey", status: "active" },
    ]);

    await expect(refresh).resolves.toEqual([2]);
    expect(calls).toEqual(["invalidate", "load", "invalidate", "preload"]);
    expect(preloadedIds).toEqual([2]);
    expect(preloadSettled).toBe(false);

    preload.resolve(undefined);
  });
});
