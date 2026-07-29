export interface Account {
  id: number;
  name: string;
  /** Official admin-account notes field. */
  notes?: string | null;
  /** Sub2API scheduler priority. A smaller number is selected first. */
  priority?: number | null;
  /** Official per-account billing rate multiplier. */
  rateMultiplier?: number | null;
  /** Maximum simultaneous requests allowed for this specific account. */
  concurrency?: number | null;
  /** Current runtime concurrency returned by the admin account list. */
  currentConcurrency?: number | null;
  /** Official account load factor when configured. */
  loadFactor?: number | null;
  platform: string;
  accountType: string;
  /** Subscription type normalized from Sub2API credentials, such as free or k12. */
  planType?: string | null;
  status: string;
  /** Sub2API's privacy classification, when the server supplies one. */
  privacyStatus?: string | null;
  /** Official Sub2API privacy mode, from privacy_mode or extra.privacy_mode. */
  privacyMode?: string | null;
  /** Official account proxy ID and safely derived display-only proxy fields. */
  proxyId?: number | null;
  proxyName?: string | null;
  proxyExpiresAt?: string | null;
  proxyFallbackOriginName?: string | null;
  /** Official Sub2API scheduler eligibility flag. */
  schedulable?: boolean | null;
  rateLimitedAt?: string | null;
  rateLimitResetAt?: string | null;
  overloadUntil?: string | null;
  tempUnschedulableUntil?: string | null;
  tempUnschedulableReason?: string | null;
  /** Account expiry is returned by Sub2API as Unix seconds. */
  expiresAt?: number | null;
  autoPauseOnExpired?: boolean | null;
  /** Whether Sub2API can currently schedule this account. */
  schedulingEnabled?: AccountSchedulingValue | null;
  /** Compatibility fallback for servers that expose the scheduling flag directly. */
  scheduling?: AccountSchedulingValue | null;
  /** sub2api's current account-group display field. */
  groupName?: string | null;
  /** Official numeric group IDs, retained so same-named platform groups stay distinct. */
  groupIds?: number[];
  /** Individual groups used for filtering accounts with more than one group. */
  groupNames?: string[];
  /** Keeps local filtering compatible with older account payloads. */
  group?: string | null;
  /** Normalized from Sub2API's session-window fields when available. */
  usageWindow?: AccountUsageWindow | null;
  /** Runtime capacity metrics supplied by the account-list response when applicable. */
  currentWindowCost?: number | null;
  activeSessions?: number | null;
  currentRpm?: number | null;
  lastUsedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
}

export type AccountSchedulingValue = boolean | string | number;

export interface AccountUsageWindow {
  start?: string | null;
  end?: string | null;
  status?: string | null;
}

export interface AccountGroup {
  id: number;
  name: string;
  description?: string | null;
  platform?: string | null;
  status?: string | null;
  accountCount?: number | null;
}

/**
 * Mirrors the bounded, official Sub2API account-list query accepted by the
 * desktop command. `planType` is intentionally absent because the upstream
 * endpoint does not expose a global plan-type filter.
 */
export interface AccountPageRequest {
  page: number;
  pageSize: number;
  platform?: string;
  accountType?: string;
  status?: string;
  groupId?: number;
  ungrouped?: boolean;
  search?: string;
  privacyMode?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** A single normalized response from Sub2API's paginated account endpoint. */
export interface AccountPage {
  items: Account[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  truncated: boolean;
  hasMore: boolean;
}

export interface AccountOperationItem {
  accountId: number;
  success: boolean;
  error?: string | null;
}

export interface AccountOperationResult {
  total: number;
  success: number;
  failed: number;
  successIds: number[];
  failedIds: number[];
  results: AccountOperationItem[];
}

export interface CreateGroupAndMoveAccountsResult {
  group: AccountGroup;
  operation: AccountOperationResult;
  emptyGroupDeleted: boolean;
  cleanupNotice?: string | null;
}

export type AccountFilterValue = string;
export type AccountStatusFilter = AccountFilterValue;

export interface AccountFilters {
  status: AccountStatusFilter;
  search: string;
  platform?: AccountFilterValue;
  accountType?: AccountFilterValue;
  planType?: AccountFilterValue;
  group?: AccountFilterValue;
  privacy?: AccountFilterValue;
}

export interface ProfilePreferences {
  serverUrl: string;
  email: string;
  rememberLogin: boolean;
  lastModelId: string;
  concurrency: number;
  /** Automatic account-list refresh interval in seconds. Zero disables it. */
  autoRefreshSeconds: number;
}

export interface SessionView {
  serverUrl: string;
  email: string;
  role: string;
}

export type LoginResult =
  | { kind: "authenticated"; session: SessionView; preferences: ProfilePreferences }
  | { kind: "totpRequired"; userEmailMasked: string };

export interface RestoreResult {
  session: SessionView | null;
  preferences: ProfilePreferences | null;
  message: string | null;
}

export interface ModelOption {
  id: string;
  displayName: string;
  availableOn: number;
  requestedAccounts: number;
  unknownAccounts: number;
}

export interface ModelCatalog {
  options: ModelOption[];
  unknownAccounts: number;
}

export interface BatchStartResult {
  runId: string;
}

/** Backend fallback used when the terminal batch event was not delivered. */
export type BatchCompletionStatus =
  | { kind: "running" }
  | { kind: "complete"; succeeded: number; failed: number; cancelled: number }
  | { kind: "missing" };

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  quotaExhausted: number;
  connectionInterrupted: number;
  cancelled: number;
}
