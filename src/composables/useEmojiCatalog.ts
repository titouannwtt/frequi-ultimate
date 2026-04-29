import type { Ref } from 'vue';

export interface EmojiEntry {
  unicode: string;
  label: string;
  group?: number;
  tags: string[];
}

export interface EmojiGroup {
  id: number;
  label: string;
  emojis: EmojiEntry[];
}

const SUPPORTED_LOCALES = ['en', 'fr', 'de', 'es', 'it', 'pt'] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const dataLoaders: Record<SupportedLocale, () => Promise<{ default: unknown[] }>> = {
  en: () => import('emojibase-data/en/compact.json'),
  fr: () => import('emojibase-data/fr/compact.json'),
  de: () => import('emojibase-data/de/compact.json'),
  es: () => import('emojibase-data/es/compact.json'),
  it: () => import('emojibase-data/it/compact.json'),
  pt: () => import('emojibase-data/pt/compact.json'),
};

const messageLoaders: Record<SupportedLocale, () => Promise<{ default: { groups: { order: number; key: string; message: string }[] } }>> = {
  en: () => import('emojibase-data/en/messages.json'),
  fr: () => import('emojibase-data/fr/messages.json'),
  de: () => import('emojibase-data/de/messages.json'),
  es: () => import('emojibase-data/es/messages.json'),
  it: () => import('emojibase-data/it/messages.json'),
  pt: () => import('emojibase-data/pt/messages.json'),
};

const loaded = ref(false);
const loading = ref(false);
const allEmojis = ref<EmojiEntry[]>([]);
const groups = ref<EmojiGroup[]>([]);

interface CompactEmoji {
  unicode?: string;
  hexcode: string;
  label?: string;
  tags?: string[];
  group?: number;
  order?: number;
}

async function loadCatalog(currentLocale: string) {
  if (loaded.value || loading.value) return;
  loading.value = true;

  const localesToLoad: SupportedLocale[] = ['en'];
  if (currentLocale !== 'en' && (SUPPORTED_LOCALES as readonly string[]).includes(currentLocale)) {
    localesToLoad.push(currentLocale as SupportedLocale);
  }
  // Always include fr/de for cross-language search
  for (const l of ['fr', 'de'] as SupportedLocale[]) {
    if (!localesToLoad.includes(l)) localesToLoad.push(l);
  }

  try {
    const datas = await Promise.all(localesToLoad.map((l) => dataLoaders[l]().then((m) => m.default as CompactEmoji[])));
    const messagesLocale: SupportedLocale = (SUPPORTED_LOCALES as readonly string[]).includes(currentLocale)
      ? (currentLocale as SupportedLocale)
      : 'en';
    const messages = await messageLoaders[messagesLocale]().then((m) => m.default);

    const map = new Map<string, EmojiEntry>();
    const baseEn = datas[0];
    for (const e of baseEn) {
      if (!e.unicode) continue;
      const tags = new Set<string>();
      if (e.label) {
        tags.add(e.label.toLowerCase());
        e.label.toLowerCase().split(/[\s\-_]+/).forEach((w) => w && tags.add(w));
      }
      e.tags?.forEach((t) => tags.add(t.toLowerCase()));
      map.set(e.hexcode, {
        unicode: e.unicode,
        label: e.label || '',
        group: e.group,
        tags: [...tags],
      });
    }
    for (let i = 1; i < datas.length; i++) {
      for (const e of datas[i]) {
        const entry = map.get(e.hexcode);
        if (!entry) continue;
        if (e.label) {
          entry.tags.push(e.label.toLowerCase());
          e.label.toLowerCase().split(/[\s\-_]+/).forEach((w) => w && entry.tags.push(w));
        }
        e.tags?.forEach((t) => entry.tags.push(t.toLowerCase()));
      }
    }
    for (const entry of map.values()) {
      entry.tags = [...new Set(entry.tags)];
    }

    allEmojis.value = [...map.values()];

    const grouped = new Map<number, EmojiEntry[]>();
    for (const e of allEmojis.value) {
      if (e.group === undefined) continue;
      // Skip "components" group (skin tones, hair colors)
      if (e.group === 2) continue;
      if (!grouped.has(e.group)) grouped.set(e.group, []);
      grouped.get(e.group)!.push(e);
    }
    const groupLabels: Record<number, string> = {};
    for (const g of messages.groups) {
      groupLabels[g.order] = g.message;
    }
    groups.value = [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, emojis]) => ({
        id,
        label: groupLabels[id] || `Group ${id}`,
        emojis,
      }));

    loaded.value = true;
  } catch (err) {
    console.error('Failed to load emoji catalog', err);
  } finally {
    loading.value = false;
  }
}

function search(query: string): EmojiEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const out: EmojiEntry[] = [];
  for (const e of allEmojis.value) {
    if (tokens.every((t) => e.tags.some((tag) => tag.includes(t)))) {
      out.push(e);
      if (out.length >= 300) break;
    }
  }
  return out;
}

export function useEmojiCatalog(): {
  loaded: Ref<boolean>;
  loading: Ref<boolean>;
  groups: Ref<EmojiGroup[]>;
  allEmojis: Ref<EmojiEntry[]>;
  loadCatalog: (currentLocale: string) => Promise<void>;
  search: (query: string) => EmojiEntry[];
} {
  return {
    loaded,
    loading,
    groups,
    allEmojis,
    loadCatalog,
    search,
  };
}
