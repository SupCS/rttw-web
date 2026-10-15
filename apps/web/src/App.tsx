import { useEffect, useState, type CSSProperties } from 'react';
import { ApiError, logout, session, type WebSession } from './data/api';
import { errorText, useLedger } from './data/use-ledger';
import { dictionaries, type Text } from './i18n';
import { localeTags } from './i18n';
import { usePreferences, type Preferences } from './preferences';
import { themes } from './themes';
import { themeStyle } from './theme-style';
import { ErrorMessage } from './components/shared';
import { LanguagePicker } from './components/language-picker';
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
    {status === 'ready' && webSession ? <LedgerShell webSession={webSession} preferences={preferences} onExpired={expired} /> : <>
      <header className="welcome-header"><a className="brand" href="#overview"><span className="brand-symbol"><Icon name="arrow"/></span> wealthy</a><LanguagePicker value={preferences.language} onChange={preferences.setLanguage} label={t.language}/></header>
      <main className="welcome-main">{status === 'loading' ? <p className="empty" role="status">{t.loading}</p> : status === 'error' ? <div className="card"><ErrorMessage message={error} /><button onClick={() => setAttempt((value) => value + 1)}>{t.retry}</button></div> : <Auth t={t} onAuthenticated={authenticated} />}</main>
    </>}
  </div>;
}

function LedgerShell({ webSession, preferences, onExpired }: { webSession: WebSession; preferences: Preferences; onExpired: () => void }) {
  const t = dictionaries[preferences.language];
  const [page, setPage] = useState<Page>(currentPage);
  const [entry, setEntry] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const ledger = useLedger(webSession.user.id, onExpired);
  useEffect(() => {
    const route = () => { setPage(currentPage()); setEntry(false); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  }, []);
  async function signOut() {
    setWorking(true); setError('');
    try { await logout(); onExpired(); } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  const featureProps = ledger.snapshot ? { snapshot: ledger.snapshot, t, language: preferences.language,
    locale: localeTags[preferences.language], busy: ledger.busy, command: ledger.command, moneyDisplay: preferences.moneyDisplay } : null;
  const nav = [['accounts','wallet'],['categories','grid'],['transactions','receipt'],['overview','chart'],['more','more']] as const;
  const active = ['settings','recurring','fx'].includes(page) ? 'more' : page;
  return <div className="app-shell">
    <header className="app-header"><a href="#accounts" className="brand" aria-label="wealthy"><span className="brand-symbol"><Icon name="arrow" size={19}/></span><span>wealthy<span className="brand-period">.</span></span></a><a className="avatar" href="#more" aria-label={ui(preferences.language,'profile')}>{webSession.user.email.slice(0,1).toUpperCase()}</a></header>
    <main id="main-content"><ErrorMessage message={error}/>
      {ledger.loading ? <div className="skeleton-page" role="status"><div/><div/><div/>{t.loading}</div> : <>
        {ledger.error&&<div className="notice"><ErrorMessage message={errorText(ledger.error,t)}/><button onClick={()=>void ledger.refresh()}>{t.retry}</button></div>}
        {featureProps&&<div key={`${webSession.user.id}:${page}`} className={`feature-page page-${page}`}>
          {['settings','recurring','fx'].includes(page)&&<a className="back-link" href="#more"><Icon name="left" size={16}/>{ui(preferences.language,'more')}</a>}
          {page==='accounts'&&<Accounts {...featureProps}/>}
          {page==='categories'&&<Categories {...featureProps}/>}
          {page==='transactions'&&<Transactions {...featureProps}/>}
          {page==='overview'&&<Overview {...featureProps}/>}
          {page==='recurring'&&<Recurring {...featureProps}/>}
          {page==='fx'&&<Fx {...featureProps}/>}
          {page==='settings'&&<Settings {...featureProps} preferences={preferences} webSession={webSession} refresh={ledger.refresh}/>}
          {page==='more'&&<More {...featureProps} webSession={webSession} onLogout={()=>{if(!working) void signOut();}}/>}
        </div>}
      </>}
    </main>
    {featureProps&&entry&&<TransactionEditor {...featureProps} existing={undefined} onClose={()=>setEntry(false)}/>}
    {featureProps&&page!=='more'&&page!=='settings'&&featureProps.snapshot.accounts.some(a=>!a.deletedAt)&&<button className="floating-add" disabled={featureProps.busy} onClick={()=>setEntry(true)} aria-label={t.newTransaction}><Icon name="plus" size={25}/><span>{ui(preferences.language,'add')}</span></button>}
    <nav className="bottom-nav" aria-label="wealthy">{nav.map(([value,icon])=><a key={value} href={`#${value}`} className={active===value?'current':''} aria-current={active===value?'page':undefined}><span className="nav-icon"><Icon name={icon} size={22}/></span><span>{value==='more'?ui(preferences.language,'more'):value==='overview'?ui(preferences.language,'analytics'):t[value]}</span></a>)}</nav>
    <div className="desktop-note">wealthy<br/><span>YOUR MONEY. A LITTLE CLEARER.</span></div>
  </div>;
}
