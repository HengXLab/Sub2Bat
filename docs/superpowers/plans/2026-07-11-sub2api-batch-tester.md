# Sub2Bat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows Tauri application that restores a sub2api admin session and batch-tests account connections through the existing per-account SSE endpoint.

**Architecture:** Vue renders a lightweight account-operation UI. Tauri commands call focused Rust modules for HTTPS, token persistence, account/model data, and an in-memory cancellable worker queue. The Windows Credential Manager holds refresh tokens while the app store holds non-secret preferences.

**Tech Stack:** Tauri 2, Vue 3, TypeScript, Vite, Vitest, Rust, reqwest, tokio, serde, keyring.

---

### Task 1: Bootstrap and branding

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- Create: `src/assets/app-icon.png`, `src-tauri/icons/*`
- Create: `.gitignore`, `README.md`

- [ ] Create the Vue/Tauri workspace with only runtime dependencies needed for the described product.
- [ ] Copy the supplied PNG into the renderer and generate Tauri icon derivatives.
- [ ] Configure an x64 NSIS release bundle named `Sub2Bat`.
- [ ] Run `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml` to establish a working baseline.
- [ ] Commit with `chore: bootstrap Tauri batch tester`.

### Task 2: Test-first pure Rust domain utilities

**Files:**
- Create: `src-tauri/src/url.rs`, `src-tauri/src/response.rs`, `src-tauri/src/models.rs`, `src-tauri/src/batch.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] Write failing tests for URL normalization, envelope unwrapping, model deduplication, SSE line parsing, and batch summary transitions.
- [ ] Run `cargo test` and confirm the tests fail because the modules do not exist.
- [ ] Implement the smallest typed utilities required to make the tests pass.
- [ ] Run `cargo fmt` and `cargo test`.
- [ ] Commit with `feat: add tested sub2api domain utilities`.

### Task 3: Session and API command layer

**Files:**
- Create: `src-tauri/src/session.rs`, `src-tauri/src/client.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

- [ ] Write failing unit tests around session state decisions and model aggregation using injected HTTP responses.
- [ ] Implement token login, TOTP completion, rotated refresh persistence, logout, paginated account loading, model aggregation, and SSE request construction.
- [ ] Expose renderer-safe commands: `restore_session`, `login`, `complete_totp`, `logout`, `list_accounts`, `load_models`, `start_batch_test`, and `cancel_batch_test`.
- [ ] Run Rust formatting and the complete Rust test suite.
- [ ] Commit with `feat: add sub2api session and batch commands`.

### Task 4: Test-first renderer state and desktop UI

**Files:**
- Create: `src/composables/*`, `src/components/*`, `src/types.ts`, `src/main.ts`, `src/App.vue`, `src/style.css`
- Create: `src/**/*.test.ts`

- [ ] Write failing Vitest tests for account selection/filtering and reducer-style batch event mapping.
- [ ] Implement the smallest composables to pass those tests.
- [ ] Build the login, TOTP, table, model picker, selection, toolbar, progress, cancellation, logout, and error states using the approved teal design system.
- [ ] Run frontend unit tests, type checking, and production build.
- [ ] Commit with `feat: add batch testing desktop interface`.

### Task 5: Integration, release documentation, and package

**Files:**
- Modify: `README.md`, release scripts, bundle configuration
- Create: `release/README.txt`, `release/Sub2Bat-*.zip`

- [ ] Verify the app in a local dev window and browser preview with desktop and narrow viewports.
- [ ] Run `npm run test`, `npm run build`, `cargo test`, and `npm run tauri build`.
- [ ] Inspect the installer and application assets, then prepare an explicit requirements audit.
- [ ] Create a ZIP with the installer, source directory, README, and license notices while excluding `node_modules`, `target`, and transient caches.
- [ ] Commit release documentation and packaging manifest with `docs: add delivery instructions`.
