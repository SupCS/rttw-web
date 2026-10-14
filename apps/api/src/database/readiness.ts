import type { Pool } from 'pg';

type ReadinessRow = {
  users_table: string | null;
  auth_sessions_table: string | null;
  invitations_table: string | null;
  ledger_table: string | null;
  fx_cache_table: string | null;
  receipts_table: string | null;
};

export async function checkDatabaseReadiness(database: Pick<Pool, 'query'>): Promise<void> {
  const result = await database.query<ReadinessRow>(`
    SELECT
      to_regclass('public.users') AS users_table,
      to_regclass('public.auth_sessions') AS auth_sessions_table,
      to_regclass('public.household_invitations') AS invitations_table,
      to_regclass('public.web_ledger_entities') AS ledger_table,
      to_regclass('public.web_fx_cache') AS fx_cache_table,
      to_regclass('public.web_operation_receipts') AS receipts_table
  `);
  const row = result.rows[0];
  if (!row?.users_table || !row.auth_sessions_table || !row.invitations_table || !row.ledger_table || !row.fx_cache_table || !row.receipts_table) {
    throw new Error('Database schema is not ready');
  }
}
