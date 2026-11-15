import type { FastifyInstance } from 'fastify';
import { apiError } from './routes';

const MAX_DEPTH = 64;

/** True when any string, key or nested value holds a NUL character, or the structure is absurdly deep. */
export function holdsNul(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((item) => holdsNul(item, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.entries(value).some(
      ([key, item]) => key.includes('\u0000') || holdsNul(item, depth + 1),
    );
  return false;
}

/**
 * PostgreSQL cannot store U+0000 in text, so a NUL anywhere in a query or body would surface as a
 * server error deep inside a handler. It never belongs in anything a person types: refuse it at the
 * door, for every route, before any handler or validator sees it.
 */
export function installInputHygiene(app: FastifyInstance): void {
  app.addHook('preValidation', (request, reply, done) => {
    if (holdsNul(request.query) || holdsNul(request.body)) {
      void apiError(reply, 400, 'INVALID_MESSAGE');
      return;
    }
    done();
  });
}
