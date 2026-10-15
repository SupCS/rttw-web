# RTTW Web

Work only in this standalone online web project; leave the legacy app and production untouched.

## Workflow

- Finish the whole requested task before validation. Run one lightweight check at the end, not after each feature or edit. Repeat only for a failure or a subsequent code change.
- Do not add tests or run the full suite by default. Use focused tests only for an explicit request, a reproduced bug, or a concrete money/data-loss/access-control risk. Build only when needed to verify the final result.
- Keep only two project documents: this English instruction file and `TODO.md` for progress/setup. Replace obsolete text; no extra plans, reports, or verification files.
- Update TODO once when a task changes progress or setup, not after every edit. Read only the relevant code and current TODO items. Keep investigation and replies brief.
- No commits, pushes, or production deployment unless explicitly requested.

## Practices

- `apps/web`: React/Vite API client; `apps/api`: Fastify/PostgreSQL; `packages/domain`: pure financial logic.
- Money: bigint minor units, persisted integer strings and currency codes. Preserve original amounts, dates, currencies, and FX snapshots. Transfers are not income/expense; future records are not actuals.
- Authorize personal-ledger access by user. Failed requests must never appear saved. Imports/restores require validation, preview, confirmation, and atomic writes.
- Keep secrets and financial content out of logs/Git. Use theme tokens, accessible layouts, en/uk/ru text, and the pirate flag for ru.
