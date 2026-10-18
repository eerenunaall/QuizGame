import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '../lib/router';
import type { CategoryCatalog } from '@quizparty/protocol';
import { AVATAR_IDS, type AvatarId } from '@quizparty/protocol/constants';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Sticker } from '../ui/Sticker';
import { sfx } from '../lib/audio';
import { useClient, useClientState, useRuntime } from '../lib/client-context';
import { useI18n } from '../lib/i18n';
import { Controller, type ControllerActions } from './Controller';
import { JoinForm } from './JoinForm';
import { PhoneFrame } from './PhoneFrame';
import styles from './PlayApp.module.css';

const PROFILE_KEY = 'qp.profile';

interface Profile {
  nickname: string;
  avatarId: AvatarId;
}

function randomAvatar(): AvatarId {
  return AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)] ?? 'fox';
}

function parseProfile(raw: string | null): Profile | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Profile>;
    if (typeof value.nickname === 'string' && AVATAR_IDS.includes(value.avatarId as AvatarId))
      return { nickname: value.nickname, avatarId: value.avatarId as AvatarId };
  } catch {
    // ignore corrupt data
  }
  return null;
}

/** The phone: resumes a stored seat, or shows the join form; then the controller for the room. */
export function PlayApp({ code }: { code: string }) {
  const { storage } = useRuntime();
  const client = useClient();
  const state = useClientState();
  const { locale, td } = useI18n();
  const navigate = useNavigate();
  const now = useMemo(() => (): number => client.serverNow(), [client]);

  const [preview, setPreview] = useState<Awaited<ReturnType<typeof client.preview>> | 'loading'>(
    'loading',
  );
  const [profile, setProfile] = useState<Profile>({ nickname: '', avatarId: randomAvatar() });
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(true);
  const [catalog, setCatalog] = useState<CategoryCatalog | null>(null);
  const [canReport, setCanReport] = useState(false);
  const [showRestored, setShowRestored] = useState(false);
  const errorTimer = useRef<number | null>(null);

  const describe = useCallback(
    (cause: unknown): string => {
      const failure = cause as ClientRequestError | undefined;
      const code = failure?.code ?? 'INTERNAL';
      if (code === 'NICKNAME_INVALID' && failure?.params?.reason)
        return td(`nickname.reason.${String(failure.params.reason)}`);
      return td(`error.${code}`);
    },
    [td],
  );

  const flash = useCallback((message: string): void => {
    setError(message);
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 4000);
  }, []);

  // Profile from the last time on this device.
  useEffect(() => {
    void Promise.resolve(storage.get(PROFILE_KEY)).then((raw) => {
      const saved = parseProfile(raw);
      if (saved) setProfile(saved);
    });
  }, [storage]);

  // Resume the stored seat for this room, if any; otherwise look the room up for the join form.
  useEffect(() => {
    let cancelled = false;
    setResuming(true);
    void (async () => {
      const resumed = await client.resume('PLAYER', code).catch(() => false);
      if (cancelled) return;
      setResuming(false);
      if (!resumed) {
        try {
          const found = await client.preview(code);
          if (!cancelled) setPreview(found);
        } catch {
          if (!cancelled) setPreview('loading');
        }
      }
    })();
    return () => {
      cancelled = true;
      client.suspend();
    };
  }, [client, code]);

  // "Game state restored" toast after a reconnect.
  useEffect(() => {
    if (state.restoredAt === null) return undefined;
    setShowRestored(true);
    const id = window.setTimeout(() => setShowRestored(false), 3000);
    return () => window.clearTimeout(id);
  }, [state.restoredAt]);

  const room = state.room;
  const inRoom = room !== null && state.session?.code === code;

  // The leader needs the category list for the lobby settings.
  const inLobby = inRoom && (room?.phase === 'LOBBY' || room?.phase === 'WAITING');
  useEffect(() => {
    if (!inLobby) return;
    void client
      .categories(locale)
      .then(setCatalog)
      .catch(() => undefined);
  }, [client, inLobby, locale]);

  // Whether players may flag questions is a server-side switch; hide the control while it is off.
  useEffect(() => {
    if (!inRoom) return;
    let cancelled = false;
    void client.flags().then((flags) => {
      if (!cancelled) setCanReport(flags['report.questions'] === true);
    });
    return () => {
      cancelled = true;
    };
  }, [client, inRoom]);

  const join = async (nickname: string, avatarId: AvatarId): Promise<void> => {
    void sfx.unlock();
    setJoining(true);
    setError(null);
    try {
      await client.join(code, nickname, avatarId);
      sfx.play('join');
      void Promise.resolve(storage.set(PROFILE_KEY, JSON.stringify({ nickname, avatarId })));
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setJoining(false);
    }
  };

  const guard =
    (run: () => Promise<void>): (() => void) =>
    () => {
      setBusy(true);
      void run()
        .catch((cause: unknown) => flash(describe(cause)))
        .finally(() => setBusy(false));
    };

  const actions: ControllerActions = {
    ready: (ready) => void client.setReady(ready).catch((cause: unknown) => flash(describe(cause))),
    start: guard(() => client.startGame()),
    settings: (change) =>
      void client.setSettings(change).catch((cause: unknown) => flash(describe(cause))),
    answer: (optionId) => void client.submitAnswer(optionId).catch(() => undefined),
    rematch: guard(() => client.rematch()),
    backToLobby: guard(() => client.backToLobby()),
    leave: () => {
      void client
        .leave()
        .then(() => client.forget())
        .then(() => navigate(`/join/${code}`, { replace: true }));
    },
    kick: (playerId) =>
      void client.kick(playerId).catch((cause: unknown) => flash(describe(cause))),
    makeLeader: (playerId) =>
      void client.transferLeader(playerId).catch((cause: unknown) => flash(describe(cause))),
    commit: (choice) =>
      client.commitPrep({
        stake: choice.stake,
        doubleDown: choice.doubleDown,
        sabotage: choice.sabotage,
      }),
    report: canReport
      ? (questionId, reason) => client.reportQuestion(questionId, reason)
      : undefined,
    fifty: () => void client.useFiftyFifty().catch((cause: unknown) => flash(describe(cause))),
    submitStatement: (text) => client.submitStatement(text),
    setReduced: (value) =>
      void client.setReducedEffects(value).catch((cause: unknown) => flash(describe(cause))),
  };

  if (resuming && !inRoom) {
    return (
      <PhoneFrame room={null} reconnecting={false} tvLost={false} restored={false}>
        <div className={styles.center}>
          <Banner tone="info" busy>
            {td('common.loading')}
          </Banner>
        </div>
      </PhoneFrame>
    );
  }

  if (state.closedReason && state.closedReason !== 'LEFT') {
    const roomClosed = state.closedReason === 'ROOM_CLOSED';
    const why = room?.phaseData.phase === 'ROOM_CLOSED' ? room.phaseData.reason : null;
    return (
      <PhoneFrame room={room} reconnecting={false} tvLost={false} restored={false}>
        <ClosedNotice
          reason={state.closedReason}
          why={why}
          // A closed room cannot be joined again: go to the code entry, not back to its join form.
          onRejoin={() =>
            void client.forget().then(() => {
              if (roomClosed) navigate('/join', { replace: true });
            })
          }
        />
      </PhoneFrame>
    );
  }

  if (inRoom && room) {
    return (
      <PhoneFrame
        room={room}
        reconnecting={state.transport === 'RECONNECTING'}
        tvLost={!room.displayConnected && room.phase !== 'LOBBY' && room.phase !== 'WAITING'}
        restored={showRestored}
      >
        <Controller
          room={room}
          state={state}
          now={now}
          catalog={catalog}
          busy={busy}
          error={error}
          actions={actions}
          storage={storage}
        />
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame room={null} reconnecting={false} tvLost={false} restored={false}>
      <JoinForm
        code={code}
        preview={preview}
        initialNickname={profile.nickname}
        initialAvatar={profile.avatarId}
        joining={joining}
        error={error}
        onSubmit={(nickname, avatarId) => void join(nickname, avatarId)}
      />
    </PhoneFrame>
  );
}

