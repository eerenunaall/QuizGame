import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { CategoryCatalog, Difficulty, PhaseData, RoomView } from '@quizparty/protocol';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Banner } from '../ui/Banner';
import { Stage } from '../ui/Stage';
import { sfx } from '../lib/audio';
import { useClient, useClientState, useRuntime } from '../lib/client-context';
import { useI18n } from '../lib/i18n';
import { installRemoteNavigation } from '../lib/remote-nav';
import { savePreferences, loadPreferences } from '../lib/storage';
import { TvFrame } from './TvFrame';
import { useTvSounds } from './sounds';
import {
  TvClosed,
  TvCountdown,
  TvFinalSplash,
  TvIntermission,
  TvRiskPick,
  TvSabotagePick,
  TvRoundIntro,
} from './screens/TvInterstitials';
import { TvExitButton, TvExitDialog } from './screens/TvExit';
import { TvLobby } from './screens/TvLobby';
import { TvPowerResolution } from './screens/TvPower';
import { TvQuestion, crowdSummary } from './screens/TvQuestion';
import { TvResults } from './screens/TvResults';
import { TvScoreUpdate } from './screens/TvScore';
import { TvSettings } from './screens/TvSettings';
import type { ThemeId } from '@quizparty/ui-tokens';
import { TvTitle } from './screens/TvTitle';
import { TvUnlock } from './screens/TvUnlock';
import styles from './TvApp.module.css';
import { meterBlocked, useTicker } from '../venue/meter';
import { TvVenueTimeUp } from '../venue/TvVenueTimeUp';

const JOIN_KEY = 'qp.tv.join';

/** Closings after which nobody is left to act on the screen: it goes back to the title menu by itself. */
const AUTO_MENU_REASONS: ReadonlySet<string> = new Set([
  'ABANDONED',
  'HOST_ENDED',
  'IDLE',
  'LIFETIME',
]);

interface Remembered {
  questionId: string;
  text: string;
  category: { id: string; label: string };
  difficulty: Difficulty;
  options: readonly { optionId: string; text: string }[];
}

type Answering = Extract<PhaseData, { phase: 'ANSWERING' }>;

function joinLabel(joinUrl: string): string {
  try {
    return `${new URL(joinUrl).host}/join`;
  } catch {
    return joinUrl;
  }
}

function categorySummary(room: RoomView, catalog: CategoryCatalog | null, mixed: string): string {
  const selected = room.settings.categories;
  if (selected === 'ALL') return mixed;
  const labels = selected.map(
    (id) => catalog?.categories.find((category) => category.id === id)?.label ?? id,
  );
  return labels.length <= 2
    ? labels.join(', ')
    : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
}

