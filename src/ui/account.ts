// Account: passwordless sign-in (email + 6-digit code), session state, the
// toolbar's account button and the sign-in sheet.
//
// The API only exists on kallax.abpq.cc. Elsewhere (kallax.pages.dev, a static
// server) GET /api/me answers 404 / HTML: accounts are "unavailable" and
// everything keeps working locally.
import { h, toast, MOD } from './dom';
import { icon } from './icons';
import { tip } from './controls';
import { Popover, fillMenu } from './popover';
import { api, ApiError } from './api';
import { t, tn, lang, type TKey } from '../core/i18n';

export interface User { email: string }
export type AccountState = 'unknown' | 'signedOut' | 'signedIn' | 'unavailable';
/** Why the account changed: startup check, sign-in, sign-out, or the server dropped the session. */
export type AccountReason = 'init' | 'signin' | 'signout' | 'expired';
export interface AccountEvent { user: User | null; prev: User | null; reason: AccountReason }

export const ACCOUNT_HOST = 'kallax.abpq.cc';
export const ACCOUNT_URL = `https://${ACCOUNT_HOST}/`;
/** Last signed-in email, to draw the avatar right away on startup (no flash). */
const LS_HINT = 'kallax-designer:account-hint';
const LS_LAST_EMAIL = 'kallax-designer:last-email';
const RESEND_DELAY = 30;

let user: User | null = null;
let state: AccountState = 'unknown';
/** Accounts unavailable because the server could not be reached (vs. no API on this host). */
let offline = false;

const listeners = new Set<(e: AccountEvent) => void>();
export function onAccountChange(fn: (e: AccountEvent) => void) { listeners.add(fn); return () => listeners.delete(fn); }
const stateListeners = new Set<() => void>();
function emitState() { for (const l of stateListeners) l(); }

export function currentUser(): User | null { return user; }
export function accountState(): AccountState { return state; }

function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
}

function setUser(next: User | null, reason: AccountReason) {
  const prev = user;
  user = next;
  state = next ? 'signedIn' : 'signedOut';
  lsSet(LS_HINT, next ? next.email : null);
  if (next) lsSet(LS_LAST_EMAIL, next.email);
  emitState();
  for (const l of listeners) { try { l({ user: next, prev, reason }); } catch (e) { console.error(e); } }
}

let resolveReady!: () => void;
/** Resolves once the startup GET /api/me has answered (whatever the answer). */
export const accountReady = new Promise<void>(r => { resolveReady = r; });

/** Startup: silently ask the server who we are. */
export async function initAccount() {
  try {
    const r = await api<{ user?: User }>('GET', '/me');
    if (r.user?.email) setUser({ email: r.user.email }, 'init');
    else { state = 'unavailable'; emitState(); for (const l of listeners) l({ user: null, prev: null, reason: 'init' }); }
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'network';
    if (code === 'unauthorized') setUser(null, 'init');
    else {
      offline = code === 'network' || code === 'server';
      state = 'unavailable';
      lsSet(LS_HINT, null);
      emitState();
      for (const l of listeners) l({ user: null, prev: null, reason: 'init' });
    }
  }
  resolveReady();
}

/** A project call answered 401: the session is gone. `quiet`: the caller shows its own message. */
export function handleUnauthorized(quiet = false) {
  if (!user) return;
  setUser(null, 'expired');
  if (!quiet) toast(t('auth.expired'), 3200);
}

export async function signOut() {
  try { await api('POST', '/auth/logout'); } catch (e) {
    if (e instanceof ApiError && e.code === 'network') { toast(t('net.offline')); return; }
    // any other answer: the session is unusable anyway
  }
  setUser(null, 'signout');
  toast(t('auth.signedOutToast'));
}

/** Small colourful disc with the email's first letter. */
export function avatar(email: string, size = 22): HTMLElement {
  let hsh = 0;
  for (const c of email.toLowerCase()) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const HUES = [211, 238, 265, 292, 330, 352, 18, 32, 145, 168, 188];
  const hue = HUES[hsh % HUES.length];
  return h('span', {
    class: 'avatar', 'aria-hidden': 'true',
    style: `--av:${size}px;--av-h:${hue}`,
  }, (email.trim()[0] || '?').toUpperCase());
}

