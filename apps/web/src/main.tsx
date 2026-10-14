import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Retire only the former RTTW root service worker. Ledger data is never read from browser storage.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.filter((registration) => {
    const script = registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL;
    return script && new URL(script).origin === location.origin && new URL(script).pathname === '/sw.js' && registration.scope === `${location.origin}/`;
  }).map((registration) => registration.unregister()))).catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
