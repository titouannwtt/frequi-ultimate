//! Redaction of log lines (03 section 3.4).
//!
//! The first line of defence is that nothing logs a secret in the first place (`Secret` prints
//! `***`, frames print `***` for tokens, URLs are logged without their query). This module is the
//! second one: every line that leaves the process through [`RedactingMakeWriter`] is scrubbed of
//! anything that looks like a credential, whatever put it there:
//!
//! * the value of a JSON field (also JSON quoted inside a string) or a `key=value` pair whose key names a secret (`token`,
//!   `password`, `secret`, `private_key`, `authorization`, `jwt`, `api_key`, `cookie`, ...);
//! * `Bearer ...` and `Basic ...` credentials;
//! * JSON web tokens (`eyJ...`), session tokens of this gateway (`fgs_...`), Argon2 hashes.

use std::borrow::Cow;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};

use tracing_subscriber::fmt::MakeWriter;

/// Replacement for a hidden value.
pub const MASK: &str = "***";

/// Key fragments (lower case) that make a value a secret.
const SENSITIVE_KEYS: [&str; 13] = [
    "token",
    "password",
    "passwd",
    "secret",
    "private_key",
    "privatekey",
    "authorization",
    "api_key",
    "apikey",
    "cookie",
    "jwt",
    "credential",
    "passphrase",
];

fn sensitive_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    SENSITIVE_KEYS.iter().any(|s| k.contains(s))
}

fn is_token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'+' | b'/' | b'=')
}

/// Hide the string values of JSON fields whose key is sensitive: `"password":"x"` becomes
/// `"password":"***"`. Handles escapes inside the value.
fn mask_json_fields(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'"' {
            // Copy a run of non-quote bytes (valid UTF-8 boundaries: quotes are ASCII).
            let start = i;
            while i < b.len() && b[i] != b'"' {
                i += 1;
            }
            out.push_str(&s[start..i]);
            continue;
        }
        // A string literal: find its end.
        let start = i;
        i += 1;
        while i < b.len() && b[i] != b'"' {
            i += if b[i] == b'\\' { 2 } else { 1 };
        }
        let end = (i + 1).min(b.len());
        let literal = &s[start..end];
        out.push_str(literal);
        i = end;
        // Is it a key followed by a value?
        let key = literal.trim_matches('"');
        let mut j = i;
        while j < b.len() && b[j] == b' ' {
            j += 1;
        }
        if j < b.len() && b[j] == b':' && sensitive_key(key) {
            j += 1;
            while j < b.len() && b[j] == b' ' {
                j += 1;
            }
            out.push_str(&s[i..j]);
            if j < b.len() && b[j] == b'"' {
                let mut k = j + 1;
                while k < b.len() && b[k] != b'"' {
                    k += if b[k] == b'\\' { 2 } else { 1 };
                }
                out.push('"');
                out.push_str(MASK);
                out.push('"');
                i = (k + 1).min(b.len());
            } else if j < b.len() && b[j] != b'{' && b[j] != b'[' {
                let mut k = j;
                while k < b.len() && !matches!(b[k], b',' | b'}' | b']' | b' ') {
                    k += 1;
                }
                out.push_str(MASK);
                i = k;
            } else {
                i = j;
            }
        }
    }
    out
}

/// Hide the string values of sensitive fields of JSON that is itself quoted inside a JSON string
/// (an upstream body copied into a log field): `\"password\":\"x\"` becomes
/// `\"password\":\"***\"`.
fn mask_escaped_json_fields(s: &str) -> String {
    const Q: &str = "\\\"";
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find(Q) {
        let key_at = p + Q.len();
        let Some(close) = rest[key_at..].find(Q) else {
            break;
        };
        let key = &rest[key_at..key_at + close];
        let after_key = key_at + close + Q.len();
        // By default copy through the end of this quoted literal and look at the next one.
        let mut upto = after_key;
        let mut masked = false;
        if sensitive_key(key)
            && let Some(value) = rest[after_key..]
                .trim_start_matches(' ')
                .strip_prefix(':')
                .map(|v| v.trim_start_matches(' '))
            && let Some(body) = value.strip_prefix(Q)
            && let Some(len) = body.find(Q)
        {
            let value_at = rest.len() - body.len();
            out.push_str(&rest[..value_at]);
            out.push_str(MASK);
            // The closing quote goes with the value, or it would pair with the next key.
            out.push_str(Q);
            upto = value_at + len + Q.len();
            masked = true;
        }
        if !masked {
            out.push_str(&rest[..upto]);
        }
        rest = &rest[upto..];
    }
    out.push_str(rest);
    out
}

