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
  TvPrep,
  TvRoundIntro,
} from './screens/TvInterstitials';
import { TvLobby } from './screens/TvLobby';
import { TvQuestion } from './screens/TvQuestion';
import { TvResults } from './screens/TvResults';
import { TvScoreUpdate } from './screens/TvScore';
import { TvSettings } from './screens/TvSettings';
import { TvTitle } from './screens/TvTitle';
import styles from './TvApp.module.css';

const JOIN_KEY = 'qp.tv.join';

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
}: {
  locale: 'tr' | 'en';
  onLocale: (locale: 'tr' | 'en') => void;
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

  // Remote control: arrows move focus, Back closes dialogs.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return installRemoteNavigation(root, () => setShowSettings(false));
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
        />
      );
    }
    const data = room.phaseData;
    const round =
      'round' in data
        ? { index: data.round.index, total: data.round.total, isFinal: data.round.isFinal }
        : undefined;
    const base = { room, ...(round ? { round } : {}), overlay } as const;

    switch (data.phase) {
      case 'WAITING':
      case 'LOBBY':
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
              categoryLabel={categorySummary(room, catalog, t('settings.mixed'))}
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
      case 'QUESTION_PREP':
        return (
          <TvFrame {...base} strip={false}>
            <TvPrep category={data.category} difficulty={data.difficulty} />
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
                  total: Math.max(eligible, data.answeredPlayerIds.length),
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
        return (
          <TvFrame {...base} strip={{ results }} celebrate={anyCorrect}>
            <TvQuestion
              room={room}
              category={memory?.category}
              difficulty={memory?.difficulty}
              text={data.text}
              options={data.options}
              status={{
                tone: 'success',
                text: anyCorrect ? t('game.reveal.correct') : t('game.reveal.nobody'),
                icon: 'check',
              }}
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
          <TvFrame {...base} strip={false}>
            <TvIntermission next={null} />
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
      case 'RESULTS':
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
          </TvFrame>
        );
      case 'ROOM_CLOSED':
        return (
          <TvFrame {...base} strip={false}>
            <TvClosed message={td(`closed.${data.reason}`)} onNew={() => void startRoom()} />
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
      <Stage>{content}</Stage>
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
    settings: { mode: 'CLASSIC', rounds: 5, difficulty: 'MEDIUM', categories: 'ALL' },
    displayConnected: false,
    awaitingDisplay: false,
    players: [],
    game: null,
    phaseData: { phase: 'ROOM_CLOSED', reason: 'ADMIN' },
    you: null,
  };
}
