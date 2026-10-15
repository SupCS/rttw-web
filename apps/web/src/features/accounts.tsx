import { useEffect, useState, type FormEvent } from 'react';
import { parseMajorAmount, serializeMoney, type Account, type MoneyCurrencyCode } from '@rttw/domain';
import { accountBalances, audit } from '../data/derived';
import { errorText } from '../data/use-ledger';
import { today } from '../format';
import { Amount, CurrencySelect, Dialog, ErrorMessage, Field, SubmitButtons, currencies, signedMajorInput, text, type FeatureProps } from '../components/shared';
import { Icon, ui, Heading } from '../components/design';
import { rates, type FxRate } from '../data/api';
import { convertBalance } from '../data/reporting';
import { CategoryBadge } from './categories';
import { ConvertedBalance } from './overview-fx';

const accountTypes: Account['accountType'][] = ['cash', 'debit_card', 'credit_card', 'current', 'savings', 'deposit', 'investment', 'debt', 'e_wallet', 'custom'];
export function Accounts(props: FeatureProps) {
  const { snapshot, t, locale, moneyDisplay } = props;
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const accounts = snapshot.accounts.filter((item) => !item.deletedAt);
  const [scope,setScope]=useState<'all'|'personal'|'shared'>('all');
  const [hidden,setHidden]=useState(false);
  const [currency,setCurrency]=useState(snapshot.household.baseCurrency);
  const [fx,setFx]=useState<FxRate[]>([]);
  const [selected,setSelected]=useState<Account|null>(null);
  const shown=accounts.filter(a=>scope==='all'||a.ownershipScope===scope);
  const totals=shown.flatMap(a=>accountBalances(snapshot,a,today()));
  const currencyKey=[...new Set(totals.map(v=>v.currency).filter(c=>c!==currency))].sort().join(',');
  useEffect(()=>{let alive=true;setFx([]);void Promise.allSettled(currencyKey.split(',').filter(Boolean).map(c=>rates(c as MoneyCurrencyCode,currency,today()))).then(values=>{if(alive)setFx(values.flatMap(v=>v.status==='fulfilled'?v.value.rates:[]))});return()=>{alive=false}},[currencyKey,currency]);
  const total=convertBalance(totals,currency,fx);
  const recent=snapshot.transactions.filter(t=>!t.deletedAt&&['confirmed','fx_pending'].includes(t.status)&&t.transactionDate<=today()&&shown.some(a=>a.id===t.accountId)).sort((a,b)=>b.transactionDate.localeCompare(a.transactionDate)||b.createdAt.localeCompare(a.createdAt)).slice(0,3);
  const card=(account:Account,index:number)=>{const values=accountBalances(snapshot,account,today());return <article className={`account-card account-${account.accountType}`} key={account.id}><button className="account-card-head" onClick={()=>setSelected(account)}><span className={`tile-icon ${['blue','peach','lavender','mint'][index%4]}`}><Icon name={account.accountType==='cash'?'money':['savings','deposit','investment'].includes(account.accountType)?'sparkle':'card'}/></span><span><strong>{account.name}</strong><small>{t[account.ownershipScope]}<span className="middle-dot">·</span>{t[account.accountType]}</small></span><Icon name="right" size={17}/></button><div className={`account-currencies ${values.length===1?'single-currency':''}`}>{values.map(v=><div key={v.currency}><span className="currency-caption">{v.currency}</span><strong className={BigInt(v.amountMinor)<0n?'negative':''}>{hidden?'••••':<Amount value={v} locale={locale} display={moneyDisplay}/>}</strong></div>)}</div></article>};
  return <><Heading title={t.accounts} subtitle={ui(props.language,'available')} action={shown.length > 0 && <button className="icon-button outlined" aria-label={t.newAccount} onClick={()=>setEditing('new')}><Icon name="plus"/></button>}/>
    <section className="balance-hero"><div className="balance-hero-top"><span>{ui(props.language,'total')}</span><button className="icon-button" onClick={()=>setHidden(!hidden)} aria-label={ui(props.language,'privacy')} aria-pressed={hidden}><Icon name={hidden?'hidden':'eye'} size={19}/></button></div><div className="hero-amount">{hidden?'••••••':total?<Amount value={total} locale={locale} display={moneyDisplay}/>:<span>—</span>}</div><div className="balance-hero-bottom"><div className="hero-currency"><CurrencySelect value={currency} onChange={setCurrency}/><Icon name="down" size={12}/></div></div>{!total&&totals.length>0&&<small>{t.fx_pending}</small>}</section>
    {!props.isPersonal&&<div className="account-toolbar"><div className="text-tabs">{(['all','personal','shared'] as const).map(v=><button aria-pressed={scope===v} key={v} onClick={()=>setScope(v)}>{v==='all'?t.all:t[v]}</button>)}</div></div>}
    {shown.some(a=>!['savings','deposit','investment'].includes(a.accountType))&&<section className="account-section"><div className="section-heading"><h2>{ui(props.language,'everyday')}</h2><span className="count-label">{shown.filter(a=>!['savings','deposit','investment'].includes(a.accountType)).length}</span></div>{shown.filter(a=>!['savings','deposit','investment'].includes(a.accountType)).map(card)}</section>}
    {shown.some(a=>['savings','deposit','investment'].includes(a.accountType))&&<section className="account-section"><div className="section-heading"><h2>{ui(props.language,'savings')}</h2><Icon name="sparkle" size={17}/></div>{shown.filter(a=>['savings','deposit','investment'].includes(a.accountType)).map((a,i)=>card(a,i+2))}</section>}
    {!shown.length&&<div className="empty-state"><Icon name="wallet" size={38}/><h2>{t.empty}</h2><button className="primary" onClick={()=>setEditing('new')}>{t.newAccount}</button></div>}
    {!!recent.length&&<section className="recent-section"><div className="section-heading"><h2>{ui(props.language,'activity')}</h2><a className="text-link" href="#transactions">{ui(props.language,'seeAll')}<Icon name="right" size={14}/></a></div>{recent.map(tx=>{const cat=snapshot.categories.find(c=>c.id===tx.categoryId);return <a className="mini-transaction" key={tx.id} href={`#transactions?account=${tx.accountId}`}>{cat?<CategoryBadge category={cat}/>:<span className="tile-icon mint"><Icon name="transfer"/></span>}<div><strong>{tx.description??t[tx.transactionType]}</strong><small>{snapshot.accounts.find(a=>a.id===tx.accountId)?.name}</small></div><span className={BigInt(tx.originalAmount.amountMinor)>0n?'positive':''}>{hidden?'••••':<Amount value={tx.originalAmount} locale={locale} display={moneyDisplay}/>}</span></a>})}</section>}
    {selected&&<Dialog title={selected.name} onClose={()=>setSelected(null)} t={t}><div className="detail-balance">{accountBalances(snapshot,selected,today()).map(v=><div key={v.currency}><span>{v.currency}</span><Amount value={v} locale={locale} display={moneyDisplay}/></div>)}</div><p className="hint">{t[selected.accountType]} · {t[selected.ownershipScope]}</p><ConvertedBalance values={accountBalances(snapshot,selected,today())} currency={selected.primaryCurrency} date={today()} locale={locale} display={moneyDisplay} t={t}/><div className="actions"><button className="primary" onClick={()=>{setEditing(selected);setSelected(null)}}>{t.editAccount}</button><a className="button" href={`#transactions?account=${selected.id}`}>{t.transactions}<Icon name="right" size={16}/></a></div></Dialog>}
    {editing&&<AccountEditor {...props} existing={editing==='new'?undefined:editing} onClose={()=>setEditing(null)}/>}
  </>;
}

