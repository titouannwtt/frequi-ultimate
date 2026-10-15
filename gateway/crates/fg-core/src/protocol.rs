//! Wire protocol of `/gw/v1/ws` (03 section 6.2).
//!
//! State travels as an initial HTTP snapshot per channel (`X-Gw-Seq` header) followed by
//! WebSocket frames. Updates are *keyed upserts* with per-channel monotonic sequence numbers:
//! idempotent, independent of array order, applied with a shallow merge per field group. A gap in
//! the sequence, a slow client or a resume outside the buffer is answered by `resync`: the client
//! reloads the snapshot of that channel.
//!
//! This module also holds the pure parts of both ends: the server-side ring buffer
//! ([`DeltaBuffer`]) and the client-side sequence tracker ([`SeqTracker`]) and merge
//! ([`ChannelState`]). The browser re-implements the client side and runs the same vectors.

use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use thiserror::Error;
use ts_rs::TS;

use crate::identity::BotKey;
use crate::model::Event;

/// Protocol version announced by `GET /gw/v1/hello` and by the `authed` frame.
pub const PROTOCOL_VERSION: u32 = 1;
/// Server heartbeat period.
pub const HEARTBEAT_INTERVAL_S: u64 = 15;
/// Silence after which a client reconnects.
pub const HEARTBEAT_TIMEOUT_S: u64 = 35;
/// Time a new socket has to send its `auth` frame.
pub const AUTH_TIMEOUT_S: u64 = 5;
/// Deltas kept per channel for resume.
pub const DELTA_BUFFER_SIZE: usize = 512;
/// Frames queued per client before it is resynchronised.
pub const CLIENT_QUEUE_SIZE: usize = 256;
/// WebSockets allowed per session.
pub const MAX_WS_PER_SESSION: usize = 8;
/// Maximum `fleet` frames per second.
pub const FLEET_MAX_FRAMES_PER_S: u32 = 4;
/// Reconnection delays, in seconds; the last one repeats.
pub const RECONNECT_BACKOFF_S: [u64; 5] = [1, 2, 5, 10, 30];

/// Delay before reconnection attempt `attempt` (0 based).
#[must_use]
pub fn reconnect_delay_s(attempt: usize) -> u64 {
    RECONNECT_BACKOFF_S[attempt.min(RECONNECT_BACKOFF_S.len() - 1)]
}

/// WebSocket close codes used by the gateway.
pub mod close_code {
    /// Server going away (graceful shutdown).
    pub const GOING_AWAY: u16 = 1001;
    /// No valid `auth` frame within [`super::AUTH_TIMEOUT_S`], or the session was revoked.
    pub const UNAUTHORIZED: u16 = 4401;
    /// Origin not allowed.
    pub const FORBIDDEN_ORIGIN: u16 = 4403;
    /// More than [`super::MAX_WS_PER_SESSION`] sockets for the session.
    pub const TOO_MANY: u16 = 4429;
}

/// Why a channel name could not be parsed.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ChannelError {
    #[error("unknown channel {0:?}")]
    Unknown(String),
    #[error("malformed channel {0:?}")]
    Malformed(String),
}

/// Scope of a log channel.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LogScope {
    /// Errors of all bots, merged.
    Errors,
    Bot(BotKey),
}

/// A subscription channel.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, TS)]
#[ts(type = "string")]
pub enum Channel {
    Fleet,
    Positions,
    Alerts,
    Events,
    Health,
    /// Reconciliation; subscribing raises the sweep cadence to 60 s.
    Recon,
    /// Detail of one bot; subscribing raises that bot's polling cadences.
    Bot(BotKey),
    Logs(LogScope),
    /// Relay of `new_candle` for a pair and timeframe of a bot.
    Chart {
        bot: BotKey,
        pair: String,
        timeframe: String,
    },
}

impl fmt::Display for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fleet => f.write_str("fleet"),
            Self::Positions => f.write_str("positions"),
            Self::Alerts => f.write_str("alerts"),
            Self::Events => f.write_str("events"),
            Self::Health => f.write_str("health"),
            Self::Recon => f.write_str("recon"),
            Self::Bot(k) => write!(f, "bot:{k}"),
            Self::Logs(LogScope::Errors) => f.write_str("logs:errors"),
            Self::Logs(LogScope::Bot(k)) => write!(f, "logs:{k}"),
            Self::Chart {
                bot,
                pair,
                timeframe,
            } => write!(f, "chart:{bot}:{pair}:{timeframe}"),
        }
    }
}

