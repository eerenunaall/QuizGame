import { useEffect, useRef, useState } from 'react';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { PowerIcon } from '../ui/PowerIcon';
import { Sticker } from '../ui/Sticker';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import { SabotageSheet } from './SabotageSheet';
import { PickHeader, PickTicks } from './PickParts';
import {
  SABOTAGE_STICKER,
  isTeamGame,
  rivalTeams,
  sabotageKinds,
  sabotageState,
  sabotageTargets,
  type SabotageChoice,
} from './powers';
import { teamName } from '../lib/teams';
import styles from './PickScreen.module.css';
import { cx } from '../lib/cx';

type SabotageData = PhaseDataOf<'SABOTAGE_PICK'>;

interface Props {
  room: RoomView;
  data: SabotageData;
  now: () => number;
  onCommit: (choice: SabotageChoice) => Promise<void>;
}

/** How long a sabotage can still be taken back before it goes out (the server's commit is final). */
export const SABOTAGE_UNDO_MS = 2000;
/** With less than this left of the window the sabotage goes out at once: an undo would eat the commit. */
const UNDO_MIN_REMAINING_MS = SABOTAGE_UNDO_MS + 1200;
/** Refusals that mean "this sabotage cannot go", not "something else is wrong". */
const SABOTAGE_REFUSALS = new Set(['SABOTAGE_LIMIT', 'TARGET_INVALID', 'POWER_UNAVAILABLE']);

/**
 * SABOTAGE_PICK on the phone (ADR-0022), its own timed screen: chip, faces, cards, send with a 2 s
 * undo (ADR-0010 flow), or "no sabotage". A player who cannot sabotage this round (no token, cooldown,
 * nobody to hit) gets a calm waiting screen and is not waited for.
 */
