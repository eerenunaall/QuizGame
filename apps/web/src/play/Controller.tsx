import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  CategoryCatalog,
  DifficultyPreset,
  PhaseDataOf,
  PublicPlayer,
  QuestionReportReason,
  RoomView,
} from '@quizparty/protocol';
import type { ClientState, KeyValueStorage } from '@quizparty/controller-client';
import { AnswerCard, type AnswerState } from '../ui/AnswerCard';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { CountUp } from '../ui/CountUp';
import { LetterCheer } from '../ui/LetterCheer';
import { Mascot } from '../ui/Mascot';
import { Panel, Pill } from '../ui/Panel';
import { AnimatedSticker, Sticker } from '../ui/Sticker';
import { PowerIcon } from '../ui/PowerIcon';
import { TimerBar } from '../ui/TimerBar';
import { ComboToast } from '../ui/anim/ComboToast';
import { RollDots } from '../ui/anim/RollDots';
import { UrgencyVignette } from '../ui/anim/UrgencyVignette';
import { burst } from '../lib/confetti';
import { haptic } from '../lib/haptics';
import { revealPlan } from '../lib/sound/timeline';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import { createStorage } from '../lib/storage';
import { HitNotices } from './HitNotices';
import { PeekText, PeekToggle, QuestionPeek } from './QuestionPeek';
import { useShowQuestion } from './questionPeek';
import { RiskScreen } from './RiskScreen';
import { SabotageScreen } from './SabotageScreen';
import { ReportControl } from './ReportControl';
import { StatementForm } from './StatementForm';
import {
  fiftyFiftyState,
  isFogged,
  isRemoved,
  orderedOptions,
  personalDeadline,
  type RiskChoice,
  type SabotageChoice,
} from './powers';
import styles from './Controller.module.css';
import { PhoneReward, PhoneVenueNotice } from '../venue/PhoneVenue';
import { cx } from '../lib/cx';

const ROUND_CHOICES = [5, 10, 15, 20] as const;
const DIFFICULTIES: readonly DifficultyPreset[] = ['EASY', 'MEDIUM', 'HARD'];

export interface ControllerActions {
  ready: (ready: boolean) => void;
  start: () => void;
  settings: (change: {
    rounds?: number;
    difficulty?: DifficultyPreset;
    categories?: 'ALL' | string[];
  }) => void;
  answer: (optionId: string) => void;
  rematch: () => void;
  backToLobby: () => void;
  leave: () => void;
  kick: (playerId: string) => void;
  makeLeader: (playerId: string) => void;
  /** RISK_PICK: stake and Double Down in one final message. Rejects with the server's code. */
  commitRisk: (choice: RiskChoice) => Promise<void>;
  /** SABOTAGE_PICK: one sabotage, or none, in one final message. Rejects with the server's code. */
  commitSabotage: (choice: SabotageChoice) => Promise<void>;
  /** RISK_PICK: accept or decline a Duel challenge (ADR-0023). Rejects with the server's code. */
  respondDuel?: (challengerId: string, accept: boolean) => Promise<void>;
  fifty: () => void;
  setReduced: (value: boolean) => void;
  /** Who Said It, lobby: the player's one statement. Rejects with the server's code (and the reason of a refused text). */
  submitStatement: (text: string) => Promise<void>;
  /** Flag the question just revealed. Absent while the server switch is off. Rejects with the server's code. */
  report?: ((questionId: string, reason: QuestionReportReason) => Promise<void>) | undefined;
}

interface Props {
  room: RoomView;
  state: ClientState;
  now: () => number;
  catalog: CategoryCatalog | null;
  busy: boolean;
  error: string | null;
  actions: ControllerActions;
  /** Where this device keeps its choices (`qp.prefs`); without it the "show question" switch lives for the page only. */
  storage?: KeyValueStorage;
}

function Center({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={styles.center} data-testid={testId}>
      {children}
    </div>
  );
}

