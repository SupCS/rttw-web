import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import { registerAuthRoutes } from './auth/routes.js';
import type { AuthService } from './auth/service.js';
import { AuthError } from './auth/service.js';
import { configureWebSecurity, registerWebAuthRoutes, WebRequestError } from './auth/web.js';
import { registerHouseholdRoutes } from './households/routes.js';
import { HouseholdError, type HouseholdService } from './households/service.js';
import { registerLedgerRoutes } from './ledger/routes.js';
import type { LedgerService } from './ledger/service.js';
import { registerFxRoutes } from './fx/routes.js';
import { FxUnavailable, type FxService } from './fx/service.js';

export type AppOptions = {
  checkDatabase?: () => Promise<void>;
  authService?: AuthService;
  householdService?: HouseholdService;
  ledgerService?: LedgerService;
  fxService?: FxService;
  webOrigin?: string;
  secureWebCookies?: boolean;
  logger?: boolean;
};

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    trustProxy: true,
    logger: options.logger === false ? false : {
      serializers: {
        req: (request) => ({ method: request.method }),
        err: () => ({ type: 'Error', message: 'Request failed', stack: '' }),
      },
    },
    // Default request logs include URLs, IPs and headers; log only safe operational events.
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WebRequestError || error instanceof HouseholdError) {
      return reply.code(error.statusCode).send({ error: error.code });
    }
    if (error instanceof AuthError) return reply.code(401).send({ error: error.code });
    if (error instanceof FxUnavailable) return reply.code(503).send({ error: 'fx_unavailable' });
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    app.log.error('Request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  app.get('/health', async () => ({
    service: 'rttw-api',
    status: 'ok',
  }));

  app.get('/ready', async (_request, reply) => {
    if (!options.checkDatabase) {
      return reply.code(503).send({ service: 'rttw-api', status: 'not_ready' });
    }
    try {
      await options.checkDatabase();
      return { service: 'rttw-api', status: 'ready' };
    } catch {
      return reply.code(503).send({ service: 'rttw-api', status: 'not_ready' });
    }
  });

  if (options.authService) {
    configureWebSecurity(app, {
      ...(options.webOrigin ? { origin: options.webOrigin } : {}),
      ...(options.secureWebCookies !== undefined ? { secureCookies: options.secureWebCookies } : {}),
    });
    app.register(async (authScope) => {
      await authScope.register(rateLimit, {
        global: false,
      });
      registerAuthRoutes(authScope, options.authService!);
      registerWebAuthRoutes(authScope, options.authService!, options.householdService);
      if (options.householdService) registerHouseholdRoutes(authScope, options.authService!, options.householdService);
      if (options.ledgerService) registerLedgerRoutes(authScope, options.authService!, options.ledgerService);
      if (options.fxService) registerFxRoutes(authScope, options.authService!, options.fxService);
    });
  }

  return app;
}

