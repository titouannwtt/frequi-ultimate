//! Bot identity (03 section 4.1).
//!
//! The canonical identity of a bot is its `bot_key`: `local:<port>` for a bot discovered on this
//! machine, `url:<normalised origin>` for a remote one. The `ftbot.N` identifiers of the browser
//! are per-device aliases and never appear here.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;
use ts_rs::TS;

/// Why a `bot_key` or an origin could not be built.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum IdentityError {
    #[error("empty bot key")]
    Empty,
    #[error("unknown bot key prefix in {0:?}")]
    UnknownPrefix(String),
    #[error("invalid local port in {0:?}")]
    InvalidPort(String),
    #[error("invalid url {0:?}")]
    InvalidUrl(String),
}

/// Canonical bot identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(type = "string")]
pub enum BotKey {
    /// A bot running on this machine, identified by its API port.
    Local(u16),
    /// A remote bot, identified by its normalised origin (`scheme://host[:port]`).
    Url(String),
}

impl BotKey {
    /// Build a key from the `apiUrl` stored by the browser.
    ///
    /// When the host is one of `local_hosts` (plus the loopback names) the bot is local and keyed
    /// by port, otherwise by the normalised origin.
    pub fn from_api_url(url: &str, local_hosts: &[&str]) -> Result<Self, IdentityError> {
        let origin = Origin::parse(url)?;
        let host = origin.host.trim_matches(['[', ']']);
        let is_local = matches!(host, "localhost" | "127.0.0.1" | "::1")
            || local_hosts.iter().any(|h| h.eq_ignore_ascii_case(host));
        if is_local {
            Ok(Self::Local(origin.port))
        } else {
            Ok(Self::Url(origin.to_string()))
        }
    }

    /// Port of a local bot.
    #[must_use]
    pub fn local_port(&self) -> Option<u16> {
        match self {
            Self::Local(p) => Some(*p),
            Self::Url(_) => None,
        }
    }
}

impl fmt::Display for BotKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Local(p) => write!(f, "local:{p}"),
            Self::Url(u) => write!(f, "url:{u}"),
        }
    }
}

impl FromStr for BotKey {
    type Err = IdentityError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim();
        if s.is_empty() {
            return Err(IdentityError::Empty);
        }
        if let Some(p) = s.strip_prefix("local:") {
            let port = p
                .parse::<u16>()
                .ok()
                .filter(|p| *p != 0)
                .ok_or_else(|| IdentityError::InvalidPort(s.to_owned()))?;
            return Ok(Self::Local(port));
        }
        if let Some(u) = s.strip_prefix("url:") {
            return Ok(Self::Url(Origin::parse(u)?.to_string()));
        }
        Err(IdentityError::UnknownPrefix(s.to_owned()))
    }
}

impl Serialize for BotKey {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for BotKey {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        raw.parse().map_err(serde::de::Error::custom)
    }
}

/// A normalised origin: lowercase scheme and host, default port elided when printed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    pub scheme: String,
    pub host: String,
    pub port: u16,
}

impl Origin {
    /// Parse `scheme://[user@]host[:port][/path][?query]`; a missing scheme means `http`.
    pub fn parse(url: &str) -> Result<Self, IdentityError> {
        let bad = || IdentityError::InvalidUrl(url.to_owned());
        let url = url.trim();
        let (scheme, rest) = match url.split_once("://") {
            Some((s, r)) => (s.to_ascii_lowercase(), r),
            None => ("http".to_owned(), url),
        };
        if scheme != "http" && scheme != "https" {
            return Err(bad());
        }
        let authority = rest
            .split(['/', '?', '#'])
            .next()
            .filter(|a| !a.is_empty())
            .ok_or_else(bad)?;
        let authority = authority.rsplit('@').next().ok_or_else(bad)?;
        let default_port: u16 = if scheme == "https" { 443 } else { 80 };
        let (host, port) = if let Some(v6) = authority.strip_prefix('[') {
            let (h, tail) = v6.split_once(']').ok_or_else(bad)?;
            let port = match tail.strip_prefix(':') {
                Some(p) => p.parse::<u16>().map_err(|_| bad())?,
                None if tail.is_empty() => default_port,
                None => return Err(bad()),
            };
            (format!("[{}]", h.to_ascii_lowercase()), port)
        } else {
            match authority.rsplit_once(':') {
                Some((h, p)) => (h.to_ascii_lowercase(), p.parse::<u16>().map_err(|_| bad())?),
                None => (authority.to_ascii_lowercase(), default_port),
            }
        };
        if host.is_empty() || port == 0 {
            return Err(bad());
        }
        Ok(Self { scheme, host, port })
    }
}

