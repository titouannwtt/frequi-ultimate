import { readdirSync, readFileSync, readlinkSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { hasRig, rig } from './rig';

/**
 * The rig's stand-in processes must not look like freqtrade bots to a gateway of the host: the
 * rig runs in a child PID namespace, which is still listed in the /proc of the host, and the
 * production gateway once listed fake bots and positions next to the real ones (B210). This spec
 * runs on the host side and reads the same /proc a host gateway reads.
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');

/** The discovery test of the gateway (`is_trade_process`, fg-sources/src/discovery.rs). */
function looksLikeTradeProcess(argv: string[]): boolean {
  return argv.includes('trade') && argv.some((a) => a.includes('freqtrade'));
}

test('a host gateway cannot take the stand-in processes for freqtrade bots', () => {
  const standIns: string[][] = [];
  const seenAsBots: string[][] = [];
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let argv: string[];
    try {
      argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    } catch {
      continue; // gone, or not ours
    }
    if (argv.includes('rig-standin')) standIns.push(argv);
    // Any process a host discovery would take whose working directory is the rig's
    if (looksLikeTradeProcess(argv)) {
      try {
        if (readlinkSync(`/proc/${pid}/cwd`).includes('fq-rig-')) seenAsBots.push(argv);
      } catch {
        // gone
      }
    }
  }
  expect(standIns.length, 'one stand-in per fake bot').toBeGreaterThanOrEqual(rig().bots.length);
  expect(seenAsBots, 'stand-ins matching the discovery test on the host').toEqual([]);
});
