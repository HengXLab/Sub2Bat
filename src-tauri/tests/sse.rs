use sub2bat_lib::sse::{parse_data_event, TestStreamEvent};

#[test]
fn parses_a_successful_test_completion_event() {
    let event = parse_data_event(r#"data: {"type":"test_complete","success":true}"#)
        .unwrap()
        .unwrap();

    assert_eq!(
        event,
        TestStreamEvent::Complete {
            success: true,
            error: None,
            http_status: None,
        }
    );
}

#[test]
fn parses_an_error_event_and_ignores_sse_comments() {
    assert_eq!(parse_data_event(": keep-alive").unwrap(), None);

    let event = parse_data_event("data: {\"type\":\"error\",\"error\":\"token expired\"}\r")
        .unwrap()
        .unwrap();

    assert_eq!(
        event,
        TestStreamEvent::Error {
            error: "token expired".to_owned(),
            http_status: None,
        }
    );
}

#[test]
fn preserves_sub2api_upstream_statuses_from_current_and_future_error_shapes() {
    let official_error = parse_data_event(
        r#"data: {"type":"error","error":"API returned 401: invalid access token"}"#,
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        official_error,
        TestStreamEvent::Error {
            error: "API returned 401: invalid access token".to_owned(),
            http_status: Some(401),
        }
    );

    let structured_error = parse_data_event(
        r#"data: {"type":"error","error":{"message":"rate limited","status_code":"429"}}"#,
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        structured_error,
        TestStreamEvent::Error {
            error: "rate limited".to_owned(),
            http_status: Some(429),
        }
    );

    let nested_error = parse_data_event(
        r#"data: {"type":"error","error":{"message":"gateway unavailable","response":{"status":502}}}"#,
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        nested_error,
        TestStreamEvent::Error {
            error: "gateway unavailable".to_owned(),
            http_status: Some(502),
        }
    );
}

#[test]
fn ignores_additive_test_stream_records() {
    for line in [
        "data: [DONE]",
        "data: not-json",
        r#"data: {"model":"gpt-4.1"}"#,
    ] {
        assert_eq!(parse_data_event(line), Ok(Some(TestStreamEvent::Ignored)));
    }
}