/** How long a phone shows "the room is closed" before it goes back to the join screen on its own. */
const CLOSED_RETURN_MS = 6_000;

function ClosedNotice({
  reason,
  why,
  onRejoin,
}: {
  reason: string;
  /** The server's close reason (HOST_ENDED, ABANDONED …) when the closing room view was kept. */
  why: string | null;
  onRejoin: () => void;
}) {
  const { t, td } = useI18n();
  const roomClosed = reason === 'ROOM_CLOSED';
  const message =
    reason === 'KICKED'
      ? t('ctl.kicked')
      : reason === 'SUPERSEDED'
        ? t('ctl.superseded')
        : roomClosed
          ? why
            ? td(`closed.${why}`)
            : t('ctl.closed')
          : t('ctl.revoked');
  // The callback changes every render; the countdown must not restart with it.
  const rejoin = useRef(onRejoin);
  rejoin.current = onRejoin;
  useEffect(() => {
    if (!roomClosed) return undefined;
    const timer = window.setTimeout(() => rejoin.current(), CLOSED_RETURN_MS);
    return () => window.clearTimeout(timer);
  }, [roomClosed]);
  return (
    <div className={styles.center} data-testid="ctl-ended">
      <Sticker id="hourglass" size={120} />
      <div className={styles.message}>{message}</div>
      {roomClosed ? <div className={styles.message}>{t('ctl.closed.returning')}</div> : null}
      <Button size="lg" onClick={onRejoin} className={styles.action}>
        {t('ctl.rejoin')}
      </Button>
    </div>
  );
}
