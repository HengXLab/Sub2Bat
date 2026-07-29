import type { ModelOption } from "../types";

/** Keeps the current picker selection only when it is present in the live catalog. */
export function resolveAvailableModelId(options: readonly ModelOption[], candidate: string | null | undefined): string {
  const modelId = candidate?.trim() ?? "";
  return modelId && options.some((option) => option.id === modelId) ? modelId : "";
}
