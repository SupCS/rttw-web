import { useState, type ChangeEvent } from 'react';
import type { LedgerSnapshot } from '@rttw/domain';
import { ApiError, request } from '../data/api';
import { errorText } from '../data/use-ledger';
import { today } from '../format';
import { ErrorMessage, Field, type FeatureProps } from '../components/shared';

type Preview = { accounts: number; categories: number; transactions: number; baseCurrency: string };
export function Backup({ refresh, ...props }: FeatureProps & { refresh: () => Promise<void> }) {
  const { snapshot, t } = props; const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<{ backup: unknown; counts: Preview } | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const empty = snapshot.accounts.length === 0 && snapshot.transactions.length === 0;
  async function exportBackup() {
    setWorking(true); setError('');
    try {
      const backup = await request<unknown>(`/api/ledger/backup?householdId=${snapshot.household.id}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `rttw-backup-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; setPreview(null); setConfirmation(false); setError('');
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError(t.invalidBackup); return; }
    setWorking(true);
    try {
      const backup: unknown = JSON.parse(await file.text());
      const counts = await request<Preview>('/api/ledger/backup/preview', { householdId: snapshot.household.id, backup });
      setPreview({ backup, counts });
    } catch (failure) { setError(failure instanceof ApiError ? errorText(failure, t) : t.invalidBackup); } finally { setWorking(false); }
  }
  async function restore() {
    if (!preview || !confirmation || !empty) return; setWorking(true); setError('');
    try { await request<LedgerSnapshot>('/api/ledger/restore', { householdId: snapshot.household.id, backup: preview.backup }); await refresh(); setPreview(null); setConfirmation(false); } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  return <section className="card"><h2>{t.backup}</h2><p className="hint">{t.restoreHint}</p><button disabled={working || props.busy} onClick={() => void exportBackup()}>{working ? t.loading : t.exportBackup}</button>
    {snapshot.member.role === 'owner' && <><Field label={t.chooseBackup}><input type="file" accept="application/json,.json" disabled={working || props.busy || !empty} onChange={(event) => void selectFile(event)} /></Field>
      {preview && <div className="backup-preview"><h3>{t.preview}</h3><dl><dt>{t.accounts}</dt><dd>{preview.counts.accounts}</dd><dt>{t.categories}</dt><dd>{preview.counts.categories}</dd><dt>{t.transactions}</dt><dd>{preview.counts.transactions}</dd><dt>{t.baseCurrency}</dt><dd>{preview.counts.baseCurrency}</dd></dl><label className="check"><input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} />{t.confirmRestore}</label><div className="actions"><button className="primary" disabled={working || props.busy || !confirmation || !empty} onClick={() => void restore()}>{working ? t.saving : t.restore}</button><button disabled={working} onClick={() => setPreview(null)}>{t.cancel}</button></div></div>}
    </>}<ErrorMessage message={error} />
  </section>;
}
