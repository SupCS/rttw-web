import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { ClientBase } from 'pg';
import { buildApp } from './app.js';
import { createScryptPasswordHasher } from './auth/password.js';
import { AuthRepository } from './auth/repository.js';
import { AuthService } from './auth/service.js';
import { createLocalDatabasePool } from './database/local.js';
import { migrationOptions } from './database/migrations.js';
import { checkDatabaseReadiness } from './database/readiness.js';
import { HouseholdService } from './households/service.js';
import { LedgerService } from './ledger/service.js';
import { FxService } from './fx/service.js';

if (process.env.NODE_ENV === 'production') throw new Error('Local database server is development-only');
const dataDirectory = fileURLToPath(new URL('../../../.local-data/', import.meta.url));
await mkdir(dataDirectory, { recursive: true });
const database = createLocalDatabasePool(new PGlite(dataDirectory));
await runner({ ...migrationOptions, dbClient: database as unknown as ClientBase });
const fx = new FxService(database);
const app = buildApp({
  checkDatabase: () => checkDatabaseReadiness(database),
  authService: new AuthService(new AuthRepository(database), createScryptPasswordHasher()),
  householdService: new HouseholdService(database),
  ledgerService: new LedgerService(database, fx),
  fxService: fx,
  secureWebCookies: false,
});
app.addHook('onClose', async () => { await database.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
}
try {
  await app.listen({ host: '127.0.0.1', port: Number.parseInt(process.env.PORT ?? '3000', 10) });
} catch {
  app.log.error('Local API startup failed');
  await app.close();
  process.exitCode = 1;
}
