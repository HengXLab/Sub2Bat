import { describe, expect, it } from "vitest";
import { beginAutomaticScheduleRun, nextAutomaticScheduleRun } from "./automaticSchedule";

describe("automatic schedule generations", () => {
  it("starts every explicit backend generation at cycle one", () => {
    expect(beginAutomaticScheduleRun("generation-a")).toEqual({ scheduleId: "generation-a", cycle: 1 });
    expect(beginAutomaticScheduleRun("generation-b")).toEqual({ scheduleId: "generation-b", cycle: 1 });
  });

  it("keeps a generation stable while advancing its cycle", () => {
    const first = beginAutomaticScheduleRun("generation-a");
    expect(first).not.toBeNull();
    expect(nextAutomaticScheduleRun(first!)).toEqual({ scheduleId: "generation-a", cycle: 2 });
  });

  it("rejects a missing generation or an invalid cycle", () => {
    expect(beginAutomaticScheduleRun("  ")).toBeNull();
    expect(nextAutomaticScheduleRun({ scheduleId: "generation-a", cycle: 0 })).toBeNull();
  });
});
