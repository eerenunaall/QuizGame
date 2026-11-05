import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StoredSession } from '@quizparty/controller-client';
import { useI18n } from '../lib/i18n';
import { createStorage } from '../lib/storage';
import { QrCode } from '../ui/QrCode';
import { Stage } from '../ui/Stage';
import styles from './DisplayPairing.module.css';

/** Where the controller client keeps the TV's room session (packages/controller-client KEYS.display). */
const DISPLAY_SESSION_KEY = 'qp.display';
const POLL_MS = 3000;

interface Delivery {
  roomId: string;
  code: string;
  display: { sessionId: string; reconnectToken: string };
}
interface PollAnswer {
  lock: boolean;
  paired: boolean;
  pairing?: { expiresAt: number } | null;
  delivery?: Delivery;
}
interface Pairing {
  code: string;
  pairUrl: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

/**
 * The TV page under VENUE_LOCK (ADR-0028 §1-2). It asks the server whether the lock is on and whether this
 * browser is a paired venue display; only then does the game (the title menu, rooms) render. With the lock
 * off it renders the game at once and polls nothing more, so the public game is unchanged. The gate is a
 * convenience for the person at the TV: the server refuses room creation without the display credential
 * whatever this page shows.
 */
export function DisplayLockGate({ children }: { children: ReactNode }): ReactNode {
  const storage = useRef(createStorage()).current;
  const [lock, setLock] = useState<boolean | null>(null);
  const [paired, setPaired] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [failed, setFailed] = useState(false);
  // A room handed over by the panel remounts the game so it resumes the stored display session.
  const [generation, setGeneration] = useState(0);
  const wasPaired = useRef(false);
  const starting = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      let next = POLL_MS;
      try {
        const answer = await post<PollAnswer>('/v1/display/poll', {});
        if (stopped) return;
        setFailed(false);
        setLock(answer.lock);
        if (!answer.lock) return; // the public game: no more polling
        setPaired(answer.paired);
        if (answer.paired) {
          wasPaired.current = true;
          setPairing(null);
          if (answer.delivery) {
            const session: StoredSession = {
              sessionId: answer.delivery.display.sessionId,
              roomId: answer.delivery.roomId,
              token: answer.delivery.display.reconnectToken,
              role: 'DISPLAY',
              playerId: null,
              code: answer.delivery.code,
            };
            await Promise.resolve(storage.set(DISPLAY_SESSION_KEY, JSON.stringify(session)));
            setGeneration((n) => n + 1);
          }
        } else {
          if (wasPaired.current) {
            // Removed from the panel: forget the room this screen held.
            wasPaired.current = false;
            await Promise.resolve(storage.remove(DISPLAY_SESSION_KEY));
          }
          if (!answer.pairing && !starting.current) {
            starting.current = true;
            try {
              const created = await post<Pairing>('/v1/display/pairing', {});
              if (!stopped) setPairing(created);
            } finally {
              starting.current = false;
            }
          }
        }
      } catch {
        if (stopped) return;
        setFailed(true);
        next = POLL_MS * 2;
      }
      if (!stopped) timer = setTimeout(() => void tick(), next);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [storage]);

  if (lock === null) return <div className="qp-boot" role="status" />;
  if (!lock || paired)
    return (
      <div key={generation} style={{ display: 'contents' }}>
        {children}
      </div>
    );
  return <PairingScreen pairing={pairing} failed={failed} />;
}

/** What an unpaired TV shows instead of the title menu: a large code, a QR, and nothing a guest could play. */
export function PairingScreen({
  pairing,
  failed,
}: {
  pairing: Pairing | null;
  failed: boolean;
}): ReactNode {
  const { t } = useI18n();
  return (
    <Stage>
      <div className={styles.screen} data-testid="display-pairing">
        <h1 className={styles.title}>{t('display.pair.title')}</h1>
        <p className={styles.steps}>{t('display.pair.steps')}</p>
        {pairing ? (
          <div className={styles.row}>
            <div>
              <div className={styles.label}>{t('display.pair.code')}</div>
              <div className={styles.code} data-testid="display-pairing-code">
                {pairing.code}
              </div>
            </div>
            <QrCode value={pairing.pairUrl} size={300} label={t('display.pair.qr')} />
          </div>
        ) : null}
        <p className={styles.hint}>{t('display.pair.expires')}</p>
        {failed ? <p className={styles.error}>{t('display.pair.error')}</p> : null}
      </div>
    </Stage>
  );
}
