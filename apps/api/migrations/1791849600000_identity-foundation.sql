-- Up Migration
-- Identity foundation only. No financial data is copied from devices.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL CHECK (length(password_hash) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE households (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  base_currency_code text NOT NULL CHECK (base_currency_code ~ '^[A-Z]{3}$'),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz
);

CREATE TABLE household_members (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  user_id uuid NOT NULL REFERENCES users(id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  membership_status text NOT NULL CHECK (membership_status IN ('invited', 'active', 'left', 'removed')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  CONSTRAINT household_members_user_unique UNIQUE (household_id, user_id)
);

CREATE INDEX household_members_active_user_idx ON household_members (user_id, household_id)
  WHERE membership_status = 'active' AND deleted_at IS NULL;

-- No down migration: identity records must not be dropped by a rollback.
