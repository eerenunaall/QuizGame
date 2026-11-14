import { AVATAR_IDS, type AvatarId } from '@quizparty/protocol/constants';

/**
 * Bundled artwork (see scripts/assets/manifest.ts for provenance and licences). Vite fingerprints
 * every file; nothing is inlined, so the strict CSP needs no `data:` image source.
 */
const avatarFiles = import.meta.glob<string>('../assets/avatars/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const stickerFiles = import.meta.glob<string>('../assets/stickers/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const animatedFiles = import.meta.glob<string>('../assets/animated/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const byName = (files: Record<string, string>): Map<string, string> =>
  new Map(
    Object.entries(files).map(([path, url]) => [
      path.slice(path.lastIndexOf('/') + 1, -'.webp'.length),
      url,
    ]),
  );

const avatars = byName(avatarFiles);
const stickers = byName(stickerFiles);
const animated = byName(animatedFiles);

export type StickerId =
  | 'party-popper'
  | 'confetti-ball'
  | 'trophy'
  | 'crown'
  | 'medal-gold'
  | 'medal-silver'
  | 'medal-bronze'
  | 'fire'
  | 'sparkles'
  | 'glowing-star'
  | 'star'
  | 'hundred'
  | 'gem'
  | 'balloon'
  | 'gift'
  | 'check'
  | 'cross'
  | 'clap'
  | 'thinking'
  | 'partying'
  | 'starstruck'
  | 'exploding-head'
  | 'crying'
  | 'hot-face'
  | 'winking'
  | 'monocle'
  | 'eyes'
  | 'alarm-clock'
  | 'stopwatch'
  | 'hourglass'
  | 'light-bulb'
  | 'brain'
  | 'bullseye'
  | 'rocket'
  | 'bolt'
  | 'megaphone'
  | 'shield'
  | 'bomb'
  | 'snowflake'
  | 'fog'
  | 'shuffle'
  | 'lock'
  | 'coin'
  | 'cat-general'
  | 'cat-cinema'
  | 'cat-games'
  | 'cat-music'
  | 'cat-history'
  | 'cat-science'
  | 'cat-sports'
  | 'cat-tech'
  | 'cat-2000s'
  | 'cat-mixed'
  | 'cat-custom'
  | 'cat-geography'
  | 'cat-nature'
  | 'cat-art'
  | 'cat-literature'
  | 'cat-food'
  | 'cat-myth'
  | 'cat-language'
  | 'cat-business'
  | 'cat-math'
  | 'cat-got'
  | 'cat-wizard'
  | 'cat-wargame'
  | 'cat-chemistry'
  | 'cat-law'
  | 'cat-office'
  | 'cat-sitcom'
  | 'cat-hero-mask'
  | 'cat-skyline'
  | 'cat-hollywood'
  | 'cat-reel'
  | 'cat-tea'
  | 'cat-tv-classic'
  | 'cat-anchor'
  | 'cat-die'
  | 'cat-toon-face'
  | 'cat-cassette'
  | 'cat-football';

export type AnimationId =
  | 'party-popper'
  | 'confetti-ball'
  | 'trophy'
  | 'fire'
  | 'clap'
  | 'sparkles'
  | 'hundred'
  | 'crown'
  | 'starstruck'
  | 'partying'
  | 'thinking'
  | 'sunglasses'
  | 'hourglass'
  | 'alarm-clock'
  | 'boom'
  | 'rocket'
  | 'medal-gold'
  | 'exploding-head'
  | 'crying'
  | 'raising-hands';

export function avatarUrl(id: string): string {
  return avatars.get(id) ?? avatars.get('fox') ?? '';
}

export function stickerUrl(id: StickerId): string {
  return stickers.get(id) ?? '';
}

export function animationUrl(id: AnimationId): string {
  return animated.get(id) ?? '';
}

export function avatarIds(): readonly AvatarId[] {
  return AVATAR_IDS;
}

/** Category id → icon. Unknown categories get the globe so a new bank category never shows a hole. */
const CATEGORY_ICONS: Record<string, StickerId> = {
  general: 'cat-general',
  geography: 'cat-geography',
  nature: 'cat-nature',
  'art-culture': 'cat-art',
  literature: 'cat-literature',
  'food-drink': 'cat-food',
  'mythology-folklore': 'cat-myth',
  'language-words': 'cat-language',
  'business-economy': 'cat-business',
  'math-logic': 'cat-math',
  'general-culture': 'cat-general',
  cinema: 'cat-cinema',
  'cinema-tv': 'cat-cinema',
  tv: 'cat-cinema',
  games: 'cat-games',
  gaming: 'cat-games',
  music: 'cat-music',
  history: 'cat-history',
  science: 'cat-science',
  sports: 'cat-sports',
  sport: 'cat-sports',
  turkiye: 'star',
  turkey: 'star',
  technology: 'cat-tech',
  tech: 'cat-tech',
  '2000s': 'cat-2000s',
  y2000s: 'cat-2000s',
  mixed: 'cat-mixed',
  custom: 'cat-custom',
  // demo categories (seed/demo): original badges from scripts/assets/category-badges.ts
  'game-of-thrones': 'cat-got',
  'harry-potter': 'cat-wizard',
  warhammer: 'cat-wargame',
  'breaking-bad': 'cat-chemistry',
  'better-call-saul': 'cat-law',
  'the-office': 'cat-office',
  'how-i-met-your-mother': 'cat-sitcom',
  marvel: 'cat-hero-mask',
  dc: 'cat-skyline',
  hollywood: 'cat-hollywood',
  'cult-films': 'cat-reel',
  // seed/gusto additions
  'turkiye-kulturu': 'cat-tea',
  'yesilcam-turk-dizileri': 'cat-tv-classic',
  'canakkale-ve-yoresi': 'cat-anchor',
  'masa-oyunlari': 'cat-die',
  'anime-cizgi-film': 'cat-toon-face',
  '90lar-nostalji': 'cat-cassette',
  'futbol-turkiye': 'cat-football',
};

export function categoryIcon(categoryId: string): StickerId {
  return CATEGORY_ICONS[categoryId] ?? 'cat-general';
}
