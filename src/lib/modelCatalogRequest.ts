export function createModelCatalogRequestGuard() {
  let generation = 0;

  return {
    begin: () => ++generation,
    invalidate: () => ++generation,
    isCurrent: (request: number) => request === generation,
  };
}

export interface ModelScope {
  key: string;
  accountIds: number[];
}

export function normalizeModelScope(accountIds: number[]): ModelScope {
  const normalizedAccountIds = [...new Set(accountIds)].sort((left, right) => left - right);
  return { key: normalizedAccountIds.join(","), accountIds: normalizedAccountIds };
}

export function modelScopeKey(accountIds: number[]) {
  return normalizeModelScope(accountIds).key;
}

export function shouldLoadModelScope(lastScope: string, scope: string, hasOptions: boolean, force: boolean) {
  return force || lastScope !== scope || !hasOptions;
}
