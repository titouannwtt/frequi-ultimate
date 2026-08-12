import type { AxiosHeaders } from 'axios';
import axios from 'axios';

type UserServiceType = ReturnType<typeof useLoginInfo>;

/**
 * Consecutive transport failures tolerated before a bot is declared offline.
 *
 * One failed request used to be enough. On a dashboard polling dozens of bots that is far
 * too brittle: a single slow aggregate, or one endpoint erroring on data it cannot render,
 * made a perfectly healthy bot vanish from the comparator while lighter widgets kept showing
 * it — the symptom that motivated this. Requiring a streak keeps genuine outages detectable
 * (a dead bot fails every poll, so it is flagged within seconds) while a hiccup no longer is.
 */
export const OFFLINE_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * Is this error the transport failing, rather than the bot answering "no"?
 *
 * A 4xx is an answer: the bot is alive and refused. Only a 500, a dead network, or a timeout
 * say nothing came back. Timeouts used to be missed entirely — axios reports them as
 * ECONNABORTED, never as 'Network Error' — so a bot too slow to be usable still counted as
 * healthy.
 */
export function isTransportFailure(err: {
  code?: string;
  message?: string;
  response?: { status?: number };
}): boolean {
  if (err.response?.status === 500) return true;
  if (err.message === 'Network Error') return true;
  return err.code === 'ECONNABORTED' || /timeout/i.test(err.message ?? '');
}

/**
 * Tracks a bot's failure streak. Returns true only when the bot should be declared offline.
 *
 * Kept as a pure object so the threshold is testable without a store or a live socket.
 */
export function createOfflineDetector(threshold = OFFLINE_AFTER_CONSECUTIVE_FAILURES) {
  let consecutive = 0;
  return {
    /** Any answer proves reachability — the streak starts over. */
    onSuccess() {
      consecutive = 0;
    },
    /** @returns true when the streak has reached the threshold. */
    onFailure(): boolean {
      consecutive += 1;
      return consecutive >= threshold;
    },
    get failures() {
      return consecutive;
    },
  };
}

export function useApi(userService: UserServiceType, botId: string) {
  const api = axios.create({
    baseURL: userService.baseUrl.value,
    timeout: 20000,
  });
  // Per-bot: useApi() is instantiated once per bot, so this detector is that bot's.
  const offlineDetector = createOfflineDetector();
  // Sent auth headers interceptor
  api.interceptors.request.use(
    (request) => {
      const token = userService.accessToken.value;
      try {
        if (token) {
          request.headers = request.headers as AxiosHeaders;
          // Append token to each request
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      } catch (e) {
        console.log(e);
      }
      return request;
    },
    (error) => Promise.reject(error),
  );

  api.interceptors.response.use(
    (response) => {
      // Any answer at all proves the bot is reachable — the streak starts over.
      offlineDetector.onSuccess();
      return response;
    },
    (err) => {
      // console.log(err);
      if (err.response && err.response.status === 401) {
        return userService
          .refreshToken()
          .catch((error) => {
            console.log('No new token received');
            console.log(error);
            const botStore = useBotStore();
            if (botStore.botStores[botId]) {
              botStore.botStores[botId].setIsBotOnline(false);
              botStore.botStores[botId].isBotLoggedIn = false;
            }
          })
          .then((token) => {
            // Retry original request with new token
            const { config } = err;
            config.headers.Authorization = `Bearer ${token}`;

            return new Promise((resolve, reject) => {
              axios
                .request(config)
                .then((response) => {
                  resolve(response);
                })
                .catch((error) => {
                  reject(error);
                });
            });
          })
          .catch((error) => {
            console.log(error);
          });

        // maybe redirect to /login if needed !
      }
      if (err.response && err.response.status === 502) {
        const errorMsg = err.response.data?.error || '';
        if (errorMsg.includes('not in the correct state')) {
          const botStore = useBotStore();
          if (botStore.botStores[botId]) {
            botStore.botStores[botId].isBotStarting = true;
            botStore.botStores[botId].setIsBotOnline(true);
          }
          return Promise.resolve(err.response);
        }
      }
      if (isTransportFailure(err)) {
        const url = err.config?.url ?? '';
        if (!url.includes('/stratdev/')) {
          const reachedThreshold = offlineDetector.onFailure();
          const botStore = useBotStore();
          const store = botStore.botStores[botId];
          if (store && !store.isBotStarting && reachedThreshold) {
            console.log(`Bot not running (${offlineDetector.failures} consecutive failures)...`);
            store.setIsBotOnline(false);
          }
        }
      }

      return new Promise((resolve, reject) => {
        reject(err);
      });
    },
  );

  return {
    api,
  };
}
