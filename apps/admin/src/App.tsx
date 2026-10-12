import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { go, useRoute } from './hooks';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { QuestionList } from './pages/QuestionList';
import { QuestionDetail } from './pages/QuestionDetail';
import { QuestionCreate } from './pages/QuestionCreate';
import { ImportExport } from './pages/ImportExport';
import { Queue } from './pages/Queue';
import { Reports } from './pages/Reports';
import { Categories } from './pages/Categories';
import { Rooms } from './pages/Rooms';
import { Bans } from './pages/Bans';
import { Flags } from './pages/Flags';
import { Incidents } from './pages/Incidents';
import { Security } from './pages/Security';
import { Users } from './pages/Users';
import { AuditLog } from './pages/AuditLog';
import { t } from './ui';

export interface Account {
  id: string;
  email: string;
  roles: string[];
}
const AccountContext = createContext<Account | null>(null);
export const useAccount = (): Account => {
  const account = useContext(AccountContext);
  if (!account) throw new Error('no signed-in account');
  return account;
};

const NAV = [
  ['dashboard', 'admin.nav.dashboard'],
  ['questions', 'admin.nav.questions'],
  ['import', 'admin.nav.import'],
  ['queue', 'admin.nav.queue'],
  ['reports', 'admin.nav.reports'],
  ['categories', 'admin.nav.categories'],
  ['rooms', 'admin.nav.rooms'],
  ['bans', 'admin.nav.bans'],
  ['flags', 'admin.nav.flags'],
  ['incidents', 'admin.nav.incidents'],
  ['security', 'admin.nav.security'],
  ['users', 'admin.nav.users'],
  ['audit', 'admin.nav.audit'],
] as const;

function Screen({ section, id }: { section: string; id: string | undefined }): ReactNode {
  switch (section) {
    case 'questions':
      if (id === 'new') return <QuestionCreate />;
      return id ? <QuestionDetail id={id} /> : <QuestionList />;
    case 'import':
      return <ImportExport />;
    case 'queue':
      return <Queue />;
    case 'reports':
      return <Reports />;
    case 'categories':
      return <Categories />;
    case 'rooms':
      return <Rooms />;
    case 'bans':
      return <Bans />;
    case 'flags':
      return <Flags />;
    case 'incidents':
      return <Incidents />;
    case 'security':
      return <Security />;
    case 'users':
      return <Users />;
    case 'audit':
      return <AuditLog />;
    default:
      return <Dashboard />;
  }
}

function Shell({ account, onSignOut }: { account: Account; onSignOut: () => void }): ReactNode {
  const route = useRoute();
  const section = route.segments[0] ?? 'dashboard';
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">{t('admin.title')}</div>
        <nav>
          {NAV.map(([path, key]) => (
            <a
              key={path}
              href={`#/${path}`}
              aria-current={section === path ? 'page' : undefined}
              data-testid={`nav-${path}`}
            >
              {t(key)}
            </a>
          ))}
        </nav>
        <div className="who">
          <div>{account.email}</div>
          <div>{account.roles.join(', ')}</div>
          <button data-testid="sign-out" onClick={onSignOut}>
            {t('admin.signOut')}
          </button>
        </div>
      </aside>
      <main>
        <Screen section={section} id={route.segments[1]} />
      </main>
    </div>
  );
}

/** Signed out → the sign-in form; signed in → the console. A 401 anywhere returns here. */
export function App(): ReactNode {
  const [state, setState] = useState<{ phase: 'loading' | 'out' | 'in'; account?: Account }>({
    phase: 'loading',
  });
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setExpired(true);
      setState({ phase: 'out' });
    });
    api<{ account: Account }>('/v1/me')
      .then(({ account }) => setState({ phase: 'in', account }))
      .catch(() => setState({ phase: 'out' }));
  }, []);

  if (state.phase === 'loading') return <p className="muted">…</p>;
  if (state.phase === 'out' || !state.account)
    return (
      <Login
        expired={expired}
        onSignedIn={(account) => {
          setExpired(false);
          go('dashboard');
          setState({ phase: 'in', account });
        }}
      />
    );
  return (
    <AccountContext.Provider value={state.account}>
      <Shell
        account={state.account}
        onSignOut={() => {
          void api('/v1/auth/logout', { method: 'POST', body: {} }).finally(() =>
            setState({ phase: 'out' }),
          );
        }}
      />
    </AccountContext.Provider>
  );
}
