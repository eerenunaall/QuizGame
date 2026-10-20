import { BRAND_SIZES } from '../assets/brand.generated';

/** The owner's brand artwork (QuizNight logo, party-cone mascot, letter characters); see scripts/assets/brand.ts. */
const files = import.meta.glob<string>('../assets/brand/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export type BrandId = keyof typeof BRAND_SIZES;

const urls = new Map(
  Object.entries(files).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.webp'.length),
    url,
  ]),
);

export function brandUrl(id: BrandId): string {
  const url = urls.get(id);
  if (!url) throw new Error(`unknown brand asset: ${id}`);
  return url;
}

export const brandSize = (id: BrandId): { width: number; height: number } => BRAND_SIZES[id];

/** The nine characters that spell QuizNight, in order (the two i's are different poses). */
export const LETTER_IDS = [
  'letter-q',
  'letter-u',
  'letter-i1',
  'letter-z',
  'letter-n',
  'letter-i2',
  'letter-g',
  'letter-h',
  'letter-t',
] as const satisfies readonly BrandId[];
