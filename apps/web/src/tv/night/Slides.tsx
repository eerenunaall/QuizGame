import type { ReactNode } from 'react';
import type { TvQuestion, TvRow, TvTeam } from '@quizparty/quiznight';
import { useI18n } from '../../lib/i18n';
import type { NightView } from './NightTv';
import styles from './night.module.css';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function TeamMark({ team, size = 64 }: { team: TvTeam | undefined; size?: number }) {
  return (
    <span
      className={styles.mark}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.58,
        background: team?.badge.color ?? '#555',
      }}
      aria-hidden="true"
    >
      {team?.badge.emoji}
    </span>
  );
}

const findTeam = (view: NightView, id: string): TvTeam | undefined =>
  view.teams.find((x) => x.id === id);

function Header({ view, extra }: { view: NightView; extra?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className={styles.header}>
      <span className={styles.pill}>
        {view.round
          ? t('qn.tvs.roundOf', { n: view.round.index + 1, count: view.round.count })
          : view.venueName}
      </span>
      <span className={styles.headerTitle}>{view.round?.title ?? view.title}</span>
      {extra}
    </header>
  );
}

function QuestionBody({
  view,
  question,
  reveal,
}: {
  view: NightView;
  question: TvQuestion;
  reveal: boolean;
}) {
  const { t } = useI18n();
  const correct = reveal && view.answer?.type === 'OPTION' ? view.answer.index : -1;
  return (
    <>
      <p className={reveal ? styles.questionSmall : styles.question} data-testid="night-question">
        {question.text}
      </p>
      {question.imageUrl ? <img className={styles.picture} src={question.imageUrl} alt="" /> : null}
      {question.options ? (
        <ul className={styles.options}>
          {question.options.map((option, i) => (
            <li
              key={i}
              className={
                i === correct ? styles.optionRight : reveal ? styles.optionDim : styles.option
              }
              data-testid={`night-option-${i}`}
            >
              <b>{LETTERS[i]}</b>
              <span>{option}</span>
            </li>
          ))}
        </ul>
      ) : question.trueFalse ? (
        <div className={styles.tf}>
          <div
            className={
              view.answer?.type === 'BOOL' && view.answer.value ? styles.optionRight : styles.option
            }
          >
            {t('qn.tvs.true')}
          </div>
          <div
            className={
              view.answer?.type === 'BOOL' && !view.answer.value
                ? styles.optionRight
                : styles.option
            }
          >
            {t('qn.tvs.false')}
          </div>
        </div>
      ) : question.estimate && !reveal ? (
        <p className={styles.hint}>{t('qn.tvs.estimateHint')}</p>
      ) : null}
    </>
  );
}

function AnswerBox({ view }: { view: NightView }) {
  const { t } = useI18n();
  const a = view.answer;
  if (!a || a.type === 'BOOL') return null;
  const text =
    a.type === 'TEXT'
      ? a.text
      : a.type === 'OPTION'
        ? a.text
        : `${a.value}${a.unit ? ` ${a.unit}` : ''}`;
  return (
    <div className={styles.answerBox} data-testid="night-answer">
      <small>{t('qn.tvs.answer')}</small>
      <strong>{text}</strong>
    </div>
  );
}

function Standings({ view, rows, compact }: { view: NightView; rows: TvRow[]; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <ol
      className={compact ? styles.standingsCompact : styles.standings}
      data-testid="night-standings"
    >
      {rows.slice(0, compact ? 6 : 8).map((row) => {
        const team = findTeam(view, row.teamId);
        const change = row.rankChange ?? 0;
        return (
          <li
            key={row.teamId}
            className={styles.standRow}
            data-testid={`night-stand-${row.teamId}`}
          >
            <b className={styles.rank}>{row.rank}</b>
            <TeamMark team={team} size={compact ? 52 : 68} />
            <span className={styles.teamName}>{team?.name}</span>
            <span className={change > 0 ? styles.up : change < 0 ? styles.down : styles.same}>
              {change > 0 ? `▲${change}` : change < 0 ? `▼${-change}` : '–'}
            </span>
            <small className={styles.jokers}>{t('qn.tvs.jokersLeft', { n: row.jokersLeft })}</small>
            <b className={styles.score}>{row.total}</b>
          </li>
        );
      })}
    </ol>
  );
}