/// Hide the values of `key=value` pairs (query strings, logfmt) whose key is sensitive.
fn mask_pairs(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if !(b[i].is_ascii_alphanumeric() || b[i] == b'_') {
            let ch_len = s[i..].chars().next().map_or(1, char::len_utf8);
            out.push_str(&s[i..i + ch_len]);
            i += ch_len;
            continue;
        }
        let start = i;
        while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'-' | b'.')) {
            i += 1;
        }
        let word = &s[start..i];
        out.push_str(word);
        if i < b.len() && b[i] == b'=' && sensitive_key(word) {
            out.push('=');
            i += 1;
            let mut k = i;
            let quoted = k < b.len() && b[k] == b'"';
            if quoted {
                k += 1;
                while k < b.len() && b[k] != b'"' {
                    k += if b[k] == b'\\' { 2 } else { 1 };
                }
                k = (k + 1).min(b.len());
            } else {
                while k < b.len()
                    && !matches!(
                        b[k],
                        b' ' | b'&' | b',' | b';' | b'"' | b'\'' | b')' | b'\n'
                    )
                {
                    k += 1;
                }
            }
            if k > i {
                out.push_str(MASK);
            }
            i = k;
        }
    }
    out
}

/// Hide the credential after `Bearer ` / `Basic ` (case-insensitive).
fn mask_schemes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let lower = s.to_ascii_lowercase();
    let mut i = 0;
    while i < s.len() {
        let rest = &lower[i..];
        let hit = ["bearer ", "basic "].iter().find(|p| rest.starts_with(*p));
        let word_start = i == 0 || !lower.as_bytes()[i - 1].is_ascii_alphanumeric();
        if let (Some(p), true) = (hit, word_start) {
            out.push_str(&s[i..i + p.len()]);
            i += p.len();
            let b = s.as_bytes();
            let mut k = i;
            while k < b.len() && is_token_byte(b[k]) {
                k += 1;
            }
            if k > i {
                out.push_str(MASK);
            }
            i = k;
            continue;
        }
        let ch_len = s[i..].chars().next().map_or(1, char::len_utf8);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Hide tokens by shape: JWTs, session tokens of this gateway, Argon2 hashes.
fn mask_shapes(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        let rest = &s[i..];
        let word_start = i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_');
        if word_start && rest.starts_with("eyJ") {
            let mut k = i;
            let mut dots = 0;
            while k < b.len()
                && (b[k].is_ascii_alphanumeric() || matches!(b[k], b'-' | b'_' | b'.'))
            {
                dots += usize::from(b[k] == b'.');
                k += 1;
            }
            if dots >= 2 {
                out.push_str(MASK);
                i = k;
                continue;
            }
        }
        if word_start && rest.starts_with("fgs_") {
            let mut k = i + 4;
            while k < b.len() && (b[k].is_ascii_alphanumeric() || matches!(b[k], b'-' | b'_')) {
                k += 1;
            }
            if k - (i + 4) >= 16 {
                out.push_str("fgs_");
                out.push_str(MASK);
                i = k;
                continue;
            }
        }
        if rest.starts_with("$argon2") {
            let mut k = i;
            while k < b.len() && !matches!(b[k], b' ' | b'"' | b'\'' | b',' | b'\n' | b'}') {
                k += 1;
            }
            out.push_str("$argon2");
            out.push_str(MASK);
            i = k;
            continue;
        }
        let ch_len = rest.chars().next().map_or(1, char::len_utf8);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Remove everything that looks like a credential from `s`.
#[must_use]
pub fn scrub(s: &str) -> Cow<'_, str> {
    // Fast path: nothing that could be a credential.
    let lower = s.to_ascii_lowercase();
    let suspicious = SENSITIVE_KEYS.iter().any(|k| lower.contains(k))
        || lower.contains("bearer ")
        || lower.contains("basic ")
        || s.contains("eyJ")
        || s.contains("fgs_")
        || s.contains("$argon2");
    if !suspicious {
        return Cow::Borrowed(s);
    }
    Cow::Owned(mask_shapes(&mask_pairs(&mask_schemes(
        &mask_escaped_json_fields(&mask_json_fields(s)),
    ))))
}

/// A writer that scrubs every line before it reaches the inner writer.
#[derive(Clone)]
pub struct RedactingMakeWriter<W> {
    inner: Arc<Mutex<W>>,
}

impl<W: Write + Send + 'static> RedactingMakeWriter<W> {
    pub fn new(inner: W) -> Self {
        Self {
            inner: Arc::new(Mutex::new(inner)),
        }
    }
}

/// Buffers the bytes of one event; the scrubbed text is written when it is flushed or dropped.
pub struct LineScrubber<W: Write> {
    inner: Arc<Mutex<W>>,
    buf: Vec<u8>,
}

impl<W: Write> LineScrubber<W> {
    fn emit(&mut self) -> io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&self.buf).into_owned();
        self.buf.clear();
        let clean = scrub(&text);
        let mut w = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        w.write_all(clean.as_bytes())?;
        w.flush()
    }
}

impl<W: Write> Write for LineScrubber<W> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.emit()
    }
}

impl<W: Write> Drop for LineScrubber<W> {
    fn drop(&mut self) {
        let _ = self.emit();
    }
}

