import type { PanelIconName } from './tabs';

/** 24x24 line icons, drawn here so the panel needs no icon font and works offline once loaded. */
const PATHS: Record<PanelIconName, string> = {
  tables: 'M4 9h16M6 9v9M18 9v9M3 6h18v3H3z',
  new: 'M12 5v14M5 12h14',
  redeem: 'M4 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h16v-2a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V6H4zM10 9l4 6',
  displays: 'M3 5h18v11H3zM8 20h8M12 16v4',
  reward: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 20h8',
  entrance: 'M4 12l8-8h8v8l-8 8zM15.5 8.5h.01',
  look: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3A9 9 0 0 0 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  play: 'M6 7h12a3 3 0 0 1 3 3v5a2 2 0 0 1-3.5 1.3L16 15H8l-1.5 1.3A2 2 0 0 1 3 15v-5a3 3 0 0 1 3-3zM8 10v3M6.5 11.5h3M15.5 11h.01M17.5 12.5h.01',
  questions:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17h.01',
  studio: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  people:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
};

export function PanelIcon({ name, size = 26 }: { name: PanelIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
