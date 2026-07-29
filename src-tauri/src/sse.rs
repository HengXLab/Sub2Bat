use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TestStreamEvent {
    Started {
        model: Option<String>,
    },
    Status {
        text: String,
    },
    Content {
        text: String,
    },
    Complete {
        success: bool,
        error: Option<String>,
        http_status: Option<u16>,
    },
    Error {
        error: String,
        http_status: Option<u16>,
    },
    Ignored,
}

#[derive(Deserialize)]
struct RawTestEvent {
    #[serde(rename = "type")]
    event_type: Option<String>,
    success: Option<bool>,
    error: Option<Value>,
    model: Option<String>,
    text: Option<String>,
    #[serde(default, alias = "httpStatus")]
    http_status: Option<Value>,
    #[serde(default, alias = "statusCode")]
    status_code: Option<Value>,
    #[serde(default, alias = "httpCode")]
    http_code: Option<Value>,
    #[serde(default, alias = "errorCode")]
    error_code: Option<Value>,
    #[serde(default)]
    code: Option<Value>,
    #[serde(default)]
    status: Option<Value>,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    response: Option<Value>,
    #[serde(default)]
    details: Option<Value>,
}

pub fn parse_data_event(line: &str) -> Result<Option<TestStreamEvent>, String> {
    let trimmed = line.trim();
    let Some(payload) = trimmed.strip_prefix("data:") else {
        return Ok(None);
    };

    let payload = payload.trim();
    if payload.is_empty() {
        return Ok(None);
    }

    if payload == "[DONE]" {
        return Ok(Some(TestStreamEvent::Ignored));
    }

    let event: RawTestEvent = match serde_json::from_str(payload) {
        Ok(event) => event,
        Err(_) => return Ok(Some(TestStreamEvent::Ignored)),
    };

    let Some(event_type) = event.event_type.as_deref() else {
        return Ok(Some(TestStreamEvent::Ignored));
    };

    let http_status = event_http_status(&event);
    let error = error_message(event.error.as_ref());

    let parsed = match event_type {
        "test_start" => TestStreamEvent::Started { model: event.model },
        "status" => TestStreamEvent::Status {
            text: event.text.unwrap_or_default(),
        },
        "content" => TestStreamEvent::Content {
            text: event.text.unwrap_or_default(),
        },
        "test_complete" => TestStreamEvent::Complete {
            success: event.success.unwrap_or(false),
            error,
            http_status,
        },
        "error" => TestStreamEvent::Error {
            error: error.unwrap_or_else(|| "Unknown test error".to_owned()),
            http_status,
        },
        _ => TestStreamEvent::Ignored,
    };

    Ok(Some(parsed))
}

/// Extracts an upstream HTTP status from Sub2API's current text errors and
/// from additive structured fields that newer server versions may emit.
pub fn http_status_from_text(text: &str) -> Option<u16> {
    let lower = text.to_ascii_lowercase();
    for marker in [
        "http status code",
        "http_status_code",
        "http-status-code",
        "http status",
        "http_status",
        "http-status",
        "httpstatus",
        "status code",
        "status_code",
        "status-code",
        "statuscode",
        "http code",
        "http_code",
        "http-code",
        "httpcode",
        "error code",
        "error_code",
        "error-code",
        "errorcode",
        "responded with",
        "returned",
        "http",
        "status",
        "code",
    ] {
        if let Some(status) = status_after_marker(&lower, marker) {
            return Some(status);
        }
    }

    status_in_parentheses(&lower)
}

fn event_http_status(event: &RawTestEvent) -> Option<u16> {
    [
        event.http_status.as_ref(),
        event.status_code.as_ref(),
        event.http_code.as_ref(),
        event.error_code.as_ref(),
        event.code.as_ref(),
        event.status.as_ref(),
        event.error.as_ref(),
        event.data.as_ref(),
        event.response.as_ref(),
        event.details.as_ref(),
    ]
    .into_iter()
    .flatten()
    .find_map(http_status_from_value)
}

fn http_status_from_value(value: &Value) -> Option<u16> {
    match value {
        Value::Number(number) => number
            .as_u64()
            .and_then(|number| u16::try_from(number).ok())
            .filter(|number| is_http_status(*number)),
        Value::String(text) => direct_http_status(text).or_else(|| http_status_from_text(text)),
        Value::Object(object) => {
            for key in [
                "http_status",
                "httpStatus",
                "http_code",
                "httpCode",
                "status_code",
                "statusCode",
                "status-code",
                "http-status",
                "error_code",
                "errorCode",
                "code",
                "status",
                "error",
                "response",
                "data",
                "details",
                "meta",
                "cause",
                "result",
            ] {
                if let Some(status) = object.get(key).and_then(http_status_from_value) {
                    return Some(status);
                }
            }
            None
        }
        Value::Array(values) => values.iter().find_map(http_status_from_value),
        _ => None,
    }
}

fn error_message(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(message) = value.as_str().map(str::trim).filter(|message| !message.is_empty()) {
        return Some(message.to_owned());
    }

    let Some(object) = value.as_object() else {
        return None;
    };
    for key in ["message", "error", "detail", "description", "reason"] {
        if let Some(message) = object
            .get(key)
            .and_then(|value| error_message(Some(value)))
            .filter(|message| !message.trim().is_empty())
        {
            return Some(message);
        }
    }

    let error_type = object.get("type").and_then(Value::as_str).map(str::trim);
    let code = object.get("code").and_then(Value::as_str).map(str::trim);
    match (error_type.filter(|value| !value.is_empty()), code.filter(|value| !value.is_empty())) {
        (Some(error_type), Some(code)) => Some(format!("{error_type}: {code}")),
        (Some(error_type), None) => Some(error_type.to_owned()),
        (None, Some(code)) => Some(code.to_owned()),
        (None, None) => None,
    }
}

fn status_after_marker(text: &str, marker: &str) -> Option<u16> {
    let mut offset = 0;
    while let Some(relative) = text[offset..].find(marker) {
        let start = offset + relative + marker.len();
        if let Some(status) = first_http_status(&text[start..]) {
            return Some(status);
        }
        offset = start;
    }
    None
}

fn status_in_parentheses(text: &str) -> Option<u16> {
    let bytes = text.as_bytes();
    for index in 0..bytes.len().saturating_sub(4) {
        if bytes[index] == b'('
            && bytes[index + 4] == b')'
            && bytes[index + 1..index + 4].iter().all(u8::is_ascii_digit)
        {
            if let Some(status) = parse_http_status(&text[index + 1..index + 4]) {
                return Some(status);
            }
        }
    }
    None
}

fn first_http_status(text: &str) -> Option<u16> {
    let bytes = text.as_bytes();
    for index in 0..bytes.len().saturating_sub(2) {
        let previous_is_digit = index > 0 && bytes[index - 1].is_ascii_digit();
        let next_is_digit = bytes
            .get(index + 3)
            .map_or(false, |byte| byte.is_ascii_digit());
        if bytes[index..index + 3].iter().all(u8::is_ascii_digit)
            && !previous_is_digit
            && !next_is_digit
        {
            if let Some(status) = parse_http_status(&text[index..index + 3]) {
                return Some(status);
            }
        }
    }
    None
}

fn direct_http_status(text: &str) -> Option<u16> {
    let value = text.trim();
    (value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| parse_http_status(value))
        .flatten()
}

fn parse_http_status(value: &str) -> Option<u16> {
    value.parse::<u16>().ok().filter(|value| is_http_status(*value))
}

fn is_http_status(value: u16) -> bool {
    (100..=599).contains(&value)
}
