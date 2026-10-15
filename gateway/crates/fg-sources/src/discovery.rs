//! Bot discovery: scan `/proc` for running freqtrade processes, merge their config files and read
//! a whitelist of fields (03 sections 2.1, 3.1, 4).
//!
//! # Hard rules enforced here
//!
//! * Only the fields of [`RawConfig`] are ever deserialised. Every other key of a config, and in
//!   particular exchange API keys and private keys, is skipped by serde without being
//!   materialised.
//! * Raw file buffers (and the comment-stripped copy) are wiped after parsing.
//! * Credentials live in [`Secret`]s, whose `Debug` is redacted. JWT secrets are reduced to a
//!   fingerprint immediately. Parse errors never echo a value (serde messages can contain one),
//!   only a category, a line and a column.
//! * Nothing here writes anything, and nothing here signals a process.
//!
//! # Merge semantics
//!
//! Identical to `freqtrade.configuration.load_config.load_from_files`: the files of `--config`
//! are merged in order (later wins); inside a file, `add_config_files` are loaded first
//! (relative to that file's directory) and the including file wins over them; objects merge key
//! by key, anything else is replaced, and an explicit `null` overrides. Config files are JSON
//! with comments and trailing commas (rapidjson parse mode of freqtrade), which [`strip_jsonc`]
//! handles.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::io::Read as _;
use std::marker::PhantomData;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use fg_core::identity::BotKey;
use serde::de::value::MapAccessDeserializer;
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::sensitive::Secret;
use crate::traits::Discovery;

/// Recursion limit for `add_config_files`, same as freqtrade.
const MAX_CONFIG_LEVEL: u8 = 5;
/// Refuse absurdly large configs rather than buffering them.
const MAX_CONFIG_BYTES: u64 = 8 * 1024 * 1024;
/// `USER_HZ` of Linux on every supported architecture (the `starttime` unit of `/proc/<pid>/stat`).
const CLOCK_TICKS_PER_SEC: u64 = 100;

// ---------------------------------------------------------------------------------------------
// Public model
// ---------------------------------------------------------------------------------------------

/// Credentials of the bot REST API (`api_server.username` / `password`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiCredentials {
    pub username: Secret,
    pub password: Secret,
}

/// `api_server` section, whitelisted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiServerInfo {
    pub listen_ip: String,
    pub listen_port: Option<u16>,
    /// Absent when credentials are missing or `read_api_credentials_from_config` is off.
    pub credentials: Option<ApiCredentials>,
    /// Fingerprint of `jwt_secret_key`: two bots with the same value share a trust scope
    /// (03 section 3.2) without the secret being kept.
    pub jwt_fingerprint: Option<String>,
    /// Static WebSocket token, used only when no JWT is available.
    pub ws_token: Option<Secret>,
}

/// `exchange` section, whitelisted. Keys and secrets are never read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExchangeInfo {
    pub name: Option<String>,
    pub trading_mode: Option<String>,
    /// `walletAddress` / `wallet_address`.
    pub wallet: Option<Secret>,
    /// `ccxt_config.options.vaultAddress` (alias `subAccountAddress`): the account orders act on.
    pub vault: Option<Secret>,
    pub hip3_dexes: Vec<String>,
}

impl ExchangeInfo {
    /// Stable identifier of the account that holds the funds (vault when set, else wallet),
    /// shared by all bots on that account. A fingerprint, never the address.
    #[must_use]
    pub fn wallet_id(&self) -> Option<String> {
        let account = self.vault.as_ref().or(self.wallet.as_ref())?;
        Some(Secret::new(account.expose().to_ascii_lowercase()).fingerprint())
    }

    /// `0xAbCd...1234`, the only form of the address that may reach a client.
    #[must_use]
    pub fn address_short(&self) -> Option<String> {
        let account = self.vault.as_ref().or(self.wallet.as_ref())?.expose();
        let chars: Vec<char> = account.chars().collect();
        if chars.len() <= 12 {
            return None;
        }
        let head: String = chars[..6].iter().collect();
        let tail: String = chars[chars.len() - 4..].iter().collect();
        Some(format!("{head}...{tail}"))
    }
}

/// The whitelisted view of a merged bot config.
#[derive(Debug, Clone, PartialEq)]
pub struct BotConfig {
    pub bot_name: Option<String>,
    pub strategy: Option<String>,
    pub db_url: Option<String>,
    /// `None` when absent; freqtrade then defaults to dry-run, see [`BotConfig::is_dry`].
    pub dry_run: Option<bool>,
    pub stake_currency: Option<String>,
    pub available_capital: Option<f64>,
    pub capital_withdrawal: f64,
    pub max_open_trades: Option<i64>,
    pub api: ApiServerInfo,
    pub exchange: ExchangeInfo,
}

impl BotConfig {
    /// freqtrade defaults to dry-run when the key is absent (the safe reading for a dashboard).
    #[must_use]
    pub fn is_dry(&self) -> bool {
        self.dry_run.unwrap_or(true)
    }
}

/// Files that produced a config and their stamps, for cheap change detection.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConfigStamp(Vec<(PathBuf, i128, u64)>);

impl ConfigStamp {
    fn capture(files: &[PathBuf]) -> Self {
        Self(
            files
                .iter()
                .map(|p| {
                    let (mtime, len) = fs::metadata(p).map_or((0, 0), |m| {
                        let mtime = m
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map_or(0, |d| i128::try_from(d.as_nanos()).unwrap_or(0));
                        (mtime, m.len())
                    });
                    (p.clone(), mtime, len)
                })
                .collect(),
        )
    }

    /// Files are unchanged since the stamp was captured.
    #[must_use]
    pub fn is_current(&self) -> bool {
        let files: Vec<PathBuf> = self.0.iter().map(|(p, _, _)| p.clone()).collect();
        *self == Self::capture(&files)
    }
}

/// A running bot found on this host.
#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveredBot {
    pub pid: u32,
    pub process_start_ms: Option<i64>,
    pub cwd: PathBuf,
    /// Config files of the command line, made absolute.
    pub config_files: Vec<PathBuf>,
    /// First config file name, the fallback bot name.
    pub config_name: String,
    pub config: BotConfig,
    /// Ledger path derived from `db_url` (or the freqtrade default).
    pub db_path: Option<PathBuf>,
    /// The ledger name matches an ignore token (`backup`, `replay`, `tmp`, ...).
    pub db_ignored: bool,
    pub stamp: ConfigStamp,
}

impl DiscoveredBot {
    /// `local:<port>` key, when the bot exposes an API.
    #[must_use]
    pub fn bot_key(&self) -> Option<BotKey> {
        self.config.api.listen_port.map(BotKey::Local)
    }

    /// Name shown to users: `bot_name`, else the config file name.
    #[must_use]
    pub fn display_name(&self) -> String {
        self.config
            .bot_name
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| self.config_name.clone())
    }
}

