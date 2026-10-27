import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeEmail } from '../auth/otp';
import { VenueError, type VenueService } from '../venue/service';
import type { AdminAudit } from './audit';
import { IdParams, adminError, parse } from './common';
import { CAN } from './permissions';

export interface VenueAdminDeps {
  venues: VenueService;
  audit: AdminAudit;
  now: () => number;
}

/** A real calendar date: `2026-02-31` has the right shape and made the report query fail with a 500. */
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((day) => {
    const at = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(day);
  });
const CSV_HEADER = 'date,sessions,minutes_sold,extensions,rewards_issued,rewards_redeemed';

/**
 * Venue mode in the admin console (ADR-0024 §7): create a venue with its owner, change the owner, and
 * read the per-day report (counts only, no player data) as JSON or CSV. Works whatever the
 * `venue.sessions` flag says, so a venue can be prepared before the switch is turned on.
 */
export function registerVenueAdminRoutes(app: FastifyInstance, deps: VenueAdminDeps): void {
  const { venues, audit } = deps;

  app.get(
    '/v1/admin/venues',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.venuesRead } },
    async () => ({ items: await venues.venues() }),
  );

  app.post(
    '/v1/admin/venues',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.venuesWrite } },
    async (request, reply) => {
      const body = parse(
        z.strictObject({ name: z.string().trim().min(1).max(80), ownerEmail: z.string().max(254) }),
        request.body,
        reply,
      );
      if (!body) return reply;
      const email = normalizeEmail(body.ownerEmail);
      if (!email) return adminError(reply, 400, 'INVALID_REQUEST', { fields: ['ownerEmail'] });
      const venue = await venues.createVenue(body.name, email, request.auth!.account.id);
      await audit.record(
        request,
        'venue.create',
        { type: 'venue', id: venue.id },
        { name: body.name },
      );
      return reply.code(201).send(venue);
    },
  );

  app.post(
    '/v1/admin/venues/:id/owner',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.venuesWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(z.strictObject({ email: z.string().max(254) }), request.body, reply)
        : null;
      if (!params || !body) return reply;
      const email = normalizeEmail(body.email);
      if (!email) return adminError(reply, 400, 'INVALID_REQUEST', { fields: ['email'] });
      try {
        const owner = await venues.setOwner(params.id, email, request.auth!.account.id);
        await audit.record(
          request,
          'venue.owner',
          { type: 'venue', id: params.id },
          {
            accountId: owner.accountId,
          },
        );
        return owner;
      } catch (error) {
        if (error instanceof VenueError) return adminError(reply, error.status, error.code);
        throw error;
      }
    },
  );

  app.get(
    '/v1/admin/venues/:id/report',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.venuesRead } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      // Missing dates default to the venue's own calendar (its time zone), not the server's UTC day.
      const query = params
        ? parse(
            z.strictObject({
              from: Day.optional(),
              to: Day.optional(),
              format: z.enum(['json', 'csv']).default('json'),
            }),
            request.query,
            reply,
          )
        : null;
      if (!params || !query) return reply;
      if (query.from && query.to && query.from > query.to)
        return adminError(reply, 400, 'INVALID_REQUEST', { fields: ['from'] });
      try {
        const report = await venues.report(params.id, { from: query.from, to: query.to });
        if (report.from > report.to)
          return adminError(reply, 400, 'INVALID_REQUEST', { fields: ['from'] });
        if (query.format === 'json') return report;
        void reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="venue-report-${report.from}-${report.to}.csv"`,
          );
        const lines = report.days.map((d) =>
          [
            d.date,
            d.sessions,
            d.minutesSold,
            d.extensions,
            d.rewardsIssued,
            d.rewardsRedeemed,
          ].join(','),
        );
        return [CSV_HEADER, ...lines].join('\n') + '\n';
      } catch (error) {
        if (error instanceof VenueError) return adminError(reply, error.status, error.code);
        throw error;
      }
    },
  );
}
