import type { FastifyInstance, FastifyReply } from 'fastify';
import { currencyMetadata } from '@rttw/domain';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authenticateWebRequest, assertWebMutation, webAuthFailure } from '../auth/web.js';
import { HouseholdError, HouseholdService } from './service.js';

const householdParams = z.object({ householdId: z.uuid() });
const householdInput = z.object({ name: z.string().trim().min(1).max(120), baseCurrency: z.enum(Object.keys(currencyMetadata) as [keyof typeof currencyMetadata, ...(keyof typeof currencyMetadata)[]]) }).strict();
function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof HouseholdError) return reply.code(error.statusCode).send({ error: error.code });
  return webAuthFailure(error, reply);
}

export function registerHouseholdRoutes(app: FastifyInstance, auth: AuthService, households: HouseholdService) {
  app.get('/api/web/households', async (request, reply) => {
    try { const user = await authenticateWebRequest(request, auth); return { households: await households.ensureFirst(user) }; }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/web/households', async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const parsed = householdInput.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return reply.code(201).send({ household: await households.create(user, parsed.data) });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/web/households/:householdId/settings', async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const params = householdParams.safeParse(request.params);
      const parsed = householdInput.safeParse(request.body);
      if (!params.success || !parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return { household: await households.settings(user, params.data.householdId, parsed.data) };
    } catch (error) { return failure(error, reply); }
  });
  app.get('/api/web/households/:householdId/members', async (request, reply) => {
    try {
      const user = await authenticateWebRequest(request, auth);
      const parsed = householdParams.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return { members: await households.members(user.id, parsed.data.householdId) };
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/web/households/:householdId/invitations', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const params = householdParams.safeParse(request.params);
      const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict().safeParse(request.body);
      if (!parsed.success || !params.success) return reply.code(400).send({ error: 'invalid_request' });
      return reply.code(201).send({ invitation: await households.invite(user, params.data.householdId, parsed.data.email) });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/web/households/invitations/:token/accept', async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,512}$/) }).safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      return { household: await households.accept(user, parsed.data.token) };
    } catch (error) { return failure(error, reply); }
  });
}
