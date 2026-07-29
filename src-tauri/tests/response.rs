use serde_json::json;
use sub2bat_lib::response::{envelope_error_code, unwrap_data};

#[test]
fn unwraps_a_success_envelope() {
    let data = unwrap_data(json!({
        "code": 0,
        "message": "success",
        "data": { "access_token": "masked-in-test" }
    }))
    .unwrap();

    assert_eq!(data["access_token"], "masked-in-test");
}

#[test]
fn returns_the_server_message_for_a_failed_envelope() {
    let error = unwrap_data(json!({
        "code": 401,
        "message": "Invalid email or password",
        "data": null
    }))
    .unwrap_err();

    assert_eq!(error, "Invalid email or password [Sub2API code: 401]");
    assert_eq!(envelope_error_code(&error), Some(401));
}
