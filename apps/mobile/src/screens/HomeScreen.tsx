import { View } from 'react-native';
import { Body, Button, Center, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';

export function HomeScreen({
  resumeCode,
  onJoin,
  onResume,
  onFullGame,
  onProfile,
  onToggleLocale,
}: {
  /** A stored seat the player can return to. */
  resumeCode: string | null;
  onJoin: () => void;
  onResume: (code: string) => void;
  onFullGame: () => void;
  onProfile: () => void;
  onToggleLocale: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <Center testID="home">
      <Title testID="home-title">{t('brand.name')}</Title>
      <Body tone="muted">{t('brand.tagline')}</Body>
      <View style={{ alignSelf: 'stretch', gap: 12 }}>
        {resumeCode ? (
          <Button
            big
            testID="home-resume"
            label={t('m.home.rejoin', { code: resumeCode })}
            onPress={() => onResume(resumeCode)}
          />
        ) : null}
        <Button
          big
          testID="home-join"
          variant={resumeCode ? 'violet' : 'gold'}
          label={t('m.home.join')}
          onPress={onJoin}
        />
        <Body tone="muted">{t('m.home.joinHint')}</Body>
        <Button
          testID="home-full"
          variant="ghost"
          label={t('m.home.fullGame')}
          onPress={onFullGame}
        />
        <Button
          testID="home-profile"
          variant="ghost"
          label={t('m.home.profile')}
          onPress={onProfile}
        />
        <Button
          testID="home-locale"
          variant="ghost"
          label={`${t('common.language')}: ${locale.toUpperCase()}`}
          onPress={onToggleLocale}
        />
      </View>
    </Center>
  );
}
