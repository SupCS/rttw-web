import { useState, type FormEvent } from 'react';
import { addDays, buildUpcomingItems, getRecurringPayment, nextOccurrence, occurrencesThrough, parseMajorAmount, type RecurringPayment, type RecurringRule } from '@rttw/domain';
import { audit, categoryLabel } from '../data/derived';
import { errorText } from '../data/use-ledger';
import { displayDate, today } from '../format';
import { Amount, CurrencySelect, Dialog, ErrorMessage, Field, majorInput, type FeatureProps } from '../components/shared';
import type { Text } from '../i18n';
import { Icon, Heading, ui } from '../components/design';
import { CategoryBadge } from './categories';

type Preset = 'monthly' | 'weekly' | 'yearly' | 'custom';
type DraftSplit = { key: string; categoryId: string; amount: string };
const presetFor = (rule?: RecurringRule): Preset => !rule || rule.frequency === 'monthly' && rule.interval === 1 ? 'monthly' : rule.frequency === 'weekly' && rule.interval === 1 ? 'weekly' : rule.frequency === 'monthly' && rule.interval === 12 ? 'yearly' : 'custom';
function scheduleLabel(rule: Pick<RecurringRule, 'frequency' | 'interval'>, t: Text, locale: string) {
  if (rule.interval === 1) return rule.frequency === 'weekly' ? t.weekly : rule.frequency === 'monthly' ? t.monthly : t.daily;
  if (rule.frequency === 'monthly' && rule.interval === 12) return t.yearly;
  const form = new Intl.PluralRules(locale).select(rule.interval);
  const words = rule.frequency === 'weekly' ? [t.recurringWeek, t.recurringWeeksFew, t.recurringWeeks] : rule.frequency === 'monthly' ? [t.recurringMonth, t.recurringMonthsFew, t.recurringMonths] : [t.recurringDay, t.recurringDaysFew, t.recurringDays];
  return `${t.recurringEvery} ${rule.interval} ${words[form === 'one' ? 0 : form === 'few' ? 1 : 2]}`;
}

