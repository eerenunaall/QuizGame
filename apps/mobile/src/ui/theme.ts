import { answerColors, colors, radius, spacing } from '@quizparty/ui-tokens';

/** Native styling comes from the same tokens as the TV and the browser controller (GDD §33). */
export const theme = { colors, radius, spacing, answerColors } as const;

/** Touch targets: ADR-0017 asks for at least 64 pt on the dominant action. */
export const TARGET = { normal: 52, big: 64 } as const;
