import { describe, expect, it } from 'vitest';
import { resolveTargetBot } from '../../src/utils/targetBot';

describe('resolveTargetBot', () => {
  const stores = { 'ftbot.1': { name: 'one' }, 'ftbot.2': { name: 'two' } };

  it('targets the bot owning the trade, not the active bot', () => {
    expect(resolveTargetBot(stores, 'ftbot.2', stores['ftbot.1'])).toBe(stores['ftbot.2']);
  });

  it('falls back to the active bot in single-bot views', () => {
    expect(resolveTargetBot(stores, undefined, stores['ftbot.1'])).toBe(stores['ftbot.1']);
  });

  it('falls back to the active bot when the bot id is unknown', () => {
    expect(resolveTargetBot(stores, 'ftbot.9', stores['ftbot.1'])).toBe(stores['ftbot.1']);
  });
});