impl fmt::Display for Origin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let default = if self.scheme == "https" { 443 } else { 80 };
        if self.port == default {
            write!(f, "{}://{}", self.scheme, self.host)
        } else {
            write!(f, "{}://{}:{}", self.scheme, self.host, self.port)
        }
    }
}

/// Incarnation of a bot process: a stable digest of what makes it "the same bot".
///
/// A change on the same port (new strategy, new database, restart of another process) yields a
/// different incarnation, which separates the history instead of silently merging two bots.
#[must_use]
pub fn incarnation(bot_name: &str, strategy: &str, db_path: &str, process_start_ms: i64) -> String {
    let mut h = blake3::Hasher::new();
    for part in [bot_name, strategy, db_path] {
        h.update(part.as_bytes());
        h.update(&[0x1f]);
    }
    h.update(&process_start_ms.to_le_bytes());
    h.finalize().to_hex()[..16].to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_and_parse_round_trip() {
        for s in [
            "local:9056",
            "url:https://bots.example.org",
            "url:http://10.0.0.4:9400",
        ] {
            let k: BotKey = s.parse().unwrap();
            assert_eq!(k.to_string(), s);
        }
    }

    #[test]
    fn invalid_keys_are_rejected() {
        assert_eq!("".parse::<BotKey>(), Err(IdentityError::Empty));
        assert!(matches!(
            "ftbot.3".parse::<BotKey>(),
            Err(IdentityError::UnknownPrefix(_))
        ));
        assert!(matches!(
            "local:0".parse::<BotKey>(),
            Err(IdentityError::InvalidPort(_))
        ));
        assert!(matches!(
            "local:99999".parse::<BotKey>(),
            Err(IdentityError::InvalidPort(_))
        ));
        assert!(matches!(
            "url:ftp://x".parse::<BotKey>(),
            Err(IdentityError::InvalidUrl(_))
        ));
    }

    #[test]
    fn origins_are_normalised() {
        let k: BotKey = "url:HTTPS://Bots.Example.org:443/api/v1?x=1"
            .parse()
            .unwrap();
        assert_eq!(k.to_string(), "url:https://bots.example.org");
        let k: BotKey = "url:http://user:pw@Host.Example:8080/".parse().unwrap();
        assert_eq!(k.to_string(), "url:http://host.example:8080");
        let k: BotKey = "url:http://[::1]:9000".parse().unwrap();
        assert_eq!(k.to_string(), "url:http://[::1]:9000");
    }

    #[test]
    fn api_url_maps_to_local_when_host_is_local() {
        let hosts = ["203.0.113.7"];
        assert_eq!(
            BotKey::from_api_url("http://localhost:9056", &hosts).unwrap(),
            BotKey::Local(9056)
        );
        assert_eq!(
            BotKey::from_api_url("http://127.0.0.1:9056/", &hosts).unwrap(),
            BotKey::Local(9056)
        );
        assert_eq!(
            BotKey::from_api_url("http://203.0.113.7:9400", &hosts).unwrap(),
            BotKey::Local(9400)
        );
        assert_eq!(
            BotKey::from_api_url("https://remote.example.org", &hosts).unwrap(),
            BotKey::Url("https://remote.example.org".into())
        );
    }

    #[test]
    fn serde_uses_the_string_form() {
        let k = BotKey::Local(9056);
        let json = serde_json::to_string(&k).unwrap();
        assert_eq!(json, "\"local:9056\"");
        assert_eq!(serde_json::from_str::<BotKey>(&json).unwrap(), k);
        assert!(serde_json::from_str::<BotKey>("\"nope\"").is_err());
    }

    #[test]
    fn incarnation_changes_with_every_component() {
        let base = incarnation("hippo", "StratA", "/db/a.sqlite", 1_000);
        assert_eq!(base.len(), 16);
        assert_eq!(base, incarnation("hippo", "StratA", "/db/a.sqlite", 1_000));
        assert_ne!(base, incarnation("hippo2", "StratA", "/db/a.sqlite", 1_000));
        assert_ne!(base, incarnation("hippo", "StratB", "/db/a.sqlite", 1_000));
        assert_ne!(base, incarnation("hippo", "StratA", "/db/b.sqlite", 1_000));
        assert_ne!(base, incarnation("hippo", "StratA", "/db/a.sqlite", 1_001));
        // The separator prevents "ab"+"c" and "a"+"bc" from colliding.
        assert_ne!(incarnation("ab", "c", "", 0), incarnation("a", "bc", "", 0));
    }
}
