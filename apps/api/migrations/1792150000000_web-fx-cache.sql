-- Up Migration
CREATE TABLE web_fx_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE web_fx_cache;
