import { useEffect, useState, type CSSProperties } from 'react';
import { ApiError, logout, request, session, type WebHousehold, type WebSession } from './data/api';
import { errorText, useLedger } from './data/use-ledger';
import { dictionaries, languages, type Language, type Text } from './i18n';
import { localeTags } from './i18n';
import { usePreferences, type Preferences } from './preferences';
import { themes } from './themes';
import { themeStyle } from './theme-style';
import { ErrorMessage, Field } from './components/shared';
import { Icon, ui } from './components/design';
import { TransactionEditor } from './features/transaction-editor';
import { More } from './features/more';
import { Accounts } from './features/accounts';
import { Categories } from './features/categories';
import { Transactions } from './features/transactions';
import { Overview } from './features/overview';
import { Recurring } from './features/recurring';
import { Fx } from './features/fx';
import { Settings } from './features/settings';
import { Auth } from './features/auth';
import { HouseholdCreator } from './features/household';

const pages = ['overview', 'transactions', 'accounts', 'categories', 'recurring', 'fx', 'settings', 'more'] as const;
type Page = typeof pages[number];
const icons: Record<Page, string> = { overview: '◈', transactions: '⇄', accounts: '▤', categories: '▦', recurring: '↻', fx: '⇅', settings: 'settings', more: 'more' };
function currentPage(): Page { const value = location.hash.slice(1).split('?')[0]; return pages.includes(value as Page) ? value as Page : 'accounts'; }

export function App() {
  const preferences = usePreferences(); const t = dictionaries[preferences.language];
  const theme = themes.find((item) => item.id === preferences.themeId) ?? themes[0]!;
  const [webSession, setSession] = useState<WebSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'anonymous' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    document.documentElement.lang = preferences.language;
    document.documentElement.style.fontSize = `${preferences.fontSize === 'large' ? 18.4 : preferences.fontSize === 'extraLarge' ? 20.8 : 16}px`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);
  }, [preferences.language, preferences.fontSize, theme.primary]);
  useEffect(() => {
    let alive = true; setStatus('loading'); setError('');
    void session().then((result) => { if (alive) { setSession(result); setStatus('ready'); } }).catch((failure: unknown) => {
      if (!alive) return;
      if (failure instanceof ApiError && failure.status === 401) { setSession(null); setStatus('anonymous'); }
      else { setStatus('error'); setError(t.requestError); }
    });
    return () => { alive = false; };
  }, [attempt]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('rttw-auth');
    channel.onmessage = () => { setSession(null); setStatus('loading'); setAttempt((value) => value + 1); };
    return () => channel.close();
  }, []);
  const authenticated = (result: WebSession) => { setSession(result); setStatus('ready'); };
  const expired = () => { setSession(null); setStatus('loading'); setAttempt((value) => value + 1); };
  return <div className="app" style={themeStyle(theme) as CSSProperties}>
    {status === 'ready' && webSession ? <LedgerShell webSession={webSession} setSession={setSession} preferences={preferences} onExpired={expired} /> : <>
      <header className="welcome-header"><a className="brand" href="#overview"><span className="brand-symbol"><Icon name="arrow"/></span> RTTW</a><Field label={t.language}><select value={preferences.language} onChange={(event) => preferences.setLanguage(event.target.value as Language)}>{Object.entries(languages).map(([code, value]) => <option key={code} value={code}>{value.flag} {value.label}</option>)}</select></Field></header>
      <main className="welcome-main">{status === 'loading' ? <p className="empty" role="status">{t.loading}</p> : status === 'error' ? <div className="card"><ErrorMessage message={error} /><button onClick={() => setAttempt((value) => value + 1)}>{t.retry}</button></div> : <Auth t={t} onAuthenticated={authenticated} />}</main>
    </>}
  </div>;
}

