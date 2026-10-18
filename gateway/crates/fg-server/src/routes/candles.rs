//! `GET /candles`: historical candles of a pair, read from the feather files of this host (see
//! [`fg_sources::candles`]). Read only, no call to the exchange: the chart of the UI uses it to
//! go back before the window a bot holds in memory and to show a timeframe the bot does not run.

use axum::Json;
use axum::extract::State;
use fg_core::protocol::ErrorCode;
use fg_sources::candles::{Row, pair_stem, timeframe};
use serde::{Deserialize, Serialize};

use crate::error::{ApiFailure, ApiQuery};
use crate::state::AppState;

/// Candles in a page when `limit` is not given.
const DEFAULT_LIMIT: i64 = 1_000;
/// The most candles a page holds.
const MAX_LIMIT: i64 = 5_000;

#[derive(Debug, Deserialize)]
pub struct CandlesParams {
    /// `BTC/USDC:USDC`.
    pair: Option<String>,
    /// One of the timeframes of [`fg_sources::candles::TIMEFRAMES`].
    tf: Option<String>,
    /// Milliseconds since the epoch, exclusive: only candles that open before it.
    end: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CandlesBody {
    pub pair: String,
    pub tf: &'static str,
    /// `[ts_ms, open, high, low, close, volume]`, oldest first.
    pub candles: Vec<Row>,
    /// Older candles exist than the first one of `candles`.
    pub has_more: bool,
    pub first_available_ms: Option<i64>,
    pub resampled_from: Option<&'static str>,
}

pub async fn candles(
    State(st): State<AppState>,
    ApiQuery(q): ApiQuery<CandlesParams>,
) -> Result<Json<CandlesBody>, ApiFailure> {
    let pair = q
        .pair
        .ok_or_else(|| ApiFailure::bad_request("pair is required"))?;
    let stem = pair_stem(&pair).ok_or_else(|| ApiFailure::bad_request("not a pair name"))?;
    let tf =
        q.tf.as_deref()
            .and_then(timeframe)
            .ok_or_else(|| ApiFailure::bad_request("tf is not a supported timeframe"))?;
    let limit = usize::try_from(q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT))
        .unwrap_or(DEFAULT_LIMIT as usize);
    let end = q.end;

    // Reading and decoding a file blocks: not on the async workers.
    let store = std::sync::Arc::clone(&st.candles);
    let page = tokio::task::spawn_blocking(move || store.page(&stem, tf, end, limit))
        .await
        .map_err(|_| ApiFailure::new(ErrorCode::Internal, "cannot read the candles"))?;
    Ok(Json(CandlesBody {
        pair,
        tf: tf.name,
        candles: page.bars.into_iter().map(Row::from).collect(),
        has_more: page.has_more,
        first_available_ms: page.first_available_ms,
        resampled_from: page.resampled_from,
    }))
}
