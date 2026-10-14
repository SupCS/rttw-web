-- Up Migration
-- Copy independent definitions; retain legacy references for occurrence history.
-- Original transactions, amounts, dates, applied FX and audit revisions stay intact.
WITH source AS (
  SELECT rule.household_id, rule.id, original.entity AS original, COALESCE((
    SELECT jsonb_agg(jsonb_build_object('categoryId', category_id,
      'amount', jsonb_build_object('currency', currency, 'amountMinor', amount_minor)) ORDER BY category_id)
    FROM (
      SELECT split.entity->>'categoryId' AS category_id,
        split.entity->'amount'->>'currency' AS currency,
        sum((split.entity->'amount'->>'amountMinor')::numeric)::text AS amount_minor
      FROM web_ledger_entities split
      WHERE split.household_id = rule.household_id AND split.entity_kind = 'split'
        AND split.entity->>'transactionId' = original.id AND split.entity->>'deletedAt' IS NULL
      GROUP BY split.entity->>'categoryId', split.entity->'amount'->>'currency'
    ) allocations
  ), '[]'::jsonb) AS splits
  FROM web_ledger_entities rule
  JOIN web_ledger_entities original ON original.household_id = rule.household_id
    AND original.entity_kind = 'transaction' AND original.id = rule.entity->>'templateTransactionId'
  WHERE rule.entity_kind = 'recurring' AND NOT (rule.entity ? 'payment')
    AND original.entity->>'transactionType' IN ('expense', 'income')
), definitions AS (
  SELECT household_id, id, jsonb_build_object(
    'accountId', original->'accountId', 'memberId', original->'memberId',
    'categoryId', CASE WHEN jsonb_array_length(splits) = 1 THEN splits->0->'categoryId'
      WHEN jsonb_array_length(splits) > 1 THEN 'null'::jsonb ELSE original->'categoryId' END,
    'transactionType', original->'transactionType', 'originalAmount', original->'originalAmount',
    'description', original->'description', 'notes', original->'notes',
    'splits', CASE WHEN jsonb_array_length(splits) = 1 THEN '[]'::jsonb ELSE splits END
  ) AS payment FROM source
)
UPDATE web_ledger_entities rule SET entity = jsonb_set(rule.entity, '{payment}', definitions.payment)
FROM definitions WHERE rule.household_id = definitions.household_id AND rule.id = definitions.id AND rule.entity_kind = 'recurring';