/** Chooses the controller screen for the current phase. */
export function Controller({ room, state, now, catalog, busy, error, actions, storage }: Props) {
  const { t, td } = useI18n();
  // TV is the stage: the question text stays off the phone unless this device asked for it.
  const pageStorage = useMemo(() => createStorage(null), []);
  const [showQuestion, setShowQuestion] = useShowQuestion(storage ?? pageStorage);
  const data = room.phaseData;
  const you = room.you;
  const isLeader = (you?.isLeader ?? false) || (you?.canHost ?? false);
  const myId = you?.playerId ?? '';

  switch (data.phase) {
    case 'WAITING':
    case 'LOBBY':
      return (
        <>
          <PhoneVenueNotice room={room} now={now} />
          <LobbyScreen
            room={room}
            catalog={catalog}
            isLeader={isLeader}
            busy={busy}
            error={error}
            actions={actions}
          />
        </>
      );
    case 'COUNTDOWN':
      return (
        <Center testId="ctl-countdown">
          <AnimatedSticker id="rocket" size={150} />
          <div className={styles.big}>{t('ctl.lookAtTv')}</div>
        </Center>
      );
    case 'ROUND_INTRO':
      return (
        <Center testId="ctl-intro">
          <div className={styles.kicker}>
            {t('game.round.of', { n: data.round.index + 1, total: data.round.total })}
          </div>
          <div className={styles.big}>{td(`game.kind.${data.round.kind}`)}</div>
          <div className={styles.sub}>{t('ctl.lookAtTv')}</div>
        </Center>
      );
    case 'FINAL':
      return (
        <Center testId="ctl-final">
          <AnimatedSticker id="crown" size={170} />
          <div className={styles.big}>{t('game.final.title')}</div>
          <div className={styles.sub}>{t('game.final.double')}</div>
        </Center>
      );
    case 'QUESTION_PREP': // retired phase (ADR-0022): a server never sends it, an old one does
    case 'RISK_PICK':
      // Who Said It: the author has nothing to stake on their own statement.
      if (you?.authorOfRound) return <SitOut />;
      return (
        <RiskScreen
          key={data.round.index}
          room={room}
          data={{ ...data, phase: 'RISK_PICK' }}
          now={now}
          onCommit={actions.commitRisk}
          {...(actions.respondDuel ? { onRespond: actions.respondDuel } : {})}
        />
      );
    case 'SABOTAGE_PICK':
      return (
        <SabotageScreen
          key={data.round.index}
          room={room}
          data={data}
          now={now}
          onCommit={actions.commitSabotage}
        />
      );
    case 'QUESTION':
      return (
        <Center testId="ctl-question">
          <HitNotices you={you} />
          <QuestionPeek big text={data.text} shown={showQuestion} onToggle={setShowQuestion} />
          <div className={styles.sub}>
            {you?.authorOfRound ? t('ctl.statement.mine') : t('game.question.getReady')}
          </div>
        </Center>
      );
    case 'ANSWERING':
      if (you?.authorOfRound)
        return <SitOut text={data.text} shown={showQuestion} onToggle={setShowQuestion} />;
      return (
        <AnswerScreen
          data={data}
          state={state}
          now={now}
          actions={actions}
          showQuestion={showQuestion}
          onShowQuestion={setShowQuestion}
        />
      );
    case 'LOCKED': {
      if (you?.authorOfRound) return <SitOut />;
      const answered = Boolean(you?.answer);
      return (
        <Center testId="ctl-locked">
          {answered ? (
            <ConfirmedScreen />
          ) : (
            <>
              <AnimatedSticker id="hourglass" size={150} />
              <div className={styles.big}>{t('ctl.answer.late')}</div>
            </>
          )}
        </Center>
      );
    }
    case 'REVEAL':
      return (
        <RevealScreen
          data={data}
          myId={myId}
          report={actions.report}
          whoSaidIt={room.settings.mode === 'WHO_SAID_IT'}
          sitOut={you?.authorOfRound ?? false}
          // the board still holds the streak from before this question: a right answer adds one
          streak={
            (room.game?.scoreboard.find((entry) => entry.playerId === myId)?.streak ?? 0) +
            (data.results.find((result) => result.playerId === myId)?.outcome === 'CORRECT' ? 1 : 0)
          }
        />
      );
    case 'POWER_RESOLUTION':
      return (
        <Center>
          <div className={styles.big}>{t('ctl.lookAtTv')}</div>
        </Center>
      );
    case 'SCORE_UPDATE':
      return <ScoreScreen data={data} myId={myId} room={room} />;
    case 'MICRO_INTERMISSION':
      return (
        <Center testId="ctl-next">
          <AnimatedSticker id="thinking" size={130} />
          <div className={styles.sub}>{t('ctl.lookAtTv')}</div>
        </Center>
      );
    case 'RESULTS':
      return (
        <ResultsScreen
          data={data}
          myId={myId}
          room={room}
          isLeader={isLeader}
          busy={busy}
          actions={actions}
          reward={state.venueReward}
          now={now}
        />
      );
    case 'ROOM_CLOSED':
      return (
        <Center testId="ctl-closed">
          <Sticker id="hourglass" size={120} />
          <div className={styles.big}>{t('ctl.closed')}</div>
          <Button size="lg" onClick={actions.leave} className={styles.action}>
            {t('ctl.rejoin')}
          </Button>
        </Center>
      );
  }
}

