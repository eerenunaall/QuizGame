import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { Avatar, Body, Button, Center, Panel, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { theme } from '../ui/theme';
import type { ControllerActions } from './actions';
import { useEffect, useRef } from 'react';

/** What happened to this player on the reveal (CORRECT / INCORRECT / NO_ANSWER). */
export function RevealView({
  data,
  myId,
  whoSaidIt,
  sitOut,
  actions,
}: {
  data: PhaseDataOf<'REVEAL'>;
  myId: string;
  whoSaidIt: boolean;
  sitOut: boolean;
  actions: ControllerActions;
}) {
  const { t } = useI18n();
  const outcome = data.results.find((result) => result.playerId === myId)?.outcome ?? 'NO_ANSWER';
  const correctText = data.options.find((o) => o.optionId === data.correctOptionId)?.text ?? '';
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    actions.haptic?.(outcome === 'CORRECT' ? 'correct' : 'wrong');
    // One haptic per reveal; the callback identity does not matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);
  return (
    <Center testID="ctl-reveal">
      <Text style={styles.icon}>
        {outcome === 'CORRECT' ? '🎉' : outcome === 'INCORRECT' ? '✗' : '⌛'}
      </Text>
      <Text
        testID="ctl-outcome"
        accessibilityRole="header"
        style={[
          styles.outcome,
          outcome === 'CORRECT' ? styles.good : outcome === 'INCORRECT' ? styles.bad : null,
        ]}
      >
        {sitOut
          ? t('ctl.statement.mine')
          : outcome === 'CORRECT'
            ? t('ctl.reveal.correct')
            : outcome === 'INCORRECT'
              ? t('ctl.reveal.incorrect')
              : t('ctl.reveal.noAnswer')}
      </Text>
      <Panel>
        <Body tone="muted">{t('game.reveal.correct')}</Body>
        <Text style={styles.correct}>
          {whoSaidIt ? t('whosaidit.reveal', { name: correctText }) : correctText}
        </Text>
      </Panel>
    </Center>
  );
}

export function ScoreView({
  data,
  myId,
  room,
}: {
  data: PhaseDataOf<'SCORE_UPDATE'>;
  myId: string;
  room: RoomView;
}) {
  const { t } = useI18n();
  const mine = data.deltas.find((delta) => delta.playerId === myId);
  const top = data.scoreboard.slice(0, 3).flatMap((entry) => {
    const player = room.players.find((p) => p.playerId === entry.playerId);
    return player ? [{ entry, player }] : [];
  });
  return (
    <Center testID="ctl-score">
      {mine ? (
        <>
          <Text
            testID="ctl-delta"
            style={[
              styles.delta,
              mine.delta > 0 ? styles.good : mine.delta < 0 ? styles.bad : null,
            ]}
          >
            {mine.delta > 0 ? `+${mine.delta}` : mine.delta < 0 ? String(mine.delta) : '±0'}
          </Text>
          <Body>{t('ctl.score.rank', { rank: mine.rank })}</Body>
          <Body tone="muted">{t('ctl.score.total', { total: mine.total })}</Body>
        </>
      ) : null}
      <View style={styles.mini}>
        {top.map(({ entry, player }) => (
          <View key={entry.playerId} style={styles.miniRow}>
            <Text style={styles.miniRank}>{entry.rank}</Text>
            <Avatar avatarId={player.avatarId} colorSlot={player.colorSlot} size={34} />
            <Text style={styles.miniName}>{player.nickname}</Text>
            <Text style={styles.miniScore}>{entry.score}</Text>
          </View>
        ))}
      </View>
    </Center>
  );
}

export function ResultsView({
  data,
  myId,
  room,
  isLeader,
  busy,
  actions,
}: {
  data: PhaseDataOf<'RESULTS'>;
  myId: string;
  room: RoomView;
  isLeader: boolean;
  busy: boolean;
  actions: ControllerActions;
}) {
  const { t } = useI18n();
  const mine = data.ranking.find((entry) => entry.playerId === myId);
  const me = room.players.find((player) => player.playerId === myId);
  return (
    <ScrollView contentContainerStyle={styles.results} testID="ctl-results">
      <Body tone="muted">{t('ctl.results.you')}</Body>
      {me ? <Avatar avatarId={me.avatarId} colorSlot={me.colorSlot} size={96} /> : null}
      <Text
        testID="ctl-final-rank"
        style={styles.rank}
        accessibilityLabel={t('ctl.score.rank', { rank: mine?.rank ?? 0 })}
      >
        {mine?.rank ?? '-'}
      </Text>
      <Body>
        {t('results.points', { points: mine?.score ?? 0 })} ·{' '}
        {t('results.correct', { count: mine?.correctCount ?? 0 })}
      </Body>
      <Title>{t('results.title')}</Title>
      <Panel>
        {data.ranking.map((entry) => {
          const player = room.players.find((p) => p.playerId === entry.playerId);
          return (
            <View key={entry.playerId} style={styles.miniRow}>
              <Text style={styles.miniRank}>{entry.rank}</Text>
              {player ? (
                <Avatar avatarId={player.avatarId} colorSlot={player.colorSlot} size={34} />
              ) : null}
              <Text style={styles.miniName}>{player?.nickname ?? ''}</Text>
              <Text style={styles.miniScore}>{entry.score}</Text>
            </View>
          );
        })}
      </Panel>
      {isLeader ? (
        <>
          <Button
            big
            label={t('results.rematch')}
            busy={busy}
            onPress={actions.rematch}
            testID="ctl-rematch"
          />
          <Button
            variant="violet"
            label={t('results.backToLobby')}
            onPress={actions.backToLobby}
            testID="ctl-lobby-back"
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

const { spacing, colors } = theme;
const styles = StyleSheet.create({
  icon: { fontSize: 88, color: colors.text },
  outcome: { color: colors.text, fontSize: 34, fontWeight: '900', textAlign: 'center' },
  good: { color: colors.success },
  bad: { color: colors.danger },
  correct: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  delta: { color: colors.text, fontSize: 72, fontWeight: '900' },
  mini: { alignSelf: 'stretch', gap: spacing.sm },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  miniRank: { color: colors.accentA, fontSize: 20, fontWeight: '900', width: 28 },
  miniName: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 },
  miniScore: { color: colors.text, fontSize: 17, fontWeight: '900' },
  results: { padding: spacing.md, gap: spacing.md, alignItems: 'center' },
  rank: { color: colors.accentA, fontSize: 96, fontWeight: '900' },
});