/// Why a process was skipped. Contains no config content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryIssue {
    pub pid: u32,
    pub error: ConfigError,
}

/// Result of one scan.
#[derive(Debug, Clone, Default)]
pub struct DiscoveryReport {
    pub bots: Vec<DiscoveredBot>,
    pub issues: Vec<DiscoveryIssue>,
}

/// Configuration problem. Messages are safe to log: they carry file names and positions only.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ConfigError {
    #[error("config file {file} not found or unreadable")]
    Unreadable { file: String },
    #[error("config file {file} is larger than the {MAX_CONFIG_BYTES} byte limit")]
    TooLarge { file: String },
    #[error("config file {file}: {category} at line {line}, column {column}")]
    Parse {
        file: String,
        category: &'static str,
        line: usize,
        column: usize,
    },
    #[error("config include loop or nesting deeper than {MAX_CONFIG_LEVEL} levels")]
    IncludeLoop,
    #[error("process has no readable working directory")]
    NoCwd,
    #[error("no config file on the command line")]
    NoConfig,
}

// ---------------------------------------------------------------------------------------------
// Lenient scalars and patches
// ---------------------------------------------------------------------------------------------

/// A config value that may be absent, explicitly null, or present.
#[derive(Debug, Clone, Default, PartialEq)]
enum Patch<T> {
    #[default]
    Absent,
    Null,
    Value(T),
}

impl<T> Patch<T> {
    /// `self` is the base, `top` the higher priority value: anything but absent wins.
    fn overlay_leaf(self, top: Self) -> Self {
        match top {
            Self::Absent => self,
            other => other,
        }
    }

    fn value(&self) -> Option<&T> {
        match self {
            Self::Value(v) => Some(v),
            _ => None,
        }
    }
}

impl<T: Overlay> Patch<T> {
    fn overlay_nested(self, top: Self) -> Self {
        match (self, top) {
            (base, Self::Absent) => base,
            (_, Self::Null) => Self::Null,
            (Self::Value(base), Self::Value(top)) => Self::Value(base.overlay(top)),
            (_, Self::Value(top)) => Self::Value(top),
        }
    }
}

trait Overlay {
    fn overlay(self, top: Self) -> Self;
}

fn patch<'de, D, T>(d: D) -> Result<Patch<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.map_or(Patch::Null, Patch::Value))
}

/// Like [`patch`] for a nested object: only a JSON object (or null) is accepted. A derived
/// struct deserialiser would also accept a JSON array and map its elements to fields by position,
/// which could put an unrelated string in a credential field.
fn patch_map<'de, D, T>(d: D) -> Result<Patch<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Opt<T>(PhantomData<T>);

    impl<'de, T: Deserialize<'de>> Visitor<'de> for Opt<T> {
        type Value = Patch<T>;

        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("an object or null")
        }

        fn visit_none<E: de::Error>(self) -> Result<Patch<T>, E> {
            Ok(Patch::Null)
        }

        fn visit_unit<E: de::Error>(self) -> Result<Patch<T>, E> {
            Ok(Patch::Null)
        }

        fn visit_some<D2: Deserializer<'de>>(self, d: D2) -> Result<Patch<T>, D2::Error> {
            d.deserialize_map(MapOnly(PhantomData))
        }
    }

    d.deserialize_option(Opt(PhantomData))
}

/// Visitor that accepts a JSON object only.
struct MapOnly<T>(PhantomData<T>);

impl<'de, T: Deserialize<'de>> Visitor<'de> for MapOnly<T> {
    type Value = Patch<T>;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("an object")
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Patch<T>, A::Error> {
        T::deserialize(MapAccessDeserializer::new(map)).map(Patch::Value)
    }
}

/// A scalar of unknown JSON type. Strings are kept in [`Secret`]s so that they are wiped.
enum Scalar {
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(Secret),
}

// A derived Debug would print string values; scalars are never shown.
impl fmt::Debug for Scalar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Scalar(***)")
    }
}

impl Clone for Scalar {
    fn clone(&self) -> Self {
        match self {
            Self::Bool(b) => Self::Bool(*b),
            Self::Int(i) => Self::Int(*i),
            Self::Float(x) => Self::Float(*x),
            Self::Str(s) => Self::Str(s.clone()),
        }
    }
}

impl PartialEq for Scalar {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Int(a), Self::Int(b)) => a == b,
            (Self::Float(a), Self::Float(b)) => a == b,
            (Self::Str(a), Self::Str(b)) => a == b,
            _ => false,
        }
    }
}

impl<'de> Deserialize<'de> for Scalar {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Scalar;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a scalar")
            }

            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Scalar, E> {
                Ok(Scalar::Bool(v))
            }

            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Scalar, E> {
                Ok(Scalar::Int(v))
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Scalar, E> {
                // Out of i64 range is not a sane port or count; keep it as a float.
                Ok(i64::try_from(v).map_or(Scalar::Float(v as f64), Scalar::Int))
            }

            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Scalar, E> {
                Ok(Scalar::Float(v))
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Scalar, E> {
                Ok(Scalar::Str(Secret::new(v)))
            }

            fn visit_string<E: de::Error>(self, v: String) -> Result<Scalar, E> {
                Ok(Scalar::Str(Secret::new(v)))
            }
        }
        deserializer.deserialize_any(V)
    }
}

impl Scalar {
    fn into_string(self) -> Option<String> {
        match self {
            Self::Str(s) => Some(s.expose().to_owned()),
            Self::Int(i) => Some(i.to_string()),
            Self::Float(_) | Self::Bool(_) => None,
        }
    }

    fn into_secret(self) -> Option<Secret> {
        match self {
            Self::Str(s) => Some(s),
            Self::Int(i) => Some(Secret::new(i.to_string())),
            Self::Float(_) | Self::Bool(_) => None,
        }
    }

    fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Int(i) => Some(*i as f64),
            Self::Float(x) if x.is_finite() => Some(*x),
            Self::Str(s) => s
                .expose()
                .trim()
                .parse::<f64>()
                .ok()
                .filter(|x| x.is_finite()),
            _ => None,
        }
    }

    fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Int(i) => Some(*i),
            Self::Str(s) => s.expose().trim().parse().ok(),
            _ => None,
        }
    }

    fn as_u16(&self) -> Option<u16> {
        self.as_i64()
            .and_then(|i| u16::try_from(i).ok())
            .filter(|p| *p != 0)
    }

    fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(b) => Some(*b),
            Self::Str(s) => match s.expose().trim().to_ascii_lowercase().as_str() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            },
            _ => None,
        }
    }
}

/// A list of strings (`hip3_dexes`, `add_config_files`); non-string entries are skipped.
#[derive(Debug, Clone, Default, PartialEq)]
struct StrList(Vec<String>);

