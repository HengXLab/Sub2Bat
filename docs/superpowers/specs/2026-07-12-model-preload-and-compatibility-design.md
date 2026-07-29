# Model Preload And Compatibility Design

## Goal

Show a real model availability count without requiring the user to open the
model selector. Keep the desktop client compatible with additive sub2api API
updates without tying it to a specific server release.

## User Flow

1. After login or account refresh, render the account table immediately.
2. Start one background model-catalog request for the current account-ID
   snapshot. This reads model metadata only; it does not run account tests.
3. While it runs, show a loading state instead of treating `0/N` as a final
   model availability result.
4. When it completes, show the actual `availableOn/requestedAccounts` count.
5. Opening the model selector after searching, filtering, or selecting accounts
   refreshes only that current scope. It does not repeatedly query every
   account while the user types or changes a filter.
6. Logging out, changing the server, or refreshing accounts invalidates the
   old catalog. A late response from an old request cannot overwrite newer UI
   state.

## Request Lifecycle

- `loadModels` uses an account-ID snapshot and a monotonically increasing
  request generation. Only the latest generation can publish a catalog or
  clear the loading indicator.
- Dashboard hydration and account refresh trigger the background request but
  do not await it, so account rows remain usable while model discovery runs.
- The Rust layer keeps its bounded model-request concurrency and gives each
  account model request a short model-specific timeout. Individual failures
  contribute to `unknownAccounts`; they do not block connection testing.

## Compatibility Boundary

The client continues to call stable `/api/v1` administrator endpoints rather
than checking for one exact sub2api version:

- `GET /admin/accounts`
- `GET /admin/accounts/:id/models`
- `POST /admin/accounts/:id/test`

The compatibility adapter accepts raw and `{ code, message, data }` JSON
responses, ignores additive JSON fields, accepts a missing account-page count
when a short-page or total-count fallback is available, and uses a model ID as
the display name when an additive-compatible server omits a display label.
Unknown SSE event types remain ignored. Removing these routes or required
semantic fields is a breaking server change and is intentionally surfaced as
an actionable request error rather than guessed around.

## Verification

- Frontend tests cover automatic preload triggers, stale model responses, and
  refresh invalidation.
- Rust tests cover response envelopes, pagination fallback, model display-name
  fallback, model-request timeout handling, and tolerant SSE parsing.
- Final validation includes full test suites, production build, NSIS build,
  packaged executable startup, and a real authenticated model-catalog request
  using the user-authorized test environment.

## Code Quality Pass

After functional verification, inspect the complete frontend and Rust source.
Only make behavior-preserving improvements that reduce duplication, clarify
ownership, or strengthen type/test boundaries. Re-run the full verification
set after that pass.
