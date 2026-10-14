import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { assertWebMutation, authenticateWebRequest, webAuthFailure } from '../auth/web.js';
import { dateSchema } from './schemas.js';
import { LedgerError, LedgerService } from './service.js';

const query = z.object({ householdId: z.uuid(), throughDate: dateSchema.optional() }).strict();
const mutation = z.object({ householdId: z.uuid(), command: z.unknown(), requestId: z.uuid().optional() }).strict();
const restore = z.object({ householdId: z.uuid(), backup: z.unknown() }).strict();
function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof LedgerError) return reply.code(error.statusCode).send({ error: error.code });
  return webAuthFailure(error, reply);
}

export function registerLedgerRoutes(app: FastifyInstance, auth: AuthService, ledger: LedgerService) {
  app.get('/api/ledger', async (request, reply) => {
    try {
      const user = await authenticateWebRequest(request, auth);
      const parsed = query.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return reply.header('cache-control', 'no-store').send(await ledger.getSnapshot(user.id, parsed.data.householdId, parsed.data.throughDate));
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/ledger/commands', async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const parsed = mutation.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return reply.header('cache-control', 'no-store').send(await ledger.execute(user.id, parsed.data.householdId, parsed.data.command, parsed.data.requestId));
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/ledger/backup', async (request, reply) => {
    try {
      const user = await authenticateWebRequest(request, auth);
      const parsed = query.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      const backup = await ledger.exportBackup(user.id, parsed.data.householdId);
      return reply.header('cache-control', 'no-store').header('content-disposition', 'attachment; filename="wealthy-backup.json"').send(backup);
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/ledger/restore', { bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const parsed = restore.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return reply.header('cache-control', 'no-store').send(await ledger.restoreBackup(user.id, parsed.data.householdId, parsed.data.backup));
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/ledger/backup/preview', { bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const parsed = restore.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return reply.header('cache-control', 'no-store').send(await ledger.previewBackup(user.id, parsed.data.householdId, parsed.data.backup));
    } catch (error) { return failure(error, reply); }
  });
}
