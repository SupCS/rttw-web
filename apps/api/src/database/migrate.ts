import { runner } from 'node-pg-migrate';
import { migrationOptions } from './migrations.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required for migrations.');
  process.exitCode = 1;
} else {
  try {
    const applied = await runner({
      ...migrationOptions,
      databaseUrl: { connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 60_000 },
    });
    console.info(`Migrations complete: ${applied.length} applied.`);
  } catch {
    console.error('Database migration failed. Check connectivity and migration compatibility; deployment must stop.');
    process.exitCode = 1;
  }
}
