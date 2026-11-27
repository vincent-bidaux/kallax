// DEV ONLY — in-memory mock of the accounts / projects API (contract in
// src/ui/api.ts and src/ui/project-store.ts). Wired from vite.config.ts only
// for `vite serve` with VITE_MOCK_API=1: it never reaches the production build.
//
//   VITE_MOCK_API=1 npx vite --port 4193
//
// Sign-in: the code is printed in the dev-server console; 123456 is always accepted.
// Test addresses: ratelimit@example.com → 429 rate_limited; code 000000 → 410 expired.
// VITE_MOCK_LATENCY=<ms> adds latency (default 250).
import type { Plugin } from 'vite';

// Minimal shapes of Node's IncomingMessage / ServerResponse (no @types/node needed).
interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on(ev: 'data', fn: (chunk: { length: number; toString(enc?: string): string }) => void): void;
  on(ev: 'end' | 'error', fn: () => void): void;
}
interface Res {
  statusCode: number;
  setHeader(name: string, value: string | string[]): void;
  end(body?: string): void;
}

interface Project { id: string; name: string; createdAt: number; updatedAt: number; items: number; thumb?: string; doc: unknown }
interface Code { code: string; expires: number; attempts: number; sentAt: number }
interface Comp { id: string; name: string; data: unknown; thumb?: string; createdAt: number; updatedAt: number }

const MAX_ATTEMPTS = 5;
const CODE_TTL = 10 * 60_000;
const RESEND_WINDOW = 25_000; // a little under the client's 30 s countdown
const MAX_BODY = 2 * 1024 * 1024;
const MAX_THUMB = 200 * 1024;
const MAX_COMPONENT = 512 * 1024;
const MAX_COMPONENTS = 500;
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const COOKIE = 'kx_session';