// ── toolbar button ─────────────────────────────────────────
export function buildAccountButton(hooks: { openProjects(): void }): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'btn tb-btn icon-only acct-btn' });
  const pop = new Popover(btn, { role: 'menu', cls: 'menu-pop acct-pop', width: 264, align: 'start', manual: true });

  const render = () => {
    const hint = state === 'unknown' ? lsGet(LS_HINT) : null;
    const email = user?.email ?? hint;
    btn.replaceChildren(email ? avatar(email) : icon('personCircle', 19));
    btn.classList.toggle('signed-in', !!email);
    btn.classList.toggle('unavailable', state === 'unavailable');
    const label = email ? t('acct.buttonSignedIn', { email })
      : state === 'unavailable' ? (offline ? t('acct.offlineTitle') : t('acct.unavailableTip', { host: ACCOUNT_HOST }))
        : t('auth.signIn');
    btn.setAttribute('aria-label', label);
    tip(btn, label);
    btn.setAttribute('aria-haspopup', user ? 'menu' : 'dialog');
  };
  stateListeners.add(render);
  render();

  const fillPop = () => {
    pop.body.replaceChildren();
    pop.body.classList.remove('menu');
    if (user) {
      pop.el.setAttribute('role', 'menu');
      pop.el.setAttribute('aria-label', t('acct.menuAria'));
      pop.body.append(h('div', { class: 'acct-head' },
        avatar(user.email, 34),
        h('div', { class: 'acct-id' },
          h('strong', { title: user.email }, user.email),
          h('span', null, t('acct.synced')))));
      fillMenu(pop, [
        { label: t('menu.projects'), icon: 'folder', kbd: `${MOD}O`, action: hooks.openProjects, separatorBefore: true },
        { label: t('auth.signOut'), icon: 'logout', action: () => { void signOut(); }, separatorBefore: true },
      ]);
    } else {
      pop.el.setAttribute('role', 'dialog');
      pop.el.setAttribute('aria-label', offline ? t('acct.offlineTitle') : t('acct.unavailableTitle'));
      const body = h('div', { class: 'acct-unavail' },
        h('div', { class: 'acct-unavail-icon' }, icon(offline ? 'cloud' : 'personCircle', 22)),
        h('strong', null, offline ? t('acct.offlineTitle') : t('acct.unavailableTitle')),
        h('p', null, offline ? t('acct.offlineMsg') : t('acct.unavailableMsg', { host: ACCOUNT_HOST })));
      if (offline) {
        const retry = h('button', { type: 'button', class: 'acct-cta' }, t('acct.retry'));
        retry.addEventListener('click', async () => {
          pop.close();
          offline = false; state = 'unknown'; render();
          await initAccount();
          if ((state as AccountState) === 'unavailable') toast(offline ? t('net.offline') : t('acct.unavailableTip', { host: ACCOUNT_HOST }));
        });
        body.append(retry);
      } else {
        body.append(h('a', { class: 'acct-cta', href: ACCOUNT_URL, target: '_blank', rel: 'noopener' },
          t('acct.openHost', { host: ACCOUNT_HOST }), icon('arrowUpRight', 13)));
      }
      pop.body.append(body);
    }
  };

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (pop.opened) { pop.close(); return; }
    if (state === 'unknown') await accountReady;
    if (state === 'signedOut') { void openSignIn(); return; }
    fillPop();
    pop.open();
  });
  return btn;
}

// ── sign-in sheet ──────────────────────────────────────────
interface SignInSheet { open(): Promise<boolean> }
let signInSheet: SignInSheet | null = null;

