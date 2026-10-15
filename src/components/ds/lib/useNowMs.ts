import { createSharedComposable, useTimestamp } from '@vueuse/core';

/** One shared 1 s clock for every age badge, so a table does not create a timer per row. */
export const useNowMs = createSharedComposable(() => useTimestamp({ interval: 1000 }));