export function SabotageScreen({ room, data, now, onCommit }: Props) {
  const { t, td } = useI18n();
  const you = room.you;
  const decided = you?.sabotage?.decided === true;
  const [sabotage, setSabotage] = useState<SabotageChoice['sabotage']>(null);
  const [sheet, setSheet] = useState(false);
  // The sabotage was confirmed and is about to go out; "undo" is possible until it does.
  const [undoable, setUndoable] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const playersById = new Map(room.players.map((player) => [player.playerId, player]));
  /** Who a pick is aimed at, by name: a team (team play) or a player. */
  const aimName = (pick: {
    targetId?: string | undefined;
    targetTeamId?: Parameters<typeof teamName>[1] | undefined;
  }): string | undefined =>
    pick.targetTeamId
      ? teamName(room.settings, pick.targetTeamId, t)
      : playersById.get(pick.targetId ?? '')?.nickname;
  const latest = useRef(sabotage);
  latest.current = sabotage;

  const send = (choice: SabotageChoice['sabotage']): void => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setUndoable(false);
    setError(null);
    sfx.play('tap');
    onCommit({ sabotage: choice })
      .catch((cause: unknown) => {
        const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
        // A refused sabotage is dropped so another can be picked, or the player can pass.
        if (choice && SABOTAGE_REFUSALS.has(code)) setSabotage(null);
        setError(td(`error.${code}`));
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  // The undo window: the sabotage goes out by itself once it is over.
  useEffect(() => {
    if (!undoable) return undefined;
    const timer = window.setTimeout(() => send(latest.current), SABOTAGE_UNDO_MS);
    return () => window.clearTimeout(timer);
    // `send` only reads refs and stable setters; the timer must restart only with the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoable]);

  const confirmSabotage = (choice: NonNullable<SabotageChoice['sabotage']>): void => {
    setSabotage(choice);
    setSheet(false);
    latest.current = choice;
    const remaining = room.phaseDeadlineAt === null ? Infinity : room.phaseDeadlineAt - now();
    if (remaining < UNDO_MIN_REMAINING_MS) send(choice);
    else setUndoable(true);
  };

  const header = (
    <PickHeader
      room={room}
      data={data}
      now={now}
      title={t('tv.sabotage.title')}
      rule={t('ctl.sabotage.rule')}
      kind="sabotage"
    />
  );

  if (decided) {
    const committed = you?.commitment?.sabotage ?? null;
    const target = committed ? aimName(committed) : undefined;
    return (
      <div className={styles.screen} data-testid="ctl-sabotage">
        {header}
        <Panel className={styles.done} tone="glass" data-testid="ctl-sabotage-committed">
          <Sticker id="check" size={84} className={styles.doneIcon} />
          <div className={styles.doneTitle}>{t('ctl.prep.committed')}</div>
          <div className={styles.chips}>
            <span className={styles.chip}>
              {committed && target ? (
                <>
                  <PowerIcon id={SABOTAGE_STICKER[committed.effect]} size={30} />
                  {t('ctl.prep.sabotageTo', {
                    effect: td(`sabotage.${committed.effect}`),
                    name: target,
                  })}
                </>
              ) : (
                t('ctl.sabotage.none')
              )}
            </span>
          </div>
          <PickTicks done={data.committedCount} total={data.eligibleCount} />
        </Panel>
      </div>
    );
  }

  // Nothing to choose here: a calm screen that says why, and that the table is not waiting for us.
  if (!you || you.authorOfRound || sabotageState(you) !== null) {
    const why = you?.authorOfRound
      ? t('ctl.statement.mine')
      : sabotageState(you) === 'NO_TOKEN' || !you?.powers
        ? you?.powers?.nextTokenAtStreak
          ? t('ctl.prep.sabotage.noToken', { streak: you.powers.nextTokenAtStreak })
          : t('ctl.prep.sabotage.noTokenLeft')
        : t('ctl.sabotage.cannot');
    return (
      <div className={styles.screen} data-testid="ctl-sabotage">
        {header}
        <div className={styles.calm} data-testid="ctl-sabotage-wait">
          <Sticker id="hourglass" size={96} />
          <div className={styles.calmTitle}>{t('ctl.sabotage.waitTitle')}</div>
          <div className={styles.calmText}>{why}</div>
          <PickTicks done={data.committedCount} total={data.eligibleCount} />
        </div>
      </div>
    );
  }

  const chosenTarget = sabotage ? aimName(sabotage) : undefined;
  const tokens = you.powers?.sabotageTokens ?? 0;

  return (
    <div className={styles.screen} data-testid="ctl-sabotage">
      {header}

      {undoable && sabotage && chosenTarget ? (
        <div className={styles.going} role="status" data-testid="sabotage-going">
          <PowerIcon id={SABOTAGE_STICKER[sabotage.effect]} size={40} />
          <span className={styles.goingText}>
            {t('ctl.prep.sabotage.going', {
              effect: td(`sabotage.${sabotage.effect}`),
              name: chosenTarget,
            })}
          </span>
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              setUndoable(false);
              setSabotage(null);
            }}
            className={styles.undo}
            data-testid="sabotage-undo"
          >
            {t('ctl.prep.sabotage.undo')}
          </Button>
          <span
            className={styles.goingBar}
            style={{ animationDuration: `${SABOTAGE_UNDO_MS}ms` }}
            aria-hidden="true"
          />
        </div>
      ) : (
        <button
          type="button"
          className={cx(styles.sab, styles.sabBig, sabotage && styles.sabArmed)}
          onClick={() => {
            sfx.play('tap');
            setSheet(true);
          }}
          data-testid="prep-sabotage"
          data-focusable
        >
          <Sticker id="bomb" size={52} />
          <span className={styles.powerText}>
            <span className={styles.powerName}>{t('ctl.prep.sabotage')}</span>
            <span className={styles.powerHint}>
              {sabotage && chosenTarget
                ? t('ctl.prep.sabotageTo', {
                    effect: td(`sabotage.${sabotage.effect}`),
                    name: chosenTarget,
                  })
                : t('ctl.prep.sabotage.hint')}
            </span>
          </span>
          <span className={styles.tokens}>{t('ctl.prep.sabotage.tokens', { count: tokens })}</span>
        </button>
      )}

      {error ? (
        <div className={styles.error} role="alert" data-testid="prep-error">
          {error}
        </div>
      ) : null}

      <div className={styles.footer}>
        <Button
          size="xl"
          block
          variant="ghost"
          busy={sending}
          disabled={undoable}
          onClick={() => send(null)}
          data-testid="sabotage-skip"
        >
          {t('ctl.sabotage.skip')}
        </Button>
      </div>

      {sheet ? (
        <SabotageSheet
          players={sabotageTargets(room.players, you.playerId)}
          teams={isTeamGame(room) ? rivalTeams(room) : null}
          settings={room.settings}
          kinds={sabotageKinds(data)}
          cutRule={data.cutRule}
          scoreboard={room.game?.scoreboard ?? []}
          current={sabotage}
          onClose={() => setSheet(false)}
          onConfirm={confirmSabotage}
          onRemove={() => {
            setSabotage(null);
            setSheet(false);
          }}
        />
      ) : null}
    </div>
  );
}
