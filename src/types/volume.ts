export interface VolumeBucket {
  date: string;
  exchange_volume: number;
  bot_volume: number;
  trade_count: number;
  abs_profit: number;
}

export interface VolumeHistoryResponse {
  buckets: VolumeBucket[];
  exchange_name: string;
  stake_currency: string;
  whitelist_count: number;
  data_coverage_pct: number;
  anomaly_threshold_high: number;
  anomaly_threshold_low: number;
}

export type VolumeBucketSize = '1d' | '3d' | '7d' | '1M' | '1Q';
