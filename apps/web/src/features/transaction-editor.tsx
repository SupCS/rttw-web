import { useState, type FormEvent } from 'react';
import { convertMoney, deserializeMoney, parseMajorAmount, serializeMoney, type MoneyCurrencyCode, type Transaction, type TransactionSplit } from '@rttw/domain';
import { audit, categoryLabel } from '../data/derived';
import { rates } from '../data/api';
import { errorText } from '../data/use-ledger';
import { Icon, ui } from '../components/design';
import { CategoryBadge } from './categories';
import { today } from '../format';
import { CurrencySelect, Dialog, ErrorMessage, Field, SubmitButtons, majorInput, text, type FeatureProps } from '../components/shared';

type EntryType = 'expense' | 'income' | 'transfer';
type DraftSplit = { key: string; categoryId: string; amount: string; existing?: TransactionSplit };
export function TransactionEditor({ existing, onClose, ...props }: FeatureProps & { existing: Transaction | undefined; onClose: () => void }) {
  const { snapshot, t, language, command } = props;
  const [fields] = useState(() => audit(snapshot.member.id, existing));
  const [transferIds] = useState(() => ({ debit: crypto.randomUUID(), credit: crypto.randomUUID(), link: crypto.randomUUID(), fee: crypto.randomUUID() }));
  const accounts = snapshot.accounts.filter((item) => !item.deletedAt && (!item.isArchived || item.id === existing?.accountId));
  const initialAccount = accounts.find((item) => item.id === existing?.accountId) ?? accounts[0];
  const [type, setType] = useState<EntryType>(existing?.transactionType === 'income' ? 'income' : 'expense');
  const [accountId, setAccountId] = useState(initialAccount?.id ?? '');
  const [currency, setCurrency] = useState(existing?.originalAmount.currency ?? initialAccount?.primaryCurrency ?? snapshot.household.baseCurrency);
  const [destination, setDestination] = useState('');
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [split, setSplit] = useState(snapshot.splits.some((item) => item.transactionId === existing?.id && !item.deletedAt));
  const [splits, setSplits] = useState<DraftSplit[]>(() => snapshot.splits.filter((item) => item.transactionId === existing?.id && !item.deletedAt).map((item) => ({ key: item.id, categoryId: item.categoryId, amount: majorInput(item.amount), existing: item })));
  const [error, setError] = useState('');
  const [amount,setAmount]=useState(existing?majorInput(existing.originalAmount):'');
  const [keypad,setKeypad]=useState(true);
  const [dateValue,setDateValue]=useState(existing?.transactionDate??today());
  const [working, setWorking] = useState(false);
  const busy = working || props.busy;
  const account = accounts.find((item) => item.id === accountId);
  const codes = account?.openingBalances.map((value) => value.currency) ?? [currency];
  const applicable = snapshot.categories.filter((item) => !item.deletedAt && (!item.isArchived || item.id === categoryId || splits.some((value) => value.categoryId === item.id)) && (item.applicability === type || item.applicability === 'both'));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget); const date = text(data, 'date');
    const fxDate = existing?.postingDate ?? date;
    setError('');
    if (!account || !codes.includes(currency) || !date) { setError(t.invalidForm); return; }
    let entered;
    try { entered = parseMajorAmount(text(data, 'amount'), currency); if (entered.amountMinor <= 0n) throw new Error(); } catch { setError(t.invalidAmount); return; }
    const householdId = snapshot.household.id; const memberId = snapshot.member.id;
    const description = text(data, 'description') || null; const notes = text(data, 'notes') || null;
    const common = { householdId, memberId, categoryId: null, transactionDate: date, postingDate: null, source: 'manual' as const,
      status: date > today() ? 'planned' as const : 'confirmed' as const, reportingAmount: null, fxSnapshot: null, description, notes };
    setWorking(true);
    try {
      if (type === 'transfer') {
        const target = accounts.find((item) => item.id === destination && !item.isArchived && item.id !== accountId && item.openingBalances.some((value) => value.currency === currency));
        if (!target) { setError(t.invalidForm); return; }
        const debitAmount = serializeMoney({ ...entered, amountMinor: -entered.amountMinor });
        const creditAmount = serializeMoney(entered);
        const transferStatus = date > today() ? 'planned' : currency === snapshot.household.baseCurrency ? 'confirmed' : 'fx_pending';
        const debit: Transaction = { ...fields, id: transferIds.debit, ...common, transactionType: 'transfer', accountId, originalAmount: debitAmount, status: transferStatus, reportingAmount: currency === snapshot.household.baseCurrency ? debitAmount : null };
        const credit: Transaction = { ...fields, id: transferIds.credit, ...common, transactionType: 'transfer', accountId: target.id, originalAmount: creditAmount, status: transferStatus, reportingAmount: currency === snapshot.household.baseCurrency ? creditAmount : null };
        let fee: Transaction | undefined;
        if (text(data, 'fee')) {
          const value = parseMajorAmount(text(data, 'fee'), currency); if (value.amountMinor <= 0n) { setError(t.invalidAmount); return; }
          const feeAmount = serializeMoney({ ...value, amountMinor: -value.amountMinor });
          fee = { ...fields, id: transferIds.fee, ...common, accountId, transactionType: 'expense', description: t.transferFee, originalAmount: feeAmount,
            reportingAmount: currency === snapshot.household.baseCurrency ? feeAmount : null,
            status: date > today() ? 'planned' : currency === snapshot.household.baseCurrency ? 'confirmed' : 'fx_pending' };
        }
        await command({ type: 'transfer.create', debit, credit, link: { ...fields, id: transferIds.link, householdId, debitTransactionId: debit.id, creditTransactionId: credit.id,
          feeTransactionId: fee?.id ?? null, sentAmount: serializeMoney(entered), receivedAmount: serializeMoney(entered) }, ...(fee ? { fee } : {}) }); onClose(); return;
      }
      const original = serializeMoney({ ...entered, amountMinor: type === 'expense' ? -entered.amountMinor : entered.amountMinor });
      const savedSplits: TransactionSplit[] = [];
      if (split) {
        if (splits.length < 2 || new Set(splits.map((item) => item.categoryId)).size !== splits.length) { setError(t.splitError); return; }
        let total = 0n;
        for (const item of splits) {
          const value = parseMajorAmount(item.amount, currency);
          if (value.amountMinor <= 0n || !applicable.some((candidate) => candidate.id === item.categoryId)) { setError(t.splitError); return; }
          total += value.amountMinor;
          savedSplits.push({ ...audit(memberId, item.existing), id: item.key, householdId, transactionId: fields.id, categoryId: item.categoryId,
            amount: serializeMoney({ ...value, amountMinor: type === 'expense' ? -value.amountMinor : value.amountMinor }) });
        }
        if (total !== entered.amountMinor) { setError(t.splitError); return; }
      }
      let reportingAmount = currency === snapshot.household.baseCurrency ? original : null;
      let fxSnapshot: Transaction['fxSnapshot'] = null;
      const manual = text(data, 'manualRate').replace(',', '.');
      if (!manual && existing?.reportingAmount && existing.originalAmount.currency === currency && existing.transactionDate === date) {
        fxSnapshot = existing.fxSnapshot;
        reportingAmount = existing.fxSnapshot ? serializeMoney(convertMoney(deserializeMoney(original), existing.reportingAmount.currency, existing.fxSnapshot.rateDecimal)) : existing.reportingAmount.currency === currency ? original : existing.reportingAmount;
      } else if (currency !== snapshot.household.baseCurrency) {
        if (manual) {
          try { reportingAmount = serializeMoney(convertMoney(deserializeMoney(original), snapshot.household.baseCurrency, manual)); } catch { setError(t.invalidAmount); return; }
          fxSnapshot = { rateDecimal: manual, provider: 'manual', requestedDate: fxDate, effectiveDate: fxDate };
        } else {
          try {
            const result = await rates(currency, snapshot.household.baseCurrency, fxDate);
            const rate = result.rates.find((item) => item.base === currency && item.quote === snapshot.household.baseCurrency);
            if (rate) {
              reportingAmount = serializeMoney(convertMoney(deserializeMoney(original), snapshot.household.baseCurrency, rate.rateDecimal));
              fxSnapshot = { rateDecimal: rate.rateDecimal, provider: rate.provider, requestedDate: rate.requestedDate, effectiveDate: rate.effectiveDate };
            }
          } catch { /* A provider outage leaves an explicit FX-pending record; the ledger still requires a successful server write. */ }
        }
      }
      await command({ type: 'transaction.save', expectedRevision: existing?.revision ?? 0, transaction: { ...fields, ...common,
        postingDate: existing?.postingDate ?? null, source: existing?.source ?? 'manual', accountId, categoryId: split ? null : categoryId || null,
        transactionType: type, originalAmount: original, reportingAmount, fxSnapshot,
        status: date > today() ? 'planned' : reportingAmount ? 'confirmed' : 'fx_pending' }, splits: savedSplits }); onClose();
    } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  const selectAccount=(id:string)=>{const item=accounts.find(a=>a.id===id);setAccountId(id);if(item&&!item.openingBalances.some(v=>v.currency===currency))setCurrency(item.primaryCurrency)};
  const press=(key:string)=>{setAmount(v=>key==='back'?v.slice(0,-1):key==='.'?(v.includes('.')?v:(v||'0')+'.'):v.length<15?(v==='0'?key:v+key):v)};
  return <Dialog title={existing?t.editTransaction:t.newTransaction} onClose={onClose} t={t} busy={busy}><form className="entry-form" onSubmit={event=>void save(event)}>
    <div className="entry-types segmented-control">{(['expense','income',...(!existing?['transfer']:[])] as EntryType[]).map(value=><button key={value} type="button" aria-pressed={type===value} onClick={()=>{setType(value);setCategoryId('');setSplit(false)}}><Icon name={value==='expense'?'arrow':value==='income'?'income':'transfer'} size={16}/>{t[value]}</button>)}</div>
    <label className="entry-date"><Icon name="calendar" size={16}/><span>{dateValue===today()?ui(language,'now'):dateValue}</span><Icon name="down" size={12}/><input type="date" name="date" required value={dateValue} onChange={e=>setDateValue(e.target.value)}/></label>
    <div className={`entry-amount ${type}`}><input aria-label={t.amount} name="amount" inputMode="decimal" required value={amount} placeholder="0" readOnly={keypad} onChange={e=>setAmount(e.target.value)}/><CurrencySelect value={currency} onChange={setCurrency} codes={codes}/></div>
    <div className="entry-selection"><Field label={t.account}><select value={accountId} onChange={e=>selectAccount(e.target.value)} required><option value="">—</option>{accounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{type==='transfer'?<Field label={t.destination}><select value={destination} onChange={e=>setDestination(e.target.value)} required><option value="">—</option>{accounts.filter(item=>!item.isArchived&&item.id!==accountId&&item.openingBalances.some(v=>v.currency===currency)).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>:<Field label={t.category}><select value={categoryId} disabled={split} onChange={e=>setCategoryId(e.target.value)}><option value="">{split?t.split:t.noCategory}</option>{applicable.map(item=><option key={item.id} value={item.id}>{categoryLabel(item,snapshot.categories,language)}</option>)}</select></Field>}</div>
    {type!=='transfer'&&!split&&<div className="quick-categories">{applicable.filter(c=>!c.parentId).slice(0,8).map(c=><button type="button" key={c.id} aria-pressed={categoryId===c.id} onClick={()=>setCategoryId(c.id)}><CategoryBadge category={c}/><span>{c.names[language]}</span></button>)}</div>}
    <Field label={t.description}><input className="description-input" name="description" placeholder={t.description} maxLength={500} defaultValue={existing?.description??''}/></Field>
    <details className="entry-options"><summary><Icon name="more" size={16}/>{ui(language,'advanced')}<Icon name="down" size={14}/></summary>
    {type==='transfer'?<><Field label={`${t.fee} · ${currency}`}><input name="fee" inputMode="decimal"/></Field><p className="hint">{t.transferHint}</p></>:<>
      <label className="check"><input type="checkbox" checked={split} onChange={e=>{setSplit(e.target.checked);if(e.target.checked&&!splits.length)setSplits([{key:crypto.randomUUID(),categoryId:'',amount:''},{key:crypto.randomUUID(),categoryId:'',amount:''}])}}/>{t.split}</label>
      {split&&<fieldset><legend>{t.categories}</legend>{splits.map((item,index)=><div className="split-row" key={item.key}><Field label={`${t.category} ${index+1}`}><select value={item.categoryId} onChange={e=>setSplits(current=>current.map(v=>v.key===item.key?{...v,categoryId:e.target.value}:v))} required><option value="">—</option>{applicable.map(v=><option key={v.id} value={v.id}>{categoryLabel(v,snapshot.categories,language)}</option>)}</select></Field><Field label={`${t.amount} · ${currency}`}><input inputMode="decimal" required value={item.amount} onChange={e=>setSplits(current=>current.map(v=>v.key===item.key?{...v,amount:e.target.value}:v))}/></Field><button type="button" onClick={()=>setSplits(current=>current.filter(v=>v.key!==item.key))} aria-label={`${t.remove} ${index+1}`}><Icon name="close" size={16}/></button></div>)}<button type="button" onClick={()=>setSplits(current=>[...current,{key:crypto.randomUUID(),categoryId:'',amount:''}])}>{t.addSplit}</button></fieldset>}
      {currency!==snapshot.household.baseCurrency&&<><Field label={`${t.manualRate} · ${snapshot.household.baseCurrency}`}><input name="manualRate" inputMode="decimal" placeholder={existing?.fxSnapshot?.rateDecimal??''}/></Field><p className="hint">{t.fxHint}</p>{existing?.fxSnapshot&&<p className="hint">{t.rate}: {existing.fxSnapshot.rateDecimal} · {existing.fxSnapshot.provider} · {existing.fxSnapshot.effectiveDate}</p>}</>}
    </>}
    <Field label={t.notes}><textarea name="notes" rows={2} maxLength={4000} defaultValue={existing?.notes??''}/></Field></details>
    <div className="keypad-toggle"><label className="check"><input type="checkbox" checked={keypad} onChange={e=>setKeypad(e.target.checked)}/>{ui(language,'keypad')}</label></div>
    {keypad&&<div className="keypad">{['1','2','3','4','5','6','7','8','9','.','0','back'].map(key=><button type="button" key={key} aria-label={key==='back'?t.remove:key} onClick={()=>press(key)}>{key==='back'?<Icon name="backspace" size={24}/>:key}</button>)}</div>}
    <ErrorMessage message={error}/><div className="entry-submit"><button className="primary full-width" disabled={busy}><Icon name="check" size={20}/>{busy?t.saving:t.save}</button></div>
  </form></Dialog>;
}
