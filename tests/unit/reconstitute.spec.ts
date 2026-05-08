import { describe, it, expect } from 'vitest';
import {
  parseTimerangeToDates,
  formatDateToTimerange,
  runTypeToJobType,
  buildPrefillFromBacktest,
  buildPrefillFromHyperopt,
  buildPrefillFromWfa,
  buildPrefillFromLiveBot,
} from '@/utils/reconstitute';
import { JobType, RunType } from '@/types';
import type { RunListEntry, BacktestSnapshotResponse } from '@/types';

describe('reconstitute.ts', () => {
  describe('parseTimerangeToDates', () => {
    it('parses YYYYMMDD-YYYYMMDD format', () => {
      const result = parseTimerangeToDates('20240101-20240630');
      expect(result).toEqual({ from: '2024-01-01', to: '2024-06-30' });
    });

    it('returns null for multi-dash format (not a valid freqtrade timerange)', () => {
      expect(parseTimerangeToDates('2024-01-01-2024-06-30')).toBeNull();
    });

    it('returns null for invalid format', () => {
      expect(parseTimerangeToDates('')).toBeNull();
      expect(parseTimerangeToDates('20240101')).toBeNull();
    });
  });

  describe('formatDateToTimerange', () => {
    it('formats a date to YYYYMMDD', () => {
      const date = new Date(2024, 5, 15);
      expect(formatDateToTimerange(date)).toBe('20240615');
    });

    it('pads single-digit month and day', () => {
      const date = new Date(2024, 0, 5);
      expect(formatDateToTimerange(date)).toBe('20240105');
    });
  });

  describe('runTypeToJobType', () => {
    it('maps backtest to backtest', () => {
      expect(runTypeToJobType(RunType.backtest)).toBe(JobType.backtest);
    });
    it('maps hyperopt to hyperopt', () => {
      expect(runTypeToJobType(RunType.hyperopt)).toBe(JobType.hyperopt);
    });
    it('maps wfa to walk-forward', () => {
      expect(runTypeToJobType(RunType.wfa)).toBe(JobType.wfa);
    });
    it('returns null for live', () => {
      expect(runTypeToJobType(RunType.live)).toBeNull();
    });
  });

  describe('buildPrefillFromBacktest', () => {
    const baseRun: RunListEntry = {
      run_type: RunType.backtest,
      filename: 'bt_result.json',
      strategy: 'HippoDCA',
      timestamp: 1700000000,
      timeframe: '15m',
      timerange: '20240101-20240630',
      has_metadata: true,
    };

    it('extracts strategy, timeframe, timerange from run', () => {
      const result = buildPrefillFromBacktest(baseRun, null);
      expect(result.job_type).toBe(JobType.backtest);
      expect(result.strategy).toBe('HippoDCA');
      expect(result.timeframe).toBe('15m');
      expect(result.timerange).toBe('20240101-20240630');
    });

    it('extracts config from snapshot', () => {
      const snapshot: BacktestSnapshotResponse = {
        config: {
          config_files: ['backtest_configs/test.json'],
          max_open_trades: 5,
          dry_run_wallet: 1000,
          stake_amount: 'unlimited',
        },
      };
      const result = buildPrefillFromBacktest(baseRun, snapshot);
      expect(result.config_file).toBe('backtest_configs/test.json');
      expect(result.max_open_trades).toBe(5);
      expect(result.dry_run_wallet).toBe(1000);
      expect(result.stake_amount).toBe('unlimited');
    });

    it('handles missing snapshot gracefully', () => {
      const result = buildPrefillFromBacktest(baseRun, null);
      expect(result.config_file).toBeUndefined();
      expect(result.max_open_trades).toBeUndefined();
    });
  });

  describe('buildPrefillFromHyperopt', () => {
    const baseRun: RunListEntry = {
      run_type: RunType.hyperopt,
      filename: 'hyperopt_result.json',
      strategy: 'HippoDCA',
      timestamp: 1700000000,
      timeframe: '15m',
      timerange: '20240101-20240630',
      has_metadata: true,
    };

    it('extracts hyperopt-specific fields', () => {
      const detail = {
        config_file: 'backtest_configs/test.json',
        hyperopt_loss: 'CalmarHyperOptLoss',
        epochs_total: 1000,
        spaces: ['buy', 'sell'],
        max_open_trades: 3,
        stake_amount: '100',
      };
      const result = buildPrefillFromHyperopt(baseRun, detail);
      expect(result.job_type).toBe(JobType.hyperopt);
      expect(result.hyperopt_loss).toBe('CalmarHyperOptLoss');
      expect(result.epochs).toBe(1000);
      expect(result.spaces).toEqual(['buy', 'sell']);
      expect(result.max_open_trades).toBe(3);
    });

    it('handles null detail', () => {
      const result = buildPrefillFromHyperopt(baseRun, null);
      expect(result.job_type).toBe(JobType.hyperopt);
      expect(result.strategy).toBe('HippoDCA');
      expect(result.epochs).toBeUndefined();
    });
  });

  describe('buildPrefillFromWfa', () => {
    const baseRun: RunListEntry = {
      run_type: RunType.wfa,
      filename: 'wfa_result.json',
      strategy: 'HippoDCA',
      timestamp: 1700000000,
      timeframe: '15m',
      timerange: '20240101-20240630',
      has_metadata: true,
    };

    it('extracts WFA-specific fields', () => {
      const detail = {
        config_file: 'backtest_configs/test.json',
        hyperopt_loss: 'SharpeHyperOptLoss',
        epochs_per_window: 200,
        n_windows: 4,
        spaces: ['buy', 'stoploss'],
      };
      const result = buildPrefillFromWfa(baseRun, detail);
      expect(result.job_type).toBe(JobType.wfa);
      expect(result.epochs).toBe(200);
      expect(result.wf_windows).toBe(4);
      expect(result.spaces).toEqual(['buy', 'stoploss']);
    });
  });

  describe('buildPrefillFromLiveBot', () => {
    it('builds a backtest prefill from live bot params', () => {
      const result = buildPrefillFromLiveBot({
        strategy: 'HippoDCA',
        timeframe: '15m',
        maxOpenTrades: 5,
        stakeAmount: 'unlimited',
        firstTradeTimestamp: 1704067200000,
        dryRunWallet: 1000,
        pairs: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
      });
      expect(result.job_type).toBe(JobType.backtest);
      expect(result.strategy).toBe('HippoDCA');
      expect(result.timeframe).toBe('15m');
      expect(result.max_open_trades).toBe(5);
      expect(result.stake_amount).toBe('unlimited');
      expect(result.dry_run_wallet).toBe(1000);
      expect(result.pairs).toEqual(['BTC/USDT:USDT', 'ETH/USDT:USDT']);
      expect(result.timerange).toMatch(/^20240101-/);
    });

    it('handles null firstTradeTimestamp', () => {
      const result = buildPrefillFromLiveBot({
        strategy: 'HippoDCA',
        timeframe: '15m',
        maxOpenTrades: 5,
        stakeAmount: 'unlimited',
      });
      expect(result.timerange).toBeUndefined();
      expect(result.dry_run_wallet).toBeUndefined();
      expect(result.pairs).toBeUndefined();
    });
  });
});