// ───────────── lobby ─────────────

function LobbyScreen({
  room,
  catalog,
  isLeader,
  busy,
  error,
  actions,
}: {
  room: RoomView;
  catalog: CategoryCatalog | null;
  isLeader: boolean;
  busy: boolean;
  error: string | null;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const me = room.players.find((player) => player.playerId === room.you?.playerId);
  const free = room.tier === 'FREE';
  const selected = room.settings.categories;
  const isAll = selected === 'ALL';
  const statementCount =
    room.phaseData.phase === 'LOBBY' ? (room.phaseData.statementPlayerIds?.length ?? 0) : 0;
  // Who Said It needs a guesser for every statement: two are the least that makes a game.
  const enough =
    room.players.length >= 2 && (room.settings.mode !== 'WHO_SAID_IT' || statementCount >= 2);
  // Leader-only player management: tap a player, then "make leader" or (after a confirm tap) "remove".
  const [managedId, setManagedId] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState(false);
  const managed = isLeader
    ? room.players.find((player) => player.playerId === managedId)
    : undefined;

  const toggleCategory = (id: string): void => {
    if (isAll) return actions.settings({ categories: [id] });
    const next = selected.includes(id)
      ? selected.filter((entry) => entry !== id)
      : [...selected, id];
    actions.settings({ categories: next.length === 0 ? 'ALL' : next });
  };

  const readyButton = (
    <Button
      size="lg"
      block
      variant={me?.ready ? 'success' : 'violet'}
      onClick={() => actions.ready(!(me?.ready ?? false))}
      data-testid="ctl-ready"
    >
      {me?.ready ? t('ctl.lobby.notReady') : t('ctl.lobby.ready')}
    </Button>
  );

  return (
    <div className={styles.lobby} data-testid="ctl-lobby">
      <div className={styles.lobbyHead}>
        {me ? (
          <Avatar avatarId={me.avatarId} size={96} colorSlot={me.colorSlot} leader={me.isLeader} />
        ) : null}
        <div className={styles.big}>{t('ctl.lobby.title')}</div>
      </div>
      {room.settings.mode !== 'CLASSIC' ? (
        <div className={styles.big} data-testid="ctl-mode">
          {t(`lobby.mode.${room.settings.mode}`, { title: room.settings.contentTitle ?? '' })}
        </div>
      ) : null}

      {room.settings.mode === 'WHO_SAID_IT' ? (
        <StatementForm saved={room.you?.myStatement ?? null} onSubmit={actions.submitStatement} />
      ) : null}

      {/* The leader's big button is "start" (below); everybody else's is "ready", which lives in the thumb zone. */}
      {isLeader ? readyButton : null}

      <div className={styles.roster} data-testid="ctl-roster">
        {room.players.map((player) => {
          const self = player.playerId === room.you?.playerId;
          return (
            <PlayerChip
              key={player.playerId}
              player={player}
              self={self}
              {...(isLeader && !self
                ? {
                    selected: managed?.playerId === player.playerId,
                    onSelect: () => {
                      setConfirmKick(false);
                      setManagedId(managed?.playerId === player.playerId ? null : player.playerId);
                    },
                  }
                : {})}
            />
          );
        })}
      </div>

      {isLeader && managed ? (
        <Panel className={styles.manage} tone="glass" data-testid="ctl-manage">
          <div className={styles.manageTitle}>
            {t('ctl.lobby.manage', { name: managed.nickname })}
          </div>
          <div className={styles.manageRow}>
            <Button
              size="md"
              variant="violet"
              data-testid="ctl-make-leader"
              onClick={() => {
                actions.makeLeader(managed.playerId);
                setManagedId(null);
              }}
            >
              {t('ctl.lobby.makeLeader')}
            </Button>
            <Button
              size="md"
              variant={confirmKick ? 'danger' : 'ghost'}
              data-testid="ctl-kick"
              onClick={() => {
                if (!confirmKick) {
                  setConfirmKick(true);
                  return;
                }
                actions.kick(managed.playerId);
                setManagedId(null);
              }}
            >
              {confirmKick ? t('ctl.lobby.kickConfirm') : t('ctl.lobby.kick')}
            </Button>
            <Button size="md" variant="ghost" onClick={() => setManagedId(null)}>
              {t('common.close')}
            </Button>
          </div>
        </Panel>
      ) : null}

      <label className={styles.prefRow}>
        <input
          type="checkbox"
          checked={room.you?.reducedEffects ?? false}
          onChange={(event) => actions.setReduced(event.target.checked)}
          data-testid="pref-reduced"
        />
        <span className={styles.prefText}>
          <span className={styles.prefName}>{t('ctl.prefs.reduced')}</span>
          <span className={styles.prefHint}>{t('ctl.prefs.reduced.hint')}</span>
        </span>
      </label>

      {isLeader ? (
        <Panel className={styles.leaderPanel} tone="glass">
          <div className={styles.groupTitle}>{t('settings.questions')}</div>
          <div className={styles.pills}>
            {ROUND_CHOICES.map((count) => (
              <Pill
                key={count}
                selected={room.settings.rounds === count}
                locked={count > room.limits.maxRounds}
                disabled={count > room.limits.maxRounds}
                onClick={() => actions.settings({ rounds: count })}
              >
                {count}
              </Pill>
            ))}
          </div>
          <div className={styles.groupTitle}>{t('settings.difficulty')}</div>
          <div className={styles.pills}>
            {DIFFICULTIES.map((preset) => (
              <Pill
                key={preset}
                selected={room.settings.difficulty === preset}
                onClick={() => actions.settings({ difficulty: preset })}
              >
                {td(`settings.preset.${preset}`)}
              </Pill>
            ))}
          </div>
          <div className={styles.groupTitle}>{t('settings.chooseCategory')}</div>
          <div className={styles.pills}>
            <Pill selected={isAll} onClick={() => actions.settings({ categories: 'ALL' })}>
              {t('settings.mixed')}
            </Pill>
            {(catalog?.categories ?? []).map((category) => (
              <Pill
                key={category.id}
                selected={!isAll && selected.includes(category.id)}
                locked={free && !category.free}
                disabled={free && !category.free}
                onClick={() => toggleCategory(category.id)}
              >
                {category.label}
              </Pill>
            ))}
          </div>
          {free ? <div className={styles.upsell}>{t('settings.freeHint')}</div> : null}
        </Panel>
      ) : (
        <div className={styles.waiting}>{t('ctl.lobby.waitingLeader')}</div>
      )}

      {error ? <div className={styles.error}>{error}</div> : null}

      {isLeader ? (
        <div className={styles.startRow}>
          <Button
            size="xl"
            block
            busy={busy}
            disabled={!enough}
            icon="rocket"
            onClick={actions.start}
            data-testid="ctl-start"
          >
            {t('ctl.lobby.start')}
          </Button>
          {!enough ? (
            <div className={styles.need}>
              {room.settings.mode === 'WHO_SAID_IT' && room.players.length >= 2
                ? t('whosaidit.tv.count', { count: statementCount, total: room.players.length })
                : t('lobby.needMore', { min: 2 })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.startRow}>{readyButton}</div>
      )}
    </div>
  );
}

function PlayerChip({
  player,
  self,
  selected,
  onSelect,
}: {
  player: PublicPlayer;
  self: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  const content = (
    <>
      <Avatar
        avatarId={player.avatarId}
        size={44}
        colorSlot={player.colorSlot}
        leader={player.isLeader}
        dim={player.connection === 'DISCONNECTED'}
      />
      <span className={styles.chipName}>
        {player.nickname}
        {self ? ` · ${t('ctl.lobby.you')}` : ''}
      </span>
      {player.ready ? <Sticker id="check" size={26} /> : null}
    </>
  );
  const classes = cx(
    styles.chip,
    player.connection === 'DISCONNECTED' && styles.offline,
    selected && styles.chipSelected,
  );
  return onSelect ? (
    <button
      type="button"
      className={cx(classes, styles.chipButton)}
      onClick={onSelect}
      aria-pressed={selected ?? false}
      data-testid={`ctl-player-${player.nickname}`}
      data-focusable
    >
      {content}
    </button>
  ) : (
    <div className={classes}>{content}</div>
  );
}

// ───────────── answering ─────────────

type AnsweringData = PhaseDataOf<'ANSWERING'>;

/** True while a FOG effect still hides an option: flips off by itself when the fog time is over. */
function useFogActive(openedAt: number, fogMs: number, now: () => number): boolean {
  const [active, setActive] = useState(() => fogMs > 0 && now() < openedAt + fogMs);
  useEffect(() => {
    const remaining = openedAt + fogMs - now();
    if (fogMs <= 0 || remaining <= 0) {
      setActive(false);
      return undefined;
    }
    setActive(true);
    const id = window.setTimeout(() => setActive(false), remaining);
    return () => window.clearTimeout(id);
  }, [openedAt, fogMs, now]);
  return active;
}

function AnswerScreen({
  data,
  state,
  now,
  actions,
  showQuestion,
  onShowQuestion,
}: {
  data: AnsweringData;
  state: ClientState;
  now: () => number;
  actions: ControllerActions;
  showQuestion: boolean;
  onShowQuestion: (next: boolean) => void;
}) {
  const { t, td } = useI18n();
  const you = state.room?.you ?? null;
  const answer = you?.answer ?? null;
  const pending = state.pendingAnswer;
  const rejection = state.answerRejection;
  const locked = answer !== null && answer.questionId === data.questionId;
  const effects = you?.effects ?? null;
  const keep = you?.fiftyFifty?.keep;
  const options = orderedOptions(data.options, effects?.order);
  const fogActive = useFogActive(data.answerOpensAt, effects?.fogMs ?? 0, now);
  const fiftyBlock = fiftyFiftyState(you);
  // What this player picked: the confirmed answer, or the tap still on its way to the server.
  const chosenId = locked ? answer.optionId : (pending?.optionId ?? null);

  useEffect(() => {
    if (locked) {
      haptic('lock');
      sfx.play('lock');
    }
  }, [locked]);

  const pick = (optionId: string): void => {
    if (pending || locked) return;
    haptic('tap');
    sfx.play('tap');
    actions.answer(optionId);
  };

  const fiftyTool = locked ? null : keep ? (
    <span className={styles.fiftyNote} data-testid="fifty-used">
      {t('ctl.fifty.used')}
    </span>
  ) : fiftyBlock === null && !pending ? (
    <button
      type="button"
      className={styles.fiftyChip}
      onClick={actions.fifty}
      data-testid="use-fifty"
      data-focusable
    >
      <Sticker id="light-bulb" size={28} />
      <span className={styles.fiftyLabel}>{t('ctl.fifty.use')}</span>
      <span
        className={styles.fiftyCount}
        aria-label={t('ctl.fifty.left', { count: you?.powers?.fiftyFifty ?? 0 })}
      >
        {you?.powers?.fiftyFifty ?? 0}
      </span>
    </button>
  ) : fiftyBlock === 'LOCKED' ? (
    <span className={styles.fiftyNote}>{t('ctl.fifty.locked')}</span>
  ) : null;

  return (
    <div
      className={styles.answering}
      data-testid={locked ? 'ctl-confirmed' : 'ctl-answering'}
      data-locked={locked || undefined}
    >
      <div className={styles.timer}>
        {effects?.blindClock ? (
          // BLIND_CLOCK (ADR-0023): the countdown is gone from this phone, the TV's clock stays.
          <div className={styles.blindClock} role="status" data-testid="blind-clock">
            <PowerIcon id="blind-clock" size={34} />
            <span>{t('ctl.blindClock')}</span>
          </div>
        ) : (
          <TimerBar
            size="lg"
            now={now}
            startAt={data.answerOpensAt}
            deadlineAt={personalDeadline(data.answerDeadlineAt, effects)}
          />
        )}
        {locked || effects?.blindClock ? null : (
          // The last three seconds: a red edge and a vibration beat per second (guarded, optional).
          <UrgencyVignette
            tone="phone"
            haptics
            now={now}
            deadlineAt={personalDeadline(data.answerDeadlineAt, effects)}
          />
        )}
      </div>
      <HitNotices you={you} />
      {locked ? (
        <div className={styles.lockedBanner} role="status" data-testid="ctl-locked-banner">
          <Sticker id="check" size={46} className={styles.lockedIcon} />
          <div>
            <div className={styles.lockedTitle}>{t('ctl.answer.locked')}</div>
            <div className={styles.lockedSub}>{t('ctl.answer.waiting')}</div>
          </div>
        </div>
      ) : (
        <QuestionPeek
          text={data.text}
          shown={showQuestion}
          onToggle={onShowQuestion}
          tools={fiftyTool}
        />
      )}
      <div className={cx(styles.options, effects?.order && styles.shuffled)}>
        {options.map((option, index) => {
          const chosen = chosenId === option.optionId;
          const removed = isRemoved(option.optionId, keep);
          const stateName: AnswerState = locked
            ? chosen
              ? 'locked'
              : 'dim'
            : pending
              ? chosen
                ? 'selected'
                : 'dim'
              : removed
                ? 'dim'
                : 'idle';
          const veiled = fogActive && isFogged(option.optionId, effects, data.answerOpensAt, now());
          return (
            <div
              key={option.optionId}
              className={cx(styles.option, removed && styles.removed)}
              style={{ ['--qp-delay' as string]: `${index * 60}ms` }}
              data-removed={removed || undefined}
            >
              <AnswerCard
                size="phone"
                index={index}
                text={veiled ? '• • •' : option.text}
                state={stateName}
                disabled={pending !== null || locked || removed}
                onSelect={() => pick(option.optionId)}
              />
            </div>
          );
        })}
      </div>
      {rejection ? <div className={styles.error}>{td(`error.${rejection.code}`)}</div> : null}
      <div className={styles.sr} aria-live="polite">
        {locked ? t('ctl.answer.locked') : pending ? t('ctl.answer.sending') : t('ctl.answer.pick')}
      </div>
    </div>
  );
}

function ConfirmedScreen() {
  const { t } = useI18n();
  return (
    <>
      <div className={styles.confirm}>
        <Sticker id="check" size={150} className={styles.confirmIcon} />
      </div>
      <div className={styles.big}>{t('ctl.answer.locked')}</div>
      <div className={styles.sub}>{t('ctl.answer.waiting')}</div>
    </>
  );
}

// ───────────── reveal / score / results ─────────────

/** Who Said It: the author's own statement is on screen and they sit the round out. */
function SitOut({
  text,
  shown,
  onToggle,
}: {
  text?: string;
  shown?: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Center testId="ctl-sitout">
      <AnimatedSticker id="thinking" size={130} />
      <div className={styles.big}>{t('ctl.statement.mine')}</div>
      {text && onToggle ? (
        <div className={styles.sitOutPeek}>
          <PeekToggle shown={shown ?? false} onToggle={onToggle} />
          {shown ? <PeekText text={text} /> : null}
        </div>
      ) : null}
    </Center>
  );
}

function RevealScreen({
  data,
  myId,
  report,
  whoSaidIt,
  sitOut,
  streak,
}: {
  data: PhaseDataOf<'REVEAL'>;
  myId: string;
  report: ControllerActions['report'];
  whoSaidIt: boolean;
  sitOut: boolean;
  /** Correct answers in a row, this one included. */
  streak: number;
}) {
  const { t } = useI18n();
  const mine = data.results.find((result) => result.playerId === myId);
  const outcome = mine?.outcome ?? 'NO_ANSWER';
  const correctText =
    data.options.find((option) => option.optionId === data.correctOptionId)?.text ?? '';
  // The TV builds up to the answer (drum roll, wrong options dim, then the hit): the phone holds its
  // own verdict back until the same moment, so the table finds out together. Same plan as the TV.
  const hitAt = revealPlan(data.options.length, 0).hitAt;
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const at = hitAt + 120;
    if (outcome === 'CORRECT') {
      sfx.play('correct', { streak, delayMs: at });
      window.setTimeout(() => {
        haptic('correct');
        burst(0.5, 0.35, 120);
      }, at);
      if (streak >= 2) {
        sfx.play('combo', { streak, delayMs: at + 480 });
        window.setTimeout(() => haptic('combo'), at + 480);
      }
    } else {
      sfx.play(outcome === 'INCORRECT' ? 'wrong' : 'tap', { delayMs: at });
      window.setTimeout(() => haptic(outcome === 'INCORRECT' ? 'wrong' : 'tap'), at);
    }
    // Not cancelled on cleanup: a cue that was scheduled for this reveal belongs to it.
  }, [outcome, streak, hitAt]);
  return (
    <Center testId="ctl-reveal">
      <RollDots untilMs={hitAt} />
      <div className={cx(styles.revealStage, 'qp-deco')} style={{ animationDelay: `${hitAt}ms` }}>
        {outcome === 'CORRECT' && streak >= 2 ? (
          <ComboToast
            streak={streak}
            text={t('ctl.combo', { n: streak })}
            delayMs={hitAt + 420}
            className={styles.combo}
          />
        ) : null}
        {outcome === 'CORRECT' ? (
          <div className={styles.outcomeMascot}>
            <Mascot height={170} mood="cheer" />
          </div>
        ) : (
          <Sticker id={outcome === 'INCORRECT' ? 'cross' : 'hourglass'} size={130} />
        )}
        <div
          className={cx(
            styles.big,
            outcome === 'CORRECT' && styles.good,
            outcome === 'INCORRECT' && styles.bad,
          )}
          data-testid="ctl-outcome"
          data-outcome={outcome}
        >
          {sitOut
            ? t('ctl.statement.mine')
            : outcome === 'CORRECT'
              ? t('ctl.reveal.correct')
              : outcome === 'INCORRECT'
                ? t('ctl.reveal.incorrect')
                : t('ctl.reveal.noAnswer')}
        </div>
        <Panel className={styles.correctCard} tone="glass">
          <div className={styles.kicker}>{t('game.reveal.correct')}</div>
          <div className={styles.correctText}>
            {whoSaidIt ? t('whosaidit.reveal', { name: correctText }) : correctText}
          </div>
        </Panel>
        {report && !whoSaidIt ? (
          <ReportControl questionId={data.questionId} report={report} />
        ) : null}
      </div>
    </Center>
  );
}

function ScoreScreen({
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
  const top = useMemo(
    () =>
      data.scoreboard
        .slice(0, 3)
        .map((entry) => ({
          entry,
          player: room.players.find((player) => player.playerId === entry.playerId),
        }))
        .filter((row): row is typeof row & { player: PublicPlayer } => row.player !== undefined),
    [data, room.players],
  );
  return (
    <Center testId="ctl-score">
      {mine ? (
        <>
          <div
            className={cx(
              styles.delta,
              mine.delta > 0 && styles.good,
              mine.delta < 0 && styles.bad,
            )}
            data-testid="ctl-delta"
          >
            {mine.delta > 0 ? `+${mine.delta}` : mine.delta < 0 ? String(mine.delta) : '±0'}
          </div>
          <div className={styles.sub}>{t('ctl.score.rank', { rank: mine.rank })}</div>
          <div className={styles.total}>
            {t('ctl.score.total', { total: '' })}
            <CountUp value={mine.total} from={mine.total - mine.delta} />
          </div>
        </>
      ) : null}
      <div className={styles.mini}>
        {top.map(({ entry, player }) => (
          <div key={entry.playerId} className={styles.miniRow}>
            <span className={styles.miniRank}>{entry.rank}</span>
            <Avatar avatarId={player.avatarId} size={36} colorSlot={player.colorSlot} />
            <span className={styles.miniName}>{player.nickname}</span>
            <span className={styles.miniScore}>{entry.score}</span>
          </div>
        ))}
      </div>
    </Center>
  );
}

function ResultsScreen({
  data,
  myId,
  room,
  isLeader,
  busy,
  actions,
  reward,
  now,
}: {
  data: PhaseDataOf<'RESULTS'>;
  myId: string;
  room: RoomView;
  isLeader: boolean;
  busy: boolean;
  actions: ControllerActions;
  /** Venue mode: this phone won the table's reward (ADR-0024). */
  reward: ClientState['venueReward'];
  now: () => number;
}) {
  const { t } = useI18n();
  const mine = data.ranking.find((entry) => entry.playerId === myId);
  const me = room.players.find((player) => player.playerId === myId);
  useEffect(() => {
    if (mine && mine.rank === 1) burst(0.5, 0.4, 200);
  }, [mine]);
  return (
    <Center testId="ctl-results">
      {reward ? <PhoneReward reward={reward} /> : null}
      <PhoneVenueNotice room={room} now={now} />
      <div className={styles.resultCheer}>
        {mine?.rank === 1 ? (
          <Mascot height={130} mood="cheer" />
        ) : (
          <LetterCheer seed={myId} height={96} />
        )}
      </div>
      <div className={styles.kicker}>{t('ctl.results.you')}</div>
      {me ? (
        <div className={styles.resultFace}>
          <Avatar
            avatarId={me.avatarId}
            size={110}
            colorSlot={me.colorSlot}
            leader={mine?.rank === 1}
          />
        </div>
      ) : null}
      <div className={styles.rankBig} data-testid="ctl-final-rank">
        {mine?.rank ?? '-'}
      </div>
      <div className={styles.sub}>
        {t('results.points', { points: mine?.score ?? 0 })} ·{' '}
        {t('results.correct', { count: mine?.correctCount ?? 0 })}
      </div>
      {isLeader ? (
        <div className={styles.actions}>
          <Button
            size="lg"
            block
            icon="party-popper"
            busy={busy}
            onClick={actions.rematch}
            data-testid="ctl-rematch"
          >
            {t('results.rematch')}
          </Button>
          <Button
            size="md"
            variant="violet"
            block
            onClick={actions.backToLobby}
            data-testid="ctl-lobby-back"
          >
            {t('results.backToLobby')}
          </Button>
        </div>
      ) : (
        <div className={styles.sub}>{t('ctl.lobby.waitingLeader')}</div>
      )}
      <Button size="md" variant="ghost" onClick={actions.leave} className={styles.leave}>
        {t('ctl.results.leave')}
      </Button>
    </Center>
  );
}
