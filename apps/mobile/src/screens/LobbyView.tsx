import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoomView } from '@quizparty/protocol';
import { MAX_ROUNDS, MIN_ROUNDS } from '@quizparty/protocol/constants';
import type { DifficultyPreset } from '@quizparty/protocol';
import { Avatar, Body, Button, ErrorText, Field, Panel, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { theme } from '../ui/theme';
import type { ControllerActions } from './actions';

const ROUND_CHOICES = [5, 10, 15, 20] as const;
const DIFFICULTIES: readonly DifficultyPreset[] = ['EASY', 'MEDIUM', 'HARD'];

export function LobbyView({
  room,
  busy,
  error,
  actions,
}: {
  room: RoomView;
  busy: boolean;
  error: string | null;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const me = room.players.find((player) => player.playerId === room.you?.playerId);
  const isLeader = (room.you?.isLeader ?? false) || (room.you?.canHost ?? false);
  const statementCount =
    room.phaseData.phase === 'LOBBY' ? (room.phaseData.statementPlayerIds?.length ?? 0) : 0;
  const whoSaidIt = room.settings.mode === 'WHO_SAID_IT';
  // Who Said It needs a guesser for every statement: two are the least that makes a game.
  const enough = room.players.length >= 2 && (!whoSaidIt || statementCount >= 2);

  return (
    <ScrollView contentContainerStyle={styles.scroll} testID="ctl-lobby">
      <Title>{t('ctl.lobby.title')}</Title>
      <Body tone="muted">
        {t('m.lobby.room', { code: room.code })} ·{' '}
        {t(room.tier === 'FULL' ? 'm.lobby.tier.FULL' : 'm.lobby.tier.FREE')}
      </Body>
      <Panel>
        <Body tone="muted">{t('m.lobby.players', { count: room.players.length })}</Body>
        {room.players.map((player) => (
          <View
            key={player.playerId}
            style={styles.row}
            accessible
            accessibilityLabel={`${player.nickname}${player.playerId === me?.playerId ? `, ${t('ctl.lobby.you')}` : ''}${player.ready ? `, ${t('m.lobby.readyMark')}` : ''}`}
          >
            <Avatar avatarId={player.avatarId} colorSlot={player.colorSlot} size={40} />
            <Text style={styles.name}>
              {player.nickname}
              {player.isLeader ? ' 👑' : ''}
            </Text>
            <Text style={player.ready ? styles.ready : styles.waiting}>
              {player.ready ? '✓' : '…'}
            </Text>
          </View>
        ))}
      </Panel>
      {whoSaidIt ? <StatementForm room={room} actions={actions} /> : null}
      {isLeader ? (
        <Panel>
          <Body tone="muted">{t('ctl.lobby.rounds')}</Body>
          <View style={styles.chips}>
            {ROUND_CHOICES.filter(
              (n) => n >= MIN_ROUNDS && n <= Math.min(MAX_ROUNDS, room.limits.maxRounds),
            ).map((n) => (
              <Button
                key={n}
                label={String(n)}
                variant={room.settings.rounds === n ? 'gold' : 'ghost'}
                onPress={() => actions.settings({ rounds: n })}
                style={styles.chip}
              />
            ))}
          </View>
          <View style={styles.chips}>
            {DIFFICULTIES.map((d) => (
              <Button
                key={d}
                label={td(`game.difficulty.${d}`)}
                variant={room.settings.difficulty === d ? 'gold' : 'ghost'}
                onPress={() => actions.settings({ difficulty: d })}
                style={styles.chip}
              />
            ))}
          </View>
        </Panel>
      ) : null}
      {error ? <ErrorText testID="ctl-error">{error}</ErrorText> : null}
      <Button
        big
        variant={me?.ready ? 'ghost' : 'violet'}
        label={me?.ready ? t('ctl.lobby.notReady') : t('ctl.lobby.ready')}
        onPress={() => actions.ready(!me?.ready)}
        testID="ctl-ready"
      />
      {isLeader ? (
        <>
          {!enough ? <Body tone="muted">{t('m.lobby.needPlayers')}</Body> : null}
          <Button
            big
            label={t('ctl.lobby.start')}
            disabled={!enough}
            busy={busy}
            onPress={actions.start}
            testID="ctl-start"
          />
        </>
      ) : (
        <Body tone="muted">{t('ctl.lobby.waitingLeader')}</Body>
      )}
      <Button
        variant="ghost"
        label={t('ctl.results.leave')}
        onPress={actions.leave}
        testID="ctl-leave"
      />
    </ScrollView>
  );
}

function StatementForm({ room, actions }: { room: RoomView; actions: ControllerActions }) {
  const { t, td } = useI18n();
  const mine = room.you?.myStatement ?? '';
  const [text, setText] = useState(mine);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const send = (): void => {
    setSending(true);
    setMessage(null);
    actions
      .submitStatement(text)
      .then(() => setMessage(t('ctl.statement.sent')))
      .catch((cause: unknown) => {
        const failure = cause as { code?: string; params?: { reason?: string } } | undefined;
        setMessage(
          failure?.code === 'TEXT_REJECTED' && failure.params?.reason
            ? td(`ctl.statement.reason.${failure.params.reason}`)
            : td(`error.${failure?.code ?? 'INTERNAL'}`),
        );
      })
      .finally(() => setSending(false));
  };
  return (
    <Panel>
      <Body>{t('ctl.statement.title')}</Body>
      <Field
        label={t('ctl.statement.title')}
        value={text}
        onChangeText={setText}
        maxLength={140}
        placeholder={t('ctl.statement.placeholder')}
        testID="statement-input"
      />
      <Button
        label={mine ? t('ctl.statement.update') : t('ctl.statement.send')}
        busy={sending}
        onPress={send}
        testID="statement-send"
      />
      {message ? <Body tone="muted">{message}</Body> : null}
    </Panel>
  );
}

const { spacing, colors } = theme;
const styles = StyleSheet.create({
  scroll: { padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  name: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 },
  ready: { color: colors.success, fontSize: 22, fontWeight: '900' },
  waiting: { color: colors.mutedText, fontSize: 22 },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { flexGrow: 1, minWidth: 64 },
});
