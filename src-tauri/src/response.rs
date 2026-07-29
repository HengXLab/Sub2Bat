use serde_json::Value;

const ENVELOPE_CODE_SUFFIX: &str = " [Sub2API code: ";

/// Keeps a failed official response-envelope code available to callers without
/// discarding the server's human-readable message. The suffix is intentionally
/// stable so authentication handling can distinguish a token failure from a
/// similarly worded permission error.
pub fn format_envelope_error(code: i64, message: &str) -> String {
    format!("{message}{ENVELOPE_CODE_SUFFIX}{code}]")
}

/// Returns a numeric official response-envelope code previously added by
/// `format_envelope_error`.
pub fn envelope_error_code(error: &str) -> Option<i64> {
    let (_, suffix) = error.rsplit_once(ENVELOPE_CODE_SUFFIX)?;
    suffix.strip_suffix(']')?.trim().parse().ok()
}

pub fn unwrap_data(value: Value) -> Result<Value, String> {
    let Some(object) = value.as_object() else {
        return Ok(value);
    };

    let code = object.get("code").and_then(Value::as_i64);
    if matches!(code, Some(code) if code != 0) {
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or("The server rejected the request")
            .to_owned();
        return Err(format_envelope_error(
            code.expect("non-zero envelope code was checked"),
            &message,
        ));
    }

    Ok(object.get("data").cloned().unwrap_or(value))
}
