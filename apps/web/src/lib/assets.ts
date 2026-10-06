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
  | 'cat-custom';

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
  geography: 'cat-general',
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
};

export function categoryIcon(categoryId: string): StickerId {
  return CATEGORY_ICONS[categoryId] ?? 'cat-general';
}
