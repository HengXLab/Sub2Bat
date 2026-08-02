export type TestStatus = "queued" | "testing" | "succeeded" | "failed" | "quotaExhausted" | "connectionInterrupted" | "cancelled";

export interface TestRowState {
  status: TestStatus;
  httpStatus?: number | null;
  latencyMs?: number;
  message?: string;
  /** Client-side timestamp for the most recent completed test result. */
  testedAt?: string;
}

export type BatchEvent =
  | { kind: "started"; runId: string; total: number; modelId: string }
  | { kind: "testing"; runId: string; accountId: number }
  | {
      kind: "finished";
      runId: string;
      accountId: number;
      status: "succeeded" | "failed";
      httpStatus?: number | null;
      latencyMs: number;
      message: string;
    }
  | { kind: "cancelled"; runId: string; accountId: number }
  | { kind: "complete"; runId: string; succeeded: number; failed: number; cancelled: number };

export function createTestStates(accountIds: number[]): Record<number, TestRowState> {
  return Object.fromEntries(
    accountIds.map((accountId) => [
      accountId,
      { status: "queued" as const },
    ]),
  );
}

export function applyBatchEvent(
  states: Record<number, TestRowState>,
  event: BatchEvent,
): Record<number, TestRowState> {
  if (!("accountId" in event)) {
    return states;
  }

  if (!(event.accountId in states)) {
    return states;
  }

  const next = { ...states };
  const previous = states[event.accountId];
  if (event.kind === "testing") {
    next[event.accountId] = { ...previous, status: "testing" };
  } else if (event.kind === "cancelled") {
    next[event.accountId] = { ...previous, status: "cancelled" };
  } else if (event.kind === "finished") {
    const httpStatus = validHttpStatus(event.httpStatus) ?? httpStatusFromMessage(event.message);
    next[event.accountId] = {
      ...previous,
      status: finishedTestStatus(event),
      ...(httpStatus === undefined ? {} : { httpStatus }),
      latencyMs: event.latencyMs,
      message: event.message,
      testedAt: new Date().toISOString(),
    };
  }

  return next;
}

function finishedTestStatus(event: Extract<BatchEvent, { kind: "finished" }>): TestStatus {
  if (isQuotaExhausted(event)) return "quotaExhausted";
  if (isUnauthorized(event)) return "failed";
  if (event.status === "failed") return "connectionInterrupted";
  return "succeeded";
}

function isQuotaExhausted(event: Extract<BatchEvent, { kind: "finished" }>) {
  return event.status === "failed" && (
    event.message.toLowerCase().includes("usage_limit_reached") ||
    event.httpStatus === 429 ||
    httpStatusFromMessage(event.message) === 429
  );
}

function isUnauthorized(event: Extract<BatchEvent, { kind: "finished" }>) {
  return event.status === "failed" && (
    event.httpStatus === 401 ||
    httpStatusFromMessage(event.message) === 401
  );
}

function httpStatusFromMessage(message: string): number | undefined {
  const patterns = [
    /\bHTTP(?:\/\d(?:\.\d)?)?(?:[\s_-]+status(?:[\s_-]+code)?)?\s*[:=]?\s*(\d{3})\b/i,
    /\b(?:http[\s_-]*)?status(?:[\s_-]*code)?\s*["']?\s*[:=]?\s*["']?(\d{3})\b/i,
    /\b(?:http|error)?[\s_-]*code\s*["']?\s*[:=]?\s*["']?(\d{3})\b/i,
    /\breturned\s+(\d{3})\b/i,
    /\bresponded\s+with\s+(\d{3})\b/i,
    /\((\d{3})\)/,
  ];

  for (const pattern of patterns) {
    const status = Number(message.match(pattern)?.[1]);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }

  return undefined;
}

function validHttpStatus(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}
