import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { FQ_ICON_SIZES, FQ_ICONS } from '../../src/utils/icons';

const require = createRequire(import.meta.url);
const lucide = require('@iconify-json/lucide/icons.json') as {
  icons: Record<string, unknown>;
  aliases?: Record<string, unknown>;
};

describe('icon vocabulary', () => {
  it('only references icons that exist in Lucide', () => {
    for (const [meaning, name] of Object.entries(FQ_ICONS)) {
      expect(name in lucide.icons || name in (lucide.aliases ?? {}), `${meaning}: ${name}`).toBe(
        true,
      );
    }
  });

  it('uses a distinct icon per meaning', () => {
    const names = Object.values(FQ_ICONS);
    expect(new Set(names).size).toBe(names.length);
  });

  it('declares the four sizes of the spec', () => {
    expect(FQ_ICON_SIZES).toEqual({ table: 13, default: 15, empty: 18, mobileBar: 20 });
  });
});
