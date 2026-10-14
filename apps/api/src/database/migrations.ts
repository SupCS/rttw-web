import { fileURLToPath } from 'node:url';

// src/database and dist/database have the same depth relative to migrations/.
export const migrationOptions = {
  dir: fileURLToPath(new URL('../../migrations/', import.meta.url)),
  migrationsTable: 'schema_migrations',
  direction: 'up' as const,
  checkOrder: true,
  singleTransaction: true,
  // Do not print SQL, connection details, or database error payloads.
  logger: { info() {}, warn() {}, error() {} },
};
