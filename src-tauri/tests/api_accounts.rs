use serde_json::json;
use sub2bat_lib::api::{parse_account_page, test_payload};

#[test]
fn parses_an_account_page_from_the_unwrapped_response_data() {
    let page = parse_account_page(json!({
        "items": [{
            "id": 42,
            "name": "Primary OpenAI",
            "platform": "openai",
            "type": "oauth",
            "status": "active"
        }],
        "total": 1,
        "page": 1,
        "page_size": 100,
        "pages": 1
    }))
    .unwrap();

    assert_eq!(page.items[0].id, 42);
    assert_eq!(page.items[0].account_type, "oauth");
    assert_eq!(page.pages, 1);
}

#[test]
fn maps_sub2api_account_table_fields_to_the_frontend_shape() {
    let page = parse_account_page(json!({
        "items": [{
            "id": 42,
            "name": "Primary OpenAI",
            "platform": "openai",
            "type": "oauth",
            "status": "active",
            "schedulable": true,
            "rate_limit_reset_at": "2026-07-13T02:00:00Z",
            "overload_until": 1_784_102_400,
            "temp_unschedulable_until": "2026-07-13T03:00:00Z",
            "temp_unschedulable_reason": "upstream overload",
            "privacy_mode": "training_set_cf_blocked",
            "extra": { "privacy_mode": "training_off" },
            "group_ids": [7, "8", 0, -1, 7, 1.5],
            "groups": [
                { "id": 1, "name": "Production" },
                { "id": 2, "name": "Priority" },
                { "groupId": "2" },
                { "id": 0 }
            ],
            "group": { "group_id": 3 },
            "session_window_start": "2026-07-13T00:00:00Z",
            "session_window_end": "2026-07-13T05:00:00Z",
            "session_window_status": "active",
            "last_used_at": "2026-07-13T01:23:45Z",
            "created_at": "2026-01-01T00:00:00Z"
        }]
    }))
    .unwrap();

    let item = &page.items[0];
    assert_eq!(item.schedulable, Some(true));
    assert_eq!(item.scheduling_enabled, None);
    assert_eq!(
        item.rate_limit_reset_at.as_deref(),
        Some("2026-07-13T02:00:00Z")
    );
    assert_eq!(item.overload_until.as_deref(), Some("1784102400"));
    assert_eq!(
        item.temp_unschedulable_until.as_deref(),
        Some("2026-07-13T03:00:00Z")
    );
    assert_eq!(
        item.temp_unschedulable_reason.as_deref(),
        Some("upstream overload")
    );
    assert_eq!(
        item.privacy_mode.as_deref(),
        Some("training_set_cf_blocked")
    );
    assert_eq!(item.group_name.as_deref(), Some("Production, Priority"));
    assert_eq!(item.group_ids, [7, 8, 1, 2, 3]);
    assert_eq!(item.group_names, ["Production", "Priority"]);
    assert_eq!(
        item.usage_window
            .as_ref()
            .and_then(|window| window.start.as_deref()),
        Some("2026-07-13T00:00:00Z")
    );
    assert_eq!(
        item.usage_window
            .as_ref()
            .and_then(|window| window.end.as_deref()),
        Some("2026-07-13T05:00:00Z")
    );
    assert_eq!(
        item.usage_window
            .as_ref()
            .and_then(|window| window.status.as_deref()),
        Some("active")
    );
    assert_eq!(item.last_used_at.as_deref(), Some("2026-07-13T01:23:45Z"));
    assert_eq!(item.created_at.as_deref(), Some("2026-01-01T00:00:00Z"));

    assert_eq!(
        serde_json::to_value(item).unwrap(),
        json!({
            "id": 42,
            "name": "Primary OpenAI",
            "platform": "openai",
            "accountType": "oauth",
            "status": "active",
            "privacyStatus": null,
            "privacyMode": "training_set_cf_blocked",
            "errorMessage": null,
            "schedulingEnabled": null,
            "schedulable": true,
            "scheduling": null,
            "rateLimitResetAt": "2026-07-13T02:00:00Z",
            "overloadUntil": "1784102400",
            "tempUnschedulableUntil": "2026-07-13T03:00:00Z",
            "tempUnschedulableReason": "upstream overload",
            "groupName": "Production, Priority",
            "groupIds": [7, 8, 1, 2, 3],
            "groupNames": ["Production", "Priority"],
            "usageWindow": {
                "start": "2026-07-13T00:00:00Z",
                "end": "2026-07-13T05:00:00Z",
                "status": "active"
            },
            "lastUsedAt": "2026-07-13T01:23:45Z",
            "createdAt": "2026-01-01T00:00:00Z"
        })
    );
}

#[test]
fn accepts_camel_case_compatibility_fields_and_missing_optional_columns() {
    let page = parse_account_page(json!({
        "items": [
            {
                "id": 42,
                "name": "Fallback",
                "platform": "openai",
                "accountType": "oauth",
                "status": "active",
                "schedulingEnabled": "on",
                "scheduling": "disabled",
                "extra": { "privacy_mode": "training_off" },
                "groupIds": [4, "5", 0, -3, 4],
                "group": { "id": 6, "name": "Backup" },
                "usageWindow": { "start": "2026-07-13T00:00:00Z" },
                "lastUsedAt": null,
                "createdAt": "2026-01-01T00:00:00Z",
                "an_additive_server_field": { "ignored": true }
            },
            {
                "id": 43,
                "name": "Older server",
                "platform": "gemini",
                "type": "apikey",
                "status": "inactive",
                "scheduling_enabled": 1,
                "groupName": "Legacy group",
                "groups": [
                    { "name": "Legacy group" },
                    "Second group",
                    { "unrelated": true }
                ],
                "session_window_start": { "unexpected": true },
                "last_used_at": 1_784_099_025,
                "created_at": []
            }
        ]
    }))
    .unwrap();

    let fallback = &page.items[0];
    assert_eq!(fallback.account_type, "oauth");
    assert_eq!(fallback.scheduling_enabled, Some(true));
    assert_eq!(fallback.schedulable, None);
    assert_eq!(fallback.scheduling, Some(false));
    assert_eq!(fallback.privacy_mode.as_deref(), Some("training_off"));
    assert_eq!(fallback.group_name.as_deref(), Some("Backup"));
    assert_eq!(fallback.group_ids, [4, 5, 6]);
    assert_eq!(fallback.group_names, ["Backup"]);
    assert_eq!(fallback.last_used_at, None);

    let older_server = &page.items[1];
    assert_eq!(older_server.scheduling_enabled, Some(true));
    assert_eq!(older_server.schedulable, None);
    assert_eq!(older_server.group_name.as_deref(), Some("Legacy group"));
    assert_eq!(older_server.group_names, ["Legacy group", "Second group"]);
    assert_eq!(older_server.usage_window, None);
    assert_eq!(older_server.last_used_at.as_deref(), Some("1784099025"));
    assert_eq!(older_server.created_at, None);
    assert_eq!(older_server.rate_limit_reset_at, None);
    assert_eq!(older_server.overload_until, None);
    assert_eq!(older_server.temp_unschedulable_until, None);
    assert_eq!(older_server.temp_unschedulable_reason, None);
    assert_eq!(older_server.privacy_mode, None);
}

#[test]
fn builds_a_test_payload_that_explicitly_uses_the_selected_model() {
    assert_eq!(
        test_payload("gpt-5.6-terra"),
        json!({ "model_id": "gpt-5.6-terra", "prompt": "", "mode": "default" })
    );
}
