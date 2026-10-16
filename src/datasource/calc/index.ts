/**
 * Pure calculation functions of the data layer: TypeScript ports of `gateway/crates/fg-core`,
 * executed by vitest on the same vectors (`gateway/fixtures/vectors`). DirectSource computes every
 * aggregate with these; the gateway computes them in Rust.
 */
export * from './time';
export * from './hip3';
export * from './capital';
export * from './exposure';
export * from './stats';
export * from './freshness';
export * from './exitReason';
export * from './duration';
export * from './drawdown';
export * from './periods';
export * from './alerts';
export * from './scopeTotals';
export * from './tradePage';
