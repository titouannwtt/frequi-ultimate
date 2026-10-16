//! Proofs of identity against a local bot (03 section 3.2).
//!
//! The bootstrap exchanges a bot access token the browser already holds for a gateway session:
//! the gateway asks the bot itself whether it accepts that token. The target is always taken from
//! the directory of discovered bots (loopback and the port found in `/proc`), never from what the
//! browser sent, so this cannot be turned into a request to an arbitrary address.

use std::time::Duration;

use fg_sources::botrest::{HttpClient, RestOptions, build_http_client};
use fg_sources::sensitive::Secret;
use fg_sources::traits::BoxFut;

/// The answer of a bot to a proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeVerdict {
    Accepted,
    Rejected,
    /// The bot did not answer, or answered something else: no conclusion.
    Unreachable,
}

/// Asks a bot to confirm a token or a user name and password.
pub trait BotProbe: Send + Sync {
    /// `GET /api/v1/version` with the token as a bearer.
    fn prove<'a>(&'a self, host: &'a str, port: u16, token: &'a Secret)
    -> BoxFut<'a, ProbeVerdict>;

    /// `POST /api/v1/token/login` with Basic credentials. The tokens it returns are dropped.
    fn login<'a>(
        &'a self,
        host: &'a str,
        port: u16,
        user: &'a Secret,
        password: &'a Secret,
    ) -> BoxFut<'a, ProbeVerdict>;
}

/// The real thing, over HTTP on the loopback.
pub struct HttpProbe {
    client: HttpClient,
    timeout: Duration,
}

impl HttpProbe {
    #[must_use]
    pub fn new() -> Self {
        Self {
            client: build_http_client(&RestOptions::default()),
            timeout: Duration::from_secs(3),
        }
    }
}

impl Default for HttpProbe {
    fn default() -> Self {
        Self::new()
    }
}

fn verdict(status: u16) -> ProbeVerdict {
    match status {
        200..=299 => ProbeVerdict::Accepted,
        401 | 403 => ProbeVerdict::Rejected,
        _ => ProbeVerdict::Unreachable,
    }
}

impl BotProbe for HttpProbe {
    fn prove<'a>(
        &'a self,
        host: &'a str,
        port: u16,
        token: &'a Secret,
    ) -> BoxFut<'a, ProbeVerdict> {
        Box::pin(async move {
            self.client
                .get(format!("http://{host}:{port}/api/v1/version"))
                .bearer_auth(token.expose())
                .timeout(self.timeout)
                .send()
                .await
                .map_or(ProbeVerdict::Unreachable, |r| verdict(r.status().as_u16()))
        })
    }

    fn login<'a>(
        &'a self,
        host: &'a str,
        port: u16,
        user: &'a Secret,
        password: &'a Secret,
    ) -> BoxFut<'a, ProbeVerdict> {
        Box::pin(async move {
            self.client
                .post(format!("http://{host}:{port}/api/v1/token/login"))
                .basic_auth(user.expose(), Some(password.expose()))
                .timeout(self.timeout)
                .send()
                .await
                .map_or(ProbeVerdict::Unreachable, |r| verdict(r.status().as_u16()))
        })
    }
}