function AccountEditor({ existing, onClose, ...props }: FeatureProps & { existing: Account | undefined; onClose: () => void }) {
  const { snapshot, t, command, busy } = props;
  const [fields] = useState(() => audit(snapshot.member.id, existing));
  const [inputs, setInputs] = useState<Partial<Record<MoneyCurrencyCode, string>>>(() => existing ? Object.fromEntries(existing.openingBalances.map((value) => [value.currency, signedMajorInput(value)])) : { [snapshot.household.baseCurrency]: '0' });
  const [primary, setPrimary] = useState(existing?.primaryCurrency ?? snapshot.household.baseCurrency);
  const [scope, setScope] = useState<Account['ownershipScope']>(existing?.ownershipScope ?? 'personal');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const codes = Object.keys(inputs) as MoneyCurrencyCode[];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError('');
    let openingBalances;
    try { openingBalances = codes.map((currency) => serializeMoney(parseMajorAmount(inputs[currency] ?? '', currency))); } catch { setError(t.invalidAmount); return; }
    const name = text(data, 'name'); if (!name || !codes.includes(primary)) { setError(t.invalidForm); return; }
    try {
      await command({ type: 'account.save', expectedRevision: existing?.revision ?? 0, account: { ...fields, householdId: snapshot.household.id,
        name, ownershipScope: scope, ownerMemberId: scope === 'personal' ? existing?.ownerMemberId ?? snapshot.member.id : null,
        accountType: text(data, 'accountType') as Account['accountType'], primaryCurrency: primary, openingBalances, isArchived: false } }); onClose();
    } catch (failure) { setError(errorText(failure, t)); }
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
  if (deleting && existing) return <AccountDeletion {...props} accountId={existing.id} onClose={onClose} onCancel={()=>setDeleting(false)}/>;
  return <Dialog title={existing ? t.editAccount : t.newAccount} onClose={onClose} t={t} busy={busy}><form onSubmit={(event) => void save(event)}>
    <Field label={t.name}><input name="name" required maxLength={120} defaultValue={existing?.name} autoFocus /></Field>
    <Field label={t.accountType}><select name="accountType" defaultValue={existing?.accountType ?? 'current'}>{accountTypes.map((type) => <option key={type} value={type}>{t[type]}</option>)}</select></Field>
    <fieldset><legend>{t.currencies}</legend><div className="choices">{currencies.map((currency) => <label className="check" key={currency}><input type="checkbox" checked={inputs[currency] !== undefined} onChange={() => toggle(currency)} />{currency}</label>)}</div></fieldset>
    <div className="form-grid">{codes.map((currency) => <Field label={`${t.openingBalance} · ${currency}`} key={currency}><input inputMode="decimal" required value={inputs[currency] ?? ''} onChange={(event) => setInputs((current) => ({ ...current, [currency]: event.target.value }))} /></Field>)}</div>
    <Field label={t.primaryCurrency}><CurrencySelect codes={codes} value={primary} onChange={setPrimary} /></Field>
    {!props.isPersonal&&<Field label={t.ownership}><select value={scope} onChange={(event) => setScope(event.target.value as Account['ownershipScope'])}><option value="personal">{t.personal}</option><option value="shared">{t.shared}</option></select></Field>}
    <ErrorMessage message={error} /><SubmitButtons busy={busy} t={t} onClose={onClose} />
    {existing && <button type="button" disabled={busy} className="danger" onClick={() => setDeleting(true)}>{t.deleteAccount}</button>}
  </form></Dialog>;
}

