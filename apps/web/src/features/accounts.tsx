import { useState, type FormEvent } from 'react';
import { parseMajorAmount, serializeMoney, type Account, type MoneyCurrencyCode } from '@rttw/domain';
import { accountBalances, audit } from '../data/derived';
import { errorText } from '../data/use-ledger';
import { today } from '../format';
import { Amount, CurrencySelect, Dialog, ErrorMessage, Field, SubmitButtons, currencies, signedMajorInput, text, type FeatureProps } from '../components/shared';
import { ConvertedBalance } from './overview-fx';

const accountTypes: Account['accountType'][] = ['cash', 'debit_card', 'credit_card', 'current', 'savings', 'deposit', 'investment', 'debt', 'e_wallet', 'custom'];
export function Accounts(props: FeatureProps) {
  const { snapshot, t, locale, moneyDisplay } = props;
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [archived, setArchived] = useState(false);
  const accounts = snapshot.accounts.filter((item) => !item.deletedAt && item.isArchived === archived);
  return <>
    <div className="section-heading"><h1>{t.accounts}</h1><button className="primary" onClick={() => setEditing('new')}>{t.newAccount}</button></div>
    <label className="check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />{t.archived}</label>
    <div className="card-grid">{accounts.map((account) => <article className="card" key={account.id}>
      <div className="section-heading"><h2>{account.name}</h2><button onClick={() => setEditing(account)}>{t.edit}</button></div>
      <p className="muted">{t[account.accountType]} · {t[account.ownershipScope]} · {account.primaryCurrency}</p>
      <div className="balance-stack">{accountBalances(snapshot, account, today()).map((value) => <Amount key={value.currency} value={value} locale={locale} display={moneyDisplay} />)}</div>
      <ConvertedBalance values={accountBalances(snapshot, account, today())} currency={account.primaryCurrency} date={today()} locale={locale} display={moneyDisplay} t={t} />
      <a href={`#transactions?account=${encodeURIComponent(account.id)}`}>{t.transactions}</a>
    </article>)}</div>
    {!accounts.length && <p className="empty">{t.empty}</p>}
    {editing && <AccountEditor {...props} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </>;
}

function AccountEditor({ existing, onClose, ...props }: FeatureProps & { existing: Account | undefined; onClose: () => void }) {
  const { snapshot, t, command, busy } = props;
  const [fields] = useState(() => audit(snapshot.member.id, existing));
  const [inputs, setInputs] = useState<Partial<Record<MoneyCurrencyCode, string>>>(() => existing ? Object.fromEntries(existing.openingBalances.map((value) => [value.currency, signedMajorInput(value)])) : { [snapshot.household.baseCurrency]: '0' });
  const [primary, setPrimary] = useState(existing?.primaryCurrency ?? snapshot.household.baseCurrency);
  const [scope, setScope] = useState<Account['ownershipScope']>(existing?.ownershipScope ?? 'personal');
  const [error, setError] = useState('');
  const codes = Object.keys(inputs) as MoneyCurrencyCode[];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError('');
    let openingBalances;
    try { openingBalances = codes.map((currency) => serializeMoney(parseMajorAmount(inputs[currency] ?? '', currency))); } catch { setError(t.invalidAmount); return; }
    const name = text(data, 'name'); if (!name || !codes.includes(primary)) { setError(t.invalidForm); return; }
    try {
      await command({ type: 'account.save', expectedRevision: existing?.revision ?? 0, account: { ...fields, householdId: snapshot.household.id,
        name, ownershipScope: scope, ownerMemberId: scope === 'personal' ? existing?.ownerMemberId ?? snapshot.member.id : null,
        accountType: text(data, 'accountType') as Account['accountType'], primaryCurrency: primary, openingBalances, isArchived: existing?.isArchived ?? false } }); onClose();
    } catch (failure) { setError(errorText(failure, t)); }
  }
  async function archive() {
    if (!existing) return;
    try { await command({ type: 'account.save', expectedRevision: existing.revision, account: { ...existing, ...audit(snapshot.member.id, existing), isArchived: !existing.isArchived } }); onClose(); } catch (failure) { setError(errorText(failure, t)); }
  }
  function toggle(currency: MoneyCurrencyCode) {
    setInputs((current) => {
      if (current[currency] === undefined) return { ...current, [currency]: '0' };
      if (Object.keys(current).length === 1) return current;
      const next = { ...current }; delete next[currency];
      if (primary === currency) setPrimary(Object.keys(next)[0] as MoneyCurrencyCode);
      return next;
    });
  }
  return <Dialog title={existing ? t.editAccount : t.newAccount} onClose={onClose} t={t} busy={busy}><form onSubmit={(event) => void save(event)}>
    <Field label={t.name}><input name="name" required maxLength={120} defaultValue={existing?.name} autoFocus /></Field>
    <Field label={t.accountType}><select name="accountType" defaultValue={existing?.accountType ?? 'current'}>{accountTypes.map((type) => <option key={type} value={type}>{t[type]}</option>)}</select></Field>
    <fieldset><legend>{t.currencies}</legend><div className="choices">{currencies.map((currency) => <label className="check" key={currency}><input type="checkbox" checked={inputs[currency] !== undefined} onChange={() => toggle(currency)} />{currency}</label>)}</div></fieldset>
    <div className="form-grid">{codes.map((currency) => <Field label={`${t.openingBalance} · ${currency}`} key={currency}><input inputMode="decimal" required value={inputs[currency] ?? ''} onChange={(event) => setInputs((current) => ({ ...current, [currency]: event.target.value }))} /></Field>)}</div>
    <Field label={t.primaryCurrency}><CurrencySelect codes={codes} value={primary} onChange={setPrimary} /></Field>
    <Field label={t.ownership}><select value={scope} onChange={(event) => setScope(event.target.value as Account['ownershipScope'])}><option value="personal">{t.personal}</option><option value="shared">{t.shared}</option></select></Field>
    <ErrorMessage message={error} /><SubmitButtons busy={busy} t={t} onClose={onClose} />
    {existing && <button type="button" disabled={busy} className="danger" onClick={() => void archive()}>{existing.isArchived ? t.unarchive : t.archive}</button>}
  </form></Dialog>;
}
