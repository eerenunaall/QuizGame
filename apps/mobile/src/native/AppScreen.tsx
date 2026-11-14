import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@quizparty/ui-tokens';

/** Safe-area frame shared by every route (notch, home indicator, Android cutouts). */
export function AppScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>{children}</SafeAreaView>
  );
}