export function mockApi(opts: { latency?: number } = {}): Plugin {
  const codes = new Map<string, Code>();
  const sessions = new Map<string, string>();               // token → email
  const projects = new Map<string, Map<string, Project>>(); // email → id → project
  const components = new Map<string, Map<string, Comp>>();  // email → id → component
  const latency = opts.latency ?? 250;

  const userProjects = (email: string) => {
    let m = projects.get(email);
    if (!m) { m = new Map(); projects.set(email, m); }
    return m;
  };
  const userComponents = (email: string) => {
    let m = components.get(email);
    if (!m) { m = new Map(); components.set(email, m); }
    return m;
  };
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
  const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');

  const json = (res: Res, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
  };
  const readBody = (req: Req) => new Promise<{ size: number; data: Record<string, unknown> | null }>((resolve) => {
    let size = 0; let raw = '';
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) raw += c.toString('utf8'); });
    req.on('end', () => {
      if (size > MAX_BODY) return resolve({ size, data: null });
      try { resolve({ size, data: raw ? JSON.parse(raw) : {} }); } catch { resolve({ size, data: null }); }
    });
    req.on('error', () => resolve({ size, data: null }));
  });
  const sessionEmail = (req: Req): string | null => {
    const raw = String(req.headers.cookie ?? '');
    const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? sessions.get(m[1]) ?? null : null;
  };
  const meta = (p: Project, withThumb: boolean) => ({
    id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, items: p.items,
    ...(withThumb && p.thumb ? { thumb: p.thumb } : {}),
  });

  async function handle(req: Req, res: Res) {
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    if (latency) await new Promise(r => setTimeout(r, latency));

    // ── auth ──
    if (method === 'POST' && path === '/auth/request') {
      const { data } = await readBody(req);
      const email = String(data?.email ?? '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'invalid_email' });
      if (email.startsWith('ratelimit@')) return json(res, 429, { error: 'rate_limited', retryAfter: 42 });
      const prev = codes.get(email);
      if (prev && Date.now() - prev.sentAt < RESEND_WINDOW) {
        return json(res, 429, { error: 'rate_limited', retryAfter: Math.ceil((RESEND_WINDOW - (Date.now() - prev.sentAt)) / 1000) });
      }
      const code = sixDigits();
      codes.set(email, { code, expires: Date.now() + CODE_TTL, attempts: 0, sentAt: Date.now() });
      console.log(`\x1b[36m[mock-api]\x1b[0m sign-in code for ${email}: \x1b[1m${code}\x1b[0m (or 123456) — lang=${String(data?.lang ?? '')}`);
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/auth/verify') {
      const { data } = await readBody(req);
      const email = String(data?.email ?? '').trim().toLowerCase();
      const code = String(data?.code ?? '');
      const c = codes.get(email);
      if (!c) return json(res, 410, { error: 'expired' });
      if (code === '000000' || Date.now() > c.expires) { codes.delete(email); return json(res, 410, { error: 'expired' }); }
      if (c.attempts >= MAX_ATTEMPTS) return json(res, 429, { error: 'too_many_attempts' });
      if (code !== c.code && code !== '123456') {
        c.attempts++;
        const left = MAX_ATTEMPTS - c.attempts;
        if (left <= 0) return json(res, 429, { error: 'too_many_attempts' });
        return json(res, 400, { error: 'invalid_code', attemptsLeft: left });
      }
      codes.delete(email);
      const tk = token();
      sessions.set(tk, email);
      return json(res, 200, { user: { email } }, {
        'Set-Cookie': `${COOKIE}=${tk}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
      });
    }
    if (method === 'POST' && path === '/auth/logout') {
      const raw = String(req.headers.cookie ?? '');
      const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
      if (m) sessions.delete(m[1]);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    }

    // ── authed routes ──
    const email = sessionEmail(req);
    if (method === 'GET' && path === '/me') {
      return email ? json(res, 200, { user: { email } }) : json(res, 401, { error: 'unauthorized' });
    }
    if (path === '/projects' || path.startsWith('/projects/')) {
      if (!email) return json(res, 401, { error: 'unauthorized' });
      const mine = userProjects(email);
      if (path === '/projects' && method === 'GET') {
        const list = [...mine.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(p => meta(p, true));
        return json(res, 200, { projects: list });
      }
      const id = decodeURIComponent(path.slice('/projects/'.length));
      if (!ID_RE.test(id)) return json(res, 400, { error: 'invalid_id' });
      if (method === 'GET') {
        const p = mine.get(id);
        return p ? json(res, 200, { project: { ...meta(p, false), doc: p.doc } }) : json(res, 404, { error: 'not_found' });
      }
      if (method === 'PUT') {
        const { size, data } = await readBody(req);
        if (size > MAX_BODY) return json(res, 413, { error: 'too_large' });
        if (!data || typeof data.doc !== 'object' || !data.doc) return json(res, 400, { error: 'invalid_body' });
        const now = Date.now();
        const prev = mine.get(id);
        const p: Project = {
          id,
          name: String(data.name ?? 'Untitled').slice(0, 200),
          items: Number(data.items) || 0,
          thumb: typeof data.thumb === 'string' ? data.thumb : undefined,
          doc: data.doc,
          createdAt: prev?.createdAt ?? (Number(data.createdAt) || now),
          updatedAt: now,
        };
        mine.set(id, p);
        return json(res, 200, { project: meta(p, false) });
      }
      if (method === 'DELETE') {
        mine.delete(id);
        return json(res, 200, { ok: true });
      }
    }
    // ── components (same contract as api/src/index.ts) ──
    if (path === '/components' || path.startsWith('/components/')) {
      if (!email) return json(res, 401, { error: 'unauthorized' });
      const mine = userComponents(email);
      if (path === '/components') {
        if (method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
        const list = [...mine.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_COMPONENTS)
          .map(c => ({ id: c.id, name: c.name, data: c.data, createdAt: c.createdAt, updatedAt: c.updatedAt, ...(c.thumb ? { thumb: c.thumb } : {}) }));
        return json(res, 200, { components: list });
      }
      const id = decodeURIComponent(path.slice('/components/'.length));
      if (!ID_RE.test(id)) return json(res, 400, { error: 'invalid_id' });
      if (method === 'PUT') {
        const { size, data } = await readBody(req);
        if (size > MAX_COMPONENT + MAX_THUMB || !data) return json(res, size > MAX_COMPONENT ? 413 : 400, { error: size > MAX_COMPONENT ? 'too_large' : 'invalid_body' });
        const d = data.data as { items?: unknown[] } | undefined;
        if (!d || !Array.isArray(d.items) || !d.items.length) return json(res, 400, { error: 'invalid_data' });
        if (JSON.stringify(d).length > MAX_COMPONENT) return json(res, 413, { error: 'too_large' });
        const prev = mine.get(id);
        if (!prev && mine.size >= MAX_COMPONENTS) return json(res, 409, { error: 'too_many' });
        const now = Date.now();
        const thumb = typeof data.thumb === 'string' && data.thumb.startsWith('data:image/') && data.thumb.length <= MAX_THUMB ? data.thumb : undefined;
        const createdAt = Number.isFinite(Number(data.createdAt)) && data.createdAt != null ? Math.min(Number(data.createdAt), now) : now;
        const c: Comp = {
          id, name: String(data.name || 'Composant').slice(0, 200), data: d,
          thumb: thumb ?? prev?.thumb, createdAt: prev?.createdAt ?? createdAt, updatedAt: now,
        };
        mine.set(id, c);
        return json(res, 200, { component: { id, name: c.name, createdAt: c.createdAt, updatedAt: now } });
      }
      if (method === 'DELETE') {
        mine.delete(id);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'method_not_allowed' });
    }
    return json(res, 404, { error: 'not_found' });
  }

  return {
    name: 'kallax-mock-api',
    apply: 'serve',
    configureServer(server) {
      console.log('\x1b[36m[mock-api]\x1b[0m in-memory accounts API enabled on /api (DEV ONLY)');
      server.middlewares.use((req, res, next) => {
        const r = req as unknown as Req;
        if (!(r.url ?? '').startsWith('/api/')) return next();
        handle(r, res as unknown as Res).catch((e) => {
          console.error('[mock-api]', e);
          json(res as unknown as Res, 500, { error: 'server' });
        });
      });
    },
  };
}
