import { useId } from 'react';
import { languages, type Language } from '../i18n';
import './language-picker.css';

function LanguageFlag({ language }: { language: Language }) {
  return <svg className="language-flag" viewBox="0 0 60 40" width="30" height="20" aria-hidden="true" focusable="false">
    {language === 'uk' ? <><path fill="#0057b7" d="M0 0h60v20H0z"/><path fill="#ffd700" d="M0 20h60v20H0z"/></> : language === 'en' ? <>
      <path fill="#012169" d="M0 0h60v40H0z"/>
      <path stroke="#fff" strokeWidth="8" d="m0 0 60 40M60 0 0 40"/>
      <path stroke="#c8102e" strokeWidth="3" d="m0 0 60 40M60 0 0 40"/>
      <path stroke="#fff" strokeWidth="13" d="M30 0v40M0 20h60"/>
      <path stroke="#c8102e" strokeWidth="8" d="M30 0v40M0 20h60"/>
    </> : <>
      <path fill="#151515" d="M0 0h60v40H0z"/>
      <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round">
        <path d="m17 25 26 10m-26 0 26-10"/>
        <path d="m16 23 2 4m-2 6 2 4m24-14 2 4m-2 6 2 4"/>
      </g>
      <path fill="#fff" d="M30 5c-8 0-12 4-12 10 0 4 2 7 6 8v5h12v-5c4-1 6-4 6-8 0-6-4-10-12-10Z"/>
      <g fill="#151515"><ellipse cx="25" cy="15" rx="3" ry="3.5"/><ellipse cx="35" cy="15" rx="3" ry="3.5"/><path d="m30 19-2 4h4zM27 25h2v3h-2zm4 0h2v3h-2z"/></g>
    </>}
  </svg>;
}

export function LanguagePicker({ value, onChange, label }: { value: Language; onChange: (language: Language) => void; label: string }) {
  const name = useId();
  return <fieldset className="language-picker"><legend>{label}</legend><div className="language-choices">
    {(Object.keys(languages) as Language[]).map((language) => <label className="language-choice" key={language} title={languages[language].label}>
      <input type="radio" name={name} value={language} checked={value === language} onChange={() => onChange(language)}/>
      <span className="language-choice-content"><LanguageFlag language={language}/><span className="language-choice-text" lang={language}>{languages[language].label}</span></span>
    </label>)}
  </div></fieldset>;
}
