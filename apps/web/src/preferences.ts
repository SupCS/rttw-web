import { useState } from 'react';
import { currencyMetadata, type MoneyCurrencyCode } from '@rttw/domain';
import { languages, type Language } from './i18n';
import { themes, type ThemeId } from './themes';

function read(key: string): string | null { try { return localStorage.getItem(`rttw-web:${key}`); } catch { return null; } }
function preference<T>(key: string, value: T) { try { localStorage.setItem(`rttw-web:${key}`, JSON.stringify(value)); } catch { /* Optional visual preferences have no effect on ledger persistence. */ } }
function json(key: string): unknown { try { const value = read(key); return value ? JSON.parse(value) : null; } catch { return read(key); } }
export function usePreferences() {
  const [language, changeLanguage] = useState<Language>(() => { const value = json('language'); return typeof value === 'string' && Object.hasOwn(languages, value) ? value as Language : 'ru'; });
  const [themeId, changeTheme] = useState<ThemeId>(() => { const value = json('theme'); return themes.find((item) => item.id === value)?.id ?? 'wealth'; });
  const [scope, changeScope] = useState<'personal' | 'household'>(() => json('scope') === 'household' ? 'household' : 'personal');
  const [moneyDisplay, changeDisplay] = useState<'code' | 'symbol'>(() => json('moneyDisplay') === 'code' ? 'code' : 'symbol');
  const [fontSize, changeFont] = useState<'normal' | 'large' | 'extraLarge'>(() => { const value = json('fontSize'); return value === 'large' || value === 'extraLarge' ? value : 'normal'; });
  const [enabledCurrencies, changeCurrencies] = useState<MoneyCurrencyCode[]>(() => { const value = json('currencies'); return Array.isArray(value) ? value.filter((item): item is MoneyCurrencyCode => typeof item === 'string' && Object.hasOwn(currencyMetadata, item)) : ['GEL', 'USD', 'EUR', 'UAH']; });
  return { language, themeId, scope, moneyDisplay, fontSize, enabledCurrencies,
    setLanguage: (value: Language) => { changeLanguage(value); preference('language', value); },
    setThemeId: (value: ThemeId) => { changeTheme(value); preference('theme', value); },
    setScope: (value: typeof scope) => { changeScope(value); preference('scope', value); },
    setMoneyDisplay: (value: typeof moneyDisplay) => { changeDisplay(value); preference('moneyDisplay', value); },
    setFontSize: (value: typeof fontSize) => { changeFont(value); preference('fontSize', value); },
    setEnabledCurrencies: (value: MoneyCurrencyCode[]) => { changeCurrencies(value); preference('currencies', value); },
  };
}
export type Preferences = ReturnType<typeof usePreferences>;