/// Split a leading bot key off `s`, returning it and the remainder (which starts after the
/// separating colon, if any). `local:<port>` and `url:<scheme>://<host>[:<port>]` are the only
/// shapes; a numeric segment followed by a colon after the host is a port.
fn split_bot_key(s: &str) -> Option<(BotKey, &str)> {
    if let Some(rest) = s.strip_prefix("local:") {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        let key: BotKey = format!("local:{}", &rest[..digits]).parse().ok()?;
        let tail = &rest[digits..];
        return Some((key, tail.strip_prefix(':').unwrap_or(tail)));
    }
    let rest = s.strip_prefix("url:")?;
    let (scheme, after) = rest.split_once("://")?;
    // Host runs to the next colon or the end.
    let host_end = after.find(':').unwrap_or(after.len());
    let mut end = host_end;
    // An optional numeric port: ":<digits>" followed by ":" or the end.
    if let Some(port_part) = after[host_end..].strip_prefix(':') {
        let digits = port_part.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && matches!(port_part.as_bytes().get(digits), None | Some(b':')) {
            end = host_end + 1 + digits;
        }
    }
    let origin = format!("url:{scheme}://{}", &after[..end]);
    let key: BotKey = origin.parse().ok()?;
    let tail = &after[end..];
    Some((key, tail.strip_prefix(':').unwrap_or(tail)))
}

impl FromStr for Channel {
    type Err = ChannelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bad = || ChannelError::Malformed(s.to_owned());
        match s {
            "fleet" => return Ok(Self::Fleet),
            "positions" => return Ok(Self::Positions),
            "alerts" => return Ok(Self::Alerts),
            "events" => return Ok(Self::Events),
            "health" => return Ok(Self::Health),
            "recon" => return Ok(Self::Recon),
            "logs:errors" => return Ok(Self::Logs(LogScope::Errors)),
            _ => {}
        }
        if let Some(rest) = s.strip_prefix("bot:") {
            let (key, tail) = split_bot_key(rest).ok_or_else(bad)?;
            return if tail.is_empty() {
                Ok(Self::Bot(key))
            } else {
                Err(bad())
            };
        }
        if let Some(rest) = s.strip_prefix("logs:") {
            let (key, tail) = split_bot_key(rest).ok_or_else(bad)?;
            return if tail.is_empty() {
                Ok(Self::Logs(LogScope::Bot(key)))
            } else {
                Err(bad())
            };
        }
        if let Some(rest) = s.strip_prefix("chart:") {
            let (bot, tail) = split_bot_key(rest).ok_or_else(bad)?;
            let (pair, timeframe) = tail.rsplit_once(':').ok_or_else(bad)?;
            if pair.is_empty() || timeframe.is_empty() {
                return Err(bad());
            }
            return Ok(Self::Chart {
                bot,
                pair: pair.to_owned(),
                timeframe: timeframe.to_owned(),
            });
        }
        Err(ChannelError::Unknown(s.to_owned()))
    }
}

impl Serialize for Channel {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Channel {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        String::deserialize(d)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

/// Machine-readable error codes, shared by REST bodies and `err` frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    BadRequest,
    Unauthorized,
    Forbidden,
    OriginNotAllowed,
    NotFound,
    RateLimited,
    /// The expected state of a write action does not match the bot (409).
    StateMismatch,
    /// The same idempotency key is still being processed (409).
    InProgress,
    UnknownChannel,
    TooManyConnections,
    BotUnreachable,
    Unavailable,
    Internal,
}

impl ErrorCode {
    /// HTTP status of the error on the REST API.
    #[must_use]
    pub fn http_status(self) -> u16 {
        match self {
            Self::BadRequest | Self::UnknownChannel => 400,
            Self::Unauthorized => 401,
            Self::Forbidden | Self::OriginNotAllowed => 403,
            Self::NotFound => 404,
            Self::StateMismatch | Self::InProgress => 409,
            Self::RateLimited | Self::TooManyConnections => 429,
            Self::BotUnreachable => 502,
            Self::Unavailable => 503,
            Self::Internal => 500,
        }
    }
}

/// Error body of the REST API. Never carries a secret or a raw upstream message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    pub retry_after_ms: Option<u64>,
}

/// Why the server asks a client to reload a channel snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ResyncReason {
    /// The client's sequence number skipped ahead.
    Gap,
    /// The client was too slow: its queue overflowed and was flushed.
    Overflow,
    /// The resume point is outside the buffer (or ahead of the server, after a restart).
    StaleResume,
}

