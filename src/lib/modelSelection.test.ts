import { describe, expect, it } from "vitest";
import type { ModelOption } from "../types";
import { resolveAvailableModelId } from "./modelSelection";

const options: ModelOption[] = [
  { id: "model-a", displayName: "Model A", availableOn: 2, requestedAccounts: 2, unknownAccounts: 0 },
  { id: "model-b", displayName: "Model B", availableOn: 1, requestedAccounts: 2, unknownAccounts: 0 },
];

describe("model selection", () => {
  it("keeps only a selection that is still returned by the server", () => {
    expect(resolveAvailableModelId(options, " model-b ")).toBe("model-b");
    expect(resolveAvailableModelId(options, "removed-model")).toBe("");
  });

  it("keeps a new dashboard model picker unselected", () => {
    expect(resolveAvailableModelId(options, "")).toBe("");
    expect(resolveAvailableModelId(options, null)).toBe("");
  });
});
