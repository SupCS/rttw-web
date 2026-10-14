import type { PGlite } from '@electric-sql/pglite';
import type { Pool, QueryResult } from 'pg';

// Development/test adapter. PGlite has one connection: serialize entire client
// transactions so requests never accidentally share one another's transaction.
export function createLocalDatabasePool(database: PGlite): Pool {
  let available = Promise.resolve();
  async function acquire() {
    const previous = available;
    let release!: () => void;
    available = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return release;
  }
  async function query(input: string | { text: string; values?: unknown[] }, values?: unknown[]) {
    const sql = typeof input === 'string' ? input : input.text;
    const parameters = values ?? (typeof input === 'string' ? undefined : input.values);
    const result = parameters?.length ? await database.query(sql, parameters)
      : (await database.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 };
    return { ...result, rowCount: result.affectedRows ?? result.rows.length } as unknown as QueryResult;
  }
  return {
    async query(input: string | { text: string; values?: unknown[] }, values?: unknown[]) {
      const release = await acquire();
      try { return await query(input, values); } finally { release(); }
    },
    async connect() {
      const unlock = await acquire();
      let released = false;
      return { query, release() { if (!released) { released = true; unlock(); } } };
    },
    async end() { await available; await database.close(); },
  } as unknown as Pool;
}
