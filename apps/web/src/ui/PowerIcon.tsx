import type { ReactNode } from 'react';
import type { StickerId } from '../lib/assets';
import { Sticker } from './Sticker';
import { cx } from '../lib/cx';

/**
 * Icons for the ADR-0023 risks and sabotages: Cover (umbrella), Duel (crossed swords), Pot (jar),
 * Stake Cap (padlock on a ladder), Cut (scissors and a coin), Blind Clock (clock with a slash).
 * Drawn for this project as plain inline SVG (a heavy dark outline over flat warm colours, which
 * sits next to the 3D emoji stickers without pretending to be one). No third-party art, no data: URIs,
 * so the strict CSP needs nothing new. Decorative: meaning is always carried by the text next to it.
 */
export type OwnIconId = 'cover' | 'duel' | 'pot' | 'stake-cap' | 'cut' | 'blind-clock';
export type PowerIconId = StickerId | OwnIconId;

const INK = '#2b2140';
const GOLD = '#ffc928';
const ORANGE = '#ff8a3d';
const SKY = '#4aa3ff';
const STEEL = '#d5dde9';
const ROSE = '#ff5c8a';

const stroke = {
  stroke: INK,
  strokeWidth: 4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const SHAPES: Record<OwnIconId, ReactNode> = {
  // An umbrella: a scalloped canopy, a shaft and a hooked handle.
  cover: (
    <>
      <path d="M32 10C17 10 7 22 7 35h50C57 22 47 10 32 10Z" fill={SKY} {...stroke} />
      <path
        d="M7 35c4 4 9 4 12.5 0 4 4 9 4 12.5 0 3.5 4 8.5 4 12.5 0 3.5 4 8.5 4 12.5 0"
        fill={SKY}
        {...stroke}
      />
      <path d="M32 35v16a6 6 0 0 1-12 0" fill="none" {...stroke} />
      <path d="M32 6v4" fill="none" {...stroke} />
    </>
  ),
  // Two swords crossed, guards and pommels.
  duel: (
    <>
      <path d="M12 10l30 30" fill="none" stroke={STEEL} strokeWidth={9} strokeLinecap="round" />
      <path d="M52 10L22 40" fill="none" stroke={STEEL} strokeWidth={9} strokeLinecap="round" />
      <path d="M12 10l30 30M52 10L22 40" fill="none" {...stroke} strokeWidth={3} />
      <path
        d="M38 36l8 8M26 36l-8 8"
        fill="none"
        stroke={GOLD}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path
        d="M44 46l7 7M20 46l-7 7"
        fill="none"
        stroke={ORANGE}
        strokeWidth={7}
        strokeLinecap="round"
      />
    </>
  ),
  // A clay jar with a lid and a coin dropping in.
  pot: (
    <>
      <path
        d="M20 20c-8 6-10 14-10 22 0 9 9 14 22 14s22-5 22-14c0-8-2-16-10-22Z"
        fill={ORANGE}
        {...stroke}
      />
      <rect x="19" y="13" width="26" height="9" rx="4" fill={GOLD} {...stroke} />
      <circle cx="32" cy="38" r="8" fill={GOLD} {...stroke} strokeWidth={3} />
      <path d="M32 34v8" fill="none" {...stroke} strokeWidth={3} />
    </>
  ),
  // A ladder whose top rung is padlocked.
  'stake-cap': (
    <>
      <path d="M16 58V20M40 58V20" fill="none" {...stroke} />
      <path d="M16 30h24M16 42h24M16 54h24" fill="none" {...stroke} />
      <rect x="31" y="14" width="26" height="22" rx="5" fill={GOLD} {...stroke} />
      <path d="M37 14v-3a7 7 0 0 1 14 0v3" fill="none" {...stroke} />
      <circle cx="44" cy="25" r="3" fill={INK} />
    </>
  ),
  // Scissors snipping a coin.
  cut: (
    <>
      <circle cx="42" cy="40" r="15" fill={GOLD} {...stroke} />
      <path d="M42 33v14M37 37h10" fill="none" {...stroke} strokeWidth={3} />
      <path
        d="M10 12l30 26M10 52l30-26"
        fill="none"
        stroke={STEEL}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path d="M10 12l30 26M10 52l30-26" fill="none" {...stroke} strokeWidth={2.5} />
      <circle cx="12" cy="14" r="6" fill={ROSE} {...stroke} strokeWidth={3} />
      <circle cx="12" cy="50" r="6" fill={ROSE} {...stroke} strokeWidth={3} />
    </>
  ),
  // A clock face with a bar across it.
  'blind-clock': (
    <>
      <circle cx="32" cy="32" r="23" fill="#fff6dc" {...stroke} />
      <path d="M32 18v14l9 6" fill="none" {...stroke} />
      <path d="M12 52L52 12" fill="none" stroke={ROSE} strokeWidth={8} strokeLinecap="round" />
      <path d="M12 52L52 12" fill="none" {...stroke} strokeWidth={2} />
    </>
  ),
};

export function isOwnIcon(id: PowerIconId): id is OwnIconId {
  return id in SHAPES;
}

/** A power's picture: one of the project's own SVG icons, or an existing sticker. */
export function PowerIcon({
  id,
  size = 48,
  className,
}: {
  id: PowerIconId;
  size?: number;
  className?: string;
}) {
  if (!isOwnIcon(id)) return <Sticker id={id} size={size} {...(className ? { className } : {})} />;
  return (
    <svg
      className={cx('qp-power-icon', className)}
      data-sticker={id}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[id]}
    </svg>
  );
}
