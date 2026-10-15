//! A string that must never be printed, logged or serialised.
//!
//! Used for every credential read from a bot config (API password, JWT secret, WS token, wallet
//! addresses). The buffer is wiped on drop. `Debug` prints `***`; there is deliberately no
//! `Display` and no `Serialize`.

use std::fmt;

use serde::de::{self, Deserialize, Deserializer, Visitor};
use zeroize::Zeroizing;

/// Redacted, zeroizing string.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(Zeroizing::new(value.into()))
    }

    /// The clear value. Call sites are the only places a secret is ever visible; keep them few
    /// (building an HTTP `Authorization` header, comparing for equality).
    #[must_use]
    pub fn expose(&self) -> &str {
        self.0.as_str()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Short, non-reversible identifier (first 8 bytes of a blake3 hash, in hex). Two secrets
    /// with the same fingerprint are the same value; used to group bots that share credentials
    /// without keeping the value around (03 section 3.2).
    #[must_use]
    pub fn fingerprint(&self) -> String {
        let hash = blake3::hash(self.0.as_bytes());
        hash.to_hex()[..16].to_owned()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = Secret;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                // Never echo the offending value: serde error messages are logged.
                f.write_str("a string or a number")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Secret, E> {
                Ok(Secret::new(v))
            }

            fn visit_string<E: de::Error>(self, v: String) -> Result<Secret, E> {
                Ok(Secret(Zeroizing::new(v)))
            }

            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Secret, E> {
                Ok(Secret::new(v.to_string()))
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Secret, E> {
                Ok(Secret::new(v.to_string()))
            }
        }
        deserializer.deserialize_any(V)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_shows_the_value() {
        let s = Secret::new("hunter2");
        assert_eq!(format!("{s:?}"), "Secret(***)");
        assert_eq!(format!("{:?}", Some(&s)), "Some(Secret(***))");
    }

    #[test]
    fn fingerprint_groups_equal_values_only() {
        let a = Secret::new("same");
        let b = Secret::new("same");
        let c = Secret::new("other");
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_ne!(a.fingerprint(), c.fingerprint());
        assert!(!a.fingerprint().contains("same"));
        assert_eq!(a.fingerprint().len(), 16);
    }

    #[test]
    fn deserialises_strings_and_numbers_without_echoing_on_error() {
        let s: Secret = serde_json::from_str("\"abc\"").unwrap();
        assert_eq!(s.expose(), "abc");
        let n: Secret = serde_json::from_str("1234").unwrap();
        assert_eq!(n.expose(), "1234");
        let err = serde_json::from_str::<Secret>("[\"topsecret\"]").unwrap_err();
        assert!(!err.to_string().contains("topsecret"));
    }
}
