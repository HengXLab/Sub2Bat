# Sub2Bat Design

## Goal

Build a shareable Windows desktop application that lets an administrator connect to any compatible sub2api server, load accounts, and run connection tests across a selected account set from one place.

## Product Scope

- A first-run login screen accepts a server URL, administrator email, and password.
- The app supports the standard sub2api token flow, including a six-digit TOTP follow-up when a server requests it.
- "Remember login" persists the normalized server URL and email in app settings and persists the refresh token in Windows Credential Manager. Passwords and access tokens are never written to the settings file.
- On a later launch, the app rotates the refresh token and restores the session without showing the login screen. If the token was revoked or expires, it returns to login with a clear message.
- The dashboard loads every account from `GET /api/v1/admin/accounts`, subject to visible filters.
- The default test model is the literal `gpt-5.6-terra` (displayed as `GPT-5.6 Terra`). Opening the model chooser fetches model lists from the selected accounts, unions the returned model IDs, and keeps the default as a selectable entry.
- A batch creates a local in-memory queue. Each worker posts to `/api/v1/admin/accounts/:id/test` and parses its SSE response. The default worker count is three and the UI permits one, three, or five workers.
- A batch can be cancelled. Rows retain the latest queued, testing, succeeded, failed, cancelled, latency, and message state for the current application session.
- The first release has no server-side changes, recurring scheduled tests, local database, automatic updater, custom encryption layer, analytics, or multi-server profile manager. A later profile list can reuse the existing settings and credential key abstraction.

## API Contract

The client uses the server URL with a trailing `/api/v1` path removed before composing requests.

| Operation | Endpoint | Notes |
| --- | --- | --- |
| Login | `POST /api/v1/auth/login` | JSON `{ email, password }`; unwrap the standard `{ code, message, data }` envelope. |
| Complete TOTP | `POST /api/v1/auth/login/2fa` | JSON `{ temp_token, totp_code }`. |
| Refresh | `POST /api/v1/auth/refresh` | JSON `{ refresh_token }`; refresh token rotates on success. |
| List accounts | `GET /api/v1/admin/accounts?page=&page_size=` | Bearer access token; fetch every page with `page_size=100`. |
| Account models | `GET /api/v1/admin/accounts/:id/models` | Bearer access token; used only after the user opens model selection. |
| Test account | `POST /api/v1/admin/accounts/:id/test` | Bearer access token, JSON `{ model_id }`, parses `text/event-stream`. |

## Architecture

The Vue renderer owns UI state and calls a small Tauri command boundary. Rust owns HTTP, session persistence, pagination, model aggregation, SSE parsing, cancellation, and bounded concurrency. This keeps credentials out of the WebView and avoids CORS constraints.

```text
Vue UI -> Tauri commands -> Rust API client -> sub2api HTTPS API
                    |              |
                    |              +-> SSE batch workers -> Tauri events -> Vue table rows
                    +-> store + Windows Credential Manager
```

### Rust Modules

- `models.rs`: request, response, account, model, test-event, and UI-event types.
- `url.rs`: normalize a user-entered server URL and construct `/api/v1` routes.
- `response.rs`: unwrap sub2api response envelopes without assuming every endpoint has one.
- `session.rs`: login, TOTP completion, refresh, logout, settings, and Credential Manager access.
- `client.rs`: authenticated account pagination, per-account model lookup, and SSE HTTP requests.
- `batch.rs`: job ownership, bounded worker queue, cancellation, test event parsing, and progress events.
- `commands.rs`: minimal Tauri command adapters for the renderer.

### Renderer Modules

- `App.vue`: selects login or dashboard surface.
- `components/LoginPanel.vue`: server, credentials, remember switch, and optional TOTP state.
- `components/AccountToolbar.vue`: search, status filter, model selector, concurrency selector, and batch actions.
- `components/AccountTable.vue`: selection and per-row test state.
- `components/BatchProgress.vue`: current job totals, cancellation, and result summary.
- `composables/useSession.ts` and `composables/useBatch.ts`: command/event glue with isolated state transitions.

## Design System

The supplied icon is the brand asset. Its dark teal field and mint rim set the palette: true white surfaces, charcoal text, dark teal primary controls, mint focus/highlight, and separate green/red/amber operational states. The layout is a quiet operational table, not a card grid or marketing landing page.

- Font: `Microsoft YaHei UI`, `Segoe UI`, sans-serif.
- Background: #F6F8F8; primary surface: true white; primary ink: #17302E.
- Brand teal: #147B75; mint: #2DD4BF; border: #DCE5E3.
- Compact controls, 8px corners, consistent 40px input/button height.
- Desktop uses a fixed header and a wide table. Narrow widths stack the toolbar and allow table scrolling without clipping cells.
- The first screen is an actual login workflow. The first authenticated screen is the actionable account table, with no decorative hero.

## Testing And Delivery

- Rust unit tests cover URL normalization, response-envelope handling, model union/deduplication, SSE event parsing, batch result aggregation, and cancellation checks.
- Vue/Vitest tests cover selection/filter helpers, batch progress mapping, and login form validation.
- The final verification runs formatter, frontend unit tests, Rust unit tests, TypeScript check/build, and `tauri build`.
- The release ZIP contains the built NSIS installer, the complete source tree without generated dependency/cache directories, and `README.md` with installation and usage instructions.
