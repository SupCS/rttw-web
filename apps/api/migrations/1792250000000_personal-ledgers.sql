-- Up Migration
-- Personal ledgers reuse the financial storage and audit model, but have one
-- immutable owner and cannot be listed or joined as shared households.
ALTER TABLE households ADD COLUMN personal_owner_user_id uuid REFERENCES users(id);
ALTER TABLE households ADD CONSTRAINT households_personal_owner
  CHECK (personal_owner_user_id IS NULL OR personal_owner_user_id = created_by_user_id);
CREATE UNIQUE INDEX households_personal_owner_unique ON households (personal_owner_user_id)
  WHERE personal_owner_user_id IS NOT NULL AND deleted_at IS NULL;

-- Existing households and financial history remain unchanged.
-- No down migration: removing ownership would expose personal ledgers as shared.
