import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Joker, PhaseDataOf, RiskTier, RoomView, SabotageKind } from '@quizparty/protocol';
import {
  JOKER_ORDER,
  SABOTAGE_ORDER,
  defaultStake,
  doubleDownState,
  stakeExcludesDoubleDown,
  sabotageState,
  sabotageTargets,
  type PrepChoice,
} from '@quizparty/controller-client';
import { Body, Button, ErrorText, Panel, TimerBar, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { theme } from '../ui/theme';
import type { ControllerActions } from './actions';

type PrepData = PhaseDataOf<'QUESTION_PREP'>;

/**
 * QUESTION_PREP: stake (risk), Double Down and at most one sabotage, committed together and final
 * once sent (ADR-0010). The category is known, the question is not.
 */
export function PrepView({
  room,
  data,
  now,
  actions,
}: {
  room: RoomView;
  data: PrepData;
  now: () => number;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const you = room.you;
  const committed = you?.commitment ?? null;
  const [stake, setStake] = useState<RiskTier>(() => defaultStake(data));
  const [doubleDown, setDoubleDown] = useState(false);
  const [sabotage, setSabotage] = useState<PrepChoice['sabotage']>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ddBlock = doubleDownState(data, you);
  // One big gamble per question: Double Down and the top stakes exclude each other (ADR-0021).
  const ddConflict = stakeExcludesDoubleDown(data, stake);
  const sabBlock = sabotageState(data, you);
  const byId = new Map(room.players.map((player) => [player.playerId, player]));

  const header = (
    <View>
      <Body tone="muted">
        {t('game.round.of', { n: data.round.index + 1, total: data.round.total })} ·{' '}
        {td(`game.kind.${data.round.kind}`)}
      </Body>
      <Title>{data.category.label}</Title>
      <Body tone="muted">{td(`game.difficulty.${data.difficulty}`)}</Body>
    </View>
  );

  if (committed) {
    const target = committed.sabotage ? byId.get(committed.sabotage.targetId) : undefined;
    return (
      <View style={styles.screen} testID="ctl-prep-committed">
        {header}
        <Panel>
          <Title>{t('ctl.prep.committed')}</Title>
          <Body>{td(`ctl.prep.stake.${committed.stake}`)}</Body>
          {committed.doubleDown ? <Body>{td('joker.DOUBLE_DOWN')}</Body> : null}
          {committed.sabotage && target ? (
            <Body>
              {t('ctl.prep.sabotageTo', {
                effect: td(`sabotage.${committed.sabotage.effect}`),
                name: target.nickname,
              })}
            </Body>
          ) : null}
          <Body tone="muted">
            {t('ctl.prep.waiting', {
              done: data.committedCount,
              total: Math.max(data.eligibleCount, data.committedCount),
            })}
          </Body>
        </Panel>
      </View>
    );
  }

  if (picking) {
    return (
      <SabotagePicker
        players={sabotageTargets(room.players, you?.playerId ?? '')}
        current={sabotage}
        onPick={(choice) => {
          setSabotage(choice);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    );
  }

  const commit = (): void => {
    if (sending) return;
    setSending(true);
    setError(null);
    actions.haptic?.('tap');
    actions
      .commit({ stake, doubleDown: doubleDown && ddBlock === null && !ddConflict, sabotage })
      .catch((cause: unknown) => {
        setError(td(`error.${(cause as { code?: string } | undefined)?.code ?? 'INTERNAL'}`));
      })
      .finally(() => setSending(false));
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="ctl-prep">
      {header}
      <Title>{t('ctl.prep.title')}</Title>
      {data.stakeMandatory ? <Body tone="muted">{t('ctl.prep.mandatory')}</Body> : null}
      <View accessibilityRole="radiogroup" style={styles.ladder}>
        {data.riskLadder.map((rung) => {
          const selected = rung.tier === stake;
          return (
            <Button
              key={rung.tier}
              testID={`stake-${rung.tier}`}
              variant={selected ? 'gold' : 'ghost'}
              label={`${td(`ctl.prep.stake.${rung.tier}`)} ×${rung.multiplier} · ${
                rung.loss > 0
                  ? t('ctl.prep.stake.loss', { loss: rung.loss })
                  : t('ctl.prep.stake.noLoss')
              }`}
              disabled={doubleDown && ddBlock === null && stakeExcludesDoubleDown(data, rung.tier)}
              onPress={() => setStake(rung.tier)}
            />
          );
        })}
      </View>

      <Panel>
        <Text style={styles.power}>{td('joker.DOUBLE_DOWN')}</Text>
        <Body tone="muted">
          {ddBlock === 'LOCKED'
            ? t('ctl.prep.locked')
            : ddBlock === 'NONE_LEFT'
              ? t('ctl.prep.none')
              : ddBlock === 'CLOSED'
                ? t('ctl.prep.sabotage.closed')
                : ddConflict
                  ? t('ctl.prep.doubleDown.conflict')
                  : t('ctl.prep.doubleDown.hint')}
        </Body>
        <Button
          testID="double-down"
          variant={doubleDown && !ddConflict ? 'violet' : 'ghost'}
          label={`${td('joker.DOUBLE_DOWN')} · ${t('ctl.prep.left', { count: you?.powers?.doubleDown ?? 0 })}`}
          disabled={ddBlock !== null || ddConflict}
          onPress={() => setDoubleDown(!doubleDown)}
        />
      </Panel>

      <Panel>
        <Text style={styles.power}>{t('ctl.prep.sabotage')}</Text>
        <Body tone="muted">
          {sabotage
            ? t('ctl.prep.sabotageTo', {
                effect: td(`sabotage.${sabotage.effect}`),
                name: byId.get(sabotage.targetId)?.nickname ?? '',
              })
            : sabBlock === 'NO_TOKEN'
              ? you?.powers?.nextTokenAtStreak
                ? t('ctl.prep.sabotage.noToken', { streak: you.powers.nextTokenAtStreak })
                : t('ctl.prep.sabotage.noTokenLeft')
              : sabBlock === 'CLOSED'
                ? t('ctl.prep.sabotage.closed')
                : t('ctl.prep.sabotage.hint')}
        </Body>
        <Button
          testID="sabotage-open"
          variant={sabotage ? 'violet' : 'ghost'}
          label={`${t('ctl.prep.sabotage')} · ${t('ctl.prep.sabotage.tokens', { count: you?.powers?.sabotageTokens ?? 0 })}`}
          disabled={sabBlock !== null}
          onPress={() => setPicking(true)}
        />
      </Panel>

      {error ? <ErrorText testID="prep-error">{error}</ErrorText> : null}
      <Button
        big
        testID="prep-commit"
        label={sending ? t('ctl.prep.sending') : t('ctl.prep.ready')}
        busy={sending}
        onPress={commit}
      />
      {room.phaseDeadlineAt !== null ? (
        <TimerBar now={now} startAt={room.phaseEnteredAt} deadlineAt={room.phaseDeadlineAt} />
      ) : null}
    </ScrollView>
  );
}

type Step = 'who' | 'what' | 'which';

/** Who → what → (for LOCKOUT) which joker; the same three steps as the browser sheet. */
export function SabotagePicker({
  players,
  current,
  onPick,
  onClose,
}: {
  players: RoomView['players'];
  current: PrepChoice['sabotage'];
  onPick: (choice: PrepChoice['sabotage']) => void;
  onClose: () => void;
}) {
  const { t, td } = useI18n();
  const [step, setStep] = useState<Step>('who');
  const [targetId, setTargetId] = useState<string | null>(current?.targetId ?? null);
  const [effect, setEffect] = useState<SabotageKind | null>(current?.effect ?? null);

  const finish = (joker?: Joker): void => {
    if (!targetId || !effect) return;
    onPick({ targetId, effect, ...(joker ? { joker } : {}) });
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="sabotage-picker">
      <Title>
        {step === 'who'
          ? t('ctl.prep.sabotage.who')
          : step === 'what'
            ? t('ctl.prep.sabotage.what')
            : t('ctl.prep.sabotage.which')}
      </Title>
      {step === 'who'
        ? players.map((player) => (
            <Button
              key={player.playerId}
              testID={`sabotage-target-${player.nickname}`}
              variant="ghost"
              label={player.nickname}
              onPress={() => {
                setTargetId(player.playerId);
                setStep('what');
              }}
            />
          ))
        : null}
      {step === 'what'
        ? SABOTAGE_ORDER.map((kind) => (
            <View key={kind} style={styles.option}>
              <Button
                testID={`sabotage-effect-${kind}`}
                variant="ghost"
                label={td(`sabotage.${kind}`)}
                onPress={() => {
                  setEffect(kind);
                  if (kind === 'LOCKOUT') setStep('which');
                  else onPick({ targetId: targetId ?? '', effect: kind });
                }}
              />
              <Body tone="muted">{td(`sabotage.${kind}.desc`)}</Body>
            </View>
          ))
        : null}
      {step === 'which'
        ? JOKER_ORDER.map((joker) => (
            <Button
              key={joker}
              testID={`sabotage-joker-${joker}`}
              variant="ghost"
              label={td(`joker.${joker}`)}
              onPress={() => finish(joker)}
            />
          ))
        : null}
      {current ? (
        <Button
          variant="danger"
          label={t('ctl.prep.sabotage.remove')}
          onPress={() => onPick(null)}
        />
      ) : null}
      <Button variant="ghost" label={t('common.close')} onPress={onClose} />
    </ScrollView>
  );
}

const { spacing } = theme;
const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
  ladder: { gap: spacing.sm },
  power: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  option: { gap: spacing.xs },
});