function LedgerShell({ webSession, setSession, preferences, onExpired }: { webSession: WebSession; setSession: (session: WebSession) => void; preferences: Preferences; onExpired: () => void }) {
  const t = dictionaries[preferences.language];
  const [householdId, setHouseholdId] = useState(webSession.households[0]?.id ?? '');
  const [page, setPage] = useState<Page>(currentPage);
  const [entry, setEntry] = useState(false);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(location.search).get('invite') ?? '');
  const ledger = useLedger(householdId, webSession.user.id, onExpired);
  useEffect(() => { const route = () => { setPage(currentPage()); window.scrollTo({top:0}); }; addEventListener('hashchange', route); return () => removeEventListener('hashchange', route); }, []);
  async function householdsChanged(household?: WebHousehold) {
    const result = await session(); setSession(result);
    if (household) setHouseholdId(household.id);
  }
  async function signOut() {
    setWorking(true); setError('');
    try { await logout(); onExpired(); } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  async function accept() {
    setWorking(true); setError('');
    try { const result = await request<{ household: WebHousehold }>(`/api/web/households/invitations/${encodeURIComponent(inviteToken)}/accept`, {}); await householdsChanged(result.household); setInviteToken(''); const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null, '', url); }
    catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  const featureProps = ledger.snapshot ? { snapshot: ledger.snapshot, t, language: preferences.language, locale: localeTags[preferences.language], busy: ledger.busy, command: ledger.command, moneyDisplay: preferences.moneyDisplay } : null;
  const nav = [['accounts','wallet'],['categories','grid'],['transactions','receipt'],['overview','chart'],['more','more']] as const;
  const active = ['settings','recurring','fx'].includes(page) ? 'more' : page;
  return <div className="app-shell">
    <header className="app-header"><a href="#accounts" className="brand" aria-label="RTTW"><span className="brand-symbol"><Icon name="arrow" size={19}/></span><span>rttw<span className="brand-period">.</span></span></a><div className="space-selector"><select aria-label={t.household} value={householdId} disabled={working || ledger.busy} onChange={e=>setHouseholdId(e.target.value)}>{webSession.households.map(h=><option value={h.id} key={h.id}>{h.name}</option>)}</select><Icon name="down" size={12}/></div><a className="avatar" href="#more" aria-label={ui(preferences.language,'profile')}>{webSession.user.email.slice(0,1).toUpperCase()}</a></header>
    
    <main id="main-content"><ErrorMessage message={error}/>{inviteToken&&<div className="notice"><p>{t.acceptInvite}</p><button className="primary" disabled={working} onClick={()=>void accept()}>{working?t.loading:t.acceptInvite}</button></div>}
      {!householdId?<section className="card"><h1>{t.createHousehold}</h1><p>{t.householdHint}</p><HouseholdCreator t={t} onCreated={householdsChanged}/></section>:ledger.loading?<div className="skeleton-page" role="status"><div/><div/><div/>{t.loading}</div>:<>
      {ledger.error&&<div className="notice"><ErrorMessage message={errorText(ledger.error,t)}/><button onClick={()=>void ledger.refresh()}>{t.retry}</button></div>}
      {featureProps&&<div key={`${householdId}:${page}`} className={`feature-page page-${page}`}>
        {['settings','recurring','fx'].includes(page)&&<a className="back-link" href="#more"><Icon name="left" size={16}/>{ui(preferences.language,'more')}</a>}
        {page==='accounts'&&<Accounts {...featureProps}/>}
        {page==='categories'&&<Categories {...featureProps}/>}
        {page==='transactions'&&<Transactions {...featureProps}/>}
        {page==='overview'&&<Overview {...featureProps} scope={preferences.scope} onScope={preferences.setScope} enabledCurrencies={preferences.enabledCurrencies}/>}
        {page==='recurring'&&<Recurring {...featureProps}/>}
        {page==='fx'&&<Fx {...featureProps}/>}
        {page==='settings'&&<Settings {...featureProps} preferences={preferences} webSession={webSession} refresh={ledger.refresh} onHouseholdsChanged={householdsChanged}/>}
        {page==='more'&&<More {...featureProps} webSession={webSession} onLogout={()=>void signOut()} onRefresh={()=>void ledger.refresh()}/>}
      </div>}
      </>}
    </main>
    {featureProps&&entry&&<TransactionEditor {...featureProps} existing={undefined} onClose={()=>setEntry(false)}/>}
    {featureProps&&page!=='more'&&page!=='settings'&&<button className="floating-add" disabled={!featureProps.snapshot.accounts.some(a=>!a.deletedAt&&!a.isArchived)} onClick={()=>setEntry(true)} aria-label={t.newTransaction}><Icon name="plus" size={25}/><span>{ui(preferences.language,'add')}</span></button>}
    <nav className="bottom-nav" aria-label="RTTW">{nav.map(([value,icon])=><a key={value} href={`#${value}`} className={active===value?'current':''} aria-current={active===value?'page':undefined}><span className="nav-icon"><Icon name={icon} size={22}/></span><span>{value==='more'?ui(preferences.language,'more'):value==='overview'?ui(preferences.language,'analytics'):t[value]}</span></a>)}</nav>
    <div className="desktop-note">RTTW / MIDNIGHT<br/><span>YOUR MONEY. A LITTLE CLEARER.</span></div>
  </div>;
}