/// Collections of an `up` frame: `{collection: {key: patch}}`. `PatchOf` is defined in the
/// generated TypeScript prelude.
pub type Upsert = BTreeMap<String, BTreeMap<String, Value>>;
/// Keys to delete, per collection.
pub type Remove = BTreeMap<String, Vec<String>>;

/// Names of the collections carried by upserts. The TypeScript `Upsert` type lists the same.
pub const COLLECTIONS: [&str; 6] = ["bots", "wallets", "positions", "alerts", "events", "health"];

/// Frames sent by the client.
#[derive(Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ClientFrame {
    /// First frame, within [`AUTH_TIMEOUT_S`]. The token never goes in the URL.
    Auth {
        token: String,
        device_id: String,
    },
    /// Subscribe; `resume` maps a channel to the last sequence number the client applied.
    Sub {
        ch: Vec<String>,
        resume: BTreeMap<String, u64>,
    },
    Unsub {
        ch: Vec<String>,
    },
    /// Optional keep-alive from the client.
    Ping {
        ts: i64,
    },
}

impl fmt::Debug for ClientFrame {
    // The token must never reach a log line.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Auth { device_id, .. } => f
                .debug_struct("Auth")
                .field("token", &"***")
                .field("device_id", device_id)
                .finish(),
            Self::Sub { ch, resume } => f
                .debug_struct("Sub")
                .field("ch", ch)
                .field("resume", resume)
                .finish(),
            Self::Unsub { ch } => f.debug_struct("Unsub").field("ch", ch).finish(),
            Self::Ping { ts } => f.debug_struct("Ping").field("ts", ts).finish(),
        }
    }
}

/// Frames sent by the server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ServerFrame {
    /// Reply to a valid `auth`.
    Authed {
        protocol: u32,
        ts: i64,
        hb_interval_s: u64,
    },
    /// Reply to `sub`: the current sequence number of every subscribed channel.
    Subscribed {
        seq: BTreeMap<String, u64>,
    },
    /// Keyed upserts and removals on a state channel.
    Up {
        ch: String,
        seq: u64,
        ts: i64,
        #[ts(type = "Upsert")]
        upsert: Upsert,
        remove: Remove,
    },
    /// An immutable event on the `events` channel (or a log line).
    Ev {
        ch: String,
        seq: u64,
        data: Event,
    },
    /// Heartbeat with the server clock, from which the client derives its clock skew.
    Hb {
        ts: i64,
    },
    /// Reload the snapshot of this channel.
    Resync {
        ch: String,
        reason: ResyncReason,
    },
    Err {
        code: ErrorCode,
        message: String,
    },
}

impl ServerFrame {
    /// Sequence number carried by the frame, if it is a sequenced one.
    #[must_use]
    pub fn seq(&self) -> Option<u64> {
        match self {
            Self::Up { seq, .. } | Self::Ev { seq, .. } => Some(*seq),
            _ => None,
        }
    }
}

/// Outcome of a resume request.
#[derive(Debug, Clone, PartialEq)]
pub enum Resume {
    /// The client has everything.
    UpToDate,
    /// Frames the client missed, in order.
    Replay(Vec<ServerFrame>),
    /// Too far behind (or ahead): the client must reload the snapshot.
    Resync(ResyncReason),
}

/// Server-side ring buffer of the last deltas of one channel.
#[derive(Debug, Clone)]
pub struct DeltaBuffer {
    channel: String,
    capacity: usize,
    head: u64,
    frames: VecDeque<ServerFrame>,
}

impl DeltaBuffer {
    #[must_use]
    pub fn new(channel: &Channel, capacity: usize) -> Self {
        Self {
            channel: channel.to_string(),
            capacity: capacity.max(1),
            head: 0,
            frames: VecDeque::new(),
        }
    }

    /// Sequence number of the most recent frame (0 before the first one). This is the value of
    /// the `X-Gw-Seq` header of a snapshot taken now.
    #[must_use]
    pub fn head(&self) -> u64 {
        self.head
    }

    fn push(&mut self, frame: ServerFrame) -> ServerFrame {
        if self.frames.len() == self.capacity {
            self.frames.pop_front();
        }
        self.frames.push_back(frame.clone());
        frame
    }

