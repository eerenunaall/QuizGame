import { useEffect, useState } from 'react';
import {
  ROUND_KINDS,
  blankQuestion,
  blankRound,
  teamBadge,
  type QuestionDef,
  type QuizConfig,
  type RoundDef,
  type RoundKind,
} from '@quizparty/quiznight';
import { Button } from '../../ui/Button';
import { useI18n } from '../../lib/i18n';
import { venueApi } from '../api';
import { nightsApi, type NightDetail, type PoolQuestion } from './api';
import { useNightError } from './QuizNightTab';
import styles from './quiznight.module.css';

let counter = 0;
const uid = (): string =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Keeps a question's answer type in step with its round (an estimate round has number answers, and so on). */
function coerce(q: QuestionDef, kind: RoundKind): QuestionDef {
  const next = { ...q };
  if (kind === 'ESTIMATE') {
    if (next.answer.type !== 'NUMBER') next.answer = { type: 'NUMBER', value: 0 };
    delete next.options;
    next.jokerAllowed = false;
  } else if (kind === 'TRUE_FALSE') {
    if (next.answer.type !== 'BOOL') next.answer = { type: 'BOOL', value: true };
    delete next.options;
  } else if (next.answer.type === 'NUMBER' || next.answer.type === 'BOOL') {
    next.answer = { type: 'TEXT', text: '' };
  }
  if (kind === 'BONUS') next.jokerAllowed = false;
  return next;
}

function withoutOptions(q: QuestionDef): QuestionDef {
  const rest = { ...q };
  delete rest.options;
  return { ...rest, answer: { type: 'TEXT', text: '' } };
}

