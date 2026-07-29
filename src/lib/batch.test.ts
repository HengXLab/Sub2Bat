import { describe, expect, it } from "vitest";
import { applyBatchEvent, createTestStates } from "./batch";

describe("batch test state", () => {
  it("updates a row from testing to a terminal failure with its message", () => {
    const states = createTestStates([10, 11]);
    const testing = applyBatchEvent(states, {
      kind: "testing",
      runId: "run-1",
      accountId: 10,
    });
    const finished = applyBatchEvent(testing, {
      kind: "finished",
      runId: "run-1",
      accountId: 10,
      status: "failed",
      latencyMs: 240,
      message: "model is unavailable",
    });

    expect(finished[10]).toMatchObject({
      status: "failed",
      latencyMs: 240,
      message: "model is unavailable",
    });
    expect(finished[10].testedAt).toEqual(expect.any(String));
    expect(finished[11]).toEqual({ status: "queued" });
  });

  it("marks a row as cancelled without changing completed rows", () => {
    const states = {
      10: { status: "succeeded" as const, latencyMs: 88, message: "ok" },
      11: { status: "testing" as const },
    };

    const cancelled = applyBatchEvent(states, {
      kind: "cancelled",
      runId: "run-1",
      accountId: 11,
    });

    expect(cancelled[10].status).toBe("succeeded");
    expect(cancelled[11]).toEqual({ status: "cancelled" });
  });

  it("marks an upstream usage-limit response as quota exhausted", () => {
    const states = createTestStates([10]);

    const finished = applyBatchEvent(states, {
      kind: "finished",
      runId: "run-1",
      accountId: 10,
      status: "failed",
      latencyMs: 240,
      message: "HTTP 429: usage_limit_reached: The usage limit has been reached",
    });

    expect(finished[10]).toMatchObject({
      status: "quotaExhausted",
      httpStatus: 429,
      latencyMs: 240,
      message: "HTTP 429: usage_limit_reached: The usage limit has been reached",
    });
    expect(finished[10].testedAt).toEqual(expect.any(String));
  });
});
