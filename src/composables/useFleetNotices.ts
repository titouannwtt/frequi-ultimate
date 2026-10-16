import { useLocalStorage } from '@vueuse/core';
import { computed, type Ref } from 'vue';

import { fleetKpiModel } from '@/components/fq/lib/kpis';
import { botState } from '@/components/fq/lib/bots';
import {
  alertLimit,
  fleetNotices,
  notSnoozed,
  type FleetNotice,
} from '@/components/fq/lib/fleetPage';
import { riskModel } from '@/components/fq/lib/risk';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeDetail } from '@/datasource/types';
import type { BotMode } from '@/gateway/types.gen';

import { modeAllows, useScope } from './useScope';

/** The notices put off with "Later", kept between visits: an id and the time it lasts to. */
const SNOOZE_KEY = 'fqu2.fleetNoticeLater';

/**
 * What the owner must act on beyond the alerts (an expired session, a frozen bot, a drawdown above
 * its limit, a liquidation that is too close, an orphan position), from the fleet and the detail of
 * its scope. Read by the verdict and by the cards under it, which is why it lives in the page.
 * `ready` is false until the figures it reads have arrived: the verdict does not say "all is fine"
 * before it knows.
 */
export function useFleetNotices(detail: Ref<ScopeDetail | null>, failed: Ref<boolean>) {
  const scope = useScope();
  const fleet = useFqFleetStore();
  const alerts = useFqAlertsStore();
  const conn = useFqConnectionStore();
  const prefs = useFqPrefsStore();
  const clock = useNowMs();
  const snoozes = useLocalStorage<Record<string, number>>(SNOOZE_KEY, {});

  // A 15 s step: a bot goes frozen after minutes, the cards must not re-render every second
  const tick = computed(() => Math.floor(clock.value / 15_000) * 15_000);
  const modes = computed<BotMode[]>(() =>
    scope.mode.value === 'all' ? ['live', 'dry'] : [scope.mode.value],
  );

  const found = computed<FleetNotice[]>(() => {
    const d = detail.value;
    const drawdowns: { mode: BotMode; pct: number | null }[] = [];
    const nearest: Parameters<typeof fleetNotices>[0]['nearest'][number][] = [];
    if (d) {
      modes.value.forEach((mode, i) => {
        const block = d.totals.find((b) => b.mode === mode);
        if (!block) return;
        const m = fleetKpiModel(block, d, tick.value, conn.status.clockSkewMs, i === 0);
        drawdowns.push({
          mode,
          pct: m.slots.drawdown.state === 'ready' ? (m.drawdown?.pct ?? null) : null,
        });
        const risk = riskModel({
          positions: d.positions,
          totals: block,
          mode,
          modeOf: (k) => fleet.bots[k]?.identity.mode ?? null,
          walletOf: (k) => fleet.bots[k]?.state.wallet_id ?? null,
        });
        if (risk.nearest) nearest.push({ mode, ...risk.nearest });
      });
    }
    return fleetNotices({
      bots: fleet.list.filter((b) => modeAllows(b, scope.mode.value)),
      stateOf: (b) => botState(b, tick.value, conn.status.clockSkewMs),
      alerts: alerts.list,
      drawdowns,
      drawdownLimit: alertLimit(prefs.settings.alerts.rules, 'highDrawdown'),
      nearest,
      liquidationLimit: alertLimit(prefs.settings.alerts.rules, 'nearLiquidation'),
      // A wallet position no bot owns concerns the live money, not the dry bots
      orphans: d && scope.mode.value !== 'dry' ? d.positions.filter((p) => p.orphan).length : 0,
    });
  });

  const notices = computed(() => notSnoozed(found.value, snoozes.value, tick.value));

  /** Put a notice off until `untilMs`; the ones that ran out are forgotten on the way. */
  function later(id: string, untilMs: number) {
    const kept = Object.fromEntries(
      Object.entries(snoozes.value).filter(([, t]) => t > Date.now()),
    );
    snoozes.value = { ...kept, [id]: untilMs };
  }

  /** The figures the notices read have arrived (or could not): the verdict may speak. */
  const ready = computed(() => detail.value !== null || failed.value);

  return { notices, later, ready, tick };
}
