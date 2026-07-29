use crate::{api::AuthTokens, server_url::ServerUrl};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const SETTINGS_FILE: &str = "sub2api-batch-tester.json";
const PROFILE_KEY: &str = "lastProfile";
const VAULT_SERVICE: &str = "com.sub2api.batchtester";
pub const DEFAULT_CONCURRENCY: u8 = 10;
pub const DEFAULT_AUTO_REFRESH_SECONDS: u16 = 0;
const FALLBACK_ACCESS_TOKEN_REFRESH_SECONDS: u64 = 15 * 60;

pub fn normalize_concurrency(concurrency: u8) -> u8 {
    match concurrency {
        5 | 10 | 20 | 50 | 100 => concurrency,
        _ => DEFAULT_CONCURRENCY,
    }
}

pub fn normalize_auto_refresh_seconds(auto_refresh_seconds: u16) -> u16 {
    match auto_refresh_seconds {
        0 | 5..=3600 => auto_refresh_seconds,
        _ => DEFAULT_AUTO_REFRESH_SECONDS,
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedProfile {
    pub profile_id: String,
    pub server_url: String,
    pub email: String,
    pub remember_login: bool,
    pub last_model_id: String,
    pub concurrency: u8,
    #[serde(default)]
    pub auto_refresh_seconds: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RestoreIntent {
    Refresh(String),
    ShowLogin,
}

pub fn restore_intent(profile: Option<SavedProfile>, has_refresh_token: bool) -> RestoreIntent {
    match profile {
        Some(profile) if profile.remember_login && has_refresh_token => {
            RestoreIntent::Refresh(profile.profile_id)
        }
        _ => RestoreIntent::ShowLogin,
    }
}

#[derive(Clone, Debug)]
pub struct ActiveSession {
    pub server: ServerUrl,
    pub tokens: AuthTokens,
    pub profile_id: String,
    pub remember_login: bool,
    /// Every installed session is tied to the authentication attempt that
    /// created it. Commands use this to reject results from a replaced session.
    pub generation: u64,
    /// Changes whenever this session receives a new access token. It is kept
    /// separate from `generation`: refreshing a token must not make an old
    /// request look like it belongs to the newly issued credentials.
    pub token_revision: u64,
    /// Cancels ordinary in-flight requests as soon as this session is replaced.
    pub cancellation: CancellationToken,
    refresh_at: Option<Instant>,
    /// A short shared backoff after a transient refresh error. This prevents a
    /// large number of concurrent commands from serially retrying refresh.
    refresh_retry_at: Option<Instant>,
}

impl ActiveSession {
    pub fn new(
        server: ServerUrl,
        tokens: AuthTokens,
        profile_id: String,
        remember_login: bool,
        generation: u64,
    ) -> Self {
        Self {
            server,
            refresh_at: refresh_deadline(tokens.expires_in, Instant::now()),
            tokens,
            profile_id,
            remember_login,
            generation,
            token_revision: 1,
            cancellation: CancellationToken::new(),
            refresh_retry_at: None,
        }
    }

    pub fn view(&self) -> SessionView {
        SessionView {
            server_url: self.server.base().to_owned(),
            email: self.tokens.user.email.clone(),
            role: self.tokens.user.role.clone(),
        }
    }

    pub fn needs_refresh_at(&self, now: Instant) -> bool {
        self.refresh_at.is_some_and(|refresh_at| now >= refresh_at)
            && self
                .refresh_retry_at
                .map(|retry_at| now >= retry_at)
                .unwrap_or(true)
    }

    pub fn needs_refresh(&self) -> bool {
        self.needs_refresh_at(Instant::now())
    }

    pub fn refresh_retry_pending(&self) -> bool {
        self.refresh_retry_at
            .map(|retry_at| Instant::now() < retry_at)
            .unwrap_or(false)
    }

    pub fn refresh_delay(&self) -> Option<Duration> {
        self.refresh_at
            .map(|refresh_at| refresh_at.saturating_duration_since(Instant::now()))
    }

    pub fn with_refreshed_tokens(&self, tokens: AuthTokens) -> Self {
        self.with_refreshed_tokens_and_remember_login(tokens, self.remember_login)
    }

    pub fn with_refreshed_tokens_and_remember_login(
        &self,
        tokens: AuthTokens,
        remember_login: bool,
    ) -> Self {
        Self {
            server: self.server.clone(),
            refresh_at: refresh_deadline(tokens.expires_in, Instant::now()),
            tokens,
            profile_id: self.profile_id.clone(),
            remember_login,
            generation: self.generation,
            token_revision: self.token_revision.saturating_add(1),
            // Requests issued with the old access token must not be allowed to
            // invalidate or mutate the refreshed session after they complete.
            cancellation: CancellationToken::new(),
            refresh_retry_at: None,
        }
    }

    pub fn with_refresh_retry_after(&self, delay: Duration) -> Self {
        let mut deferred = self.clone();
        deferred.refresh_retry_at = Instant::now().checked_add(delay);
        deferred
    }

    pub fn cancel(&self) {
        self.cancellation.cancel();
    }
}

fn refresh_deadline(expires_in: u64, now: Instant) -> Option<Instant> {
    if expires_in == 0 {
        // Older compatible servers may omit expires_in. Refresh conservatively
        // instead of letting a long-running client discover expiry via 401s.
        return now.checked_add(Duration::from_secs(
            FALLBACK_ACCESS_TOKEN_REFRESH_SECONDS,
        ));
    }

    // Refresh before expiry, but avoid immediately refreshing very short-lived
    // test tokens on every request. The grace period is at most one minute and
    // at most ten percent of the issued lifetime.
    let lifetime = Duration::from_secs(expires_in);
    let lead_seconds = (expires_in / 10)
        .clamp(1, 60)
        .min(expires_in.saturating_sub(1));
    let refresh_after = lifetime.saturating_sub(Duration::from_secs(lead_seconds));
    now.checked_add(refresh_after)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub server_url: String,
    pub email: String,
    pub role: String,
}

#[derive(Clone, Debug)]
pub struct PendingTotp {
    pub generation: u64,
    pub server: ServerUrl,
    pub email: String,
    pub remember_login: bool,
    pub temp_token: String,
}

pub fn profile_for_login(
    current: Option<SavedProfile>,
    server_url: String,
    email: String,
    remember_login: bool,
) -> SavedProfile {
    let reusable = current.filter(|profile| {
        profile.server_url == server_url && profile.email.eq_ignore_ascii_case(&email)
    });
    let profile_id = reusable
        .as_ref()
        .map(|profile| profile.profile_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    SavedProfile {
        profile_id,
        server_url,
        email,
        remember_login,
        last_model_id: reusable
            .as_ref()
            .map(|profile| profile.last_model_id.trim().to_owned())
            .unwrap_or_default(),
        concurrency: reusable
            .as_ref()
            .map(|profile| normalize_concurrency(profile.concurrency))
            .unwrap_or(DEFAULT_CONCURRENCY),
        auto_refresh_seconds: reusable
            .as_ref()
            .map(|profile| normalize_auto_refresh_seconds(profile.auto_refresh_seconds))
            .unwrap_or(DEFAULT_AUTO_REFRESH_SECONDS),
    }
}

pub fn load_profile(app: &AppHandle) -> Result<Option<SavedProfile>, String> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| format!("Could not open app settings: {error}"))?;
    store
        .get(PROFILE_KEY)
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("Could not read saved login settings: {error}"))
}

pub fn save_profile(app: &AppHandle, profile: &SavedProfile) -> Result<(), String> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| format!("Could not open app settings: {error}"))?;
    store.set(
        PROFILE_KEY,
        serde_json::to_value(profile)
            .map_err(|error| format!("Could not serialize app settings: {error}"))?,
    );
    store
        .save()
        .map_err(|error| format!("Could not save app settings: {error}"))
}