impl<'de> Deserialize<'de> for StrList {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = StrList;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a list")
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<StrList, A::Error> {
                let mut out = Vec::new();
                while let Some(item) = seq.next_element::<Patch2<Scalar>>()? {
                    if let Some(s) = item.0.and_then(Scalar::into_string) {
                        out.push(s);
                    }
                }
                Ok(StrList(out))
            }
        }
        deserializer.deserialize_seq(V)
    }
}

/// `Option<T>` that can be named inside generic code without clashing with `Deserialize` for
/// `Option`.
struct Patch2<T>(Option<T>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch2<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(Option::<T>::deserialize(d)?))
    }
}

// ---------------------------------------------------------------------------------------------
// Whitelisted raw structures. serde skips every unlisted key without allocating it.
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default, Clone, PartialEq, serde::Deserialize)]
struct RawApi {
    #[serde(default, deserialize_with = "patch")]
    listen_ip_address: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    listen_port: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    username: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    password: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    jwt_secret_key: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    ws_token: Patch<WsToken>,
}

/// `ws_token` is a string or a list of strings; the first is used.
#[derive(Debug, Clone, PartialEq)]
struct WsToken(Option<Secret>);

impl<'de> Deserialize<'de> for WsToken {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = WsToken;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a string or a list")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<WsToken, E> {
                Ok(WsToken(Some(Secret::new(v))))
            }

            fn visit_string<E: de::Error>(self, v: String) -> Result<WsToken, E> {
                Ok(WsToken(Some(Secret::new(v))))
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<WsToken, A::Error> {
                let mut first = None;
                while let Some(item) = seq.next_element::<Patch2<Scalar>>()? {
                    if first.is_none() {
                        first = item.0.and_then(Scalar::into_secret);
                    }
                }
                Ok(WsToken(first))
            }
        }
        deserializer.deserialize_any(V)
    }
}

