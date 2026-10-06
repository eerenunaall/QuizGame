import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  CategoryCatalog,
  DifficultyPreset,
  PhaseDataOf,
  PublicPlayer,
  RoomView,
} from '@quizparty/protocol';
import type { ClientState } from '@quizparty/controller-client';
import { AnswerCard, type AnswerState } from '../ui/AnswerCard';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { CountUp } from '../ui/CountUp';
import { Panel, Pill } from '../ui/Panel';
import { AnimatedSticker, Sticker } from '../ui/Sticker';
import { TimerBar } from '../ui/TimerBar';
import { categoryIcon } from '../lib/assets';
import { burst } from '../lib/confetti';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import styles from './Controller.module.css';
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
}

interface Props {
  room: RoomView;
  state: ClientState;
  now: () => number;
  catalog: CategoryCatalog | null;
  busy: boolean;
  error: string | null;
  actions: ControllerActions;
}

const vibrate = (ms: number): void => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
};

function Center({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={styles.center} data-testid={testId}>
      {children}
    </div>
  );
}

/** Chooses the controller screen for the current phase. */
export function Controller({ room, state, now, catalog, busy, error, actions }: Props) {
  const { t, td } = useI18n();
  const data = room.phaseData;
  const you = room.you;
  const isLeader = (you?.isLeader ?? false) || (you?.canHost ?? false);
  const myId = you?.playerId ?? '';

  switch (data.phase) {
    case 'WAITING':
    case 'LOBBY':
      return (
        <LobbyScreen
          room={room}
          catalog={catalog}
          isLeader={isLeader}
          busy={busy}
          error={error}
          actions={actions}
        />
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
    case 'QUESTION_PREP':
      return (
        <Center testId="ctl-prep">
          <Sticker id={categoryIcon(data.category.id)} size={130} />
          <div className={styles.big}>{data.category.label}</div>
          <div className={styles.sub}>{t('game.question.getReady')}</div>
        </Center>
      );
    case 'QUESTION':
      return (
        <Center testId="ctl-question">
          <Panel className={styles.questionCard}>
            <div className={styles.questionText}>{data.text}</div>
          </Panel>
          <div className={styles.sub}>{t('game.question.getReady')}</div>
        </Center>
      );
    case 'ANSWERING':
      return <AnswerScreen data={data} state={state} now={now} actions={actions} />;
    case 'LOCKED': {
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
      return <RevealScreen data={data} myId={myId} />;
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
  const enough = room.players.length >= 2;
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

  return (
    <div className={styles.lobby} data-testid="ctl-lobby">
      <div className={styles.lobbyHead}>
        {me ? (
          <Avatar avatarId={me.avatarId} size={96} colorSlot={me.colorSlot} leader={me.isLeader} />
        ) : null}
        <div className={styles.big}>{t('ctl.lobby.title')}</div>
      </div>

      <Button
        size="lg"
        block
        variant={me?.ready ? 'success' : 'violet'}
        onClick={() => actions.ready(!(me?.ready ?? false))}
        data-testid="ctl-ready"
      >
        {me?.ready ? t('ctl.lobby.notReady') : t('ctl.lobby.ready')}
      </Button>

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
          {!enough ? <div className={styles.need}>{t('lobby.needMore', { min: 2 })}</div> : null}
        </div>
      ) : null}
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

function AnswerScreen({
  data,
  state,
  now,
  actions,
}: {
  data: AnsweringData;
  state: ClientState;
  now: () => number;
  actions: ControllerActions;
}) {
  const { t, td } = useI18n();
  const answer = state.room?.you?.answer ?? null;
  const pending = state.pendingAnswer;
  const rejection = state.answerRejection;
  const locked = answer !== null && answer.questionId === data.questionId;

  useEffect(() => {
    if (locked) {
      vibrate(40);
      sfx.play('lock');
    }
  }, [locked]);

  if (locked) {
    return (
      <Center testId="ctl-confirmed">
        <ConfirmedScreen />
      </Center>
    );
  }

  const pick = (optionId: string): void => {
    if (pending) return;
    vibrate(20);
    sfx.play('tap');
    actions.answer(optionId);
  };

  return (
    <div className={styles.answering} data-testid="ctl-answering">
      <Panel className={styles.questionCard}>
        <div className={styles.questionText}>{data.text}</div>
      </Panel>
      <div className={styles.options}>
        {data.options.map((option, index) => {
          const chosen = pending?.optionId === option.optionId;
          const stateName: AnswerState = pending ? (chosen ? 'selected' : 'dim') : 'idle';
          return (
            <div
              key={option.optionId}
              className={styles.option}
              style={{ ['--qp-delay' as string]: `${index * 60}ms` }}
            >
              <AnswerCard
                size="phone"
                index={index}
                text={option.text}
                state={stateName}
                disabled={pending !== null}
                onSelect={() => pick(option.optionId)}
              />
            </div>
          );
        })}
      </div>
      {rejection ? <div className={styles.error}>{td(`error.${rejection.code}`)}</div> : null}
      <div className={styles.timer}>
        <TimerBar now={now} startAt={data.answerOpensAt} deadlineAt={data.answerDeadlineAt} />
      </div>
      <div className={styles.sr} aria-live="polite">
        {pending ? t('ctl.answer.sending') : t('ctl.answer.pick')}
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

function RevealScreen({ data, myId }: { data: PhaseDataOf<'REVEAL'>; myId: string }) {
  const { t } = useI18n();
  const mine = data.results.find((result) => result.playerId === myId);
  const outcome = mine?.outcome ?? 'NO_ANSWER';
  const correctText =
    data.options.find((option) => option.optionId === data.correctOptionId)?.text ?? '';
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (outcome === 'CORRECT') {
      vibrate(60);
      sfx.play('correct');
      burst(0.5, 0.35, 120);
    } else {
      vibrate(160);
      sfx.play(outcome === 'INCORRECT' ? 'wrong' : 'tap');
    }
  }, [outcome]);
  return (
    <Center testId="ctl-reveal">
      {outcome === 'CORRECT' ? (
        <AnimatedSticker id="party-popper" size={150} />
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
        {outcome === 'CORRECT'
          ? t('ctl.reveal.correct')
          : outcome === 'INCORRECT'
            ? t('ctl.reveal.incorrect')
            : t('ctl.reveal.noAnswer')}
      </div>
      <Panel className={styles.correctCard} tone="glass">
        <div className={styles.kicker}>{t('game.reveal.correct')}</div>
        <div className={styles.correctText}>{correctText}</div>
      </Panel>
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
  useEffect(() => {
    if (mine && mine.rank === 1) burst(0.5, 0.4, 200);
  }, [mine]);
  return (
    <Center testId="ctl-results">
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
