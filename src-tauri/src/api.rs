use crate::{
    models::RemoteModel,
    response::{envelope_error_code, format_envelope_error, unwrap_data},
    server_url::ServerUrl,
    sse::{http_status_from_text, parse_data_event, TestStreamEvent},
};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{
    header::{HeaderMap, ETAG, IF_MATCH},
    redirect::Policy,
    Client, RequestBuilder, Response,
};
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub email: String,
    #[serde(default)]
    pub role: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AuthTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_in: u64,
    pub user: User,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RefreshTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_in: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RefreshError {
    InvalidToken,
    Temporary,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TotpChallenge {
    pub temp_token: String,
    pub user_email_masked: String,
}

#[derive(Clone, Debug)]
pub enum LoginPayload {
    Authenticated(AuthTokens),
    TotpRequired(TotpChallenge),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub notes: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub priority: Option<i64>,
    #[serde(
        rename(deserialize = "rate_multiplier", serialize = "rateMultiplier"),
        alias = "rateMultiplier",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_f64"
    )]
    pub rate_multiplier: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub concurrency: Option<i64>,
    #[serde(
        rename(deserialize = "current_concurrency", serialize = "currentConcurrency"),
        alias = "currentConcurrency",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub current_concurrency: Option<i64>,
    #[serde(
        rename(deserialize = "load_factor", serialize = "loadFactor"),
        alias = "loadFactor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub load_factor: Option<i64>,
    #[serde(default)]
    pub platform: String,
    #[serde(
        rename(deserialize = "type", serialize = "accountType"),
        alias = "account_type",
        alias = "accountType",
        default
    )]
    pub account_type: String,
    #[serde(
        rename(deserialize = "plan_type", serialize = "planType"),
        alias = "planType",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub plan_type: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(
        rename(deserialize = "privacy_status", serialize = "privacyStatus"),
        alias = "privacyStatus",
        alias = "privacy",
        default,
        deserialize_with = "deserialize_optional_privacy_status"
    )]
    pub privacy_status: Option<String>,
    #[serde(
        rename(deserialize = "privacy_mode", serialize = "privacyMode"),
        alias = "privacyMode",
        default,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub privacy_mode: Option<String>,
    #[serde(
        rename(deserialize = "error_message", serialize = "errorMessage"),
        alias = "errorMessage",
        default
    )]
    pub error_message: Option<String>,
    #[serde(
        rename(deserialize = "proxy_id", serialize = "proxyId"),
        alias = "proxyId",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub proxy_id: Option<i64>,
    #[serde(
        rename(
            deserialize = "proxy_fallback_origin_name",
            serialize = "proxyFallbackOriginName"
        ),
        alias = "proxyFallbackOriginName",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub proxy_fallback_origin_name: Option<String>,
    #[serde(
        rename(deserialize = "proxy_name", serialize = "proxyName"),
        alias = "proxyName",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub proxy_name: Option<String>,
    #[serde(
        rename(deserialize = "proxy_expires_at", serialize = "proxyExpiresAt"),
        alias = "proxyExpiresAt",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub proxy_expires_at: Option<String>,
    #[serde(
        rename(deserialize = "scheduling_enabled", serialize = "schedulingEnabled"),
        alias = "schedulingEnabled",
        default,
        deserialize_with = "deserialize_optional_boolean"
    )]
    pub scheduling_enabled: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_optional_boolean")]
    pub schedulable: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_optional_boolean")]
    pub scheduling: Option<bool>,
    #[serde(
        rename(deserialize = "rate_limited_at", serialize = "rateLimitedAt"),
        alias = "rateLimitedAt",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub rate_limited_at: Option<String>,
    #[serde(
        rename(deserialize = "rate_limit_reset_at", serialize = "rateLimitResetAt"),
        alias = "rateLimitResetAt",
        default,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub rate_limit_reset_at: Option<String>,
    #[serde(
        rename(deserialize = "overload_until", serialize = "overloadUntil"),
        alias = "overloadUntil",
        default,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub overload_until: Option<String>,
    #[serde(
        rename(
            deserialize = "temp_unschedulable_until",
            serialize = "tempUnschedulableUntil"
        ),
        alias = "tempUnschedulableUntil",
        default,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub temp_unschedulable_until: Option<String>,
    #[serde(
        rename(
            deserialize = "temp_unschedulable_reason",
            serialize = "tempUnschedulableReason"
        ),
        alias = "tempUnschedulableReason",
        default,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub temp_unschedulable_reason: Option<String>,
    #[serde(
        rename(deserialize = "expires_at", serialize = "expiresAt"),
        alias = "expiresAt",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub expires_at: Option<i64>,
    #[serde(
        rename(
            deserialize = "auto_pause_on_expired",
            serialize = "autoPauseOnExpired"
        ),
        alias = "autoPauseOnExpired",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_boolean"
    )]
    pub auto_pause_on_expired: Option<bool>,
    #[serde(
        rename(deserialize = "group_name", serialize = "groupName"),
        alias = "groupName",
        default,
        deserialize_with = "deserialize_optional_group_name"
    )]
    pub group_name: Option<String>,
    #[serde(
        rename = "groupIds",
        alias = "group_ids",
        alias = "groupId",
        alias = "group_id",
        default,
        deserialize_with = "deserialize_group_ids"
    )]
    pub group_ids: Vec<i64>,
    #[serde(
        rename = "groupNames",
        alias = "group_names",
        default,
        deserialize_with = "deserialize_group_names"
    )]
    pub group_names: Vec<String>,
    #[serde(default, skip_serializing)]
    groups: Option<Value>,
    #[serde(default, skip_serializing)]
    group: Option<Value>,
    #[serde(default, skip_serializing)]
    extra: Option<Value>,
    #[serde(default, skip_serializing)]
    credentials: Option<Value>,
    #[serde(default, skip_serializing)]
    proxy: Option<Value>,
    #[serde(
        rename = "usageWindow",
        alias = "usage_window",
        default,
        deserialize_with = "deserialize_optional_usage_window"
    )]
    pub usage_window: Option<AccountUsageWindow>,
    #[serde(
        rename(deserialize = "current_window_cost", serialize = "currentWindowCost"),
        alias = "currentWindowCost",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_f64"
    )]
    pub current_window_cost: Option<f64>,
    #[serde(
        rename(deserialize = "active_sessions", serialize = "activeSessions"),
        alias = "activeSessions",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub active_sessions: Option<i64>,
    #[serde(
        rename(deserialize = "current_rpm", serialize = "currentRpm"),
        alias = "currentRpm",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i64"
    )]
    pub current_rpm: Option<i64>,
    #[serde(
        rename(deserialize = "session_window_start", serialize = "sessionWindowStart"),
        alias = "sessionWindowStart",
        default,
        skip_serializing,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    session_window_start: Option<String>,
    #[serde(
        rename(deserialize = "session_window_end", serialize = "sessionWindowEnd"),
        alias = "sessionWindowEnd",
        default,
        skip_serializing,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    session_window_end: Option<String>,
    #[serde(
        rename(
            deserialize = "session_window_status",
            serialize = "sessionWindowStatus"
        ),
        alias = "sessionWindowStatus",
        default,
        skip_serializing,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    session_window_status: Option<String>,
    #[serde(
        rename(deserialize = "last_used_at", serialize = "lastUsedAt"),
        alias = "lastUsedAt",
        default,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub last_used_at: Option<String>,
    #[serde(
        rename(deserialize = "created_at", serialize = "createdAt"),
        alias = "createdAt",
        default,
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub created_at: Option<String>,
    #[serde(
        rename(deserialize = "updated_at", serialize = "updatedAt"),
        alias = "updatedAt",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_scalar_string"
    )]
    pub updated_at: Option<String>,
}

/// Public account fields captured by the UI at selection time. Current
/// Sub2API backups deliberately omit source IDs, so these fields let the
/// client verify the selected scope without changing the official backup.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportAccountIdentity {
    pub id: i64,
    pub name: String,
    pub platform: String,
    pub account_type: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsageWindow {
    pub start: Option<String>,
    pub end: Option<String>,
    pub status: Option<String>,
}

fn deserialize_optional_boolean<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?.and_then(boolean_from_value))
}

fn deserialize_optional_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?.and_then(i64_from_value))
}

fn deserialize_optional_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?.and_then(f64_from_value))
}

fn boolean_from_value(value: Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(value),
        Value::Number(value) => value.as_i64().and_then(|value| match value {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        }),
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "enabled" | "active" | "yes" | "on" => Some(true),
            "false" | "0" | "disabled" | "inactive" | "no" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn i64_from_value(value: Value) -> Option<i64> {
    match value {
        Value::Number(value) => value.as_i64(),
        Value::String(value) => value.trim().parse().ok(),
        _ => None,
    }
}

fn f64_from_value(value: Value) -> Option<f64> {
    let value = match value {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.trim().parse().ok(),
        _ => None,
    }?;
    value.is_finite().then_some(value)
}

fn deserialize_optional_scalar_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?.and_then(scalar_string_from_value))
}

fn deserialize_optional_privacy_status<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?.and_then(privacy_status_from_value))
}

fn scalar_string_from_value(value: Value) -> Option<String> {
    let value = match value {
        Value::String(value) => value,
        Value::Number(value) => value.to_string(),
        _ => return None,
    };
    (!value.trim().is_empty()).then_some(value)
}

fn privacy_status_from_value(value: Value) -> Option<String> {
    let value = match value {
        Value::String(value) => value,
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        _ => return None,
    };
    (!value.trim().is_empty()).then_some(value)
}

fn deserialize_optional_group_name<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(
        Option::<Value>::deserialize(deserializer)?.and_then(|value| {
            let names = group_names_from_value(&value);
            (!names.is_empty()).then(|| names.join(", "))
        }),
    )
}

fn deserialize_group_names<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?
        .map(|value| group_names_from_value(&value))
        .unwrap_or_default())
}

fn group_names_from_value(value: &Value) -> Vec<String> {
    let mut names = Vec::new();
    append_group_names(value, &mut names);
    names
}

fn append_group_names(value: &Value, names: &mut Vec<String>) {
    match value {
        Value::String(name) => append_group_name(name, names),
        Value::Array(groups) => {
            for group in groups {
                append_group_names(group, names);
            }
        }
        Value::Object(group) => {
            for key in ["name", "group_name", "groupName"] {
                if let Some(name) = group.get(key).and_then(Value::as_str) {
                    append_group_name(name, names);
                    return;
                }
            }
            if let Some(nested_group) = group.get("group") {
                append_group_names(nested_group, names);
            }
        }
        _ => {}
    }
}

fn append_group_name(name: &str, names: &mut Vec<String>) {
    let name = name.trim();
    if !name.is_empty() && !names.iter().any(|existing| existing == name) {
        names.push(name.to_owned());
    }
}

fn deserialize_group_ids<'de, D>(deserializer: D) -> Result<Vec<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?
        .map(|value| group_ids_from_value(&value))
        .unwrap_or_default())
}

fn group_ids_from_value(value: &Value) -> Vec<i64> {
    let mut ids = Vec::new();
    append_group_ids(value, &mut ids);
    ids
}

/// Accept the small set of group containers used by compatible Sub2API
/// responses. Do not walk arbitrary object values: an unrelated nested `id`
/// must never become an account group ID.
fn append_group_ids(value: &Value, ids: &mut Vec<i64>) {
    match value {
        Value::Number(_) | Value::String(_) => append_group_id_value(value, ids),
        Value::Array(groups) => {
            for group in groups {
                append_group_ids(group, ids);
            }
        }
        Value::Object(group) => {
            for key in ["id", "group_id", "groupId", "group_ids", "groupIds"] {
                if let Some(value) = group.get(key) {
                    append_group_ids(value, ids);
                }
            }
            for key in ["group", "groups", "items", "data"] {
                if let Some(value) = group.get(key) {
                    append_group_ids(value, ids);
                }
            }
        }
        _ => {}
    }
}

