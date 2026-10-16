//! The bots of this host as the server layer needs to know them: where to reach them and which
//! trust group they belong to (03 section 3.2).
//!
//! The bots of one trust group share the same API user and the same JWT secret, so an access
//! token of one of them is accepted by all of them: proving a token on one bot proves it for the
//! group. Groups are named by a hash of the user fingerprint and the JWT fingerprint; no secret
//! and no fingerprint leaves this module.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fg_core::identity::BotKey;
use fg_sources::botrest::dial_host;
use fg_sources::discovery::{DiscoveredBot, DiscoveryReport};
use fg_sources::traits::Discovery;

/// A bot as the directory lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirBot {
    pub key: BotKey,
    pub name: String,
    pub live: bool,
    /// Where to dial it (loopback for a wildcard listen address).
    pub host: String,
    pub port: u16,
    /// Trust group id.
    pub group: String,
    /// Fingerprint of the API user name, to find the group a typed user name belongs to.
    pub user_fp: Option<String>,
}

/// Answers "which bots are there and how are they grouped".
pub trait BotDirectory: Send + Sync {
    fn bots(&self) -> Vec<DirBot>;

    fn get(&self, key: &BotKey) -> Option<DirBot> {
        self.bots().into_iter().find(|b| &b.key == key)
    }
}

/// Discovery with a short memory, so that the engine and the server share one `/proc` scan.
pub struct CachedDiscovery {
    inner: Arc<dyn Discovery>,
    ttl: Duration,
    cache: Mutex<Option<(Instant, DiscoveryReport)>>,
}

impl CachedDiscovery {
    #[must_use]
    pub fn new(inner: Arc<dyn Discovery>, ttl: Duration) -> Self {
        Self {
            inner,
            ttl,
            cache: Mutex::new(None),
        }
    }

    fn report(&self) -> DiscoveryReport {
        let mut g = self
            .cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((at, r)) = g.as_ref()
            && at.elapsed() < self.ttl
        {
            return r.clone();
        }
        let r = self.inner.scan();
        *g = Some((Instant::now(), r.clone()));
        r
    }
}

impl Discovery for CachedDiscovery {
    fn scan(&self) -> DiscoveryReport {
        self.report()
    }
}

fn dir_bot(b: &DiscoveredBot) -> Option<DirBot> {
    let port = b.config.api.listen_port?;
    let user_fp = b
        .config
        .api
        .credentials
        .as_ref()
        .map(|c| c.username.fingerprint());
    let group = match (&user_fp, &b.config.api.jwt_fingerprint) {
        (Some(u), Some(j)) => blake3::hash(format!("{u}:{j}").as_bytes()).to_hex()[..16].to_owned(),
        // Without both, nothing proves that another bot accepts the same token.
        _ => format!("bot-{port}"),
    };
    Some(DirBot {
        key: BotKey::Local(port),
        name: b.display_name(),
        live: !b.config.is_dry(),
        host: dial_host(&b.config.api.listen_ip),
        port,
        group,
        user_fp,
    })
}

/// The directory of the bots a [`CachedDiscovery`] finds.
pub struct DiscoveryDirectory(pub Arc<CachedDiscovery>);

impl BotDirectory for DiscoveryDirectory {
    fn bots(&self) -> Vec<DirBot> {
        let mut v: Vec<DirBot> = self.0.report().bots.iter().filter_map(dir_bot).collect();
        v.sort_by_key(|b| b.port);
        v
    }
}

/// A fixed directory (tests, demos).
pub struct StaticDirectory(pub Vec<DirBot>);

impl BotDirectory for StaticDirectory {
    fn bots(&self) -> Vec<DirBot> {
        self.0.clone()
    }
}

/// IPv4 addresses of this machine, from the kernel's routing table (`/proc/net/fib_trie`).
#[must_use]
pub fn parse_fib_trie(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut last: Option<&str> = None;
    for line in text.lines() {
        let t = line.trim();
        if let Some(ip) = t.strip_prefix("|-- ") {
            last = Some(ip.trim());
        } else if t.starts_with("/32 host LOCAL")
            && let Some(ip) = last
            && !out.iter().any(|o| o == ip)
        {
            out.push(ip.to_owned());
        }
    }
    out
}

/// The addresses of this machine (empty when they cannot be read: the configured `local_hosts`
/// and the loopback names still work).
#[must_use]
pub fn local_addresses() -> Vec<String> {
    std::fs::read_to_string("/proc/net/fib_trie")
        .map(|t| parse_fib_trie(&t))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses_come_from_the_host_local_entries_only() {
        let text = "Main:\n  +-- 0.0.0.0/0 3 0 5\n     |-- 0.0.0.0\n        /0 universe UNICAST\n     +-- 127.0.0.0/8 2 0 2\n        +-- 127.0.0.0/31 1 0 0\n           |-- 127.0.0.0\n              /32 link BROADCAST\n              /8 host LOCAL\n           |-- 127.0.0.1\n              /32 host LOCAL\n     |-- 192.0.2.7\n        /32 host LOCAL\n     |-- 192.0.2.255\n        /32 link BROADCAST\nLocal:\n     |-- 192.0.2.7\n        /32 host LOCAL\n";
        assert_eq!(parse_fib_trie(text), vec!["127.0.0.1", "192.0.2.7"]);
    }
}
