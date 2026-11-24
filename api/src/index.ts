// Kallax Designer API — passwordless accounts (email + 6-digit code) and project sync.
// Routes (same origin as the app, under /api):
//   POST   /api/auth/request   {email, lang}        → send a code
//   POST   /api/auth/verify    {email, code}        → session cookie
//   GET    /api/me                                  → current user
//   POST   /api/auth/logout
//   GET    /api/projects                            → list (meta)
//   GET    /api/projects/:id                        → one project with doc
//   PUT    /api/projects/:id   {name, doc, items, thumb?, createdAt?}
//   DELETE /api/projects/:id

interface Env {
  DB: D1Database;
  EMAIL: { send(msg: { to: string; from: string | { email: string; name?: string }; subject: string; text: string; html: string }): Promise<unknown> };
  MAIL_FROM: string;
  APP_ORIGIN: string;
}

const CODE_TTL = 10 * 60 * 1000;          // 10 min
const MAX_ATTEMPTS = 5;
const SESSION_TTL = 90 * 24 * 3600 * 1000; // 90 days
const MAX_DOC = 2 * 1024 * 1024;            // 2 MB
const MAX_THUMB = 200 * 1024;
const COOKIE = 'kd_session';
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomCode(): string {
  // uniform 000000–999999 (rejection sampling)
  const a = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(a);
    if (a[0] < 4294000000) return String(a[0] % 1000000).padStart(6, '0');
  }
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function getCookie(req: Request, name: string): string | null {
  const c = req.headers.get('cookie') || '';
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
const sessionCookie = (token: string, maxAgeSec: number) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

async function readJson<T>(req: Request, limit = 64 * 1024): Promise<T | null> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > limit) return null;
  const text = await req.text();
  if (text.length > limit) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

async function currentUser(req: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const tok = getCookie(req, COOKIE);
  if (!tok) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).bind(await sha256(tok)).first<{ id: string; email: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email };
}

// ── email ───────────────────────────────────────────────────
function codeEmail(code: string, lang: 'fr' | 'en') {
  const fr = lang === 'fr';
  const subject = fr ? `${code} — votre code Kallax Designer` : `${code} — your Kallax Designer code`;
  const intro = fr ? 'Voici votre code de connexion :' : 'Here is your sign-in code:';
  const note = fr ? 'Il expire dans 10 minutes. Si vous n’avez rien demandé, ignorez cet email.'
    : 'It expires in 10 minutes. If you didn’t ask for it, just ignore this email.';
  const text = `${intro}\n\n${code}\n\n${note}\n\nKallax Designer — https://kallax.abpq.cc`;
  const spaced = code.split('').join('&#8202;');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;background:#fff;border-radius:14px;padding:28px 28px 24px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
<tr><td style="font-size:13px;font-weight:600;color:#1a4a8c;letter-spacing:.02em">KALLAX DESIGNER</td></tr>
<tr><td style="padding-top:18px;font-size:15px;line-height:1.45">${intro}</td></tr>
<tr><td style="padding:18px 0;font-size:34px;font-weight:700;letter-spacing:.18em;font-variant-numeric:tabular-nums;color:#1a4a8c">${spaced}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6e6e73">${note}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

// ── handlers ────────────────────────────────────────────────
async function requestCode(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ email?: string; lang?: string }>(req);
  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);
  const lang = body?.lang === 'en' ? 'en' : 'fr';
  const ip = req.headers.get('cf-connecting-ip') || '';
  const now = Date.now();

  // rate limits: 1 per 30 s and 5 per hour per email; 20 per hour per IP
  const hourAgo = now - 3600_000;
  const byEmail = await env.DB.prepare('SELECT COUNT(*) n, MAX(created_at) last FROM code_requests WHERE email = ? AND created_at > ?')
    .bind(email, hourAgo).first<{ n: number; last: number | null }>();
  if (byEmail && byEmail.last && now - byEmail.last < 30_000) return json({ error: 'rate_limited', retryAfter: Math.ceil((30_000 - (now - byEmail.last)) / 1000) }, 429);
  if (byEmail && byEmail.n >= 5) return json({ error: 'rate_limited', retryAfter: 3600 }, 429);
  if (ip) {
    const byIp = await env.DB.prepare('SELECT COUNT(*) n FROM code_requests WHERE ip = ? AND created_at > ?').bind(ip, hourAgo).first<{ n: number }>();
    if (byIp && byIp.n >= 20) return json({ error: 'rate_limited', retryAfter: 3600 }, 429);
  }

  const code = randomCode();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO code_requests (email, ip, created_at) VALUES (?, ?, ?)').bind(email, ip, now),
    env.DB.prepare('INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at')
      .bind(email, await sha256(`${email}:${code}`), now + CODE_TTL, now),
    env.DB.prepare('DELETE FROM code_requests WHERE created_at < ?').bind(now - 86400_000),
  ]);

  const m = codeEmail(code, lang);
  try {
    await env.EMAIL.send({ to: email, from: { email: env.MAIL_FROM, name: 'Kallax Designer' }, subject: m.subject, text: m.text, html: m.html });
  } catch (e) {
    console.error('email send failed', String(e));
    return json({ error: 'send_failed' }, 502);
  }
  return json({ ok: true });
}

