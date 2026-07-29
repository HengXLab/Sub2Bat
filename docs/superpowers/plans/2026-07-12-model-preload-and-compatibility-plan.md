# Model Preload And Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically discover account model availability after login and refresh, while preserving compatibility with additive Sub2API API updates.

**Architecture:** Keep account-table hydration independent from model discovery. A small frontend request-generation helper prevents stale asynchronous model catalog responses from publishing UI state; the dashboard starts a background request from an immutable account-ID snapshot. The Rust client keeps stable `/api/v1` route use while making pagination, model labels, SSE records, and per-model request timeouts tolerant of additive response changes.

**Tech Stack:** Vue 3, TypeScript, Vitest, Tauri 2, Rust, Tokio, Reqwest.

---

## File Structure

- `src/lib/modelCatalogRequest.ts`: owns request-generation and normalized account-scope keys.
- `src/lib/modelCatalogRequest.test.ts`: proves stale requests cannot publish and scopes are normalized.
- `src/composables/useBatch.ts`: owns model catalog publication and invalidation.
- `src/App.vue`: starts non-blocking preload after successful account hydration and resets catalog state at session boundaries.
- `src/components/AccountToolbar.vue`: exposes an unambiguous loading label while metadata is loading.
- `src-tauri/src/api.rs`: owns account pagination fallback and model-specific request timeout.
- `src-tauri/src/models.rs`: owns optional model display-name fallback.
- `src-tauri/src/sse.rs`: owns tolerant parsing of nonterminal SSE records.
- `src-tauri/tests/api_accounts.rs`, `src-tauri/tests/model_catalog.rs`, `src-tauri/tests/sse.rs`: regression coverage for the Rust compatibility boundaries.

## Task 1: Request Generation Helper

**Files:**
- Create: `src/lib/modelCatalogRequest.ts`
- Create: `src/lib/modelCatalogRequest.test.ts`

- [ ] **Step 1: Write failing frontend tests for scope normalization and stale-response invalidation.**

```ts
import { describe, expect, it } from "vitest";
import { createModelCatalogRequestGuard, modelScopeKey } from "./modelCatalogRequest";

describe("model catalog requests", () => {
  it("normalizes duplicate account IDs into one stable scope key", () => {
    expect(modelScopeKey([3, 1, 3, 2])).toBe("1,2,3");
  });

  it("accepts only the most recently started request", () => {
    const guard = createModelCatalogRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidates an active request after a session boundary", () => {
    const guard = createModelCatalogRequestGuard();
    const request = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the module is missing.**

Run: `npm test -- src/lib/modelCatalogRequest.test.ts`

Expected: Vitest fails with a module-resolution error for `./modelCatalogRequest`.

- [ ] **Step 3: Implement the focused helper.**

```ts
export function createModelCatalogRequestGuard() {
  let generation = 0;

  return {
    begin: () => ++generation,
    invalidate: () => ++generation,
    isCurrent: (request: number) => request === generation,
  };
}

export function modelScopeKey(accountIds: number[]) {
  return [...new Set(accountIds)].sort((left, right) => left - right).join(",");
}
```

- [ ] **Step 4: Run the focused frontend test and verify it passes.**

Run: `npm test -- src/lib/modelCatalogRequest.test.ts`

Expected: 3 passing tests.

- [ ] **Step 5: Commit the helper and its tests.**

```powershell
git add src/lib/modelCatalogRequest.ts src/lib/modelCatalogRequest.test.ts
git commit -m "test: cover model catalog request generations"
```

## Task 2: Non-Blocking Model Preload

**Files:**
- Modify: `src/composables/useBatch.ts`
- Modify: `src/App.vue`
- Modify: `src/components/AccountToolbar.vue`

- [ ] **Step 1: Add a failing unit test for a stale catalog request.**

Create `src/composables/useBatch.test.ts` with mocked Tauri invokes and two deferred catalog responses:

```ts
import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { useBatch } from "./useBatch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

