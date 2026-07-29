use sub2bat_lib::{api::Sub2ApiClient, server_url::ServerUrl};

#[test]
fn builds_routes_from_the_normalized_server_address() {
    let client =
        Sub2ApiClient::new(ServerUrl::parse("https://example.test/sub2api/api/v1").unwrap())
            .unwrap();

    assert_eq!(
        client.endpoint("admin/accounts"),
        "https://example.test/sub2api/api/v1/admin/accounts"
    );
}
