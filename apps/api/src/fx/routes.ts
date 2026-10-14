import type { FastifyInstance } from 'fastify';
import { currencyMetadata, type MoneyCurrencyCode } from '@rttw/domain';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authenticateWebRequest } from '../auth/web.js';
import { FxService } from './service.js';

const currency = z.enum(Object.keys(currencyMetadata) as [MoneyCurrencyCode, ...MoneyCurrencyCode[]]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export function registerFxRoutes(app: FastifyInstance, auth: AuthService, fx: FxService) {
  app.get('/api/fx/rates', async (request, reply) => {
    await authenticateWebRequest(request, auth);
    const query = z.object({ base: currency, quotes: z.string().min(3).max(100), date: date.optional() }).strict().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request' });
    const quotes = z.array(currency).min(1).max(11).safeParse(query.data.quotes.split(','));
    if (!quotes.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.header('cache-control', 'no-store').send(await fx.rates(query.data.base, quotes.data, query.data.date));
  });
  app.get('/api/fx/history', async (request, reply) => {
    await authenticateWebRequest(request, auth);
    const query = z.object({ base: currency, quote: currency, from: date, to: date }).strict().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.header('cache-control', 'no-store').send(await fx.history(query.data.base, query.data.quote, query.data.from, query.data.to));
  });
}
