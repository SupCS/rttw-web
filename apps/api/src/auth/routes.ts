import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, AuthService } from './service.js';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  deviceName: z.string().trim().min(1).max(120).optional(),
}).strict();

const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(512),
}).strict();

const sessionParamsSchema = z.object({ sessionId: z.uuid() });

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,512})$/);
  return match?.[1];
}

function authFailure(error: unknown, reply: FastifyReply) {
  if (!(error instanceof AuthError)) throw error;
  if (error.code === 'email_in_use') return reply.code(409).send({ error: error.code });
  if (error.code === 'session_not_found') return reply.code(404).send({ error: error.code });
  return reply.code(401).send({ error: error.code });
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  app.post('/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const result = await auth.register(parsed.data.email, parsed.data.password, parsed.data.deviceName);
      return reply.header('cache-control', 'no-store').code(201).send(result);
    } catch (error) {
      return authFailure(error, reply);
    }
  });

  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const result = await auth.login(parsed.data.email, parsed.data.password, parsed.data.deviceName);
      return reply.header('cache-control', 'no-store').send(result);
    } catch (error) {
      return authFailure(error, reply);
    }
  });

  app.post('/auth/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const result = await auth.refresh(parsed.data.refreshToken);
      return reply.header('cache-control', 'no-store').send(result);
    } catch (error) {
      return authFailure(error, reply);
    }
  });

  app.get('/auth/me', async (request, reply) => {
    const token = bearerToken(request);
    if (!token) return reply.code(401).send({ error: 'invalid_session' });
    try {
      return reply.header('cache-control', 'no-store').send({ user: await auth.authenticate(token) });
    } catch (error) {
      return authFailure(error, reply);
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = bearerToken(request);
    if (!token) return reply.code(401).send({ error: 'invalid_session' });
    try {
      await auth.logout(token);
      return reply.code(204).send();
    } catch (error) {
      return authFailure(error, reply);
    }
  });

  app.get('/auth/sessions', async (request, reply) => {
    const token = bearerToken(request);
    if (!token) return reply.code(401).send({ error: 'invalid_session' });
    try {
      return reply.header('cache-control', 'no-store').send({ sessions: await auth.listSessions(token) });
    } catch (error) {
      return authFailure(error, reply);
    }
  });

  app.delete('/auth/sessions/:sessionId', async (request, reply) => {
    const token = bearerToken(request);
    if (!token) return reply.code(401).send({ error: 'invalid_session' });
    const parsed = sessionParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      await auth.revokeSession(token, parsed.data.sessionId);
      return reply.code(204).send();
    } catch (error) {
      return authFailure(error, reply);
    }
  });
}
