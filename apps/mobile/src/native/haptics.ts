import * as Haptics from 'expo-haptics';

export type HapticKind = 'tap' | 'lock' | 'correct' | 'wrong';

/**
 * Optional feedback (ADR-0017): never required to play, off for reduced effects or when the player
 * turned it off. Failures are swallowed: a device without a taptic engine is not an error.
 * Device behaviour is not provable in the sandbox (docs/MOBILE.md).
 */
export function haptic(kind: HapticKind): void {
  const run = async (): Promise<void> => {
    switch (kind) {
      case 'tap':
        return Haptics.selectionAsync();
      case 'lock':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'correct':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'wrong':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };
  void run().catch(() => undefined);
}
