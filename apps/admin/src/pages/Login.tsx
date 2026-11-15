import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '../api';
import type { Account } from '../App';
import { ErrorNote, t, useAction } from '../ui';

function refusal(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403 && error.code === 'FORBIDDEN') return t('admin.login.notStaff');
    if (error.status === 429) return t('admin.login.throttled');
    if (error.status === 404) return t('admin.login.disabled');
    if (error.status === 400) return t('admin.login.invalidEmail');
  }
  return t('admin.login.refused');
}

export function Login({
  expired,
  onSignedIn,
}: {
  expired: boolean;
  onSignedIn: (account: Account) => void;
}): ReactNode {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const action = useAction();

  const request = (event: FormEvent): void => {
    event.preventDefault();
    setMessage(null);
    void action.run(async () => {
      try {
        await api('/v1/auth/email/request', { method: 'POST', body: { email, locale: 'tr' } });
        setSent(true);
      } catch (error) {
        setMessage(refusal(error));
      }
    });
  };
  const verify = (event: FormEvent): void => {
    event.preventDefault();
    setMessage(null);
    void action.run(async () => {
      try {
        const { account } = await api<{ account: Account }>('/v1/auth/email/verify', {
          method: 'POST',
          body: { email, code, client: 'ADMIN' },
        });
        onSignedIn(account);
      } catch (error) {
        setMessage(refusal(error));
      }
    });
  };

  return (
    <div className="login card">
      <h1>{t('admin.login.title')}</h1>
      {expired ? <p className="note error">{t('admin.session.expired')}</p> : null}
      <p className="muted">{t('admin.login.intro')}</p>
      {sent ? (
        <form className="stack" onSubmit={verify}>
          <p className="note ok">{t('admin.login.sent')}</p>
          <label>
            {t('admin.login.code')}
            <input
              data-testid="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/gu, ''))}
              required
            />
          </label>
          <ErrorNote message={message} />
          <button
            className="primary"
            data-testid="login-verify"
            disabled={action.busy || code.length !== 6}
          >
            {t('admin.login.verify')}
          </button>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setCode('');
              setMessage(null);
            }}
          >
            {t('admin.login.changeEmail')}
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={request}>
          <label>
            {t('admin.login.email')}
            <input
              data-testid="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <ErrorNote message={message} />
          <button className="primary" data-testid="login-send" disabled={action.busy}>
            {t('admin.login.sendCode')}
          </button>
        </form>
      )}
    </div>
  );
}
