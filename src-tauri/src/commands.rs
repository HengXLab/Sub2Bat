use crate::{
    api::{
        Account, AccountGroup, AccountListQuery, AccountOperationResult, AccountPage, AuthTokens,
        ExportAccountIdentity, LoginPayload, RefreshError, Sub2ApiClient,
        DEFAULT_ACCOUNT_PAGE_SIZE, MAX_ACCOUNT_PAGE_NUMBER, MAX_ACCOUNT_PAGE_SIZE,
    },
    automation_claim::{
        acquire_scheduled_automation_execution_lease,
        begin_scheduled_automation_execution as begin_scheduled_automation_execution_marker,
        claim_scheduled_automation_execution as claim_scheduled_automation_execution_marker,
        ScheduledAutomationExecutionClaim,
    },
    batch_runner,
    models::{ModelCatalog, ModelCatalogAccumulator},
    response::envelope_error_code,
    server_url::ServerUrl,
    session::{
        delete_refresh_token, load_profile, load_refresh_token, normalize_auto_refresh_seconds,
        normalize_concurrency, profile_for_login, restore_intent, save_profile, save_refresh_token,
        ActiveSession, PendingTotp, SavedProfile, SessionView,
    },
    state::AppState,
};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::atomic::Ordering,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const STALE_AUTH_REQUEST_MESSAGE: &str = "登录请求已失效，请重新登录。";
const STALE_SESSION_REQUEST_MESSAGE: &str = "当前会话已切换，请重新执行操作。";
const EXPIRED_SESSION_MESSAGE: &str = "登录令牌已失效，请重新登录。";
const SESSION_REFRESHED_RETRY_MESSAGE: &str = "登录令牌已刷新，请重新执行刚才的操作。";
const TEMPORARY_REFRESH_MESSAGE: &str = "暂时无法刷新登录令牌，请稍后重试。";
const REFRESH_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(30);
/// Explicit batch actions remain bounded even when account browsing exposes a
/// much larger server-side page range. This avoids accepting unbounded Tauri
/// payloads or starting an accidental multi-hour operation.
const MAX_ACCOUNT_OPERATION_IDS: usize = 10_000;
/// An on-demand model catalog may cover a large filtered scope. The lookup is
/// streamed with bounded concurrency so the result memory stays proportional
/// to the model dictionary rather than the number of selected accounts.
const MAX_MODEL_ACCOUNT_IDS: usize = 1_000_000;
const MODEL_LOOKUP_CONCURRENCY: usize = 16;
const MAX_MODEL_LOAD_REQUEST_ID_LENGTH: usize = 128;
const MODEL_LOAD_CANCELLED_MESSAGE: &str = "测试模型读取已取消。";
const ACCOUNT_LOOKUP_CONCURRENCY: usize = 8;
const MAX_ACCOUNT_LIST_FILTER_LENGTH: usize = 100;

/// A bulk-update response confirms request acceptance, but a compatible
/// server can still return before every selected field is observable. Read
/// each selected account back before reporting priority/concurrency success.
#[derive(Clone, Copy)]
enum AccountFieldReadback {
    Priority(i64),
    Concurrency(i64),
}

