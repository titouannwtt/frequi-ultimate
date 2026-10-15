/**
 * `AuthStore` backed by the legacy `ftAuthLoginInfo` storage. Entries are read live (a bot added or
 * removed in the legacy pages shows up at the next tick) and renewed tokens go back to the same
 * place, so both layers share one session per bot.
 */
import { patchLoginInfoTokens, readLoginInfos } from '@/composables/loginInfo';

import type { AuthEntry, AuthStore } from './auth';

export function createLoginInfoAuthStore(): AuthStore {
  return {
    entries(): AuthEntry[] {
      const all = readLoginInfos();
      return Object.keys(all)
        .sort((a, b) => (all[a]?.sortId ?? 0) - (all[b]?.sortId ?? 0))
        .flatMap((id) => {
          const e = all[id];
          if (!e) return [];
          return [
            {
              id,
              botName: e.botName,
              botIcon: e.botIcon,
              apiUrl: e.apiUrl || null,
              username: e.username,
              accessToken: e.accessToken,
              refreshToken: e.refreshToken,
              sortId: e.sortId,
              createdAt: e.createdAt,
            },
          ];
        });
    },
    patch(id, tokens) {
      patchLoginInfoTokens(id, tokens);
    },
  };
}