function DoubledBanners({ view }: { view: NightView }) {
  const { t } = useI18n();
  if (view.doubled.length === 0) return null;
  return (
    <div className={styles.banners} data-testid="night-doubled">
      {view.doubled.map((id) => {
        const team = findTeam(view, id);
        return (
          <div key={id} className={styles.banner}>
            <TeamMark team={team} size={72} />
            <span>{t('qn.tvs.doubled', { team: team?.name ?? '' })}</span>
          </div>
        );
      })}
    </div>
  );
}

/** One TV slide of the quiz night. Everything shown here arrived in the allow-listed view (ADR-0029 §2). */
export function NightSlide({ view, secondsLeft }: { view: NightView; secondsLeft: number | null }) {
  const { t } = useI18n();
  const step = view.step;
  let body: ReactNode = null;

  switch (step) {
    case 'WAITING':
    case 'INTRO':
      body = (
        <div className={styles.centerColumn}>
          <p className={styles.kicker}>{view.venueName}</p>
          <h1 className={styles.hero}>{view.title}</h1>
          {view.entranceText ? (
            <p className={styles.bigPill}>{t('qn.tvs.entrance', { text: view.entranceText })}</p>
          ) : null}
          {view.prizeText ? (
            <p className={styles.bigPill}>{t('qn.tvs.prize', { text: view.prizeText })}</p>
          ) : null}
          {step === 'WAITING' ? <p className={styles.hint}>{t('qn.tvs.waiting')}</p> : null}
        </div>
      );
      break;
    case 'HOWTO':
      body = (
        <div className={styles.centerColumn}>
          <h1 className={styles.heading}>{t('qn.tvs.howto')}</h1>
          <ol className={styles.howto}>
            <li>{t('qn.tvs.howto1')}</li>
            <li>{t('qn.tvs.howto2')}</li>
            <li>{t('qn.tvs.howto3')}</li>
            <li>{t('qn.tvs.howto4', { n: view.jokersPerTeam })}</li>
          </ol>
        </div>
      );
      break;
    case 'ROUND_TITLE':
      body = (
        <div className={styles.centerColumn}>
          <p className={styles.kicker}>
            {view.round
              ? t('qn.tvs.roundOf', { n: view.round.index + 1, count: view.round.count })
              : ''}
          </p>
          <h1 className={styles.hero}>{view.round?.title}</h1>
          <p className={styles.hint}>{view.round ? t(`qn.round.kind.${view.round.kind}`) : ''}</p>
        </div>
      );
      break;
    case 'QUESTION':
    case 'TIE_QUESTION':
      body = view.question ? (
        <>
          <Header
            view={view}
            extra={
              <span className={styles.pill}>
                {step === 'TIE_QUESTION'
                  ? t('qn.tvs.tie')
                  : `${t('qn.tvs.questionOf', { n: view.question.number, total: view.question.total })} · ${t('qn.tvs.points', { n: view.question.points })}`}
              </span>
            }
          />
          <QuestionBody view={view} question={view.question} reveal={false} />
          {step === 'TIE_QUESTION' ? <p className={styles.hint}>{t('qn.tvs.tieHint')}</p> : null}
          {secondsLeft !== null ? (
            <div
              className={secondsLeft <= 5 ? styles.timerUrgent : styles.timer}
              data-testid="night-timer"
            >
              {secondsLeft}
            </div>
          ) : null}
          <DoubledBanners view={view} />
        </>
      ) : null;
      break;
    case 'LOCKED':
      body = (
        <div className={styles.centerColumn}>
          <h1 className={styles.hero} data-testid="night-pens-down">
            {t('qn.tvs.pensDown')}
          </h1>
          <p className={styles.penIcon} aria-hidden="true">
            ✏️
          </p>
        </div>
      );
      break;
    case 'SWAP':
      body = (
        <div className={styles.centerColumn}>
          <h1 className={styles.heading}>{t('qn.tvs.swap')}</h1>
          <ul className={styles.rotation} data-testid="night-rotation">
            {view.rotation.map((pair) => (
              <li key={pair.teamId}>
                {t('qn.tvs.swapLine', {
                  from: findTeam(view, pair.teamId)?.table ?? 0,
                  to: findTeam(view, pair.markerTeamId)?.table ?? 0,
                })}
              </li>
            ))}
          </ul>
        </div>
      );
      break;
    case 'ANSWER':
    case 'TIE_ANSWER':
      body = (
        <>
          {view.question ? (
            <>
              <Header
                view={view}
                extra={
                  <span className={styles.pill}>
                    {t('qn.tvs.questionOf', {
                      n: view.question.number,
                      total: view.question.total,
                    })}
                  </span>
                }
              />
              <QuestionBody view={view} question={view.question} reveal />
            </>
          ) : (
            <Header view={view} extra={<span className={styles.pill}>{t('qn.tvs.tie')}</span>} />
          )}
          <AnswerBox view={view} />
          {view.explanation ? <p className={styles.explanation}>{view.explanation}</p> : null}
          {view.tie ? (
            <ul className={styles.tieValues}>
              {view.tie.values.map((v) => (
                <li key={v.teamId}>
                  <TeamMark team={findTeam(view, v.teamId)} size={48} />{' '}
                  {findTeam(view, v.teamId)?.name}: <b>{v.value}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      );
      break;
    case 'FINAL_INTRO':
      body = view.final ? (
        <div className={styles.centerColumn} data-testid="night-final-intro">
          <p className={styles.kicker}>{t('qn.tvs.final')}</p>
          <h1 className={styles.hero}>
            {t('qn.tvs.finalCategory', { category: view.final.category })}
          </h1>
          <p className={styles.hint}>{t('qn.tvs.finalHint')}</p>
          <ul className={styles.finalLimits}>
            {view.final.limits.map((l) => (
              <li key={l.teamId}>
                <TeamMark team={findTeam(view, l.teamId)} size={44} />{' '}
                {findTeam(view, l.teamId)?.name}: <b>{t('qn.tvs.finalMax', { n: l.max })}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null;
      break;
    case 'FINAL_QUESTION':
    case 'FINAL_ANSWER':
      body = view.question ? (
        <>
          <header className={styles.header}>
            <span className={styles.pill}>{t('qn.tvs.final')}</span>
            <span className={styles.headerTitle}>{view.final?.category}</span>
          </header>
          <QuestionBody view={view} question={view.question} reveal={step === 'FINAL_ANSWER'} />
          {step === 'FINAL_ANSWER' ? (
            <>
              <AnswerBox view={view} />
              {view.explanation ? <p className={styles.explanation}>{view.explanation}</p> : null}
            </>
          ) : secondsLeft !== null ? (
            <div
              className={secondsLeft <= 5 ? styles.timerUrgent : styles.timer}
              data-testid="night-timer"
            >
              {secondsLeft}
            </div>
          ) : null}
        </>
      ) : null;
      break;
    case 'FINAL_REVEAL':
      body = view.final ? (
        <>
          <h1 className={styles.heading}>{t('qn.tvs.finalReveal')}</h1>
          <ol className={styles.standings} data-testid="night-final-reveal">
            {view.final.reveal.map((row, i) => {
              const team = findTeam(view, row.teamId);
              return (
                <li
                  key={row.teamId}
                  className={`${styles.standRow} ${styles.revealRow}`}
                  style={{ animationDelay: `${i * 0.9}s` }}
                  data-testid={`night-reveal-${row.teamId}`}
                >
                  <b className={styles.rank}>{row.rank}</b>
                  <TeamMark team={team} size={60} />
                  <span className={styles.teamName}>{team?.name}</span>
                  <small className={styles.jokers}>{t('qn.tvs.stake', { n: row.wager })}</small>
                  <span className={row.delta < 0 ? styles.down : styles.gain}>
                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </span>
                  <b className={styles.score}>{row.total}</b>
                </li>
              );
            })}
          </ol>
        </>
      ) : null;
      break;
    case 'MARKING':
      body = (
        <div className={styles.centerColumn}>
          <h1 className={styles.heading}>{t('qn.tvs.scoring')}</h1>
        </div>
      );
      break;
    case 'ROUND_SCORES':
      body = view.roundScores ? (
        <>
          <h1 className={styles.heading}>
            {t('qn.tvs.roundScores', { title: view.round?.title ?? '' })}
          </h1>
          <ol className={styles.standings} data-testid="night-round-scores">
            {view.roundScores.rows.map((row) => {
              const team = findTeam(view, row.teamId);
              return (
                <li key={row.teamId} className={styles.standRow}>
                  <b className={styles.rank}>{row.rank}</b>
                  <TeamMark team={team} size={60} />
                  <span className={styles.teamName}>{team?.name}</span>
                  <span className={styles.gain}>+{row.points}</span>
                  <b className={styles.score}>{row.total}</b>
                </li>
              );
            })}
          </ol>
          <ul className={styles.jokerPaid} data-testid="night-joker-paid">
            {view.roundScores.jokers.map((j, i) => (
              <li key={i}>
                {t('qn.tvs.jokerPaid', {
                  team: findTeam(view, j.teamId)?.name ?? '',
                  n: j.number,
                  gain: j.gain,
                })}
              </li>
            ))}
            {view.roundScores.estimateWinners.map((w) =>
              w.places.length > 1 ? (
                w.places.map((p) => (
                  <li key={`${w.number}-${p.place}`}>
                    {t('qn.tvs.place', {
                      n: p.place,
                      teams: p.teamIds.map((id) => findTeam(view, id)?.name ?? '').join(', '),
                      points: p.points,
                    })}
                  </li>
                ))
              ) : (
                <li key={w.number}>
                  {t('qn.tvs.closest', {
                    teams: w.teamIds.map((id) => findTeam(view, id)?.name ?? '').join(', '),
                  })}
                </li>
              ),
            )}
          </ul>
        </>
      ) : null;
      break;
    case 'STANDINGS':
      body = view.standings ? (
        <>
          <h1 className={styles.heading}>{t('qn.tvs.standings')}</h1>
          <Standings view={view} rows={view.standings} />
        </>
      ) : null;
      break;
    case 'HALF_TIME':
      body = (
        <>
          <h1 className={styles.hero} data-testid="night-halftime">
            {t('qn.tvs.halftime')}
          </h1>
          <p className={styles.hint}>{t('qn.tvs.halftimeHint')}</p>
          {view.standings ? <Standings view={view} rows={view.standings} compact /> : null}
        </>
      );
      break;
    case 'PODIUM':
      body = view.podium ? <Podium view={view} /> : null;
      break;
  }

  return (
    <div
      className={styles.safe}
      key={`${step}:${view.round?.index ?? ''}:${view.question?.number ?? ''}`}
    >
      {view.overlay === 'STANDINGS' && view.standings ? (
        <div className={styles.overlay} data-testid="night-overlay">
          <h1 className={styles.heading}>{t('qn.tvs.standings')}</h1>
          <Standings view={view} rows={view.standings} />
        </div>
      ) : (
        body
      )}
    </div>
  );
}

function Podium({ view }: { view: NightView }) {
  const { t } = useI18n();
  const places = view.podium ?? [];
  const winners = places.filter((p) => p.rank === 1);
  const order = [2, 1, 3];
  return (
    <div className={styles.podiumWrap} data-testid="night-podium">
      <h1 className={styles.heading}>{t('qn.tvs.podium')}</h1>
      <p className={styles.winner}>
        {t('qn.tvs.winner', {
          team: winners.map((w) => findTeam(view, w.teamId)?.name ?? '').join(' & '),
        })}
      </p>
      {view.consolation ? (
        <p className={styles.consolation} data-testid="night-consolation">
          {t('qn.tvs.consolation', {
            teams: view.consolation.teamIds.map((id) => findTeam(view, id)?.name ?? '').join(', '),
          })}
          : {view.consolation.text}
        </p>
      ) : null}
      <div className={styles.podium}>
        {order.map((rank) =>
          places
            .filter((p) => p.rank === rank)
            .map((p) => (
              <div key={p.teamId} className={styles[`podium${rank}`]}>
                <TeamMark team={findTeam(view, p.teamId)} size={rank === 1 ? 120 : 92} />
                <span className={styles.teamName}>{findTeam(view, p.teamId)?.name}</span>
                <b className={styles.score}>{p.total}</b>
              </div>
            )),
        )}
      </div>
    </div>
  );
}