fn append_group_id_value(value: &Value, ids: &mut Vec<i64>) {
    let id = match value {
        Value::Number(value) => value.as_i64(),
        Value::String(value) => value.trim().parse::<i64>().ok(),
        _ => None,
    };
    if let Some(id) = id {
        append_group_id(id, ids);
    }
}

fn append_group_id(id: i64, ids: &mut Vec<i64>) {
    if id > 0 && !ids.contains(&id) {
        ids.push(id);
    }
}

fn deserialize_optional_usage_window<'de, D>(
    deserializer: D,
) -> Result<Option<AccountUsageWindow>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?.and_then(usage_window_from_value))
}

fn usage_window_from_value(value: Value) -> Option<AccountUsageWindow> {
    let Value::Object(window) = value else {
        return None;
    };
    let read = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| window.get(*key).cloned().and_then(scalar_string_from_value))
    };
    let usage_window = AccountUsageWindow {
        start: read(&[
            "start",
            "window_start",
            "session_window_start",
            "sessionWindowStart",
        ]),
        end: read(&[
            "end",
            "window_end",
            "session_window_end",
            "sessionWindowEnd",
        ]),
        status: read(&[
            "status",
            "window_status",
            "session_window_status",
            "sessionWindowStatus",
        ]),
    };
    (usage_window.start.is_some() || usage_window.end.is_some() || usage_window.status.is_some())
        .then_some(usage_window)
}

impl Account {
    fn normalize_compatibility_fields(&mut self) {
        if self.privacy_mode.is_none() {
            self.privacy_mode = self
                .extra
                .as_ref()
                .and_then(|extra| extra.get("privacy_mode"))
                .cloned()
                .and_then(scalar_string_from_value);
        }

        if self.plan_type.is_none() {
            self.plan_type = self.credentials.as_ref().and_then(|credentials| {
                [
                    "plan_type",
                    "planType",
                    "chatgpt_plan_type",
                    "chatgptPlanType",
                ]
                .into_iter()
                .find_map(|key| {
                    credentials
                        .get(key)
                        .cloned()
                        .and_then(scalar_string_from_value)
                })
            });
        }

        let proxy_name = self
            .proxy
            .as_ref()
            .and_then(|proxy| proxy.get("name"))
            .cloned()
            .and_then(scalar_string_from_value);
        let proxy_expires_at = self
            .proxy
            .as_ref()
            .and_then(|proxy| proxy.get("expires_at"))
            .cloned()
            .and_then(scalar_string_from_value);
        if self.proxy_name.is_none() {
            self.proxy_name = proxy_name;
        }
        if self.proxy_expires_at.is_none() {
            self.proxy_expires_at = proxy_expires_at;
        }

        if let Some(groups) = self.groups.as_ref() {
            for name in group_names_from_value(groups) {
                append_group_name(&name, &mut self.group_names);
            }
            for id in group_ids_from_value(groups) {
                append_group_id(id, &mut self.group_ids);
            }
        }
        if let Some(group) = self.group.as_ref() {
            for name in group_names_from_value(group) {
                append_group_name(&name, &mut self.group_names);
            }
            for id in group_ids_from_value(group) {
                append_group_id(id, &mut self.group_ids);
            }
        }
        if let Some(group_name) = self.group_name.as_deref() {
            append_group_name(group_name, &mut self.group_names);
        }
        if self
            .group_name
            .as_deref()
            .is_none_or(|name| name.trim().is_empty())
            && !self.group_names.is_empty()
        {
            self.group_name = Some(self.group_names.join(", "));
        }

        let has_session_window = self.session_window_start.is_some()
            || self.session_window_end.is_some()
            || self.session_window_status.is_some();
        if !has_session_window {
            return;
        }

        let window = self
            .usage_window
            .get_or_insert_with(AccountUsageWindow::default);
        if window.start.is_none() {
            window.start = self.session_window_start.take();
        }
        if window.end.is_none() {
            window.end = self.session_window_end.take();
        }
        if window.status.is_none() {
            window.status = self.session_window_status.take();
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AccountPage {
    pub items: Vec<Account>,
    #[serde(default)]
    pub total: usize,
    #[serde(default)]
    pub page: usize,
    #[serde(
        rename(deserialize = "page_size", serialize = "pageSize"),
        alias = "pageSize",
        default
    )]
    pub page_size: usize,
    #[serde(default)]
    pub pages: usize,
    /// True when the server reports more pages than this client intentionally
    /// exposes in the page navigator.
    #[serde(default)]
    pub truncated: bool,
    /// Allows compatible servers that omit pagination metadata to expose one
    /// further page without the client making a full-list request.
    #[serde(
        rename(deserialize = "has_more", serialize = "hasMore"),
        alias = "hasMore",
        default
    )]
    pub has_more: bool,
}

/// Parameters supported by Sub2API's official `GET /admin/accounts` endpoint.
///
/// Group is either a positive group ID or the official `ungrouped` sentinel;
/// it intentionally is not a display-name filter.
#[derive(Clone, Debug, Default)]
pub struct AccountListQuery {
    pub platform: Option<String>,
    pub account_type: Option<String>,
    pub status: Option<String>,
    pub group: Option<String>,
    pub search: Option<String>,
    pub privacy_mode: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountGroup {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub status: String,
    #[serde(
        rename(deserialize = "account_count", serialize = "accountCount"),
        alias = "accountCount",
        default
    )]
    /// `None` means a compatible server omitted the count. Cleanup code must
    /// never treat an omitted count as proof that a newly created group is empty.
    pub account_count: Option<usize>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountOperationItem {
    #[serde(
        rename(deserialize = "account_id", serialize = "accountId"),
        alias = "accountId"
    )]
    pub account_id: i64,
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountOperationResult {
    #[serde(default)]
    pub total: usize,
    #[serde(default)]
    pub success: usize,
    #[serde(default)]
    pub failed: usize,
    #[serde(
        rename(deserialize = "success_ids", serialize = "successIds"),
        alias = "successIds",
        default
    )]
    pub success_ids: Vec<i64>,
    #[serde(
        rename(deserialize = "failed_ids", serialize = "failedIds"),
        alias = "failedIds",
        default
    )]
    pub failed_ids: Vec<i64>,
    #[serde(default)]
    pub results: Vec<AccountOperationItem>,
}

impl AccountOperationResult {
    pub fn for_requested(account_ids: &[i64]) -> Self {
        Self {
            total: account_ids.len(),
            ..Self::default()
        }
    }

    pub fn record_success(&mut self, account_id: i64) {
        self.success += 1;
        self.success_ids.push(account_id);
        self.results.push(AccountOperationItem {
            account_id,
            success: true,
            error: None,
        });
    }

    pub fn record_failure(&mut self, account_id: i64, error: String) {
        self.failed += 1;
        self.failed_ids.push(account_id);
        self.results.push(AccountOperationItem {
            account_id,
            success: false,
            error: Some(error),
        });
    }
}

/// Default page size for the compatibility `list_accounts` command.
pub const DEFAULT_ACCOUNT_PAGE_SIZE: usize = 20;
/// The UI offers 10, 20, 50, 100, and 200. Accepting other positive values up to
/// this ceiling keeps the backend compatible without allowing an oversized
/// server response to be materialized in one Tauri invocation.
pub const MAX_ACCOUNT_PAGE_SIZE: usize = 200;
/// A navigation bound, not an eager-fetch bound. At 200 rows/page it still
/// permits browsing up to 199,999,800 rows one page at a time.
pub const MAX_ACCOUNT_PAGE_NUMBER: usize = 999_999;
/// Keep the full, percent-encoded export URL below conservative reverse-proxy
/// limits. Batches are calculated from the actual endpoint URL rather than a
/// fixed number of IDs because account IDs and server base paths vary.
const MAX_EXPORT_URL_BYTES: usize = 1_800;
/// Keep direct API calls bounded too. Account pages are limited to 200 rows,
/// so a 16 MiB ceiling leaves generous room for normal account metadata while
/// rejecting a malformed compatible server before it exhausts the desktop
/// process.
const MAX_API_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
/// Authentication responses are small token payloads. Keep their cap much
/// lower than account pages so a malformed refresh endpoint cannot consume a
/// large amount of memory while the client is trying to recover a session.
const MAX_AUTH_RESPONSE_BYTES: usize = 256 * 1024;
/// Error text is only displayed to the user. Never retain an unbounded error
/// page merely to format an HTTP failure.
const MAX_ERROR_RESPONSE_BYTES: usize = 64 * 1024;
/// Export responses contain credentials. Bound a single response and the
/// aggregate before returning it over Tauri IPC so a compatible-but-broken
/// server cannot make the desktop process retain unbounded JSON in memory.
const MAX_EXPORT_CHUNK_BYTES: usize = 16 * 1024 * 1024;
const MAX_EXPORT_TOTAL_BYTES: usize = 128 * 1024 * 1024;
/// Matches the command-layer operation limit and prevents direct client
/// callers from constructing an unbounded collection of export URL batches.
const MAX_EXPORT_ACCOUNT_IDS: usize = 10_000;
/// A connection test only needs compact status events. Limit both a single
/// unfinished SSE event and the whole response before the SSE parser buffers
/// it in memory.
const MAX_TEST_SSE_EVENT_BYTES: usize = 256 * 1024;
const MAX_TEST_SSE_TOTAL_BYTES: usize = 4 * 1024 * 1024;

fn default_request_timeout() -> Duration {
    Duration::from_secs(90)
}

fn model_metadata_timeout() -> Duration {
    Duration::from_secs(15)
}

fn validate_account_page_request(page: usize, page_size: usize) -> Result<(), String> {
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
    Ok(())
}

fn page_count_from_total(total: usize, page_size: usize) -> usize {
    if total == 0 {
        0
    } else {
        total.saturating_add(page_size - 1) / page_size
    }
}

