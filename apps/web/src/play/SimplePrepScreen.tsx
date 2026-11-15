import { useState } from 'react';
import type { PhaseDataOf, RoomView, SabotageKind, TeamId } from '@quizparty/protocol';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { PowerIcon } from '../ui/PowerIcon';
import { Sticker } from '../ui/Sticker';
import { TeamBadge } from '../ui/TeamBadge';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import { teamName } from '../lib/teams';
import { PickHeader, PickTicks } from './PickParts';
import {
  JOKER_STICKER,
  SABOTAGE_STICKER,
  defaultStake,
  isTeamGame,
  prepHasWork,
  prepNeeds,
  rivalTeams,
  sabotageKinds,
  sabotageTargets,
  type RiskChoice,
  type SabotageChoice,
} from './powers';
import styles from './PickScreen.module.css';
import simple from './SimplePrep.module.css';
import { cx } from '../lib/cx';

type PrepData = PhaseDataOf<'RISK_PICK'>;
type Aim = { targetId: string } | { targetTeamId: TeamId };

interface Props {
  room: RoomView;
  data: PrepData;
  now: () => number;
  onCommitRisk: (choice: RiskChoice) => Promise<void>;
  onCommitSabotage: (choice: SabotageChoice) => Promise<void>;
}

/** Refusals that mean "this sabotage cannot go", not "something else is wrong". */
const SABOTAGE_REFUSALS = new Set(['SABOTAGE_LIMIT', 'TARGET_INVALID', 'POWER_UNAVAILABLE']);

/**
 * The simple ruleset's only prep screen (ADR-0026 §3): Double Down as one big switch, the sabotage as
 * three big cards and a rival (a team in team play), and one big DONE. No ladder, no undo window and no
 * second screen: a player who has nothing to use gets a calm screen and is never waited for. The two
 * commits (`COMMIT_RISK`, `COMMIT_SABOTAGE`) go out one after the other from the one button.
 */
