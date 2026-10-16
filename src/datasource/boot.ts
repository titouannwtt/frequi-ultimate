/**
 * Boot of the preferences, before the first page reads them: the `fqu2.*` keys are loaded and the
 * migration of the old keys runs (read only, idempotent, 03 section 9.2). Called once from
 * `main.ts`; `useDataSource().start()` finds the store ready and does not run it twice.
 */
import { useFqPrefsStore } from './stores/prefs';

export function bootPrefs(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  const prefs = useFqPrefsStore();
  if (prefs.ready) return;
  const hostname = window.location.hostname;
  prefs.init({
    storage: localStorage,
    localHosts: [hostname, 'localhost', '127.0.0.1', '::1'],
    selfOrigin: window.location.origin,
    browserLanguages: typeof navigator === 'undefined' ? [] : navigator.languages,
  });
}
