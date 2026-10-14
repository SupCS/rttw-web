import { useState, type FormEvent } from 'react';
import type { MoneyCurrencyCode } from '@rttw/domain';
import { request, type WebHousehold } from '../data/api';
import { errorText } from '../data/use-ledger';
import { CurrencySelect, ErrorMessage, Field, text } from '../components/shared';
import type { Text } from '../i18n';

export function HouseholdCreator({ t, onCreated }: { t: Text; onCreated: (household: WebHousehold) => Promise<void> }) {
  const [currency, setCurrency] = useState<MoneyCurrencyCode>('GEL'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError('');
    try { const result = await request<{ household: WebHousehold }>('/api/web/households', { name: text(data, 'name'), baseCurrency: currency }); await onCreated(result.household); form.reset(); } catch (failure) { setError(errorText(failure, t)); } finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void create(event)}><Field label={t.householdName}><input name="name" required maxLength={120} /></Field><Field label={t.baseCurrency}><CurrencySelect value={currency} onChange={setCurrency} /></Field><ErrorMessage message={error} /><button className="primary" disabled={busy}>{busy ? t.saving : t.createHousehold}</button></form>;
}
