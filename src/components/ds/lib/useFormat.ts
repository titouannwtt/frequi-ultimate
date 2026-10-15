import { useI18n } from 'vue-i18n';
import {
  formatAge,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSigned,
} from './format';

/** Formatters bound to the active UI language (FR or EN). */
export function useFormat() {
  const { locale } = useI18n();
  const lang = () => locale.value;
  return {
    lang,
    number: (v: number, d = 2) => formatNumber(v, d, lang()),
    signed: (v: number, d = 2) => formatSigned(v, d, lang()),
    percent: (v: number, d = 2, signed = true) => formatPercent(v, d, lang(), signed),
    price: (v: number) => formatPrice(v, lang()),
    duration: (hours: number) => formatDuration(hours, lang()),
    age: (ms: number) => formatAge(ms, lang()),
  };
}
