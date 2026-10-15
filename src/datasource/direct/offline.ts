/**
 * Offline detection of a bot, as in the legacy `createOfflineDetector`: only transport failures
 * count (connection refused, timeout, 500), a 4xx is an answer, and a streak of 3 is needed so a
 * hiccup does not make a healthy bot vanish.
 */
export const OFFLINE_AFTER_CONSECUTIVE_FAILURES = 3;

export function createFailureStreak(threshold = OFFLINE_AFTER_CONSECUTIVE_FAILURES) {
  let consecutive = 0;
  return {
    onSuccess() {
      consecutive = 0;
    },
    /** @returns true once the streak reached the threshold. */
    onFailure(): boolean {
      consecutive += 1;
      return consecutive >= threshold;
    },
    get failures() {
      return consecutive;
    },
  };
}
