import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_IDS } from '@quizparty/protocol/constants';
import { CATEGORY_BADGES } from './category-badges.ts';
import { ANIMATIONS, AVATARS, STICKERS, fluentUrl, notoUrl } from './manifest.ts';

const ASSETS = fileURLToPath(new URL('../../apps/web/src/assets/', import.meta.url));

describe('asset manifest', () => {
  it('has exactly the protocol avatar ids, in the same order', () => {
    expect(AVATARS.map((avatar) => avatar.id)).toEqual([...AVATAR_IDS]);
  });

  it('uses unique output names per group', () => {
    for (const group of [AVATARS, STICKERS, ANIMATIONS]) {
      const ids = group.map((asset) => asset.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('builds the upstream URLs the licences refer to', () => {
    expect(fluentUrl({ id: 'cat', folder: 'Cat face' })).toBe(
      'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Cat%20face/3D/cat_face_3d.png',
    );
    expect(fluentUrl({ id: 'clap', folder: 'Clapping hands', defaultTone: true })).toContain(
      '/Clapping%20hands/Default/3D/clapping_hands_3d_default.png',
    );
    expect(notoUrl({ id: 'party-popper', codepoint: '1f389' })).toBe(
      'https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/512.webp',
    );
  });

  it('has every committed output file, and no strays', () => {
    for (const [group, assets] of [
      ['avatars', AVATARS],
      ['stickers', [...STICKERS, ...CATEGORY_BADGES]],
      ['animated', ANIMATIONS],
    ] as const) {
      const directory = `${ASSETS}${group}`;
      expect(existsSync(directory), directory).toBe(true);
      const files = readdirSync(directory).sort();
      expect(files).toEqual(assets.map((asset) => `${asset.id}.webp`).sort());
      for (const file of files)
        expect(statSync(`${directory}/${file}`).size).toBeGreaterThan(1_000);
    }
  });

  it('keeps the original category badges legible: white glyph contrast, distinct colours', () => {
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    for (const badge of CATEGORY_BADGES)
      expect(1.05 / (luminance(badge.color) + 0.05), badge.id).toBeGreaterThanOrEqual(4.5);
    expect(new Set(CATEGORY_BADGES.map((b) => b.color)).size).toBe(CATEGORY_BADGES.length);
    expect(new Set(CATEGORY_BADGES.map((b) => b.glyph)).size).toBe(CATEGORY_BADGES.length);
  });

  it('keeps the animated pack within its size budget', () => {
    const directory = `${ASSETS}animated`;
    const sizes = readdirSync(directory).map((file) => statSync(`${directory}/${file}`).size);
    expect(Math.max(...sizes)).toBeLessThan(110 * 1024);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(1_400 * 1024);
  });

  it('ships the licence notices the attributions require', () => {
    expect(existsSync(`${ASSETS}NOTICE.md`)).toBe(true);
    expect(existsSync(`${ASSETS}credits.generated.ts`)).toBe(true);
  });
});