it("keeps the newest model catalog when an older request resolves last", async () => {
  const first = deferred<{ options: []; unknownAccounts: number }>();
  const second = deferred<{ options: []; unknownAccounts: number }>();
  invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const batch = useBatch();
  const firstLoad = batch.loadModels([1]);
  const secondLoad = batch.loadModels([2]);

  second.resolve({ options: [], unknownAccounts: 0 });
  await secondLoad;
  first.resolve({ options: [], unknownAccounts: 1 });
  await expect(firstLoad).resolves.toBeNull();

  expect(batch.modelCatalog.value).toEqual({ options: [], unknownAccounts: 0 });
  expect(batch.loadingModels.value).toBe(false);
});
```

- [ ] **Step 2: Run the focused frontend test and verify the stale response currently overwrites the latest catalog.**

Run: `npm test -- src/lib/modelCatalogRequest.test.ts`

Expected: the new test fails because the current implementation does not guard model catalog publication.

- [ ] **Step 3: Add guarded catalog publication and explicit invalidation in `useBatch`.**

```ts
const modelRequests = createModelCatalogRequestGuard();

async function loadModels(accountIds: number[]) {
  const request = modelRequests.begin();
  loadingModels.value = true;
  try {
    const catalog = await invoke<ModelCatalog>("load_models", { accountIds });
    if (!modelRequests.isCurrent(request)) return null;
    modelCatalog.value = catalog;
    return catalog;
  } catch (error) {
    if (modelRequests.isCurrent(request)) batchError.value = readableError(error);
    throw error;
  } finally {
    if (modelRequests.isCurrent(request)) loadingModels.value = false;
  }
}

function invalidateModels() {
  modelRequests.invalidate();
  modelCatalog.value = { options: [], unknownAccounts: 0 };
  loadingModels.value = false;
}
```

- [ ] **Step 4: Change dashboard hydration and refresh to start background discovery from account snapshots.**

```ts
async function hydrateDashboard() {
  modelId.value = sessionState.preferences.value.lastModelId || "gpt-5.6-terra";
  concurrency.value = sessionState.preferences.value.concurrency || 3;
  await batch.loadAccounts();
  selectedIds.value = selectedIds.value.filter((id) => batch.accounts.value.some((account) => account.id === id));
  lastModelScope.value = "";
  batch.invalidateModels();
  void loadModelsForScope(batch.accounts.value.map((account) => account.id), true);
}
```

Create `loadModelsForScope(accountIds, force)` to use `modelScopeKey`, skip empty scopes, retain the existing manual selector scope behavior, and reset `modelId` only when a current catalog result omits the selected ID. Make `refreshAccounts()` call `hydrateDashboard()` and make logout clear `lastModelScope` and call `batch.invalidateModels()`.

- [ ] **Step 5: Make the model selector say `Loading models...` while discovery is active.**

```vue
<option v-if="loadingModels" :value="modelId">Loading models...</option>
<option v-for="model in modelOptions" :key="model.id" :value="model.id">
  {{ model.displayName }}{{ model.requestedAccounts ? ` (${model.availableOn}/${model.requestedAccounts})` : "" }}
</option>
```

Keep the spinner, disable selection while a model request is active, and retain manual opening as a scope-specific refresh after discovery completes.

- [ ] **Step 6: Run focused frontend tests and type checking.**

Run: `npm test -- src/lib/modelCatalogRequest.test.ts`

Expected: all request-generation and stale-publication tests pass.

Run: `npm run check`

Expected: Vue and TypeScript type checking exits with code 0.

- [ ] **Step 7: Commit the frontend preload behavior.**

```powershell
git add src/App.vue src/components/AccountToolbar.vue src/composables/useBatch.ts src/lib/modelCatalogRequest.ts src/lib/modelCatalogRequest.test.ts
git commit -m "feat: preload account model availability"
```

## Task 3: Account Pagination Compatibility

**Files:**
- Modify: `src-tauri/src/api.rs`
- Modify: `src-tauri/tests/api_accounts.rs`

- [ ] **Step 1: Write failing tests for omitted `pages` metadata.**

```rust
#[test]
fn continues_when_pages_is_omitted_but_total_requires_another_page() {
    assert!(should_load_next_account_page(1, 100, 0, 112, 100, 100));
}

