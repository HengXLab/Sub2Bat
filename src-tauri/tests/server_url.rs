use sub2bat_lib::server_url::ServerUrl;

#[test]
fn normalizes_a_server_url_that_already_includes_api_v1() {
    let server = ServerUrl::parse("https://example.test/sub2api/api/v1/").unwrap();

    assert_eq!(server.base(), "https://example.test/sub2api");
    assert_eq!(
        server.endpoint("auth/login"),
        "https://example.test/sub2api/api/v1/auth/login"
    );
}

#[test]
fn rejects_a_non_http_server_url() {
    assert!(ServerUrl::parse("file:///tmp/sub2api").is_err());
}

#[test]
fn rejects_remote_plain_http_but_allows_loopback_http() {
    assert!(ServerUrl::parse("http://example.test").is_err());
    assert_eq!(
        ServerUrl::parse("http://127.0.0.1:8080").unwrap().base(),
        "http://127.0.0.1:8080"
    );
    assert_eq!(
        ServerUrl::parse("http://[::1]:8080").unwrap().base(),
        "http://[::1]:8080"
    );
}

#[test]
fn removes_a_query_and_fragment_before_building_api_endpoints() {
    let server =
        ServerUrl::parse("https://example.test/console/api/v1?source=bookmark#login").unwrap();

    assert_eq!(server.base(), "https://example.test/console");
    assert_eq!(
        server.endpoint("admin/accounts"),
        "https://example.test/console/api/v1/admin/accounts"
    );
}
