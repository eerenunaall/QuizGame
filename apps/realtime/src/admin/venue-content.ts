import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import {
  VenueContentError,
  allVenueSets,
  retireVenueQuestion,
  retireVenueUpload,
  venueSetSummary,
} from '@quizparty/question-bank';
import type { AdminAudit } from './audit';
import { adminError, parse } from './common';
import { CAN } from './permissions';

export interface VenueContentAdminDeps {
  db: Database;
  audit: AdminAudit;
  now: () => number;
}

const SetParams = z.strictObject({ id: z.uuid() });
const UploadParams = z.strictObject({ id: z.uuid(), uploadId: z.uuid() });
const QuestionParams = z.strictObject({ id: z.uuid(), questionId: z.uuid() });

/**
 * Venue question sets in the admin console (ADR-0025 §5): see every venue's sets and counts, and take a
 * set or a single question out of play. Retiring is the only write; content is never edited here.
 */
export function registerVenueContentAdminRoutes(
  app: FastifyInstance,
  deps: VenueContentAdminDeps,
): void {
  const { db, audit } = deps;

  app.get(
    '/v1/admin/venue-content',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.venuesRead } },
    async () => ({ items: await allVenueSets(db) }),
  );

  app.get(
    '/v1/admin/venues/:id/questions',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.venuesRead } },
    async (request, reply) => {
      const params = parse(SetParams, request.params, reply);
      if (!params) return reply;
      return venueSetSummary(db, params.id);
    },
  );

  app.post(
    '/v1/admin/venues/:id/questions/uploads/:uploadId/retire',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.venuesWrite } },
    async (request, reply) => {
      const params = parse(UploadParams, request.params, reply);
      if (!params) return reply;
      try {
        const result = await retireVenueUpload(
          db,
          params.id,
          params.uploadId,
          { accountId: request.auth!.account.id, admin: true },
          new Date(deps.now()),
        );
        await audit.record(
          request,
          'venue.content.retire-upload',
          { type: 'venue', id: params.id },
          { uploadId: params.uploadId, retired: result.retired },
        );
        return result;
      } catch (error) {
        if (error instanceof VenueContentError)
          return adminError(reply, error.code === 'NOT_FOUND' ? 404 : 409, error.code);
        throw error;
      }
    },
  );

  app.post(
    '/v1/admin/venues/:id/questions/:questionId/retire',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.venuesWrite } },
    async (request, reply) => {
      const params = parse(QuestionParams, request.params, reply);
      if (!params) return reply;
      try {
        await retireVenueQuestion(
          db,
          params.id,
          params.questionId,
          { accountId: request.auth!.account.id, admin: true },
          new Date(deps.now()),
          'removed by an administrator',
        );
        await audit.record(
          request,
          'venue.content.retire-question',
          { type: 'venue', id: params.id },
          { questionId: params.questionId },
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof VenueContentError) return adminError(reply, 404, error.code);
        throw error;
      }
    },
  );
}
