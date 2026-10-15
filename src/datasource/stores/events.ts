import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { Event } from '@/gateway/types.gen';

/** Events kept in memory by the UI (the gateway keeps 5000 and 30 days). */
export const MAX_EVENTS = 500;

/** The event feed (`events` channel), newest first. */
export const useFqEventsStore = defineStore('fqEvents', () => {
  const events = ref<Event[]>([]);
  const unavailable = ref<string | null>(null);
  /** Incremented at every new event: watchers (fill detection, toasts) key on it. */
  const counter = ref(0);
  const lastEvent = ref<Event | null>(null);

  function add(e: Event) {
    events.value.unshift(e);
    if (events.value.length > MAX_EVENTS) {
      events.value.length = MAX_EVENTS;
    }
    lastEvent.value = e;
    counter.value += 1;
    unavailable.value = null;
  }

  function reset() {
    events.value = [];
    lastEvent.value = null;
    counter.value = 0;
  }

  function markUnavailable(reason: string) {
    unavailable.value = reason;
  }

  /** Events of one bot, newest first. */
  function forBot(botKey: string): Event[] {
    return events.value.filter((e) => e.bot_key === botKey);
  }

  return { events, unavailable, counter, lastEvent, add, reset, markUnavailable, forBot };
});
