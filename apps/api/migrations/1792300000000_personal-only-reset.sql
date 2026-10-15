-- Up Migration
-- Explicitly requested reset: discard ALL financial and shared-space data.
-- Users and authentication sessions are retained. Historical migrations remain
-- in the chain so existing installations can reach this schema safely.
DROP TABLE web_operation_receipts, web_recurring_occurrences,
  web_ledger_entities, household_invitations, household_members, households;

CREATE TABLE personal_ledgers (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  base_currency_code text NOT NULL CHECK (base_currency_code ~ '^[A-Z]{3}$'),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz
);
CREATE TABLE ledger_entities (
  ledger_id uuid NOT NULL REFERENCES personal_ledgers(id),
  entity_kind text NOT NULL CHECK (entity_kind IN ('account', 'category', 'transaction', 'split', 'transfer', 'recurring')),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 160),
  revision integer NOT NULL CHECK (revision > 0),
  entity jsonb NOT NULL CHECK (jsonb_typeof(entity) = 'object'),
  PRIMARY KEY (ledger_id, entity_kind, id),
  CHECK (entity->>'id' = id),
  CHECK (entity->>'ledgerId' = ledger_id::text),
  CHECK ((entity->>'revision')::integer = revision)
);
CREATE INDEX ledger_entities_kind_idx ON ledger_entities(ledger_id, entity_kind);
CREATE TABLE ledger_recurring_occurrences (
  ledger_id uuid NOT NULL REFERENCES personal_ledgers(id),
  rule_id text NOT NULL,
  occurrence_date date NOT NULL,
  transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger_id, rule_id, occurrence_date)
);
CREATE TABLE ledger_operation_receipts (
  ledger_id uuid NOT NULL REFERENCES personal_ledgers(id),
  request_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger_id, request_id)
);

-- No down migration: the explicitly cleared financial data cannot be recreated.
