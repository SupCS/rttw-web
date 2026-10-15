-- Up Migration
ALTER TABLE ledger_entities DROP CONSTRAINT ledger_entities_entity_kind_check;
ALTER TABLE ledger_entities ADD CONSTRAINT ledger_entities_entity_kind_check
  CHECK (entity_kind IN ('account', 'category', 'transaction', 'split', 'transfer', 'recurring', 'budget'));
CREATE UNIQUE INDEX ledger_budget_month_unique ON ledger_entities (ledger_id, (entity->>'month'))
  WHERE entity_kind = 'budget' AND entity->>'deletedAt' IS NULL;

-- No down migration: saved budget limits must not be discarded by rollback.