async function verifyCode(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ email?: string; code?: string }>(req);
  const email = String(body?.email || '').trim().toLowerCase();
  const code = String(body?.code || '').replace(/\D/g, '');
  if (!EMAIL_RE.test(email) || code.length !== 6) return json({ error: 'invalid_code', attemptsLeft: MAX_ATTEMPTS }, 400);
  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?').bind(email)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();
  const now = Date.now();
  if (!row) return json({ error: 'expired' }, 410);
  if (row.expires_at < now) { await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run(); return json({ error: 'expired' }, 410); }
  if (row.attempts >= MAX_ATTEMPTS) return json({ error: 'too_many_attempts' }, 429);

  if (!timingSafeEqual(await sha256(`${email}:${code}`), row.code_hash)) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
      return json({ error: 'too_many_attempts' }, 429);
    }
    await env.DB.prepare('UPDATE login_codes SET attempts = ? WHERE email = ?').bind(attempts, email).run();
    return json({ error: 'invalid_code', attemptsLeft: MAX_ATTEMPTS - attempts }, 400);
  }

  // success: upsert user, open session, burn the code
  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) {
    user = { id: crypto.randomUUID() };
    await env.DB.prepare('INSERT INTO users (id, email, created_at, last_login) VALUES (?, ?, ?, ?)').bind(user.id, email, now, now).run();
  }
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email),
    env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), user.id, now, now + SESSION_TTL),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ]);
  return json({ user: { email } }, 200, { 'set-cookie': sessionCookie(token, SESSION_TTL / 1000) });
}

async function logout(req: Request, env: Env): Promise<Response> {
  const tok = getCookie(req, COOKIE);
  if (tok) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(tok)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

interface ProjectRow { id: string; name: string; items: number; thumb: string | null; doc?: string; created_at: number; updated_at: number }
const meta = (r: ProjectRow) => ({ id: r.id, name: r.name, items: r.items, createdAt: r.created_at, updatedAt: r.updated_at, ...(r.thumb ? { thumb: r.thumb } : {}) });

async function projects(req: Request, env: Env, user: { id: string }, id: string | null): Promise<Response> {
  if (!id) {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const { results } = await env.DB.prepare('SELECT id, name, items, thumb, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500')
      .bind(user.id).all<ProjectRow>();
    return json({ projects: results.map(meta) });
  }
  if (!ID_RE.test(id)) return json({ error: 'invalid_id' }, 400);

  if (req.method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM projects WHERE user_id = ? AND id = ?').bind(user.id, id).first<ProjectRow>();
    if (!r) return json({ error: 'not_found' }, 404);
    let doc: unknown = null;
    try { doc = JSON.parse(r.doc!); } catch { /* corrupt */ }
    return json({ project: { ...meta(r), doc } });
  }
  if (req.method === 'PUT') {
    const body = await readJson<{ name?: string; doc?: unknown; items?: number; thumb?: string; createdAt?: number }>(req, MAX_DOC + MAX_THUMB + 4096);
    if (!body) return json({ error: 'too_large' }, 413);
    const doc = body.doc as { version?: number; items?: unknown[]; layers?: unknown[] } | undefined;
    if (!doc || doc.version !== 1 || !Array.isArray(doc.items) || !Array.isArray(doc.layers)) return json({ error: 'invalid_doc' }, 400);
    const docStr = JSON.stringify(doc);
    if (docStr.length > MAX_DOC) return json({ error: 'too_large' }, 413);
    const name = String(body.name || 'Sans titre').slice(0, 200);
    const thumb = typeof body.thumb === 'string' && body.thumb.startsWith('data:image/') && body.thumb.length <= MAX_THUMB ? body.thumb : null;
    const items = Number.isFinite(body.items) ? Math.max(0, Math.min(100000, Math.floor(body.items!))) : doc.items.length;
    const now = Date.now();
    const createdAt = Number.isFinite(body.createdAt) ? Math.min(Number(body.createdAt), now) : now;
    await env.DB.prepare(`INSERT INTO projects (id, user_id, name, items, thumb, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, items = excluded.items, thumb = COALESCE(excluded.thumb, projects.thumb), doc = excluded.doc, updated_at = excluded.updated_at`)
      .bind(id, user.id, name, items, thumb, docStr, createdAt, now).run();
    const r = await env.DB.prepare('SELECT id, name, items, thumb, created_at, updated_at FROM projects WHERE user_id = ? AND id = ?').bind(user.id, id).first<ProjectRow>();
    const { thumb: _t, ...m } = meta(r!);
    return json({ project: m });
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(user.id, id).run();
    return json({ ok: true });
  }
  return json({ error: 'method_not_allowed' }, 405);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    // CSRF: state-changing requests must come from the app's origin
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.get('origin');
      if (origin && origin !== env.APP_ORIGIN && origin !== url.origin) return json({ error: 'forbidden' }, 403);
    }
    try {
      if (path === '/api/auth/request' && req.method === 'POST') return await requestCode(req, env);
      if (path === '/api/auth/verify' && req.method === 'POST') return await verifyCode(req, env);
      if (path === '/api/auth/logout' && req.method === 'POST') return await logout(req, env);
      if (path === '/api/me' && req.method === 'GET') {
        const u = await currentUser(req, env);
        return u ? json({ user: { email: u.email } }) : json({ error: 'unauthorized' }, 401);
      }
      const m = path.match(/^\/api\/projects(?:\/([^/]+))?$/);
      if (m) {
        const u = await currentUser(req, env);
        if (!u) return json({ error: 'unauthorized' }, 401);
        return await projects(req, env, u, m[1] ? decodeURIComponent(m[1]) : null);
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      console.error(String(e));
      return json({ error: 'server_error' }, 500);
    }
  },
};
