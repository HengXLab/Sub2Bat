use serde_json::json;
use sub2bat_lib::api::{parse_login_payload, parse_refresh_tokens, LoginPayload};

#[test]
fn parses_a_standard_token_login_payload() {
    let payload = parse_login_payload(json!({
        "access_token": "access-token-for-test",
        "refresh_token": "refresh-token-for-test",
        "expires_in": 3600,
        "token_type": "Bearer",
        "user": { "id": 7, "email": "admin@example.test", "role": "admin" }
    }))
    .unwrap();

    match payload {
        LoginPayload::Authenticated(tokens) => {
            assert_eq!(tokens.user.email, "admin@example.test");
            assert_eq!(tokens.expires_in, 3600);
        }
        LoginPayload::TotpRequired(_) => panic!("expected an authenticated payload"),
    }
}

#[test]
fn parses_a_totp_login_payload_without_tokens() {
    let payload = parse_login_payload(json!({
        "requires_2fa": true,
        "temp_token": "temporary-token-for-test",
        "user_email_masked": "a***@example.test"
    }))
    .unwrap();

    match payload {
        LoginPayload::TotpRequired(challenge) => {
            assert_eq!(challenge.user_email_masked, "a***@example.test");
        }
        LoginPayload::Authenticated(_) => panic!("expected a TOTP payload"),
    }
}

#[test]
fn parses_rotated_refresh_tokens_without_assuming_a_user_object() {
    let tokens = parse_refresh_tokens(json!({
        "access_token": "new-access-token-for-test",
        "refresh_token": "new-refresh-token-for-test",
        "expires_in": 3600,
        "token_type": "Bearer"
    }))
    .unwrap();

    assert_eq!(tokens.expires_in, 3600);
    assert_eq!(tokens.refresh_token, "new-refresh-token-for-test");
}

#[test]
fn parses_refresh_tokens_when_the_server_does_not_rotate_them() {
    let tokens = parse_refresh_tokens(json!({
        "access_token": "new-access-token-for-test",
        "expires_in": 3600
    }))
    .unwrap();

    assert_eq!(tokens.refresh_token, "");
}
