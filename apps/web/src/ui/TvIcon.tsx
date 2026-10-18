interface Props {
  size?: number;
  className?: string;
}

/** A television with antennas, drawn in `currentColor` so every theme tints it. Decorative. */
export function TvIcon({ size = 40, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="tv"
    >
      <path d="M17 6l7 7 7-7" />
      <rect x="5" y="13" width="38" height="25" rx="5" />
      <rect x="10" y="18" width="22" height="15" rx="2.5" fill="currentColor" fillOpacity="0.22" />
      <circle cx="37" cy="22" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="37" cy="29" r="1.6" fill="currentColor" stroke="none" />
      <path d="M14 43h20" />
    </svg>
  );
}
