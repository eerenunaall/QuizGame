import { useState } from 'react';
import { useNavigate } from '../lib/router';
import { parseRoomCode } from '@quizparty/shared';
import { Button } from '../ui/Button';
import { Wordmark } from '../ui/Wordmark';
import { useI18n } from '../lib/i18n';
import styles from './CodeEntry.module.css';

/** The phone's front door: type the 6-character room code shown on the TV. */
export function CodeEntry() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = parseRoomCode(value);
  return (
    <form
      className={styles.screen}
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (parsed) navigate(`/join/${parsed}`);
      }}
    >
      <Wordmark scale={0.62} />
      <div className={styles.card}>
        <label htmlFor="room-code" className={styles.label}>
          {t('landing.join.hint')}
        </label>
        <input
          id="room-code"
          className={styles.input}
          value={value}
          placeholder={t('landing.codePlaceholder')}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={6}
          inputMode="text"
          onChange={(event) => {
            setValue(event.target.value.toUpperCase());
            setTouched(false);
          }}
          data-testid="code-input"
        />
        <div className={styles.hint} role="alert">
          {touched && !parsed ? t('landing.codeInvalid') : ''}
        </div>
        <Button type="submit" size="lg" block disabled={value.length < 6} data-testid="code-submit">
          {t('landing.join')}
        </Button>
      </div>
      <a className={styles.tvLink} href="/tv">
        {t('landing.startOnTv')}
      </a>
    </form>
  );
}
