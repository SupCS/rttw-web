import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthenticatedSession } from './repository.js';
import { AuthError, AuthService, type AuthResult } from './service.js';

export class WebRequestError extends Error {
  constructor(readonly code: string, readonly statusCode: number) { super(code); }
}

type WebSecurityOptions = { origins: ReadonlySet<string>; secureCookies: boolean };
const security = new WeakMap<FastifyRequest, WebSecurityOptions>();
const accessCookie = 'rttw_access';
const refreshCookie = 'rttw_refresh';
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  deviceName: z.string().trim().min(1).max(120).optional(),
}).strict();

export function configureWebSecurity(app: FastifyInstance, options: { origin?: string; secureCookies?: boolean } = {}) {
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const configured = options.origin ?? process.env.WEB_ORIGIN;
  if (secureCookies && !configured) throw new Error('WEB_ORIGIN is required for production web authentication');
  let origins: Set<string>;
  if (configured) {
    const url = new URL(configured);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (secureCookies ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))) {
      throw new Error('WEB_ORIGIN must be a trusted web origin');
    }
    origins = new Set([url.origin]);
  } else {
    origins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173']);
  }
  app.addHook('onRequest', async (request, reply) => {
    security.set(request, { origins, secureCookies });
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });
}

function assertOrigin(request: FastifyRequest, required: boolean) {
  const options = security.get(request);
  if (!options) throw new Error('Web security is not configured');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new WebRequestError('forbidden_origin', 403);
  const origin = request.headers.origin;
  if ((required && !origin) || (origin && !options.origins.has(origin))) {
    throw new WebRequestError('forbidden_origin', 403);
  }
}

export function assertWebMutation(request: FastifyRequest): void {
  if (request.headers['x-rttw-request'] !== 'web') throw new WebRequestError('invalid_web_request', 403);
  assertOrigin(request, true);
}

function cookieToken(request: FastifyRequest, name: string): string | undefined {
  const parts = request.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
  const matches = parts.filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0]?.slice(name.length + 1);
  return token && /^[A-Za-z0-9_-]{32,512}$/.test(token) ? token : undefined;
}

export async function authenticateWebRequest(request: FastifyRequest, auth: AuthService): Promise<AuthenticatedSession> {
  assertOrigin(request, false);
  const token = cookieToken(request, accessCookie);
  if (!token) throw new AuthError('invalid_session');
  return auth.authenticateSession(token);
}

function setCookies(reply: FastifyReply, request: FastifyRequest, result?: AuthResult) {
  const secure = security.get(request)?.secureCookies ? '; Secure' : '';
  const flags = `; Path=/api; HttpOnly; SameSite=Lax${secure}`;
  const cookie = (name: string, token?: string, expiry?: string) => `${name}=${token ?? ''}${flags}; Max-Age=${expiry ? Math.max(0, Math.floor((Date.parse(expiry) - Date.now()) / 1_000)) : 0}`;
  reply.header('set-cookie', [
    cookie(accessCookie, result?.session.accessToken, result?.session.accessTokenExpiresAt),
    cookie(refreshCookie, result?.session.refreshToken, result?.session.refreshTokenExpiresAt),
  ]);
}

export function webAuthFailure(error: unknown, reply: FastifyReply) {
  if (error instanceof WebRequestError) return reply.code(error.statusCode).send({ error: error.code });
  if (!(error instanceof AuthError)) throw error;
  const status = error.code === 'email_in_use' ? 409 : error.code === 'session_not_found' ? 404 : 401;
  return reply.code(status).send({ error: error.code });
}

export function registerWebAuthRoutes(app: FastifyInstance, auth: AuthService) {
  const snapshot = async (user: { id: string; email: string }) => ({ user });
  for (const action of ['register', 'login'] as const) {
    app.post(`/api/web/auth/${action}`, { config: { rateLimit: { max: action === 'register' ? 5 : 10, timeWindow: '1 minute' } } }, async (request, reply) => {
      try {
        assertWebMutation(request);
        const parsed = credentials.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
        const result = await auth[action](parsed.data.email, parsed.data.password, parsed.data.deviceName ?? 'Web browser');
        const data = await snapshot(result.user);
        setCookies(reply, request, result);
        return reply.code(action === 'register' ? 201 : 200).send(data);
      } catch (error) { return webAuthFailure(error, reply); }
    });
  }
  app.get('/api/web/auth/session', async (request, reply) => {
    try {
      const user = await authenticateWebRequest(request, auth);
      return snapshot({ id: user.id, email: user.email });
    } catch (error) { return webAuthFailure(error, reply); }
  });
  app.post('/api/web/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      assertWebMutation(request);
      const token = cookieToken(request, refreshCookie);
      if (!token) throw new AuthError('invalid_session');
      const result = await auth.refresh(token);
      const data = await snapshot(result.user);
      setCookies(reply, request, result);
      return data;
    } catch (error) {
      // Another tab may already have rotated this credential. A failed response
      // must never overwrite newer valid cookies with expired cookies.
      return webAuthFailure(error, reply);
    }
  });
  app.post('/api/web/auth/logout', async (request, reply) => {
    try {
      assertWebMutation(request);
      const token = cookieToken(request, accessCookie);
      if (token) {
        try { await auth.logout(token); } catch (error) { if (!(error instanceof AuthError)) throw error; }
      }
      const refresh = cookieToken(request, refreshCookie);
      if (refresh) await auth.logoutRefresh(refresh);
      setCookies(reply, request);
      return reply.code(204).send();
    } catch (error) { return webAuthFailure(error, reply); }
  });
  app.get('/api/web/auth/sessions', async (request, reply) => {
    try {
      await authenticateWebRequest(request, auth);
      return { sessions: await auth.listSessions(cookieToken(request, accessCookie)!) };
    } catch (error) { return webAuthFailure(error, reply); }
  });
  app.delete('/api/web/auth/sessions/:sessionId', async (request, reply) => {
    try {
      assertWebMutation(request);
      const user = await authenticateWebRequest(request, auth);
      const parsed = z.object({ sessionId: z.uuid() }).safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      await auth.revokeSession(cookieToken(request, accessCookie)!, parsed.data.sessionId);
      if (user.sessionId === parsed.data.sessionId) setCookies(reply, request);
      return reply.code(204).send();
    } catch (error) { return webAuthFailure(error, reply); }
  });
}