fn normalize_account_page(
    mut page: AccountPage,
    requested_page: usize,
    requested_page_size: usize,
) -> Result<AccountPage, String> {
    validate_account_page_request(requested_page, requested_page_size)?;

    if requested_page > 1 && page.page == 0 {
        return Err(format!(
            "账号列表未返回第 {requested_page} 页的页码，无法确认分页结果是否重复。请使用支持分页元数据的 Sub2API 服务。"
        ));
    }
    if page.page != 0 && page.page != requested_page {
        return Err(format!(
            "账号列表返回了错误的页码：请求第 {requested_page} 页，服务端返回第 {} 页。请刷新后重试。",
            page.page
        ));
    }

    let page_size = if page.page_size == 0 {
        requested_page_size
    } else {
        page.page_size
    };
    if page_size > MAX_ACCOUNT_PAGE_SIZE {
        return Err(format!(
            "服务端返回的每页账号数为 {page_size}，超过客户端允许的 {MAX_ACCOUNT_PAGE_SIZE}。"
        ));
    }
    if page.items.len() > page_size {
        return Err(format!(
            "账号列表第 {requested_page} 页返回了 {} 条记录，超过声明的每页 {page_size} 条。",
            page.items.len()
        ));
    }

    let mut ids = HashSet::with_capacity(page.items.len());
    for account in &page.items {
        if account.id <= 0 {
            return Err(format!(
                "账号列表第 {requested_page} 页包含无效账号 ID：{}。",
                account.id
            ));
        }
        if !ids.insert(account.id) {
            return Err(format!(
                "账号列表第 {requested_page} 页包含重复账号 ID：{}。请刷新后重试。",
                account.id
            ));
        }
    }

    let maximum_total = MAX_ACCOUNT_PAGE_NUMBER.saturating_mul(page_size);
    let reported_total = page.total;
    let reported_pages = page.pages;
    let inferred_pages = page_count_from_total(reported_total, page_size);
    if reported_pages > 0 && inferred_pages > 0 && reported_pages < inferred_pages {
        return Err(format!(
            "账号列表分页元数据不一致：服务端声明 {reported_pages} 页，但总数和每页数量至少需要 {inferred_pages} 页。"
        ));
    }
    let known_pages = reported_pages.max(inferred_pages);

    if known_pages > 0 && requested_page > known_pages {
        return Err(format!(
            "请求账号列表第 {requested_page} 页，但服务端只声明 {known_pages} 页。请刷新后重试。"
        ));
    }
    let minimum_total = requested_page
        .saturating_sub(1)
        .saturating_mul(page_size)
        .saturating_add(page.items.len());
    if reported_total > 0 && reported_total < minimum_total {
        return Err(format!(
            "账号列表总数为 {reported_total}，但第 {requested_page} 页已返回 {} 条记录，分页元数据不一致。",
            page.items.len()
        ));
    }

    // Older compatible servers sometimes omit `total` while still returning a
    // non-empty page. `usize` deserialization defaults that omission to zero,
    // so retain an honest lower bound rather than exposing visible accounts as
    // a zero-result list to the frontend.
    let minimum_total_from_pages = known_pages
        .saturating_sub(1)
        .saturating_mul(page_size)
        .saturating_add(if known_pages > 0 { 1 } else { 0 });
    // A metadata-less full page lets us safely expose one more page. The
    // reported total must then reflect that at least one record exists beyond
    // the current page; otherwise the navigator and the visible total disagree.
    let inferred_has_more = known_pages == 0
        && page.items.len() == page_size
        && requested_page < MAX_ACCOUNT_PAGE_NUMBER;
    let minimum_total_with_inferred_next_page = if inferred_has_more {
        requested_page
            .saturating_mul(page_size)
            .saturating_add(1)
    } else {
        0
    };
    let effective_total = reported_total
        .max(minimum_total)
        .max(minimum_total_from_pages)
        .max(minimum_total_with_inferred_next_page);

    let reaches_navigation_limit = requested_page == MAX_ACCOUNT_PAGE_NUMBER
        && known_pages == 0
        && page.items.len() == page_size;
    page.truncated = page.truncated
        || effective_total > maximum_total
        || known_pages > MAX_ACCOUNT_PAGE_NUMBER
        || reaches_navigation_limit;
    page.total = effective_total.min(maximum_total);
    page.pages = if known_pages > 0 {
        known_pages.min(MAX_ACCOUNT_PAGE_NUMBER)
    } else if page.items.is_empty() {
        // A metadata-less empty page after page one is the normal terminal
        // probe for an exact page-size multiple. Tell the frontend which
        // prior page is valid so it can reload it instead of displaying an
        // impossible range such as 21-20 of 20.
        requested_page.saturating_sub(1).max(1)
    } else if inferred_has_more {
        requested_page + 1
    } else {
        requested_page
    };
    page.has_more = if known_pages > 0 {
        requested_page < page.pages
    } else {
        inferred_has_more
    };
    page.page = requested_page;
    page.page_size = page_size;

    Ok(page)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestOutcome {
    pub success: bool,
    pub message: String,
    pub http_status: u16,
}

#[derive(Clone, Debug)]
pub struct TestFailure {
    pub message: String,
    pub http_status: Option<u16>,
}

impl TestFailure {
    fn from_message(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            http_status: http_status_from_text(&message),
            message,
        }
    }

    fn with_http_status(message: impl Into<String>, http_status: Option<u16>) -> Self {
        let message = message.into();
        Self {
            http_status: http_status.or_else(|| http_status_from_text(&message)),
            message,
        }
    }
}

/// Keep a transport timeout visible to the renderer even when reqwest's
/// top-level display text hides the underlying timeout source.
fn test_transport_failure_message(
    context: &str,
    timed_out: bool,
    error: impl std::fmt::Display,
) -> String {
    if timed_out {
        format!("{context} timed out")
    } else {
        format!("{context} failed: {error}")
    }
}

#[derive(Clone)]
pub struct Sub2ApiClient {
    server: ServerUrl,
    http: Client,
}

impl Sub2ApiClient {
    pub fn new(server: ServerUrl) -> Result<Self, String> {
        let http = Client::builder()
            .timeout(default_request_timeout())
            // Authentication-bearing requests must not follow a redirect to a
            // different or downgraded endpoint.
            .redirect(Policy::none())
            .build()
            .map_err(|error| format!("Could not create HTTP client: {error}"))?;
        Ok(Self { server, http })
    }

