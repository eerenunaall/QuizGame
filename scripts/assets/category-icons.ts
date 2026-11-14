/**
 * Original, generic category badges for the demo categories (seed/demo). Drawn here as plain SVG
 * geometry (no logos, marks or copied art) and rasterised to the same 192 px webp the Fluent
 * stickers use, so `Sticker` and `CATEGORY_ICONS` treat them alike. Run `pnpm assets:category-icons`.
 *
 * Legibility on TV: every glyph is white on a dark badge (contrast >= 4.5:1 against white, checked in
 * manifest.test.ts) and every category has a different silhouette, so colour is never the only cue.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CATEGORY_BADGES } from './category-badges.ts';

const OUT = join(fileURLToPath(new URL('../../', import.meta.url)), 'apps/web/src/assets/stickers');
mkdirSync(OUT, { recursive: true });

for (const badge of CATEGORY_BADGES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
<rect x="8" y="8" width="176" height="176" rx="40" fill="${badge.color}"/>
<rect x="8" y="8" width="176" height="176" rx="40" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="4"/>
<g fill="#fff" stroke="#fff" stroke-linejoin="round" stroke-linecap="round">${badge.glyph}</g>
</svg>`;
  const output = await sharp(Buffer.from(svg))
    .webp({ quality: 90, alphaQuality: 95, effort: 6 })
    .toBuffer();
  writeFileSync(join(OUT, `${badge.id}.webp`), output);
}
process.stdout.write(`${CATEGORY_BADGES.length} category badges written\n`);
