# Candle fixtures

`XYZ-TEST_USDC_USDC-15m.feather`: 300 candles of 15 minutes from 2026-01-01T00:00Z, written by
pyarrow with `feather.write_feather(df, path, compression="lz4")` like the files of the ftcache daemon
(Arrow IPC, lz4 frames, `date` as `timestamp[ms, UTC]`, the other columns `float64`; 5.6 KB, 17.7 KB
uncompressed). For `i` in `0..300`: `open = 100 + i % 10`, `high = open + 1.5`, `low = open - 1.5`,
`close = open + 0.5`, `volume = 10 + i % 3`. Read by the tests of `fg-sources` (`candles.rs`).
