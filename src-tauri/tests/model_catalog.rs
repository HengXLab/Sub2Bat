use sub2bat_lib::models::{ModelCatalog, RemoteModel};

fn model(id: &str, display_name: &str) -> RemoteModel {
    RemoteModel {
        id: id.to_owned(),
        display_name: display_name.to_owned(),
    }
}

#[test]
fn keeps_server_model_order_and_counts_models_returned_by_selected_accounts() {
    let catalog = ModelCatalog::from_account_models(
        3,
        vec![
            Ok(vec![
                model("gpt-5.6-terra", "GPT-5.6 Terra"),
                model("gpt-5", "GPT-5"),
            ]),
            Ok(vec![
                model("gpt-5", "GPT-5"),
                model("claude-sonnet", "Claude Sonnet"),
            ]),
            Err("account model endpoint unavailable".to_owned()),
        ],
    );

    assert_eq!(catalog.options.len(), 3);
    assert_eq!(catalog.options[0].id, "gpt-5.6-terra");
    assert_eq!(catalog.options[0].available_on, 1);
    assert_eq!(catalog.options[1].id, "gpt-5");
    assert_eq!(catalog.options[1].available_on, 2);
    assert_eq!(catalog.unknown_accounts, 1);
}

#[test]
fn exposes_no_models_when_no_account_model_request_has_succeeded() {
    let catalog = ModelCatalog::from_account_models(2, vec![Err("offline".to_owned())]);

    assert!(catalog.options.is_empty());
    assert_eq!(catalog.unknown_accounts, 1);
}

#[test]
fn uses_model_id_when_server_omits_display_name() {
    let remote_model: RemoteModel = serde_json::from_value(serde_json::json!({
        "id": "gpt-5",
        "extra": true,
    }))
    .unwrap();

    let catalog = ModelCatalog::from_account_models(1, vec![Ok(vec![remote_model])]);

    assert_eq!(catalog.options[0].id, "gpt-5");
    assert_eq!(catalog.options[0].display_name, "gpt-5");
}

#[test]
fn replaces_an_id_fallback_with_a_later_display_name() {
    let catalog = ModelCatalog::from_account_models(
        2,
        vec![
            Ok(vec![model("gpt-5", "")]),
            Ok(vec![model("gpt-5", " GPT-5 ")]),
        ],
    );

    let option = catalog
        .options
        .iter()
        .find(|option| option.id == "gpt-5")
        .unwrap();
    assert_eq!(option.display_name, "GPT-5");
    assert_eq!(option.available_on, 2);
}

#[test]
fn uses_a_later_server_label_after_an_initial_id_fallback() {
    let terra_without_display_name: RemoteModel = serde_json::from_value(serde_json::json!({
        "id": "gpt-5.6-terra",
    }))
    .unwrap();
    let catalog = ModelCatalog::from_account_models(
        2,
        vec![
            Ok(vec![terra_without_display_name]),
            Ok(vec![model("gpt-5.6-terra", "Different Terra Name")]),
        ],
    );

    let terra = catalog
        .options
        .iter()
        .find(|option| option.id == "gpt-5.6-terra")
        .unwrap();
    assert_eq!(terra.display_name, "Different Terra Name");
    assert_eq!(terra.available_on, 2);
}
