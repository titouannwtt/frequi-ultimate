export interface RateTimelineBucket {
  ts: number;
  total: number;
  cached: number;
  direct: number;
  errors: number;
  errors_429: number;
  avg_latency_ms: number;
  by_method: Record<string, number>;
}

export interface RateLimitEvent {
  ts: number;
  method: string;
  exchange: string;
  pair?: string;
}

export interface MethodStats {
  count: number;
  cached: number;
  direct: number;
  errors: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
}

export interface TokenBucketState {
  tokens_available: number;
  tokens_max: number;
  refill_rate: number;
  backoff_active: boolean;
  backoff_factor: number;
  backoff_remaining_s: number;
  queue_depths: Record<string, number>;
}

export interface RateMetricsSummary {
  total: number;
  cached: number;
  direct: number;
  errors: number;
  errors_429: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  by_method: Record<string, MethodStats>;
}

export interface FtcacheExtended {
  requests_total: number;
  cache_hits: number;
  cache_partial: number;
  cache_misses: number;
  acquire_total: number;
  tickers_requests: number;
  tickers_cache_hits: number;
  tickers_fetches: number;
  positions_puts: number;
  positions_gets: number;
  positions_cache_hits: number;
  cache_hit_rate_pct: number;
  tickers_hit_rate_pct: number;
  positions_hit_rate_pct: number;
}

export interface RateMetricsResponse {
  exchange: string;
  timeline: RateTimelineBucket[];
  current: TokenBucketState;
  recent_429s: RateLimitEvent[];
  summary: RateMetricsSummary;
  ftcache_extended: FtcacheExtended;
}
