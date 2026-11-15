import { StyleSheet, Text, View } from 'react-native';
import type { BannerKind } from '../core/banner';
import { useI18n } from '../ui/i18n';
import { theme } from '../ui/theme';

export { bannerKind, type BannerKind } from '../core/banner';

export function ReconnectBanner({ kind }: { kind: BannerKind }) {
  const { t } = useI18n();
  if (!kind) return null;
  const text =
    kind === 'RECONNECTING'
      ? t('ctl.reconnecting')
      : kind === 'TV_LOST'
        ? t('ctl.tvLost')
        : t('ctl.restored');
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, kind === 'RESTORED' ? styles.ok : styles.warn]}
      testID={`banner-${kind}`}
    >
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  warn: { backgroundColor: theme.colors.warning },
  ok: { backgroundColor: theme.colors.success },
  text: {
    color: theme.colors.backgroundDeep,
    fontWeight: '800',
    textAlign: 'center',
    fontSize: 15,
  },
});
