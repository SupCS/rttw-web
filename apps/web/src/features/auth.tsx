import { useState, type FormEvent } from 'react';
import { ApiError, authenticate, type WebSession } from '../data/api';
import { ErrorMessage, Field, text } from '../components/shared';
import type { Text } from '../i18n';

export function Auth({ t, onAuthenticated }: { t: Text; onAuthenticated: (session: WebSession) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    if (mode === 'register' && password !== data.get('confirm')) { setError(t.passwordMismatch); return; }
    setError(''); setBusy(true);
    try { const result = await authenticate(mode, text(data, 'email'), password); form.reset(); onAuthenticated(result); }
    catch (failure) { setError(failure instanceof ApiError && failure.code === 'email_in_use' ? t.emailInUse : failure instanceof ApiError && failure.status === 401 ? t.authError : t.requestError); }
    finally { setBusy(false); }
  }
  return <div className="auth-layout"><section className="auth-intro"><span className="hero-mark" aria-hidden="true">↗</span><h1>Road To The Wealth</h1><p className="hero-tagline">{t.tagline}</p><p>{t.cloudHint}</p></section><section className="card auth-card"><div className="mode-switch">{(['login', 'register'] as const).map((value) => <button key={value} className={mode === value ? 'primary' : ''} onClick={() => { setMode(value); setError(''); }} disabled={busy} aria-pressed={mode === value}>{t[value]}</button>)}</div><form onSubmit={(event) => void submit(event)}>
    <Field label={t.email}><input name="email" type="email" autoComplete="email" required maxLength={254} /></Field><Field label={t.password}><input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} /></Field>
    {mode === 'register' && <Field label={t.confirmPassword}><input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></Field>}
    <ErrorMessage message={error} /><button disabled={busy} className="primary full-width">{busy ? t.loading : t[mode]}</button><p className="hint">{t.networkRequired}</p>
  </form></section></div>;
}
