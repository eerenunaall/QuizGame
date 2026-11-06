import Constants from 'expo-constants';
import { resolveAppConfig } from '../src/core/config';
import { parseAppLink, routeFor } from '../src/core/links';

/**
 * Every system-delivered URL (custom scheme, universal link, app link) passes through the strict
 * parser before the router sees it: anything that does not validate is sent to the not-found
 * screen instead of reaching a route (ADR-0017). Routes validate their params again.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path === '/' || path === '') return '/';
  const { webHosts } = resolveAppConfig(Constants.expoConfig?.extra);
  const link = parseAppLink(path, webHosts);
  return link ? routeFor(link) : '/+not-found';
}