function AccountDeletion({ accountId, onClose, onCancel, ...props }: FeatureProps & { accountId: string; onClose: () => void; onCancel: () => void }) {
  const { snapshot, t, command, busy, locale, moneyDisplay } = props;
  const account = snapshot.accounts.find((item) => item.id === accountId && !item.deletedAt);
  const [mode, setMode] = useState<'' | 'remove' | 'transfer'>('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const targets = snapshot.accounts.filter((item) => !item.deletedAt && item.id !== accountId);
  const date = today();
  const values = account ? accountBalances(snapshot, account, date) : [];
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!account || busy || !mode || mode === 'transfer' && !destination) return;
    setError('');
    try {
      await command({ type: 'account.delete', id: account.id, expectedRevision: account.revision, asOf: date, expectedBalances: values, destinationAccountId: mode === 'transfer' ? destination : null });
      onClose();
    } catch (failure) { setError(errorText(failure, t)); }
  }
  return <Dialog title={t.deleteAccount} onClose={onCancel} busy={busy} t={t}><form onSubmit={(event)=>void remove(event)}>
    <h3>{account?.name}</h3><p className="hint">{t.deleteAccountHint}</p>
    <div className="detail-balance">{values.map((value)=><div key={value.currency}><span>{value.currency}</span><Amount value={value} locale={locale} display={moneyDisplay}/></div>)}</div>
    <Field label={t.balanceAction}><select required value={mode} onChange={(event)=>setMode(event.target.value as typeof mode)}><option value="">—</option><option value="remove">{t.removeBalance}</option><option value="transfer" disabled={!targets.length}>{t.moveBalance}</option></select></Field>
    {mode==='remove'&&<p className="hint">{t.removeBalanceHint}</p>}
    {mode==='transfer'&&<><Field label={t.destination}><select required value={destination} onChange={(event)=>setDestination(event.target.value)}><option value="">—</option>{targets.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><p className="hint">{t.moveBalanceHint}</p></>}
    {!targets.length&&<p className="hint">{t.noTransferAccount}</p>}
    <ErrorMessage message={error}/><div className="actions"><button className="danger" disabled={busy||!account||!mode||mode==='transfer'&&!destination}>{busy?t.saving:t.deleteAccount}</button><button type="button" disabled={busy} onClick={onCancel}>{t.cancel}</button></div>
  </form></Dialog>;
}