export function TvApp({
  locale,
  onLocale,
  theme,
  onTheme,
}: {
  locale: 'tr' | 'en';
  onLocale: (locale: 'tr' | 'en') => void;
  theme?: ThemeId;
  onTheme?: (theme: ThemeId) => void;
}) {
  const { storage } = useRuntime();
  const client = useClient();
  const state = useClientState();
  const { t, td } = useI18n();
  const room = state.room;
  const now = useMemo(() => (): number => client.serverNow(), [client]);
  const rootRef = useRef<HTMLDivElement>(null);

  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CategoryCatalog | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(() => loadPreferences(storage));
  const [audioLocked, setAudioLocked] = useState(!sfx.ready);
  const remembered = useRef<Remembered | null>(null);

  useTvSounds(room);

  // Preferences → synthesised sound volume.
  useEffect(() => {
    sfx.configure({ volume: prefs.volume, muted: prefs.muted });
  }, [prefs]);

  // Resume a stored display session (page reload, TV wake-up).
  useEffect(() => {
    void client.resume('DISPLAY').catch(() => undefined);
    return () => client.suspend();
  }, [client]);

  // A stale stored session answers "closed"/"expired" before any room was shown: start over quietly.
  useEffect(() => {
    if (state.closedReason && !state.room && state.closedReason !== 'LEFT') void client.forget();
  }, [client, state.closedReason, state.room]);

  // The first remote key or click unlocks audio when no button press has done so yet.
  useEffect(() => {
    if (!audioLocked) return undefined;
    const unlock = (): void => {
      void sfx.unlock().then((ok) => setAudioLocked(!ok));
    };
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => {
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('pointerdown', unlock);
    };
  }, [audioLocked]);

  // Remote control: arrows move focus; Back/Escape closes a dialog, or else asks to leave the room.
  const backRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return installRemoteNavigation(root, () => backRef.current());
  }, []);

  // Join link: remembered at creation; derived from the page origin after a resume.
  const roomCode = room?.code ?? null;
  useEffect(() => {
    if (!roomCode) {
      setJoinUrl(null);
      return;
    }
    void Promise.resolve(storage.get(JOIN_KEY)).then((stored) => {
      setJoinUrl(
        stored && stored.endsWith(`/${roomCode}`)
          ? stored
          : `${window.location.origin}/join/${roomCode}`,
      );
    });
  }, [storage, roomCode]);

  // Categories for the settings dialog and the lobby summary.
  const inLobby = room?.phase === 'LOBBY' || room?.phase === 'WAITING';
  useEffect(() => {
    if (!inLobby) return;
    void client
      .categories(locale)
      .then(setCatalog)
      .catch(() => undefined);
  }, [client, inLobby, locale]);

  // Remember the question while answering: LOCKED and REVEAL screens redraw it.
  const phaseData = room?.phaseData ?? null;
  useEffect(() => {
    if (phaseData?.phase !== 'ANSWERING') return;
    const data: Answering = phaseData;
    remembered.current = {
      questionId: data.questionId,
      text: data.text,
      category: data.category,
      difficulty: data.difficulty,
      options: data.options,
    };
  }, [phaseData]);

  const describe = useCallback(
    (cause: unknown): string => {
      const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
      return td(`error.${code}`);
    },
    [td],
  );

  const startRoom = async (): Promise<void> => {
    void sfx.unlock().then((ok) => setAudioLocked(!ok));
    setCreating(true);
    setError(null);
    try {
      if (state.closedReason || state.room) await client.forget();
      const created = await client.createRoom(locale);
      void Promise.resolve(storage.set(JOIN_KEY, created.joinUrl));
      setJoinUrl(created.joinUrl);
    } catch (cause) {
      setError(describe(cause) || t('tv.error.create'));
    } finally {
      setCreating(false);
    }
  };

  const startGame = async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      await client.startGame();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setStarting(false);
    }
  };

  // Unlocked from a phone: let the celebration show for a moment, then hand the lobby back.
  const unlockedNow = showUnlock && room?.tier === 'FULL';
  useEffect(() => {
    if (!unlockedNow) return undefined;
    const timer = setTimeout(() => setShowUnlock(false), 3500);
    return () => clearTimeout(timer);
  }, [unlockedNow]);

  /** Opens the unlock dialog and asks the server for a fresh one-time link (also used for "new code"). */
  const openUnlock = (): void => {
    setShowUnlock(true);
    setUnlockError(null);
    client.requestUnlockLink().catch((cause: unknown) => setUnlockError(describe(cause)));
  };

  const hostCommand = async (run: () => Promise<void>): Promise<void> => {
    setRematching(true);
    try {
      await run();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setRematching(false);
    }
  };

  const changePrefs = (volume: number, muted: boolean): void => {
    const next = { ...prefs, volume: muted ? prefs.volume : volume, muted };
    setPrefs(next);
    savePreferences(storage, next);
    sfx.configure({ volume: next.volume, muted: next.muted });
    sfx.play('tap');
  };

  const changeLocale = (next: 'tr' | 'en'): void => {
    const updated = { ...prefs, locale: next };
    setPrefs(updated);
    savePreferences(storage, updated);
    onLocale(next);
  };

  const roomOpen = room !== null && room.phase !== 'ROOM_CLOSED' && !state.closedReason;
  const closeExit = (): void => {
    setConfirmExit(false);
    setExitError(null);
  };
  backRef.current = () => {
    if (showSettings || showUnlock) {
      setShowSettings(false);
      setShowUnlock(false);
    } else if (confirmExit) closeExit();
    else if (roomOpen) setConfirmExit(true);
  };
  // "Evet": close the room for everybody (the display may END_ROOM), then show the title menu.
  const exitRoom = async (): Promise<void> => {
    setExiting(true);
    setExitError(null);
    try {
      await client.endRoom();
      await client.forget();
      setConfirmExit(false);
    } catch (cause) {
      setExitError(describe(cause));
    } finally {
      setExiting(false);
    }
  };

  // Venue mode (ADR-0024): a café table whose time is up (or paused) shows who to ask instead of a lobby.
  const venueTick = useTicker(now, room?.venue !== undefined);
  const venueBlock = meterBlocked(room?.venue, venueTick);
  const rewardWinner = state.venueRewardWinner
    ? (room?.players.find((p) => p.playerId === state.venueRewardWinner?.playerId) ?? null)
    : null;

  const reconnecting = state.transport === 'RECONNECTING';
  const overlay = reconnecting ? (
    <Banner tone="warning" size="tv" busy testId="tv-reconnecting">
      {t('tv.reconnecting.title')} · {t('tv.reconnecting.body')}
    </Banner>
  ) : audioLocked && room ? (
    <Banner tone="info" size="tv">
      {t('tv.audioHint')}
    </Banner>
  ) : null;

  const content = ((): ReactElement => {
    if (!room) {
      return (
        <TvTitle
          creating={creating}
          error={error}
          onStart={() => void startRoom()}
          volume={prefs.volume}
          muted={prefs.muted}
          locale={locale}
          onVolume={changePrefs}
          onLocale={changeLocale}
          {...(theme && onTheme ? { theme, onTheme } : {})}
        />
      );
    }
    const data = room.phaseData;
    const whoSaidIt = room.settings.mode === 'WHO_SAID_IT';
    const round =
      'round' in data
        ? { index: data.round.index, total: data.round.total, isFinal: data.round.isFinal }
        : undefined;
    const base = { room, ...(round ? { round } : {}), overlay, now } as const;

    switch (data.phase) {
      case 'WAITING':
      case 'LOBBY':
        if (venueBlock)
          return (
            <TvFrame {...base} theme="lobby" strip={false}>
              <TvVenueTimeUp room={room} reason={venueBlock} />
            </TvFrame>
          );
        return (
          <>
            <TvLobby
              room={room}
              joinUrl={joinUrl ?? `${window.location.origin}/join/${room.code}`}
              joinLabel={joinLabel(joinUrl ?? window.location.origin)}
              starting={starting}
              error={error}
              onStart={() => void startGame()}
              onOpenSettings={() => setShowSettings(true)}
              onOpenUnlock={openUnlock}
              categoryLabel={categorySummary(room, catalog, t('settings.mixed'))}
              now={now}
            />
            {showSettings ? (
              <TvSettings
                room={room}
                catalog={catalog}
                onChange={(change) =>
                  void client
                    .setSettings(change)
                    .catch((cause: unknown) => setError(describe(cause)))
                }
                onClose={() => setShowSettings(false)}
              />
            ) : null}
            {showUnlock ? (
              <TvUnlock
                link={state.unlockLink?.url ?? null}
                unlocked={room.tier === 'FULL'}
                error={unlockError}
                onNewCode={openUnlock}
                onClose={() => setShowUnlock(false)}
              />
            ) : null}
            {overlay ? <div className={styles.overlay}>{overlay}</div> : null}
          </>
        );
      case 'COUNTDOWN':
        return (
          <TvFrame {...base} theme="lobby" strip={false}>
            <TvCountdown
              now={now}
              deadlineAt={room.phaseDeadlineAt ?? now()}
              onNumber={(n) => sfx.play(n > 0 ? 'countdown' : 'go')}
            />
          </TvFrame>
        );
      case 'ROUND_INTRO':
        return (
          <TvFrame {...base} strip={false}>
            <TvRoundIntro round={data.round} />
          </TvFrame>
        );
      case 'FINAL':
        return (
          <TvFrame {...base} theme="final" strip={false}>
            <TvFinalSplash round={data.round} />
          </TvFrame>
        );
      case 'QUESTION_PREP': // retired phase (ADR-0022): shown as RISK_PICK
      case 'RISK_PICK':
        return (
          <TvFrame {...base} strip={false}>
            <TvRiskPick
              data={{ ...data, phase: 'RISK_PICK' }}
              now={now}
              startAt={room.phaseEnteredAt}
              deadlineAt={room.phaseDeadlineAt}
            />
          </TvFrame>
        );
      case 'SABOTAGE_PICK':
        return (
          <TvFrame {...base} strip={false}>
            <TvSabotagePick
              data={data}
              now={now}
              startAt={room.phaseEnteredAt}
              deadlineAt={room.phaseDeadlineAt}
            />
          </TvFrame>
        );

      case 'QUESTION':
        return (
          <TvFrame {...base}>
            <TvQuestion
              room={room}
              category={data.category}
              difficulty={data.difficulty}
              text={data.text}
              whoSaidIt={whoSaidIt}
              status={{ tone: 'info', text: t('game.question.getReady'), icon: 'hourglass' }}
            />
          </TvFrame>
        );
      case 'ANSWERING': {
        const eligible = room.players.filter((player) => player.connection === 'CONNECTED').length;
        return (
          <TvFrame {...base} strip={{ answered: data.answeredPlayerIds }}>
            <TvQuestion
              room={room}
              category={data.category}
              difficulty={data.difficulty}
              text={data.text}
              options={data.options}
              whoSaidIt={whoSaidIt}
              timer={{
                now,
                startAt: data.answerOpensAt,
                deadlineAt: data.answerDeadlineAt,
                onSecond: (seconds) => {
                  if (seconds > 0) sfx.play(seconds <= 3 ? 'tickUrgent' : 'tick');
                },
              }}
              status={{
                tone: 'info',
                text: t('game.answered', {
                  count: data.answeredPlayerIds.length,
                  // the author of a Who Said It statement is not waited for (and the TV does not know who)
                  total: Math.max(
                    whoSaidIt ? eligible - 1 : eligible,
                    data.answeredPlayerIds.length,
                  ),
                }),
              }}
            />
          </TvFrame>
        );
      }
      case 'LOCKED': {
        const memory =
          remembered.current?.questionId === data.questionId ? remembered.current : null;
        return (
          <TvFrame {...base} strip={{ answered: data.answeredPlayerIds }}>
            <TvQuestion
              room={room}
              category={memory?.category}
              difficulty={memory?.difficulty}
              text={memory?.text ?? ''}
              {...(memory ? { options: memory.options } : {})}
              whoSaidIt={whoSaidIt}
              status={{ tone: 'gold', text: t('game.locked'), icon: 'lock' }}
            />
          </TvFrame>
        );
      }
      case 'REVEAL': {
        const memory =
          remembered.current?.questionId === data.questionId ? remembered.current : null;
        const results = Object.fromEntries(
          data.results.map((result) => [result.playerId, result.outcome]),
        );
        const anyCorrect = data.results.some((result) => result.outcome === 'CORRECT');
        const crowd = data.round.kind === 'CROWD';
        const summary = crowd ? crowdSummary(data.distribution, data.correctOptionId) : null;
        const author = whoSaidIt
          ? data.options.find((option) => option.optionId === data.correctOptionId)
          : undefined;
        const statusText = author
          ? t('whosaidit.reveal', { name: author.text })
          : summary
            ? summary.kind === 'split'
              ? t('game.crowd.split')
              : summary.right
                ? t('game.crowd.right')
                : t('game.crowd.wrong')
            : anyCorrect
              ? t('game.reveal.correct')
              : t('game.reveal.nobody');
        return (
          <TvFrame {...base} strip={{ results }} celebrate={anyCorrect}>
            <TvQuestion
              room={room}
              category={memory?.category}
              difficulty={memory?.difficulty}
              text={data.text}
              options={data.options}
              crowd={crowd}
              whoSaidIt={whoSaidIt}
              status={{ tone: 'success', text: statusText, icon: 'check' }}
              reveal={{
                correctOptionId: data.correctOptionId,
                distribution: data.distribution,
                results: data.results,
                explanation: data.explanation,
              }}
            />
          </TvFrame>
        );
      }
      case 'POWER_RESOLUTION':
        return (
          <TvFrame {...base} theme="results" strip={false}>
            <TvPowerResolution room={room} data={data} />
          </TvFrame>
        );
      case 'SCORE_UPDATE':
        return (
          <TvFrame {...base} theme="results" strip={false}>
            <TvScoreUpdate room={room} data={data} onRankChange={() => sfx.play('rankUp')} />
          </TvFrame>
        );
      case 'MICRO_INTERMISSION':
        return (
          <TvFrame {...base} strip={false}>
            <TvIntermission next={data.next} />
          </TvFrame>
        );
      case 'RESULTS': {
        // Below the podium, above the buttons: never over the title or the ranking.
        const venueBanners =
          rewardWinner || venueBlock ? (
            <div className={styles.venueBanners}>
              {rewardWinner ? (
                <Banner tone="success" size="tv" testId="tv-venue-reward">
                  {t('venue.reward.tv', { name: rewardWinner.nickname })}
                </Banner>
              ) : null}
              {venueBlock ? (
                <Banner tone="warning" size="tv" testId="tv-venue-time-up">
                  {venueBlock === 'up' ? t('venue.timeUp.banner') : t('venue.paused.title')}
                </Banner>
              ) : null}
            </div>
          ) : null;
        return (
          <TvFrame {...base} theme="results" strip={false} celebrate>
            <TvResults
              room={room}
              data={data}
              busy={rematching}
              onRematch={() => void hostCommand(() => client.rematch())}
              onLobby={() => void hostCommand(() => client.backToLobby())}
              onEnd={() => void hostCommand(() => client.endRoom())}
            />
            {venueBanners}
          </TvFrame>
        );
      }
      case 'ROOM_CLOSED':
        return (
          <TvFrame {...base} strip={false}>
            <TvClosed
              message={td(`closed.${data.reason}`)}
              onNew={() => void startRoom()}
              {...(AUTO_MENU_REASONS.has(data.reason)
                ? { onMenu: () => void client.forget() }
                : {})}
            />
          </TvFrame>
        );
    }
  })();

  // Another screen took over this display session.
  if (state.closedReason === 'SUPERSEDED' || state.closedReason === 'REVOKED') {
    return (
      <Stage>
        <TvFrame room={room ?? placeholderRoom()} strip={false}>
          <TvClosed message={t('closed.SUPERSEDED')} onNew={() => void startRoom()} />
        </TvFrame>
      </Stage>
    );
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <Stage>
        {content}
        {roomOpen ? <TvExitButton onClick={() => setConfirmExit(true)} /> : null}
        {roomOpen && confirmExit ? (
          <TvExitDialog
            busy={exiting}
            error={exitError}
            onYes={() => void exitRoom()}
            onNo={closeExit}
          />
        ) : null}
      </Stage>
    </div>
  );
}

function placeholderRoom(): RoomView {
  return {
    roomId: '00000000-0000-4000-8000-000000000000',
    code: '------',
    stateVersion: 0,
    serverTime: 0,
    phase: 'ROOM_CLOSED',
    phaseEnteredAt: 0,
    phaseDeadlineAt: null,
    tier: 'FREE',
    contentLanguage: 'tr',
    maxPlayers: 8,
    limits: { maxRounds: 5 },
    settings: {
      mode: 'CLASSIC',
      contentTitle: null,
      rounds: 5,
      difficulty: 'MEDIUM',
      categories: 'ALL',
    },
    displayConnected: false,
    awaitingDisplay: false,
    players: [],
    game: null,
    phaseData: { phase: 'ROOM_CLOSED', reason: 'ADMIN' },
    you: null,
  };
}
