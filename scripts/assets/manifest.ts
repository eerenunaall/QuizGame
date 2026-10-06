/**
 * Provenance of every bundled raster asset (docs/ADR/0020). Nothing here is hand-drawn art that
 * could be mistaken for ours: each entry names its upstream file and licence, and the build script
 * regenerates `apps/web/src/assets` plus the credits page data from this list.
 */

export const FLUENT_BASE = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets';
export const NOTO_BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest';

export interface FluentAsset {
  /** Output file name (without extension). */
  id: string;
  /** Folder in microsoft/fluentui-emoji `assets/` (the CLDR short name). */
  folder: string;
  /** Skin-tone-aware emoji keep their art under `Default/`. */
  defaultTone?: true;
}

export interface NotoAnimation {
  id: string;
  /** Lower-case hex code point sequence, e.g. `1f389`. */
  codepoint: string;
  /** Output edge in px; hero moments (trophy, confetti) get more pixels. */
  size?: number;
}

/** Player avatars. Ids are the wire values of `AvatarId` in the protocol. */
export const AVATARS: readonly FluentAsset[] = [
  { id: 'fox', folder: 'Fox' },
  { id: 'panda', folder: 'Panda' },
  { id: 'owl', folder: 'Owl' },
  { id: 'cat', folder: 'Cat face' },
  { id: 'dog', folder: 'Dog face' },
  { id: 'rabbit', folder: 'Rabbit face' },
  { id: 'tiger', folder: 'Tiger face' },
  { id: 'koala', folder: 'Koala' },
  { id: 'penguin', folder: 'Penguin' },
  { id: 'frog', folder: 'Frog' },
  { id: 'lion', folder: 'Lion' },
  { id: 'monkey', folder: 'Monkey face' },
  { id: 'bear', folder: 'Bear' },
  { id: 'unicorn', folder: 'Unicorn' },
  { id: 'dragon', folder: 'Dragon face' },
  { id: 'robot', folder: 'Robot' },
  { id: 'octopus', folder: 'Octopus' },
  { id: 'alien', folder: 'Alien' },
  { id: 'ghost', folder: 'Ghost' },
  { id: 'cool', folder: 'Smiling face with sunglasses' },
  { id: 'nerd', folder: 'Nerd face' },
  { id: 'cowboy', folder: 'Cowboy hat face' },
  { id: 'chick', folder: 'Baby chick' },
  { id: 'whale', folder: 'Spouting whale' },
];

/** Static 3D stickers used across the TV and controller UI. */
export const STICKERS: readonly FluentAsset[] = [
  // celebration & ranks
  { id: 'party-popper', folder: 'Party popper' },
  { id: 'confetti-ball', folder: 'Confetti ball' },
  { id: 'trophy', folder: 'Trophy' },
  { id: 'crown', folder: 'Crown' },
  { id: 'medal-gold', folder: '1st place medal' },
  { id: 'medal-silver', folder: '2nd place medal' },
  { id: 'medal-bronze', folder: '3rd place medal' },
  { id: 'fire', folder: 'Fire' },
  { id: 'sparkles', folder: 'Sparkles' },
  { id: 'glowing-star', folder: 'Glowing star' },
  { id: 'star', folder: 'Star' },
  { id: 'hundred', folder: 'Hundred points' },
  { id: 'gem', folder: 'Gem stone' },
  { id: 'balloon', folder: 'Balloon' },
  { id: 'gift', folder: 'Wrapped gift' },
  // feedback
  { id: 'check', folder: 'Check mark button' },
  { id: 'cross', folder: 'Cross mark' },
  { id: 'clap', folder: 'Clapping hands', defaultTone: true },
  { id: 'thinking', folder: 'Thinking face' },
  { id: 'partying', folder: 'Partying face' },
  { id: 'starstruck', folder: 'Star-struck' },
  { id: 'exploding-head', folder: 'Exploding head' },
  { id: 'crying', folder: 'Loudly crying face' },
  { id: 'hot-face', folder: 'Hot face' },
  { id: 'winking', folder: 'Winking face' },
  { id: 'monocle', folder: 'Face with monocle' },
  { id: 'eyes', folder: 'Eyes' },
  // time & ideas
  { id: 'alarm-clock', folder: 'Alarm clock' },
  { id: 'stopwatch', folder: 'Stopwatch' },
  { id: 'hourglass', folder: 'Hourglass not done' },
  { id: 'light-bulb', folder: 'Light bulb' },
  { id: 'brain', folder: 'Brain' },
  { id: 'bullseye', folder: 'Bullseye' },
  { id: 'rocket', folder: 'Rocket' },
  { id: 'bolt', folder: 'High voltage' },
  { id: 'megaphone', folder: 'Megaphone' },
  // powers
  { id: 'shield', folder: 'Shield' },
  { id: 'bomb', folder: 'Bomb' },
  { id: 'snowflake', folder: 'Snowflake' },
  { id: 'fog', folder: 'Fog' },
  { id: 'shuffle', folder: 'Shuffle tracks button' },
  { id: 'lock', folder: 'Locked' },
  { id: 'coin', folder: 'Coin' },
  // category icons
  { id: 'cat-general', folder: 'Globe with meridians' },
  { id: 'cat-cinema', folder: 'Clapper board' },
  { id: 'cat-games', folder: 'Video game' },
  { id: 'cat-music', folder: 'Headphone' },
  { id: 'cat-history', folder: 'Classical building' },
  { id: 'cat-science', folder: 'Test tube' },
  { id: 'cat-sports', folder: 'Soccer ball' },
  { id: 'cat-tech', folder: 'Laptop' },
  { id: 'cat-2000s', folder: 'Optical disk' },
  { id: 'cat-mixed', folder: 'Game die' },
  { id: 'cat-custom', folder: 'Pencil' },
];