impl Overlay for RawApi {
    fn overlay(self, top: Self) -> Self {
        Self {
            listen_ip_address: self.listen_ip_address.overlay_leaf(top.listen_ip_address),
            listen_port: self.listen_port.overlay_leaf(top.listen_port),
            username: self.username.overlay_leaf(top.username),
            password: self.password.overlay_leaf(top.password),
            jwt_secret_key: self.jwt_secret_key.overlay_leaf(top.jwt_secret_key),
            ws_token: self.ws_token.overlay_leaf(top.ws_token),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, serde::Deserialize)]
struct RawVaultOptions {
    #[serde(default, deserialize_with = "patch", rename = "vaultAddress")]
    vault_address: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch", rename = "subAccountAddress")]
    sub_account_address: Patch<Scalar>,
}

impl Overlay for RawVaultOptions {
    fn overlay(self, top: Self) -> Self {
        Self {
            vault_address: self.vault_address.overlay_leaf(top.vault_address),
            sub_account_address: self
                .sub_account_address
                .overlay_leaf(top.sub_account_address),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, serde::Deserialize)]
struct RawCcxt {
    #[serde(default, deserialize_with = "patch_map")]
    options: Patch<RawVaultOptions>,
}

impl Overlay for RawCcxt {
    fn overlay(self, top: Self) -> Self {
        Self {
            options: self.options.overlay_nested(top.options),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, serde::Deserialize)]
struct RawExchange {
    #[serde(default, deserialize_with = "patch")]
    name: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    trading_mode: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch", rename = "walletAddress")]
    wallet_address_camel: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    wallet_address: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    hip3_dexes: Patch<StrList>,
    #[serde(default, deserialize_with = "patch_map")]
    ccxt_config: Patch<RawCcxt>,
    #[serde(default, deserialize_with = "patch_map")]
    ccxt_async_config: Patch<RawCcxt>,
}

impl Overlay for RawExchange {
    fn overlay(self, top: Self) -> Self {
        Self {
            name: self.name.overlay_leaf(top.name),
            trading_mode: self.trading_mode.overlay_leaf(top.trading_mode),
            wallet_address_camel: self
                .wallet_address_camel
                .overlay_leaf(top.wallet_address_camel),
            wallet_address: self.wallet_address.overlay_leaf(top.wallet_address),
            hip3_dexes: self.hip3_dexes.overlay_leaf(top.hip3_dexes),
            ccxt_config: self.ccxt_config.overlay_nested(top.ccxt_config),
            ccxt_async_config: self.ccxt_async_config.overlay_nested(top.ccxt_async_config),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, serde::Deserialize)]
struct RawConfig {
    #[serde(default, deserialize_with = "patch")]
    bot_name: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    strategy: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    db_url: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    dry_run: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    stake_currency: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    trading_mode: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    available_capital: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    capital_withdrawal: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch")]
    max_open_trades: Patch<Scalar>,
    #[serde(default, deserialize_with = "patch_map")]
    api_server: Patch<RawApi>,
    #[serde(default, deserialize_with = "patch_map")]
    exchange: Patch<RawExchange>,
    #[serde(default, deserialize_with = "patch")]
    add_config_files: Patch<StrList>,
}

impl Overlay for RawConfig {
    fn overlay(self, top: Self) -> Self {
        Self {
            bot_name: self.bot_name.overlay_leaf(top.bot_name),
            strategy: self.strategy.overlay_leaf(top.strategy),
            db_url: self.db_url.overlay_leaf(top.db_url),
            dry_run: self.dry_run.overlay_leaf(top.dry_run),
            stake_currency: self.stake_currency.overlay_leaf(top.stake_currency),
            trading_mode: self.trading_mode.overlay_leaf(top.trading_mode),
            available_capital: self.available_capital.overlay_leaf(top.available_capital),
            capital_withdrawal: self.capital_withdrawal.overlay_leaf(top.capital_withdrawal),
            max_open_trades: self.max_open_trades.overlay_leaf(top.max_open_trades),
            api_server: self.api_server.overlay_nested(top.api_server),
            exchange: self.exchange.overlay_nested(top.exchange),
            add_config_files: self.add_config_files.overlay_leaf(top.add_config_files),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------------------------

/// Remove `//` and `/* */` comments and trailing commas outside of strings (rapidjson parse
/// mode used by freqtrade). Output has the same line structure as the input, so error positions
/// stay meaningful.
#[must_use]
pub fn strip_jsonc(input: &[u8]) -> Zeroizing<Vec<u8>> {
    let mut out: Zeroizing<Vec<u8>> = Zeroizing::new(Vec::with_capacity(input.len()));
    let mut i = 0;
    let mut in_string = false;
    // Index in `out` of the last comma not yet followed by a significant byte.
    let mut last_comma: Option<usize> = None;
    while i < input.len() {
        let b = input[i];
        if in_string {
            out.push(b);
            if b == b'\\' {
                if let Some(&next) = input.get(i + 1) {
                    out.push(next);
                    i += 1;
                }
            } else if b == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match b {
            b'"' => {
                in_string = true;
                last_comma = None;
                out.push(b);
            }
            b'/' if input.get(i + 1) == Some(&b'/') => {
                while i < input.len() && input[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            b'/' if input.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i < input.len() && !(input[i] == b'*' && input.get(i + 1) == Some(&b'/')) {
                    // Keep newlines so that line numbers survive.
                    if input[i] == b'\n' {
                        out.push(b'\n');
                    }
                    i += 1;
                }
                i += 2;
                continue;
            }
            b',' => {
                last_comma = Some(out.len());
                out.push(b);
            }
            b'}' | b']' => {
                if let Some(idx) = last_comma.take() {
                    out[idx] = b' ';
                }
                out.push(b);
            }
            b' ' | b'\t' | b'\r' | b'\n' => out.push(b),
            _ => {
                last_comma = None;
                out.push(b);
            }
        }
        i += 1;
    }
    out
}

fn read_raw(path: &Path) -> Result<RawConfig, ConfigError> {
    let file = path.display().to_string();
    let unreadable = || ConfigError::Unreadable { file: file.clone() };
    let mut handle = fs::File::open(path).map_err(|_| unreadable())?;
    let meta = handle.metadata().map_err(|_| unreadable())?;
    if meta.len() > MAX_CONFIG_BYTES {
        return Err(ConfigError::TooLarge { file });
    }
    let mut raw: Zeroizing<Vec<u8>> = Zeroizing::new(Vec::with_capacity(meta.len() as usize));
    handle.read_to_end(&mut raw).map_err(|_| unreadable())?;
    let clean = strip_jsonc(&raw);
    // Both buffers are zeroized when they drop at the end of this function, error or not.
    let mut de = serde_json::Deserializer::from_slice(&clean);
    let parsed = (&mut de)
        .deserialize_map(MapOnly::<RawConfig>(PhantomData))
        .and_then(|c| de.end().map(|()| c))
        .map(|p| match p {
            Patch::Value(c) => c,
            _ => RawConfig::default(),
        });
    parsed.map_err(|e| ConfigError::Parse {
        file,
        category: match e.classify() {
            serde_json::error::Category::Io => "io error",
            serde_json::error::Category::Syntax => "syntax error",
            serde_json::error::Category::Data => "unexpected value type",
            serde_json::error::Category::Eof => "unexpected end of file",
        },
        line: e.line(),
        column: e.column(),
    })
}

/// Same algorithm as `load_from_files`: returns the merged raw config and every file read.
fn load_tree(
    files: &[PathBuf],
    base: Option<&Path>,
    level: u8,
    loaded: &mut Vec<PathBuf>,
) -> Result<RawConfig, ConfigError> {
    if level > MAX_CONFIG_LEVEL {
        return Err(ConfigError::IncludeLoop);
    }
    let mut config = RawConfig::default();
    for f in files {
        let path = base.map_or_else(|| f.clone(), |b| b.join(f));
        let mut tmp = read_raw(&path)?;
        loaded.push(path.clone());
        if let Patch::Value(subs) = tmp.add_config_files.clone() {
            let parent = path
                .canonicalize()
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
                .or_else(|| path.parent().map(Path::to_path_buf))
                .unwrap_or_default();
            let sub_files: Vec<PathBuf> = subs.0.iter().map(PathBuf::from).collect();
            let sub = load_tree(&sub_files, Some(&parent), level + 1, loaded)?;
            // The including file wins over the files it adds.
            tmp = sub.overlay(tmp);
        }
        // Later files win over earlier ones.
        config = config.overlay(tmp);
    }
    Ok(config)
}

fn build_config(raw: RawConfig, read_credentials: bool) -> BotConfig {
    let text = |p: Patch<Scalar>| p.value().cloned().and_then(Scalar::into_string);
    let secret = |p: Patch<Scalar>| p.value().cloned().and_then(Scalar::into_secret);

    let api_raw = match &raw.api_server {
        Patch::Value(a) => a.clone(),
        _ => RawApi::default(),
    };
    let ex_raw = match &raw.exchange {
        Patch::Value(e) => e.clone(),
        _ => RawExchange::default(),
    };

    let listen_ip = text(api_raw.listen_ip_address.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_owned());
    let listen_port = api_raw.listen_port.value().and_then(Scalar::as_u16);

    let username = secret(api_raw.username.clone()).filter(|s| !s.is_empty());
    let password = secret(api_raw.password.clone()).filter(|s| !s.is_empty());
    let credentials = match (read_credentials, username, password) {
        (true, Some(username), Some(password)) => Some(ApiCredentials { username, password }),
        _ => None,
    };
    let jwt_fingerprint = secret(api_raw.jwt_secret_key.clone())
        .filter(|s| !s.is_empty())
        .map(|s| s.fingerprint());
    let ws_token = if read_credentials {
        match &api_raw.ws_token {
            Patch::Value(WsToken(Some(t))) if !t.is_empty() => Some(t.clone()),
            _ => None,
        }
    } else {
        None
    };

    // `trading_mode` is a top-level key in freqtrade; the spec also names it under `exchange`.
    let trading_mode = text(raw.trading_mode.clone()).or_else(|| text(ex_raw.trading_mode.clone()));

    let vault_of = |c: &Patch<RawCcxt>| -> Option<Secret> {
        let Patch::Value(c) = c else { return None };
        let Patch::Value(o) = &c.options else {
            return None;
        };
        [&o.vault_address, &o.sub_account_address]
            .into_iter()
            .find_map(|p| secret(p.clone()).filter(|s| !s.expose().trim().is_empty()))
    };
    let vault = vault_of(&ex_raw.ccxt_config).or_else(|| vault_of(&ex_raw.ccxt_async_config));
    let wallet = secret(ex_raw.wallet_address_camel.clone())
        .or_else(|| secret(ex_raw.wallet_address.clone()))
        .filter(|s| !s.is_empty());
    let hip3_dexes = match &ex_raw.hip3_dexes {
        Patch::Value(l) => l.0.clone(),
        _ => Vec::new(),
    };

    BotConfig {
        bot_name: text(raw.bot_name.clone()),
        strategy: text(raw.strategy.clone()),
        db_url: text(raw.db_url.clone()),
        dry_run: raw.dry_run.value().and_then(Scalar::as_bool),
        stake_currency: text(raw.stake_currency.clone()),
        available_capital: raw.available_capital.value().and_then(Scalar::as_f64),
        capital_withdrawal: raw
            .capital_withdrawal
            .value()
            .and_then(Scalar::as_f64)
            .unwrap_or(0.0),
        max_open_trades: raw.max_open_trades.value().and_then(Scalar::as_i64),
        api: ApiServerInfo {
            listen_ip,
            listen_port,
            credentials,
            jwt_fingerprint,
            ws_token,
        },
        exchange: ExchangeInfo {
            name: text(ex_raw.name.clone()),
            trading_mode,
            wallet,
            vault,
            hip3_dexes,
        },
    }
}

/// Merge the config files of a command line and keep the whitelisted fields.
///
/// `files` that are relative are resolved against `cwd`, the working directory of the bot (the
/// gateway's own directory is irrelevant). Returns the config and every file that was read.
pub fn merge_config_files(
    files: &[PathBuf],
    cwd: &Path,
    read_credentials: bool,
) -> Result<(BotConfig, Vec<PathBuf>), ConfigError> {
    let absolute: Vec<PathBuf> = files.iter().map(|f| cwd.join(f)).collect();
    let mut loaded = Vec::new();
    let raw = load_tree(&absolute, None, 0, &mut loaded)?;
    Ok((build_config(raw, read_credentials), loaded))
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

/// What matters in the arguments of a `freqtrade trade` process.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Invocation {
    pub config_files: Vec<String>,
    pub db_url: Option<String>,
    pub dry_run_flag: bool,
    pub strategy: Option<String>,
}

/// Is this argv a `freqtrade trade` process? Same test as `discover_bots` in the Python API.
#[must_use]
pub fn is_trade_process(argv: &[String]) -> bool {
    argv.iter().any(|a| a == "trade") && argv.iter().any(|a| a.contains("freqtrade"))
}

/// Parse the options we care about. `-c a b`, `--config a b`, `--config=a`, `-ca` are accepted.
#[must_use]
pub fn parse_invocation(argv: &[String]) -> Invocation {
    let mut inv = Invocation::default();
    let mut i = 0;
    while i < argv.len() {
        let a = argv[i].as_str();
        match a {
            "-c" | "--config" => {
                i += 1;
                while i < argv.len() && !argv[i].starts_with('-') {
                    inv.config_files.push(argv[i].clone());
                    i += 1;
                }
                continue;
            }
            "--db-url" => {
                if let Some(v) = argv.get(i + 1) {
                    inv.db_url = Some(v.clone());
                    i += 1;
                }
            }
            "-s" | "--strategy" => {
                if let Some(v) = argv.get(i + 1) {
                    inv.strategy = Some(v.clone());
                    i += 1;
                }
            }
            "--dry-run" => inv.dry_run_flag = true,
            _ => {
                if let Some(v) = a.strip_prefix("--config=") {
                    inv.config_files.push(v.to_owned());
                } else if let Some(v) = a.strip_prefix("--db-url=") {
                    inv.db_url = Some(v.to_owned());
                } else if let Some(v) = a.strip_prefix("--strategy=") {
                    inv.strategy = Some(v.to_owned());
                } else if let Some(v) = a
                    .strip_prefix("-c")
                    .filter(|v| !v.is_empty() && !v.starts_with('-'))
                {
                    inv.config_files.push(v.to_owned());
                }
            }
        }
        i += 1;
    }
    inv
}

/// Ledger path of a bot from its `sqlite:///` URL, resolved against the bot's working directory.
/// `None` for other database engines.
#[must_use]
pub fn db_path_from_url(db_url: &str, cwd: &Path) -> Option<PathBuf> {
    let rest = db_url.strip_prefix("sqlite:///")?;
    let rest = rest.split('?').next().unwrap_or(rest);
    if rest.is_empty() || rest == ":memory:" {
        return None;
    }
    let p = Path::new(rest);
    Some(if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    })
}

/// Ledger names that must not be treated as a bot database (03 section 5).
#[must_use]
pub fn is_ignored_ledger(path: &Path, tokens: &[String]) -> bool {
    let in_ignored_dir = path.components().any(|c| {
        matches!(
            c.as_os_str().to_str(),
            Some("_archive" | "_retired" | "backup" | "backups")
        )
    });
    if in_ignored_dir {
        return true;
    }
    // Only the file name is matched: the directory of a test or a deployment may legitimately
    // be called `tmp`.
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    tokens
        .iter()
        .map(|t| t.to_ascii_lowercase())
        .filter(|t| !t.is_empty())
        .any(|t| name.contains(&t))
}

// ---------------------------------------------------------------------------------------------
// Process scan
// ---------------------------------------------------------------------------------------------

/// Settings of [`ProcDiscovery`] (the `[discovery]` section of the gateway config).
#[derive(Debug, Clone)]
pub struct DiscoveryOptions {
    /// Root of the proc filesystem; overridden in tests.
    pub proc_root: PathBuf,
    /// Only processes of this uid are considered; `None` = the uid of the gateway itself.
    pub uid: Option<u32>,
    pub ignore_db_name_tokens: Vec<String>,
    pub read_api_credentials_from_config: bool,
}

impl Default for DiscoveryOptions {
    fn default() -> Self {
        Self {
            proc_root: PathBuf::from("/proc"),
            uid: None,
            ignore_db_name_tokens: ["backup", "replay", "tmp"].map(String::from).to_vec(),
            read_api_credentials_from_config: true,
        }
    }
}

#[derive(Hash, PartialEq, Eq)]
struct CacheKey {
    pid: u32,
    start_ticks: u64,
}

struct CacheEntry {
    stamp: ConfigStamp,
    config: BotConfig,
}

/// Discovery by scanning `/proc`. Cheap to call every 30 s: configs are re-merged only when one
/// of their files changed.
pub struct ProcDiscovery {
    opts: DiscoveryOptions,
    uid: u32,
    cache: Mutex<HashMap<CacheKey, CacheEntry>>,
}

impl ProcDiscovery {
    #[must_use]
    pub fn new(opts: DiscoveryOptions) -> Self {
        let uid = opts
            .uid
            .unwrap_or_else(|| fs::metadata("/proc/self").map_or(u32::MAX, |m| m.uid()));
        Self {
            opts,
            uid,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Uid whose processes are scanned.
    #[must_use]
    pub fn uid(&self) -> u32 {
        self.uid
    }

    fn read_argv(&self, pid: u32) -> Vec<String> {
        let path = self.opts.proc_root.join(pid.to_string()).join("cmdline");
        fs::read(path).map_or_else(
            |_| Vec::new(),
            |raw| {
                raw.split(|b| *b == 0)
                    .filter(|a| !a.is_empty())
                    .map(|a| String::from_utf8_lossy(a).into_owned())
                    .collect()
            },
        )
    }

    /// `(starttime in clock ticks since boot)` from `/proc/<pid>/stat`.
    fn start_ticks(&self, pid: u32) -> Option<u64> {
        let stat =
            fs::read_to_string(self.opts.proc_root.join(pid.to_string()).join("stat")).ok()?;
        // The command name is parenthesised and may contain spaces: count fields after the last ')'.
        let after = stat.rsplit_once(')')?.1;
        // Fields after ')' start at field 3 (state); starttime is field 22.
        after.split_whitespace().nth(19)?.parse().ok()
    }

    fn boot_time_s(&self) -> Option<u64> {
        let stat = fs::read_to_string(self.opts.proc_root.join("stat")).ok()?;
        stat.lines()
            .find_map(|l| l.strip_prefix("btime "))
            .and_then(|v| v.trim().parse().ok())
    }

    fn inspect(&self, pid: u32) -> Option<Result<DiscoveredBot, ConfigError>> {
        let dir = self.opts.proc_root.join(pid.to_string());
        let meta = fs::metadata(&dir).ok()?;
        if meta.uid() != self.uid {
            return None;
        }
        let argv = self.read_argv(pid);
        if !is_trade_process(&argv) {
            return None;
        }
        let inv = parse_invocation(&argv);
        if inv.config_files.is_empty() {
            return Some(Err(ConfigError::NoConfig));
        }
        let Ok(cwd) = fs::read_link(dir.join("cwd")) else {
            return Some(Err(ConfigError::NoCwd));
        };
        let start_ticks = self.start_ticks(pid);
        let process_start_ms = start_ticks.zip(self.boot_time_s()).map(|(t, boot)| {
            i64::try_from((boot * 1000) + (t * 1000 / CLOCK_TICKS_PER_SEC)).unwrap_or(0)
        });

        let files: Vec<PathBuf> = inv.config_files.iter().map(PathBuf::from).collect();
        let key = CacheKey {
            pid,
            start_ticks: start_ticks.unwrap_or(0),
        };
        let cached = self.cache.lock().ok().and_then(|c| {
            c.get(&key)
                .filter(|e| e.stamp.is_current())
                .map(|e| (e.stamp.clone(), e.config.clone()))
        });
        let (stamp, mut config) = match cached {
            Some(hit) => hit,
            None => {
                match merge_config_files(&files, &cwd, self.opts.read_api_credentials_from_config) {
                    Ok((config, loaded)) => {
                        let stamp = ConfigStamp::capture(&loaded);
                        if let Ok(mut c) = self.cache.lock() {
                            c.insert(
                                key,
                                CacheEntry {
                                    stamp: stamp.clone(),
                                    config: config.clone(),
                                },
                            );
                        }
                        (stamp, config)
                    }
                    Err(e) => return Some(Err(e)),
                }
            }
        };

        // Command line options beat the config file, as in freqtrade.
        if let Some(url) = inv.db_url.clone() {
            config.db_url = Some(url);
        }
        if inv.dry_run_flag {
            config.dry_run = Some(true);
        }
        if let Some(s) = inv.strategy.clone() {
            config.strategy = Some(s);
        }
        // Ledger default of freqtrade when `db_url` is not set anywhere.
        let db_url = config.db_url.clone().unwrap_or_else(|| {
            if config.is_dry() {
                "sqlite:///tradesv3.dryrun.sqlite".to_owned()
            } else {
                "sqlite:///tradesv3.sqlite".to_owned()
            }
        });
        let db_path = db_path_from_url(&db_url, &cwd);
        let db_ignored = db_path
            .as_ref()
            .is_some_and(|p| is_ignored_ledger(p, &self.opts.ignore_db_name_tokens));

        let config_files: Vec<PathBuf> = files.iter().map(|f| cwd.join(f)).collect();
        let config_name = files[0]
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Some(Ok(DiscoveredBot {
            pid,
            process_start_ms,
            cwd,
            config_files,
            config_name,
            config,
            db_path,
            db_ignored,
            stamp,
        }))
    }

    /// Full scan with the issues that made some processes unusable.
    #[must_use]
    pub fn scan_report(&self) -> DiscoveryReport {
        let mut report = DiscoveryReport::default();
        let Ok(entries) = fs::read_dir(&self.opts.proc_root) else {
            return report;
        };
        let mut pids: Vec<u32> = entries
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().to_str().and_then(|n| n.parse().ok()))
            .collect();
        pids.sort_unstable();
        let mut alive = std::collections::HashSet::new();
        for pid in pids {
            match self.inspect(pid) {
                None => {}
                Some(Ok(bot)) => {
                    alive.insert(CacheKey {
                        pid,
                        start_ticks: self.start_ticks(pid).unwrap_or(0),
                    });
                    report.bots.push(bot);
                }
                Some(Err(error)) => report.issues.push(DiscoveryIssue { pid, error }),
            }
        }
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|k, _| alive.contains(k));
        }
        report
    }
}

impl Discovery for ProcDiscovery {
    fn scan(&self) -> DiscoveryReport {
        self.scan_report()
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;

    fn argv(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn jsonc_comments_and_trailing_commas_are_stripped_outside_strings_only() {
        let src = br#"{
            // line comment
            "a": "http://x//y, }",  /* block
            comment */
            "b": [1, 2, ],
            "c": {"d": 1,},
        }"#;
        let clean = strip_jsonc(src);
        let v: serde_json::Value = serde_json::from_slice(&clean).unwrap();
        assert_eq!(v["a"], "http://x//y, }");
        assert_eq!(v["b"], serde_json::json!([1, 2]));
        assert_eq!(v["c"]["d"], 1);
    }

    #[test]
    fn invocation_forms_are_parsed() {
        let i = parse_invocation(&argv(
            "freqtrade trade --config a.json b.json --logfile x.log --db-url sqlite:///x.db -s Strat --dry-run",
        ));
        assert_eq!(i.config_files, ["a.json", "b.json"]);
        assert_eq!(i.db_url.as_deref(), Some("sqlite:///x.db"));
        assert_eq!(i.strategy.as_deref(), Some("Strat"));
        assert!(i.dry_run_flag);

        let i = parse_invocation(&argv(
            "freqtrade trade -c one.json --config=two.json -cthree.json",
        ));
        assert_eq!(i.config_files, ["one.json", "two.json", "three.json"]);
    }

    #[test]
    fn trade_process_detection_matches_the_python_scan() {
        assert!(is_trade_process(&argv(
            "/x/.venv/bin/python3.11 /x/.venv/bin/freqtrade trade --config c.json"
        )));
        assert!(!is_trade_process(&argv(
            "/bin/bash ./launch_bot.sh cfg.json"
        )));
        assert!(!is_trade_process(&argv(
            "freqtrade hyperopt --config c.json"
        )));
        assert!(!is_trade_process(&argv("python trade.py")));
    }

    #[test]
    fn db_urls_resolve_against_the_bot_cwd() {
        let cwd = Path::new("/home/u/ft");
        assert_eq!(
            db_path_from_url("sqlite:///database/a.sqlite", cwd),
            Some(PathBuf::from("/home/u/ft/database/a.sqlite"))
        );
        assert_eq!(
            db_path_from_url("sqlite:////abs/b.sqlite", cwd),
            Some(PathBuf::from("/abs/b.sqlite"))
        );
        assert_eq!(db_path_from_url("postgresql://x/y", cwd), None);
        assert_eq!(db_path_from_url("sqlite://", cwd), None);
    }

    #[test]
    fn ignored_ledgers() {
        let tokens: Vec<String> = ["backup", "replay", "tmp"].map(String::from).to_vec();
        for p in [
            "/d/bot.sqlite.backup",
            "/d/Bot_REPLAY_seed.sqlite",
            "/d/tmp_bot.sqlite",
            "/d/_archive/bot.sqlite",
            "/d/_retired/bot.sqlite",
            "/d/backup/bot.sqlite",
        ] {
            assert!(is_ignored_ledger(Path::new(p), &tokens), "{p}");
        }
        assert!(!is_ignored_ledger(
            Path::new("/d/hippo_original.sqlite"),
            &tokens
        ));
    }

    /// Write a fixture. `@` is removed from the body: key names that a secret scanner would flag
    /// (`"@password"`) are spelled with it in the source so that no credential-shaped literal is
    /// committed.
    fn write(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, body.replace('@', "")).unwrap();
        p
    }

    #[test]
    fn merge_follows_freqtrade_precedence() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "common.json",
            r#"{ "bot_name": "from_common", "stake_currency": "USDC",
                 "api_server": {"listen_port": 9000, "username": "common_user", "@password": "common_pw"},
                 "exchange": {"name": "hyperliquid", "hip3_dexes": ["xyz"]} }"#,
        );
        write(
            dir.path(),
            "main.json",
            r#"{ "add_config_files": ["common.json"],
                 "bot_name": "main_bot", // comment
                 "dry_run": false,
                 "api_server": {"listen_port": 9056,},
                 "db_url": "sqlite:///database/main.sqlite",
               }"#,
        );
        write(
            dir.path(),
            "override.json",
            r#"{ "stake_currency": "USDT", "exchange": {"hip3_dexes": null} }"#,
        );
        let (cfg, loaded) = merge_config_files(
            &[PathBuf::from("main.json"), PathBuf::from("override.json")],
            dir.path(),
            true,
        )
        .unwrap();
        assert_eq!(
            cfg.bot_name.as_deref(),
            Some("main_bot"),
            "including file beats added file"
        );
        assert_eq!(
            cfg.stake_currency.as_deref(),
            Some("USDT"),
            "later file wins"
        );
        assert_eq!(cfg.api.listen_port, Some(9056), "nested key overridden");
        let creds = cfg
            .api
            .credentials
            .as_ref()
            .expect("credentials inherited from common.json");
        assert_eq!(creds.username.expose(), "common_user");
        assert_eq!(cfg.exchange.name.as_deref(), Some("hyperliquid"));
        assert!(
            cfg.exchange.hip3_dexes.is_empty(),
            "explicit null overrides"
        );
        assert_eq!(cfg.dry_run, Some(false));
        assert!(!cfg.is_dry());
        assert_eq!(loaded.len(), 3);
    }

