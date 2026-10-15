import type { Pool } from 'pg';

export async function checkDatabaseReadiness(database: Pick<Pool, 'query'>): Promise<void> {
  const result = await database.query<{ ready: boolean }>(`SELECT
    to_regclass('public.users') IS NOT NULL
    AND to_regclass('public.auth_sessions') IS NOT NULL
    AND to_regclass('public.personal_ledgers') IS NOT NULL
    AND to_regclass('public.ledger_entities') IS NOT NULL
    AND to_regclass('public.ledger_recurring_occurrences') IS NOT NULL
    AND to_regclass('public.ledger_operation_receipts') IS NOT NULL
    AND to_regclass('public.ledger_budget_month_unique') IS NOT NULL
    AND to_regclass('public.web_fx_cache') IS NOT NULL AS ready`);
  if (!result.rows[0]?.ready) throw new Error('Database schema is not ready');
}
