import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { useCategories } from '../categories';
import { go } from '../hooks';
import { ErrorNote, label, t, useAction } from '../ui';

export function QuestionCreate(): ReactNode {
  const categories = useCategories();
  const [text, setText] = useState('');
  const [explanation, setExplanation] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correct, setCorrect] = useState(0);
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('MEDIUM');
  const [sourceUrl, setSourceUrl] = useState('');
  const action = useAction();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void action.run(async () => {
      const result = await api<{ item: { questionId?: string } }>('/v1/admin/questions', {
        method: 'POST',
        body: {
          question: {
            language: 'tr',
            category: category || categories.data?.items[0]?.id,
            difficulty,
            question: text,
            options,
            correctIndex: correct,
            authorType: 'HUMAN',
            ...(explanation ? { explanation } : {}),
            ...(sourceUrl ? { sources: [{ url: sourceUrl }] } : {}),
          },
        },
      });
      if (result.item.questionId) go(`questions/${result.item.questionId}`);
      return t('admin.create.created');
    });
  };

  return (
    <form className="stack card" onSubmit={submit}>
      <h1>{t('admin.create.title')}</h1>
      <p className="muted">{t('admin.create.hint')}</p>
      <label>
        {t('admin.editor.text')}
        <textarea
          data-testid="create-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="row">
        <label>
          {t('admin.questions.category')}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {(categories.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelTr}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.questions.difficulty')}
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {['EASY', 'MEDIUM', 'HARD', 'EXPERT'].map((d) => (
              <option key={d} value={d}>
                {label('admin.difficulty', d)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>{t('admin.editor.options')}</legend>
        {options.map((option, index) => (
          <div className="option-row" key={index}>
            <input
              type="radio"
              name="correct"
              aria-label={t('admin.editor.correct')}
              checked={correct === index}
              onChange={() => setCorrect(index)}
            />
            <input
              data-testid={`create-option-${index}`}
              aria-label={t('admin.editor.optionN', { n: index + 1 })}
              value={option}
              onChange={(e) =>
                setOptions(options.map((o, i) => (i === index ? e.target.value : o)))
              }
            />
            {options.length > 2 ? (
              <button
                type="button"
                onClick={() => {
                  setOptions(options.filter((_, i) => i !== index));
                  setCorrect(0);
                }}
              >
                {t('admin.remove')}
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {options.length < 6 ? (
          <button type="button" onClick={() => setOptions([...options, ''])}>
            {t('admin.editor.addOption')}
          </button>
        ) : null}
      </fieldset>
      <label>
        {t('admin.editor.explanation')}
        <input value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </label>
      <label>
        {t('admin.editor.sourceUrl')}
        <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      </label>
      <ErrorNote message={action.error} />
      <button className="primary" data-testid="create-submit" disabled={action.busy}>
        {t('admin.save')}
      </button>
    </form>
  );
}