/** Frame-animated celebration/reaction art (loaded lazily for big moments only). */
export const ANIMATIONS: readonly NotoAnimation[] = [
  { id: 'party-popper', codepoint: '1f389', size: 160 },
  { id: 'confetti-ball', codepoint: '1f38a' },
  { id: 'trophy', codepoint: '1f3c6', size: 160 },
  { id: 'fire', codepoint: '1f525' },
  { id: 'clap', codepoint: '1f44f' },
  { id: 'sparkles', codepoint: '2728' },
  { id: 'hundred', codepoint: '1f4af' },
  { id: 'crown', codepoint: '1f451', size: 160 },
  { id: 'starstruck', codepoint: '1f929' },
  { id: 'partying', codepoint: '1f973' },
  { id: 'thinking', codepoint: '1f914' },
  { id: 'sunglasses', codepoint: '1f60e' },
  { id: 'hourglass', codepoint: '23f3' },
  { id: 'alarm-clock', codepoint: '23f0' },
  { id: 'boom', codepoint: '1f4a5' },
  { id: 'rocket', codepoint: '1f680' },
  { id: 'medal-gold', codepoint: '1f947' },
  { id: 'exploding-head', codepoint: '1f92f' },
  { id: 'crying', codepoint: '1f62d' },
  { id: 'raising-hands', codepoint: '1f64c' },
];

export const LICENSES = {
  fluent: {
    name: 'Fluent Emoji (3D)',
    author: 'Microsoft Corporation',
    license: 'MIT',
    source: 'https://github.com/microsoft/fluentui-emoji',
    notice: `MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  },
  noto: {
    name: 'Noto Emoji animations',
    author: 'Google LLC',
    license: 'CC BY 4.0',
    source: 'https://googlefonts.github.io/noto-emoji-animation/',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    notice:
      'Animated emoji by Google (Noto Emoji Animation), licensed under Creative Commons Attribution 4.0 International. Frames were resized and re-encoded; no other changes were made.',
  },
} as const;

export function fluentUrl(asset: FluentAsset): string {
  const folder = encodeURIComponent(asset.folder).replaceAll('%2F', '/');
  const file = asset.folder.toLowerCase().replaceAll(' ', '_').replaceAll(/[:'’]/gu, '');
  return asset.defaultTone
    ? `${FLUENT_BASE}/${folder}/Default/3D/${file}_3d_default.png`
    : `${FLUENT_BASE}/${folder}/3D/${file}_3d.png`;
}

export function notoUrl(animation: NotoAnimation): string {
  return `${NOTO_BASE}/${animation.codepoint}/512.webp`;
}