    pub fn endpoint(&self, path: &str) -> String {
        self.server.endpoint(path)
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<LoginPayload, String> {
        let value = self
            .request_value(
                self.http
                    .post(self.endpoint("auth/login"))
                    .json(&serde_json::json!({ "email": email, "password": password })),
            )
            .await?;
        parse_login_payload(value)
    }

    pub async fn complete_totp(
        &self,
        temp_token: &str,
        totp_code: &str,
    ) -> Result<AuthTokens, String> {
        self.request_data(self.http.post(self.endpoint("auth/login/2fa")).json(
            &serde_json::json!({
                "temp_token": temp_token,
                "totp_code": totp_code,
            }),
        ))
        .await
    }

    /// Completes Sub2API's separate step-up verification for the currently
    /// authenticated admin session. This is not the same as login 2FA: recent
    /// step-up verification is required by newer servers before exporting
    /// credential-bearing account backups.
    pub async fn complete_step_up_totp(
        &self,
        access_token: &str,
        code: &str,
    ) -> Result<(), String> {
        self.request_value(self.step_up_totp_request(access_token, code))
            .await
            .map(|_| ())
    }

    fn step_up_totp_request(&self, access_token: &str, code: &str) -> RequestBuilder {
        self.http
            .post(self.endpoint("user/totp/step-up"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({ "code": code }))
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<RefreshTokens, RefreshError> {
        let response = self
            .http
            .post(self.endpoint("auth/refresh"))
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await
            .map_err(|_| RefreshError::Temporary)?;
        let status = response.status();
        if !status.is_success() {
            return Err(if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                RefreshError::InvalidToken
            } else {
                RefreshError::Temporary
            });
        }

        let body = read_limited_response_body(
            response,
            MAX_AUTH_RESPONSE_BYTES,
            "登录刷新响应超过允许大小。",
        )
        .await
        .map_err(|_| RefreshError::Temporary)?;
        let value = serde_json::from_slice::<Value>(&body).map_err(|_| RefreshError::Temporary)?;
        let value = unwrap_data(value).map_err(|error| {
            if matches!(envelope_error_code(&error), Some(401) | Some(403)) {
                RefreshError::InvalidToken
            } else {
                RefreshError::Temporary
            }
        })?;
        parse_refresh_tokens(value).map_err(|_| RefreshError::Temporary)
    }

    pub async fn current_user(&self, access_token: &str) -> Result<User, String> {
        self.request_data(
            self.http
                .get(self.endpoint("auth/me"))
                .bearer_auth(access_token),
        )
        .await
    }

    pub async fn list_account_page(
        &self,
        access_token: &str,
        page: usize,
        page_size: usize,
        query: &AccountListQuery,
    ) -> Result<AccountPage, String> {
        validate_account_page_request(page, page_size)?;
        let value = self
            .request_value(self.list_account_page_request(access_token, page, page_size, query))
            .await?;
        normalize_account_page(parse_account_page(value)?, page, page_size)
    }

    fn list_account_page_request(
        &self,
        access_token: &str,
        page: usize,
        page_size: usize,
        query: &AccountListQuery,
    ) -> RequestBuilder {
        let mut request = self
            .http
            .get(self.endpoint("admin/accounts"))
            .bearer_auth(access_token)
            .query(&[
                ("page", page.to_string()),
                ("page_size", page_size.to_string()),
            ]);

        for (name, value) in [
            ("platform", query.platform.as_deref()),
            ("type", query.account_type.as_deref()),
            ("status", query.status.as_deref()),
            ("group", query.group.as_deref()),
            ("search", query.search.as_deref()),
            ("privacy_mode", query.privacy_mode.as_deref()),
            ("sort_by", query.sort_by.as_deref()),
            ("sort_order", query.sort_order.as_deref()),
        ] {
            if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
                request = request.query(&[(name, value)]);
            }
        }

        request
    }

    /// Uses the official per-account endpoint for operations that need fresh
    /// metadata about explicitly selected IDs. This intentionally avoids a
    /// full paginated account scan.
    pub async fn get_account(&self, access_token: &str, account_id: i64) -> Result<Account, String> {
        let mut account: Account = self
            .request_data(self.get_account_request(access_token, account_id))
            .await?;
        account.normalize_compatibility_fields();
        Ok(account)
    }

    /// Reads an account together with a strong HTTP entity tag. Guarded
    /// automation deletes require this server-side version precondition so a
    /// status check cannot silently race a later account update.
    pub async fn get_account_for_conditional_delete(
        &self,
        access_token: &str,
        account_id: i64,
    ) -> Result<(Account, String), String> {
        let (mut account, etag): (Account, String) = self
            .request_data_with_strong_etag(self.get_account_request(access_token, account_id))
            .await?;
        account.normalize_compatibility_fields();
        Ok((account, etag))
    }

    fn get_account_request(&self, access_token: &str, account_id: i64) -> RequestBuilder {
        self.http
            .get(self.endpoint(&format!("admin/accounts/{account_id}")))
            .bearer_auth(access_token)
    }

    pub async fn list_groups(&self, access_token: &str) -> Result<Vec<AccountGroup>, String> {
        self.request_data(self.list_groups_request(access_token))
            .await
    }

    fn list_groups_request(&self, access_token: &str) -> RequestBuilder {
        self.http
            .get(self.endpoint("admin/groups/all"))
            .bearer_auth(access_token)
    }

    /// Calls Sub2API's official platform-scoped group query.
    pub async fn list_groups_for_platform(
        &self,
        access_token: &str,
        platform: &str,
    ) -> Result<Vec<AccountGroup>, String> {
        self.request_data(self.list_groups_for_platform_request(access_token, platform))
            .await
    }

    fn list_groups_for_platform_request(
        &self,
        access_token: &str,
        platform: &str,
    ) -> RequestBuilder {
        self.http
            .get(self.endpoint("admin/groups/all"))
            .bearer_auth(access_token)
            .query(&[("platform", platform)])
    }

    pub async fn create_group(
        &self,
        access_token: &str,
        name: &str,
        platform: &str,
    ) -> Result<AccountGroup, String> {
        self.request_data(self.create_group_request(access_token, name, platform))
            .await
    }

    fn create_group_request(&self, access_token: &str, name: &str, platform: &str) -> RequestBuilder {
        self.http
            .post(self.endpoint("admin/groups"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({
                "name": name,
                "platform": platform,
                "rate_multiplier": 1.0,
            }))
    }

    /// Calls Sub2API's official per-group endpoint for a fresh group snapshot.
    pub async fn get_group(
        &self,
        access_token: &str,
        group_id: i64,
    ) -> Result<AccountGroup, String> {
        self.request_data(self.get_group_request(access_token, group_id))
            .await
    }

    fn get_group_request(&self, access_token: &str, group_id: i64) -> RequestBuilder {
        self.http
            .get(self.endpoint(&format!("admin/groups/{group_id}")))
            .bearer_auth(access_token)
    }

    /// Calls Sub2API's official group deletion endpoint.
    pub async fn delete_group(&self, access_token: &str, group_id: i64) -> Result<(), String> {
        self.request_value(self.delete_group_request(access_token, group_id))
            .await
            .map(|_| ())
    }

    fn delete_group_request(&self, access_token: &str, group_id: i64) -> RequestBuilder {
        self.http
            .delete(self.endpoint(&format!("admin/groups/{group_id}")))
            .bearer_auth(access_token)
    }

    pub async fn delete_account(&self, access_token: &str, account_id: i64) -> Result<(), String> {
        self.request_value(self.delete_account_request(access_token, account_id))
            .await
            .map(|_| ())
    }

    /// Uses the standard HTTP `If-Match` precondition captured from the
    /// status verification request. Servers that do not expose a strong ETag
    /// are intentionally not trusted for guarded automatic deletion.
    pub async fn delete_account_if_match(
        &self,
        access_token: &str,
        account_id: i64,
        etag: &str,
    ) -> Result<(), String> {
        self.request_value(self.delete_account_if_match_request(access_token, account_id, etag))
            .await
            .map(|_| ())
    }

    fn delete_account_request(&self, access_token: &str, account_id: i64) -> RequestBuilder {
        self.http
            .delete(self.endpoint(&format!("admin/accounts/{account_id}")))
            .bearer_auth(access_token)
    }

    fn delete_account_if_match_request(
        &self,
        access_token: &str,
        account_id: i64,
        etag: &str,
    ) -> RequestBuilder {
        self.delete_account_request(access_token, account_id)
            .header(IF_MATCH, etag)
    }

    /// Calls Sub2API's official `GET /admin/accounts/data` backup-export endpoint.
    pub async fn export_accounts_data(
        &self,
        access_token: &str,
        account_ids: &[i64],
        account_identities: &[ExportAccountIdentity],
        include_proxies: bool,
    ) -> Result<Value, String> {
        let account_ids = normalize_export_account_ids(account_ids)?;
        let account_identities =
            normalize_export_account_identities(&account_ids, account_identities)?;
        let batches = self.export_account_id_batches(&account_ids, include_proxies)?;
        let mut merged: Option<Value> = None;
        let mut received_bytes = 0usize;

        for account_ids in batches {
            let (payload, chunk_bytes) = self
                .export_accounts_data_chunk(access_token, &account_ids, include_proxies)
                .await?;
            received_bytes = received_bytes.checked_add(chunk_bytes).ok_or_else(|| {
                "账号导出数据大小溢出，已停止导出。".to_owned()
            })?;
            if received_bytes > MAX_EXPORT_TOTAL_BYTES {
                return Err(format!(
                    "账号导出数据超过 {} MB 上限，请缩小选择范围后重试。",
                    MAX_EXPORT_TOTAL_BYTES / (1024 * 1024)
                ));
            }
            validate_export_payload_shape(&payload)?;
            let requested_ids = account_ids.iter().copied().collect::<HashSet<_>>();
            validate_export_payload_selection(&payload, &requested_ids, &account_identities)?;

            if let Some(existing) = merged.as_mut() {
                merge_export_payload(existing, payload)?;
            } else {
                merged = Some(payload);
            }
        }

        merged.ok_or_else(|| "账号导出没有返回任何数据。".to_owned())
    }

    fn export_account_id_batches(
        &self,
        account_ids: &[i64],
        include_proxies: bool,
    ) -> Result<Vec<Vec<i64>>, String> {
        let mut batches = Vec::new();
        let mut batch = Vec::new();

        for account_id in account_ids {
            batch.push(*account_id);
            let url = self.export_accounts_data_url(&batch, include_proxies)?;
            if url.as_str().len() <= MAX_EXPORT_URL_BYTES {
                continue;
            }

            let Some(account_id) = batch.pop() else {
                return Err("账号导出分片为空，无法继续导出。".to_owned());
            };
            if batch.is_empty() {
                return Err(format!(
                    "账号导出 URL 超过 {} 字节上限，当前服务器地址或账号 ID 过长。",
                    MAX_EXPORT_URL_BYTES
                ));
            }
            batches.push(std::mem::take(&mut batch));
            batch.push(account_id);

            if self
                .export_accounts_data_url(&batch, include_proxies)?
                .as_str()
                .len()
                > MAX_EXPORT_URL_BYTES
            {
                return Err(format!(
                    "账号导出 URL 超过 {} 字节上限，当前服务器地址或账号 ID 过长。",
                    MAX_EXPORT_URL_BYTES
                ));
            }
        }

        if !batch.is_empty() {
            batches.push(batch);
        }
        Ok(batches)
    }

    async fn export_accounts_data_chunk(
        &self,
        access_token: &str,
        account_ids: &[i64],
        include_proxies: bool,
    ) -> Result<(Value, usize), String> {
        self.request_export_value(
            self.export_accounts_data_request(access_token, account_ids, include_proxies)?,
        )
        .await
    }

    fn export_accounts_data_request(
        &self,
        access_token: &str,
        account_ids: &[i64],
        include_proxies: bool,
    ) -> Result<RequestBuilder, String> {
        let url = self.export_accounts_data_url(account_ids, include_proxies)?;
        Ok(self.http.get(url).bearer_auth(access_token))
    }

    fn export_accounts_data_url(
        &self,
        account_ids: &[i64],
        include_proxies: bool,
    ) -> Result<Url, String> {
        let ids = account_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let mut url = Url::parse(&self.endpoint("admin/accounts/data"))
            .map_err(|error| format!("无法构建账号导出地址：{error}"))?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("ids", &ids);
            // The official endpoint includes related proxies by default; only
            // send this option when excluding them.
            if !include_proxies {
                query.append_pair("include_proxies", "false");
            }
        }

        Ok(url)
    }

    pub async fn move_accounts_to_group(
        &self,
        access_token: &str,
        account_ids: &[i64],
        group_id: i64,
    ) -> Result<AccountOperationResult, String> {
        let mut result: AccountOperationResult = self
            .request_data(self.move_accounts_to_group_request(access_token, account_ids, group_id))
            .await?;
        result.total = account_ids.len();
        Ok(result)
    }

    fn move_accounts_to_group_request(
        &self,
        access_token: &str,
        account_ids: &[i64],
        group_id: i64,
    ) -> RequestBuilder {
        self.http
            .post(self.endpoint("admin/accounts/bulk-update"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({
                "account_ids": account_ids,
                "group_ids": [group_id],
            }))
    }

    pub async fn set_accounts_priority(
        &self,
        access_token: &str,
        account_ids: &[i64],
        priority: i64,
    ) -> Result<AccountOperationResult, String> {
        let mut result: AccountOperationResult = self
            .request_data(self.set_accounts_priority_request(access_token, account_ids, priority))
            .await?;
        result.total = account_ids.len();
        Ok(result)
    }

    fn set_accounts_priority_request(
        &self,
        access_token: &str,
        account_ids: &[i64],
        priority: i64,
    ) -> RequestBuilder {
        self.http
            .post(self.endpoint("admin/accounts/bulk-update"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({
                "account_ids": account_ids,
                "priority": priority,
            }))
    }

    pub async fn set_accounts_concurrency(
        &self,
        access_token: &str,
        account_ids: &[i64],
        concurrency: i64,
    ) -> Result<AccountOperationResult, String> {
        let mut result: AccountOperationResult = self
            .request_data(self.set_accounts_concurrency_request(
                access_token,
                account_ids,
                concurrency,
            ))
            .await?;
        result.total = account_ids.len();
        Ok(result)
    }

    fn set_accounts_concurrency_request(
        &self,
        access_token: &str,
        account_ids: &[i64],
        concurrency: i64,
    ) -> RequestBuilder {
        self.http
            .post(self.endpoint("admin/accounts/bulk-update"))
            .bearer_auth(access_token)
            .json(&serde_json::json!({
                "account_ids": account_ids,
                "concurrency": concurrency,
            }))
    }

    pub async fn rename_account(
        &self,
        access_token: &str,
        account_id: i64,
        name: &str,
    ) -> Result<(), String> {
        self.request_value(self.rename_account_request(access_token, account_id, name))
            .await
            .map(|_| ())
    }

    fn rename_account_request(
        &self,
        access_token: &str,
        account_id: i64,
        name: &str,
    ) -> RequestBuilder {
        self.http
            .put(self.endpoint(&format!("admin/accounts/{account_id}")))
            .bearer_auth(access_token)
            .json(&serde_json::json!({ "name": name }))
    }

    pub async fn available_models(
        &self,
        access_token: &str,
        account_id: i64,
    ) -> Result<Vec<RemoteModel>, String> {
        self.request_data(self.model_metadata_request(access_token, account_id))
            .await
    }

    fn model_metadata_request(&self, access_token: &str, account_id: i64) -> RequestBuilder {
        self.http
            .get(self.endpoint(&format!("admin/accounts/{account_id}/models")))
            .bearer_auth(access_token)
            .timeout(model_metadata_timeout())
    }

    pub async fn test_account(
        &self,
        access_token: &str,
        account_id: i64,
        model_id: &str,
        cancellation: CancellationToken,
    ) -> Result<TestOutcome, TestFailure> {
        if cancellation.is_cancelled() {
            return Err(TestFailure::from_message("Test cancelled"));
        }
        let request = self.test_request(access_token, account_id, model_id).send();
        let response = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(TestFailure::from_message("Test cancelled")),
            response = request => response,
        }
        .map_err(|error| {
            let timed_out = error.is_timeout();
            TestFailure::from_message(test_transport_failure_message(
                "Test request",
                timed_out,
                error,
            ))
        })?;
        let http_status = response.status().as_u16();

        if !response.status().is_success() {
            let error = tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Err(TestFailure::from_message("Test cancelled")),
                error = response_error(response) => error,
            };
            return Err(TestFailure::from_message(error));
        }

        let mut byte_budget =
            SseByteBudget::new(MAX_TEST_SSE_EVENT_BYTES, MAX_TEST_SSE_TOTAL_BYTES);
        let limited_stream = response
            .bytes_stream()
            .map(move |chunk| -> Result<_, String> {
                let chunk = chunk.map_err(|error| {
                    let timed_out = error.is_timeout();
                    test_transport_failure_message("Test stream", timed_out, error)
                })?;
                byte_budget.observe(chunk.as_ref())?;
                Ok(chunk)
            });
        let mut stream = limited_stream.eventsource();
        loop {
            let next = tokio::select! {
                _ = cancellation.cancelled() => return Err(TestFailure::from_message("Test cancelled")),
                next = stream.next() => next,
            };
            let Some(next) = next else {
                break;
            };
            let event = next.map_err(|error| {
                TestFailure::from_message(format!("Test stream failed: {error}"))
            })?;
            let Some(event) = parse_data_event(&format!("data: {}", event.data))
                .map_err(TestFailure::from_message)?
            else {
                continue;
            };

            match event {
                TestStreamEvent::Complete { success: true, .. } => {
                    return Ok(TestOutcome {
                        success: true,
                        message: "Connection test completed".to_owned(),
                        http_status,
                    });
                }
                TestStreamEvent::Complete {
                    success: false,
                    error,
                    http_status,
                } => {
                    return Err(TestFailure::with_http_status(
                        error.unwrap_or_else(|| "Connection test failed".to_owned()),
                        http_status,
                    ));
                }
                TestStreamEvent::Error { error, http_status } => {
                    return Err(TestFailure::with_http_status(error, http_status));
                }
                _ => {}
            }
        }

        Err(TestFailure::from_message(
            "Test stream ended before reaching a final result",
        ))
    }

    fn test_request(&self, access_token: &str, account_id: i64, model_id: &str) -> RequestBuilder {
        self.http
            .post(self.endpoint(&format!("admin/accounts/{account_id}/test")))
            .bearer_auth(access_token)
            .json(&test_payload(model_id))
    }

    async fn request_data<T: DeserializeOwned>(
        &self,
        request: RequestBuilder,
    ) -> Result<T, String> {
        let value = self.request_value(request).await?;
        serde_json::from_value(value).map_err(|error| format!("Invalid server response: {error}"))
    }

    async fn request_data_with_strong_etag<T: DeserializeOwned>(
        &self,
        request: RequestBuilder,
    ) -> Result<(T, String), String> {
        let (value, etag) = self.request_value_with_strong_etag(request).await?;
        let value = serde_json::from_value(value)
            .map_err(|error| format!("Invalid server response: {error}"))?;
        Ok((value, etag))
    }

    async fn request_export_value(&self, request: RequestBuilder) -> Result<(Value, usize), String> {
        let response = request
            .send()
            .await
            .map_err(|error| format!("Server request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error(response).await);
        }
        let body = read_limited_response_body(
            response,
            MAX_EXPORT_CHUNK_BYTES,
            &format!(
                "单个账号导出响应超过 {} MB 上限，请缩小选择范围后重试。",
                MAX_EXPORT_CHUNK_BYTES / (1024 * 1024)
            ),
        )
        .await?;

        let received_bytes = body.len();
        let body = serde_json::from_slice::<Value>(&body)
            .map_err(|error| format!("Server returned invalid JSON: {error}"))?;
        Ok((unwrap_data(body)?, received_bytes))
    }

    async fn request_value(&self, request: RequestBuilder) -> Result<Value, String> {
        let response = request
            .send()
            .await
            .map_err(|error| format!("Server request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error(response).await);
        }

        let body = read_limited_response_body(
            response,
            MAX_API_RESPONSE_BYTES,
            &format!(
                "服务器响应超过 {} MB 上限，请缩小请求范围后重试。",
                MAX_API_RESPONSE_BYTES / (1024 * 1024)
            ),
        )
        .await?;
        let body = serde_json::from_slice::<Value>(&body)
            .map_err(|error| format!("Server returned invalid JSON: {error}"))?;
        unwrap_data(body)
    }

    async fn request_value_with_strong_etag(
        &self,
        request: RequestBuilder,
    ) -> Result<(Value, String), String> {
        let response = request
            .send()
            .await
            .map_err(|error| format!("Server request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error(response).await);
        }
        let etag = strong_etag(response.headers())?;
        let body = read_limited_response_body(
            response,
            MAX_API_RESPONSE_BYTES,
            &format!(
                "服务器响应超过 {} MB 上限，请缩小请求范围后重试。",
                MAX_API_RESPONSE_BYTES / (1024 * 1024)
            ),
        )
        .await?;
        let body = serde_json::from_slice::<Value>(&body)
            .map_err(|error| format!("Server returned invalid JSON: {error}"))?;
        Ok((unwrap_data(body)?, etag))
    }
}

fn strong_etag(headers: &HeaderMap) -> Result<String, String> {
    let etag = headers
        .get(ETAG)
        .ok_or_else(|| "服务器未提供账号版本标识，已拒绝受保护删除。".to_owned())?
        .to_str()
        .map_err(|_| "服务器返回了无效的账号版本标识，已拒绝受保护删除。".to_owned())?
        .trim();
    if etag.is_empty() || etag.eq_ignore_ascii_case("*") || etag.to_ascii_lowercase().starts_with("w/") {
        return Err("服务器未提供可用于条件删除的强版本标识，已拒绝受保护删除。".to_owned());
    }
    Ok(etag.to_owned())
}

async fn read_limited_response_body(
    response: Response,
    max_bytes: usize,
    size_error: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(size_error.to_owned());
    }

    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Server response stream failed: {error}"))?;
        let next_length = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| size_error.to_owned())?;
        if next_length > max_bytes {
            return Err(size_error.to_owned());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Appends one official `/admin/accounts/data` response to a prior response.
/// The caller merges each chunk immediately so it never retains all raw chunk
/// payloads at the same time.
fn merge_export_payload(merged: &mut Value, payload: Value) -> Result<(), String> {
    let Value::Object(merged) = merged else {
        return Err("服务器返回的首个账号导出数据不是对象，无法安全合并分批导出。".to_owned());
    };
    let Value::Object(payload) = payload else {
        return Err("服务器返回的账号导出数据不是对象，无法安全合并分批导出。".to_owned());
    };

    for (key, value) in payload {
        match key.as_str() {
            "accounts" => append_export_array(merged, "accounts", value)?,
            "proxies" => append_export_array(merged, "proxies", value)?,
            "skipped_shadows" => add_export_counter(merged, "skipped_shadows", value)?,
            // Every batch is a separately generated backup. Keeping the first
            // timestamp identifies the aggregate export without rejecting
            // requests that cross a second boundary.
            "exported_at" => {}
            _ => merge_export_metadata(merged, key, value)?,
        }
    }

    Ok(())
}

fn validate_export_payload_shape(payload: &Value) -> Result<(), String> {
    let object = payload
        .as_object()
        .ok_or_else(|| "服务器返回的账号导出数据不是对象。".to_owned())?;
    if !object.get("accounts").is_some_and(Value::is_array) {
        return Err("服务器返回的账号导出数据缺少 accounts 数组。".to_owned());
    }
    if object
        .get("proxies")
        .is_some_and(|value| !value.is_array())
    {
        return Err("服务器返回的账号导出数据中的 proxies 字段不是数组。".to_owned());
    }
    Ok(())
}

/// Verifies that the backup response only contains selected accounts. Older
/// compatible servers return a source `id` for every record. Current official
/// Sub2API backups intentionally omit IDs, so those records are checked
/// against the non-sensitive selection snapshot supplied by the UI.
fn validate_export_payload_selection(
    payload: &Value,
    requested_ids: &HashSet<i64>,
    account_identities: &HashMap<i64, ExportAccountIdentity>,
) -> Result<(), String> {
    let accounts = payload
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| "服务器返回的账号导出数据缺少 accounts 数组。".to_owned())?;

    let records_with_id = accounts
        .iter()
        .filter(|account| {
            account
                .as_object()
                .is_some_and(|object| object.contains_key("id"))
        })
        .count();

    if records_with_id == 0 {
        // An empty legacy response cannot prove an unexpected credential was
        // returned, so retain the former permissive behavior unless it uses
        // the official shadow-account marker.
        if accounts.is_empty()
            && !payload
                .as_object()
                .is_some_and(|object| object.contains_key("skipped_shadows"))
        {
            return Ok(());
        }
        return validate_idless_export_payload(payload, requested_ids, account_identities);
    }
    if records_with_id != accounts.len() {
        return Err(
            "服务器返回的账号导出结果混合了带 ID 和不带 ID 的记录，无法安全验证选择范围。"
                .to_owned(),
        );
    }

    let mut returned_ids = HashSet::with_capacity(accounts.len());

    for (index, account) in accounts.iter().enumerate() {
        let object = account.as_object().ok_or_else(|| {
            format!("服务器返回的账号导出记录 #{index} 不是对象，无法验证选择范围。")
        })?;
        let id = object
            .get("id")
            .expect("records_with_id only counts objects with IDs");
        let account_id = export_account_id(id)
            .filter(|account_id| *account_id > 0)
            .ok_or_else(|| {
                format!("服务器返回的账号导出记录 #{index} 的 ID 不是有效正整数。")
            })?;
        if !requested_ids.contains(&account_id) {
            return Err(format!(
                "服务器返回了未选择的账号 ID {account_id}，已停止导出以保护账号凭据。"
            ));
        }
        if !returned_ids.insert(account_id) {
            return Err(format!(
                "服务器在导出结果中重复返回账号 ID {account_id}，已停止生成可能损坏的备份。"
            ));
        }
    }

    Ok(())
}

/// Validates the current official `sub2api-data` account entry shape. The
/// upstream format is intentionally portable and therefore has no database
/// ID; matching all records one-to-one with the selected account snapshot
/// catches ignored `ids` filters without adding fields to the backup file.
fn validate_idless_export_payload(
    payload: &Value,
    requested_ids: &HashSet<i64>,
    account_identities: &HashMap<i64, ExportAccountIdentity>,
) -> Result<(), String> {
    if account_identities.len() != requested_ids.len()
        || requested_ids
            .iter()
            .any(|account_id| !account_identities.contains_key(account_id))
    {
        return Err(
            "当前 Sub2API 返回不含账号 ID 的官方备份格式，但所选账号快照不完整。请刷新账号列表后重新选择并导出。"
                .to_owned(),
        );
    }

    let accounts = payload
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| "服务器返回的账号导出数据缺少 accounts 数组。".to_owned())?;
    let skipped_shadows = export_skipped_shadows(payload)?;
    let returned_or_skipped = accounts
        .len()
        .checked_add(skipped_shadows)
        .ok_or_else(|| "账号导出记录计数溢出，已停止导出。".to_owned())?;
    if returned_or_skipped != requested_ids.len() {
        return Err(format!(
            "服务器返回的官方备份包含 {} 条账号和 {} 个跳过的影子账号，与本次选择的 {} 个账号不一致，已停止导出以保护未选择账号的凭据。",
            accounts.len(),
            skipped_shadows,
            requested_ids.len()
        ));
    }

    let mut expected = HashMap::<(String, String, String), usize>::new();
    for account_id in requested_ids {
        let identity = account_identities
            .get(account_id)
            .expect("selection snapshots were checked above");
        *expected
            .entry((
                identity.name.clone(),
                identity.platform.clone(),
                identity.account_type.clone(),
            ))
            .or_default() += 1;
    }

    for (index, account) in accounts.iter().enumerate() {
        let object = account.as_object().ok_or_else(|| {
            format!("服务器返回的账号导出记录 #{index} 不是对象，无法验证选择范围。")
        })?;
        let name = official_export_identity_field(object, "name", index)?;
        let platform = official_export_identity_field(object, "platform", index)?;
        let account_type = official_export_identity_field(object, "type", index)?;
        if !object.get("credentials").is_some_and(Value::is_object) {
            return Err(format!(
                "服务器返回的账号导出记录 #{index} 不符合官方备份格式（credentials 必须是对象）。"
            ));
        }

        let key = (
            name.to_owned(),
            platform.to_owned(),
            account_type.to_owned(),
        );
        let Some(remaining) = expected.get_mut(&key) else {
            return Err(format!(
                "服务器返回了不属于本次选择的账号“{name}”（{platform}/{account_type}），已停止导出以保护账号凭据。"
            ));
        };
        if *remaining == 0 {
            return Err(format!(
                "服务器在导出结果中重复返回账号“{name}”（{platform}/{account_type}），已停止生成可能损坏的备份。"
            ));
        }
        *remaining -= 1;
    }

    Ok(())
}

fn official_export_identity_field<'a>(
    object: &'a serde_json::Map<String, Value>,
    field: &str,
    index: usize,
) -> Result<&'a str, String> {
    object.get(field).and_then(Value::as_str).ok_or_else(|| {
        format!("服务器返回的账号导出记录 #{index} 不符合官方备份格式（缺少字符串字段 {field}）。")
    })
}

