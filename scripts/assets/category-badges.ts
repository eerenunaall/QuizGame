/** Badge data for the original category icons (demo categories and the seed/gusto additions) (rendered by category-icons.ts). */
export interface CategoryBadge {
  /** Sticker id (`cat-…`), also the output file name. */
  id: string;
  /** Category id in seed/demo/categories.json or seed/gusto/categories.json. */
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
  {
    // tulip tea glass on a saucer
    id: 'cat-tea',
    category: 'turkiye-kulturu',
    color: '#6D1F3A',
    glyph: `<path d="M62 40 H130 Q132 94 116 126 H76 Q60 94 62 40 Z" stroke-width="2"/><rect x="46" y="134" width="100" height="14" rx="7" stroke-width="2"/><rect x="60" y="66" width="72" height="7" fill="#6D1F3A" stroke="none"/>`,
  },
  {
    // old television with rabbit-ear antenna
    id: 'cat-tv-classic',
    category: 'yesilcam-turk-dizileri',
    color: '#7A2E0E',
    glyph: `<rect x="32" y="68" width="128" height="86" rx="14" fill="none" stroke-width="9"/><rect x="48" y="82" width="70" height="58" rx="6" stroke-width="2"/><circle cx="138" cy="94" r="7" stroke="none"/><circle cx="138" cy="118" r="7" stroke="none"/>${line('M96 68 L66 36 M96 68 L126 36', 7)}`,
  },
  {
    // ship's anchor
    id: 'cat-anchor',
    category: 'canakkale-ve-yoresi',
    color: '#1F63A8',
    glyph: `<circle cx="96" cy="44" r="12" fill="none" stroke-width="8"/>${line('M96 58 V150', 10)}${line('M70 78 H122', 9)}${line('M42 112 Q50 152 96 152 Q142 152 150 112', 10)}<path d="M30 104 L54 100 L46 126 Z M162 104 L138 100 L146 126 Z" stroke-width="2"/>`,
  },
  {
    // die with five pips
    id: 'cat-die',
    category: 'masa-oyunlari',
    color: '#3F6212',
    glyph: `<rect x="38" y="38" width="116" height="116" rx="24" fill="none" stroke-width="9"/><circle cx="70" cy="70" r="9" stroke="none"/><circle cx="122" cy="70" r="9" stroke="none"/><circle cx="96" cy="96" r="9" stroke="none"/><circle cx="70" cy="122" r="9" stroke="none"/><circle cx="122" cy="122" r="9" stroke="none"/>`,
  },
  {
    // wide-eyed smiling face
    id: 'cat-toon-face',
    category: 'anime-cizgi-film',
    color: '#3730A3',
    glyph: `<circle cx="96" cy="96" r="62" fill="none" stroke-width="8"/><ellipse cx="72" cy="84" rx="10" ry="16" stroke-width="2"/><ellipse cx="120" cy="84" rx="10" ry="16" stroke-width="2"/>${line('M66 118 Q96 148 126 118', 8)}`,
  },
  {
    // cassette tape
    id: 'cat-cassette',
    category: '90lar-nostalji',
    color: '#BE123C',
    glyph: `<rect x="32" y="52" width="128" height="88" rx="12" fill="none" stroke-width="9"/><circle cx="68" cy="90" r="14" fill="none" stroke-width="7"/><circle cx="124" cy="90" r="14" fill="none" stroke-width="7"/><rect x="62" y="114" width="68" height="14" rx="4" stroke-width="2"/>`,
  },
  {
    // football
    id: 'cat-football',
    category: 'futbol-turkiye',
    color: '#15803D',
    glyph: `<circle cx="96" cy="96" r="62" fill="none" stroke-width="8"/><path d="M96 68 L122 87 L112 117 L80 117 L70 87 Z" stroke-width="3"/>${line('M96 68 V36 M122 87 L152 77 M112 117 L130 144 M80 117 L62 144 M70 87 L40 77', 6)}`,
  },
];
