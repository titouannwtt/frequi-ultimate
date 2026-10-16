//! How the engine reaches a bot: a REST client and, when the bot has an API, a WebSocket target.

use std::sync::Arc;

use fg_sources::botrest::{HttpBot, HttpClient, RestOptions};
use fg_sources::botws::{WsAuth, WsTarget};
use fg_sources::discovery::DiscoveredBot;
use fg_sources::traits::BotRest;

/// The way to talk to one bot.
#[derive(Clone)]
pub struct BotLink {
    pub rest: Arc<dyn BotRest>,
    pub ws: Option<WsTarget>,
}

/// Builds the link of a discovered bot. Production uses [`HttpConnector`]; tests plug fakes.
pub trait BotConnector: Send + Sync {
    /// `None` when the bot cannot be reached (no API port, no credentials).
    fn link(&self, bot: &DiscoveredBot) -> Option<BotLink>;
}

/// Real bots over HTTP and WebSocket on the loopback.
pub struct HttpConnector {
    client: HttpClient,
    opts: RestOptions,
}

impl HttpConnector {
    #[must_use]
    pub fn new(opts: RestOptions) -> Self {
        Self {
            client: fg_sources::botrest::build_http_client(&opts),
            opts,
        }
    }
}

impl BotConnector for HttpConnector {
    fn link(&self, bot: &DiscoveredBot) -> Option<BotLink> {
        let http = Arc::new(HttpBot::from_discovered(
            bot,
            self.client.clone(),
            self.opts.clone(),
        )?);
        let port = bot.config.api.listen_port?;
        let ws = WsTarget {
            base: http.ws_base(),
            auth: Arc::clone(&http) as Arc<dyn WsAuth>,
            label: port.to_string(),
        };
        Some(BotLink {
            rest: http as Arc<dyn BotRest>,
            ws: Some(ws),
        })
    }
}
