-- Up Migration
-- Fill missing presentation defaults only. Preserve customized colors, icons,
-- category edit revisions and every financial record.
WITH defaults(system_key, color) AS (VALUES
  ('groceries', '#168A65'), ('dining', '#D66A2C'), ('transport', '#2878C8'),
  ('housing', '#815B45'), ('utilities', '#A96F00'), ('health', '#C74747'),
  ('entertainment', '#6D5BD0'), ('shopping', '#C94F83'),
  ('salary', '#668F2D'), ('other_income', '#168AA3')
)
UPDATE web_ledger_entities AS category
SET entity = jsonb_set(
  jsonb_set(category.entity, '{colorToken}', COALESCE(NULLIF(category.entity->'colorToken', 'null'::jsonb), to_jsonb(defaults.color))),
  '{iconColor}', COALESCE(NULLIF(category.entity->'iconColor', 'null'::jsonb), '"#FFFFFF"'::jsonb)
)
FROM defaults
WHERE category.entity_kind = 'category' AND category.entity->>'systemKey' = defaults.system_key
  AND (category.entity->>'colorToken' IS NULL OR category.entity->>'iconColor' IS NULL);
