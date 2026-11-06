import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, HostRound, HostView, LogEvent } from '@quizparty/quiznight';
import { Button } from '../../ui/Button';
import { useI18n } from '../../lib/i18n';
import { nightsApi, type NightDetail } from './api';
import { useNightError } from './QuizNightTab';
import styles from './quiznight.module.css';

const MARKING_KINDS = new Set(['SWAP', 'ANSWER', 'MARKING', 'ROUND_SCORES']);

/**
 * Sunum: the owner's tablet as the remote (ADR-0029). One big NEXT, everything else is secondary. The
 * server is the only judge: every tap is a command, and the screen shows what the server answers.
 */
export function Present({
  venueId,
  night,
  onChanged,
}: {
  venueId: string;
  night: NightDetail;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const describe = useNightError();
  const [host, setHost] = useState<HostView>(night.host);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewRound, setViewRound] = useState<number | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [prize, setPrize] = useState<{ code: string; teamName: string; text: string } | null>(null);
  const [log, setLog] = useState<LogEvent[] | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (inFlight.current) return;
      nightsApi.state(venueId, night.id).then(
        (r) => setHost((cur) => (r.host.seq >= cur.seq ? r.host : cur)),
        () => undefined,
      );
    }, 1500);
    return () => clearInterval(timer);
  }, [venueId, night.id]);

  const send = useCallback(
    async (cmd: Command, withSeq = false): Promise<void> => {
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const r = await nightsApi.command(venueId, night.id, cmd, withSeq ? host.seq : undefined);
        setHost(r.host);
        if (cmd.type === 'START' || cmd.type === 'CLOSE') onChanged();
      } catch (e) {
        setError(describe(e));
        // The tablet may be out of date (another tablet, a double tap): fetch the truth.
        void nightsApi.state(venueId, night.id).then(
          (r) => setHost(r.host),
          () => undefined,
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [venueId, night.id, host.seq, describe, onChanged],
  );

  const teamOf = (id: string) => host.teams.find((x) => x.id === id);
  const step = host.step;
  const roundIdx =
    viewRound ??
    (step?.round !== undefined
      ? step.round
      : Math.max(
          0,
          host.rounds.findLastIndex((r) => r.scored),
        ));
  const round: HostRound | undefined = host.rounds[roundIdx];
  const current =
    step && step.round !== undefined && step.q !== undefined
      ? host.rounds[step.round]?.questions[step.q]
      : undefined;
  const showMarking =
    host.started &&
    round !== undefined &&
    (step === null || MARKING_KINDS.has(step.kind) || viewRound !== null || host.podiumReached);

  async function makeLink(): Promise<void> {
    try {
      setLink((await nightsApi.link(venueId, night.id)).url);
    } catch (e) {
      setError(describe(e));
    }
  }
  async function giveReward(teamId?: string): Promise<void> {
    try {
      setPrize(await nightsApi.reward(venueId, night.id, teamId));
      onChanged();
    } catch (e) {
      setError(describe(e));
    }
  }

  const tvBlock = (
    <section className={styles.card} data-testid="qn-tvlink">
      <h3 className={styles.h3}>{t('qn.tv')}</h3>
      <p className={styles.muted}>{t('qn.tv.hint')}</p>
      {link ? (
        <input
          className={styles.linkBox}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          data-testid="qn-link"
        />
      ) : null}
      <div className={styles.row}>
        <Button
          size="md"
          variant="violet"
          onClick={() => void makeLink()}
          data-testid="qn-make-link"
        >
          {t('qn.tv.make')}
        </Button>
        <Button
          size="md"
          variant="ghost"
          onClick={() => {
            setLink(null);
            void nightsApi.revoke(venueId, night.id);
          }}
        >
          {t('qn.tv.revoke')}
        </Button>
      </div>
    </section>
  );

  if (!host.started)
    return (
      <div data-testid="qn-present">
        {night.status === 'DRAFT' ? <p className={styles.error}>{t('qn.err.NOT_READY')}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        <Button
          size="xl"
          block
          disabled={night.status !== 'READY' || busy}
          onClick={() => void send({ type: 'START' })}
          data-testid="qn-start"
        >
          {t('qn.start')}
        </Button>
        {tvBlock}
      </div>
    );

  const next = host.nextStep;
  const jokerQ = host.nextQuestion;

  return (
    <div data-testid="qn-present">
      <div className={styles.statusBar}>
        <strong data-testid="qn-step">{step ? t(`qn.step.${step.kind}`) : ''}</strong>
        <span>{t('qn.progress', { n: host.cursor + 1, total: host.stepCount })}</span>
        {host.paused ? <span className={styles.statusPAUSED}>{t('qn.pause')}</span> : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {current ? (
        <section className={styles.card} data-testid="qn-current">
          <span className={styles.secret}>{t('qn.onlyYou')}</span>
          <p className={styles.bigText}>{current.text}</p>
          {step?.kind === 'ANSWER' || step?.kind === 'QUESTION' ? (
            <p className={styles.answerLine}>{t('qn.answerIs', { text: current.answerText })}</p>
          ) : null}
          {current.explanation ? <p className={styles.muted}>{current.explanation}</p> : null}
        </section>
      ) : null}

      {step?.kind === 'SWAP' ? (
        <section className={styles.card} data-testid="qn-rotation">
          {host.rotation.map((pair) => (
            <div key={pair.teamId} className={styles.rotationRow}>
              {t('qn.mark.rotation', {
                from: teamOf(pair.teamId)?.table ?? 0,
                to: teamOf(pair.markerTeamId)?.table ?? 0,
              })}
            </div>
          ))}
        </section>
      ) : null}

      <div className={styles.controls}>
        <Button
          size="xl"
          block
          disabled={busy || !next || host.closed}
          onClick={() => void send({ type: 'NEXT' }, true)}
          data-testid="qn-next"
          className={styles.nextButton}
        >
          {host.closed || !next ? t('qn.end') : t('qn.next')}
        </Button>
        {next && !host.closed ? (
          <p className={styles.nextHint}>{t('qn.nextIs', { step: t(`qn.step.${next.kind}`) })}</p>
        ) : null}
        <div className={styles.row}>
          <Button
            size="md"
            variant="ghost"
            disabled={busy || host.closed}
            onClick={() => void send({ type: 'BACK' })}
            data-testid="qn-back"
          >
            {t('qn.back')}
          </Button>
          <Button
            size="md"
            variant="ghost"
            disabled={busy || host.closed}
            onClick={() => void send({ type: host.paused ? 'RESUME' : 'PAUSE' })}
            data-testid="qn-pause"
          >
            {host.paused ? t('qn.resume') : t('qn.pause')}
          </Button>
          <Button
            size="md"
            variant="ghost"
            disabled={busy || host.closed || host.rounds.every((r) => !r.scored)}
            onClick={() => void send({ type: host.overlay ? 'HIDE_OVERLAY' : 'SHOW_STANDINGS' })}
            data-testid="qn-standings"
          >
            {host.overlay ? t('qn.hideStandings') : t('qn.standings')}
          </Button>
        </div>
        {step?.kind === 'QUESTION' || step?.kind === 'TIE_QUESTION' ? (
          <div className={styles.row} data-testid="qn-timer">
            {[30, 60, 90].map((n) => (
              <Button
                key={n}
                size="md"
                variant={n === host.timerSeconds ? 'violet' : 'ghost'}
                onClick={() => void send({ type: 'TIMER_START', seconds: n })}
              >
                {t('qn.timer.n', { n })}
              </Button>
            ))}
            {host.timer ? (
              <strong>{t('qn.timer.left', { n: Math.ceil(host.timer.remainingMs / 1000) })}</strong>
            ) : null}
          </div>
        ) : null}
      </div>

      {jokerQ && !host.closed ? (
        <section className={styles.card} data-testid="qn-joker">
          <h3 className={styles.h3}>
            {t('qn.joker.title', {
              round: host.rounds[jokerQ.roundIndex]?.title ?? '',
              n: jokerQ.number,
            })}
          </h3>
          <p className={styles.muted}>
            {jokerQ.eligible ? t('qn.joker.hint') : t('qn.joker.notAllowed')}
          </p>
          {jokerQ.eligible ? (
            <div className={styles.chips}>
              {host.teams.map((team) => {
                const on = jokerQ.doubled.includes(team.id);
                const none = !on && team.jokersLeft === 0;
                return (
                  <button
                    key={team.id}
                    type="button"
                    disabled={busy || none}
                    className={on ? styles.chipOn : styles.chip}
                    onClick={() =>
                      void send({
                        type: 'JOKER',
                        questionId: jokerQ.questionId,
                        teamId: team.id,
                        on: !on,
                      })
                    }
                    data-testid={`qn-joker-${team.id}`}
                  >
                    <span aria-hidden="true">{team.badge.emoji}</span> {team.name}
                    <small>
                      {' '}
                      {team.jokersLeft > 0
                        ? t('qn.joker.left', { n: team.jokersLeft })
                        : t('qn.joker.none')}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {host.tie && (step?.kind === 'TIE_QUESTION' || step?.kind === 'TIE_ANSWER') ? (
        <section className={styles.card} data-testid="qn-tie">
          <h3 className={styles.h3}>{t('qn.tie.enter')}</h3>
          <span className={styles.secret}>{t('qn.onlyYou')}</span>
          <p>{t('qn.answerIs', { text: host.tie.answerText })}</p>
          {host.teams.map((team) => (
            <NumberRow
              key={team.id}
              label={`${team.badge.emoji} ${team.name}`}
              value={host.tie!.values[team.id]}
              onCommit={(value) =>
                void send({
                  type: 'ESTIMATE_VALUE',
                  questionId: 'tie-break',
                  teamId: team.id,
                  value,
                })
              }
            />
          ))}
        </section>
      ) : null}

      {showMarking && round ? (
        <section className={styles.card} data-testid="qn-marking">
          <h3 className={styles.h3}>{t('qn.mark.title')}</h3>
          <div className={styles.chips}>
            {host.rounds.map((r) => (
              <button
                key={r.id}
                type="button"
                className={r.index === roundIdx ? styles.chipOn : styles.chip}
                onClick={() => setViewRound(r.index)}
              >
                {r.title}
              </button>
            ))}
          </div>
          {round.countAvailable ? (
            <div className={styles.row}>
              {(['GRID', 'COUNT'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={round.mode === mode ? styles.chipOn : styles.chip}
                  onClick={() => void send({ type: 'MARKING_MODE', roundId: round.id, mode })}
                  data-testid={`qn-mode-${mode}`}
                >
                  {t(mode === 'GRID' ? 'qn.mark.grid' : 'qn.mark.count')}
                </button>
              ))}
            </div>
          ) : null}
          {round.mode === 'COUNT' ? <p className={styles.muted}>{t('qn.mark.countHint')}</p> : null}
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <thead>
                <tr>
                  <th />
                  {round.mode === 'COUNT' ? <th>{round.plainCount}</th> : null}
                  {round.questions
                    .filter(
                      (q) =>
                        round.mode === 'GRID' ||
                        q.estimate ||
                        q.doubled.length > 0 ||
                        round.kind === 'BONUS',
                    )
                    .map((q) => (
                      <th key={q.id}>{q.number}</th>
                    ))}
                  <th>Σ</th>
                </tr>
              </thead>
              <tbody>
                {host.teams.map((team) => (
                  <tr key={team.id} data-testid={`qn-row-${team.id}`}>
                    <th scope="row">
                      <span aria-hidden="true">{team.badge.emoji}</span> {team.name}
                    </th>
                    {round.mode === 'COUNT' ? (
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={round.plainCount}
                          className={styles.countInput}
                          value={round.counts[team.id] ?? ''}
                          onChange={(e) =>
                            void send({
                              type: 'MARK_COUNT',
                              roundId: round.id,
                              teamId: team.id,
                              count: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          data-testid={`qn-count-${team.id}`}
                        />
                      </td>
                    ) : null}
                    {round.questions
                      .filter(
                        (q) =>
                          round.mode === 'GRID' ||
                          q.estimate ||
                          q.doubled.length > 0 ||
                          round.kind === 'BONUS',
                      )
                      .map((q) =>
                        q.estimate ? (
                          <td key={q.id}>
                            <NumberRow
                              compact
                              label={q.answerText}
                              value={q.estimates[team.id]}
                              onCommit={(value) =>
                                void send({
                                  type: 'ESTIMATE_VALUE',
                                  questionId: q.id,
                                  teamId: team.id,
                                  value,
                                })
                              }
                              testId={`qn-est-${q.id}-${team.id}`}
                            />
                          </td>
                        ) : (
                          <td key={q.id}>
                            <button
                              type="button"
                              className={q.marks[team.id] ? styles.cellOn : styles.cell}
                              aria-pressed={q.marks[team.id] === true}
                              onClick={() =>
                                void send({
                                  type: 'MARK',
                                  questionId: q.id,
                                  teamId: team.id,
                                  right: q.marks[team.id] !== true,
                                })
                              }
                              data-testid={`qn-cell-${q.id}-${team.id}`}
                            >
                              {q.marks[team.id]
                                ? q.doubled.includes(team.id)
                                  ? '✓ 2x'
                                  : '✓'
                                : q.doubled.includes(team.id)
                                  ? '2x'
                                  : '·'}
                            </button>
                          </td>
                        ),
                      )}
                    <td className={styles.total} data-testid={`qn-pts-${team.id}`}>
                      {round.result?.points[team.id] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className={styles.card} data-testid="qn-standings-panel">
        <h3 className={styles.h3}>{t('qn.step.STANDINGS')}</h3>
        {host.standings.map((row) => {
          const team = teamOf(row.teamId);
          return (
            <div key={row.teamId} className={styles.standRow}>
              <strong>{row.rank}</strong>
              <span>
                {team?.badge.emoji} {team?.name}
              </span>
              <span className={styles.total}>{row.total}</span>
              <small>{t('qn.joker.left', { n: row.jokersLeft })}</small>
            </div>
          );
        })}
      </section>

      {host.podiumReached ? (
        <section className={styles.card} data-testid="qn-prize">
          <h3 className={styles.h3}>{t('qn.prize')}</h3>
          {night.reward || prize ? (
            <p>{t('qn.prize.given')}</p>
          ) : (
            <>
              {host.winnerTeamIds.length === 1 ? (
                <p>{t('qn.prize.winner', { team: teamOf(host.winnerTeamIds[0]!)?.name ?? '' })}</p>
              ) : (
                <p>{t('qn.prize.pick')}</p>
              )}
              <div className={styles.row}>
                {host.winnerTeamIds.map((id) => (
                  <Button
                    key={id}
                    size="lg"
                    onClick={() => void giveReward(host.winnerTeamIds.length > 1 ? id : undefined)}
                    data-testid={`qn-give-${id}`}
                  >
                    {t('qn.prize')}: {teamOf(id)?.name}
                  </Button>
                ))}
              </div>
            </>
          )}
          {prize ? (
            <div className={styles.prizeCode} data-testid="qn-prize-code">
              <small>{t('qn.prize.code')}</small>
              <strong>{prize.code}</strong>
              <span>
                {prize.teamName}: {prize.text}
              </span>
              <p className={styles.muted}>{t('qn.prize.hint')}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {tvBlock}

      <section className={styles.card}>
        <Button
          size="md"
          variant="ghost"
          onClick={() =>
            void nightsApi.log(venueId, night.id).then(
              (r) => setLog(r.events),
              (e: unknown) => setError(describe(e)),
            )
          }
          data-testid="qn-log-show"
        >
          {t('qn.log.show')}
        </Button>
        {log ? (
          <ol className={styles.log} data-testid="qn-log">
            {log.map((event) => (
              <li key={event.seq}>
                #{event.seq} {new Date(event.at).toLocaleTimeString()} · {event.cmd.type}
                {'questionId' in event.cmd ? ` ${event.cmd.questionId}` : ''}
                {event.prev !== null && event.prev !== undefined
                  ? ` (${t('qn.log.prev', { v: JSON.stringify(event.prev) })})`
                  : ''}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}

/** A number the host types for a team (estimate guesses): sent when the field loses focus or Enter is pressed. */
function NumberRow({
  label,
  value,
  onCommit,
  compact,
  testId,
}: {
  label: string;
  value: number | undefined;
  onCommit: (value: number | null) => void;
  compact?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setText(value === undefined ? '' : String(value));
  }, [value]);
  const commit = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (value !== undefined) onCommit(null);
      return;
    }
    const n = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <label className={compact ? undefined : styles.field}>
      {compact ? null : <span>{label}</span>}
      <input
        type="text"
        inputMode="decimal"
        className={compact ? styles.countInput : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        data-testid={testId}
      />
    </label>
  );
}
