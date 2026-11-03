import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from '@/locales/en.json';
import so from '@/locales/so.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', flag: 'gb' },
  { code: 'so', label: 'Soomaali', short: 'SO', flag: 'so' },
];

const dictionaries = { en, so };
const STORAGE_KEY = 'fd-lang';
const I18nContext = createContext(null);

function lookup(dict, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict);
}

function readInitialLang() {
  // ?lang=so in the URL wins (shareable links), then the saved choice, then the browser language.
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl && dictionaries[fromUrl]) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && dictionaries[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('so') ? 'so' : 'en';
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(readInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable */
    }
  }, [lang]);

  /** t('greeting.morning', { name: 'Amina' }) — falls back to English, then to the key. */
  const t = useCallback(
    (key, vars) => {
      let str = lookup(dictionaries[lang], key) ?? lookup(en, key) ?? key;
      if (typeof str === 'string' && vars) {
        str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
      }
      return str;
    },
    [lang],
  );

  const locale = lang === 'so' ? 'so-SO' : 'en-US';
  const value = useMemo(() => ({ lang, setLang, t, locale }), [lang, t, locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