export function Recurring(props: FeatureProps) {
  const { snapshot, t, locale, language, moneyDisplay, command, busy } = props;
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null);
  const [stopping, setStopping] = useState<RecurringRule | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const rules = snapshot.recurringRules.filter((item) => !item.deletedAt).sort((a, b) => Number(b.isActive) - Number(a.isActive) || (nextOccurrence(a, today()) ?? '9999').localeCompare(nextOccurrence(b, today()) ?? '9999'));
  const availableAccounts = snapshot.accounts.filter((item) => !item.deletedAt);
  const upcoming = buildUpcomingItems(rules.filter((rule) => {
    const payment = getRecurringPayment(rule, snapshot.transactions, snapshot.splits);
    return payment && availableAccounts.some((account) => account.id === payment.accountId);
  }), snapshot.transactions, today(), addDays(today(), 90), 12);
  async function toggle(rule: RecurringRule) {
    setError(''); setMessage('');
    try { await command({ type: 'recurring.save', rule: { ...rule, ...audit(snapshot.userId, rule), isActive: !rule.isActive }, expectedRevision: rule.revision, asOf: today() }); setMessage(rule.isActive ? t.paymentPaused : t.paymentResumed); }
    catch (failure) { setError(errorText(failure, t)); }
  }
  async function stop() {
    if (!stopping) return;
    try { await command({ type: 'recurring.delete', id: stopping.id, expectedRevision: stopping.revision }); setStopping(null); setMessage(t.paymentStopped); setError(''); }
    catch (failure) { setError(errorText(failure, t)); }
  }
  return <>
    <Heading title={t.recurring} subtitle={ui(language,'upcoming')} action={<button className="icon-button outlined" disabled={!availableAccounts.length||busy} onClick={()=>setEditing('new')} aria-label={t.newRule}><Icon name="plus"/></button>}/>
    <div className="schedule-banner"><span className="tile-icon lavender"><Icon name="calendar" size={24}/></span><div><strong>{rules.filter(r=>r.isActive).length} · {t.active.toLowerCase()}</strong><p>{t.recurringAutoHint}</p></div></div><ErrorMessage message={error} />{message && <p className="notice" role="status">{message}</p>}
    {!availableAccounts.length && <p className="notice">{t.recurringNeedsAccount} <a href="#accounts">{t.newAccount}</a></p>}
    {!rules.length && <div className="card recurring-empty"><h2>{t.recurringEmptyTitle}</h2><p className="hint">{t.recurringEmptyHint}</p>{!!availableAccounts.length && <button className="primary" disabled={busy} onClick={() => setEditing('new')}>{t.newRule}</button>}</div>}
    <div className="card-grid">{rules.map((rule) => {
      const payment = getRecurringPayment(rule, snapshot.transactions, snapshot.splits);
      const account = snapshot.accounts.find((item) => item.id === payment?.accountId);
      const category = snapshot.categories.find((item) => item.id === payment?.categoryId);
      const next = nextOccurrence(rule, today());
      const unavailable = !account || account.deletedAt;
      return <article className="card recurring-payment-card" key={rule.id}>
        <div className="section-heading"><div className="recurring-payment-name">{category && <CategoryBadge category={category} />}<div><h2>{payment?.description || category?.names[language] || (payment ? t[payment.transactionType] : t.recurringPayments)}</h2><p className="hint">{payment ? t[payment.transactionType] : ''} · {account?.name}</p></div></div><span className="status">{!rule.isActive ? t.paused : !next ? t.paymentCompleted : t.active}</span></div>
        {payment && <div className={`recurring-payment-amount ${payment.transactionType === 'income' ? 'positive' : 'negative'}`}><Amount value={{ ...payment.originalAmount, amountMinor: (BigInt(payment.originalAmount.amountMinor) < 0n ? -BigInt(payment.originalAmount.amountMinor) : BigInt(payment.originalAmount.amountMinor)).toString() }} locale={locale} display={moneyDisplay} /></div>}
        <p>{scheduleLabel(rule, t, locale)}</p><p className="hint">{rule.isActive && next ? `${t.nextPayment}: ${displayDate(next, locale)}` : rule.isActive ? t.paymentCompleted : t.paymentPausedHint}</p>
        {unavailable && <p className="notice">{t.recurringAccountUnavailable}</p>}
        {!!payment?.splits.length && <p className="hint">{payment.splits.map((split) => snapshot.categories.find((item) => item.id === split.categoryId)?.names[language]).filter(Boolean).join(' · ')}</p>}
        <div className="row-actions"><button disabled={busy} onClick={() => setEditing(rule)}>{t.edit}</button><button disabled={busy || !next || Boolean(unavailable)} onClick={() => void toggle(rule)}>{rule.isActive ? t.pausePayment : t.resumePayment}</button><button className="danger" disabled={busy} onClick={() => { setError(''); setStopping(rule); }}>{t.stopPayment}</button></div>
      </article>;
    })}</div>
    {!!rules.length && <section className="card recurring-upcoming"><h2>{t.nextPayments}</h2><p className="hint">{t.recurringUpcomingHint}</p>{upcoming.map((item) => <div className="account-summary" key={`${item.rule.id}:${item.occurrenceDate}`}><div><strong>{item.transaction.description || t[item.transaction.transactionType]}</strong><p className="hint">{displayDate(item.occurrenceDate, locale)} · {snapshot.accounts.find((account) => account.id === item.transaction.accountId)?.name}</p></div><Amount value={item.transaction.originalAmount} locale={locale} display={moneyDisplay} /></div>)}{!upcoming.length && <p className="empty">{t.noUpcomingPayments}</p>}</section>}
    {editing && <PaymentEditor {...props} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    {stopping && <Dialog title={t.stopPayment} onClose={() => setStopping(null)} t={t} busy={busy}><p>{t.stopPaymentConfirm}</p><ErrorMessage message={error} /><div className="actions"><button className="danger" disabled={busy} onClick={() => void stop()}>{busy ? t.saving : t.stopPayment}</button><button disabled={busy} onClick={() => setStopping(null)}>{t.cancel}</button></div></Dialog>}
  </>;
}

