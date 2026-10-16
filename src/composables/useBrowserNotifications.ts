import { watch } from 'vue';

import { alertsToNotify, notifyKey, staleKeys } from '@/components/fq/lib/alertNotify';
import { alertTarget } from '@/components/fq/lib/alerts';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { Alert } from '@/gateway/types.gen';
import i18n from '@/locales';

/**
 * System notifications for the alerts (loss on a position, near liquidation, bot offline...),
 * when the user switched them on in Settings and the browser granted the permission. One
 * notification per occurrence of an alert, never repeated while it stays active, and none for
 * what was already active when the page opened (the rail shows those): only what appears while the
 * tab is open. Start it once, with the shell.
 */
export function useBrowserNotifications(): () => void {
  const alerts = useFqAlertsStore();
  const prefs = useFqPrefsStore();
  const fleet = useFqFleetStore();
  const seen = new Set<string>();
  let primed = false;

  function allowed(): boolean {
    return (
      prefs.settings.alerts.notifications.browser === true &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    );
  }

  function show(a: Alert): void {
    const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;
    const name = a.bot_key
      ? (fleet.bots[a.bot_key]?.identity.name ?? a.bot_key)
      : t('fq.alert.wallet');
    const body = [t(`fq.alert.type.${a.type_id}`), alertTarget(a) || (a.detail ?? '')]
      .filter((x) => x !== '')
      .join(': ');
    try {
      const n = new Notification(`FreqUI: ${name}`, {
        body,
        // One notification per occurrence: the same one never stacks
        tag: notifyKey(a),
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Some mobile browsers only allow notifications through a service worker
    }
  }

  return watch(
    () => [alerts.list, alerts.loaded] as const,
    ([list, loaded]) => {
      if (!loaded) return;
      const now = Date.now();
      for (const k of staleKeys(seen, list, now)) seen.delete(k);
      const fresh = alertsToNotify(list, now, seen, prefs.settings.alerts.notifications.types);
      for (const a of fresh) seen.add(notifyKey(a));
      // The first book is the state of the world at load: remembered, not announced
      if (!primed) {
        primed = true;
        return;
      }
      if (!allowed()) return;
      for (const a of fresh) show(a);
    },
    { immediate: true },
  );
}
