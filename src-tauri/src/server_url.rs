use url::{Host, Url};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerUrl {
    base: String,
}

impl ServerUrl {
    pub fn parse(value: &str) -> Result<Self, String> {
        let mut url = Url::parse(value.trim())
            .map_err(|_| "Server address must be a complete http:// or https:// URL".to_owned())?;
        if !(url.scheme() == "https" || url.scheme() == "http") {
            return Err("Server address must start with http:// or https://".to_owned());
        }
        if url.host().is_none() {
            return Err("Server address must include a host".to_owned());
        }
        if url.scheme() == "http" && !is_loopback_host(&url) {
            return Err(
                "Remote Sub2API servers must use https://. Plain http:// is allowed only for a local loopback address such as http://127.0.0.1."
                    .to_owned(),
            );
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("Server address must not include embedded credentials".to_owned());
        }

        url.set_query(None);
        url.set_fragment(None);

        let path = url.path().trim_end_matches('/');
        let base_path = path.strip_suffix("/api/v1").unwrap_or(path).to_owned();
        url.set_path(&base_path);
        let base = url.to_string().trim_end_matches('/').to_owned();

        if base.len() <= "https://".len() {
            return Err("Server address is incomplete".to_owned());
        }

        Ok(Self { base })
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn endpoint(&self, path: &str) -> String {
        format!("{}/api/v1/{}", self.base, path.trim_start_matches('/'))
    }
}

fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        Some(Host::Domain(_)) | None => false,
    }
}
