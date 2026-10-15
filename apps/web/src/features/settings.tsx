import { useEffect, useState, type FormEvent } from 'react';
import type { MoneyCurrencyCode } from '@rttw/domain';
import { Heading, ui } from '../components/design';
import { LanguagePicker } from '../components/language-picker';
import { themes } from '../themes';
import { request, type WebHousehold, type WebSession } from '../data/api';
import { errorText } from '../data/use-ledger';
import { CurrencySelect, ErrorMessage, Field, currencies, text, type FeatureProps } from '../components/shared';
import type { Preferences } from '../preferences';
import type { Member } from './transactions';
import { Backup } from './backup';
import { HouseholdCreator } from './household';

function currentSection() {
  const section = new URLSearchParams(location.hash.split('?')[1]).get('section');
  return section === 'family' || section === 'data' ? section : 'appearance';
}

export function Settings({ preferences, webSession, refresh, onHouseholdsChanged, onSelectHousehold, ...props }: FeatureProps & { preferences: Preferences; webSession: WebSession; refresh: () => Promise<void>; onHouseholdsChanged: (household?: WebHousehold) => Promise<void>; onSelectHousehold: (id: string) => void }) {
  const { t, snapshot } = props;
  const [panel, setPanel] = useState(currentSection);
  useEffect(() => {
    const change = () => setPanel(currentSection());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const [currency, setCurrency] = useState(snapshot.household.baseCurrency);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState('');
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [link, setLink] = useState(''); const [copied, setCopied] = useState(false);
  async function loadMembers() {
    setMembersLoading(true); setMembersError('');
    try { const result = await request<{ members: Member[] }>(`/api/web/households/${snapshot.household.id}/members`); setMembers(result.members); } catch (failure) { setMembersError(errorText(failure, t)); } finally { setMembersLoading(false); }
  }
  useEffect(() => { if (panel === 'family' && !props.isPersonal) void loadMembers(); }, [panel, snapshot.household.id, props.isPersonal]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError(''); setWorking(true); setLink('');
    try { const result = await request<{ invitation: { token: string } }>(`/api/web/households/${snapshot.household.id}/invitations`, { email: text(data, 'email') });
      const url = new URL(location.origin + location.pathname); url.searchParams.set('invite', result.invitation.token); setLink(url.toString()); setCopied(false);
    } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  async function saveHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError(''); setWorking(true);
    try { await request(`/api/web/households/${snapshot.household.id}/settings`, { name: props.isPersonal ? snapshot.household.name : text(data, 'name'), baseCurrency: currency }); await onHouseholdsChanged(); await refresh(); } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  function toggle(code: MoneyCurrencyCode) { preferences.setEnabledCurrencies(preferences.enabledCurrencies.includes(code) ? preferences.enabledCurrencies.filter((item) => item !== code) : [...preferences.enabledCurrencies, code]); }
  return <div className={`settings-content settings-${panel}`}><Heading title={panel === 'appearance' ? t.appearance : panel === 'family' ? t.household : ui(props.language, 'data')}/>{panel === 'appearance' && <section className="card settings-appearance"><p>{webSession.user.email}</p><p className="hint">{t.serverConnected}</p><LanguagePicker value={preferences.language} onChange={preferences.setLanguage} label={t.language}/>
    <fieldset><legend>{t.appearance}</legend><div className="theme-grid">{themes.map((theme) => <button type="button" key={theme.id} onClick={() => preferences.setThemeId(theme.id)} aria-pressed={preferences.themeId === theme.id} className={preferences.themeId === theme.id ? 'selected-theme' : ''}><span className="theme-dot" style={{ background: theme.primary }} aria-hidden="true" />{theme.name}</button>)}</div></fieldset>
    <div className="form-grid"><Field label={t.textSize}><select value={preferences.fontSize} onChange={(event) => preferences.setFontSize(event.target.value as Preferences['fontSize'])}>{(['normal', 'large', 'extraLarge'] as const).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></Field><Field label={t.moneyDisplay}><select value={preferences.moneyDisplay} onChange={(event) => preferences.setMoneyDisplay(event.target.value as Preferences['moneyDisplay'])}><option value="code">{t.code}</option><option value="symbol">{t.symbol}</option></select></Field>{!props.isPersonal&&<Field label={t.scope}><select value={preferences.scope} onChange={(event) => preferences.setScope(event.target.value as Preferences['scope'])}><option value="personal">{t.personal}</option><option value="household">{t.household}</option></select></Field>}</div>
    <fieldset><legend>{t.currencies}</legend><div className="choices">{currencies.map((code) => <label className="check" key={code}><input type="checkbox" checked={preferences.enabledCurrencies.includes(code) || code === snapshot.household.baseCurrency} disabled={code === snapshot.household.baseCurrency} onChange={() => toggle(code)} />{code}</label>)}</div></fieldset><p className="hint">{t.preferencesHint}</p>
    {props.isPersonal&&<form onSubmit={(event)=>void saveHousehold(event)}><Field label={t.baseCurrency}><CurrencySelect value={currency} onChange={setCurrency}/></Field><p className="hint">{t.baseCurrencyHint}</p><button className="primary" disabled={working}>{working?t.saving:t.save}</button></form>}
  </section>}
  {panel === 'family' && <>
  <section className="card settings-family"><h2>{t.household}</h2><p className="hint">{t.optionalHouseholdHint}</p><div className="actions">{webSession.personalLedger&&!props.isPersonal&&<button onClick={()=>onSelectHousehold(webSession.personalLedger!.id)}>{t.personalLedger}</button>}{webSession.households.map(household=><button key={household.id} disabled={household.id===snapshot.household.id} onClick={()=>onSelectHousehold(household.id)}>{household.name}</button>)}</div></section>
  {!props.isPersonal&&snapshot.member.role === 'owner' && <section className="card settings-family"><h2>{t.household}</h2><form onSubmit={(event) => void saveHousehold(event)}><Field label={t.householdName}><input name="name" required maxLength={120} defaultValue={snapshot.household.name} /></Field><Field label={t.baseCurrency}><CurrencySelect value={currency} onChange={setCurrency} /></Field><p className="hint">{t.baseCurrencyHint}</p><button className="primary" disabled={working}>{working ? t.saving : t.save}</button></form></section>}
  {!props.isPersonal&&<section className="card settings-family"><div className="section-heading"><h2>{t.members}</h2><button disabled={membersLoading} onClick={() => void loadMembers()}>{t.refresh}</button></div>{membersLoading ? <p role="status">{t.loading}</p> : membersError ? <><ErrorMessage message={membersError} /><button onClick={() => void loadMembers()}>{t.retry}</button></> : members.map((member) => <div className="account-summary" key={member.id}><div><strong>{member.displayName}</strong><p className="muted">{member.email}</p></div><span>{t[member.role]}</span></div>)}
    {snapshot.member.role === 'owner' && <form onSubmit={(event) => void invite(event)}><h3>{t.invite}</h3><Field label={t.email}><input name="email" type="email" required maxLength={254} /></Field><button disabled={working}>{working ? t.saving : t.invite}</button></form>}
    {link && <><Field label={t.invitationLink}><input readOnly value={link} onFocus={(event) => event.target.select()} /></Field><p className="hint">{t.invitationHint}</p><button onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {}); }}>{copied ? t.copied : t.copyLink}</button></>}
  </section>}
  <section className="card settings-family"><h2>{t.createHousehold}</h2><HouseholdCreator t={t} onCreated={onHouseholdsChanged} /></section>
  </>}
  {panel === 'data' && <div className="settings-data"><Backup {...props} refresh={refresh}/></div>}
  <ErrorMessage message={error} />
  </div>;
}
