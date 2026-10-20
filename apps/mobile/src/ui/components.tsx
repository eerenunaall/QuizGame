import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { playerColor } from '@quizparty/ui-tokens';
import type { AvatarId } from '@quizparty/protocol/constants';
import { AVATAR_EMOJI } from './avatars';
import { TARGET, theme } from './theme';

const { colors, radius, spacing } = theme;

type Variant = 'gold' | 'violet' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'gold',
  big = false,
  disabled = false,
  busy = false,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  big?: boolean;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        { minHeight: big ? TARGET.big : TARGET.normal },
        variantStyle[variant],
        inactive && styles.inactive,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'gold' ? colors.backgroundDeep : colors.text} />
      ) : (
        <Text style={[styles.buttonText, variant === 'gold' && styles.buttonTextOnGold]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function Title({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text accessibilityRole="header" style={styles.title} testID={testID}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  tone = 'normal',
  testID,
}: {
  children: ReactNode;
  tone?: 'normal' | 'muted' | 'good' | 'bad';
  testID?: string;
}) {
  return (
    <Text style={[styles.body, tone === 'muted' && styles.muted, toneStyle[tone]]} testID={testID}>
      {children}
    </Text>
  );
}

export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.error}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** Centered column used by the "look at the TV" style screens. */
export function Center({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      {children}
    </View>
  );
}

export function Avatar({
  avatarId,
  colorSlot,
  size = 48,
}: {
  avatarId: AvatarId;
  colorSlot?: number;
  size?: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colorSlot ? playerColor(colorSlot) : colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.55 }}>{AVATAR_EMOJI[avatarId]}</Text>
    </View>
  );
}

export function Field({
  label,
  testID,
  ...input
}: { label: string; testID?: string } & Omit<TextInputProps, 'style'>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedText}
        style={styles.input}
        testID={testID}
        {...input}
      />
    </View>
  );
}

/** Countdown bar driven by the server-synchronised clock; purely cosmetic, the server owns the deadline. */
export function TimerBar({
  now,
  startAt,
  deadlineAt,
  testID,
}: {
  now: () => number;
  startAt: number;
  deadlineAt: number;
  testID?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const total = Math.max(1, deadlineAt - startAt);
  const left = Math.max(0, Math.min(total, deadlineAt - now()));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: left }}
      style={styles.timerTrack}
      testID={testID}
    >
      <View
        style={[
          styles.timerFill,
          {
            width: `${(left / total) * 100}%`,
            backgroundColor: left / total < 0.25 ? colors.danger : colors.accentA,
          },
        ]}
      />
    </View>
  );
}

const variantStyle: Record<Variant, ViewStyle> = {
  gold: { backgroundColor: colors.accentA },
  violet: { backgroundColor: colors.accentB },
  ghost: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.surfaceLine },
  danger: { backgroundColor: colors.danger },
};
const toneStyle = StyleSheet.create({
  normal: {},
  muted: {},
  good: { color: colors.success },
  bad: { color: colors.danger },
});

export const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  buttonTextOnGold: { color: colors.backgroundDeep },
  inactive: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.98 }] },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceLine,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '900', textAlign: 'center' },
  body: { color: colors.text, fontSize: 16, textAlign: 'center' },
  muted: { color: colors.mutedText },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center', fontWeight: '700' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  field: { gap: spacing.xs, alignSelf: 'stretch' },
  fieldLabel: { color: colors.mutedText, fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: colors.backgroundDeep,
    borderColor: colors.surfaceLine,
    borderWidth: 2,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 20,
    minHeight: TARGET.normal,
    paddingHorizontal: spacing.md,
  },
  timerTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  timerFill: { height: 10, borderRadius: radius.pill },
});