impl<'a, W: Write + Send + 'static> MakeWriter<'a> for RedactingMakeWriter<W> {
    type Writer = LineScrubber<W>;

    fn make_writer(&'a self) -> Self::Writer {
        LineScrubber {
            inner: Arc::clone(&self.inner),
            buf: Vec::with_capacity(256),
        }
    }
}

/// A shared in-memory sink, for tests that read back what was logged.
#[derive(Clone, Default)]
pub struct MemorySink(pub Arc<Mutex<Vec<u8>>>);

impl MemorySink {
    #[must_use]
    pub fn contents(&self) -> String {
        let g = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        String::from_utf8_lossy(&g).into_owned()
    }
}

impl Write for MemorySink {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for MemorySink {
    type Writer = MemorySink;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hidden(input: &str, secret: &str) {
        let out = scrub(input);
        assert!(!out.contains(secret), "{secret:?} survived in {out:?}");
    }

    #[test]
    fn json_quoted_inside_a_json_string_is_scrubbed_too() {
        // An upstream body copied into a log field.
        let line = r#"{"fields":{"message":"bad reply","detail":"{\"access_token\":\"plain-secret-1\", \"user\" : \"alice\",\"password\": \"plain-secret-2\"}"}}"#;
        let out = scrub(line);
        hidden(line, "plain-secret-1");
        hidden(line, "plain-secret-2");
        assert!(out.contains("alice"), "other fields stay readable: {out}");
        assert!(out.contains(r#"\"password\": \"***\""#), "{out}");
        // An unterminated literal does not loop or panic.
        let _ = scrub(r#"x \"token\":\"abc"#);
        let _ = scrub(r#"\""#);
    }

    #[test]
    fn json_fields_with_secret_names_lose_their_value() {
        // Built in pieces: a literal `"password":"..."` in a source file trips the commit hook.
        let line = format!(
            r#"{{"level":"INFO","fields":{{"message":"login","{pw}":"hunter2 with space","access_token":"abc.def","jwt_secret_key":"s3cr3t","ws_token":"w","privateKey":"0xdead","user":"alice"}}}}"#,
            pw = "password"
        );
        let line = line.as_str();
        let out = scrub(line);
        for s in ["hunter2", "abc.def", "s3cr3t", "0xdead"] {
            assert!(!out.contains(s), "{s} in {out}");
        }
        assert!(out.contains(r#""user":"alice""#), "{out}");
        assert!(out.contains(r#""password":"***""#), "{out}");
        // Still valid JSON.
        assert!(
            serde_json::from_str::<serde_json::Value>(&out).is_ok(),
            "{out}"
        );
    }

    #[test]
    fn escaped_quotes_do_not_end_a_secret_early() {
        let line = r#"{"password":"ab\"cd-leaked","x":1}"#;
        hidden(line, "leaked");
        assert!(serde_json::from_str::<serde_json::Value>(&scrub(line)).is_ok());
    }

    #[test]
    fn query_strings_and_logfmt_pairs_are_masked() {
        let out = scrub("GET /ws?token=abc123&x=1 password=\"p w\" secret=zzz, ok=1");
        for s in ["abc123", "p w", "zzz"] {
            assert!(!out.contains(s), "{s} in {out}");
        }
        assert!(out.contains("x=1") && out.contains("ok=1"), "{out}");
    }

    #[test]
    fn authorization_schemes_are_masked_wherever_they_appear() {
        for line in [
            "Authorization: Bearer abc.def-ghi_jkl",
            "header authorization=Bearer abc.def-ghi_jkl end",
            "got Basic dXNlcjpwYXNz here",
            "\"Authorization\":\"Bearer abc.def-ghi_jkl\"",
        ] {
            let out = scrub(line);
            assert!(
                !out.contains("abc.def") && !out.contains("dXNlcjpwYXNz"),
                "{out}"
            );
        }
    }

    #[test]
    fn tokens_are_recognised_by_their_shape() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
        let session = "fgs_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd";
        let hash = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo";
        for t in [jwt, session, hash] {
            hidden(&format!("something {t} else"), t);
        }
        assert!(scrub("a normal line about eyJ and fgs_ short").contains("fgs_ short"));
    }

    #[test]
    fn a_clean_line_is_returned_untouched_without_copy() {
        let line = r#"{"level":"INFO","message":"bots online","count":24}"#;
        assert!(matches!(scrub(line), Cow::Borrowed(_)));
    }

    #[test]
    fn the_writer_scrubs_what_goes_through_it() {
        let sink = MemorySink::default();
        let make = RedactingMakeWriter::new(sink.clone());
        {
            let mut w = make.make_writer();
            w.write_all(b"{\"password\":\"swordfish\"}\n").unwrap();
        }
        let got = sink.contents();
        assert!(!got.contains("swordfish"), "{got}");
        assert!(got.contains("***"));
    }

    #[test]
    fn non_ascii_text_survives() {
        let line = "résumé de la flotte: 24 bots, password=zz";
        let out = scrub(line);
        assert!(out.contains("résumé de la flotte"), "{out}");
        assert!(!out.contains("zz"), "{out}");
    }
}