fn export_skipped_shadows(payload: &Value) -> Result<usize, String> {
    let Some(value) = payload.get("skipped_shadows") else {
        return Ok(0);
    };
    let count = value
        .as_u64()
        .ok_or_else(|| "服务器返回的账号导出数据中的 skipped_shadows 不是非负整数。".to_owned())?;
    usize::try_from(count)
        .map_err(|_| "服务器返回的账号导出数据中的 skipped_shadows 超出本机范围。".to_owned())
}

#[derive(Debug)]
struct SseByteBudget {
    max_event_bytes: usize,
    max_total_bytes: usize,
    total_bytes: usize,
    event_bytes: usize,
    line_has_content: bool,
    previous_was_carriage_return: bool,
}

impl SseByteBudget {
    fn new(max_event_bytes: usize, max_total_bytes: usize) -> Self {
        Self {
            max_event_bytes,
            max_total_bytes,
            total_bytes: 0,
            event_bytes: 0,
            line_has_content: false,
            previous_was_carriage_return: false,
        }
    }

    fn observe(&mut self, bytes: &[u8]) -> Result<(), String> {
        for byte in bytes {
            self.total_bytes = self.total_bytes.checked_add(1).ok_or_else(|| {
                "连接测试 SSE 总字节计数溢出，已停止测试。".to_owned()
            })?;
            if self.total_bytes > self.max_total_bytes {
                return Err(format!(
                    "连接测试 SSE 总数据超过 {} MB 上限，已停止测试。",
                    self.max_total_bytes / (1024 * 1024)
                ));
            }

            self.event_bytes = self.event_bytes.checked_add(1).ok_or_else(|| {
                "连接测试 SSE 事件字节计数溢出，已停止测试。".to_owned()
            })?;
            if self.event_bytes > self.max_event_bytes {
                return Err(format!(
                    "连接测试 SSE 单条事件超过 {} KB 上限，已停止测试。",
                    self.max_event_bytes / 1024
                ));
            }

            match *byte {
                b'\r' => {
                    self.finish_line();
                    self.previous_was_carriage_return = true;
                }
                b'\n' if self.previous_was_carriage_return => {
                    self.previous_was_carriage_return = false;
                }
                b'\n' => self.finish_line(),
                _ => {
                    self.line_has_content = true;
                    self.previous_was_carriage_return = false;
                }
            }
        }
        Ok(())
    }

