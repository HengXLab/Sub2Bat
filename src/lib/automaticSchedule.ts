export interface AutomaticScheduleRun {
  scheduleId: string;
  cycle: number;
}

/** Builds the first cycle for one backend-issued automatic schedule generation. */
export function beginAutomaticScheduleRun(scheduleId: unknown): AutomaticScheduleRun | null {
  if (typeof scheduleId !== "string") return null;
  const normalizedScheduleId = scheduleId.trim();
  if (!normalizedScheduleId) return null;
  return { scheduleId: normalizedScheduleId, cycle: 1 };
}

/** Advances only within the current schedule generation. */
export function nextAutomaticScheduleRun(run: AutomaticScheduleRun): AutomaticScheduleRun | null {
  if (
    !run.scheduleId.trim()
    || !Number.isSafeInteger(run.cycle)
    || run.cycle < 1
    || run.cycle >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  return { scheduleId: run.scheduleId, cycle: run.cycle + 1 };
}