export function SimplePrepScreen({ room, data, now, onCommitRisk, onCommitSabotage }: Props) {
  const { t, td } = useI18n();
  const you = room.you;
  const needs = prepNeeds(you);
  const [doubleDown, setDoubleDown] = useState(false);
  const [effect, setEffect] = useState<SabotageKind | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teams = isTeamGame(room);
  const playersById = new Map(room.players.map((player) => [player.playerId, player]));

  const header = (
    <PickHeader
      room={room}
      data={data}
      now={now}
      title={t('ctl.simple.title')}
      rule={t('ctl.simple.rule')}
      kind="risk"
    />
  );

  const aimName = (pick: { targetId?: string | undefined; targetTeamId?: TeamId | undefined }) =>
    pick.targetTeamId
      ? teamName(room.settings, pick.targetTeamId, t)
      : (playersById.get(pick.targetId ?? '')?.nickname ?? '');

  // Nothing (more) to decide: what was decided, or a calm screen that says nothing is expected of us.
  if (!you || you.authorOfRound || !(needs.risk || needs.sabotage)) {
    const decided = prepHasWork(you) && !you?.authorOfRound;
    const committed = you?.commitment ?? null;
    return (
      <div className={styles.screen} data-testid="ctl-simple">
        {header}
        {decided ? (
          <Panel className={styles.done} tone="glass" data-testid="ctl-simple-done">
            <Sticker id="check" size={84} className={styles.doneIcon} />
            <div className={styles.doneTitle}>{t('ctl.simple.ready')}</div>
            <div className={styles.chips}>
              {committed?.doubleDown ? (
                <span className={styles.chip}>
                  <Sticker id={JOKER_STICKER.DOUBLE_DOWN} size={30} />
                  {t('ctl.simple.dd.on')}
                </span>
              ) : null}
              {committed?.sabotage ? (
                <span className={styles.chip}>
                  <PowerIcon id={SABOTAGE_STICKER[committed.sabotage.effect]} size={30} />
                  {t('ctl.prep.sabotageTo', {
                    effect: td(`sabotage.${committed.sabotage.effect}`),
                    name: aimName(committed.sabotage),
                  })}
                </span>
              ) : null}
            </div>
            <PickTicks done={data.committedCount} total={data.eligibleCount} />
          </Panel>
        ) : (
          <div className={styles.calm} data-testid="ctl-simple-wait">
            <Sticker id="hourglass" size={96} />
            <div className={styles.calmTitle}>{t('ctl.simple.waiting')}</div>
            <div className={styles.calmText}>
              {you?.authorOfRound ? t('ctl.statement.mine') : t('ctl.simple.nothing')}
            </div>
            <PickTicks done={data.committedCount} total={data.eligibleCount} />
          </div>
        )}
      </div>
    );
  }

  const kinds = sabotageKinds(data);
  const armed = needs.sabotage && effect !== null && aim !== null;
  const tokens = you.powers?.sabotageTokens ?? 0;
  const ddLeft = you.powers?.doubleDown ?? 0;

  const send = (): void => {
    if (sending) return;
    setSending(true);
    setError(null);
    sfx.play('tap');
    void (async () => {
      try {
        if (needs.risk) await onCommitRisk({ stake: defaultStake(data), doubleDown });
        if (needs.sabotage)
          await onCommitSabotage({
            sabotage: armed ? { ...aim, effect } : null,
          });
      } catch (cause) {
        const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
        // A refused sabotage is dropped so another can be picked, or the player can go without.
        if (SABOTAGE_REFUSALS.has(code)) {
          setEffect(null);
          setAim(null);
        }
        setError(td(`error.${code}`));
      } finally {
        setSending(false);
      }
    })();
  };

  return (
    <div className={styles.screen} data-testid="ctl-simple">
      {header}

      {needs.risk ? (
        <button
          type="button"
          className={cx(styles.power, doubleDown && styles.powerOn)}
          onClick={() => {
            sfx.play('tap');
            setDoubleDown(!doubleDown);
          }}
          aria-pressed={doubleDown}
          data-testid="simple-dd"
          data-focusable
        >
          <Sticker id={JOKER_STICKER.DOUBLE_DOWN} size={52} />
          <span className={styles.powerText}>
            <span className={styles.powerName}>{td('joker.DOUBLE_DOWN')}</span>
            <span className={styles.powerHint}>{t('ctl.simple.dd.hint')}</span>
          </span>
          <span className={styles.powerCount}>
            {doubleDown ? t('ctl.simple.dd.on') : t('ctl.prep.left', { count: ddLeft })}
          </span>
        </button>
      ) : null}

      {needs.sabotage ? (
        <div className={simple.sabotage} data-testid="simple-sabotage">
          <div className={simple.sectionTitle}>
            <span>{t('ctl.simple.sab.title')}</span>
            <span className={styles.tokens}>{t('ctl.simple.hasToken', { count: tokens })}</span>
          </div>
          <div className={simple.effects} role="radiogroup" aria-label={t('ctl.simple.sab.title')}>
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={effect === kind}
                className={cx(simple.effect, effect === kind && simple.effectOn)}
                onClick={() => {
                  sfx.play('tap');
                  setEffect(effect === kind ? null : kind);
                }}
                data-testid={`simple-effect-${kind}`}
                data-focusable
              >
                <PowerIcon id={SABOTAGE_STICKER[kind]} size={44} />
                <span className={simple.effectText}>
                  <span className={simple.effectName}>{td(`sabotage.${kind}`)}</span>
                  <span className={simple.effectDesc}>{td(`sabotage.${kind}.desc`)}</span>
                </span>
              </button>
            ))}
          </div>
          {effect ? (
            <>
              <div className={simple.sectionTitle}>
                <span>{teams ? t('ctl.simple.sab.pickTeam') : t('ctl.simple.sab.pickPlayer')}</span>
              </div>
              <div className={simple.aims} role="radiogroup" data-testid="simple-aims">
                {teams
                  ? rivalTeams(room).map((teamId) => (
                      <button
                        key={teamId}
                        type="button"
                        role="radio"
                        aria-checked={
                          aim !== null && 'targetTeamId' in aim && aim.targetTeamId === teamId
                        }
                        className={cx(
                          simple.aim,
                          aim !== null &&
                            'targetTeamId' in aim &&
                            aim.targetTeamId === teamId &&
                            simple.aimOn,
                        )}
                        onClick={() => {
                          sfx.play('tap');
                          setAim({ targetTeamId: teamId });
                        }}
                        data-testid={`simple-aim-${teamId}`}
                        data-focusable
                      >
                        <TeamBadge teamId={teamId} settings={room.settings} size={44} />
                      </button>
                    ))
                  : sabotageTargets(room.players, you.playerId).map((player) => (
                      <button
                        key={player.playerId}
                        type="button"
                        role="radio"
                        aria-checked={
                          aim !== null && 'targetId' in aim && aim.targetId === player.playerId
                        }
                        className={cx(
                          simple.aim,
                          aim !== null &&
                            'targetId' in aim &&
                            aim.targetId === player.playerId &&
                            simple.aimOn,
                        )}
                        onClick={() => {
                          sfx.play('tap');
                          setAim({ targetId: player.playerId });
                        }}
                        data-testid={`simple-aim-${player.nickname}`}
                        data-focusable
                      >
                        <Avatar avatarId={player.avatarId} size={44} colorSlot={player.colorSlot} />
                        <span className={simple.aimName}>{player.nickname}</span>
                      </button>
                    ))}
              </div>
              {teams ? <div className={simple.hint}>{t('teams.target.hint')}</div> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className={styles.error} role="alert" data-testid="prep-error">
          {error}
        </div>
      ) : null}

      <div className={styles.footer}>
        <Button
          size="xl"
          block
          busy={sending}
          // A sabotage that is half picked (a card without a rival) is not sent as "none" by accident.
          disabled={needs.sabotage && effect !== null && aim === null}
          onClick={send}
          data-testid="simple-done"
        >
          {t('ctl.simple.done')}
        </Button>
      </div>
    </div>
  );
}
