import { useEffect, useState } from 'react';
import type { Transaction } from '@rttw/domain';
import { request } from '../data/api';
import { categoryLabel } from '../data/derived';
import { errorText } from '../data/use-ledger';
import { displayDate, today } from '../format';
import { Amount, Dialog, ErrorMessage, Field, currencies, type FeatureProps } from '../components/shared';
import { TransactionEditor } from './transaction-editor';

type Filters = { search: string; from: string; to: string; account: string; category: string; currency: string; member: string; source: string; type: string };
const emptyFilters: Filters = { search: '', from: '', to: '', account: '', category: '', currency: '', member: '', source: '', type: '' };
export type Member = { id: string; userId: string; displayName: string; email: string; role: 'owner' | 'member' };
export function Transactions(props: FeatureProps) {
  const { snapshot, t, language, locale, command, busy, moneyDisplay } = props;
  const [filters, setFilters] = useState<Filters>(() => ({ ...emptyFilters, account: new URLSearchParams(location.hash.split('?')[1]).get('account') ?? '' }));
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
  return <><div className="section-heading"><h1>{t.transactions}</h1><button className="primary" onClick={() => setEditing('new')} disabled={!snapshot.accounts.some((item) => !item.isArchived && !item.deletedAt)}>{t.newTransaction}</button></div>
    {!snapshot.accounts.some((item) => !item.isArchived && !item.deletedAt) && <p className="hint"><a href="#accounts">{t.newAccount}</a></p>}
    <Field label={t.search}><input type="search" value={filters.search} onChange={(event) => change('search', event.target.value)} /></Field>
    <details className="card filters"><summary>{t.filters}{Object.values(filters).some(Boolean) ? ' •' : ''}</summary><div className="form-grid">
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
  const { snapshot, t, language, locale, busy, moneyDisplay } = props;
  return <div className="transaction-list">{rows.map((transaction) => {
    const account = snapshot.accounts.find((item) => item.id === transaction.accountId);
    const category = snapshot.categories.find((item) => item.id === transaction.categoryId);
    const splits = snapshot.splits.filter((item) => !item.deletedAt && item.transactionId === transaction.id);
    const link = snapshot.transferLinks.find((item) => !item.deletedAt && item.debitTransactionId === transaction.id);
    const credit = link && snapshot.transactions.find((item) => item.id === link.creditTransactionId);
    const target = credit && snapshot.accounts.find((item) => item.id === credit.accountId);
    return <article className="card transaction-row" key={transaction.id}><div className="transaction-main"><h3>{transaction.description ?? t[transaction.transactionType]}</h3><p className="muted">{displayDate(transaction.transactionDate, locale)} · {account?.name}{target ? ` → ${target.name}` : ''} · {t[transaction.transactionType]}</p>
      <p className="muted">{category ? categoryLabel(category, snapshot.categories, language) : splits.length ? splits.map((split) => snapshot.categories.find((item) => item.id === split.categoryId)?.names[language]).join(' + ') : transaction.transactionType === 'transfer' ? t.transfer : t.noCategory} · {members.find((item) => item.id === transaction.memberId)?.displayName ?? ''}</p>
      {transaction.notes && <details><summary>{t.notes}</summary><p className="pre-wrap">{transaction.notes}</p></details>}
      {transaction.fxSnapshot && <details><summary>{t.rate}: {transaction.fxSnapshot.rateDecimal}</summary><p>{transaction.fxSnapshot.provider} · {t.requestedDate}: {transaction.fxSnapshot.requestedDate} · {t.effectiveDate}: {transaction.fxSnapshot.effectiveDate}</p></details>}
    </div><div className="transaction-amount"><span className={BigInt(transaction.originalAmount.amountMinor) < 0n ? 'negative' : 'positive'}><Amount value={link ? link.sentAmount : transaction.originalAmount} locale={locale} display={moneyDisplay} /></span>
      {transaction.reportingAmount && transaction.reportingAmount.currency !== transaction.originalAmount.currency && <small>{t.reportingAmount}: <Amount value={transaction.reportingAmount} locale={locale} display={moneyDisplay} /></small>}
      {(transaction.status !== 'confirmed' || transaction.transactionDate > today()) && <span className="status">{t[transaction.transactionDate > today() ? 'planned' : transaction.status]}</span>}
    </div><div className="row-actions">{(['income', 'expense'] as string[]).includes(transaction.transactionType) && <button disabled={busy} onClick={() => onEdit(transaction)}>{t.edit}</button>}{transaction.transactionType !== 'transfer' && <button disabled={busy} onClick={() => onCopy(transaction)}>{t.copy}</button>}<button disabled={busy} className="danger" onClick={() => onDelete(transaction)}>{t.delete}</button>{transaction.transactionType === 'transfer' && <small className="hint">{t.transferEditHint}</small>}</div></article>;
  })}</div>;
}
