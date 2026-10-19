import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Joker, PhaseDataOf, RiskTier, RoomView, SabotageKind } from '@quizparty/protocol';
import {
  JOKER_ORDER,
  SABOTAGE_ORDER,
  acceptBlock,
  bigStake,
  coverBlock,
  coverFee,
  cutBlock,
  defaultStake,
  doubleDownState,
  duelBlock,
  duelRivals,
  potBlock,
  sabotageKinds,
  stakeCapOf,
  stakeCapped,
  stakeExcludesDoubleDown,
  sabotageState,
  sabotageTargets,
  type RiskChoice,
  type SabotageChoice,
} from '@quizparty/controller-client';
import { Body, Button, ErrorText, Panel, TimerBar, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { RISK_EMOJI, SABOTAGE_EMOJI } from '../ui/powerIcons';
import { theme } from '../ui/theme';
import type { ControllerActions } from './actions';

type RiskData = PhaseDataOf<'RISK_PICK'>;
type SabotageData = PhaseDataOf<'SABOTAGE_PICK'>;

/** Category row, a loud title, the clock and a one-line rule: the top of both timed pick screens (ADR-0022). */
function PickHeader({
  room,
  data,
  now,
  title,
  rule,
}: {
  room: RoomView;
  data: RiskData | SabotageData;
  now: () => number;
  title: string;
  rule: string;
}) {
  const { t, td } = useI18n();
  return (
    <View>
      <Body tone="muted">
        {t('game.round.of', { n: data.round.index + 1, total: data.round.total })} ·{' '}
        {td(`game.kind.${data.round.kind}`)} · {data.category.label}
      </Body>
      <Title testID="pick-title">{title}</Title>
      <Body tone="muted">{rule}</Body>
      {room.phaseDeadlineAt !== null ? (
        <TimerBar now={now} startAt={room.phaseEnteredAt} deadlineAt={room.phaseDeadlineAt} />
      ) : null}
    </View>
  );
}

/** One line: how many players have locked in. A count only, never who (ATTACK 27). */
function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useI18n();
  return <Body tone="muted">{t('ctl.prep.waiting', { done, total: Math.max(total, done) })}</Body>;
}

/**
 * RISK_PICK: stake (risk) and Double Down, committed together and final once sent (ADR-0010,
 * ADR-0022). The category is known, the question is not.
 */
