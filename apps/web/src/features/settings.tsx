import { useEffect, useState, type FormEvent } from 'react';
import type { MoneyCurrencyCode } from '@rttw/domain';
import { Heading, ui } from '../components/design';
import { LanguagePicker } from '../components/language-picker';
import { themes } from '../themes';
import { request, type WebSession } from '../data/api';
import { errorText } from '../data/use-ledger';
import { CurrencySelect, ErrorMessage, Field, currencies, type FeatureProps } from '../components/shared';
import type { Preferences } from '../preferences';
import { Backup } from './backup';
import { Budgets } from './budgets';

function currentSection() {
  const section = new URLSearchParams(location.hash.split('?')[1]).get('section');
  return section === 'data' || section === 'budgets' ? section : 'appearance';
}

export function Settings({ preferences, webSession, refresh, ...props }: FeatureProps & { preferences: Preferences; webSession: WebSession; refresh: () => Promise<void> }) {
  const { t, snapshot } = props;
  const [panel, setPanel] = useState(currentSection);
  useEffect(() => {
    const change = () => setPanel(currentSection());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const [currency, setCurrency] = useState(snapshot.ledger.baseCurrency);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setWorking(true);
    try { await request('/api/ledger/settings', { baseCurrency: currency }); await refresh(); } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  function toggle(code: MoneyCurrencyCode) { preferences.setEnabledCurrencies(preferences.enabledCurrencies.includes(code) ? preferences.enabledCurrencies.filter((item) => item !== code) : [...preferences.enabledCurrencies, code]); }
  return <div className={`settings-content settings-${panel}`}><Heading title={panel === 'appearance' ? t.appearance : panel === 'budgets' ? t.budgets : ui(props.language, 'data')}/>{panel === 'appearance' && <section className="card settings-appearance"><p>{webSession.user.email}</p><p className="hint">{t.serverConnected}</p><LanguagePicker value={preferences.language} onChange={preferences.setLanguage} label={t.language}/>
    <fieldset><legend>{t.appearance}</legend><div className="theme-grid">{themes.map((theme) => <button type="button" key={theme.id} onClick={() => preferences.setThemeId(theme.id)} aria-pressed={preferences.themeId === theme.id} className={preferences.themeId === theme.id ? 'selected-theme' : ''}><span className="theme-dot" style={{ background: theme.primary }} aria-hidden="true" />{theme.name}</button>)}</div></fieldset>
    <div className="form-grid"><Field label={t.textSize}><select value={preferences.fontSize} onChange={(event) => preferences.setFontSize(event.target.value as Preferences['fontSize'])}>{(['normal', 'large', 'extraLarge'] as const).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></Field><Field label={t.moneyDisplay}><select value={preferences.moneyDisplay} onChange={(event) => preferences.setMoneyDisplay(event.target.value as Preferences['moneyDisplay'])}><option value="code">{t.code}</option><option value="symbol">{t.symbol}</option></select></Field></div>
    <fieldset><legend>{t.currencies}</legend><div className="choices">{currencies.map((code) => <label className="check" key={code}><input type="checkbox" checked={preferences.enabledCurrencies.includes(code) || code === snapshot.ledger.baseCurrency} disabled={code === snapshot.ledger.baseCurrency} onChange={() => toggle(code)} />{code}</label>)}</div></fieldset><p className="hint">{t.preferencesHint}</p>
    <form onSubmit={(event)=>void saveSettings(event)}><Field label={t.baseCurrency}><CurrencySelect value={currency} onChange={setCurrency}/></Field><p className="hint">{t.baseCurrencyHint}</p><button className="primary" disabled={working}>{working?t.saving:t.save}</button></form>
  </section>}
  {panel === 'data' && <div className="settings-data"><Backup {...props} refresh={refresh}/></div>}
  {panel === 'budgets' && <Budgets {...props}/>}
  <ErrorMessage message={error} />
  </div>;
}
