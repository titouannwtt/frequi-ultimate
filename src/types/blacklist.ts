export interface BlacklistPayload {
  blacklist: Array<string>;
}

export interface BlacklistErrMsg {
  error_msg: string;
}

export interface BlacklistResponse {
  method: Array<string>;
  length: number;
  blacklist: Array<string>;
  errors: Record<string, BlacklistErrMsg>;
}

export interface PipelineStep {
  handler: string;
  count_after: number;
  pairs_removed: string[];
}

export interface WhitelistResponse {
  method: Array<string>;
  length: number;
  whitelist: Array<string>;
  handler_configs?: Record<string, any>[];
  pipeline?: PipelineStep[];
  total_market_pairs?: number;
  added_pairs?: string[];
}