export function RiskView({
  room,
  data,
  now,
  actions,
}: {
  room: RoomView;
  data: RiskData;
  now: () => number;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const you = room.you;
  const committed = you?.commitment ?? null;
  const [stake, setStake] = useState<RiskTier>(() => defaultStake(data));
  const [doubleDown, setDoubleDown] = useState(false);
  const [cover, setCover] = useState(false);
  const [pot, setPot] = useState(false);
  const [rivalId, setRivalId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const board = room.game?.scoreboard ?? [];
  const playerCount = Math.max(board.length, room.players.length);
  const myScore = board.find((entry) => entry.playerId === you?.playerId)?.score ?? 0;
  const rivals = duelRivals(room.players, you?.playerId ?? '');
  const accepted = (you?.duelInvites ?? []).some((invite) => invite.answer === 'ACCEPTED');
  const playerName = (playerId: string): string =>
    room.players.find((player) => player.playerId === playerId)?.nickname ?? '?';

  const ddBlock = doubleDownState(data, you);
  // One big gamble per question: Double Down, the top stakes and a Duel exclude each other (ADR-0021, ADR-0023).
  const ddConflict = stakeExcludesDoubleDown(data, stake);
  const ddBase = doubleDown && ddBlock === null && !ddConflict && !accepted;
  const duelReason =
    duelBlock(data, you, { stake, doubleDown: ddBase }, rivals.length, playerCount) ??
    (accepted ? 'BIG_GAMBLE' : null);
  const rival = rivals.find((player) => player.playerId === rivalId);
  const duelOn = rival !== undefined && duelReason === null;
  const ddOn = ddBase && !duelOn;
  const coverReason = coverBlock(data, you, { stake, doubleDown: ddOn });
  const coverOn = cover && coverReason === null;
  const potReason = potBlock(data, you, myScore, playerCount);
  const potOn = pot && potReason === null;
  const bigLocked = duelOn || accepted;

  const header = (
    <PickHeader
      room={room}
      data={data}
      now={now}
      title={t('tv.risk.title')}
      rule={t('ctl.risk.rule')}
    />
  );

  const respond = (challengerId: string, accept: boolean): void => {
    actions.haptic?.('tap');
    setError(null);
    actions.respondDuel?.(challengerId, accept).catch((cause: unknown) => {
      setError(td(`error.${(cause as { code?: string } | undefined)?.code ?? 'INTERNAL'}`));
    });
  };

  const invites =
    (you?.duelInvites ?? []).length > 0 && data.risks?.duel
      ? (you?.duelInvites ?? []).map((invite) => {
          const block = acceptBlock(data, you, committed);
          return (
            <Panel key={invite.challengerId}>
              <Text style={styles.power} testID="duel-invite">
                {RISK_EMOJI.duel} {t('ctl.duel.invite', { name: playerName(invite.challengerId) })}
              </Text>
              <Body tone="muted">
                {invite.answer === 'ACCEPTED'
                  ? t('ctl.duel.accepted')
                  : invite.answer === 'DECLINED'
                    ? t('ctl.duel.declined')
                    : t('ctl.duel.inviteRule', {
                        win: data.risks!.duel!.win,
                        bothRight: data.risks!.duel!.bothRight,
                      })}
              </Body>
              {invite.answer === null && block !== null && block !== 'OFF' ? (
                <Body tone="muted">{td(`risk.block.${block}`)}</Body>
              ) : null}
              {invite.answer === null ? (
                <View style={styles.row}>
                  <Button
                    testID="duel-accept"
                    label={t('ctl.duel.accept')}
                    disabled={block !== null}
                    onPress={() => respond(invite.challengerId, true)}
                  />
                  <Button
                    testID="duel-decline"
                    variant="ghost"
                    label={t('ctl.duel.decline')}
                    onPress={() => respond(invite.challengerId, false)}
                  />
                </View>
              ) : null}
            </Panel>
          );
        })
      : null;

  if (committed) {
    return (
      <View style={styles.screen} testID="ctl-risk-committed">
        {header}
        {invites}
        <Panel>
          <Title>{t('ctl.prep.committed')}</Title>
          <Body>{td(`ctl.prep.stake.${committed.stake}`)}</Body>
          {committed.doubleDown ? <Body>{td('joker.DOUBLE_DOWN')}</Body> : null}
          {committed.cover ? (
            <Body>
              {RISK_EMOJI.cover} {t('ctl.prep.cover.chip')}
            </Body>
          ) : null}
          {committed.pot ? (
            <Body>
              {RISK_EMOJI.pot} {t('ctl.prep.pot.chip')}
            </Body>
          ) : null}
          {committed.duel ? (
            <Body>
              {RISK_EMOJI.duel}{' '}
              {t('ctl.prep.duel.chip', { name: playerName(committed.duel.targetId) })}
            </Body>
          ) : null}
          {error ? <ErrorText testID="prep-error">{error}</ErrorText> : null}
          <Progress done={data.committedCount} total={data.eligibleCount} />
        </Panel>
      </View>
    );
  }

  const commit = (): void => {
    if (sending) return;
    setSending(true);
    setError(null);
    actions.haptic?.('tap');
    const choice: RiskChoice = {
      stake,
      doubleDown: ddOn,
      ...(coverOn ? { cover: true } : {}),
      ...(potOn ? { pot: true } : {}),
      ...(duelOn && rival ? { duel: { targetId: rival.playerId } } : {}),
    };
    actions
      .commitRisk(choice)
      .catch((cause: unknown) => {
        setError(td(`error.${(cause as { code?: string } | undefined)?.code ?? 'INTERNAL'}`));
      })
      .finally(() => setSending(false));
  };

  const cap = stakeCapOf(you);
  const risks = data.risks;
  const extra = (
    id: 'cover' | 'pot' | 'duel',
    on: boolean,
    reason: string | null,
    left: number,
    hint: string,
    onPress: () => void,
  ) => (
    <Panel key={id}>
      <Text style={styles.power}>
        {RISK_EMOJI[id]} {t(`risk.${id}`)}
      </Text>
      <Body tone="muted">{reason ?? hint}</Body>
      <Button
        testID={`risk-${id}`}
        variant={on ? 'violet' : 'ghost'}
        label={`${t(`risk.${id}`)} · ${t('ctl.prep.left', { count: left })}`}
        disabled={reason !== null}
        onPress={onPress}
      />
    </Panel>
  );

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="ctl-risk">
      {header}
      {invites}
      <Title>{t('ctl.prep.title')}</Title>
      {data.stakeMandatory ? <Body tone="muted">{t('ctl.prep.mandatory')}</Body> : null}
      {cap ? (
        <Body tone="muted" testID="stake-cap-note">
          {t('ctl.prep.stakeCap', { tier: td(`ctl.prep.stake.${cap}`) })}
        </Body>
      ) : null}
      <View accessibilityRole="radiogroup" style={styles.ladder}>
        {data.riskLadder.map((rung) => {
          const selected = rung.tier === stake;
          const capped = stakeCapped(you, rung.tier);
          return (
            <Button
              key={rung.tier}
              testID={`stake-${rung.tier}`}
              variant={selected ? 'gold' : 'ghost'}
              label={`${td(`ctl.prep.stake.${rung.tier}`)} ×${rung.multiplier} · ${
                capped
                  ? t('ctl.prep.stake.capped')
                  : rung.loss > 0
                    ? t('ctl.prep.stake.loss', { loss: rung.loss })
                    : t('ctl.prep.stake.noLoss')
              }`}
              disabled={
                capped ||
                (ddOn && stakeExcludesDoubleDown(data, rung.tier)) ||
                (bigLocked && bigStake(data, rung.tier))
              }
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
                : bigLocked
                  ? t('risk.block.BIG_GAMBLE')
                  : ddConflict
                    ? t('ctl.prep.doubleDown.conflict')
                    : t('ctl.prep.doubleDown.hint')}
        </Body>
        <Button
          testID="double-down"
          variant={ddOn ? 'violet' : 'ghost'}
          label={`${td('joker.DOUBLE_DOWN')} · ${t('ctl.prep.left', { count: you?.powers?.doubleDown ?? 0 })}`}
          disabled={ddBlock !== null || ddConflict || bigLocked}
          onPress={() => setDoubleDown(!doubleDown)}
        />
      </Panel>

      {risks?.cover
        ? extra(
            'cover',
            coverOn,
            coverReason === null ? null : td(`risk.block.${coverReason}`),
            you?.powers?.cover ?? 0,
            t('risk.cover.hint', { fee: coverFee(data, { stake, doubleDown: ddOn }) }),
            () => setCover(!cover),
          )
        : null}
      {risks?.pot
        ? extra(
            'pot',
            potOn,
            potReason === null ? null : td(`risk.block.${potReason}`, { ante: risks.pot.ante }),
            you?.powers?.pot ?? 0,
            t('risk.pot.hint', { ante: risks.pot.ante }),
            () => setPot(!pot),
          )
        : null}
      {risks?.duel
        ? extra(
            'duel',
            duelOn,
            duelReason === null ? null : td(`risk.block.${duelReason}`),
            you?.powers?.duel ?? 0,
            duelOn && rival
              ? t('ctl.duel.rival', { name: rival.nickname })
              : t('risk.duel.hint', { win: risks.duel.win }),
            () => setPicking(!picking),
          )
        : null}
      {picking && risks?.duel ? (
        <View style={styles.ladder} testID="duel-picker">
          <Title>{t('ctl.duel.pick')}</Title>
          {rivals.map((player) => (
            <Button
              key={player.playerId}
              testID={`duel-rival-${player.nickname}`}
              variant={rivalId === player.playerId ? 'gold' : 'ghost'}
              label={player.nickname}
              onPress={() => {
                setRivalId(player.playerId);
                setPicking(false);
              }}
            />
          ))}
          {rivalId ? (
            <Button
              testID="duel-clear"
              variant="ghost"
              label={t('ctl.sabotage.skip')}
              onPress={() => {
                setRivalId(null);
                setPicking(false);
              }}
            />
          ) : null}
        </View>
      ) : null}

      {error ? <ErrorText testID="prep-error">{error}</ErrorText> : null}
      <Button
        big
        testID="prep-commit"
        label={sending ? t('ctl.prep.sending') : t('ctl.prep.ready')}
        busy={sending}
        onPress={commit}
      />
    </ScrollView>
  );
}

/**
 * SABOTAGE_PICK: at most one sabotage, or none, final once sent (ADR-0022). A player who cannot
 * sabotage this round (no token, cooldown, nobody to hit) gets a calm waiting screen.
 */
export function SabotageView({
  room,
  data,
  now,
  actions,
}: {
  room: RoomView;
  data: SabotageData;
  now: () => number;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const you = room.you;
  const [sabotage, setSabotage] = useState<SabotageChoice['sabotage']>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(room.players.map((player) => [player.playerId, player]));

  const header = (
    <PickHeader
      room={room}
      data={data}
      now={now}
      title={t('tv.sabotage.title')}
      rule={t('ctl.sabotage.rule')}
    />
  );

  if (you?.sabotage?.decided) {
    const sent = you.commitment?.sabotage ?? null;
    return (
      <View style={styles.screen} testID="ctl-sabotage-committed">
        {header}
        <Panel>
          <Title>{t('ctl.prep.committed')}</Title>
          <Body>
            {sent
              ? t('ctl.prep.sabotageTo', {
                  effect: td(`sabotage.${sent.effect}`),
                  name: byId.get(sent.targetId)?.nickname ?? '',
                })
              : t('ctl.sabotage.none')}
          </Body>
          <Progress done={data.committedCount} total={data.eligibleCount} />
        </Panel>
      </View>
    );
  }

  const blocked = sabotageState(you);
  if (!you || you.authorOfRound || blocked !== null) {
    return (
      <View style={styles.screen} testID="ctl-sabotage-wait">
        {header}
        <Panel>
          <Title>{t('ctl.sabotage.waitTitle')}</Title>
          <Body tone="muted">
            {you?.authorOfRound
              ? t('ctl.statement.mine')
              : blocked === 'NO_TOKEN'
                ? you?.powers?.nextTokenAtStreak
                  ? t('ctl.prep.sabotage.noToken', { streak: you.powers.nextTokenAtStreak })
                  : t('ctl.prep.sabotage.noTokenLeft')
                : t('ctl.sabotage.cannot')}
          </Body>
          <Progress done={data.committedCount} total={data.eligibleCount} />
        </Panel>
      </View>
    );
  }

  if (picking) {
    return (
      <SabotagePicker
        players={sabotageTargets(room.players, you.playerId)}
        kinds={sabotageKinds(data)}
        cutRule={data.cutRule}
        scoreboard={room.game?.scoreboard ?? []}
        current={sabotage}
        onPick={(choice) => {
          setSabotage(choice);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    );
  }

  const send = (choice: SabotageChoice['sabotage']): void => {
    if (sending) return;
    setSending(true);
    setError(null);
    actions.haptic?.('tap');
    actions
      .commitSabotage({ sabotage: choice })
      .catch((cause: unknown) => {
        setSabotage(null);
        setError(td(`error.${(cause as { code?: string } | undefined)?.code ?? 'INTERNAL'}`));
      })
      .finally(() => setSending(false));
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="ctl-sabotage">
      {header}
      <Panel>
        <Text style={styles.power}>{t('ctl.prep.sabotage')}</Text>
        <Body tone="muted">
          {sabotage
            ? t('ctl.prep.sabotageTo', {
                effect: td(`sabotage.${sabotage.effect}`),
                name: byId.get(sabotage.targetId)?.nickname ?? '',
              })
            : t('ctl.prep.sabotage.hint')}
        </Body>
        <Button
          testID="sabotage-open"
          variant={sabotage ? 'violet' : 'ghost'}
          label={`${t('ctl.prep.sabotage')} · ${t('ctl.prep.sabotage.tokens', { count: you.powers?.sabotageTokens ?? 0 })}`}
          onPress={() => setPicking(true)}
        />
      </Panel>

      {error ? <ErrorText testID="prep-error">{error}</ErrorText> : null}
      {sabotage ? (
        <Button
          big
          variant="danger"
          testID="sabotage-send"
          label={sending ? t('ctl.prep.sending') : t('ctl.prep.sabotage.send')}
          busy={sending}
          onPress={() => send(sabotage)}
        />
      ) : null}
      <Button
        testID="sabotage-skip"
        variant="ghost"
        label={t('ctl.sabotage.skip')}
        busy={sending}
        onPress={() => send(null)}
      />
    </ScrollView>
  );
}

type Step = 'who' | 'what' | 'which';

/** Who → what → (for LOCKOUT) which joker; the same three steps as the browser sheet. */
export function SabotagePicker({
  players,
  kinds,
  cutRule,
  scoreboard,
  current,
  onPick,
  onClose,
}: {
  players: RoomView['players'];
  kinds: readonly SabotageKind[];
  cutRule: { permille: number; maxPoints: number } | undefined;
  scoreboard: readonly { playerId: string; score: number; rank: number }[];
  current: SabotageChoice['sabotage'];
  onPick: (choice: SabotageChoice['sabotage']) => void;
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
        ? SABOTAGE_ORDER.filter((kind) => kinds.includes(kind)).map((kind) => {
            // Cut never aims at the leader or at somebody with no points: the card says why.
            const block = kind === 'CUT' && targetId ? cutBlock(scoreboard, targetId) : null;
            return (
              <View key={kind} style={styles.option}>
                <Button
                  testID={`sabotage-effect-${kind}`}
                  variant="ghost"
                  label={`${SABOTAGE_EMOJI[kind]} ${td(`sabotage.${kind}`)}`}
                  disabled={block !== null}
                  onPress={() => {
                    setEffect(kind);
                    if (kind === 'LOCKOUT') setStep('which');
                    else onPick({ targetId: targetId ?? '', effect: kind });
                  }}
                />
                <Body tone="muted">
                  {block === 'LEADER'
                    ? t('ctl.sabotage.cut.leader')
                    : block === 'NO_POINTS'
                      ? t('ctl.sabotage.cut.noPoints')
                      : td(`sabotage.${kind}.desc`, {
                          percent: Math.round((cutRule?.permille ?? 200) / 10),
                          max: cutRule?.maxPoints ?? 30,
                        })}
                </Body>
              </View>
            );
          })
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
  row: { flexDirection: 'row', gap: spacing.sm },
});