function QuestionEditor({
  q,
  kind,
  index,
  onChange,
  onMove,
  onRemove,
}: {
  q: QuestionDef;
  kind: RoundKind;
  index: number;
  onChange: (q: QuestionDef) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const multi = q.options !== undefined;
  const set = (patch: Partial<QuestionDef>): void => onChange({ ...q, ...patch });
  return (
    <div className={styles.question} data-testid={`qn-q-${q.id}`}>
      <div className={styles.rowBetween}>
        <strong>{t('qn.question.n', { n: index + 1 })}</strong>
        <span className={styles.row}>
          <button
            type="button"
            className={styles.mini}
            onClick={() => onMove(-1)}
            aria-label={t('qn.question.up')}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.mini}
            onClick={() => onMove(1)}
            aria-label={t('qn.question.down')}
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.mini}
            onClick={onRemove}
            aria-label={t('qn.question.remove')}
          >
            ✕
          </button>
        </span>
      </div>
      <label className={styles.field}>
        <span>{t('qn.question.text')}</span>
        <textarea
          value={q.text}
          maxLength={600}
          rows={2}
          onChange={(e) => set({ text: e.target.value })}
          data-testid={`qn-q-text-${q.id}`}
        />
      </label>
      {kind === 'PICTURE' ? (
        <label className={styles.field}>
          <span>{t('qn.question.image')}</span>
          <input
            value={q.imageUrl ?? ''}
            maxLength={500}
            onChange={(e) => set({ imageUrl: e.target.value })}
          />
        </label>
      ) : null}
      {q.answer.type === 'NUMBER' ? (
        <div className={styles.row}>
          <label className={styles.field}>
            <span>{t('qn.question.number')}</span>
            <input
              type="number"
              value={q.answer.value}
              onChange={(e) =>
                set({ answer: { ...q.answer, type: 'NUMBER', value: Number(e.target.value) } })
              }
              data-testid={`qn-q-number-${q.id}`}
            />
          </label>
          <label className={styles.field}>
            <span>{t('qn.question.unit')}</span>
            <input
              value={q.answer.unit ?? ''}
              maxLength={20}
              onChange={(e) =>
                set({
                  answer: {
                    type: 'NUMBER',
                    value: (q.answer as { value: number }).value,
                    unit: e.target.value,
                  },
                })
              }
            />
          </label>
        </div>
      ) : q.answer.type === 'BOOL' ? (
        <div className={styles.row}>
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              className={
                q.answer.type === 'BOOL' && q.answer.value === v ? styles.chipOn : styles.chip
              }
              onClick={() => set({ answer: { type: 'BOOL', value: v } })}
            >
              {t(v ? 'qn.answer.true' : 'qn.answer.false')}
            </button>
          ))}
        </div>
      ) : (
        <>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={multi}
              onChange={(e) =>
                e.target.checked
                  ? set({ options: ['', '', '', ''], answer: { type: 'OPTION', index: 0 } })
                  : onChange(coerce(withoutOptions(q), kind))
              }
            />
            {t('qn.question.multi')}
          </label>
          {multi ? (
            q.options!.map((option, i) => (
              <div key={i} className={styles.row}>
                <input
                  type="radio"
                  name={`correct-${q.id}`}
                  checked={q.answer.type === 'OPTION' && q.answer.index === i}
                  onChange={() => set({ answer: { type: 'OPTION', index: i } })}
                  aria-label={t('qn.question.answer')}
                />
                <input
                  className={styles.grow}
                  value={option}
                  maxLength={200}
                  placeholder={t('qn.question.option', { n: i + 1 })}
                  onChange={(e) =>
                    set({ options: q.options!.map((o, j) => (j === i ? e.target.value : o)) })
                  }
                  data-testid={`qn-q-option-${q.id}-${i}`}
                />
              </div>
            ))
          ) : (
            <label className={styles.field}>
              <span>{t('qn.question.answer')}</span>
              <input
                value={q.answer.type === 'TEXT' ? q.answer.text : ''}
                maxLength={300}
                onChange={(e) => set({ answer: { type: 'TEXT', text: e.target.value } })}
                data-testid={`qn-q-answer-${q.id}`}
              />
            </label>
          )}
        </>
      )}
      <label className={styles.field}>
        <span>{t('qn.question.explanation')}</span>
        <input
          value={q.explanation ?? ''}
          maxLength={600}
          onChange={(e) => set({ explanation: e.target.value })}
        />
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{t('qn.question.points')}</span>
          <input
            type="number"
            min={0}
            max={100}
            value={q.points}
            onChange={(e) =>
              set({ points: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
            }
            data-testid={`qn-q-points-${q.id}`}
          />
        </label>
        {kind !== 'ESTIMATE' ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={q.jokerAllowed}
              onChange={(e) => set({ jokerAllowed: e.target.checked })}
            />
            {t('qn.question.joker')}
          </label>
        ) : null}
      </div>
    </div>
  );
}