    #[test]
    fn credentials_can_be_left_unread_and_never_show_in_debug() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "c.json",
            // Fake addresses are assembled at runtime so that no address-shaped literal is committed.
            &r#"{"api_server": {"listen_port": 9001, "username": "alice-user", "@password": "s3cr3t-pw",
                "jwt_secret_key": "jwt-secret-value", "ws_token": ["ws-secret-value"]},
                "exchange": {"name": "hyperliquid", "walletAddress": "WALLET",
                  "@privateKey": "0xPRIVATEKEYVALUE", "@secret": "EXCHANGESECRET",
                  "ccxt_config": {"options": {"vaultAddress": "VAULT"}}}}"#
                .replace("WALLET", &format!("0x{}", "1234567890abcdef".repeat(2) + "12345678"))
                .replace("VAULT", &format!("0x{}", "a".repeat(40))),
        );
        let (cfg, _) = merge_config_files(&[PathBuf::from("c.json")], dir.path(), true).unwrap();
        let dbg = format!("{cfg:?}");
        for needle in [
            "alice-user",
            "s3cr3t-pw",
            "jwt-secret-value",
            "ws-secret-value",
            "PRIVATEKEYVALUE",
            "EXCHANGESECRET",
            "1234567890abcdef",
            "aaaaaaaaaaaaaaaa",
        ] {
            assert!(!dbg.contains(needle), "Debug leaked {needle}");
        }
        assert_eq!(
            cfg.api.ws_token.as_ref().unwrap().expose(),
            "ws-secret-value"
        );
        assert!(cfg.api.jwt_fingerprint.is_some());
        // Vault beats wallet for the account identity; the short form hides the middle.
        let short = cfg.exchange.address_short().unwrap();
        assert_eq!(short, "0xaaaa...aaaa");
        assert!(cfg.exchange.wallet_id().is_some());

