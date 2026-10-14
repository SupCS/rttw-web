import { buildApp } from './app.js';
import { createScryptPasswordHasher } from './auth/password.js';
import { AuthRepository } from './auth/repository.js';
import { AuthService } from './auth/service.js';
import { createDatabasePool } from './database/pool.js';
import { checkDatabaseReadiness } from './database/readiness.js';
import { HouseholdService } from './households/service.js';
import { LedgerService } from './ledger/service.js';
import { FxService } from './fx/service.js';
import { registerWebStatic } from './web/static.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; use api:local for local development');
const database = createDatabasePool(process.env.DATABASE_URL);
const fx = new FxService(database);
const app = buildApp({
  checkDatabase: async () => checkDatabaseReadiness(database),
  authService: new AuthService(new AuthRepository(database), createScryptPasswordHasher()),
  householdService: new HouseholdService(database),
  ledgerService: new LedgerService(database, fx),
  fxService: fx,
});

if (database) {
  database.on('error', () => app.log.error('Database connection failed'));
  app.addHook('onClose', async () => { await database.end(); });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      app.log.error('Shutdown failed');
      process.exitCode = 1;
    });
  });
}

let webBuildReady = false;
try {
  await registerWebStatic(app);
  webBuildReady = true;
  await app.listen({ host, port });
} catch {
  app.log.error(webBuildReady ? 'Server startup failed' : 'Built website is missing or unreadable; run npm run build before starting production');
  await app.close();
  process.exitCode = 1;
}