function PoolPicker({
  venueId,
  onAdd,
  onClose,
}: {
  venueId: string;
  onAdd: (items: PoolQuestion[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<PoolQuestion[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => {
    void nightsApi.pool(venueId).then(setItems);
  }, [venueId]);
  return (
    <div className={styles.card} data-testid="qn-pool">
      {items && items.length === 0 ? <p className={styles.muted}>{t('qn.pool.empty')}</p> : null}
      {items?.slice(0, 300).map((item, i) => (
        <label key={i} className={styles.check}>
          <input
            type="checkbox"
            checked={picked.has(i)}
            onChange={(e) => {
              const next = new Set(picked);
              if (e.target.checked) next.add(i);
              else next.delete(i);
              setPicked(next);
            }}
          />
          {item.question}
        </label>
      ))}
      <div className={styles.row}>
        <Button
          size="md"
          onClick={() => onAdd([...picked].map((i) => items![i]!))}
          disabled={picked.size === 0}
        >
          {t('qn.pool.add')}
        </Button>
        <Button size="md" variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  );
}

/** Hazırlık: everything the host sets up before the night (ADR-0029 §1). */
export function Prepare({
  venueId,
  night,
  onSaved,
  onGoPresent,
}: {
  venueId: string;
  night: NightDetail;
  onSaved: (night: NightDetail) => void;
  onGoPresent: () => void;
}) {
  const { t } = useI18n();
  const describe = useNightError();
  const [config, setConfig] = useState<QuizConfig>(() => clone(night.config));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [teamName, setTeamName] = useState('');
  const [suggest, setSuggest] = useState<string[]>([]);
  const [poolFor, setPoolFor] = useState<number | null>(null);
  const locked = night.status === 'LIVE' || night.status === 'FINISHED';

  useEffect(() => {
    void venueApi.settings(venueId).then(
      (r) => setSuggest(r.settings.play?.teamNames ?? []),
      () => undefined,
    );
  }, [venueId]);

  const edit = (fn: (draft: QuizConfig) => void): void => {
    setConfig((current) => {
      const draft = clone(current);
      fn(draft);
      return draft;
    });
    setMessage(null);
  };
  const addTeam = (name: string): void => {
    if (!name.trim()) return;
    edit((d) => {
      const index = d.teams.length;
      d.teams.push({
        id: uid(),
        name: name.trim().slice(0, 40),
        badge: teamBadge(index),
        table: index + 1,
      });
    });
    setTeamName('');
  };
  const setRound = (r: number, fn: (round: RoundDef) => void): void =>
    edit((d) => fn(d.rounds[r]!));

  async function save(): Promise<void> {
    try {
      const { night: fresh } = await nightsApi.saveConfig(venueId, night.id, config);
      setMessage({ kind: 'ok', text: t('qn.saved') });
      onSaved(fresh);
    } catch (e) {
      setMessage({ kind: 'error', text: describe(e) });
    }
  }

  return (
    <div data-testid="qn-prepare">
      {locked ? <p className={styles.error}>{t('qn.err.CONFIG_LOCKED')}</p> : null}
      <fieldset disabled={locked} className={styles.fieldset}>
        <section className={styles.card}>
          <h3 className={styles.h3}>{t('qn.basics')}</h3>
          <label className={styles.field}>
            <span>{t('qn.new.title')}</span>
            <input
              value={config.title}
              maxLength={80}
              onChange={(e) => edit((d) => void (d.title = e.target.value))}
              data-testid="qn-title"
            />
          </label>
          <label className={styles.field}>
            <span>{t('qn.new.date')}</span>
            <input
              type="date"
              value={config.date}
              onChange={(e) => edit((d) => void (d.date = e.target.value))}
            />
          </label>
          <label className={styles.field}>
            <span>{t('qn.field.entrance')}</span>
            <input
              value={config.settings.entranceText}
              maxLength={120}
              onChange={(e) => edit((d) => void (d.settings.entranceText = e.target.value))}
              data-testid="qn-entrance"
            />
          </label>
          <label className={styles.field}>
            <span>{t('qn.field.prize')}</span>
            <input
              value={config.settings.prizeText}
              maxLength={160}
              onChange={(e) => edit((d) => void (d.settings.prizeText = e.target.value))}
              data-testid="qn-prize-text"
            />
          </label>
        </section>

        <section className={styles.card}>
          <h3 className={styles.h3}>{t('qn.teams')}</h3>
          {config.teams.map((team, i) => (
            <div key={team.id} className={styles.row} data-testid={`qn-team-${i}`}>
              <span
                className={styles.badge}
                style={{ background: team.badge.color }}
                aria-hidden="true"
              >
                {team.badge.emoji}
              </span>
              <input
                className={styles.grow}
                value={team.name}
                maxLength={40}
                aria-label={t('qn.team.name')}
                onChange={(e) => edit((d) => void (d.teams[i]!.name = e.target.value))}
              />
              <input
                className={styles.narrow}
                type="number"
                min={1}
                value={team.table}
                aria-label={t('qn.team.table', { n: team.table })}
                onChange={(e) =>
                  edit((d) => void (d.teams[i]!.table = Math.max(1, Number(e.target.value) || 1)))
                }
              />
              <button
                type="button"
                className={styles.mini}
                onClick={() => edit((d) => void d.teams.splice(i, 1))}
                aria-label={t('qn.team.remove')}
              >
                ✕
              </button>
            </div>
          ))}
          <div className={styles.row}>
            <input
              className={styles.grow}
              value={teamName}
              maxLength={40}
              placeholder={t('qn.team.name')}
              onChange={(e) => setTeamName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTeam(teamName);
              }}
              data-testid="qn-team-input"
            />
            <Button size="md" onClick={() => addTeam(teamName)} data-testid="qn-team-add">
              {t('qn.team.add')}
            </Button>
          </div>
          {suggest.length > 0 ? (
            <div className={styles.row}>
              {suggest
                .filter((name) => !config.teams.some((x) => x.name === name))
                .map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={styles.chip}
                    onClick={() => addTeam(name)}
                    title={t('qn.team.suggest')}
                  >
                    + {name}
                  </button>
                ))}
            </div>
          ) : null}
        </section>

        {config.rounds.map((round, r) => (
          <section key={round.id} className={styles.card} data-testid={`qn-round-${r}`}>
            <div className={styles.rowBetween}>
              <h3 className={styles.h3}>{round.title || t('qn.round', { n: r + 1 })}</h3>
              <button
                type="button"
                className={styles.mini}
                onClick={() => edit((d) => void d.rounds.splice(r, 1))}
                aria-label={t('qn.round.remove')}
              >
                ✕
              </button>
            </div>
            <label className={styles.field}>
              <span>{t('qn.round.title')}</span>
              <input
                value={round.title}
                maxLength={80}
                onChange={(e) => setRound(r, (x) => void (x.title = e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span>{t('qn.round.kind')}</span>
              <select
                value={round.kind}
                onChange={(e) =>
                  setRound(r, (x) => {
                    x.kind = e.target.value as RoundKind;
                    x.questions = x.questions.map((q) => coerce(q, x.kind));
                  })
                }
              >
                {ROUND_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`qn.round.kind.${kind}`)}
                  </option>
                ))}
              </select>
            </label>
            {round.questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                q={q}
                kind={round.kind}
                index={i}
                onChange={(next) => setRound(r, (x) => void (x.questions[i] = next))}
                onMove={(delta) =>
                  setRound(r, (x) => {
                    const j = i + delta;
                    if (j < 0 || j >= x.questions.length) return;
                    [x.questions[i], x.questions[j]] = [x.questions[j]!, x.questions[i]!];
                  })
                }
                onRemove={() => setRound(r, (x) => void x.questions.splice(i, 1))}
              />
            ))}
            <div className={styles.row}>
              <Button
                size="md"
                variant="violet"
                onClick={() =>
                  setRound(r, (x) =>
                    x.questions.push(
                      coerce(blankQuestion(uid(), round.kind === 'BONUS' ? 2 : 1), round.kind),
                    ),
                  )
                }
                data-testid={`qn-add-question-${r}`}
              >
                {t('qn.question.add')}
              </Button>
              <Button
                size="md"
                variant="ghost"
                onClick={() => setPoolFor(poolFor === r ? null : r)}
              >
                {t('qn.pool')}
              </Button>
            </div>
            {poolFor === r ? (
              <PoolPicker
                venueId={venueId}
                onClose={() => setPoolFor(null)}
                onAdd={(items) => {
                  setRound(r, (x) => {
                    for (const item of items)
                      x.questions.push(
                        coerce(
                          {
                            id: uid(),
                            text: item.question,
                            options: item.options,
                            answer: { type: 'OPTION', index: item.correctIndex },
                            ...(item.explanation ? { explanation: item.explanation } : {}),
                            points: 1,
                            jokerAllowed: true,
                          },
                          x.kind,
                        ),
                      );
                  });
                  setPoolFor(null);
                }}
              />
            ) : null}
          </section>
        ))}
        <Button
          size="md"
          variant="violet"
          block
          onClick={() =>
            edit(
              (d) =>
                void d.rounds.push(
                  blankRound(uid(), t('qn.round', { n: d.rounds.length + 1 }), 'NORMAL', [
                    blankQuestion(uid()),
                  ]),
                ),
            )
          }
          data-testid="qn-add-round"
        >
          {t('qn.round.add')}
        </Button>

        <section className={styles.card}>
          <h3 className={styles.h3}>{t('qn.tie')}</h3>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={config.tieBreak !== null}
              onChange={(e) =>
                edit((d) => {
                  d.tieBreak = e.target.checked
                    ? {
                        id: 'tie-break',
                        text: '',
                        answer: { type: 'NUMBER', value: 0 },
                        points: 0,
                        jokerAllowed: false,
                      }
                    : null;
                })
              }
            />
            {t('qn.tie.on')}
          </label>
          {config.tieBreak ? (
            <QuestionEditor
              q={config.tieBreak}
              kind="ESTIMATE"
              index={0}
              onChange={(next) =>
                edit((d) => void (d.tieBreak = { ...next, id: 'tie-break', points: 0 }))
              }
              onMove={() => undefined}
              onRemove={() => edit((d) => void (d.tieBreak = null))}
            />
          ) : null}
        </section>

        <section className={styles.card}>
          <h3 className={styles.h3}>{t('qn.settings')}</h3>
          <label className={styles.field}>
            <span>{t('qn.set.jokers')}</span>
            <input
              type="number"
              min={0}
              max={10}
              value={config.settings.jokersPerTeam}
              onChange={(e) =>
                edit(
                  (d) =>
                    void (d.settings.jokersPerTeam = Math.max(
                      0,
                      Math.min(10, Number(e.target.value) || 0),
                    )),
                )
              }
              data-testid="qn-jokers"
            />
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={config.settings.wrongDoublePenalty}
              onChange={(e) => edit((d) => void (d.settings.wrongDoublePenalty = e.target.checked))}
            />
            {t('qn.set.penalty')}
          </label>
          <label className={styles.field}>
            <span>{t('qn.set.timer')}</span>
            <select
              value={config.settings.timerSec}
              onChange={(e) =>
                edit((d) => void (d.settings.timerSec = Number(e.target.value) as 30 | 60 | 90))
              }
            >
              {[30, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {t('qn.timer.n', { n })}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('qn.set.half')}</span>
            <input
              type="number"
              min={0}
              max={20}
              value={config.settings.halfTimeAfterRound}
              onChange={(e) =>
                edit(
                  (d) =>
                    void (d.settings.halfTimeAfterRound = Math.max(
                      0,
                      Math.min(20, Number(e.target.value) || 0),
                    )),
                )
              }
            />
          </label>
        </section>
      </fieldset>

      <section className={styles.card}>
        {night.issues.length > 0 ? (
          <>
            <h3 className={styles.h3}>{t('qn.issues')}</h3>
            <ul className={styles.issues} data-testid="qn-issues">
              {[...new Set(night.issues.map((x) => x.issue))].map((issue) => (
                <li key={issue}>{t(`qn.issue.${issue}` as 'qn.issue.NO_ROUNDS')}</li>
              ))}
            </ul>
          </>
        ) : (
          <p data-testid="qn-ready">{t('qn.ready')}</p>
        )}
        {message ? (
          <p className={message.kind === 'ok' ? styles.ok : styles.error} role="status">
            {message.text}
          </p>
        ) : null}
        <div className={styles.row}>
          <Button size="lg" onClick={() => void save()} disabled={locked} data-testid="qn-save">
            {t('qn.save')}
          </Button>
          <Button
            size="lg"
            variant="violet"
            onClick={onGoPresent}
            disabled={night.status === 'DRAFT'}
            data-testid="qn-go-present"
          >
            {t('qn.tab.present')}
          </Button>
        </div>
      </section>
    </div>
  );
}