    fn finish_line(&mut self) {
        if !self.line_has_content {
            self.event_bytes = 0;
        }
        self.line_has_content = false;
    }
}

fn export_account_id(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_str()?.trim().parse::<i64>().ok())
}

fn normalize_export_account_ids(account_ids: &[i64]) -> Result<Vec<i64>, String> {
    if account_ids.is_empty() {
        return Err("请至少选择一个账号。".to_owned());
    }
    if account_ids.len() > MAX_EXPORT_ACCOUNT_IDS {
        return Err(format!(
            "一次最多导出 {MAX_EXPORT_ACCOUNT_IDS} 个账号，请缩小筛选范围后重试。"
        ));
    }

    let mut seen = HashSet::with_capacity(account_ids.len());
    let mut normalized = Vec::with_capacity(account_ids.len());
    for account_id in account_ids {
        if *account_id <= 0 {
            return Err("账号 ID 必须是正整数。".to_owned());
        }
        if seen.insert(*account_id) {
            normalized.push(*account_id);
        }
    }
    Ok(normalized)
}

fn normalize_export_account_identities(
    account_ids: &[i64],
    account_identities: &[ExportAccountIdentity],
) -> Result<HashMap<i64, ExportAccountIdentity>, String> {
    // Older callers can still use a server that returns per-record IDs. The
    // snapshot is required only when the server uses the new official format.
    if account_identities.is_empty() {
        return Ok(HashMap::new());
    }

    let requested_ids = account_ids.iter().copied().collect::<HashSet<_>>();
    let mut normalized = HashMap::with_capacity(account_identities.len());
    for identity in account_identities {
        if !requested_ids.contains(&identity.id) {
            return Err("账号导出快照包含未选择的账号 ID。".to_owned());
        }
        if normalized.insert(identity.id, identity.clone()).is_some() {
            return Err("账号导出快照包含重复的账号 ID。".to_owned());
        }
    }
    if normalized.len() != requested_ids.len() {
        return Err("账号导出快照不完整。请刷新账号列表后重新选择并导出。".to_owned());
    }
    Ok(normalized)
}

fn append_export_array(
    payload: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Value,
) -> Result<(), String> {
    let Value::Array(mut source) = value else {
        return Err(format!("账号导出字段 {key} 不是数组，无法安全合并分批导出。"));
    };

    let Some(target) = payload.get_mut(key) else {
        payload.insert(key.to_owned(), Value::Array(source));
        return Ok(());
    };
    let Value::Array(target) = target else {
        return Err(format!("账号导出字段 {key} 的格式在分批响应之间不一致。"));
    };

    if key == "proxies" {
        let mut known_proxy_keys = HashSet::new();
        for proxy in target.iter() {
            if let Some(proxy_key) = proxy
                .as_object()
                .and_then(|proxy| proxy.get("proxy_key"))
                .and_then(Value::as_str)
            {
                known_proxy_keys.insert(proxy_key.to_owned());
            }
        }
        source.retain(|proxy| {
            let Some(proxy_key) = proxy
                .as_object()
                .and_then(|proxy| proxy.get("proxy_key"))
                .and_then(Value::as_str)
            else {
                return true;
            };
            known_proxy_keys.insert(proxy_key.to_owned())
        });
    }

    target.append(&mut source);
    Ok(())
}

fn add_export_counter(
    payload: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Value,
) -> Result<(), String> {
    let increment = value
        .as_u64()
        .ok_or_else(|| format!("账号导出字段 {key} 不是非负整数，无法安全合并分批导出。"))?;
    let current = payload
        .get(key)
        .map(|value| {
            value
                .as_u64()
                .ok_or_else(|| format!("账号导出字段 {key} 的格式在分批响应之间不一致。"))
        })
        .transpose()?
        .unwrap_or(0);
    let total = current
        .checked_add(increment)
        .ok_or_else(|| "账号导出跳过计数溢出。".to_owned())?;
    payload.insert(key.to_owned(), Value::from(total));
    Ok(())
}

fn merge_export_metadata(
    payload: &mut serde_json::Map<String, Value>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let Some(existing) = payload.get(&key) else {
        payload.insert(key, value);
        return Ok(());
    };
    if existing != &value {
        return Err(format!(
            "账号导出字段 {key} 在分批响应之间不一致，已停止生成可能损坏的备份。"
        ));
    }
    Ok(())
}

async fn response_error(response: Response) -> String {
    let status = response.status();
    let text = match read_limited_response_body(
        response,
        MAX_ERROR_RESPONSE_BYTES,
        &format!(
            "服务器错误响应超过 {} KB 上限。",
            MAX_ERROR_RESPONSE_BYTES / 1024
        ),
    )
    .await
    {
        Ok(body) => String::from_utf8_lossy(&body).into_owned(),
        Err(error) => return format!("HTTP {}: {error}", status.as_u16()),
    };
    let response_value = serde_json::from_str::<Value>(&text).ok();
    let message = response_value
        .as_ref()
        .and_then(response_error_message)
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| "The server rejected the request".to_owned());
    let message = response_value
        .as_ref()
        .and_then(response_step_up_error_code)
        .map(|code| format!("{message} [Sub2API error: {code}]"))
        .unwrap_or(message);
    let envelope_code = response_value
        .as_ref()
        .and_then(|value| value.get("code"))
        .and_then(Value::as_i64)
        .filter(|code| *code != 0);
    let message = match envelope_code {
        Some(code) => format_envelope_error(code, &message),
        None => message,
    };
    format!("HTTP {}: {message}", status.as_u16())
}

fn response_error_message(value: &Value) -> Option<String> {
    value
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .or_else(|| {
            let error = value.get("error")?.as_object()?;
            let error_type = error.get("type").and_then(Value::as_str);
            let message = error.get("message").and_then(Value::as_str);

            match (error_type, message) {
                (Some(error_type), Some(message)) => Some(format!("{error_type}: {message}")),
                (Some(error_type), None) => Some(error_type.to_owned()),
                (None, Some(message)) => Some(message.to_owned()),
                (None, None) => None,
            }
        })
}

/// Newer Sub2API step-up responses carry a machine-readable `error` value.
/// Preserve it alongside the human message so the desktop UI can distinguish
/// an export verification prompt from an unrelated HTTP 403.
fn response_step_up_error_code(value: &Value) -> Option<&str> {
    value
        .get("error")
        .and_then(Value::as_str)
        .filter(|code| code.starts_with("STEP_UP_"))
}

pub fn parse_login_payload(value: Value) -> Result<LoginPayload, String> {
    if value
        .get("requires_2fa")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return serde_json::from_value(value)
            .map(LoginPayload::TotpRequired)
            .map_err(|error| format!("Invalid TOTP challenge: {error}"));
    }

    serde_json::from_value(value)
        .map(LoginPayload::Authenticated)
        .map_err(|error| format!("Invalid login response: {error}"))
}

pub fn parse_refresh_tokens(value: Value) -> Result<RefreshTokens, String> {
    serde_json::from_value(value).map_err(|error| format!("Invalid refresh response: {error}"))
}

pub fn parse_account_page(value: Value) -> Result<AccountPage, String> {
    let mut page: AccountPage =
        serde_json::from_value(value).map_err(|error| format!("Invalid account page: {error}"))?;
    for account in &mut page.items {
        account.normalize_compatibility_fields();
    }
    Ok(page)
}

pub fn test_payload(model_id: &str) -> Value {
    serde_json::json!({
        "model_id": model_id,
        "prompt": "",
        "mode": "default",
    })
}