impl AccountFieldReadback {
    fn label(self) -> &'static str {
        match self {
            Self::Priority(_) => "优先级",
            Self::Concurrency(_) => "账号并发",
        }
    }

    fn expected_value(self) -> i64 {
        match self {
            Self::Priority(value) | Self::Concurrency(value) => value,
        }
    }

    fn actual_value(self, account: &Account) -> Option<i64> {
        match self {
            Self::Priority(_) => account.priority,
            Self::Concurrency(_) => account.concurrency,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginInput {
    pub server_url: String,
    pub email: String,
    pub password: String,
    pub remember_login: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpInput {
    pub code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStartInput {
    pub account_ids: Vec<i64>,
    pub model_id: String,
    pub concurrency: u8,
}

/// Maps exactly to the official `GET /admin/accounts` query surface. Group
/// names are intentionally not accepted: Sub2API filters by group ID or its
/// `ungrouped` sentinel, so the caller must resolve a visible group name first.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAccountsPageInput {
    #[serde(default)]
    pub page: Option<usize>,
    #[serde(default)]
    pub page_size: Option<usize>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub account_type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub group_id: Option<i64>,
    #[serde(default)]
    pub ungrouped: bool,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub privacy_mode: Option<String>,
    #[serde(default)]
    pub sort_by: Option<String>,
    #[serde(default)]
    pub sort_order: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupInput {
    pub name: String,
    pub platform: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListGroupsForPlatformInput {
    pub platform: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAccountsInput {
    pub account_ids: Vec<i64>,
    /// Scheduled automation supplies only the statuses it is still allowed to
    /// delete. Ordinary interactive deletion omits this and preserves the
    /// existing behavior.
    #[serde(default)]
    pub required_statuses: Option<Vec<String>>,
}

/// Claims exactly one execution of a scheduled automation trigger across all
/// Sub2Bat processes for the current Windows user. `updatedAt` is part of the
/// durable identity so editing a rule permits its new schedule to run once.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginScheduledAutomationExecutionInput {
    pub rule_id: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimScheduledAutomationExecutionInput {
    pub rule_id: String,
    pub updated_at: String,
    pub schedule_id: String,
    pub schedule_cycle: u64,
    pub lease_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseScheduledAutomationExecutionInput {
    pub lease_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireAutomationExecutionLeaseInput {
    pub lease_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledAutomationExecutionClaimResult {
    pub status: ScheduledAutomationExecutionClaimStatus,
    pub lease_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginScheduledAutomationExecutionResult {
    pub schedule_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledAutomationExecutionClaimStatus {
    Claimed,
    AlreadyClaimed,
    Busy,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveAccountsToGroupInput {
    pub account_ids: Vec<i64>,
    pub group_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupAndMoveAccountsInput {
    pub account_ids: Vec<i64>,
    pub name: String,
    pub platform: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupAndMoveAccountsResult {
    pub group: AccountGroup,
    pub operation: AccountOperationResult,
    pub empty_group_deleted: bool,
    pub cleanup_notice: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAccountsPriorityInput {
    pub account_ids: Vec<i64>,
    pub priority: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAccountsConcurrencyInput {
    pub account_ids: Vec<i64>,
    pub concurrency: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAccountInput {
    pub account_id: i64,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAccountsInput {
    pub accounts: Vec<RenameAccountInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAccountIdentityInput {
    pub id: i64,
    pub name: String,
    pub platform: String,
    pub account_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAccountsDataInput {
    pub account_ids: Vec<i64>,
    /// Current official backups intentionally omit source IDs. The UI sends
    /// these public fields so the backend can still reject a mismatched scope.
    #[serde(default)]
    pub account_identities: Vec<ExportAccountIdentityInput>,
    #[serde(default = "default_include_proxies")]
    pub include_proxies: bool,
}

fn default_include_proxies() -> bool {
    true
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePreferences {
    pub server_url: String,
    pub email: String,
    pub remember_login: bool,
    pub last_model_id: String,
    pub concurrency: u8,
    pub auto_refresh_seconds: u16,
}

impl From<&SavedProfile> for ProfilePreferences {
    fn from(profile: &SavedProfile) -> Self {
        Self {
            server_url: profile.server_url.clone(),
            email: profile.email.clone(),
            remember_login: profile.remember_login,
            last_model_id: profile.last_model_id.clone(),
            concurrency: profile.concurrency,
            auto_refresh_seconds: normalize_auto_refresh_seconds(profile.auto_refresh_seconds),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoginResult {
    Authenticated {
        session: SessionView,
        preferences: ProfilePreferences,
    },
    TotpRequired {
        user_email_masked: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub session: Option<SessionView>,
    pub preferences: Option<ProfilePreferences>,
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStartResult {
    pub run_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BatchCompletionStatus {
    Running,
    Complete {
        succeeded: usize,
        failed: usize,
        cancelled: usize,
    },
    Missing,
}

enum RestoreSessionError {
    InvalidRefreshToken,
    Temporary,
    Stale,
}

#[tauri::command]
pub async fn restore_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RestoreResult, String> {
    let observed_generation = state.session_generation.load(Ordering::SeqCst);
    let Some(generation) = claim_auth_attempt(state.inner(), observed_generation).await else {
        return Ok(empty_restore_result());
    };
    let Some(mut profile) = load_profile(&app)? else {
        return Ok(empty_restore_result());
    };
    let refresh_token = match load_refresh_token(&profile.profile_id) {
        Ok(token) => token,
        Err(_) => {
            return Ok(RestoreResult {
                session: None,
                preferences: Some((&profile).into()),
                message: Some("无法读取已保存的登录信息，已保留登录设置，请稍后重试。".to_owned()),
            });
        }
    };

    if !matches!(
        restore_intent(Some(profile.clone()), refresh_token.is_some()),
        crate::session::RestoreIntent::Refresh(_)
    ) {
        return Ok(RestoreResult {
            session: None,
            preferences: Some((&profile).into()),
            message: None,
        });
    }

    let refresh_token = refresh_token.expect("restore intent requires refresh token");
    let restored = async {
        let server = ServerUrl::parse(&profile.server_url)
            .map_err(|_| RestoreSessionError::Temporary)?;
        let client = Sub2ApiClient::new(server.clone())
            .map_err(|_| RestoreSessionError::Temporary)?;
        let refresh = client.refresh(&refresh_token).await.map_err(|error| match error {
            RefreshError::InvalidToken => RestoreSessionError::InvalidRefreshToken,
            RefreshError::Temporary => RestoreSessionError::Temporary,
        })?;
        let rotated_refresh_token = if refresh.refresh_token.trim().is_empty() {
            refresh_token.clone()
        } else {
            refresh.refresh_token
        };
        let persistence_warning = {
            let _mutation = state.session_mutation.lock().await;
            if !session_generation_is_current(state.inner(), generation) {
                return Err(RestoreSessionError::Stale);
            }
            // A successful refresh may invalidate the prior token even if the
            // subsequent user lookup is temporarily unavailable.
            match save_refresh_token(&profile.profile_id, &rotated_refresh_token) {
                Ok(()) => None,
                Err(keyring_error) => {
                    let profile_error = disable_remembered_profile(&app, &profile).err();
                    profile.remember_login = false;
                    Some(match profile_error {
                        Some(profile_error) => format!(
                            "无法保存刷新后的登录令牌：{keyring_error}；也无法关闭记住登录：{profile_error}"
                        ),
                        None => format!(
                            "无法保存刷新后的登录令牌：{keyring_error}；已关闭记住登录，当前会话将在关闭客户端后失效。"
                        ),
                    })
                }
            }
        };
        let user = client
            .current_user(&refresh.access_token)
            .await
            .map_err(|_| RestoreSessionError::Temporary)?;
        let tokens = AuthTokens {
            access_token: refresh.access_token,
            refresh_token: rotated_refresh_token.clone(),
            expires_in: refresh.expires_in,
            user,
        };
        let active = ActiveSession::new(
            server,
            tokens,
            profile.profile_id.clone(),
            profile.remember_login,
            generation,
        );
        let view = active.view();
        let scheduled_session = active.clone();
        let _mutation = state.session_mutation.lock().await;
        if !session_generation_is_current(state.inner(), generation) {
            return Err(RestoreSessionError::Stale);
        }
        install_session_locked(state.inner(), active).await;
        schedule_session_refresh(app.clone(), state.inner().clone(), scheduled_session);
        Ok::<(SessionView, Option<String>), RestoreSessionError>((view, persistence_warning))
    }
    .await;

    match restored {
        Ok((session, message)) => Ok(RestoreResult {
            session: Some(session),
            preferences: Some((&profile).into()),
            message,
        }),
        Err(RestoreSessionError::InvalidRefreshToken) => {
            let _mutation = state.session_mutation.lock().await;
            if !session_generation_is_current(state.inner(), generation) {
                return Ok(empty_restore_result());
            }
            let cleanup_message = match disable_remembered_profile(&app, &profile) {
                Ok(()) => None,
                Err(error) => Some(format!(
                    "已保存的登录已失效，且清理本地凭据时出现问题：{error}"
                )),
            };
            profile.remember_login = false;
            invalidate_session_locked(state.inner()).await;
            Ok(RestoreResult {
                session: None,
                preferences: Some((&profile).into()),
                message: Some(
                    cleanup_message
                        .unwrap_or_else(|| "已保存的登录已失效，请重新输入密码。".to_owned()),
                ),
            })
        }
        Err(RestoreSessionError::Temporary) => Ok(RestoreResult {
            session: None,
            preferences: Some((&profile).into()),
            message: Some("暂时无法恢复已保存的登录，已保留登录信息，请稍后重试。".to_owned()),
        }),
        Err(RestoreSessionError::Stale) => Ok(empty_restore_result()),
    }
}

#[tauri::command]
pub async fn login(
    app: AppHandle,
    state: State<'_, AppState>,
    input: LoginInput,
) -> Result<LoginResult, String> {
    let observed_generation = state.session_generation.load(Ordering::SeqCst);
    let server = ServerUrl::parse(&input.server_url)?;
    let email = input.email.trim().to_owned();
    if email.is_empty() || input.password.trim().is_empty() {
        return Err("请输入管理员邮箱和密码。".to_owned());
    }

    let client = Sub2ApiClient::new(server.clone())?;
    let generation = claim_auth_attempt(state.inner(), observed_generation)
        .await
        .ok_or_else(|| STALE_AUTH_REQUEST_MESSAGE.to_owned())?;
    match client.login(&email, &input.password).await? {
        LoginPayload::Authenticated(tokens) => {
            establish_session(
                &app,
                state.inner(),
                server,
                tokens,
                input.remember_login,
                generation,
            )
            .await
        }
        LoginPayload::TotpRequired(challenge) => {
            let _mutation = state.session_mutation.lock().await;
            if !session_generation_is_current(state.inner(), generation) {
                return Err(STALE_AUTH_REQUEST_MESSAGE.to_owned());
            }
            *state.pending_totp.write().await = Some(PendingTotp {
                generation,
                server,
                email,
                remember_login: input.remember_login,
                temp_token: challenge.temp_token,
            });
            Ok(LoginResult::TotpRequired {
                user_email_masked: challenge.user_email_masked,
            })
        }
    }
}

#[tauri::command]
pub async fn complete_totp(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TotpInput,
) -> Result<LoginResult, String> {
    let observed_generation = state.session_generation.load(Ordering::SeqCst);
    let pending = state
        .pending_totp
        .read()
        .await
        .clone()
        .ok_or_else(|| "登录验证已过期，请重新输入账号和密码。".to_owned())?;
    if pending.generation != observed_generation {
        return Err("登录验证已过期，请重新输入账号和密码。".to_owned());
    }
    let code = input.code.trim();
    if code.len() != 6 || !code.chars().all(|character| character.is_ascii_digit()) {
        return Err("请输入 6 位动态验证码。".to_owned());
    }

    let client = Sub2ApiClient::new(pending.server.clone())?;
    let generation = claim_auth_attempt(state.inner(), observed_generation)
        .await
        .ok_or_else(|| "登录验证已过期，请重新输入账号和密码。".to_owned())?;
    let tokens = match client.complete_totp(&pending.temp_token, code).await {
        Ok(tokens) => tokens,
        Err(error) => {
            retain_pending_totp_after_failed_attempt(
                state.inner(),
                observed_generation,
                generation,
            )
            .await;
            return Err(error);
        }
    };
    establish_session(
        &app,
        state.inner(),
        pending.server,
        tokens,
        pending.remember_login,
        generation,
    )
    .await
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // The session boundary is intentionally committed before touching the
    // settings store or Credential Manager. Neither local I/O path can keep
    // old access tokens or batch requests alive after logout is accepted.
    let (profile_id, invalidated_generation) = {
        let _mutation = state.session_mutation.lock().await;
        let profile_id = state
            .session
            .read()
            .await
            .as_ref()
            .map(|session| session.profile_id.clone());
        invalidate_session_locked(state.inner()).await;
        (profile_id, state.session_generation.load(Ordering::SeqCst))
    };
    match profile_id {
        Some(profile_id) => cleanup_remembered_profile_if_current(
            &app,
            state.inner(),
            &profile_id,
            invalidated_generation,
        )
        .await
        .map_err(|error| format!("当前会话已退出，但无法安全清理记住登录：{error}")),
        None => Ok(()),
    }
}

/// Cancels an in-progress password/TOTP authentication flow without deleting
/// its remembered-login profile. The frontend uses this when the user chooses
/// to restart login so a delayed response cannot install a session afterwards.
#[tauri::command]
pub async fn cancel_authentication(state: State<'_, AppState>) -> Result<(), String> {
    let _mutation = state.session_mutation.lock().await;
    invalidate_session_locked(state.inner()).await;
    Ok(())
}

#[tauri::command]
pub async fn list_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Account>, String> {
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let query = AccountListQuery::default();
    let page = run_session_request(
        &app,
        state.inner(),
        &request,
        client.list_account_page(
            &request.session.tokens.access_token,
            1,
            DEFAULT_ACCOUNT_PAGE_SIZE,
            &query,
        ),
    )
    .await?;
    Ok(page.items)
}

/// Page-by-page account listing. This is the normal account-list command for
/// new clients; `list_accounts` remains as a bounded compatibility fallback.
#[tauri::command]
pub async fn list_accounts_page(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ListAccountsPageInput,
) -> Result<AccountPage, String> {
    let (page, page_size, query) = validate_list_accounts_page(input)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    run_session_request(
        &app,
        state.inner(),
        &request,
        client.list_account_page(
            &request.session.tokens.access_token,
            page,
            page_size,
            &query,
        ),
    )
    .await
}

#[tauri::command]
pub async fn list_groups(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<AccountGroup>, String> {
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    run_session_request(
        &app,
        state.inner(),
        &request,
        client.list_groups(&request.session.tokens.access_token),
    )
    .await
}

#[tauri::command]
pub async fn list_groups_for_platform(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ListGroupsForPlatformInput,
) -> Result<Vec<AccountGroup>, String> {
    let platform = validate_platform(&input.platform)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    run_session_request(
        &app,
        state.inner(),
        &request,
        client.list_groups_for_platform(&request.session.tokens.access_token, &platform),
    )
    .await
}

#[tauri::command]
pub async fn create_group(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CreateGroupInput,
) -> Result<AccountGroup, String> {
    let name = validate_group_name(&input.name)?;
    let platform = validate_platform(&input.platform)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    run_session_request(
        &app,
        state.inner(),
        &request,
        client.create_group(&request.session.tokens.access_token, &name, &platform),
    )
    .await
}

#[tauri::command]
pub async fn export_accounts_data(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportAccountsDataInput,
) -> Result<serde_json::Value, String> {
    let ExportAccountsDataInput {
        account_ids,
        account_identities,
        include_proxies,
    } = input;
    let account_ids = validate_account_ids(account_ids)?;
    let account_identities = account_identities
        .into_iter()
        .map(|identity| ExportAccountIdentity {
            id: identity.id,
            name: identity.name,
            platform: identity.platform,
            account_type: identity.account_type,
        })
        .collect::<Vec<_>>();
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    run_session_request(
        &app,
        state.inner(),
        &request,
        client.export_accounts_data(
            &request.session.tokens.access_token,
            &account_ids,
            &account_identities,
            include_proxies,
        ),
    )
    .await
}

/// Completes a recent TOTP step-up verification for the active admin session.
/// Sub2API v0.1.169 can require this before exposing credential-bearing
/// account exports. Login 2FA does not grant this separate authorization.
#[tauri::command]
pub async fn complete_export_step_up(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TotpInput,
) -> Result<(), String> {
    let code = input.code.trim();
    if code.len() != 6 || !code.chars().all(|character| character.is_ascii_digit()) {
        return Err("请输入 6 位动态验证码。".to_owned());
    }

    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    run_session_request(
        &app,
        state.inner(),
        &request,
        client.complete_step_up_totp(&request.session.tokens.access_token, code),
    )
    .await
}

#[tauri::command]
pub async fn delete_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
    input: DeleteAccountsInput,
) -> Result<AccountOperationResult, String> {
    let account_ids = validate_account_ids(input.account_ids)?;
    let required_statuses = validate_required_delete_statuses(input.required_statuses)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;

    // Newer Sub2API versions currently omit the ETag required for a safe
    // conditional delete. Probe before processing any account so a protected
    // automation run fails as one clear, non-destructive operation.
    if required_statuses.is_some() {
        let first_account_id = *account_ids
            .first()
            .expect("validated account deletion input is never empty");
        let capability_check = run_session_request(
            &app,
            state.inner(),
            &request,
            client.get_account_for_conditional_delete(
                &request.session.tokens.access_token,
                first_account_id,
            ),
        )
        .await;
        if let Err(error) = capability_check {
            if guarded_delete_requires_unsupported_conditional_api(&error) {
                return Err(guarded_delete_unsupported_message());
            }
        }
    }

    let mut result = AccountOperationResult::for_requested(&account_ids);

    for account_id in account_ids {
        ensure_session_request_is_current(state.inner(), &request)?;
        let deletion = if let Some(required_statuses) = required_statuses.as_ref() {
            // Guarded automation deletion is conditional on the exact server
            // version that supplied the allowed status. A server without a
            // strong ETag fails closed instead of leaving a TOCTOU window.
            let verification = run_session_request(
                &app,
                state.inner(),
                &request,
                client.get_account_for_conditional_delete(
                    &request.session.tokens.access_token,
                    account_id,
                ),
            )
            .await;
            let (account, etag) = match verification {
                Ok(verification) => verification,
                Err(error) => {
                    result.record_failure(account_id, format!("无法复核当前账号状态，未删除：{error}"));
                    continue;
                }
            };
            if let Err(error) = evaluate_protected_delete_verification(Ok(account), required_statuses) {
                result.record_failure(account_id, error);
                continue;
            }
            run_session_request(
                &app,
                state.inner(),
                &request,
                client.delete_account_if_match(
                    &request.session.tokens.access_token,
                    account_id,
                    &etag,
                ),
            )
            .await
        } else {
            run_session_request(
                &app,
                state.inner(),
                &request,
                client.delete_account(&request.session.tokens.access_token, account_id),
            )
            .await
        };
        match deletion {
            Ok(()) => result.record_success(account_id),
            Err(error) => result.record_failure(account_id, error),
        }
    }

    ensure_session_request_is_current(state.inner(), &request)?;
    Ok(result)
}

#[tauri::command]
pub async fn begin_scheduled_automation_execution(
    app: AppHandle,
    state: State<'_, AppState>,
    input: BeginScheduledAutomationExecutionInput,
) -> Result<BeginScheduledAutomationExecutionResult, String> {
    // The backend derives the scope from the active profile, so a renderer
    // cannot reset or supersede a schedule belonging to another login.
    let request = read_active_session(state.inner()).await?;
    let scope = format!(
        "{}|{}",
        request.session.profile_id,
        request.session.server.base()
    );
    ensure_session_request_is_current(state.inner(), &request)?;
    let app_local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位自动化执行状态目录：{error}"))?;
    let schedule_id = begin_scheduled_automation_execution_marker(
        &app_local_data_dir,
        &scope,
        &input.rule_id,
        &input.updated_at,
    )?;
    ensure_session_request_is_current(state.inner(), &request)?;

    Ok(BeginScheduledAutomationExecutionResult { schedule_id })
}

#[tauri::command]
pub async fn claim_scheduled_automation_execution(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ClaimScheduledAutomationExecutionInput,
) -> Result<ScheduledAutomationExecutionClaimResult, String> {
    // Do not use a renderer-supplied scope. The current profile and server
    // distinguish otherwise identical rule IDs copied between installations.
    let request = read_active_session(state.inner()).await?;
    let scope = format!(
        "{}|{}",
        request.session.profile_id,
        request.session.server.base()
    );
    let claim = ScheduledAutomationExecutionClaim::new(
        &scope,
        &input.rule_id,
        &input.updated_at,
        &input.schedule_id,
        input.schedule_cycle,
    )?;
    ensure_session_request_is_current(state.inner(), &request)?;
    let app_local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位自动化一次性执行标记目录：{error}"))?;

    let mut active_lease = state.automatic_execution_lease.lock().await;
    if active_lease.is_some() {
        return Ok(ScheduledAutomationExecutionClaimResult {
            status: ScheduledAutomationExecutionClaimStatus::Busy,
            lease_id: None,
        });
    }
    let Some(lease) = acquire_scheduled_automation_execution_lease(&app_local_data_dir, &input.lease_id)? else {
        return Ok(ScheduledAutomationExecutionClaimResult {
            status: ScheduledAutomationExecutionClaimStatus::Busy,
            lease_id: None,
        });
    };
    let claimed = claim_scheduled_automation_execution_marker(&app_local_data_dir, &claim)?;
    ensure_session_request_is_current(state.inner(), &request)?;
    if !claimed {
        return Ok(ScheduledAutomationExecutionClaimResult {
            status: ScheduledAutomationExecutionClaimStatus::AlreadyClaimed,
            lease_id: None,
        });
    }

    let lease_id = lease.id().to_owned();
    *active_lease = Some(lease);
    Ok(ScheduledAutomationExecutionClaimResult {
        status: ScheduledAutomationExecutionClaimStatus::Claimed,
        lease_id: Some(lease_id),
    })
}

#[tauri::command]
pub async fn acquire_automation_execution_lease(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AcquireAutomationExecutionLeaseInput,
) -> Result<ScheduledAutomationExecutionClaimResult, String> {
    let request = read_active_session(state.inner()).await?;
    ensure_session_request_is_current(state.inner(), &request)?;
    let app_local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位自动化执行锁目录：{error}"))?;

    let mut active_lease = state.automatic_execution_lease.lock().await;
    if active_lease.is_some() {
        return Ok(ScheduledAutomationExecutionClaimResult {
            status: ScheduledAutomationExecutionClaimStatus::Busy,
            lease_id: None,
        });
    }
    let Some(lease) = acquire_scheduled_automation_execution_lease(&app_local_data_dir, &input.lease_id)? else {
        return Ok(ScheduledAutomationExecutionClaimResult {
            status: ScheduledAutomationExecutionClaimStatus::Busy,
            lease_id: None,
        });
    };
    ensure_session_request_is_current(state.inner(), &request)?;

    let lease_id = lease.id().to_owned();
    *active_lease = Some(lease);
    Ok(ScheduledAutomationExecutionClaimResult {
        status: ScheduledAutomationExecutionClaimStatus::Claimed,
        lease_id: Some(lease_id),
    })
}

#[tauri::command]
pub async fn release_scheduled_automation_execution(
    state: State<'_, AppState>,
    input: ReleaseScheduledAutomationExecutionInput,
) -> Result<(), String> {
    let mut active_lease = state.automatic_execution_lease.lock().await;
    if active_lease
        .as_ref()
        .is_some_and(|lease| lease.matches(&input.lease_id))
    {
        // Dropping the file handle releases the OS-backed lock immediately.
        *active_lease = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn move_accounts_to_group(
    app: AppHandle,
    state: State<'_, AppState>,
    input: MoveAccountsToGroupInput,
) -> Result<AccountOperationResult, String> {
    let account_ids = validate_account_ids(input.account_ids)?;
    validate_group_id(input.group_id)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let accounts =
        load_accounts_for_group_move(&app, state.inner(), &request, &client, &account_ids).await?;
    let source_platform = selected_accounts_platform(&account_ids, &accounts)?;
    let groups = run_session_request(
        &app,
        state.inner(),
        &request,
        client.list_groups_for_platform(&request.session.tokens.access_token, &source_platform),
    )
    .await?;
    validate_same_platform_group_move(&source_platform, input.group_id, &groups)?;
    run_session_request(
        &app,
        state.inner(),
        &request,
        client.move_accounts_to_group(
            &request.session.tokens.access_token,
            &account_ids,
            input.group_id,
        ),
    )
    .await
}

/// Creates a platform-scoped group and moves an explicit account selection.
/// The upstream API has no transaction spanning these calls. This command
/// therefore preflights the current account platforms before creation and only
/// removes a newly-created group when the server has explicitly confirmed that
/// no selected account moved and a fresh group read proves it remains empty.
#[tauri::command]
pub async fn create_group_and_move_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
    input: CreateGroupAndMoveAccountsInput,
) -> Result<CreateGroupAndMoveAccountsResult, String> {
    let account_ids = validate_account_ids(input.account_ids)?;
    let name = validate_group_name(&input.name)?;
    let platform = validate_platform(&input.platform)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let accounts =
        load_accounts_for_group_move(&app, state.inner(), &request, &client, &account_ids).await?;
    let source_platform = selected_accounts_platform(&account_ids, &accounts)?;
    if source_platform != platform {
        return Err(format!(
            "跨平台移动已阻止：选中账号的平台为“{source_platform}”，新分组的平台为“{platform}”。"
        ));
    }

    let group = run_session_request(
        &app,
        state.inner(),
        &request,
        client.create_group(&request.session.tokens.access_token, &name, &platform),
    )
    .await?;
    let group_label = if group.name.trim().is_empty() {
        name.as_str()
    } else {
        group.name.trim()
    };

    let operation = match run_session_request(
        &app,
        state.inner(),
        &request,
        client.move_accounts_to_group(&request.session.tokens.access_token, &account_ids, group.id),
    )
    .await
    {
        Ok(operation) => operation,
        Err(error) => {
            return Err(format!(
                "新分组“{group_label}”已创建，但移动结果未能确认。为避免误删，未自动删除该分组；请刷新后检查分组和账号归属。原因：{error}"
            ));
        }
    };

    let (empty_group_deleted, cleanup_notice) =
        if operation_explicitly_confirms_no_success(&operation) {
            let (deleted, notice) = delete_created_group_if_verified_empty(
                &app,
                state.inner(),
                &request,
                &client,
                group.id,
                group_label,
            )
            .await;
            (deleted, Some(notice))
        } else {
            (false, None)
        };

    Ok(CreateGroupAndMoveAccountsResult {
        group,
        operation,
        empty_group_deleted,
        cleanup_notice,
    })
}

#[tauri::command]
pub async fn set_accounts_priority(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SetAccountsPriorityInput,
) -> Result<AccountOperationResult, String> {
    let account_ids = validate_account_ids(input.account_ids)?;
    validate_priority(input.priority)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let _bulk_update = run_session_request(
        &app,
        state.inner(),
        &request,
        client.set_accounts_priority(
            &request.session.tokens.access_token,
            &account_ids,
            input.priority,
        ),
    )
    .await?;

    verify_bulk_account_field_update(
        &app,
        state.inner(),
        &request,
        &client,
        &account_ids,
        AccountFieldReadback::Priority(input.priority),
    )
    .await
}

#[tauri::command]
pub async fn set_accounts_concurrency(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SetAccountsConcurrencyInput,
) -> Result<AccountOperationResult, String> {
    let account_ids = validate_account_ids(input.account_ids)?;
    validate_account_concurrency(input.concurrency)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let _bulk_update = run_session_request(
        &app,
        state.inner(),
        &request,
        client.set_accounts_concurrency(
            &request.session.tokens.access_token,
            &account_ids,
            input.concurrency,
        ),
    )
    .await?;

    verify_bulk_account_field_update(
        &app,
        state.inner(),
        &request,
        &client,
        &account_ids,
        AccountFieldReadback::Concurrency(input.concurrency),
    )
    .await
}

#[tauri::command]
pub async fn rename_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
    input: RenameAccountsInput,
) -> Result<AccountOperationResult, String> {
    let accounts = validate_rename_accounts(input.accounts)?;
    let request = active_session(&app, state.inner()).await?;
    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let account_ids = accounts
        .iter()
        .map(|account| account.account_id)
        .collect::<Vec<_>>();
    let mut result = AccountOperationResult::for_requested(&account_ids);

    for account in accounts {
        ensure_session_request_is_current(state.inner(), &request)?;
        match run_session_request(
            &app,
            state.inner(),
            &request,
            client.rename_account(
                &request.session.tokens.access_token,
                account.account_id,
                &account.name,
            ),
        )
        .await
        {
            Ok(()) => result.record_success(account.account_id),
            Err(error) => result.record_failure(account.account_id, error),
        }
    }

    ensure_session_request_is_current(state.inner(), &request)?;
    Ok(result)
}

#[tauri::command]
pub async fn load_models(
    app: AppHandle,
    state: State<'_, AppState>,
    account_ids: Vec<i64>,
    request_id: String,
) -> Result<ModelCatalog, String> {
    let request_id = validate_model_load_request_id(request_id)?;
    let ids = validate_model_account_ids(account_ids)?;
    let request = active_session(&app, state.inner()).await?;
    if ids.is_empty() {
        return Ok(ModelCatalog::from_account_models(0, Vec::new()));
    }

    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let access_token = request.session.tokens.access_token.clone();
    let requested_accounts = ids.len();
    let cancellation = register_model_load(state.inner(), &request_id).await?;
    let lookup_cancellation = cancellation.clone();
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(MODEL_LOAD_CANCELLED_MESSAGE.to_owned()),
        response = run_session_request(&app, state.inner(), &request, async move {
            let mut results = stream::iter(ids.into_iter().map(|account_id| {
                let client = client.clone();
                let access_token = access_token.clone();
                async move { client.available_models(&access_token, account_id).await }
            }))
            .buffer_unordered(MODEL_LOOKUP_CONCURRENCY);
            let mut catalog = ModelCatalogAccumulator::new(requested_accounts);

            loop {
                let next = tokio::select! {
                    biased;
                    _ = lookup_cancellation.cancelled() => {
                        return Err(MODEL_LOAD_CANCELLED_MESSAGE.to_owned());
                    }
                    next = results.next() => next,
                };
                let Some(result) = next else {
                    break;
                };
                // Preserve per-account model failures as unknown-model entries,
                // but surface authentication failures so the shared session can
                // refresh. Each non-auth result is consumed immediately instead
                // of accumulating a Vec for the entire account scope.
                if let Err(error) = &result {
                    if is_authentication_failure(error) {
                        return Err(error.clone());
                    }
                }
                catalog.record_account_result(result);
            }

            Ok(catalog.finish())
        }) => response,
    };
    finish_model_load(state.inner(), &request_id).await;
    result
}

/// Stops a renderer-initiated model-catalog request. It is deliberately
/// idempotent: a late cancellation after normal completion is harmless.
#[tauri::command]
pub async fn cancel_model_load(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    let request_id = validate_model_load_request_id(request_id)?;
    cancel_model_load_request(state.inner(), &request_id).await;
    Ok(())
}

#[tauri::command]
pub async fn start_batch_test(
    app: AppHandle,
    state: State<'_, AppState>,
    input: BatchStartInput,
) -> Result<BatchStartResult, String> {
    let account_ids = validate_account_ids(input.account_ids)?;
    let model_id = validate_batch_test_model_id(input.model_id)?;
    let concurrency = normalize_concurrency(input.concurrency);

    let run_id = Uuid::new_v4().to_string();
    let cancellation = CancellationToken::new();
    let app_state = state.inner().clone();
    let request = active_session(&app, &app_state).await?;
    // The critical section only registers the cancellation token. It does not
    // cover network work, so logout and account switching remain immediate.
    let _mutation = app_state.session_mutation.lock().await;
    ensure_session_request_is_current(&app_state, &request)?;
    // Only one run can be active. A newer run no longer needs an older
    // completion recovery record, so keep this handoff bounded.
    app_state.completed_batches.lock().await.clear();
    let mut batches = app_state.batches.lock().await;
    if !batches.is_empty() {
        return Err("已有批量测试正在进行，请等待完成或先取消当前测试。".to_owned());
    }
    batches.insert(run_id.clone(), cancellation.clone());
    drop(batches);
    let session = request.session.clone();
    drop(_mutation);
    tauri::async_runtime::spawn(batch_runner::run_batch(
        app,
        app_state,
        batch_runner::BatchRun {
            run_id: run_id.clone(),
            session,
            account_ids,
            model_id,
            concurrency,
            cancellation,
        },
    ));

    Ok(BatchStartResult { run_id })
}

#[tauri::command]
pub async fn set_default_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<ProfilePreferences, String> {
    let request = active_session(&app, state.inner()).await?;
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return Err("请选择有效的默认模型。".to_owned());
    }

    update_profile_for_session(&app, state.inner(), &request, |profile| {
        profile.last_model_id = model_id.to_owned();
    })
    .await
}

#[tauri::command]
pub async fn set_default_concurrency(
    app: AppHandle,
    state: State<'_, AppState>,
    concurrency: u8,
) -> Result<ProfilePreferences, String> {
    let request = active_session(&app, state.inner()).await?;
    if normalize_concurrency(concurrency) != concurrency {
        return Err("请选择有效的默认并发数。".to_owned());
    }

    update_profile_for_session(&app, state.inner(), &request, |profile| {
        profile.concurrency = concurrency;
    })
    .await
}

#[tauri::command]
pub async fn set_auto_refresh_seconds(
    app: AppHandle,
    state: State<'_, AppState>,
    auto_refresh_seconds: u16,
) -> Result<ProfilePreferences, String> {
    let request = active_session(&app, state.inner()).await?;
    if normalize_auto_refresh_seconds(auto_refresh_seconds) != auto_refresh_seconds {
        return Err("自动刷新间隔只能设为关闭或 5 到 3600 秒。".to_owned());
    }

    update_profile_for_session(&app, state.inner(), &request, |profile| {
        profile.auto_refresh_seconds = auto_refresh_seconds;
    })
    .await
}

#[tauri::command]
pub async fn cancel_batch(state: State<'_, AppState>, run_id: String) -> Result<bool, String> {
    let batches = state.batches.lock().await;
    let Some(cancellation) = batches.get(&run_id) else {
        return Ok(false);
    };
    cancellation.cancel();
    Ok(true)
}

#[tauri::command]
pub async fn get_batch_completion(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<BatchCompletionStatus, String> {
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Err("批量测试标识不能为空。".to_owned());
    }
    Ok(batch_completion_status(state.inner(), run_id).await)
}

async fn batch_completion_status(state: &AppState, run_id: &str) -> BatchCompletionStatus {
    // The runner stores its terminal record before taking the run out of this
    // registry. Seeing an active run therefore always wins over a record that
    // is still in the final handoff window.
    if state.batches.lock().await.contains_key(run_id) {
        return BatchCompletionStatus::Running;
    }

    match state.completed_batches.lock().await.remove(run_id) {
        Some(completion) => BatchCompletionStatus::Complete {
            succeeded: completion.succeeded,
            failed: completion.failed,
            cancelled: completion.cancelled,
        },
        None => BatchCompletionStatus::Missing,
    }
}

async fn establish_session(
    app: &AppHandle,
    state: &AppState,
    server: ServerUrl,
    tokens: AuthTokens,
    remember_login: bool,
    generation: u64,
) -> Result<LoginResult, String> {
    // Session and credential mutations share this short lock with logout.
    // Authentication network calls complete before reaching this point.
    let _mutation = state.session_mutation.lock().await;
    if !session_generation_is_current(state, generation) {
        return Err(STALE_AUTH_REQUEST_MESSAGE.to_owned());
    }
    let current_profile = load_profile(app)?;
    let profile = profile_for_login(
        current_profile.clone(),
        server.base().to_owned(),
        tokens.user.email.clone(),
        remember_login,
    );
    persist_login_profile(
        app,
        current_profile.as_ref(),
        &profile,
        &tokens.refresh_token,
    )?;

    let active = ActiveSession::new(
        server,
        tokens,
        profile.profile_id.clone(),
        remember_login,
        generation,
    );
    let view = active.view();
    let scheduled_session = active.clone();
    install_session_locked(state, active).await;
    schedule_session_refresh(app.clone(), state.clone(), scheduled_session);
    Ok(LoginResult::Authenticated {
        session: view,
        preferences: (&profile).into(),
    })
}

async fn claim_auth_attempt(state: &AppState, observed_generation: u64) -> Option<u64> {
    let _mutation = state.session_mutation.lock().await;
    if !session_generation_is_current(state, observed_generation) {
        return None;
    }

    let generation = state.session_generation.fetch_add(1, Ordering::SeqCst) + 1;
    // Starting a new authentication flow is a session boundary. Do not let
    // stale account mutations keep using the previous identity while login or
    // TOTP is in progress.
    if let Some(active) = state.session.read().await.clone() {
        active.cancel();
    }
    cancel_all_batches(state).await;
    Some(generation)
}

fn session_generation_is_current(state: &AppState, generation: u64) -> bool {
    state.session_generation.load(Ordering::SeqCst) == generation
}

async fn retain_pending_totp_after_failed_attempt(
    state: &AppState,
    previous_generation: u64,
    generation: u64,
) {
    let _mutation = state.session_mutation.lock().await;
    if !session_generation_is_current(state, generation) {
        return;
    }

    let mut pending = state.pending_totp.write().await;
    if let Some(pending) = pending.as_mut() {
        if pending.generation == previous_generation {
            pending.generation = generation;
        }
    }
}

fn empty_restore_result() -> RestoreResult {
    RestoreResult {
        session: None,
        preferences: None,
        message: None,
    }
}

#[derive(Clone)]
struct SessionRequest {
    session: ActiveSession,
}

async fn active_session(app: &AppHandle, state: &AppState) -> Result<SessionRequest, String> {
    let request = read_active_session(state).await?;
    if !request.session.needs_refresh() {
        return Ok(request);
    }

    refresh_active_session(
        app,
        state,
        request.session.generation,
        request.session.token_revision,
        false,
    )
    .await
}

async fn read_active_session(state: &AppState) -> Result<SessionRequest, String> {
    let observed_generation = state.session_generation.load(Ordering::SeqCst);
    let session = state
        .session
        .read()
        .await
        .clone()
        .ok_or_else(|| "登录已失效，请重新登录。".to_owned())?;

    if session.generation != observed_generation || session.cancellation.is_cancelled() {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }

    Ok(SessionRequest { session })
}

async fn refresh_active_session(
    app: &AppHandle,
    state: &AppState,
    expected_generation: u64,
    expected_token_revision: u64,
    force: bool,
) -> Result<SessionRequest, String> {
    let observed = read_active_session(state).await?;
    if observed.session.generation != expected_generation
        || observed.session.token_revision != expected_token_revision
    {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }
    let _refresh = tokio::select! {
        guard = state.session_refresh.lock() => guard,
        _ = observed.session.cancellation.cancelled() => {
            return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
        }
    };
    let request = read_active_session(state).await?;
    if request.session.generation != expected_generation
        || request.session.token_revision != expected_token_revision
    {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }
    if request.session.refresh_retry_pending() {
        return Err(TEMPORARY_REFRESH_MESSAGE.to_owned());
    }
    if !force && !request.session.needs_refresh() {
        return Ok(request);
    }

    let refresh_token = request.session.tokens.refresh_token.trim().to_owned();
    if refresh_token.is_empty() {
        invalidate_expired_session(app, state, &request).await?;
        return Err(EXPIRED_SESSION_MESSAGE.to_owned());
    }

    let client = Sub2ApiClient::new(request.session.server.clone())?;
    let refresh_result = tokio::select! {
        refresh = client.refresh(&refresh_token) => refresh,
        _ = request.session.cancellation.cancelled() => {
            return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
        }
    };
    let refresh = match refresh_result {
        Ok(refresh) => refresh,
        Err(RefreshError::InvalidToken) => {
            invalidate_expired_session(app, state, &request).await?;
            return Err(EXPIRED_SESSION_MESSAGE.to_owned());
        }
        Err(RefreshError::Temporary) => {
            let deferred = defer_session_refresh(state, &request, REFRESH_RETRY_DELAY).await?;
            schedule_session_refresh_after(
                app.clone(),
                state.clone(),
                deferred,
                REFRESH_RETRY_DELAY,
            );
            return Err(TEMPORARY_REFRESH_MESSAGE.to_owned());
        }
    };

    let _mutation = state.session_mutation.lock().await;
    ensure_session_request_is_current(state, &request)?;
    let current = state
        .session
        .read()
        .await
        .clone()
        .ok_or_else(|| "登录已失效，请重新登录。".to_owned())?;
    if current.generation != expected_generation
        || current.token_revision != expected_token_revision
        || current.cancellation.is_cancelled()
    {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }
    if current.refresh_retry_pending() {
        return Err(TEMPORARY_REFRESH_MESSAGE.to_owned());
    }
    if !force && !current.needs_refresh() {
        return Ok(SessionRequest { session: current });
    }

    let rotated_refresh_token = if refresh.refresh_token.trim().is_empty() {
        current.tokens.refresh_token.clone()
    } else {
        refresh.refresh_token
    };
    let tokens = AuthTokens {
        access_token: refresh.access_token,
        refresh_token: rotated_refresh_token,
        expires_in: refresh.expires_in,
        user: current.tokens.user.clone(),
    };
    let mut remember_login = current.remember_login;
    let persistence_error = if current.remember_login {
        match save_refresh_token(&current.profile_id, &tokens.refresh_token) {
            Ok(()) => None,
            Err(keyring_error) => {
                // The server may already have invalidated the previous refresh
                // token. Keep the newly issued credentials in memory and turn
                // off restore-on-launch rather than leaving a broken old token
                // marked as remembered.
                remember_login = false;
                let profile_error = match load_profile(app) {
                    Ok(Some(profile)) if profile.profile_id == current.profile_id => {
                        disable_remembered_profile(app, &profile).err()
                    }
                    Ok(_) => None,
                    Err(error) => Some(error),
                };
                Some(match profile_error {
                    Some(profile_error) => format!(
                        "无法保存刷新后的登录令牌：{keyring_error}；也无法关闭记住登录：{profile_error}"
                    ),
                    None => format!(
                        "无法保存刷新后的登录令牌：{keyring_error}；已关闭记住登录，当前会话将在关闭客户端后失效。"
                    ),
                })
            }
        }
    } else {
        None
    };
    let refreshed = current.with_refreshed_tokens_and_remember_login(tokens, remember_login);
    // This only cancels requests carrying the old access token. The refreshed
    // session owns a new cancellation token, so future commands continue
    // normally while late 401s from the old token become stale instead of
    // logging the user out.
    current.cancel();
    *state.session.write().await = Some(refreshed.clone());
    schedule_session_refresh(app.clone(), state.clone(), refreshed.clone());
    match persistence_error {
        Some(error) => Err(error),
        None => Ok(SessionRequest { session: refreshed }),
    }
}

async fn defer_session_refresh(
    state: &AppState,
    request: &SessionRequest,
    delay: std::time::Duration,
) -> Result<ActiveSession, String> {
    let _mutation = state.session_mutation.lock().await;
    ensure_session_request_is_current(state, request)?;
    let current = state
        .session
        .read()
        .await
        .clone()
        .ok_or_else(|| "登录已失效，请重新登录。".to_owned())?;
    if current.generation != request.session.generation
        || current.token_revision != request.session.token_revision
        || current.cancellation.is_cancelled()
    {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }

    let deferred = current.with_refresh_retry_after(delay);
    *state.session.write().await = Some(deferred.clone());
    Ok(deferred)
}

fn schedule_session_refresh(app: AppHandle, state: AppState, session: ActiveSession) {
    let Some(delay) = session.refresh_delay() else {
        return;
    };
    schedule_session_refresh_after(app, state, session, delay);
}

fn schedule_session_refresh_after(
    app: AppHandle,
    state: AppState,
    session: ActiveSession,
    delay: std::time::Duration,
) {
    let cancellation = session.cancellation.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = cancellation.cancelled() => {}
            _ = tokio::time::sleep(delay) => {
                let _ = refresh_active_session(
                    &app,
                    &state,
                    session.generation,
                    session.token_revision,
                    false,
                )
                .await;
            }
        }
    });
}

async fn run_session_request<T, F>(
    app: &AppHandle,
    state: &AppState,
    request: &SessionRequest,
    request_future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    ensure_session_request_is_current(state, request)?;
    tokio::select! {
        _ = request.session.cancellation.cancelled() => {
            Err(STALE_SESSION_REQUEST_MESSAGE.to_owned())
        }
        response = request_future => {
            ensure_session_request_is_current(state, request)?;
            match response {
                Err(error) if is_authentication_failure(&error) => {
                    match refresh_active_session(
                        app,
                        state,
                        request.session.generation,
                        request.session.token_revision,
                        true,
                    )
                    .await
                    {
                        Ok(_) => Err(SESSION_REFRESHED_RETRY_MESSAGE.to_owned()),
                        Err(refresh_error) => Err(refresh_error),
                    }
                }
                response => response,
            }
        }
    }
}

fn is_authentication_failure(error: &str) -> bool {
    let status = error.trim_start().strip_prefix("HTTP ").and_then(|value| {
        value
            .split(|character: char| !character.is_ascii_digit())
            .next()
    });
    // A bare 403 can mean an administrator role lacks permission for one
    // endpoint. Only a 401 or an explicit official envelope code is a reason
    // to refresh/expire the whole login session.
    matches!(status, Some("401")) || matches!(envelope_error_code(error), Some(401))
}

pub(crate) async fn active_session_for_batch(
    app: &AppHandle,
    state: &AppState,
    expected_generation: u64,
) -> Result<ActiveSession, String> {
    let request = active_session(app, state).await?;
    if request.session.generation != expected_generation {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }
    Ok(request.session)
}

/// Refreshes a batch worker's access token after an explicit authentication
/// failure. A concurrent worker may already have refreshed it; in that case
/// return the newer token instead of issuing another refresh request.
pub(crate) async fn recover_batch_session_after_auth_failure(
    app: &AppHandle,
    state: &AppState,
    session: ActiveSession,
    http_status: Option<u16>,
    error: &str,
) -> Result<Option<ActiveSession>, String> {
    if !matches!(http_status, Some(401)) && !is_authentication_failure(error) {
        return Ok(None);
    }

    if let Some(refreshed) = newer_session_for_batch(state, &session).await {
        return Ok(Some(refreshed));
    }

    let request = SessionRequest {
        session: session.clone(),
    };
    match refresh_active_session(app, state, session.generation, session.token_revision, true).await
    {
        Ok(refreshed) => Ok(Some(refreshed.session)),
        Err(error) => {
            // If another worker refreshed while this worker was waiting for
            // the refresh mutex, use its token and retry once.
            if let Some(refreshed) = newer_session_for_batch(state, &request.session).await {
                Ok(Some(refreshed))
            } else {
                Err(error)
            }
        }
    }
}

async fn newer_session_for_batch(
    state: &AppState,
    failed: &ActiveSession,
) -> Option<ActiveSession> {
    let current = state.session.read().await.clone()?;
    (current.generation == failed.generation
        && current.token_revision != failed.token_revision
        && !current.cancellation.is_cancelled())
    .then_some(current)
}

fn ensure_session_request_is_current(
    state: &AppState,
    request: &SessionRequest,
) -> Result<(), String> {
    if request.session.cancellation.is_cancelled()
        || !session_generation_is_current(state, request.session.generation)
    {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }

    Ok(())
}

async fn install_session_locked(state: &AppState, active: ActiveSession) {
    let previous = state.session.write().await.replace(active);
    if let Some(previous) = previous {
        previous.cancel();
    }
    *state.pending_totp.write().await = None;
    cancel_all_batches(state).await;
    cancel_all_model_loads(state).await;
}

async fn invalidate_session_locked(state: &AppState) {
    state.session_generation.fetch_add(1, Ordering::SeqCst);
    let previous = state.session.write().await.take();
    if let Some(previous) = previous {
        previous.cancel();
    }
    *state.pending_totp.write().await = None;
    cancel_all_batches(state).await;
    cancel_all_model_loads(state).await;
}

async fn cancel_all_batches(state: &AppState) {
    // A session boundary makes every existing run stale. Remove the registry
    // entries before signalling cancellation so a new session cannot remain
    // blocked behind a task that is still unwinding a request.
    let cancellations = {
        let mut batches = state.batches.lock().await;
        batches
            .drain()
            .map(|(_, cancellation)| cancellation)
            .collect::<Vec<_>>()
    };
    for cancellation in cancellations {
        cancellation.cancel();
    }
}

async fn register_model_load(
    state: &AppState,
    request_id: &str,
) -> Result<CancellationToken, String> {
    let cancellation = CancellationToken::new();
    let mut model_loads = state.model_loads.lock().await;
    if model_loads.contains_key(request_id) {
        return Err("相同的测试模型读取请求仍在进行。".to_owned());
    }
    model_loads.insert(request_id.to_owned(), cancellation.clone());
    Ok(cancellation)
}

async fn finish_model_load(state: &AppState, request_id: &str) {
    state.model_loads.lock().await.remove(request_id);
}

async fn cancel_model_load_request(state: &AppState, request_id: &str) {
    let cancellation = state.model_loads.lock().await.get(request_id).cloned();
    if let Some(cancellation) = cancellation {
        cancellation.cancel();
    }
}

async fn cancel_all_model_loads(state: &AppState) {
    // Remove registry entries before signalling cancellation. A new session
    // must never see an old, unwinding catalog request as active.
    let cancellations = {
        let mut model_loads = state.model_loads.lock().await;
        model_loads
            .drain()
            .map(|(_, cancellation)| cancellation)
            .collect::<Vec<_>>()
    };
    for cancellation in cancellations {
        cancellation.cancel();
    }
}

async fn invalidate_expired_session(
    app: &AppHandle,
    state: &AppState,
    request: &SessionRequest,
) -> Result<(), String> {
    // Clear the active session and cancel batches before any store or Keyring
    // operation. Those APIs can block independently of the network and must
    // not delay an authentication-expiry boundary.
    let (remembered_profile_id, invalidated_generation) = {
        let _mutation = state.session_mutation.lock().await;
        ensure_session_request_is_current(state, request)?;
        let current = state
            .session
            .read()
            .await
            .clone()
            .ok_or_else(|| "登录已失效，请重新登录。".to_owned())?;
        if current.generation != request.session.generation
            || current.token_revision != request.session.token_revision
            || current.cancellation.is_cancelled()
        {
            return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
        }

        let profile_id = current.remember_login.then_some(current.profile_id.clone());
        invalidate_session_locked(state).await;
        (profile_id, state.session_generation.load(Ordering::SeqCst))
    };
    let _ = app.emit("session://expired", ());
    let cleanup_result = match remembered_profile_id {
        Some(profile_id) => {
            cleanup_remembered_profile_if_current(app, state, &profile_id, invalidated_generation)
                .await
        }
        None => Ok(()),
    };
    cleanup_result.map_err(|error| format!("{EXPIRED_SESSION_MESSAGE}；{error}"))
}

async fn update_profile_for_session<F>(
    app: &AppHandle,
    state: &AppState,
    request: &SessionRequest,
    update: F,
) -> Result<ProfilePreferences, String>
where
    F: FnOnce(&mut SavedProfile),
{
    let _mutation = state.session_mutation.lock().await;
    ensure_session_request_is_current(state, request)?;
    let Some(mut profile) = load_profile(app)? else {
        return Err("当前没有可保存的登录偏好。".to_owned());
    };
    if profile.profile_id != request.session.profile_id {
        return Err(STALE_SESSION_REQUEST_MESSAGE.to_owned());
    }

    update(&mut profile);
    save_profile(app, &profile)?;
    Ok((&profile).into())
}

/// Removes restore credentials only while the session boundary that requested
/// cleanup is still current. This prevents a late logout/expiry cleanup from
/// deleting a new login's rotated token, while still attempting direct
/// Credential Manager cleanup if the settings store cannot be read.
async fn cleanup_remembered_profile_if_current(
    app: &AppHandle,
    state: &AppState,
    profile_id: &str,
    expected_generation: u64,
) -> Result<(), String> {
    let _mutation = state.session_mutation.lock().await;
    if !session_generation_is_current(state, expected_generation) {
        return Ok(());
    }

    match load_profile(app) {
        Ok(Some(profile)) if profile.profile_id == profile_id => {
            disable_remembered_profile(app, &profile)
        }
        Ok(_) => delete_refresh_token(profile_id).map_err(|error| {
            format!("无法删除系统凭据中的刷新令牌：{error}")
        }),
        Err(profile_error) => match delete_refresh_token(profile_id) {
            Ok(()) => Ok(()),
            Err(token_error) => Err(format!(
                "无法读取已保存的登录设置：{profile_error}；也无法删除系统凭据中的刷新令牌：{token_error}"
            )),
        },
    }
}

fn disable_remembered_profile(app: &AppHandle, profile: &SavedProfile) -> Result<(), String> {
    // Either durable action is sufficient to prevent automatic restoration:
    // the profile opt-out takes precedence, while deleting the credential is a
    // valid fallback if the store cannot be written.
    match mark_profile_not_remembered(app, profile) {
        // Keep the persisted opt-out even if Credential Manager cleanup fails:
        // it prevents automatic restoration, while the caller still receives
        // a clear warning that a credential may remain on this device.
        Ok(()) => delete_refresh_token(&profile.profile_id)
            .map_err(|error| format!("已关闭记住登录，但无法删除系统凭据中的刷新令牌：{error}")),
        Err(profile_error) => match delete_refresh_token(&profile.profile_id) {
            Ok(()) => Ok(()),
            Err(token_error) => Err(format!(
                "无法保存退出后的登录设置：{profile_error}；也无法删除刷新令牌：{token_error}"
            )),
        },
    }
}

fn mark_profile_not_remembered(app: &AppHandle, profile: &SavedProfile) -> Result<(), String> {
    let mut disabled_profile = profile.clone();
    disabled_profile.remember_login = false;
    save_profile(app, &disabled_profile)
}

fn persist_login_profile(
    app: &AppHandle,
    current_profile: Option<&SavedProfile>,
    profile: &SavedProfile,
    refresh_token: &str,
) -> Result<(), String> {
    if profile.remember_login && refresh_token.trim().is_empty() {
        return Err("服务器没有返回可用于记住登录的刷新令牌。".to_owned());
    }

    // Capture both credentials before changing either store. If a later save
    // fails, the original login remains recoverable instead of being deleted
    // before the replacement profile is durable.
    let target_token_before = load_refresh_token(&profile.profile_id)?;
    let previous_token = current_profile
        .filter(|current| current.profile_id != profile.profile_id)
        .map(|current| {
            load_refresh_token(&current.profile_id).map(|token| (current.profile_id.clone(), token))
        })
        .transpose()?;

    let stage_result = if profile.remember_login {
        save_refresh_token(&profile.profile_id, refresh_token)
    } else {
        delete_refresh_token(&profile.profile_id)
    };
    if let Err(error) = stage_result {
        return Err(format!("无法更新当前登录凭据：{error}"));
    }

    if let Err(error) = save_profile(app, profile) {
        let rollback = rollback_login_persistence(
            app,
            current_profile,
            &profile.profile_id,
            target_token_before.as_deref(),
            previous_token
                .as_ref()
                .map(|(profile_id, token)| (profile_id.as_str(), token.as_deref())),
        );
        return Err(with_rollback_error(
            format!("无法保存登录设置：{error}"),
            rollback,
        ));
    }

    if let Some((previous_profile_id, _)) = previous_token.as_ref() {
        if let Err(error) = delete_refresh_token(previous_profile_id) {
            let rollback = rollback_login_persistence(
                app,
                current_profile,
                &profile.profile_id,
                target_token_before.as_deref(),
                previous_token
                    .as_ref()
                    .map(|(profile_id, token)| (profile_id.as_str(), token.as_deref())),
            );
            return Err(with_rollback_error(
                format!("无法删除上一账户的刷新令牌：{error}"),
                rollback,
            ));
        }
    }

    Ok(())
}

fn rollback_login_persistence(
    app: &AppHandle,
    current_profile: Option<&SavedProfile>,
    target_profile_id: &str,
    target_token_before: Option<&str>,
    previous_token: Option<(&str, Option<&str>)>,
) -> Vec<String> {
    let mut failures = Vec::new();
    if let Err(error) = restore_refresh_token(target_profile_id, target_token_before) {
        failures.push(format!("无法恢复刷新令牌：{error}"));
    }
    if let Some(current_profile) = current_profile {
        if let Err(error) = save_profile(app, current_profile) {
            failures.push(format!("无法恢复原登录设置：{error}"));
        }
    }
    if let Some((profile_id, token)) = previous_token {
        if let Err(error) = restore_refresh_token(profile_id, token) {
            failures.push(format!("无法恢复上一账户的刷新令牌：{error}"));
        }
    }
    failures
}

fn restore_refresh_token(profile_id: &str, previous: Option<&str>) -> Result<(), String> {
    match previous {
        Some(token) => save_refresh_token(profile_id, token),
        None => delete_refresh_token(profile_id),
    }
}

fn with_rollback_error(primary: String, rollback_failures: Vec<String>) -> String {
    if rollback_failures.is_empty() {
        primary
    } else {
        format!("{primary}；补偿失败：{}", rollback_failures.join("；"))
    }
}

fn validate_list_accounts_page(
    input: ListAccountsPageInput,
) -> Result<(usize, usize, AccountListQuery), String> {
    let page = input.page.unwrap_or(1);
    let page_size = input.page_size.unwrap_or(DEFAULT_ACCOUNT_PAGE_SIZE);
    if page == 0 || page > MAX_ACCOUNT_PAGE_NUMBER {
        return Err(format!(
            "账号页码必须在 1 到 {MAX_ACCOUNT_PAGE_NUMBER} 之间。"
        ));
    }
    if page_size == 0 || page_size > MAX_ACCOUNT_PAGE_SIZE {
        return Err(format!(
            "每页账号数必须在 1 到 {MAX_ACCOUNT_PAGE_SIZE} 之间。"
        ));
    }

    let group = match (input.group_id, input.ungrouped) {
        (Some(_), true) => return Err("不能同时筛选指定分组和未分组账号。".to_owned()),
        (Some(group_id), false) => {
            validate_group_id(group_id)?;
            Some(group_id.to_string())
        }
        (None, true) => Some("ungrouped".to_owned()),
        (None, false) => None,
    };

    let sort_by = validate_account_list_sort_by(input.sort_by)?;
    let sort_order = validate_account_list_sort_order(input.sort_order)?;
    Ok((
        page,
        page_size,
        AccountListQuery {
            platform: normalize_account_list_filter(input.platform, "平台")?,
            account_type: normalize_account_list_filter(input.account_type, "账号类型")?,
            status: normalize_account_list_filter(input.status, "状态")?,
            group,
            search: normalize_account_list_filter(input.search, "搜索内容")?,
            privacy_mode: normalize_account_list_filter(input.privacy_mode, "隐私状态")?,
            sort_by,
            sort_order,
        },
    ))
}

fn normalize_account_list_filter(
    value: Option<String>,
    name: &str,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > MAX_ACCOUNT_LIST_FILTER_LENGTH {
        return Err(format!(
            "{name}不能超过 {MAX_ACCOUNT_LIST_FILTER_LENGTH} 个字符。"
        ));
    }
    Ok(Some(value.to_owned()))
}

fn validate_account_list_sort_by(value: Option<String>) -> Result<Option<String>, String> {
    let value =
        normalize_account_list_filter(value, "排序字段")?.map(|value| value.to_ascii_lowercase());
    let Some(value) = value else {
        return Ok(None);
    };
    if value == "group" || value == "group_name" {
        return Err("Sub2API 的账号列表不支持按分组全局排序；请在当前页内排序。".to_owned());
    }
    if !matches!(
        value.as_str(),
        "name"
            | "id"
            | "status"
            | "schedulable"
            | "priority"
            | "rate_multiplier"
            | "last_used_at"
            | "expires_at"
            | "created_at"
    ) {
        return Err("不支持的账号排序字段。".to_owned());
    }
    Ok(Some(value))
}

fn validate_account_list_sort_order(value: Option<String>) -> Result<Option<String>, String> {
    let value =
        normalize_account_list_filter(value, "排序方向")?.map(|value| value.to_ascii_lowercase());
    match value.as_deref() {
        None | Some("asc") | Some("desc") => Ok(value),
        Some(_) => Err("排序方向只能是 asc 或 desc。".to_owned()),
    }
}

fn unique_ids(account_ids: Vec<i64>) -> Vec<i64> {
    let mut seen = HashSet::new();
    account_ids
        .into_iter()
        .filter(|account_id| seen.insert(*account_id))
        .collect()
}

fn validate_account_ids(account_ids: Vec<i64>) -> Result<Vec<i64>, String> {
    if account_ids.is_empty() {
        return Err("请至少选择一个账号。".to_owned());
    }
    if account_ids.len() > MAX_ACCOUNT_OPERATION_IDS {
        return Err(format!(
            "一次最多操作 {MAX_ACCOUNT_OPERATION_IDS} 个账号，请缩小筛选范围后重试。"
        ));
    }
    if account_ids.iter().any(|account_id| *account_id <= 0) {
        return Err("账号 ID 必须是正整数。".to_owned());
    }

    Ok(unique_ids(account_ids))
}

fn validate_batch_test_model_id(model_id: String) -> Result<String, String> {
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return Err("请选择测试模型。".to_owned());
    }

    Ok(model_id.to_owned())
}

fn validate_model_load_request_id(request_id: String) -> Result<String, String> {
    let request_id = request_id.trim();
    if request_id.is_empty() || request_id.len() > MAX_MODEL_LOAD_REQUEST_ID_LENGTH {
        return Err("测试模型读取请求标识无效。".to_owned());
    }
    if !request_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("测试模型读取请求标识无效。".to_owned());
    }
    Ok(request_id.to_owned())
}

fn validate_model_account_ids(mut account_ids: Vec<i64>) -> Result<Vec<i64>, String> {
    if account_ids.len() > MAX_MODEL_ACCOUNT_IDS {
        return Err(format!(
            "一次最多读取 {MAX_MODEL_ACCOUNT_IDS} 个账号的测试模型，请缩小选择范围或筛选范围。"
        ));
    }
    if account_ids.iter().any(|account_id| *account_id <= 0) {
        return Err("账号 ID 必须是正整数。".to_owned());
    }
    // Keep no second O(account_ids) HashSet while a one-million-account model
    // request is in flight. Output order is intentionally not meaningful for
    // the concurrent catalog lookup, so in-place sort/dedup is sufficient.
    account_ids.sort_unstable();
    account_ids.dedup();
    Ok(account_ids)
}

fn validate_group_id(group_id: i64) -> Result<(), String> {
    if group_id <= 0 {
        return Err("分组 ID 必须是正整数。".to_owned());
    }
    Ok(())
}

async fn load_accounts_for_group_move(
    app: &AppHandle,
    state: &AppState,
    request: &SessionRequest,
    client: &Sub2ApiClient,
    account_ids: &[i64],
) -> Result<Vec<Account>, String> {
    let access_token = request.session.tokens.access_token.clone();
    let lookup_client = client.clone();
    let lookup_ids = account_ids.to_vec();
    let selected_accounts = async move {
        stream::iter(lookup_ids.into_iter().map(move |account_id| {
            let client = lookup_client.clone();
            let access_token = access_token.clone();
            async move { client.get_account(&access_token, account_id).await }
        }))
        .buffer_unordered(ACCOUNT_LOOKUP_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
    };

    run_session_request(app, state, request, selected_accounts).await
}

/// Loads selected accounts for field-update readback while retaining individual
/// lookup failures, so the caller can report each account independently.
async fn load_accounts_for_verification(
    app: &AppHandle,
    state: &AppState,
    request: &SessionRequest,
    client: &Sub2ApiClient,
    account_ids: &[i64],
) -> Result<HashMap<i64, Result<Account, String>>, String> {
    let access_token = request.session.tokens.access_token.clone();
    let lookup_client = client.clone();
    let lookup_ids = account_ids.to_vec();
    let lookups = async move {
        let results = stream::iter(lookup_ids.into_iter().map(move |account_id| {
            let client = lookup_client.clone();
            let access_token = access_token.clone();
            async move {
                let result = client.get_account(&access_token, account_id).await;
                (account_id, result)
            }
        }))
        .buffer_unordered(ACCOUNT_LOOKUP_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

        // Let the normal session wrapper refresh an expired access token rather
        // than turning an authentication problem into a misleading skip.
        if let Some(error) = results.iter().find_map(|(_, result)| match result {
            Err(error) if is_authentication_failure(error) => Some(error.clone()),
            _ => None,
        }) {
            return Err(error);
        }

        Ok(results.into_iter().collect::<HashMap<_, _>>())
    };

    run_session_request(app, state, request, lookups).await
}

/// Re-read every selected account after a successful official bulk update.
/// A 2xx response alone is not considered success for these fields: callers
/// must receive an exact matching value from the same active session.
async fn verify_bulk_account_field_update(
    app: &AppHandle,
    state: &AppState,
    request: &SessionRequest,
    client: &Sub2ApiClient,
    account_ids: &[i64],
    expected: AccountFieldReadback,
) -> Result<AccountOperationResult, String> {
    let mut accounts =
        load_accounts_for_verification(app, state, request, client, account_ids).await?;
    let mut result = AccountOperationResult::for_requested(account_ids);

    for account_id in account_ids {
        ensure_session_request_is_current(state, request)?;
        record_account_field_readback(
            &mut result,
            *account_id,
            expected,
            accounts.remove(account_id),
        );
    }

    ensure_session_request_is_current(state, request)?;
    Ok(result)
}

fn record_account_field_readback(
    result: &mut AccountOperationResult,
    account_id: i64,
    expected: AccountFieldReadback,
    readback: Option<Result<Account, String>>,
) {
    match readback {
        Some(Ok(account)) if expected.actual_value(&account) == Some(expected.expected_value()) => {
            result.record_success(account_id);
        }
        Some(Ok(account)) => {
            let actual = expected
                .actual_value(&account)
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未返回".to_owned());
            result.record_failure(
                account_id,
                format!(
                    "设置{}后复核失败：服务端返回 {}，期望 {}。",
                    expected.label(),
                    actual,
                    expected.expected_value(),
                ),
            );
        }
        Some(Err(error)) => {
            result.record_failure(
                account_id,
                format!("设置{}后无法复核：{error}", expected.label()),
            );
        }
        None => {
            result.record_failure(
                account_id,
                format!("设置{}后未获得账号复核结果。", expected.label()),
            );
        }
    }
}

fn operation_explicitly_confirms_no_success(operation: &AccountOperationResult) -> bool {
    if operation.success > 0
        || !operation.success_ids.is_empty()
        || operation.results.iter().any(|item| item.success)
    {
        return false;
    }

    // `success`/`failed` and their ID lists are part of Sub2API's documented
    // bulk-update response. Do not infer a failure from an optional result row
    // whose boolean might have been omitted by a compatible server.
    operation.failed > 0 || !operation.failed_ids.is_empty()
}

async fn delete_created_group_if_verified_empty(
    app: &AppHandle,
    state: &AppState,
    request: &SessionRequest,
    client: &Sub2ApiClient,
    group_id: i64,
    group_label: &str,
) -> (bool, String) {
    let snapshot = match run_session_request(
        app,
        state,
        request,
        client.get_group(&request.session.tokens.access_token, group_id),
    )
    .await
    {
        Ok(group) => group,
        Err(error) => {
            return (
                false,
                format!(
                    "新分组“{group_label}”未能确认是否为空，未自动删除；请刷新后检查。原因：{error}"
                ),
            );
        }
    };

    match snapshot.account_count {
        Some(0) => match run_session_request(
            app,
            state,
            request,
            client.delete_group(&request.session.tokens.access_token, group_id),
        )
        .await
        {
            Ok(()) => (true, format!("新分组“{group_label}”为空，已自动删除。")),
            Err(error) => (
                false,
                format!(
                    "新分组“{group_label}”已确认为空，但自动删除失败；请刷新后处理。原因：{error}"
                ),
            ),
        },
        Some(account_count) => (
            false,
            format!("新分组“{group_label}”当前包含 {account_count} 个账号，未自动删除。"),
        ),
        None => (
            false,
            format!("新分组“{group_label}”未返回账号数量，无法安全确认为空，未自动删除。"),
        ),
    }
}

fn selected_accounts_platform(account_ids: &[i64], accounts: &[Account]) -> Result<String, String> {
    let accounts_by_id = accounts
        .iter()
        .map(|account| (account.id, account))
        .collect::<HashMap<_, _>>();
    let mut source_platform: Option<String> = None;
    for account_id in account_ids {
        let account = accounts_by_id
            .get(account_id)
            .ok_or_else(|| format!("未找到账号（ID：{account_id}），请刷新后重试。"))?;
        let account_platform = normalize_platform(&account.platform);
        if account_platform.is_empty() {
            return Err(format!(
                "账号（ID：{account_id}）未返回平台信息，无法安全移动到分组。"
            ));
        }

        if let Some(expected_platform) = source_platform.as_deref() {
            if expected_platform != account_platform.as_str() {
                return Err(
                    "跨平台移动已阻止：选中的账号包含多个平台，请按平台分别移动。".to_owned(),
                );
            }
        } else {
            source_platform = Some(account_platform);
        }
    }

    source_platform.ok_or_else(|| "请至少选择一个账号。".to_owned())
}

fn validate_same_platform_group_move(
    source_platform: &str,
    group_id: i64,
    groups: &[AccountGroup],
) -> Result<(), String> {
    let target_group = groups
        .iter()
        .find(|group| group.id == group_id)
        .ok_or_else(|| format!("未找到当前平台的目标分组（ID：{group_id}）。"))?;
    let target_platform = normalize_platform(&target_group.platform);
    if target_platform.is_empty() {
        return Err("目标分组未返回平台信息，无法安全确认是否允许移动。".to_owned());
    }
    if source_platform != target_platform.as_str() {
        return Err(format!(
            "跨平台移动已阻止：选中账号的平台为“{source_platform}”，目标分组的平台为“{target_platform}”。"
        ));
    }

    Ok(())
}

fn normalize_platform(value: &str) -> String {
    value.trim().to_lowercase()
}

fn validate_platform(value: &str) -> Result<String, String> {
    let platform = normalize_platform(value);
    if platform.is_empty() {
        return Err("平台不能为空。".to_owned());
    }
    Ok(platform)
}

fn validate_group_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("请输入分组名称。".to_owned());
    }
    Ok(name.to_owned())
}

fn validate_priority(priority: i64) -> Result<(), String> {
    if priority < 0 {
        return Err("优先级必须是非负整数。".to_owned());
    }
    Ok(())
}

fn validate_account_concurrency(concurrency: i64) -> Result<(), String> {
    if concurrency < 0 {
        return Err("账号并发必须是非负整数。".to_owned());
    }
    Ok(())
}

fn validate_required_delete_statuses(
    required_statuses: Option<Vec<String>>,
) -> Result<Option<HashSet<String>>, String> {
    let Some(required_statuses) = required_statuses else {
        return Ok(None);
    };
    if required_statuses.is_empty() {
        return Err("受保护删除必须指定当前允许删除的账号状态。".to_owned());
    }

    let mut normalized = HashSet::new();
    for status in required_statuses {
        let status = status.trim().to_ascii_lowercase();
        if !matches!(status.as_str(), "error" | "inactive") {
            return Err("受保护删除只允许复核并删除当前仍为错误或停用的账号。".to_owned());
        }
        normalized.insert(status);
    }
    if normalized.is_empty() {
        return Err("受保护删除必须指定当前允许删除的账号状态。".to_owned());
    }
    Ok(Some(normalized))
}

fn guarded_delete_requires_unsupported_conditional_api(error: &str) -> bool {
    error.contains("未提供账号版本标识")
        || error.contains("未提供可用于条件删除的强版本标识")
}

fn guarded_delete_unsupported_message() -> String {
    "当前 Sub2API 服务器未提供受保护删除所需的账号版本标识，已停止执行且没有删除账号。请使用手动删除，或等待 Sub2API 支持 ETag 和 If-Match 条件删除后再启用自动化删除。".to_owned()
}

fn current_status_matches_delete_guard(status: &str, required_statuses: &HashSet<String>) -> bool {
    required_statuses.contains(&status.trim().to_ascii_lowercase())
}

fn evaluate_protected_delete_verification(
    verification: Result<Account, String>,
    required_statuses: &HashSet<String>,
) -> Result<(), String> {
    match verification {
        Ok(account) if current_status_matches_delete_guard(&account.status, required_statuses) => {
            Ok(())
        }
        Ok(account) => Err(delete_status_guard_rejection(&account.status)),
        Err(error) => Err(format!("无法复核当前账号状态，未删除：{error}")),
    }
}

fn delete_status_guard_rejection(status: &str) -> String {
    let status = status.trim();
    if status.is_empty() {
        "当前账号未返回可确认状态，未删除。".to_owned()
    } else {
        format!("当前账号状态为“{status}”，不满足受保护删除条件，未删除。")
    }
}

fn validate_rename_accounts(
    accounts: Vec<RenameAccountInput>,
) -> Result<Vec<RenameAccountInput>, String> {
    if accounts.is_empty() {
        return Err("请至少选择一个账号。".to_owned());
    }
    if accounts.len() > MAX_ACCOUNT_OPERATION_IDS {
        return Err(format!(
            "一次最多重命名 {MAX_ACCOUNT_OPERATION_IDS} 个账号，请缩小选择范围后重试。"
        ));
    }

    let mut account_ids = HashSet::new();
    let mut normalized = Vec::with_capacity(accounts.len());
    for account in accounts {
        if account.account_id <= 0 {
            return Err("账号 ID 必须是正整数。".to_owned());
        }
        if !account_ids.insert(account.account_id) {
            return Err("批量重命名中不能包含重复的账号 ID。".to_owned());
        }

        let name = account.name.trim();
        if name.is_empty() {
            return Err("账号名称不能为空。".to_owned());
        }

        normalized.push(RenameAccountInput {
            account_id: account.account_id,
            name: name.to_owned(),
        });
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::{
        batch_completion_status, current_status_matches_delete_guard,
        cancel_all_model_loads, cancel_model_load_request,
        evaluate_protected_delete_verification, finish_model_load, is_authentication_failure,
        guarded_delete_requires_unsupported_conditional_api, guarded_delete_unsupported_message,
        record_account_field_readback, validate_account_ids, validate_batch_test_model_id,
        validate_group_id, validate_group_name, validate_list_accounts_page,
        validate_model_account_ids, validate_model_load_request_id,
        validate_required_delete_statuses, register_model_load, AccountFieldReadback,
        BatchCompletionStatus, ListAccountsPageInput, MAX_ACCOUNT_OPERATION_IDS,
        MAX_MODEL_ACCOUNT_IDS, MODEL_LOOKUP_CONCURRENCY,
    };
    use crate::api::{Account, AccountOperationResult};
    use crate::state::{AppState, BatchCompletionRecord};
    use serde_json::json;

    fn account_with_fields(priority: Option<i64>, concurrency: Option<i64>) -> Account {
        serde_json::from_value(json!({
            "id": 7,
            "priority": priority,
            "concurrency": concurrency,
        }))
        .expect("minimal account payload")
    }

    fn account_with_status(status: &str) -> Account {
        serde_json::from_value(json!({
            "id": 7,
            "status": status,
        }))
        .expect("minimal account payload")
    }

    #[test]
    fn recognizes_authentication_statuses_without_matching_unrelated_messages() {
        assert!(is_authentication_failure("HTTP 401: expired token"));
        assert!(is_authentication_failure(
            "HTTP 403: token rejected [Sub2API code: 401]"
        ));
        assert!(!is_authentication_failure("HTTP 403: access denied"));
        assert!(!is_authentication_failure("HTTP 429: rate limited"));
        assert!(!is_authentication_failure("Server request failed: timeout"));
    }

    #[test]
    fn mutation_account_ids_must_be_positive_and_are_deduplicated() {
        assert_eq!(validate_account_ids(vec![42, 42, 99]), Ok(vec![42, 99]));
        assert!(validate_account_ids(Vec::new()).is_err());
        assert!(validate_account_ids(vec![42, 0]).is_err());
        assert!(validate_account_ids(vec![-1]).is_err());
        assert!(validate_account_ids(vec![1; MAX_ACCOUNT_OPERATION_IDS + 1]).is_err());
    }

    #[test]
    fn batch_tests_require_an_explicit_model() {
        assert_eq!(
            validate_batch_test_model_id(" model-a ".to_owned()),
            Ok("model-a".to_owned())
        );
        assert!(validate_batch_test_model_id(" \t ".to_owned()).is_err());
    }

    #[test]
    fn model_metadata_accepts_a_large_explicit_scope_with_a_hard_cap() {
        assert_eq!(MAX_MODEL_ACCOUNT_IDS, 1_000_000);
        assert_eq!(MODEL_LOOKUP_CONCURRENCY, 16);
        assert_eq!(validate_model_account_ids(vec![7, 7, 9]), Ok(vec![7, 9]));
        assert_eq!(validate_model_account_ids(Vec::new()), Ok(Vec::new()));
        assert!(validate_model_account_ids(vec![1; MAX_MODEL_ACCOUNT_IDS + 1]).is_err());
        assert!(validate_model_account_ids(vec![0]).is_err());
    }

    #[test]
    fn model_load_request_ids_are_bounded_and_ascii_safe() {
        assert_eq!(
            validate_model_load_request_id(" model-catalog-7_2.1 ".to_owned()),
            Ok("model-catalog-7_2.1".to_owned())
        );
        assert!(validate_model_load_request_id(String::new()).is_err());
        assert!(validate_model_load_request_id("request/id".to_owned()).is_err());
        assert!(validate_model_load_request_id("x".repeat(129)).is_err());
    }

    #[tokio::test]
    async fn model_load_cancellation_stops_the_registered_request_and_cleans_up() {
        let state = AppState::default();
        let cancellation = register_model_load(&state, "model-catalog-1")
            .await
            .expect("first request registers");

        cancel_model_load_request(&state, "model-catalog-1").await;
        assert!(cancellation.is_cancelled());
        assert!(register_model_load(&state, "model-catalog-1").await.is_err());

        finish_model_load(&state, "model-catalog-1").await;
        assert!(state.model_loads.lock().await.is_empty());
        let next = register_model_load(&state, "model-catalog-1")
            .await
            .expect("completed request releases its request id");

        cancel_all_model_loads(&state).await;
        assert!(next.is_cancelled());
        assert!(state.model_loads.lock().await.is_empty());
    }

    #[tokio::test]
    async fn completion_recovery_returns_a_final_record_once_the_run_is_inactive() {
        let state = AppState::default();
        state.completed_batches.lock().await.insert(
            "run-1".to_owned(),
            BatchCompletionRecord {
                succeeded: 2,
                failed: 1,
                cancelled: 3,
            },
        );

        assert_eq!(
            batch_completion_status(&state, "run-1").await,
            BatchCompletionStatus::Complete {
                succeeded: 2,
                failed: 1,
                cancelled: 3,
            }
        );
        assert_eq!(
            batch_completion_status(&state, "run-1").await,
            BatchCompletionStatus::Missing
        );
    }

    #[test]
    fn protected_deletion_only_accepts_current_error_or_inactive_statuses() {
        let required = validate_required_delete_statuses(Some(vec![
            "error".to_owned(),
            "inactive".to_owned(),
        ]))
        .expect("valid protected deletion statuses")
        .expect("protected status guard");
        assert!(current_status_matches_delete_guard("ERROR", &required));
        assert!(current_status_matches_delete_guard(" inactive ", &required));
        assert!(!current_status_matches_delete_guard("active", &required));
        assert!(!current_status_matches_delete_guard(
            "rate_limited",
            &required
        ));
        assert!(validate_required_delete_statuses(Some(vec!["active".to_owned()])).is_err());
        assert!(validate_required_delete_statuses(Some(Vec::new())).is_err());
        assert_eq!(validate_required_delete_statuses(None), Ok(None));
    }

    #[test]
    fn protected_deletion_stops_when_the_server_lacks_conditional_delete_support() {
        assert!(guarded_delete_requires_unsupported_conditional_api(
            "服务器未提供账号版本标识，已拒绝受保护删除。"
        ));
        assert!(guarded_delete_requires_unsupported_conditional_api(
            "服务器未提供可用于条件删除的强版本标识，已拒绝受保护删除。"
        ));
        assert!(!guarded_delete_requires_unsupported_conditional_api("HTTP 503: unavailable"));
        assert!(guarded_delete_unsupported_message().contains("没有删除账号"));
    }

    #[test]
    fn protected_deletion_skips_unverified_or_recovered_accounts() {
        let required = validate_required_delete_statuses(Some(vec!["error".to_owned()]))
            .expect("valid protected deletion status")
            .expect("protected status guard");

        assert_eq!(
            evaluate_protected_delete_verification(Ok(account_with_status(" ERROR ")), &required),
            Ok(())
        );
        assert_eq!(
            evaluate_protected_delete_verification(Ok(account_with_status("active")), &required),
            Err("当前账号状态为“active”，不满足受保护删除条件，未删除。".to_owned())
        );
        assert_eq!(
            evaluate_protected_delete_verification(
                Err("HTTP 503: unavailable".to_owned()),
                &required,
            ),
            Err("无法复核当前账号状态，未删除：HTTP 503: unavailable".to_owned())
        );
    }

    #[test]
    fn paged_account_list_uses_group_ids_and_official_sorting() {
        let (page, page_size, query) = validate_list_accounts_page(ListAccountsPageInput {
            page: Some(12),
            page_size: Some(200),
            platform: Some("openai".to_owned()),
            account_type: Some("oauth".to_owned()),
            status: Some("active".to_owned()),
            group_id: Some(7),
            ungrouped: false,
            search: Some("primary".to_owned()),
            privacy_mode: Some("training_off".to_owned()),
            sort_by: Some("last_used_at".to_owned()),
            sort_order: Some("desc".to_owned()),
        })
        .unwrap();

        assert_eq!(page, 12);
        assert_eq!(page_size, 200);
        assert_eq!(query.group.as_deref(), Some("7"));
        assert_eq!(query.sort_by.as_deref(), Some("last_used_at"));
        assert_eq!(query.sort_order.as_deref(), Some("desc"));
        assert!(validate_list_accounts_page(ListAccountsPageInput {
            page: Some(1),
            page_size: Some(20),
            platform: None,
            account_type: None,
            status: None,
            group_id: Some(7),
            ungrouped: true,
            search: None,
            privacy_mode: None,
            sort_by: Some("group_name".to_owned()),
            sort_order: None,
        })
        .is_err());
    }

    #[test]
    fn group_mutation_inputs_require_a_valid_id_and_name() {
        assert_eq!(validate_group_id(7), Ok(()));
        assert!(validate_group_id(0).is_err());
        assert_eq!(
            validate_group_name("  Batch test  "),
            Ok("Batch test".to_owned())
        );
        assert!(validate_group_name(" \n\t ").is_err());
    }

    #[test]
    fn field_readback_reports_only_exact_priority_and_concurrency_values_as_success() {
        let mut priority = AccountOperationResult::for_requested(&[7, 8]);
        record_account_field_readback(
            &mut priority,
            7,
            AccountFieldReadback::Priority(2),
            Some(Ok(account_with_fields(Some(2), Some(1)))),
        );
        record_account_field_readback(
            &mut priority,
            8,
            AccountFieldReadback::Priority(2),
            Some(Ok(account_with_fields(Some(1), Some(1)))),
        );

        assert_eq!(priority.success_ids, vec![7]);
        assert_eq!(priority.failed_ids, vec![8]);
        assert_eq!(priority.failed, 1);
        assert!(priority.results[1]
            .error
            .as_deref()
            .is_some_and(|message| message.contains("期望 2")));

        let mut concurrency = AccountOperationResult::for_requested(&[7, 8]);
        record_account_field_readback(
            &mut concurrency,
            7,
            AccountFieldReadback::Concurrency(10),
            Some(Ok(account_with_fields(Some(2), Some(10)))),
        );
        record_account_field_readback(
            &mut concurrency,
            8,
            AccountFieldReadback::Concurrency(10),
            Some(Err("HTTP 503: unavailable".to_owned())),
        );

        assert_eq!(concurrency.success_ids, vec![7]);
        assert_eq!(concurrency.failed_ids, vec![8]);
        assert!(concurrency.results[1]
            .error
            .as_deref()
            .is_some_and(|message| message.contains("无法复核")));
    }
}
