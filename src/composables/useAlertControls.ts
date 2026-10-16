import { useI18n } from 'vue-i18n';

import { requestAction } from '@/composables/useActionDialog';
import { useDataSource } from '@/composables/useDataSource';
import { useToaster } from '@/composables/useToaster';
import type { AlertActionId } from '@/components/fq/lib/alerts';
import type { Alert } from '@/gateway/types.gen';

/**
 * What can be done to an alert from the page: acknowledge it, silence it until a time, or run its
 * contextual action. Acknowledging and silencing go through the data source (shared between devices
 * on the gateway, local to the tab in direct mode); "Pause entries" opens the confirmation of the
 * bot and sends nothing by itself, like every mutation. Shared by the "needs attention" rail and
 * the alert cards of the Fleet.
 */
export function useAlertControls(emitAction: (id: AlertActionId, alert: Alert) => void) {
  const { t } = useI18n();
  const data = useDataSource();
  const toaster = useToaster();

  function fail(message: string) {
    toaster.push({ kind: 'err', title: t('fq.alert.failed'), body: message });
  }

  async function ack(id: string) {
    const source = data.source.value;
    if (!source) return fail(t('fq.result.noSource'));
    try {
      await source.alerts.ack(id);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  async function silence(a: Alert, untilMs: number) {
    const source = data.source.value;
    if (!source) return fail(t('fq.result.noSource'));
    try {
      await source.alerts.silence({
        typeId: a.type_id,
        ...(a.bot_key ? { botKey: a.bot_key } : {}),
        ...(a.subject ? { subject: a.subject } : {}),
        untilMs,
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  function onAction(id: AlertActionId, a: Alert) {
    if (id === 'pause' && a.bot_key) {
      // A mutation: the confirmation of THIS bot opens, nothing is sent from the alert
      requestAction(a.bot_key, { kind: 'stopbuy' });
      return;
    }
    emitAction(id, a);
  }

  return { ack, silence, onAction };
}