function PaymentEditor({ existing, onClose, ...props }: FeatureProps & { existing: RecurringRule | undefined; onClose: () => void }) {
  const { snapshot, t, language, locale, moneyDisplay, command, busy } = props;
  const initial = existing ? getRecurringPayment(existing, snapshot.transactions, snapshot.splits) : null;
  const [fields] = useState(() => audit(snapshot.userId, existing));
  const accounts = snapshot.accounts.filter((item) => !item.deletedAt);
  const initialAccount = accounts.find((item) => item.id === initial?.accountId) ?? accounts[0];
  const [name, setName] = useState(initial?.description ?? '');
  const [type, setType] = useState<'expense' | 'income'>(initial?.transactionType ?? 'expense');
  const [accountId, setAccountId] = useState(initialAccount?.id ?? '');
  const [currency, setCurrency] = useState(initial?.originalAmount.currency ?? initialAccount?.primaryCurrency ?? snapshot.ledger.baseCurrency);
  const [amount, setAmount] = useState(initial ? majorInput(initial.originalAmount) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [split, setSplit] = useState(Boolean(initial?.splits.length));
  const [splits, setSplits] = useState<DraftSplit[]>(() => (initial?.splits ?? []).map((item) => ({ key: crypto.randomUUID(), categoryId: item.categoryId, amount: majorInput(item.amount) })));
  const [preset, setPreset] = useState<Preset>(() => presetFor(existing));
  const [customInterval, setCustomInterval] = useState(String(existing?.interval ?? 1));
  const [unit, setUnit] = useState<'days' | 'weeks' | 'months'>(existing?.frequency === 'monthly' ? 'months' : existing?.frequency === 'weekly' ? 'weeks' : 'days');
  const [initialNext] = useState(() => existing ? nextOccurrence(existing, today()) ?? addDays(today(), 1) : today());
  const [preserveAnchor] = useState(() => Boolean(existing && nextOccurrence(existing, today())));
  const [firstDate, setFirstDate] = useState(initialNext);
  const [hasEnd, setHasEnd] = useState(Boolean(existing?.endsOn));
  const [endDate, setEndDate] = useState(existing?.endsOn ?? '');
  const [confirmPast, setConfirmPast] = useState(false);
  const [error, setError] = useState('');
  const account = accounts.find((item) => item.id === accountId);
  const codes = account?.openingBalances.map((value) => value.currency) ?? [currency];
  const applicable = snapshot.categories.filter((item) => !item.deletedAt && (item.applicability === type || item.applicability === 'both'));
  const frequency: RecurringRule['frequency'] = preset === 'yearly' || preset === 'monthly' ? 'monthly' : preset === 'weekly' ? 'weekly' : unit === 'months' ? 'monthly' : unit === 'weeks' ? 'weekly' : 'interval_days';
  const interval = preset === 'yearly' ? 12 : preset === 'custom' ? Number(customInterval) : 1;
  const startsOn = existing && preserveAnchor && firstDate === initialNext && frequency === existing.frequency && interval === existing.interval ? existing.startsOn : firstDate;
  const scheduleValid = Number.isInteger(interval) && interval > 0 && interval <= 36500 && /^\d{4}-\d{2}-\d{2}$/.test(firstDate) && (!hasEnd || /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= firstDate);
  const previewRule: RecurringRule = { ...fields, ledgerId: snapshot.ledger.id, templateTransactionId: existing?.templateTransactionId ?? null,
    frequency, interval, startsOn, endsOn: hasEnd ? endDate : null, isActive: true, skipThrough: existing ? today() : null };
  const dates: string[] = [];
  if (scheduleValid) {
    let cursor = addDays(today(), -1);
    for (let index = 0; index < 3; index++) { const next = nextOccurrence(previewRule, cursor); if (!next) break; dates.push(next); cursor = next; }
  }
  const dueCount = !existing && scheduleValid ? occurrencesThrough(previewRule, today(), 10001).length : 0;
  let entered: ReturnType<typeof parseMajorAmount> | null = null;
  try { const value = parseMajorAmount(amount, currency); if (value.amountMinor > 0n) entered = value; } catch { /* An incomplete amount stays editable. */ }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setError('');
    if (!name.trim() || !account || !codes.includes(currency) || !scheduleValid || existing && firstDate <= today() || dueCount > 10000 || !existing && firstDate < today() && !confirmPast) { setError(t.invalidForm); return; }
    if (!entered) { setError(t.invalidAmount); return; }
    const sign = type === 'expense' ? -1n : 1n;
    const originalAmount = { currency, amountMinor: (entered.amountMinor * sign).toString() };
    const paymentSplits: Array<{ categoryId: string; amount: typeof originalAmount }> = [];
    if (split) {
      try {
        if (splits.length < 2 || new Set(splits.map((item) => item.categoryId)).size !== splits.length) throw new Error();
        let total = 0n;
        for (const item of splits) {
          const value = parseMajorAmount(item.amount, currency);
          if (value.amountMinor <= 0n || !applicable.some((candidate) => candidate.id === item.categoryId)) throw new Error();
          total += value.amountMinor; paymentSplits.push({ categoryId: item.categoryId, amount: { currency, amountMinor: (value.amountMinor * sign).toString() } });
        }
        if (total !== entered.amountMinor) throw new Error();
      } catch { setError(t.splitError); return; }
    }
    const payment: RecurringPayment = { accountId, transactionType: type, categoryId: split ? null : categoryId || null,
      originalAmount, description: name.trim(), notes: notes.trim() || null, splits: paymentSplits };
    try { await command({ type: 'recurring.save', expectedRevision: existing?.revision ?? 0, asOf: today(), rule: { ...previewRule, payment, isActive: existing?.isActive ?? true } }); onClose(); }
    catch (failure) { setError(errorText(failure, t)); }
  }
  return <Dialog title={existing ? t.editRule : t.newRule} onClose={onClose} t={t} busy={busy}>
    <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}><legend>{t.paymentDetails}</legend>
        <Field label={t.paymentName}><input required maxLength={500} autoFocus placeholder={t.paymentNameExample} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <div className="segmented-control" role="group" aria-label={t.type}>{(['expense', 'income'] as const).map((value) => <button type="button" key={value} aria-pressed={type === value} onClick={() => { if (type === value) return; setType(value); setCategoryId(''); setSplit(false); setSplits([]); setConfirmPast(false); }}>{t[value]}</button>)}</div>
        <div className="form-grid"><Field label={t.amount}><input inputMode="decimal" required placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setConfirmPast(false); }} /></Field><Field label={t.currency}><CurrencySelect value={currency} codes={codes} onChange={(value) => { setCurrency(value); setConfirmPast(false); }} /></Field></div>
        <Field label={t.account}><select required value={accountId} onChange={(event) => { const target = accounts.find((item) => item.id === event.target.value); setAccountId(event.target.value); setConfirmPast(false); if (target && !target.openingBalances.some((value) => value.currency === currency)) setCurrency(target.primaryCurrency); }}><option value="">—</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        {!split && <Field label={t.category}><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">{t.noCategory}</option>{applicable.map((item) => <option key={item.id} value={item.id}>{categoryLabel(item, snapshot.categories, language)}</option>)}</select></Field>}
      </fieldset>
      <fieldset disabled={busy}><legend>{t.paymentSchedule}</legend>
        <div className="recurrence-presets" role="group" aria-label={t.frequency}>{(['monthly', 'weekly', 'yearly', 'custom'] as const).map((value) => <button type="button" key={value} aria-pressed={preset === value} onClick={() => { setPreset(value); setConfirmPast(false); }}>{value === 'custom' ? t.customSchedule : t[value]}</button>)}</div>
        {preset === 'custom' && <div className="form-grid"><Field label={t.repeatEvery}><input type="number" min={1} max={36500} step={1} required value={customInterval} onChange={(event) => { setCustomInterval(event.target.value); setConfirmPast(false); }} /></Field><Field label={t.timeUnit}><select value={unit} onChange={(event) => { setUnit(event.target.value as typeof unit); setConfirmPast(false); }}><option value="days">{t.recurringDays}</option><option value="weeks">{t.recurringWeeks}</option><option value="months">{t.recurringMonths}</option></select></Field></div>}
        <Field label={existing ? t.nextPayment : t.firstPayment}><input type="date" required min={existing ? addDays(today(), 1) : undefined} value={firstDate} onChange={(event) => { setFirstDate(event.target.value); setConfirmPast(false); }} /></Field>
        <label className="check"><input type="checkbox" checked={hasEnd} onChange={(event) => { setHasEnd(event.target.checked); setConfirmPast(false); }} />{t.setLastPaymentDate}</label>
        {hasEnd && <Field label={t.lastPaymentDate}><input type="date" required min={firstDate} value={endDate} onChange={(event) => { setEndDate(event.target.value); setConfirmPast(false); }} /></Field>}
      </fieldset>
      <details className="recurring-options" open={split || undefined}><summary>{t.paymentMoreOptions}</summary><Field label={t.notes}><textarea rows={2} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={split} onChange={(event) => { setSplit(event.target.checked); if (event.target.checked && !splits.length) setSplits([{ key: crypto.randomUUID(), categoryId: '', amount: '' }, { key: crypto.randomUUID(), categoryId: '', amount: '' }]); }} />{t.split}</label>
        {split && <>{splits.map((item, index) => <div className="split-row" key={item.key}><Field label={`${t.category} ${index + 1}`}><select required value={item.categoryId} onChange={(event) => setSplits((current) => current.map((value) => value.key === item.key ? { ...value, categoryId: event.target.value } : value))}><option value="">—</option>{applicable.map((value) => <option key={value.id} value={value.id}>{categoryLabel(value, snapshot.categories, language)}</option>)}</select></Field><Field label={`${t.amount} · ${currency}`}><input required inputMode="decimal" value={item.amount} onChange={(event) => setSplits((current) => current.map((value) => value.key === item.key ? { ...value, amount: event.target.value } : value))} /></Field><button type="button" aria-label={`${t.remove} ${index + 1}`} onClick={() => setSplits((current) => current.filter((value) => value.key !== item.key))}>×</button></div>)}<button type="button" onClick={() => setSplits((current) => [...current, { key: crypto.randomUUID(), categoryId: '', amount: '' }])}>{t.addSplit}</button></>}
      </details>
      <section className="recurring-preview" aria-label={t.paymentPreview}><h3>{t.paymentPreview}</h3><div className="section-heading"><strong>{name.trim() || t.paymentNameExample}</strong>{entered && <Amount value={{ currency, amountMinor: entered.amountMinor.toString() }} locale={locale} display={moneyDisplay} />}</div><p className="hint">{account?.name} · {scheduleValid ? scheduleLabel(previewRule, t, locale) : t.invalidForm}</p><div className="recurring-preview-dates" aria-live="polite">{dates.map((date) => <span key={date}>{displayDate(date, locale)}</span>)}</div><p className="hint">{existing ? t.recurringEditHint : t.recurringAutoHint}</p>{dueCount > 0 && <p className="hint">{t.paymentsRecordedNow.replace('{count}', String(dueCount))}</p>}{existing && !existing.isActive && <p className="notice">{t.editPausedPaymentHint}</p>}</section>
      {!existing && firstDate < today() && dueCount > 0 && <label className="check"><input type="checkbox" checked={confirmPast} onChange={(event) => setConfirmPast(event.target.checked)} required />{t.confirmPastPayments.replace('{count}', String(dueCount))}</label>}
      <ErrorMessage message={error} /><div className="actions"><button className="primary" disabled={busy}>{busy ? t.saving : existing ? t.save : t.createPayment}</button><button type="button" disabled={busy} onClick={onClose}>{t.cancel}</button></div>
    </form>
  </Dialog>;
}
