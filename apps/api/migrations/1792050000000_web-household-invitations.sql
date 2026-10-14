-- Up Migration
-- Shareable invitation secrets are returned once and stored only as hashes.
CREATE TABLE household_invitations (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by_user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_by_user_id uuid REFERENCES users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_invitations_acceptance CHECK ((accepted_at IS NULL) = (accepted_by_user_id IS NULL))
);
CREATE INDEX household_invitations_open_idx ON household_invitations (household_id, email)
  WHERE accepted_at IS NULL;

-- No down migration: membership history must not be removed by a rollback.
