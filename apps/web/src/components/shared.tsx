import { useEffect, useRef, type ReactNode } from 'react';
import { currencyMetadata, type LedgerCommand, type LedgerSnapshot, type MoneyCurrencyCode, type WireMoney } from '@rttw/domain';
import { getMinorUnit } from '@rttw/domain';
import type { Language, Text } from '../i18n';
import { displayAmount } from '../format';

export const currencies = Object.keys(currencyMetadata) as MoneyCurrencyCode[];
export type FeatureProps = { snapshot: LedgerSnapshot; t: Text; language: Language; locale: string; busy: boolean; command: (command: LedgerCommand) => Promise<LedgerSnapshot>; moneyDisplay: 'code' | 'symbol' };
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
export function CurrencySelect({ value, onChange, name = 'currency', codes = currencies }: { value?: MoneyCurrencyCode; onChange?: (currency: MoneyCurrencyCode) => void; name?: string; codes?: MoneyCurrencyCode[] }) {
  return <select name={name} value={value} onChange={onChange ? (event) => onChange(event.target.value as MoneyCurrencyCode) : undefined}>{codes.map((code) => <option key={code} value={code}>{code}</option>)}</select>;
}
const symbols: Record<MoneyCurrencyCode, string> = { CHF: '₣', EUR: '€', GBP: '£', GEL: '₾', JPY: '¥', KWD: 'د.ك', PLN: 'zł', RUB: '₽', TRY: '₺', UAH: '₴', USD: '$' };
export function Amount({ value, locale, display = 'code' }: { value: WireMoney; locale: string; display?: 'code' | 'symbol' }) {
  const result = displayAmount(BigInt(value.amountMinor), value.currency, locale);
  return <span className="money" title={result}>{display === 'symbol' ? result.replace(` ${value.currency}`, ` ${symbols[value.currency]}`) : result}</span>;
}
export function majorInput(value: WireMoney): string {
  const precision = getMinorUnit(value.currency); const amount = BigInt(value.amountMinor);
  const absolute = amount < 0n ? -amount : amount;
  const digits = absolute.toString().padStart(precision + 1, '0');
  return precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits;
}
export function signedMajorInput(value: WireMoney): string { return `${BigInt(value.amountMinor) < 0n ? '-' : ''}${majorInput(value)}`; }
export function Dialog({ title, onClose, children, t, busy = false }: { title: string; onClose: () => void; children: ReactNode; t: Text; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const target = ref.current; target?.showModal(); return () => { target?.close(); }; }, []);
  return <dialog ref={ref} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="dialog-title"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label={t.close}>×</button></div>{children}</dialog>;
}
export function ErrorMessage({ message }: { message: string }) { return message ? <p className="error" role="alert">{message}</p> : null; }
export function SubmitButtons({ busy, t, onClose }: { busy: boolean; t: Text; onClose: () => void }) {
  return <div className="actions"><button disabled={busy} className="primary">{busy ? t.saving : t.save}</button><button type="button" onClick={onClose} disabled={busy}>{t.cancel}</button></div>;
}
export function text(form: FormData, key: string): string { return String(form.get(key) ?? '').trim(); }
