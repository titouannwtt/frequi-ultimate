import { useBotComparisonStore } from '@/stores/botComparison';

interface NotifTypeConfig {
  positionLoss: boolean;
  botOffline: boolean;
  logErrors: boolean;
}

const notifiedAlerts = new Set<string>();

function isEnabled(): boolean {
  const store = useBotComparisonStore();
  return store.browserNotificationsEnabled;
}

function getNotifTypes(): NotifTypeConfig {
  const store = useBotComparisonStore();
  return store.notificationTypes;
}

// Maps alert typeId to our notification type categories
function alertTypeToCategory(typeId: string): keyof NotifTypeConfig | null {
  if (typeId === 'positionLoss' || typeId === 'nearLiquidation' || typeId === 'highDrawdown') {
    return 'positionLoss';
  }
  if (typeId === 'botOffline') return 'botOffline';
  if (typeId === 'logErrors' || typeId === 'orderFailed' || typeId === 'exchangeError') {
    return 'logErrors';
  }
  return null;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function checkAndNotifyAlerts(
  allBotAlerts: Record<string, { typeId: string; severity: string; message: string }[]>,
  botStores: Record<string, { uiBotName: string }>,
) {
  if (!isEnabled()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const types = getNotifTypes();

  for (const [botId, alerts] of Object.entries(allBotAlerts)) {
    for (const alert of alerts) {
      const alertKey = `${botId}_${alert.typeId}_${alert.message}`;
      if (notifiedAlerts.has(alertKey)) continue;

      const category = alertTypeToCategory(alert.typeId);
      if (category && !types[category]) continue;

      notifiedAlerts.add(alertKey);

      const botName = botStores[botId]?.uiBotName || botId;
      const severityIcon =
        alert.severity === 'critical'
          ? '\u{1F534}'
          : alert.severity === 'warning'
            ? '\u{1F7E0}'
            : '\u{1F535}';

      new Notification(`FreqUI Alert: ${botName}`, {
        body: `${severityIcon} ${alert.message}`,
        icon: '/favicon.ico',
        tag: alertKey,
      });
    }
  }
}

// Clean up old alerts no longer present (to allow re-notification if they come back)
export function pruneNotifiedAlerts(
  allBotAlerts: Record<string, { typeId: string; message: string }[]>,
) {
  const currentKeys = new Set<string>();
  for (const [botId, alerts] of Object.entries(allBotAlerts)) {
    for (const alert of alerts) {
      currentKeys.add(`${botId}_${alert.typeId}_${alert.message}`);
    }
  }
  for (const key of notifiedAlerts) {
    if (!currentKeys.has(key)) {
      notifiedAlerts.delete(key);
    }
  }
}
