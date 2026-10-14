-- Up Migration
-- Opaque access and refresh tokens are stored only as SHA-256 hashes.
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  device_name text CHECK (device_name IS NULL OR length(btrim(device_name)) BETWEEN 1 AND 120),
  access_token_hash text NOT NULL CHECK (access_token_hash ~ '^[0-9a-f]{64}$'),
  refresh_token_hash text NOT NULL CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$'),
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  rotated_from_session_id uuid REFERENCES auth_sessions(id),
  CONSTRAINT auth_sessions_access_token_unique UNIQUE (access_token_hash),
  CONSTRAINT auth_sessions_refresh_token_unique UNIQUE (refresh_token_hash),
  CONSTRAINT auth_sessions_expiry_order CHECK (refresh_expires_at > access_expires_at)
);

CREATE INDEX auth_sessions_active_user_idx ON auth_sessions (user_id, refresh_expires_at)
  WHERE revoked_at IS NULL;

-- No down migration: authentication history must not be removed by a rollback.