pub fn save_refresh_token(profile_id: &str, token: &str) -> Result<(), String> {
    vault_entry(profile_id)?
        .set_password(token)
        .map_err(|error| format!("Could not save remembered login: {error}"))
}

pub fn load_refresh_token(profile_id: &str) -> Result<Option<String>, String> {
    let entry = vault_entry(profile_id)?;
    match entry.get_password() {
        Ok(token) if !token.trim().is_empty() => Ok(Some(token)),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read remembered login: {error}")),
    }
}

pub fn delete_refresh_token(profile_id: &str) -> Result<(), String> {
    let entry = vault_entry(profile_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete remembered login: {error}")),
    }
}

fn vault_entry(profile_id: &str) -> Result<Entry, String> {
    Entry::new(VAULT_SERVICE, profile_id)
        .map_err(|error| format!("Could not access Windows Credential Manager: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{refresh_deadline, Duration, Instant, FALLBACK_ACCESS_TOKEN_REFRESH_SECONDS};

    #[test]
    fn schedules_known_token_refresh_before_expiry() {
        let now = Instant::now();
        let deadline = refresh_deadline(3_600, now).expect("known expiry has a deadline");

        assert!(deadline > now + Duration::from_secs(3_500));
        assert!(deadline < now + Duration::from_secs(3_600));
    }

    #[test]
    fn schedules_a_conservative_fallback_when_expiry_is_missing() {
        let now = Instant::now();
        let deadline = refresh_deadline(0, now).expect("fallback deadline is present");

        assert_eq!(
            deadline.duration_since(now),
            Duration::from_secs(FALLBACK_ACCESS_TOKEN_REFRESH_SECONDS)
        );
    }
}
