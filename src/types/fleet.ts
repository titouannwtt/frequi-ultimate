export interface FleetBotStatus {
  bot_id: string;
  config_file: string;
  exchange: string;
  trading_mode: string;
  strategy: string;
  timeframe: string;
  pairs_count: number;
  state: 'initializing' | 'running' | 'paused' | 'stopped' | 'crashed';
  uptime_s: number;
  last_heartbeat_ago_s: number;
  pid: number;
  api_port: number;
  dry_run: boolean;
}

export interface FleetDaemonInfo {
  uptime_s: number;
  socket_path: string;
  active_connections: number;
  total_series: number;
  total_events: number;
}

export interface FleetRateLimiterInfo {
  tokens_available: number;
  tokens_max: number;
  backoff_active: boolean;
  shed_count: number;
  backoff_count: number;
}

export interface FleetStatusResponse {
  daemon: FleetDaemonInfo;
  bots: FleetBotStatus[];
  rate_limiters: Record<string, FleetRateLimiterInfo>;
  recent_events_count: Record<string, number>;
  error?: string;
}

export interface FleetEvent {
  ts: number;
  event_type: string;
  bot_id: string | null;
  details: Record<string, unknown>;
}

export interface FleetEventsResponse {
  events: FleetEvent[];
  error?: string;
}
