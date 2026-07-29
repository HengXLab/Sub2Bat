import { describe, expect, it } from "vitest";
import { DEFAULT_CONCURRENCY } from "./defaults";

describe("dashboard defaults", () => {
  it("uses the shared concurrency default without assuming a test model", () => {
    expect(DEFAULT_CONCURRENCY).toBe(10);
  });
});
