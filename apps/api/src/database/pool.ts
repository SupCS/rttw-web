import { Pool } from 'pg';

export function createDatabasePool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
  });
}