#[test]
fn stops_when_a_short_page_finishes_an_omitted_pages_response() {
    assert!(!should_load_next_account_page(2, 100, 0, 112, 100, 12));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails because the helper is missing.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test api_accounts`

Expected: compilation fails because `should_load_next_account_page` is not exported.

- [ ] **Step 3: Implement pagination continuation with an empty/new-ID guard.**

```rust
pub fn should_load_next_account_page(
    page: usize,
    page_size: usize,
    pages: usize,
    total: usize,
    received: usize,
    item_count: usize,
) -> bool {
    if pages > 0 {
        return page < pages;
    }
    if item_count == 0 || item_count < page_size {
        return false;
    }
    total == 0 || received < total
}
```

Use a `HashSet<i64>` in `list_all_accounts` to add only newly seen account IDs. Stop if a page has no new IDs, even if malformed metadata says more pages exist.

- [ ] **Step 4: Run the focused Rust test and verify it passes.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test api_accounts`

Expected: all `api_accounts` tests pass.

- [ ] **Step 5: Commit pagination compatibility.**

```powershell
git add src-tauri/src/api.rs src-tauri/tests/api_accounts.rs
git commit -m "fix: tolerate missing account pagination metadata"
```

## Task 4: Model Metadata Compatibility And Timeout

**Files:**
- Modify: `src-tauri/src/api.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/tests/model_catalog.rs`

- [ ] **Step 1: Write failing tests for missing display names and a specific model request timeout.**

```rust
#[test]
fn uses_a_model_id_when_a_model_response_omits_display_name() {
    let catalog = ModelCatalog::from_account_models(
        1,
        vec![Ok(vec![RemoteModel { id: "gpt-5".to_owned(), display_name: String::new() }])],
    );
    assert_eq!(catalog.options[1].display_name, "gpt-5");
}
```

Also make the timeout decision directly testable without adding a network test dependency or a 15-second sleeping test:

```rust
use std::time::Duration;
use sub2bat_lib::api::model_metadata_timeout;

#[test]
fn uses_a_short_timeout_only_for_model_metadata_requests() {
    assert_eq!(model_metadata_timeout(), Duration::from_secs(15));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test model_catalog`

Expected: the fallback display-name assertion fails with an empty string.

- [ ] **Step 3: Make model labels optional and use a short timeout only for model metadata calls.**

```rust
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteModel {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
}

fn effective_model_name(model: &RemoteModel) -> String {
    if model.display_name.trim().is_empty() { model.id.clone() } else { model.display_name.clone() }
}
```

Expose `pub fn model_metadata_timeout() -> Duration { Duration::from_secs(15) }` and call `.timeout(model_metadata_timeout())` on the `RequestBuilder` inside `available_models`, retaining the shared 90-second client timeout for login, account testing, and SSE streams. Keep per-account errors as `Err` inputs to `ModelCatalog::from_account_models`, so only `unknown_accounts` increases.

- [ ] **Step 4: Run the focused Rust test and verify it passes.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test model_catalog`

Expected: all model catalog tests pass.

- [ ] **Step 5: Commit model compatibility hardening.**

```powershell
git add src-tauri/src/api.rs src-tauri/src/models.rs src-tauri/tests/model_catalog.rs
git commit -m "fix: harden model metadata compatibility"
```

## Task 5: Tolerant SSE Records

**Files:**
- Modify: `src-tauri/src/sse.rs`
- Modify: `src-tauri/tests/sse.rs`

- [ ] **Step 1: Write failing tests for `[DONE]` and malformed nonterminal `data:` records.**

```rust
#[test]
fn ignores_done_and_malformed_nonterminal_data_records() {
    assert_eq!(parse_data_event("data: [DONE]").unwrap(), Some(TestStreamEvent::Ignored));
    assert_eq!(parse_data_event("data: not-json").unwrap(), Some(TestStreamEvent::Ignored));
    assert_eq!(parse_data_event(r#"data: {\"message\":\"progress\"}"#).unwrap(), Some(TestStreamEvent::Ignored));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails on invalid JSON or missing `type`.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test sse`

Expected: the new test fails with `Invalid test stream event`.

- [ ] **Step 3: Ignore malformed or untyped nonterminal records without accepting an incomplete test as success.**

```rust
if payload == "[DONE]" {
    return Ok(Some(TestStreamEvent::Ignored));
}

let Ok(event) = serde_json::from_str::<RawTestEvent>(payload) else {
    return Ok(Some(TestStreamEvent::Ignored));
};
```

Make `RawTestEvent.event_type` optional, return `Ignored` for no type, and leave `test_account` unchanged so EOF before `test_complete` still returns an error.

- [ ] **Step 4: Run the focused Rust test and verify it passes.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test sse`

Expected: all SSE tests pass.

- [ ] **Step 5: Commit SSE tolerance.**

```powershell
git add src-tauri/src/sse.rs src-tauri/tests/sse.rs
git commit -m "fix: tolerate additive test stream records"
```

## Task 6: Functional And Rendered Verification

**Files:**
- Modify only when a test or rendered validation identifies an issue.

- [ ] **Step 1: Run complete frontend and Rust test suites.**

Run: `npm test`

Expected: all Vitest tests pass.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust unit and integration tests pass.

- [ ] **Step 2: Run production frontend build.**

Run: `npm run build`

Expected: `vue-tsc` and Vite both exit with code 0.

- [ ] **Step 3: Validate the rendered dashboard flow.**

Run the Tauri development build or the installed executable, log in with the user-authorized environment, and verify this sequence: login or refresh -> account rows appear promptly -> model selector reads `Loading models...` -> it changes to actual availability counts without clicking the selector. Verify desktop and mobile-size layouts, console health, and no error overlay.

- [ ] **Step 4: Validate real metadata discovery without consuming provider model quota.**

Use the authorized administrator session to fetch account metadata and model catalogs only. Record non-sensitive counts of requested accounts, returned model options, and unknown accounts; do not print credentials, access tokens, or provider connection-test payloads.

## Task 7: Code Quality Audit And Behavior-Preserving Refactor

**Files:**
- Inspect: all tracked files under `src/`, `src-tauri/src/`, `src-tauri/tests/`, and top-level configuration.
- Modify only files with a concrete maintainability issue proven by the audit.

- [ ] **Step 1: Perform a read-only source audit.**

Inspect ownership boundaries, duplicate logic, error handling, public types, test names, dead code, unsafe unwraps, formatting, and dependency usage. Record each proposed cleanup with its behavioral invariant.

- [ ] **Step 2: Add a regression test before every cleanup that can affect observable behavior.**

Run the smallest relevant test before and after each cleanup. Do not add product features, broaden behavior, or change UI wording in this phase.

- [ ] **Step 3: Apply only justified behavior-preserving cleanup.**

Examples allowed: extract repeated scope key logic into the new helper, replace local duplicated empty-catalog literals with a named constructor, improve function names, remove dead branches, or narrow visibility. Examples prohibited: new network retries, new preferences, different test scheduling, new UI controls, or altered API contracts.

- [ ] **Step 4: Re-run the complete test suites and production build.**

Run: `npm test`

Expected: all Vitest tests pass.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass.

Run: `npm run build`

Expected: production frontend build succeeds.

- [ ] **Step 5: Commit the audit and justified cleanup.**

```powershell
git add src src-tauri/src src-tauri/tests
git commit -m "refactor: improve batch tester maintainability"
```

## Task 8: Package And Release Verification

**Files:**
- Update: `README.md` when the visible loading behavior or compatibility guarantee needs wording clarification.
- Refresh: `release/staging/Sub2Bat-1.0.0`
- Refresh: `release/Sub2Bat-1.0.0.zip`

- [ ] **Step 1: Commit the final source and documentation before exporting an archive.**

Run: `git status --short`

Expected: only the known EOL-only `src-tauri/Cargo.toml` worktree artifact and intentionally untracked generated release artifacts remain.

```powershell
git add README.md docs/superpowers/specs docs/superpowers/plans src src-tauri/src src-tauri/tests
git commit -m "docs: document automatic model discovery"
```

- [ ] **Step 2: Build the NSIS installer from verified source.**

Run: `npm run build:installer`

Expected: Tauri creates an NSIS installer under `src-tauri/target/release/bundle/nsis/`.

- [ ] **Step 3: Re-export source from committed `HEAD`.**

Run: `git archive --format=zip --output release/staging/Sub2Bat-1.0.0/source/Sub2Bat-1.0.0-source.zip HEAD`

Expected: the source archive contains committed source and documentation without `.git`, `node_modules`, or `target`.

- [ ] **Step 4: Assemble and verify the release ZIP.**

Copy the fresh installer, README, and source archive into the staging directory, create `release/Sub2Bat-1.0.0.zip`, then compare the installer SHA-256 inside the ZIP with the freshly built installer. Inspect the ZIP member list to confirm it contains no `node_modules`, `target`, or `.git` entries.

- [ ] **Step 5: Inspect the final repository state.**

Run: `git status --short`

Expected: generated installers, ZIP files, `node_modules`, Rust `target`, and the known semantically empty `src-tauri/Cargo.toml` EOL-only worktree artifact remain unstaged. No intended source, test, or documentation change is left uncommitted.
