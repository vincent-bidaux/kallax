// ─────────────────────────────────────────────────────────────
// i18n — FR / EN. The language is resolved once at startup:
//   1. explicit choice stored in localStorage ('kallax-designer:lang')
//   2. otherwise the browser language (fr* → fr, anything else → en)
// Switching language persists the choice and reloads the page (after
// flushing pending autosaves), so module-level labels need no live update.
// ─────────────────────────────────────────────────────────────
import { fr, type Dict } from '../i18n/fr';
import { en } from '../i18n/en';

export type Lang = 'fr' | 'en';
export type TKey = keyof Dict;
/** Keys that come in `.one` / `.other` pairs, without the suffix. */
export type PluralKey = { [K in TKey]: K extends `${infer B}.other` ? B : never }[TKey];

const LS_LANG = 'kallax-designer:lang';

function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LS_LANG);
    return v === 'fr' || v === 'en' ? v : null;
  } catch { return null; }
}

function browserLang(): Lang {
  const list = (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean);
  return (list[0] ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const lang: Lang = storedLang() ?? browserLang();
/** BCP-47 locale used for numbers, currency and dates. */
export const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';

const dict: Record<TKey, string> = lang === 'fr' ? fr : en;
const plurals = new Intl.PluralRules(locale);

function fill(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translate `key`, replacing `{name}` placeholders with `params`. */
export function t(key: TKey, params?: Record<string, string | number>): string {
  return fill(dict[key] ?? fr[key] ?? key, params);
}

/** Translate in a given language (used to recognise default names written in the other language). */
export function tIn(l: Lang, key: TKey, params?: Record<string, string | number>): string {
  const d: Record<TKey, string> = l === 'fr' ? fr : en;
  return fill(d[key] ?? fr[key] ?? key, params);
}
/** Both languages. */
export const LANGS: Lang[] = ['fr', 'en'];
/** A translator bound to a language (same signature as t). */
export type Translator = (key: TKey, params?: Record<string, string | number>) => string;
export const translatorFor = (l: Lang): Translator => (key, params) => tIn(l, key, params);

/** Plural-aware translation: picks `${key}.one` or `${key}.other` for `n` (also passed as `{n}`). */
export function tn(key: PluralKey, n: number, params?: Record<string, string | number>): string {
  const rule = plurals.select(n);
  const k = (rule === 'one' ? `${key}.one` : `${key}.other`) as TKey;
  return t(k, { n, ...params });
}

/** Decimal separator of the current language ("," in French, "." in English). */
export const DECIMAL = lang === 'fr' ? ',' : '.';

// ── switching ────────────────────────────────────────────────
const beforeSwitch = new Set<() => void>();
/** Register work to do right before the reload (e.g. flush the autosave). */
export function onBeforeLangSwitch(fn: () => void) { beforeSwitch.add(fn); }

/** Persist the user's choice and reload the app in that language. */
export function setLang(l: Lang) {
  try { localStorage.setItem(LS_LANG, l); } catch { /* private mode: reload still applies browser default */ }
  if (l === lang) return;
  for (const fn of beforeSwitch) { try { fn(); } catch { /* never block the switch */ } }
  location.reload();
}

// Document-level attributes (index.html is static).
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}
