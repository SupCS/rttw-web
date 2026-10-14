-- Up Migration
-- Website financial records are owned by PostgreSQL. JSON stores canonical integer
-- money strings and immutable original/FX fields without conversion to floating point.
CREATE TABLE web_ledger_entities (
  household_id uuid NOT NULL REFERENCES households(id),
  entity_kind text NOT NULL CHECK (entity_kind IN ('account', 'category', 'transaction', 'split', 'transfer', 'recurring')),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 160),
  revision integer NOT NULL CHECK (revision > 0),
  entity jsonb NOT NULL CHECK (jsonb_typeof(entity) = 'object'),
  PRIMARY KEY (household_id, entity_kind, id),
  CHECK (entity->>'id' = id),
  CHECK (entity->>'householdId' = household_id::text),
  CHECK ((entity->>'revision')::integer = revision)
);
CREATE INDEX web_ledger_entities_household_kind_idx ON web_ledger_entities(household_id, entity_kind);
CREATE TABLE web_recurring_occurrences (
  household_id uuid NOT NULL REFERENCES households(id),
  rule_id text NOT NULL,
  occurrence_date date NOT NULL,
  transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, rule_id, occurrence_date)
);
-- No down migration: financial history must not be dropped by rollback.
