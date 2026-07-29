use sub2bat_lib::{
    session::{
        profile_for_login, restore_intent, RestoreIntent, SavedProfile, DEFAULT_AUTO_REFRESH_SECONDS,
        DEFAULT_CONCURRENCY,
    },
};

fn profile(remember_login: bool) -> SavedProfile {
    SavedProfile {
        profile_id: "profile-1".to_owned(),
        server_url: "https://api.example.test".to_owned(),
        email: "admin@example.test".to_owned(),
        remember_login,
        last_model_id: "gpt-5.6-terra".to_owned(),
        concurrency: DEFAULT_CONCURRENCY,
        auto_refresh_seconds: DEFAULT_AUTO_REFRESH_SECONDS,
    }
}

#[test]
fn restores_only_when_the_saved_profile_and_refresh_token_allow_it() {
    assert_eq!(
        restore_intent(Some(profile(true)), true),
        RestoreIntent::Refresh("profile-1".to_owned())
    );
    assert_eq!(
        restore_intent(Some(profile(false)), true),
        RestoreIntent::ShowLogin
    );
    assert_eq!(
        restore_intent(Some(profile(true)), false),
        RestoreIntent::ShowLogin
    );
    assert_eq!(restore_intent(None, true), RestoreIntent::ShowLogin);
}

#[test]
fn new_profiles_start_without_a_test_model() {
    let profile = profile_for_login(
        None,
        "https://api.example.test".to_owned(),
        "admin@example.test".to_owned(),
        true,
    );

    assert_eq!(profile.last_model_id, "");
    assert_eq!(profile.concurrency, DEFAULT_CONCURRENCY);
}

#[test]
fn reused_profiles_preserve_empty_models_and_normalize_invalid_concurrency() {
    let mut below_minimum = profile(true);
    below_minimum.last_model_id = " ".to_owned();
    below_minimum.concurrency = 0;
    let below_minimum = profile_for_login(
        Some(below_minimum),
        "https://api.example.test".to_owned(),
        "admin@example.test".to_owned(),
        true,
    );

    let mut above_maximum = profile(true);
    above_maximum.concurrency = u8::MAX;
    let above_maximum = profile_for_login(
        Some(above_maximum),
        "https://api.example.test".to_owned(),
        "admin@example.test".to_owned(),
        true,
    );

    assert_eq!(below_minimum.last_model_id, "");
    assert_eq!(below_minimum.concurrency, DEFAULT_CONCURRENCY);
    assert_eq!(above_maximum.concurrency, DEFAULT_CONCURRENCY);
}