/** Open the sign-in sheet. Resolves true once signed in, false if dismissed. */
export function openSignIn(): Promise<boolean> {
  if (state === 'signedIn') return Promise.resolve(true);
  if (state === 'unavailable') { toast(t('acct.unavailableTip', { host: ACCOUNT_HOST })); return Promise.resolve(false); }
  signInSheet ??= buildSignInSheet();
  return signInSheet.open();
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** `t(key)` where `{email}` becomes a <strong> node. */
function withEmail(key: TKey, email: string): (Node | string)[] {
  const parts = t(key, { email: '\u0000' }).split('\u0000');
  return parts.flatMap((p, i) => (i < parts.length - 1 ? [p, h('strong', { class: 'auth-email' }, email)] : [p]));
}

function buildSignInSheet(): SignInSheet {
  let email = '';
  let busy = false;
  let locked = false;         // code expired / too many attempts: must ask for a new one
  let resendAt = 0;           // ms timestamp after which "Renvoyer" is allowed
  let timer = 0;
  let resolveOpen: ((ok: boolean) => void) | null = null;
  let returnFocus: HTMLElement | null = null;
  let success = false;

  const close = h('button', { type: 'button', class: 'sheet-close auth-close', 'aria-label': t('common.close') }, icon('xmark', 14));
  const art = h('div', { class: 'auth-art', 'aria-hidden': 'true' });
  const title = h('h2', { id: 'auth-title', class: 'auth-title' });
  const sub = h('p', { id: 'auth-sub', class: 'auth-sub' });

  // step 1 — email
  const emailInput = h('input', {
    type: 'email', id: 'auth-email', class: 'auth-input', name: 'email',
    autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false',
    placeholder: t('auth.emailPlaceholder'), 'aria-describedby': 'auth-email-err', required: true,
  });
  const emailErr = h('p', { id: 'auth-email-err', class: 'auth-error', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  const sendLabel = h('span', null, t('auth.sendCode'));
  const sendBtn = h('button', { type: 'submit', class: 'auth-primary' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), sendLabel);
  const emailForm = h('form', { class: 'auth-step', novalidate: true },
    h('label', { class: 'auth-label', for: 'auth-email' }, t('auth.emailLabel')),
    emailInput, emailErr, sendBtn,
    h('p', { class: 'auth-note' }, icon('lock', 12), t('auth.noPassword')));

  // step 2 — code
  const boxes = Array.from({ length: 6 }, (_, i) => h('input', {
    type: 'text', class: 'otp-box', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6',
    autocomplete: i === 0 ? 'one-time-code' : 'off', name: i === 0 ? 'code' : undefined,
    'aria-label': t('auth.digitAria', { n: i + 1 }), 'aria-describedby': 'auth-code-err',
  }));
  const otp = h('div', { class: 'otp', role: 'group', 'aria-labelledby': 'auth-otp-label' }, boxes.slice(0, 3), h('span', { class: 'otp-dash', 'aria-hidden': 'true' }), boxes.slice(3));
  const codeErr = h('p', { id: 'auth-code-err', class: 'auth-error', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  const codeStatus = h('p', { class: 'auth-status', 'aria-live': 'polite' });
  const resendBtn = h('button', { type: 'button', class: 'auth-link' });
  const changeBtn = h('button', { type: 'button', class: 'auth-link' }, t('auth.changeEmail'));
  const codeForm = h('form', { class: 'auth-step', novalidate: true, hidden: true },
    h('span', { id: 'auth-otp-label', class: 'sr-only' }, t('auth.codeLabel')),
    otp, codeErr, codeStatus,
    h('div', { class: 'auth-links' }, resendBtn, h('span', { class: 'auth-dot', 'aria-hidden': 'true' }, '·'), changeBtn),
    h('p', { class: 'auth-note' }, t('auth.checkSpam')));

  const dlg = h('dialog', { class: 'sheet auth-sheet', 'aria-labelledby': 'auth-title', 'aria-describedby': 'auth-sub' },
    close, art, title, sub, emailForm, codeForm,
    h('p', { class: 'auth-foot' }, icon('cloud', 13), t('auth.foot')));
  document.body.appendChild(dlg);

  // ── helpers ──
  const setBusy = (b: boolean) => {
    busy = b;
    dlg.classList.toggle('busy', b);
    sendBtn.disabled = b;
    emailInput.readOnly = b;
    for (const x of boxes) x.readOnly = b || locked;
    dlg.setAttribute('aria-busy', String(b));
  };
  const setEmailError = (msg: string) => {
    emailErr.textContent = msg;
    emailInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
    emailInput.classList.toggle('invalid', !!msg);
  };
  const setCodeError = (msg: string, shake = false) => {
    codeErr.textContent = msg;
    otp.classList.toggle('error', !!msg);
    for (const b of boxes) b.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (shake) {
      otp.classList.remove('shake');
      void otp.offsetWidth; // restart the animation
      otp.classList.add('shake');
    }
  };
  otp.addEventListener('animationend', () => otp.classList.remove('shake'));

  const code = () => boxes.map(b => b.value).join('');
  const clearBoxes = () => { for (const b of boxes) b.value = ''; syncFilled(); };
  const syncFilled = () => { for (const b of boxes) b.classList.toggle('filled', !!b.value); };
  const setLocked = (l: boolean) => {
    locked = l;
    otp.classList.toggle('locked', l);
    for (const b of boxes) { b.readOnly = l || busy; b.tabIndex = l ? -1 : 0; }
  };

  const tick = () => {
    const left = Math.ceil((resendAt - Date.now()) / 1000);
    if (left > 0) {
      resendBtn.disabled = true;
      resendBtn.textContent = t('auth.resendIn', { n: left });
    } else {
      resendBtn.disabled = false;
      resendBtn.textContent = t('auth.resend');
      clearInterval(timer); timer = 0;
    }
  };
  const startCountdown = (seconds: number) => {
    resendAt = Date.now() + seconds * 1000;
    clearInterval(timer);
    timer = window.setInterval(tick, 250);
    tick();
  };

  const showStep = (step: 'email' | 'code') => {
    const isCode = step === 'code';
    emailForm.hidden = isCode;
    codeForm.hidden = !isCode;
    dlg.classList.toggle('step-code', isCode);
    art.replaceChildren(icon(isCode ? 'mail' : 'personCircle', 30));
    title.textContent = isCode ? t('auth.codeTitle') : t('auth.title');
    sub.replaceChildren(...(isCode ? withEmail('auth.codeSent', email) : [t('auth.sub')]));
    if (isCode) { setCodeError(''); codeStatus.textContent = ''; requestAnimationFrame(() => boxes[0].focus()); }
    else requestAnimationFrame(() => { emailInput.focus(); emailInput.select(); });
  };

  const networkMsg = (e: unknown) => {
    const c = e instanceof ApiError ? e.code : 'network';
    return c === 'network' ? t('net.offline') : c === 'unavailable' ? t('acct.unavailableTip', { host: ACCOUNT_HOST }) : t('net.server');
  };

  /** POST /auth/request. Returns true when a code was sent. */
  const requestCode = async (): Promise<boolean> => {
    try {
      await api('POST', '/auth/request', { email, lang });
      startCountdown(RESEND_DELAY);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_email') { setEmailError(t('auth.invalidEmail')); showStepIfNeeded('email'); return false; }
      if (e instanceof ApiError && e.code === 'rate_limited') {
        const n = e.retryAfter ?? RESEND_DELAY;
        startCountdown(n);
        const msg = t('auth.rateLimited', { n });
        if (emailForm.hidden) setCodeError(msg); else setEmailError(msg);
        return false;
      }
      const msg = networkMsg(e);
      if (emailForm.hidden) setCodeError(msg); else setEmailError(msg);
      return false;
    }
  };
  const showStepIfNeeded = (s: 'email' | 'code') => {
    if ((s === 'email') !== !emailForm.hidden) showStep(s);
    if (s === 'email') emailInput.focus();
  };

  // ── step 1 ──
  emailInput.addEventListener('input', () => setEmailError(''));
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const v = emailInput.value.trim().toLowerCase();
    if (!v) { setEmailError(t('auth.emailRequired')); emailInput.focus(); return; }
    if (!EMAIL_RE.test(v)) { setEmailError(t('auth.invalidEmail')); emailInput.focus(); return; }
    // Same address, code still fresh: go back to the code without sending another one.
    if (v === email && resendAt > Date.now()) { setLocked(false); clearBoxes(); showStep('code'); return; }
    email = v;
    setBusy(true);
    sendLabel.textContent = t('auth.sending');
    const ok = await requestCode();
    setBusy(false);
    sendLabel.textContent = t('auth.sendCode');
    if (ok) { setLocked(false); clearBoxes(); showStep('code'); }
  });

  // ── step 2: OTP boxes ──
  const focusBox = (i: number) => {
    const b = boxes[Math.max(0, Math.min(5, i))];
    b.focus();
    b.select();
  };
  /** Write `digits` into the boxes starting at `from`; returns the index after the last one. */
  const fill = (from: number, digits: string) => {
    let i = from;
    for (const d of digits) { if (i > 5) break; boxes[i].value = d; i++; }
    syncFilled();
    return i;
  };
  const maybeSubmit = () => { if (/^\d{6}$/.test(code())) void verify(); };

  boxes.forEach((b, i) => {
    b.addEventListener('focus', () => b.select());
    b.addEventListener('input', () => {
      if (busy || locked) return;
      setCodeError('');
      const digits = b.value.replace(/\D/g, '');
      if (!digits) { b.value = ''; syncFilled(); return; }
      // A full code typed / autofilled in one box (iOS one-time-code, password managers) fills all.
      const from = digits.length >= 6 ? 0 : i;
      const end = fill(from, digits.length >= 6 ? digits.slice(0, 6) : digits);
      if (end <= 5) focusBox(end); else boxes[5].focus();
      maybeSubmit();
    });
    b.addEventListener('paste', (e) => {
      e.preventDefault();
      if (busy || locked) return;
      const digits = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
      if (!digits) return;
      setCodeError('');
      const end = digits.length >= 6 ? fill(0, digits.slice(0, 6)) : fill(i, digits);
      focusBox(Math.min(end, 5));
      maybeSubmit();
    });
    b.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep app shortcuts out of the code
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (busy || locked) return;
        setCodeError('');
        if (b.value) { b.value = ''; syncFilled(); }
        else if (i > 0) { boxes[i - 1].value = ''; syncFilled(); focusBox(i - 1); }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        b.value = ''; syncFilled();
      } else if (e.key === 'ArrowLeft') { e.preventDefault(); focusBox(i - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); focusBox(i + 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusBox(0); }
      else if (e.key === 'End') { e.preventDefault(); focusBox(5); }
      else if (e.key === 'Enter') { e.preventDefault(); maybeSubmit(); }
      else if (e.key.length === 1 && !/\d/.test(e.key) && !e.metaKey && !e.ctrlKey) e.preventDefault();
      else if (/^\d$/.test(e.key) && b.value && b.selectionStart === b.selectionEnd) b.value = ''; // overwrite
    });
  });
  codeForm.addEventListener('submit', (e) => { e.preventDefault(); maybeSubmit(); });

  const verify = async () => {
    if (busy || locked) return;
    setBusy(true);
    codeStatus.textContent = t('auth.verifying');
    try {
      const r = await api<{ user: User }>('POST', '/auth/verify', { email, code: code() });
      success = true;
      codeStatus.textContent = '';
      await doClose();
      setBusy(false);
      setUser({ email: r.user?.email || email }, 'signin');
      toast(t('auth.signedIn'));
      resolveOpen?.(true);
      resolveOpen = null;
      return;
    } catch (e) {
      codeStatus.textContent = '';
      setBusy(false);
      const c = e instanceof ApiError ? e.code : 'network';
      if (c === 'invalid_code') {
        const n = e instanceof ApiError ? e.attemptsLeft : undefined;
        if (n === 0) { setLocked(true); startCountdown(0); setCodeError(t('auth.tooMany'), true); clearBoxes(); resendBtn.focus(); return; }
        setCodeError(n !== undefined ? tn('auth.wrongCode', n) : t('auth.wrongCodePlain'), true);
        clearBoxes();
        focusBox(0);
      } else if (c === 'expired' || c === 'too_many_attempts') {
        setLocked(true);
        startCountdown(0);
        setCodeError(c === 'expired' ? t('auth.expiredCode') : t('auth.tooMany'), true);
        clearBoxes();
        resendBtn.focus();
      } else {
        setCodeError(networkMsg(e), true);
        focusBox(5);
      }
    }
  };

  resendBtn.addEventListener('click', async () => {
    if (busy || resendAt > Date.now()) return;
    setBusy(true);
    codeStatus.textContent = t('auth.sending');
    setCodeError('');
    const ok = await requestCode();
    setBusy(false);
    codeStatus.textContent = ok ? t('auth.resent') : '';
    if (ok) { setLocked(false); clearBoxes(); focusBox(0); }
  });
  changeBtn.addEventListener('click', () => { setLocked(false); showStep('email'); });

  // ── open / close ──
  let closing: Promise<void> | null = null;
  const doClose = (): Promise<void> => {
    if (!dlg.open) return Promise.resolve();
    if (closing) return closing;
    closing = new Promise<void>(res => {
      dlg.classList.add('closing');
      setTimeout(() => {
        dlg.classList.remove('closing');
        dlg.close();
        closing = null;
        res();
      }, 160);
    });
    return closing;
  };
  dlg.addEventListener('close', () => {
    clearInterval(timer); timer = 0;
    // on success the promise resolves once the user is set (see verify)
    if (!success) { resolveOpen?.(false); resolveOpen = null; }
    if (returnFocus?.isConnected) returnFocus.focus();
  });
  close.addEventListener('click', () => { void doClose(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!success) void doClose(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) void doClose(); });
  emailInput.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });

  return {
    open() {
      if (dlg.open) return new Promise<boolean>(r => { const prev = resolveOpen; resolveOpen = (ok) => { prev?.(ok); r(ok); }; });
      success = false;
      returnFocus = document.activeElement as HTMLElement | null;
      setBusy(false); setLocked(false);
      setEmailError('');
      if (!emailInput.value) emailInput.value = email || lsGet(LS_LAST_EMAIL) || '';
      showStep('email');
      if (resendAt > Date.now()) startCountdown(Math.ceil((resendAt - Date.now()) / 1000));
      dlg.showModal();
      return new Promise<boolean>(r => { resolveOpen = r; });
    },
  };
}
