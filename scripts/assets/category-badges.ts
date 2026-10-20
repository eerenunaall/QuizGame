/** Badge data for the original demo-category icons (rendered by category-icons.ts). */
export interface CategoryBadge {
  /** Sticker id (`cat-…`), also the output file name. */
  id: string;
  /** Category id in seed/demo/categories.json. */
  category: string;
  /** Badge colour; white-on-colour contrast must stay >= 4.5:1. */
  color: string;
  /** SVG body drawn in white inside a 192 x 192 box (centre 96,96). */
  glyph: string;
}

const line = (d: string, w = 9): string => `<path d="${d}" fill="none" stroke-width="${w}"/>`;

export const CATEGORY_BADGES: readonly CategoryBadge[] = [
  {
    // sword
    id: 'cat-got',
    category: 'game-of-thrones',
    color: '#7A4F1D',
    glyph: `<path d="M96 30 L106 50 V112 H86 V50 Z" stroke-width="2"/>${line('M68 118 H124', 12)}${line('M96 120 V152', 12)}<circle cx="96" cy="158" r="7" stroke-width="2"/>`,
  },
  {
    // magic wand with sparks
    id: 'cat-wizard',
    category: 'harry-potter',
    color: '#5E3A99',
    glyph: `${line('M56 148 L128 76', 12)}<path d="M138 38 L144 56 L162 62 L144 68 L138 86 L132 68 L114 62 L132 56 Z" stroke-width="2"/><circle cx="64" cy="64" r="7" stroke="none"/><circle cx="150" cy="112" r="6" stroke="none"/>`,
  },
  {
    // war hammer
    id: 'cat-wargame',
    category: 'warhammer',
    color: '#A3332A',
    glyph: `<rect x="52" y="44" width="88" height="42" rx="6" stroke-width="2"/>${line('M96 86 V158', 14)}<path d="M52 56 L34 65 L52 74 Z" stroke-width="2"/>`,
  },
  {
    // laboratory flask
    id: 'cat-chemistry',
    category: 'breaking-bad',
    color: '#27704A',
    glyph: `${line('M80 40 H112', 10)}<path d="M84 44 V84 L50 142 Q44 156 60 156 H132 Q148 156 142 142 L108 84 V44 Z" fill="none" stroke-width="9"/><path d="M62 130 H130 L140 146 Q142 150 136 150 H56 Q50 150 52 146 Z" stroke-width="2"/>`,
  },
  {
    // scales of justice
    id: 'cat-law',
    category: 'better-call-saul',
    color: '#B4540A',
    glyph: `${line('M96 40 V150', 9)}${line('M66 150 H126', 10)}${line('M52 58 H140', 8)}${line('M52 58 L36 106 M52 58 L68 106 M140 58 L124 106 M140 58 L156 106', 5)}<path d="M32 106 H72 A20 20 0 0 1 32 106 Z M120 106 H160 A20 20 0 0 1 120 106 Z" stroke-width="2"/>`,
  },
  {
    // briefcase
    id: 'cat-office',
    category: 'the-office',
    color: '#4A5864',
    glyph: `<path d="M72 64 V52 Q72 44 80 44 H112 Q120 44 120 52 V64" fill="none" stroke-width="9"/><rect x="40" y="64" width="112" height="82" rx="12" stroke-width="2"/><rect x="40" y="96" width="112" height="8" fill="#4A5864" stroke="none"/><rect x="86" y="90" width="20" height="22" rx="4" fill="#4A5864" stroke-width="4"/>`,
  },
  {
    // sofa
    id: 'cat-sitcom',
    category: 'how-i-met-your-mother',
    color: '#0B6E78',
    glyph: `<rect x="56" y="48" width="80" height="48" rx="14" stroke-width="2"/><rect x="34" y="80" width="28" height="56" rx="12" stroke-width="2"/><rect x="130" y="80" width="28" height="56" rx="12" stroke-width="2"/><rect x="50" y="94" width="92" height="42" rx="10" stroke-width="2"/>${line('M52 144 V156 M140 144 V156', 9)}`,
  },
  {
    // hero mask
    id: 'cat-hero-mask',
    category: 'marvel',
    color: '#A81F63',
    glyph: `<path d="M30 70 Q96 40 162 70 Q158 128 122 128 Q104 128 96 112 Q88 128 70 128 Q34 128 30 70 Z" stroke-width="3"/><path d="M52 84 Q64 96 82 90 Q78 106 62 108 Q50 104 52 84 Z M140 84 Q128 96 110 90 Q114 106 130 108 Q142 104 140 84 Z" fill="#A81F63" stroke="none"/>`,
  },
  {
    // night skyline with moon
    id: 'cat-skyline',
    category: 'dc',
    color: '#1D3C7C',
    glyph: `<rect x="34" y="104" width="28" height="52" stroke-width="2"/><rect x="68" y="76" width="30" height="80" stroke-width="2"/><rect x="104" y="92" width="24" height="64" stroke-width="2"/><rect x="134" y="112" width="24" height="44" stroke-width="2"/><path d="M142 36 A26 26 0 1 0 160 74 A22 22 0 0 1 142 36 Z" stroke-width="2"/>`,
  },
  {
    // star on a ring
    id: 'cat-hollywood',
    category: 'hollywood',
    color: '#8A5E00',
    glyph: `<circle cx="96" cy="96" r="66" fill="none" stroke-width="7"/><path d="M96 46 L109 78 L144 80 L117 102 L126 136 L96 117 L66 136 L75 102 L48 80 L83 78 Z" stroke-width="3"/>`,
  },
  {
    // film reel
    id: 'cat-reel',
    category: 'cult-films',
    color: '#2E2F45',
    glyph: `<circle cx="96" cy="96" r="62" fill="none" stroke-width="9"/><circle cx="96" cy="96" r="10" stroke="none"/><circle cx="96" cy="64" r="11" stroke="none"/><circle cx="96" cy="128" r="11" stroke="none"/><circle cx="64" cy="96" r="11" stroke="none"/><circle cx="128" cy="96" r="11" stroke="none"/>`,
  },
];
