import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AVATAR_IDS, MAX_NICKNAME_LENGTH, type AvatarId } from '@quizparty/protocol/constants';
import type { RoomPreview } from '@quizparty/protocol';
import { parseRoomCode } from '@quizparty/shared';
import { Avatar, Body, Button, ErrorText, Field, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { theme } from '../ui/theme';

/**
 * Join: room code + nickname + avatar. Opened empty from Home, or with the code filled in by a deep
 * link / universal link. The server validates everything again (nickname rules, room state); this
 * form only avoids pointless round trips.
 */
export function JoinScreen({
  initialCode,
  initialNickname,
  initialAvatar,
  preview,
  joining,
  error,
  onSubmit,
}: {
  initialCode: string;
  initialNickname: string;
  initialAvatar: AvatarId;
  /** Result of the room lookup for a prefilled code; null = not found, undefined = not looked up. */
  preview?: RoomPreview | null | undefined;
  joining: boolean;
  error: string | null;
  onSubmit: (code: string, nickname: string, avatarId: AvatarId) => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState(initialNickname);
  const [avatarId, setAvatarId] = useState<AvatarId>(initialAvatar);
  const parsed = parseRoomCode(code);
  const trimmed = nickname.trim();
  const previewNote =
    preview === null
      ? t('join.preview.missing')
      : preview && !preview.joinable
        ? preview.playerCount >= preview.maxPlayers
          ? t('join.preview.full')
          : t('join.preview.started')
        : null;
  const canSubmit = parsed !== null && trimmed.length >= 2 && !joining && !previewNote;

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      testID="join"
    >
      <Title>{t('join.title')}</Title>
      <Field
        label={t('m.join.code')}
        value={code}
        onChangeText={(value) => setCode(value.toUpperCase().slice(0, 8))}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={t('m.join.codePlaceholder')}
        testID="join-code"
      />
      {code !== '' && parsed === null ? <Body tone="muted">{t('m.join.codeInvalid')}</Body> : null}
      <Field
        label={t('join.nickname')}
        value={nickname}
        onChangeText={setNickname}
        maxLength={MAX_NICKNAME_LENGTH}
        autoCorrect={false}
        placeholder={t('join.nickname.placeholder')}
        testID="join-nickname"
      />
      <Body tone="muted">{t('m.join.nicknameHint')}</Body>
      <Body>{t('join.avatar')}</Body>
      <View style={styles.avatars} accessibilityRole="radiogroup">
        {AVATAR_IDS.map((id) => (
          <Pressable
            key={id}
            testID={`avatar-${id}`}
            accessibilityRole="radio"
            accessibilityLabel={id}
            accessibilityState={{ selected: id === avatarId }}
            onPress={() => setAvatarId(id)}
            style={[styles.avatar, id === avatarId && styles.avatarOn]}
          >
            <Avatar avatarId={id} size={44} />
          </Pressable>
        ))}
      </View>
      {previewNote ? <ErrorText testID="join-preview">{previewNote}</ErrorText> : null}
      {error ? <ErrorText testID="join-error">{error}</ErrorText> : null}
      <Button
        big
        testID="join-submit"
        label={joining ? t('join.joining') : t('join.submit')}
        disabled={!canSubmit}
        busy={joining}
        onPress={() => parsed && onSubmit(parsed, trimmed, avatarId)}
      />
      <Text style={{ height: 1 }} />
    </ScrollView>
  );
}

const { spacing, radius, colors } = theme;
const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  avatar: { padding: 4, borderRadius: radius.pill, borderWidth: 3, borderColor: 'transparent' },
  avatarOn: { borderColor: colors.accentA },
});