    /// Record an `up` frame and return it with its sequence number.
    pub fn push_up(&mut self, ts: i64, upsert: Upsert, remove: Remove) -> ServerFrame {
        self.head += 1;
        let frame = ServerFrame::Up {
            ch: self.channel.clone(),
            seq: self.head,
            ts,
            upsert,
            remove,
        };
        self.push(frame)
    }

    /// Record an `ev` frame and return it with its sequence number.
    pub fn push_ev(&mut self, data: Event) -> ServerFrame {
        self.head += 1;
        let frame = ServerFrame::Ev {
            ch: self.channel.clone(),
            seq: self.head,
            data,
        };
        self.push(frame)
    }

    /// What to send a client that last applied sequence number `from`.
    #[must_use]
    pub fn resume(&self, from: u64) -> Resume {
        if from == self.head {
            return Resume::UpToDate;
        }
        if from > self.head {
            // The server restarted and its counters went back: the client is "ahead".
            return Resume::Resync(ResyncReason::StaleResume);
        }
        let oldest = self.head + 1 - self.frames.len() as u64;
        if from + 1 < oldest {
            return Resume::Resync(ResyncReason::StaleResume);
        }
        Resume::Replay(
            self.frames
                .iter()
                .filter(|f| f.seq().is_some_and(|s| s > from))
                .cloned()
                .collect(),
        )
    }
}

/// Verdict of [`SeqTracker::observe`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum SeqCheck {
    /// The expected next frame: apply it.
    InOrder,
    /// Already applied (replay overlap): ignore it.
    Duplicate,
    /// Frames are missing: ask for a resync.
    Gap { expected: u64, got: u64 },
}

/// Client-side sequence tracking of one channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SeqTracker {
    last: Option<u64>,
}

impl SeqTracker {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the baseline from a snapshot (`X-Gw-Seq`) or a `subscribed` frame.
    pub fn reset(&mut self, seq: u64) {
        self.last = Some(seq);
    }

    /// Last applied sequence number, to send as `resume`.
    #[must_use]
    pub fn last(&self) -> Option<u64> {
        self.last
    }

    /// Check an incoming frame; the baseline only moves on `InOrder`. Without a baseline the
    /// first frame is accepted as the baseline.
    pub fn observe(&mut self, seq: u64) -> SeqCheck {
        match self.last {
            None => {
                self.last = Some(seq);
                SeqCheck::InOrder
            }
            Some(last) if seq == last + 1 => {
                self.last = Some(seq);
                SeqCheck::InOrder
            }
            Some(last) if seq <= last => SeqCheck::Duplicate,
            Some(last) => SeqCheck::Gap {
                expected: last + 1,
                got: seq,
            },
        }
    }
}

/// Shallow merge of an entity patch: for every field group present in the patch, an object group
/// is merged key by key into the existing group, anything else replaces the group wholesale.
/// `{metrics: {a: 1}}` onto `{metrics: {a: 0, b: 2}}` gives `{metrics: {a: 1, b: 2}}`.
pub fn merge_entity(entity: &mut Value, patch: &Value) {
    let Value::Object(patch_map) = patch else {
        *entity = patch.clone();
        return;
    };
    if !entity.is_object() {
        *entity = Value::Object(serde_json::Map::new());
    }
    let Some(target) = entity.as_object_mut() else {
        return;
    };
    for (group, pv) in patch_map {
        match (target.get_mut(group), pv) {
            (Some(Value::Object(existing)), Value::Object(fields)) => {
                for (k, v) in fields {
                    existing.insert(k.clone(), v.clone());
                }
            }
            _ => {
                target.insert(group.clone(), pv.clone());
            }
        }
    }
}

/// Client-side copy of a channel: collections of keyed entities.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ChannelState {
    pub collections: BTreeMap<String, BTreeMap<String, Value>>,
}

impl ChannelState {
    /// Apply an `up` frame: upserts first, then removals (a key in both ends up removed).
    pub fn apply(&mut self, upsert: &Upsert, remove: &Remove) {
        for (collection, entities) in upsert {
            let coll = self.collections.entry(collection.clone()).or_default();
            for (key, patch) in entities {
                match coll.get_mut(key) {
                    Some(existing) => merge_entity(existing, patch),
                    None => {
                        let mut fresh = Value::Object(serde_json::Map::new());
                        merge_entity(&mut fresh, patch);
                        coll.insert(key.clone(), fresh);
                    }
                }
            }
        }
        for (collection, keys) in remove {
            if let Some(coll) = self.collections.get_mut(collection) {
                for k in keys {
                    coll.remove(k);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