#[cfg(test)]
mod tests {
    use super::{
        default_request_timeout, merge_export_payload, model_metadata_timeout,
        normalize_account_page, response_error_message, response_step_up_error_code, strong_etag,
        test_transport_failure_message, validate_account_page_request,
        validate_export_payload_selection, Account, AccountGroup, AccountListQuery,
        AccountOperationResult, AccountPage, ExportAccountIdentity, SseByteBudget, Sub2ApiClient,
        DEFAULT_ACCOUNT_PAGE_SIZE, MAX_ACCOUNT_PAGE_NUMBER, MAX_ACCOUNT_PAGE_SIZE,
        MAX_EXPORT_URL_BYTES,
    };
    use crate::server_url::ServerUrl;
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, ETAG, IF_MATCH};
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::time::Duration;

    fn client() -> Sub2ApiClient {
        Sub2ApiClient::new(ServerUrl::parse("https://example.test/api/v1").unwrap()).unwrap()
    }

    fn export_identities(
        entries: &[(i64, &str, &str, &str)],
    ) -> HashMap<i64, ExportAccountIdentity> {
        entries
            .iter()
            .map(|(id, name, platform, account_type)| {
                (
                    *id,
                    ExportAccountIdentity {
                        id: *id,
                        name: (*name).to_owned(),
                        platform: (*platform).to_owned(),
                        account_type: (*account_type).to_owned(),
                    },
                )
            })
            .collect()
    }

    fn account(id: i64, name: &str) -> Account {
        Account {
            id,
            name: name.to_owned(),
            notes: None,
            priority: None,
            rate_multiplier: None,
            concurrency: None,
            current_concurrency: None,
            load_factor: None,
            platform: String::new(),
            account_type: String::new(),
            plan_type: None,
            status: String::new(),
            privacy_status: None,
            privacy_mode: None,
            error_message: None,
            proxy_id: None,
            proxy_fallback_origin_name: None,
            proxy_name: None,
            proxy_expires_at: None,
            scheduling_enabled: None,
            schedulable: None,
            scheduling: None,
            rate_limited_at: None,
            rate_limit_reset_at: None,
            overload_until: None,
            temp_unschedulable_until: None,
            temp_unschedulable_reason: None,
            expires_at: None,
            auto_pause_on_expired: None,
            group_name: None,
            group_ids: Vec::new(),
            group_names: Vec::new(),
            groups: None,
            group: None,
            extra: None,
            credentials: None,
            proxy: None,
            usage_window: None,
            current_window_cost: None,
            active_sessions: None,
            current_rpm: None,
            session_window_start: None,
            session_window_end: None,
            session_window_status: None,
            last_used_at: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn keeps_a_structured_provider_error_type_in_the_message() {
        let value = serde_json::json!({
            "error": {
                "type": "usage_limit_reached",
                "message": "The usage limit has been reached"
            }
        });

        assert_eq!(
            response_error_message(&value),
            Some("usage_limit_reached: The usage limit has been reached".to_owned())
        );
    }

    #[test]
    fn preserves_step_up_error_codes_for_the_export_flow() {
        let value = json!({
            "error": "STEP_UP_REQUIRED",
            "message": "Recent two-factor verification is required"
        });

        assert_eq!(response_step_up_error_code(&value), Some("STEP_UP_REQUIRED"));
        assert_eq!(
            response_step_up_error_code(&json!({ "error": "FORBIDDEN" })),
            None
        );
    }

    #[test]
    fn uses_a_ninety_second_default_request_timeout() {
        assert_eq!(default_request_timeout(), Duration::from_secs(90));
    }

    #[test]
    fn preserves_test_transport_timeout_when_the_outer_error_text_is_generic() {
        assert_eq!(
            test_transport_failure_message(
                "Test stream",
                true,
                "error sending request for url (https://example.test)",
            ),
            "Test stream timed out"
        );
        assert_eq!(
            test_transport_failure_message("Test request", false, "connection reset"),
            "Test request failed: connection reset"
        );
    }

    #[test]
    fn model_metadata_request_has_a_short_request_timeout() {
        let request = client().model_metadata_request("token", 7).build().unwrap();

        assert_eq!(request.timeout().copied(), Some(model_metadata_timeout()));
    }

    #[test]
    fn test_request_inherits_the_client_default_timeout() {
        let request = client().test_request("token", 7, "gpt-5").build().unwrap();

        assert!(request.timeout().is_none());
    }

    #[test]
    fn guarded_deletion_requires_a_strong_entity_tag() {
        let mut headers = HeaderMap::new();
        assert!(strong_etag(&headers).is_err());

        headers.insert(ETAG, HeaderValue::from_static("W/\"stale\""));
        assert!(strong_etag(&headers).is_err());

        headers.insert(ETAG, HeaderValue::from_static("\"account-v7\""));
        assert_eq!(strong_etag(&headers), Ok("\"account-v7\"".to_owned()));
    }

    #[test]
    fn group_and_account_mutation_requests_match_the_upstream_admin_api() {
        let step_up = client().step_up_totp_request("token", "123456").build().unwrap();
        assert_eq!(step_up.method(), reqwest::Method::POST);
        assert_eq!(
            step_up.url().as_str(),
            "https://example.test/api/v1/user/totp/step-up"
        );
        assert_eq!(
            step_up.headers().get(AUTHORIZATION),
            Some(&HeaderValue::from_static("Bearer token"))
        );
        assert_eq!(
            serde_json::from_slice::<Value>(step_up.body().unwrap().as_bytes().unwrap())
                .unwrap(),
            json!({ "code": "123456" })
        );

        let list_groups = client().list_groups_request("token").build().unwrap();
        assert_eq!(list_groups.method(), reqwest::Method::GET);
        assert_eq!(
            list_groups.url().as_str(),
            "https://example.test/api/v1/admin/groups/all"
        );

        let create_group = client()
            .create_group_request("token", "Batch test", "openai")
            .build()
            .unwrap();
        assert_eq!(create_group.method(), reqwest::Method::POST);
        assert_eq!(
            create_group.url().as_str(),
            "https://example.test/api/v1/admin/groups"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(create_group.body().unwrap().as_bytes().unwrap())
                .unwrap(),
            serde_json::json!({
                "name": "Batch test",
                "platform": "openai",
                "rate_multiplier": 1.0,
            })
        );

        let get_group = client().get_group_request("token", 7).build().unwrap();
        assert_eq!(get_group.method(), reqwest::Method::GET);
        assert_eq!(
            get_group.url().as_str(),
            "https://example.test/api/v1/admin/groups/7"
        );

        let delete_group = client().delete_group_request("token", 7).build().unwrap();
        assert_eq!(delete_group.method(), reqwest::Method::DELETE);
        assert_eq!(
            delete_group.url().as_str(),
            "https://example.test/api/v1/admin/groups/7"
        );

        let delete_account = client()
            .delete_account_request("token", 42)
            .build()
            .unwrap();
        assert_eq!(delete_account.method(), reqwest::Method::DELETE);
        assert_eq!(
            delete_account.url().as_str(),
            "https://example.test/api/v1/admin/accounts/42"
        );

        let conditional_delete_account = client()
            .delete_account_if_match_request("token", 42, "\"account-v7\"")
            .build()
            .unwrap();
        assert_eq!(
            conditional_delete_account.headers().get(IF_MATCH),
            Some(&HeaderValue::from_static("\"account-v7\""))
        );

        let move_accounts = client()
            .move_accounts_to_group_request("token", &[42, 99], 7)
            .build()
            .unwrap();
        assert_eq!(move_accounts.method(), reqwest::Method::POST);
        assert_eq!(
            move_accounts.url().as_str(),
            "https://example.test/api/v1/admin/accounts/bulk-update"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(move_accounts.body().unwrap().as_bytes().unwrap())
                .unwrap(),
            serde_json::json!({ "account_ids": [42, 99], "group_ids": [7] })
        );

        let set_priority = client()
            .set_accounts_priority_request("token", &[42, 99], 2)
            .build()
            .unwrap();
        assert_eq!(set_priority.method(), reqwest::Method::POST);
        assert_eq!(
            set_priority.url().as_str(),
            "https://example.test/api/v1/admin/accounts/bulk-update"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(set_priority.body().unwrap().as_bytes().unwrap())
                .unwrap(),
            serde_json::json!({ "account_ids": [42, 99], "priority": 2 })
        );

        let set_concurrency = client()
            .set_accounts_concurrency_request("token", &[42, 99], 6)
            .build()
            .unwrap();
        assert_eq!(set_concurrency.method(), reqwest::Method::POST);
        assert_eq!(
            set_concurrency.url().as_str(),
            "https://example.test/api/v1/admin/accounts/bulk-update"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(set_concurrency.body().unwrap().as_bytes().unwrap())
                .unwrap(),
            serde_json::json!({ "account_ids": [42, 99], "concurrency": 6 })
        );
    }

    #[test]
    fn group_and_account_operation_dtos_accept_upstream_payloads() {
        let group: AccountGroup = serde_json::from_value(serde_json::json!({
            "id": 7,
            "name": "Batch test",
            "description": "Created locally",
            "platform": "openai",
            "status": "active",
            "account_count": 3
        }))
        .unwrap();
        assert_eq!(group.id, 7);
        assert_eq!(group.name, "Batch test");
        assert_eq!(group.account_count, Some(3));

        let group_without_count: AccountGroup = serde_json::from_value(serde_json::json!({
            "id": 8,
            "name": "Empty group"
        }))
        .unwrap();
        assert_eq!(group_without_count.account_count, None);

        let mut result: AccountOperationResult = serde_json::from_value(serde_json::json!({
            "success": 1,
            "failed": 1,
            "success_ids": [42],
            "failed_ids": [99],
            "results": [
                { "account_id": 42, "success": true },
                { "account_id": 99, "success": false, "error": "not found" }
            ]
        }))
        .unwrap();
        result.total = 2;

        assert_eq!(result.success_ids, [42]);
        assert_eq!(result.failed_ids, [99]);
        assert_eq!(result.results[1].error.as_deref(), Some("not found"));
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "total": 2,
                "success": 1,
                "failed": 1,
                "successIds": [42],
                "failedIds": [99],
                "results": [
                    { "accountId": 42, "success": true, "error": null },
                    { "accountId": 99, "success": false, "error": "not found" }
                ]
            })
        );
    }

    #[test]
    fn deletion_result_tracks_each_requested_account() {
        let mut result = AccountOperationResult::for_requested(&[42, 99]);
        result.record_success(42);
        result.record_failure(99, "not found".to_owned());

        assert_eq!(result.total, 2);
        assert_eq!(result.success, 1);
        assert_eq!(result.failed, 1);
        assert_eq!(result.success_ids, [42]);
        assert_eq!(result.failed_ids, [99]);
    }

    #[test]
    fn account_list_request_uses_official_server_side_filters_and_sorting() {
        let request = client()
            .list_account_page_request(
                "token",
                2,
                50,
                &AccountListQuery {
                    platform: Some("openai".to_owned()),
                    account_type: Some("oauth".to_owned()),
                    status: Some("active".to_owned()),
                    group: Some("17".to_owned()),
                    search: Some("primary".to_owned()),
                    privacy_mode: Some("training_off".to_owned()),
                    sort_by: Some("created_at".to_owned()),
                    sort_order: Some("desc".to_owned()),
                },
            )
            .build()
            .unwrap();

        let query = request
            .url()
            .query_pairs()
            .into_owned()
            .collect::<HashMap<_, _>>();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(query.get("page"), Some(&"2".to_owned()));
        assert_eq!(query.get("page_size"), Some(&"50".to_owned()));
        assert_eq!(query.get("platform"), Some(&"openai".to_owned()));
        assert_eq!(query.get("type"), Some(&"oauth".to_owned()));
        assert_eq!(query.get("status"), Some(&"active".to_owned()));
        assert_eq!(query.get("group"), Some(&"17".to_owned()));
        assert_eq!(query.get("search"), Some(&"primary".to_owned()));
        assert_eq!(query.get("privacy_mode"), Some(&"training_off".to_owned()));
        assert_eq!(query.get("sort_by"), Some(&"created_at".to_owned()));
        assert_eq!(query.get("sort_order"), Some(&"desc".to_owned()));
    }

    #[test]
    fn account_page_normalization_requires_metadata_after_the_first_page() {
        let error = normalize_account_page(
            AccountPage {
                items: vec![account(7, "First")],
                total: 0,
                page: 0,
                page_size: 0,
                pages: 0,
                truncated: false,
                has_more: false,
            },
            2,
            50,
        )
        .unwrap_err();

        assert!(error.contains("未返回"));
    }

    #[test]
    fn account_page_normalization_rejects_a_repeated_or_mismatched_server_page() {
        let error = normalize_account_page(
            AccountPage {
                items: vec![account(7, "First")],
                total: 2,
                page: 1,
                page_size: 1,
                pages: 2,
                truncated: false,
                has_more: false,
            },
            2,
            1,
        )
        .unwrap_err();

        assert!(error.contains("错误的页码"));
    }

    #[test]
    fn account_page_normalization_rejects_duplicate_account_ids() {
        let error = normalize_account_page(
            AccountPage {
                items: vec![account(7, "First"), account(7, "Repeated")],
                total: 2,
                page: 1,
                page_size: 2,
                pages: 1,
                truncated: false,
                has_more: false,
            },
            1,
            2,
        )
        .unwrap_err();

        assert!(error.contains("重复账号 ID"));
    }

    #[test]
    fn account_page_normalization_uses_a_nonzero_lower_bound_when_total_is_omitted() {
        let page = normalize_account_page(
            AccountPage {
                items: vec![account(7, "First")],
                total: 0,
                page: 1,
                page_size: 20,
                pages: 0,
                truncated: false,
                has_more: false,
            },
            1,
            20,
        )
        .unwrap();

        assert_eq!(page.total, 1);
        assert_eq!(page.pages, 1);
        assert!(!page.has_more);
    }

    #[test]
    fn account_page_request_limits_navigation_but_not_total_eager_loading() {
        assert!(validate_account_page_request(MAX_ACCOUNT_PAGE_NUMBER, MAX_ACCOUNT_PAGE_SIZE).is_ok());
        assert!(validate_account_page_request(MAX_ACCOUNT_PAGE_NUMBER + 1, 20).is_err());
        assert!(validate_account_page_request(1, MAX_ACCOUNT_PAGE_SIZE + 1).is_err());
        assert_eq!(DEFAULT_ACCOUNT_PAGE_SIZE, 20);
    }

    #[test]
    fn account_page_marks_excess_server_metadata_as_truncated() {
        let page = normalize_account_page(
            AccountPage {
                items: vec![account(7, "First")],
                total: MAX_ACCOUNT_PAGE_NUMBER.saturating_mul(20).saturating_add(1),
                page: 1,
                page_size: 20,
                pages: MAX_ACCOUNT_PAGE_NUMBER.saturating_add(1),
                truncated: false,
                has_more: false,
            },
            1,
            20,
        )
        .unwrap();

        assert!(page.truncated);
        assert_eq!(page.pages, MAX_ACCOUNT_PAGE_NUMBER);
    }

    #[test]
    fn export_requests_stay_on_the_official_get_endpoint_with_bounded_id_batches() {
        let account_ids = (1..=1_000).collect::<Vec<_>>();
        let batches = client().export_account_id_batches(&account_ids, false).unwrap();
        assert!(batches.len() > 1);
        let request = client()
            .export_accounts_data_request("token", &batches[0], false)
            .unwrap()
            .build()
            .unwrap();

        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().path(),
            "/api/v1/admin/accounts/data"
        );
        assert!(request.url().query_pairs().any(|(key, _)| key == "ids"));
        assert!(request
            .url()
            .query_pairs()
            .any(|(key, value)| key == "include_proxies" && value == "false"));
        assert!(request.url().as_str().len() <= MAX_EXPORT_URL_BYTES);
    }

    #[test]
    fn merge_export_payload_preserves_the_official_backup_shape() {
        let mut payload = json!({
            "type": "sub2api-data",
            "version": 1,
            "exported_at": "2026-07-14T00:00:00Z",
            "accounts": [{ "id": 1, "name": "First" }],
            "proxies": [{ "proxy_key": "one" }],
            "skipped_shadows": 1
        });
        merge_export_payload(
            &mut payload,
            json!({
                "type": "sub2api-data",
                "version": 1,
                "exported_at": "2026-07-14T00:00:01Z",
                "accounts": [{ "id": 2, "name": "Second" }],
                "proxies": [{ "proxy_key": "one" }, { "proxy_key": "two" }],
                "skipped_shadows": 2
            }),
        )
        .unwrap();

        assert_eq!(payload["accounts"].as_array().unwrap().len(), 2);
        assert_eq!(payload["proxies"].as_array().unwrap().len(), 2);
        assert_eq!(payload["skipped_shadows"], json!(3));
        assert_eq!(payload["exported_at"], json!("2026-07-14T00:00:00Z"));
    }

    #[test]
    fn export_payload_accepts_current_official_idless_records_with_selected_snapshots() {
        let requested = [7_i64].into_iter().collect();
        let identities = export_identities(&[(7, "Official backup record", "openai", "oauth")]);
        let official_payload = json!({
            "accounts": [{
                "name": "Official backup record",
                "platform": "openai",
                "type": "oauth",
                "credentials": { "access_token": "selected" }
            }]
        });
        let wrong_scope = json!({
            "accounts": [
                {
                    "name": "Unexpected account",
                    "platform": "openai",
                    "type": "oauth",
                    "credentials": { "access_token": "unexpected" }
                }
            ]
        });
        let ignored_selection = json!({
            "accounts": [
                { "name": "Official backup record", "platform": "openai", "type": "oauth", "credentials": {} },
                { "name": "Unexpected second", "platform": "openai", "type": "oauth", "credentials": {} }
            ]
        });
        let official_shadow = json!({ "accounts": [], "skipped_shadows": 1 });
        let unselected = json!({ "accounts": [{ "id": 8 }] });
        let duplicate = json!({ "accounts": [{ "id": 7 }, { "id": "7" }] });
        let invalid_id = json!({ "accounts": [{ "id": null }] });

        assert!(
            validate_export_payload_selection(&official_payload, &requested, &identities).is_ok()
        );
        assert!(
            validate_export_payload_selection(&official_shadow, &requested, &identities).is_ok()
        );
        assert!(validate_export_payload_selection(&wrong_scope, &requested, &identities).is_err());
        assert!(
            validate_export_payload_selection(&ignored_selection, &requested, &identities).is_err()
        );
        assert!(
            validate_export_payload_selection(&official_payload, &requested, &HashMap::new())
                .unwrap_err()
                .contains("账号快照不完整")
        );
        assert!(
            validate_export_payload_selection(&unselected, &requested, &HashMap::new()).is_err()
        );
        assert!(
            validate_export_payload_selection(&duplicate, &requested, &HashMap::new()).is_err()
        );
        assert!(
            validate_export_payload_selection(&invalid_id, &requested, &HashMap::new()).is_err()
        );
    }

    #[test]
    fn export_payload_rejects_mixed_id_and_idless_records() {
        let requested = [7_i64].into_iter().collect();
        let mixed_payload = json!({
            "accounts": [
                { "id": 7, "name": "Selected account" },
                {
                    "name": "Potentially unselected official backup record",
                    "platform": "openai",
                    "account_data": { "type": "oauth" }
                }
            ]
        });

        let error = validate_export_payload_selection(&mixed_payload, &requested, &HashMap::new())
            .unwrap_err();

        assert!(error.contains("混合了带 ID 和不带 ID"));
    }

    #[test]
    fn sse_byte_budget_resets_at_complete_event_boundaries() {
        let mut budget = SseByteBudget::new(16, 64);

        budget.observe(b"data: one\r\n\r\n").unwrap();
        budget.observe(b"data: two\n\n").unwrap();

        assert_eq!(budget.total_bytes, 24);
        assert_eq!(budget.event_bytes, 0);
    }

    #[test]
    fn sse_byte_budget_rejects_oversized_event_and_total_stream() {
        let mut event_budget = SseByteBudget::new(8, 64);
        let event_error = event_budget.observe(b"data: 123").unwrap_err();
        assert!(event_error.contains("单条事件"));

        let mut total_budget = SseByteBudget::new(64, 8);
        total_budget.observe(b"data: a\n").unwrap();
        let total_error = total_budget.observe(b"\n").unwrap_err();
        assert!(total_error.contains("总数据"));
    }

    #[test]
    fn account_page_serializes_has_more_as_camel_case() {
        let page = AccountPage {
            items: Vec::new(),
            total: 0,
            page: 1,
            page_size: 20,
            pages: 1,
            truncated: false,
            has_more: true,
        };

        let serialized = serde_json::to_value(page).unwrap();
        assert_eq!(serialized.get("hasMore"), Some(&json!(true)));
        assert!(serialized.get("has_more").is_none());
    }

    #[test]
    fn account_plan_type_prefers_nonempty_top_level_compatibility_values() {
        for (item, expected) in [
            (
                json!({
                    "id": 1,
                    "plan_type": "top-level-snake",
                    "credentials": {
                        "plan_type": "nested-snake",
                        "planType": "nested-camel",
                        "chatgpt_plan_type": "nested-chatgpt-snake",
                        "chatgptPlanType": "nested-chatgpt-camel"
                    }
                }),
                "top-level-snake",
            ),
            (
                json!({
                    "id": 2,
                    "planType": "top-level-camel",
                    "credentials": { "plan_type": "nested-snake" }
                }),
                "top-level-camel",
            ),
        ] {
            let page = super::parse_account_page(json!({ "items": [item] }))
                .expect("top-level plan type should parse");

            assert_eq!(page.items[0].plan_type.as_deref(), Some(expected));
        }
    }

    #[test]
    fn account_plan_type_reads_nested_credentials_aliases_in_order() {
        for (item, expected) in [
            (
                json!({
                    "id": 1,
                    "plan_type": "  ",
                    "credentials": {
                        "plan_type": { "invalid": true },
                        "planType": "credentials-camel",
                        "chatgpt_plan_type": "credentials-chatgpt-snake",
                        "chatgptPlanType": "credentials-chatgpt-camel"
                    }
                }),
                Some("credentials-camel"),
            ),
            (
                json!({
                    "id": 2,
                    "credentials": { "chatgpt_plan_type": "credentials-chatgpt-snake" }
                }),
                Some("credentials-chatgpt-snake"),
            ),
            (
                json!({
                    "id": 3,
                    "credentials": {
                        "chatgpt_plan_type": ["invalid"],
                        "chatgptPlanType": "credentials-chatgpt-camel"
                    }
                }),
                Some("credentials-chatgpt-camel"),
            ),
            (
                json!({
                    "id": 4,
                    "credentials": {
                        "plan_type": " ",
                        "planType": null,
                        "chatgpt_plan_type": ["invalid"],
                        "chatgptPlanType": { "invalid": true }
                    }
                }),
                None,
            ),
        ] {
            let page = super::parse_account_page(json!({ "items": [item] }))
                .expect("compatible nested plan type should not block the account list");

            assert_eq!(page.items[0].plan_type.as_deref(), expected);
        }
    }

    #[test]
    fn accepts_privacy_status_compatibility_aliases_and_serializes_camel_case() {
        for (field, value, expected) in [
            ("privacy_status", serde_json::json!("Privacy"), "Privacy"),
            ("privacyStatus", serde_json::json!(2), "2"),
            ("privacy", serde_json::json!(true), "true"),
        ] {
            let mut item = serde_json::json!({ "id": 1 });
            item.as_object_mut()
                .unwrap()
                .insert(field.to_owned(), value);

            let page = super::parse_account_page(serde_json::json!({ "items": [item] }))
                .expect("privacy compatibility value should not block the account list");
            let account = &page.items[0];

            assert_eq!(account.privacy_status.as_deref(), Some(expected));

            let serialized = serde_json::to_value(account).unwrap();
            assert_eq!(
                serialized.get("privacyStatus"),
                Some(&serde_json::json!(expected))
            );
            assert!(serialized.get("privacy_status").is_none());
        }
    }

    #[test]
    fn ignores_missing_or_non_scalar_privacy_status() {
        for item in [
            serde_json::json!({ "id": 1 }),
            serde_json::json!({ "id": 2, "privacy": { "state": "Private" } }),
            serde_json::json!({ "id": 3, "privacyStatus": ["Private"] }),
            serde_json::json!({ "id": 4, "privacy_status": null }),
        ] {
            let page = super::parse_account_page(serde_json::json!({ "items": [item] }))
                .expect("unsupported privacy data should not block the account list");

            assert_eq!(page.items[0].privacy_status, None);
        }
    }
}
