import { useEffect, useRef, useState } from 'react';
import type { Joker, PublicPlayer, SabotageKind } from '@quizparty/protocol';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { PowerIcon } from '../ui/PowerIcon';
import { Sticker } from '../ui/Sticker';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import {
  JOKER_ORDER,
  JOKER_STICKER,
  SABOTAGE_ORDER,
  SABOTAGE_STICKER,
  cutBlock,
  type SabotageChoice,
} from './powers';
import styles from './SabotageSheet.module.css';
import { cx } from '../lib/cx';

type Choice = NonNullable<SabotageChoice['sabotage']>;
type Step = 'who' | 'what';

interface Props {
  players: readonly PublicPlayer[];
  /** The menu of this round (switched on, legal now); older servers send none = the original five. */
  kinds: readonly SabotageKind[];
  /** Cut's share and ceiling, for its one-line rule. */
  cutRule: { permille: number; maxPoints: number } | undefined;
  /** The table (rank and score), for the Cut rule: never the leader, never somebody with no points. */
  scoreboard: readonly { playerId: string; score: number; rank: number }[];
  /** The sabotage already armed, if the sheet is opened again. */
  current: SabotageChoice['sabotage'];
  onConfirm: (choice: Choice) => void;
  /** Takes an armed sabotage back (only offered while one is armed). */
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Sabotage in two steps and one confirm: a person (big faces, two columns), then one of the real
 * sabotage types as a big card with its one-line effect, then a single "send" button. The server
 * takes the whole prep as one final message (ADR-0010), so "send" is the commit: there is no undo
 * after it, which is why the caller gives a short undo window before it goes out.
 */
export function SabotageSheet({
  players,
  kinds,
  cutRule,
  scoreboard,
  current,
  onConfirm,
  onRemove,
  onClose,
}: Props) {
  const { t, td } = useI18n();
  const [step, setStep] = useState<Step>(current ? 'what' : 'who');
  const [targetId, setTargetId] = useState<string | null>(current?.targetId ?? null);
  const [effect, setEffect] = useState<SabotageKind | null>(current?.effect ?? null);
  const [joker, setJoker] = useState<Joker | null>(current?.joker ?? null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const target = players.find((player) => player.playerId === targetId);

  useEffect(() => {
    firstRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needsJoker = effect === 'LOCKOUT';
  const effectBlocked =
    effect === 'CUT' && targetId ? cutBlock(scoreboard, targetId) !== null : false;
  const ready = Boolean(target && effect && !effectBlocked && (!needsJoker || joker));
  // One line that says why the big button is still grey.
  const why = !effect
    ? t('ctl.prep.sabotage.pickEffect')
    : needsJoker && !joker
      ? t('ctl.prep.sabotage.pickJoker')
      : null;

  const confirm = (): void => {
    if (!ready || !targetId || !effect) return;
    sfx.play('tap');
    onConfirm({ targetId, effect, ...(needsJoker && joker ? { joker } : {}) });
  };

  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('ctl.prep.sabotage')}
        data-testid="sabotage-sheet"
        data-step={step}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.grip} aria-hidden="true" />
        <div className={styles.head}>
          {step === 'what' ? (
            <button
              type="button"
              className={styles.back}
              onClick={() => setStep('who')}
              data-testid="sabotage-back"
              aria-label={t('common.back')}
              data-focusable
            >
              ‹
            </button>
          ) : null}
          <div className={styles.title}>
            {step === 'who' ? t('ctl.prep.sabotage.who') : t('ctl.prep.sabotage.what')}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t('common.close')}
            data-testid="sabotage-close"
            data-focusable
          >
            ×
          </button>
        </div>

        {step === 'who' ? (
          <div className={styles.body}>
            <div className={styles.faces}>
              {players.map((player, index) => (
                <button
                  key={player.playerId}
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className={cx(styles.face, targetId === player.playerId && styles.faceOn)}
                  onClick={() => {
                    sfx.play('tap');
                    setTargetId(player.playerId);
                    setStep('what');
                  }}
                  data-testid={`sabotage-target-${player.nickname}`}
                  data-focusable
                >
                  <Avatar
                    avatarId={player.avatarId}
                    size={76}
                    colorSlot={player.colorSlot}
                    dim={player.connection === 'DISCONNECTED'}
                  />
                  <span className={styles.faceName}>{player.nickname}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className={styles.body}>
              {target ? (
                <button
                  type="button"
                  className={styles.target}
                  onClick={() => setStep('who')}
                  data-testid="sabotage-target-chosen"
                  data-focusable
                >
                  <Avatar avatarId={target.avatarId} size={40} colorSlot={target.colorSlot} />
                  <span className={styles.targetName}>{target.nickname}</span>
                </button>
              ) : null}
              <div
                className={styles.cards}
                role="radiogroup"
                aria-label={t('ctl.prep.sabotage.what')}
              >
                {SABOTAGE_ORDER.filter((kind) => kinds.includes(kind)).map((kind, index) => {
                  // Cut never aims at the leader or at somebody with no points: the card says why.
                  const block = kind === 'CUT' && targetId ? cutBlock(scoreboard, targetId) : null;
                  return (
                    <div key={kind} className={styles.cardWrap}>
                      <button
                        ref={index === 0 && !effect ? firstRef : undefined}
                        type="button"
                        role="radio"
                        aria-checked={effect === kind}
                        aria-disabled={block !== null}
                        disabled={block !== null}
                        className={cx(styles.card, effect === kind && styles.cardOn)}
                        onClick={() => {
                          sfx.play('tap');
                          setEffect(kind);
                        }}
                        data-testid={`sabotage-effect-${kind}`}
                        data-focusable
                      >
                        <PowerIcon id={SABOTAGE_STICKER[kind]} size={46} />
                        <span className={styles.cardText}>
                          <span className={styles.cardName}>{td(`sabotage.${kind}`)}</span>
                          <span className={cx(styles.cardDesc, block !== null && styles.cardWhy)}>
                            {block === 'LEADER'
                              ? t('ctl.sabotage.cut.leader')
                              : block === 'NO_POINTS'
                                ? t('ctl.sabotage.cut.noPoints')
                                : td(`sabotage.${kind}.desc`, {
                                    percent: Math.round((cutRule?.permille ?? 200) / 10),
                                    max: cutRule?.maxPoints ?? 30,
                                  })}
                          </span>
                        </span>
                      </button>
                      {kind === 'LOCKOUT' && effect === 'LOCKOUT' ? (
                        <div
                          className={styles.jokers}
                          role="radiogroup"
                          aria-label={t('ctl.prep.sabotage.which')}
                        >
                          {JOKER_ORDER.map((entry) => (
                            <button
                              key={entry}
                              type="button"
                              role="radio"
                              aria-checked={joker === entry}
                              className={cx(styles.joker, joker === entry && styles.jokerOn)}
                              onClick={() => {
                                sfx.play('tap');
                                setJoker(entry);
                              }}
                              data-testid={`sabotage-joker-${entry}`}
                              data-focusable
                            >
                              <Sticker id={JOKER_STICKER[entry]} size={32} />
                              <span>{td(`joker.${entry}`)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={styles.footer}>
              <div className={styles.why} data-testid="sabotage-why">
                {why ?? t('ctl.sabotage.final')}
              </div>
              <Button
                size="lg"
                block
                variant="danger"
                icon="bomb"
                className={styles.send}
                disabled={!ready}
                onClick={confirm}
                data-testid="sabotage-confirm"
              >
                {t('ctl.prep.sabotage.send')}
              </Button>
              {current ? (
                <Button
                  size="md"
                  variant="ghost"
                  block
                  className={styles.remove}
                  onClick={onRemove}
                  data-testid="sabotage-remove"
                >
                  {t('ctl.prep.sabotage.remove')}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
