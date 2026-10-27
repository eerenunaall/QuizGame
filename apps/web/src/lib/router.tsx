import {
  useEffect,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

/**
 * A deliberately tiny router (history API only). The app has five routes and one parameter; a
 * full routing library would be ~70 KB of JavaScript that low-end TV browsers must parse before the
 * first paint.
 */
export interface RouteDef {
  /** `/join/:code?` — `:name` is a required segment, `:name?` an optional one. */
  path: string;
  render: (params: Record<string, string>) => ReactNode;
}

/** Returns the parameters when `pathname` matches `pattern`, otherwise null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index++) {
    const part = patternParts[index]!;
    const value = pathParts[index];
    if (part === '*') return params;
    if (part.startsWith(':')) {
      const optional = part.endsWith('?');
      const name = part.slice(1, optional ? -1 : undefined);
      if (value === undefined) {
        if (optional) continue;
        return null;
      }
      params[name] = safeDecode(value);
      continue;
    }
    if (part !== value) return null;
  }
  return pathParts.length > patternParts.length ? null : params;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const NAVIGATE_EVENT = 'qp:navigate';

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

const snapshot = (): string => `${window.location.pathname}${window.location.search}`;

export function useLocation(): { pathname: string; search: string } {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const queryAt = value.indexOf('?');
  return queryAt === -1
    ? { pathname: value, search: '' }
    : { pathname: value.slice(0, queryAt), search: value.slice(queryAt) };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function useNavigate(): typeof navigate {
  return navigate;
}

export function Router({ routes, notFound }: { routes: readonly RouteDef[]; notFound: ReactNode }) {
  const { pathname } = useLocation();
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params) return <>{route.render(params)}</>;
  }
  return <>{notFound}</>;
}

/** Redirects on mount (replaces the history entry). */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

export function Link({
  to,
  onClick,
  ...rest
}: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey
        )
          return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}
