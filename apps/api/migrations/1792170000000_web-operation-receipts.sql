-- Up Migration
-- Browser retries reuse an operation ID. Its receipt and financial write commit
-- together so a lost response never creates a second financial operation.
CREATE TABLE web_operation_receipts (
  household_id uuid NOT NULL REFERENCES households(id),
  member_id uuid NOT NULL REFERENCES household_members(id),
  request_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, member_id, request_id)
);
-- No down migration: durable write receipts must survive application rollback.
