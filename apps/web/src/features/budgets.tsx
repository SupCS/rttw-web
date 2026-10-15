import { useState, type FormEvent } from 'react';
import { budgetTransactions, calculateMonthlyBudget, parseMajorAmount, type BudgetProgress, type MonthlyBudget, type MoneyCurrencyCode } from '@rttw/domain';
import { Amount, CurrencySelect, Dialog, ErrorMessage, Field, SubmitButtons, majorInput, type FeatureProps } from '../components/shared';
import { Icon, MonthPicker } from '../components/design';
import { audit, categoryLabel } from '../data/derived';
import { useReportAmounts } from '../data/reporting';
import { errorText } from '../data/use-ledger';
import { ApiError } from '../data/api';
import { today } from '../format';
import { CategoryBadge } from './categories';
import './budgets.css';

type Editing = { existing?: MonthlyBudget; copy?: MonthlyBudget };
const validMonth = /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/;
function previousMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  return number === 1 ? `${String(year! - 1).padStart(4, '0')}-12` : `${String(year).padStart(4, '0')}-${String(number! - 1).padStart(2, '0')}`;
}

export function Budgets(props: FeatureProps) {
  const { snapshot, t, busy, command, locale } = props;
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<MonthlyBudget | null>(null);
  const [error, setError] = useState('');
  const budget = snapshot.budgets.find(item => item.month === month && !item.deletedAt);
  const previous = snapshot.budgets.find(item => item.month === previousMonth(month) && !item.deletedAt);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`));
  async function remove() {
    if (!deleting) return;
    setError('');
    try { await command({ type: 'budget.delete', id: deleting.id, expectedRevision: deleting.revision }); setDeleting(null); }
    catch (failure) { setError(errorText(failure, t)); }
  }
  return <div className="budgets-content">
    <p className="hint budget-intro">{t.budgetSubtitle}</p>
    <MonthPicker value={month} onChange={value => { if (validMonth.test(value)) { setMonth(value); setEditing(null); setError(''); } }} locale={locale} labels={{ month: t.month, previous: t.budgetPreviousMonth, next: t.budgetNextMonth }}/>
    {budget ? <>
      <div className="section-heading budget-section-heading"><h2>{monthLabel}</h2><button className="icon-button outlined" aria-label={t.budgetEdit} disabled={busy} onClick={() => setEditing({ existing: budget })}><Icon name="edit" size={18}/></button></div>
      <BudgetReadout {...props} budget={budget}/>
      <button className="budget-delete danger" disabled={busy} onClick={() => { setError(''); setDeleting(budget); }}>{t.budgetDelete}</button>
    </> : <section className="card budget-empty">
      <span className="tile-icon mint"><Icon name="target" size={30}/></span>
      <h2>{t.budgetEmptyTitle}</h2><p className="hint">{t.budgetEmptyHint}</p>
      <button className="primary" disabled={busy} onClick={() => setEditing({})}><Icon name="plus" size={18}/>{t.budgetCreate}</button>
      {previous && <button className="budget-copy" disabled={busy} onClick={() => setEditing({ copy: previous })}><Icon name="copy" size={16}/>{t.budgetCopy}</button>}
    </section>}
    <details className="budget-explainer"><summary><Icon name="info" size={16}/>{t.budgetHow}</summary><p>{t.budgetRules}</p><p>{t.budgetCategoryHint}</p><p>{t.budgetCurrencyHint}</p></details>
    <ErrorMessage message={deleting ? '' : error}/>
    {editing && <BudgetEditor {...props} month={month} monthLabel={monthLabel} editing={editing} onClose={() => setEditing(null)}/>}
    {deleting && <Dialog title={t.budgetDelete} t={t} busy={busy} onClose={() => setDeleting(null)}><p className="hint">{t.budgetDeleteConfirm}</p><ErrorMessage message={error}/><div className="actions"><button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? t.saving : t.delete}</button><button disabled={busy} onClick={() => setDeleting(null)}>{t.cancel}</button></div></Dialog>}
  </div>;
}

function BudgetReadout({ budget, ...props }: FeatureProps & { budget: MonthlyBudget }) {
  const { snapshot, t, locale, moneyDisplay } = props;
  const [retry, setRetry] = useState(0);
  const asOf = today();
  const transactions = budgetTransactions(snapshot, budget.month, asOf);
  const conversion = useReportAmounts(transactions, budget.currency, true, retry);
  const result = calculateMonthlyBudget(snapshot, budget, asOf, conversion.amounts);
  const daysLeft = budget.month === asOf.slice(0, 7)
    ? new Date(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)), 0).getDate() - Number(asOf.slice(8)) + 1 : 0;
  const money = (amount: bigint) => <Amount value={{ currency: budget.currency, amountMinor: amount.toString() }} locale={locale} display={moneyDisplay}/>;
  function meter(value: BudgetProgress, label: string) {
    return <progress max={100} value={value.progressPercent} aria-label={label}/>;
  }
  function status(value: BudgetProgress) {
    return t[value.state === 'over' ? 'budgetOver' : value.state === 'reached' ? 'budgetReached' : value.state === 'near' ? 'budgetNear' : value.state === 'incomplete' ? 'budgetIncomplete' : 'budgetComfortable'];
  }
  function remainder(value: BudgetProgress) {
    return <><span>{value.remainingMinor < 0n ? t.budgetOverBy : t.budgetRemaining}</span><strong>{money(value.remainingMinor < 0n ? -value.remainingMinor : value.remainingMinor)}</strong></>;
  }
  return <>
    {conversion.loading && <p className="hint" role="status">{t.budgetCalculating}</p>}
    {!conversion.loading && result.missingCount > 0 && <div className="notice budget-rate-notice"><p>{t.budgetMissingRates.replace('{count}', String(result.missingCount))}</p><button onClick={() => setRetry(value => value + 1)}>{t.retry}</button></div>}
    {result.overall ? <section className={`card budget-hero budget-state-${result.overall.state}`}>
      <div className="budget-card-top"><span>{t.budgetOverall}</span><span className="budget-status">{status(result.overall)}</span></div>
      <p className="budget-spent-label">{t.budgetSpent}{result.overall.missingCount > 0 ? ` · ${t.budgetKnownOnly}` : ''}</p>
      <div className="budget-hero-amount">{money(result.overall.spentMinor)}</div>
      <p className="budget-limit-caption">{t.budgetLimit} {money(result.overall.limitMinor)}</p>
      {meter(result.overall, t.budgetOverall)}
      <div className="budget-remaining">{remainder(result.overall)}</div>
      {daysLeft > 0 && !conversion.loading && !result.overall.missingCount && result.overall.remainingMinor > 0n && <div className="budget-daily"><Icon name="calendar" size={17}/><span>{t.budgetDaily}<strong>{money(result.overall.remainingMinor / BigInt(daysLeft))}</strong></span><small>{t.budgetDaysLeft.replace('{count}', String(daysLeft))}</small></div>}
    </section> : <p className="hint budget-no-overall">{t.budgetNoOverall}</p>}
    {result.categories.length > 0 && <section className="budget-categories" aria-label={t.budgetCategoryLimits}>
      <div className="section-heading"><h2>{t.budgetCategoryLimits}</h2><span className="count-label">{result.categories.length}</span></div>
      {result.categories.map(value => {
        const category = snapshot.categories.find(item => item.id === value.categoryId);
        const label = category ? categoryLabel(category, snapshot.categories, props.language) : t.noCategory;
        return <article className={`card budget-category budget-state-${value.state}`} key={value.categoryId}>
          <div className="budget-category-head">{category && <CategoryBadge category={category}/>}<div><h3>{label}</h3><small>{category?.deletedAt ? t.budgetDeletedCategory : status(value)}</small></div></div>
          <div className="budget-category-amounts"><strong>{money(value.spentMinor)}</strong><span>{t.budgetLimit} {money(value.limitMinor)}</span></div>
          {meter(value, label)}<div className="budget-remaining">{remainder(value)}</div>
          {value.missingCount > 0 && <p className="hint">{t.budgetIncomplete}</p>}
        </article>;
      })}
    </section>}
  </>;
}

function BudgetEditor({ month, monthLabel, editing, onClose, ...props }: FeatureProps & { month: string; monthLabel: string; editing: Editing; onClose: () => void }) {
  const { snapshot, t, command, busy, language } = props;
  const { existing, copy } = editing;
  const source = existing ?? copy;
  const [fields] = useState(() => audit(snapshot.userId, existing));
  const [currency, setCurrency] = useState<MoneyCurrencyCode>(source?.currency ?? snapshot.ledger.baseCurrency);
  const [includeTotal, setIncludeTotal] = useState(source ? source.totalLimitMinor !== null : false);
  const [total, setTotal] = useState(() => source?.totalLimitMinor ? majorInput({ amountMinor: source.totalLimitMinor, currency: source.currency }) : '');
  const [limits, setLimits] = useState(() => (source?.categoryLimits ?? [])
    .filter(limit => !copy || snapshot.categories.some(category => category.id === limit.categoryId && !category.deletedAt && category.applicability !== 'income'))
    .map(limit => ({ key: crypto.randomUUID(), categoryId: limit.categoryId, amount: majorInput({ amountMinor: limit.limitMinor, currency: source!.currency }) })));
  const [error, setError] = useState('');
  const categories = snapshot.categories.filter(category => !category.deletedAt && category.applicability !== 'income');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    function amount(value: string) {
      const result = parseMajorAmount(value, currency).amountMinor;
      if (result <= 0n || result > 9223372036854775807n) throw new Error('Invalid limit');
      return result.toString();
    }
    let totalLimitMinor: string | null;
    let categoryLimits: MonthlyBudget['categoryLimits'];
    try {
      totalLimitMinor = includeTotal ? amount(total) : null;
      if (!includeTotal && !limits.length || limits.some(limit => !limit.categoryId) || new Set(limits.map(limit => limit.categoryId)).size !== limits.length) throw new Error('Invalid budget');
      categoryLimits = limits.map(limit => ({ categoryId: limit.categoryId, limitMinor: amount(limit.amount) }));
    } catch { setError(t.budgetInvalid); return; }
    try { await command({ type: 'budget.save', expectedRevision: existing?.revision ?? 0, budget: { ...fields, ledgerId: snapshot.ledger.id, month, currency, totalLimitMinor, categoryLimits } }); onClose(); }
    catch (failure) { setError(failure instanceof ApiError && failure.code === 'invalid_ledger_command' ? t.budgetInvalid : errorText(failure, t)); }
  }
  return <Dialog title={existing ? t.budgetEdit : t.budgetCreate} t={t} busy={busy} onClose={onClose} className="budget-editor">
    <form onSubmit={event => void save(event)}>
    <div className="budget-editor-body"><fieldset className="budget-form-fields" disabled={busy}>
      <div className="budget-editor-context"><p className="budget-editor-month"><Icon name="calendar" size={18}/><span>{monthLabel}</span></p><Field label={t.currency}><CurrencySelect value={currency} onChange={setCurrency}/></Field></div>
      {copy && <p className="hint">{t.budgetCopyHint}</p>}
      <section className="budget-overall-control" data-enabled={includeTotal}>
        <button className="budget-total-toggle" type="button" role="switch" aria-checked={includeTotal} aria-label={t.budgetOverall} aria-controls={`budget-total-${fields.id}`} onClick={() => setIncludeTotal(value => !value)}>
          <span className="budget-toggle-label"><strong>{t.budgetOverall}</strong><span>{t.budgetOverallHint}</span></span><span className="budget-switch-track" aria-hidden="true"><span/></span>
        </button>
        <div id={`budget-total-${fields.id}`} hidden={!includeTotal} className="budget-overall-amount">{includeTotal && <Field label={`${t.budgetLimit} · ${currency}`}><input required inputMode="decimal" maxLength={25} placeholder="0" value={total} onChange={event => setTotal(event.target.value)}/></Field>}</div>
      </section>
      <div className="section-heading budget-editor-category-heading"><h3>{t.budgetCategoryLimits}</h3>{limits.length > 0 && <span className="count-label">{limits.length}</span>}</div>
      {limits.length === 0 && <p className="hint budget-category-empty-hint">{t.budgetCategoriesHint}</p>}
      {limits.map((limit, index) => {
        const retired = snapshot.categories.find(category => category.id === limit.categoryId && category.deletedAt);
        return <section className="budget-limit-row" key={limit.key} aria-label={t.budgetCategoryLimit.replace('{number}', String(index + 1))}>
          <div className="budget-limit-row-heading"><span>{t.budgetCategoryLimit.replace('{number}', String(index + 1))}</span><button className="icon-button" type="button" aria-label={`${t.budgetRemoveCategory} ${index + 1}`} onClick={() => setLimits(rows => rows.filter(row => row.key !== limit.key))}><Icon name="close" size={18}/></button></div>
          <Field label={t.category}><select required value={limit.categoryId} onChange={event => setLimits(rows => rows.map(row => row.key === limit.key ? { ...row, categoryId: event.target.value } : row))}><option value="">{t.budgetChooseCategory}</option>{retired && <option value={retired.id}>{categoryLabel(retired, snapshot.categories, language)} · {t.budgetDeletedCategory}</option>}{categories.map(category => <option key={category.id} value={category.id} disabled={limits.some(row => row.key !== limit.key && row.categoryId === category.id)}>{categoryLabel(category, snapshot.categories, language)}</option>)}</select></Field>
          <Field label={`${t.budgetLimit} · ${currency}`}><input required inputMode="decimal" maxLength={25} placeholder="0" value={limit.amount} onChange={event => setLimits(rows => rows.map(row => row.key === limit.key ? { ...row, amount: event.target.value } : row))}/></Field>
        </section>;
      })}
      <button className="budget-add-category" type="button" disabled={limits.length >= 500 || limits.some(limit => !limit.categoryId) || !categories.some(category => !limits.some(limit => limit.categoryId === category.id))} onClick={() => setLimits(rows => [...rows, { key: crypto.randomUUID(), categoryId: '', amount: '' }])}><Icon name="plus" size={16}/>{t.budgetAddCategory}</button>
      <details className="budget-explainer budget-editor-help"><summary><Icon name="info" size={16}/>{t.budgetEditorHelp}</summary><p>{t.budgetCategoryHint}</p><p>{t.budgetCurrencyHint}</p></details>
    </fieldset></div><div className="budget-editor-footer"><ErrorMessage message={error}/><SubmitButtons busy={busy} t={t} onClose={onClose}/></div></form>
  </Dialog>;
}
