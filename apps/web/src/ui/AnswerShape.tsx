/**
 * The third cue of an answer card besides its colour and its letter (colour-blind safe, GDD §5.6):
 * triangle, diamond, circle, square. Solid white with a dark outline so it reads on every answer colour.
 */
const SHAPES = ['triangle', 'diamond', 'circle', 'square'] as const;
export type AnswerShapeName = (typeof SHAPES)[number];

export function answerShapeName(index: number): AnswerShapeName {
  return SHAPES[index % SHAPES.length] ?? 'square';
}

const PATHS: Record<AnswerShapeName, string> = {
  triangle: 'M16 4 L29 27 H3 Z',
  diamond: 'M16 3 L29 16 L16 29 L3 16 Z',
  circle: 'M16 4 A12 12 0 1 1 15.99 4 Z',
  square: 'M5 5 H27 V27 H5 Z',
};

export function AnswerShape({ index, size = 30 }: { index: number; size?: number }) {
  const name = answerShapeName(index);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      data-shape={name}
    >
      <path
        d={PATHS[name]}
        fill="#fff"
        stroke="rgba(27, 27, 58, 0.55)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