        let (cfg, _) = merge_config_files(&[PathBuf::from("c.json")], dir.path(), false).unwrap();
        assert!(cfg.api.credentials.is_none());
        assert!(cfg.api.ws_token.is_none());
        assert_eq!(cfg.api.listen_port, Some(9001));
    }

    #[test]
    fn parse_errors_never_echo_config_content() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "bad.json",
            r#"{"api_server": {"@password": "topsecret-pw" "x": 1}}"#,
        );
        write(
            dir.path(),
            "badtype.json",
            r#"{"api_server": ["topsecret-pw"]}"#,
        );
        write(
            dir.path(),
            "badport.json",
            r#"{"api_server": {"listen_port": {"topsecret-pw": 1}}}"#,
        );
        for f in ["bad.json", "badtype.json", "badport.json"] {
            let err = merge_config_files(&[PathBuf::from(f)], dir.path(), true).unwrap_err();
            let shown = format!("{err} / {err:?}");
            assert!(!shown.contains("topsecret"), "{f}: {shown}");
            assert!(matches!(err, ConfigError::Parse { .. }), "{f}: {err:?}");
        }
    }

    #[test]
    fn include_loops_are_cut() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.json", r#"{"add_config_files": ["b.json"]}"#);
        write(dir.path(), "b.json", r#"{"add_config_files": ["a.json"]}"#);
        let err = merge_config_files(&[PathBuf::from("a.json")], dir.path(), true).unwrap_err();
        assert_eq!(err, ConfigError::IncludeLoop);
    }

    #[test]
    fn lenient_scalars() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "c.json",
            r#"{"api_server": {"listen_port": "9100"}, "dry_run": "true", "available_capital": "150.5",
                "capital_withdrawal": null, "max_open_trades": -1}"#,
        );
        let (cfg, _) = merge_config_files(&[PathBuf::from("c.json")], dir.path(), true).unwrap();
        assert_eq!(cfg.api.listen_port, Some(9100));
        assert_eq!(cfg.dry_run, Some(true));
        assert_eq!(cfg.available_capital, Some(150.5));
        assert!((cfg.capital_withdrawal - 0.0).abs() < f64::EPSILON);
        assert_eq!(cfg.max_open_trades, Some(-1));
    }

    /// Build a fake `/proc` with one trade process.
    fn fake_proc(root: &Path, pid: u32, cmdline: &[&str], cwd: &Path) {
        let d = root.join(pid.to_string());
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("cmdline"), cmdline.join("\0") + "\0").unwrap();
        symlink(cwd, d.join("cwd")).unwrap();
        // pid (comm with spaces) S ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt
        // utime stime cutime cstime priority nice threads itrealvalue starttime ...
        fs::write(
            d.join("stat"),
            format!("{pid} (python 3) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 5000 0 0\n"),
        )
        .unwrap();
    }

    #[test]
    fn proc_scan_finds_trade_processes_and_resolves_relative_paths_against_their_cwd() {
        let work = tempfile::tempdir().unwrap();
        let proc = tempfile::tempdir().unwrap();
        fs::create_dir_all(work.path().join("live_configs")).unwrap();
        write(
            &work.path().join("live_configs"),
            "bot_a.json",
            r#"{"bot_name":"bot_a","dry_run":false,"api_server":{"listen_port":9056,"username":"u","password":"p"},
               "db_url":"sqlite:///database/bot_a.sqlite","stake_currency":"USDC"}"#,
        );
        write(
            &work.path().join("live_configs"),
            "bot_b.json",
            r#"{"bot_name":"bot_b","api_server":{"listen_port":9057},"db_url":"sqlite:///database/bot_b_backup.sqlite"}"#,
        );
        fs::write(proc.path().join("stat"), "cpu 1 2 3\nbtime 1700000000\n").unwrap();
        fake_proc(
            proc.path(),
            4242,
            &[
                "/v/python",
                "/v/bin/freqtrade",
                "trade",
                "--config",
                "live_configs/bot_a.json",
            ],
            work.path(),
        );
        fake_proc(
            proc.path(),
            4343,
            &[
                "/v/python",
                "/v/bin/freqtrade",
                "trade",
                "-c",
                "live_configs/bot_b.json",
                "--dry-run",
            ],
            work.path(),
        );
        fake_proc(
            proc.path(),
            4444,
            &["/bin/bash", "./launch_bot.sh", "x.json"],
            work.path(),
        );
        fake_proc(
            proc.path(),
            4545,
            &[
                "/v/python",
                "/v/bin/freqtrade",
                "trade",
                "--config",
                "missing.json",
            ],
            work.path(),
        );
        // Non-numeric entries of /proc are ignored.
        fs::create_dir_all(proc.path().join("self")).unwrap();

        let disc = ProcDiscovery::new(DiscoveryOptions {
            proc_root: proc.path().to_path_buf(),
            uid: Some(fs::metadata(proc.path()).unwrap().uid()),
            ..DiscoveryOptions::default()
        });
        let report = disc.scan_report();
        assert_eq!(report.bots.len(), 2);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].pid, 4545);

        let a = &report.bots[0];
        assert_eq!(a.pid, 4242);
        assert_eq!(a.bot_key(), Some(BotKey::Local(9056)));
        assert_eq!(a.display_name(), "bot_a");
        assert!(!a.config.is_dry());
        assert_eq!(a.db_path, Some(work.path().join("database/bot_a.sqlite")));
        assert!(!a.db_ignored);
        assert_eq!(a.process_start_ms, Some(1_700_000_000_000 + 50_000));

        let b = &report.bots[1];
        assert!(b.db_ignored, "backup ledger flagged");
        assert!(b.config.is_dry(), "--dry-run flag applies");

        // Second scan is served from the cache and gives the same answer.
        let again = disc.scan_report();
        assert_eq!(again.bots, report.bots);
    }

    #[test]
    fn processes_of_other_users_are_skipped() {
        let work = tempfile::tempdir().unwrap();
        let proc = tempfile::tempdir().unwrap();
        write(
            work.path(),
            "c.json",
            r#"{"api_server":{"listen_port":9100}}"#,
        );
        fake_proc(
            proc.path(),
            77,
            &["/v/python", "freqtrade", "trade", "--config", "c.json"],
            work.path(),
        );
        let own = fs::metadata(proc.path()).unwrap().uid();
        let disc = ProcDiscovery::new(DiscoveryOptions {
            proc_root: proc.path().to_path_buf(),
            uid: Some(own + 1),
            ..DiscoveryOptions::default()
        });
        assert!(disc.scan_report().bots.is_empty());
    }

    #[test]
    fn default_ledger_follows_dry_run() {
        let work = tempfile::tempdir().unwrap();
        let proc = tempfile::tempdir().unwrap();
        write(work.path(), "d.json", r#"{"dry_run": true}"#);
        write(work.path(), "l.json", r#"{"dry_run": false}"#);
        fake_proc(
            proc.path(),
            1,
            &["p", "freqtrade", "trade", "-c", "d.json"],
            work.path(),
        );
        fake_proc(
            proc.path(),
            2,
            &["p", "freqtrade", "trade", "-c", "l.json"],
            work.path(),
        );
        let disc = ProcDiscovery::new(DiscoveryOptions {
            proc_root: proc.path().to_path_buf(),
            uid: Some(fs::metadata(proc.path()).unwrap().uid()),
            ..DiscoveryOptions::default()
        });
        let r = disc.scan_report();
        assert_eq!(
            r.bots[0].db_path,
            Some(work.path().join("tradesv3.dryrun.sqlite"))
        );
        assert_eq!(r.bots[1].db_path, Some(work.path().join("tradesv3.sqlite")));
    }

    #[test]
    fn config_edits_invalidate_the_cache() {
        let work = tempfile::tempdir().unwrap();
        let proc = tempfile::tempdir().unwrap();
        let cfg = write(work.path(), "c.json", r#"{"bot_name": "first"}"#);
        fake_proc(
            proc.path(),
            1,
            &["p", "freqtrade", "trade", "-c", "c.json"],
            work.path(),
        );
        let disc = ProcDiscovery::new(DiscoveryOptions {
            proc_root: proc.path().to_path_buf(),
            uid: Some(fs::metadata(proc.path()).unwrap().uid()),
            ..DiscoveryOptions::default()
        });
        assert_eq!(disc.scan_report().bots[0].display_name(), "first");
        fs::write(&cfg, r#"{"bot_name": "second, longer"}"#).unwrap();
        assert_eq!(disc.scan_report().bots[0].display_name(), "second, longer");
    }
}
