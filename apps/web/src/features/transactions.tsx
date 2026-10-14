import { useEffect, useState } from 'react';
import type { Transaction } from '@rttw/domain';
import { request } from '../data/api';
import { categoryLabel } from '../data/derived';
import { errorText } from '../data/use-ledger';
import { displayDate, today } from '../format';
import { Amount, Dialog, ErrorMessage, Field, currencies, type FeatureProps } from '../components/shared';
import { Icon, ui, Heading } from '../components/design';
import { CategoryBadge } from './categories';
import { TransactionEditor } from './transaction-editor';

type Filters = { search: string; from: string; to: string; account: string; category: string; currency: string; member: string; source: string; type: string };
const emptyFilters: Filters = { search: '', from: '', to: '', account: '', category: '', currency: '', member: '', source: '', type: '' };
export type Member = { id: string; userId: string; displayName: string; email: string; role: 'owner' | 'member' };
export function Transactions(props: FeatureProps) {
  const { snapshot, t, language, locale, command, busy, moneyDisplay } = props;
  const [filters, setFilters] = useState<Filters>(() => ({ ...emptyFilters, account: new URLSearchParams(location.hash.split('?')[1]).get('account') ?? '', category: new URLSearchParams(location.hash.split('?')[1]).get('category') ?? '' }));
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [undo, setUndo] = useState<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let alive = true; void request<{ members: Member[] }>(`/api/web/households/${snapshot.household.id}/members`).then((result) => { if (alive) setMembers(result.members); }).catch(() => {}); return () => { alive = false; }; }, [snapshot.household.id]);
  const change = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const creditIds = new Set(snapshot.transferLinks.filter((item) => !item.deletedAt).map((item) => item.creditTransactionId));
  const retiredTemplates = new Set(snapshot.recurringRules.filter((rule) => rule.payment && rule.templateTransactionId).map((rule) => rule.templateTransactionId));
  const visible = snapshot.transactions.filter((item) => {
    if (item.deletedAt) return false;
    if (item.status === 'planned' && retiredTemplates.has(item.id)) return false;
    const link = snapshot.transferLinks.find((value) => !value.deletedAt && (value.debitTransactionId === item.id || value.creditTransactionId === item.id));
    const counterpart = link ? snapshot.transactions.find((value) => value.id === (link.debitTransactionId === item.id ? link.creditTransactionId : link.debitTransactionId)) : undefined;
    if (creditIds.has(item.id)) return false;
    if (filters.account && item.accountId !== filters.account && counterpart?.accountId !== filters.account) return false;
    if (filters.category && item.categoryId !== filters.category && !snapshot.splits.some((split) => !split.deletedAt && split.transactionId === item.id && split.categoryId === filters.category)) return false;
    if (filters.currency && item.originalAmount.currency !== filters.currency) return false;
    if (filters.member && item.memberId !== filters.member) return false;
    if (filters.source && item.source !== filters.source) return false;
    if (filters.type && item.transactionType !== filters.type) return false;
    if (filters.from && item.transactionDate < filters.from) return false;
    if (filters.to && item.transactionDate > filters.to) return false;
    const category = snapshot.categories.find((value) => value.id === item.categoryId);
    const account = snapshot.accounts.find((value) => value.id === item.accountId);
    return !filters.search || `${item.description ?? ''} ${item.notes ?? ''} ${category?.names[language] ?? ''} ${account?.name ?? ''}`.toLocaleLowerCase(locale).includes(filters.search.toLocaleLowerCase(locale));
  }).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt));
  async function deleteTransaction() {
    if (!deleting) return;
    try {
      const result = await command({ type: 'transaction.delete', id: deleting.id, expectedRevision: deleting.revision });
      setUndo({ id: deleting.id, revision: result.transactions.find((item) => item.id === deleting.id)?.revision ?? deleting.revision + 1 }); setDeleting(null); setError('');
    } catch (failure) { setError(errorText(failure, t)); }
  }
  async function restore() {
    if (!undo) return;
    try { await command({ type: 'transaction.restore', id: undo.id, expectedRevision: undo.revision }); setUndo(null); setError(''); } catch (failure) { setError(errorText(failure, t)); }
  }
  async function copy(transaction: Transaction) {
    try { await command({ type: 'transaction.copy', id: transaction.id, expectedRevision: transaction.revision }); setError(''); } catch (failure) { setError(errorText(failure, t)); }
  }
  const planned = visible.filter((item) => item.status === 'planned' || item.transactionDate > today());
  const actual = visible.filter((item) => (item.status === 'confirmed' || item.status === 'fx_pending') && item.transactionDate <= today());
  const reviews = visible.filter((item) => item.status === 'review' && item.transactionDate <= today());
  return <><Heading title={t.transactions} subtitle={ui(language,'monthTotal')} action={<button className="icon-button outlined" aria-label={t.newTransaction} onClick={()=>setEditing('new')} disabled={!snapshot.accounts.some(a=>!a.isArchived&&!a.deletedAt)}><Icon name="plus"/></button>}/>
    {!snapshot.accounts.some((item) => !item.isArchived && !item.deletedAt) && <p className="hint"><a href="#accounts">{t.newAccount}</a></p>}
    <Field label={t.search}><input type="search" placeholder={t.search} value={filters.search} onChange={(event) => change('search', event.target.value)} /></Field>
    <details className="card filters"><summary><Icon name="filter" size={18}/>{t.filters}{Object.values(filters).some(Boolean) ? ' •' : ''}</summary><div className="form-grid">
      <Field label={t.from}><input type="date" value={filters.from} onChange={(event) => change('from', event.target.value)} /></Field><Field label={t.to}><input type="date" value={filters.to} onChange={(event) => change('to', event.target.value)} /></Field>
      <Field label={t.account}><select value={filters.account} onChange={(event) => change('account', event.target.value)}><option value="">{t.all}</option>{snapshot.accounts.filter((item) => !item.deletedAt).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label={t.category}><select value={filters.category} onChange={(event) => change('category', event.target.value)}><option value="">{t.all}</option>{snapshot.categories.filter((item) => !item.deletedAt).map((item) => <option key={item.id} value={item.id}>{categoryLabel(item, snapshot.categories, language)}</option>)}</select></Field>
      <Field label={t.currency}><select value={filters.currency} onChange={(event) => change('currency', event.target.value)}><option value="">{t.all}</option>{currencies.map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label={t.member}><select value={filters.member} onChange={(event) => change('member', event.target.value)}><option value="">{t.all}</option>{(members.length ? members : [snapshot.member]).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
      <Field label={t.source}><select value={filters.source} onChange={(event) => change('source', event.target.value)}><option value="">{t.all}</option>{(['manual', 'import', 'recurring', 'bank_api'] as const).map((value) => <option value={value} key={value}>{value === 'recurring' ? t.recurring : t[value]}</option>)}</select></Field>
      <Field label={t.type}><select value={filters.type} onChange={(event) => change('type', event.target.value)}><option value="">{t.all}</option>{(['expense', 'income', 'transfer', 'refund', 'adjustment', 'debt_payment'] as const).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></Field>
    </div><button onClick={() => setFilters(emptyFilters)}>{t.reset}</button></details>
    <ErrorMessage message={error} />{undo && <div className="notice"><span>{t.deleted}</span><button disabled={busy} onClick={() => void restore()}>{t.undo}</button></div>}
    {!!planned.length && <><h2>{t.upcoming}</h2><TransactionRows {...props} rows={planned} onEdit={setEditing} onDelete={setDeleting} onCopy={(item) => void copy(item)} members={members} /></>}
    {!!actual.length && <><h2>{t.confirmed}</h2><TransactionRows {...props} rows={actual} onEdit={setEditing} onDelete={setDeleting} onCopy={(item) => void copy(item)} members={members} /></>}
    {!!reviews.length && <><h2>{t.review}</h2><TransactionRows {...props} rows={reviews} onEdit={setEditing} onDelete={setDeleting} onCopy={(item) => void copy(item)} members={members} /></>}
    {!visible.length && <p className="empty">{snapshot.transactions.some((item) => !item.deletedAt && !(item.status === 'planned' && retiredTemplates.has(item.id))) ? t.noMatches : t.empty}</p>}
    {editing && <TransactionEditor {...props} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    {deleting && <Dialog title={t.delete} onClose={() => setDeleting(null)} t={t}><p>{t.deleteConfirm}</p><p>{deleting.description ?? t[deleting.transactionType]} · <Amount value={deleting.originalAmount} locale={locale} display={moneyDisplay} /></p><ErrorMessage message={error} /><div className="actions"><button className="danger" disabled={busy} onClick={() => void deleteTransaction()}>{busy ? t.saving : t.delete}</button><button disabled={busy} onClick={() => setDeleting(null)}>{t.cancel}</button></div></Dialog>}
  </>;
}

function TransactionRows({ rows, onEdit, onDelete, onCopy, members, ...props }: FeatureProps & { rows: Transaction[]; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void; onCopy: (item: Transaction) => void; members: Member[] }) {
  const { snapshot,t,language,locale,busy,moneyDisplay }=props;
  const [selected,setSelected]=useState<Transaction|null>(null);
  const groups=[...new Set(rows.map(r=>r.transactionDate))];
  const details=(transaction:Transaction)=>{
    const account=snapshot.accounts.find(a=>a.id===transaction.accountId),category=snapshot.categories.find(c=>c.id===transaction.categoryId);
    const link=snapshot.transferLinks.find(l=>!l.deletedAt&&l.debitTransactionId===transaction.id),credit=link&&snapshot.transactions.find(t=>t.id===link.creditTransactionId),target=credit&&snapshot.accounts.find(a=>a.id===credit.accountId);
    const splits=snapshot.splits.filter(s=>!s.deletedAt&&s.transactionId===transaction.id);
    return {account,category,link,target,splits};
  };
  return <div className="transaction-list">{groups.map(date=><section className="transaction-day" key={date}><h3>{date===today()?ui(language,'now'):displayDate(date,locale)}</h3>{rows.filter(r=>r.transactionDate===date).map(tx=>{const d=details(tx);return <button className="transaction-item" key={tx.id} onClick={()=>setSelected(tx)}>{d.category?<CategoryBadge category={d.category}/>:<span className="tile-icon blue"><Icon name={tx.transactionType==='transfer'?'transfer':'receipt'}/></span>}<span className="transaction-item-text"><strong>{tx.description??d.category?.names[language]??t[tx.transactionType]}</strong><small>{d.account?.name}{d.target?` → ${d.target.name}`:d.category?` · ${d.category.names[language]}`:d.splits.length?` · ${t.split}`:''}</small></span><span className={`transaction-item-amount ${tx.transactionType==='transfer'?'neutral':BigInt(tx.originalAmount.amountMinor)>0?'positive':''}`}><Amount value={d.link?d.link.sentAmount:tx.originalAmount} locale={locale} display={moneyDisplay}/>{tx.status!=='confirmed'&&<small>{t[tx.status]}</small>}</span></button>})}</section>)}
    {selected&&(()=>{const d=details(selected);return <Dialog title={t[ selected.transactionType ]} onClose={()=>setSelected(null)} t={t}><div className="transaction-detail-hero">{d.category&&<CategoryBadge category={d.category}/>}<h2>{selected.description??d.category?.names[language]??t[selected.transactionType]}</h2><div className={BigInt(selected.originalAmount.amountMinor)<0n?'negative':'positive'}><Amount value={selected.originalAmount} locale={locale} display={moneyDisplay}/></div></div><dl className="detail-list"><dt>{t.date}</dt><dd>{displayDate(selected.transactionDate,locale)}</dd><dt>{t.account}</dt><dd>{d.account?.name}</dd>{d.target&&<><dt>{t.destination}</dt><dd>{d.target.name}</dd></>}<dt>{t.category}</dt><dd>{d.category?categoryLabel(d.category,snapshot.categories,language):d.splits.length?t.split:t.noCategory}</dd><dt>{t.member}</dt><dd>{members.find(m=>m.id===selected.memberId)?.displayName??snapshot.member.displayName}</dd><dt>{t.source}</dt><dd>{t[selected.source==='recurring'?'recurring':selected.source]}</dd><dt>{t.type}</dt><dd>{t[selected.status]}</dd>{selected.reportingAmount&&selected.reportingAmount.currency!==selected.originalAmount.currency&&<><dt>{t.reportingAmount}</dt><dd><Amount value={selected.reportingAmount} locale={locale} display={moneyDisplay}/></dd></>}</dl>{d.splits.map(split=><div className="account-summary" key={split.id}><span>{snapshot.categories.find(c=>c.id===split.categoryId)?.names[language]}</span><Amount value={split.amount} locale={locale} display={moneyDisplay}/></div>)}{selected.notes&&<div className="card"><h3>{t.notes}</h3><p className="pre-wrap">{selected.notes}</p></div>}{selected.fxSnapshot&&<details className="entry-options"><summary>{t.rate}: {selected.fxSnapshot.rateDecimal}</summary><p className="hint">{selected.fxSnapshot.provider} · {t.requestedDate}: {selected.fxSnapshot.requestedDate} · {t.effectiveDate}: {selected.fxSnapshot.effectiveDate}</p></details>}<div className="actions">{['income','expense'].includes(selected.transactionType)&&<button className="primary" disabled={busy} onClick={()=>{onEdit(selected);setSelected(null)}}>{t.edit}</button>}{selected.transactionType!=='transfer'&&<button disabled={busy} onClick={()=>{onCopy(selected);setSelected(null)}}>{t.copy}</button>}<button className="danger" disabled={busy} onClick={()=>{onDelete(selected);setSelected(null)}}>{t.delete}</button></div>{selected.transactionType==='transfer'&&<p className="hint">{t.transferEditHint}</p>}</Dialog>})()}
  </div>;
}
