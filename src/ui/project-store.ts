// Project storage backends. "Mes projets" talks to one of them:
//   - LocalBackend:   this browser (localStorage) — signed out, or accounts unavailable;
//   - AccountBackend: the user's account through the API — signed in.
// Both expose the same async interface so src/ui/projects.ts doesn't care where
// projects live.
import type { DesignDoc } from '../core/types';
import { api, ApiError } from './api';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  items: number;
  thumb?: string; // small JPEG data URL
}

/** What a write sends. `createdAt` is only given for a new project (or an import). */
export interface ProjectWrite {
  id: string;
  name: string;
  items: number;
  thumb?: string;
  createdAt?: number;
}

export interface ProjectBackend {
  readonly kind: 'local' | 'account';
  /** Identifies where projects live: 'local' or 'acct:<email>'. */
  readonly scope: string;
  list(): Promise<ProjectMeta[]>;
  read(id: string): Promise<DesignDoc | null>;
  write(p: ProjectWrite, doc: DesignDoc): Promise<ProjectMeta>;
  remove(id: string): Promise<void>;
}

/** The browser's storage is full (even without the thumbnail). */
export class StorageFullError extends Error { constructor() { super('storage_full'); } }

// ── this browser ───────────────────────────────────────────
const LS_INDEX = 'kallax-designer:projects';
const LS_PROJECT = (id: string) => `kallax-designer:project:${id}`;

class LocalBackend implements ProjectBackend {
  readonly kind = 'local' as const;
  readonly scope = 'local';

  listSync(): ProjectMeta[] {
    try {
      const v = JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  readSync(id: string): DesignDoc | null {
    try { return JSON.parse(localStorage.getItem(LS_PROJECT(id)) || 'null'); } catch { return null; }
  }
  private writeIndex(list: ProjectMeta[]) {
    localStorage.setItem(LS_INDEX, JSON.stringify(list));
  }

  async list() { return this.listSync(); }
  async read(id: string) { return this.readSync(id); }

  async write(p: ProjectWrite, doc: DesignDoc): Promise<ProjectMeta> {
    const list = this.listSync();
    const prev = list.find(m => m.id === p.id);
    const now = Date.now();
    const meta: ProjectMeta = {
      id: p.id, name: p.name, items: p.items, thumb: p.thumb,
      createdAt: p.createdAt ?? prev?.createdAt ?? now, updatedAt: now,
    };
    const put = () => {
      localStorage.setItem(LS_PROJECT(p.id), JSON.stringify(doc));
      this.writeIndex([meta, ...list.filter(m => m.id !== p.id)]);
    };
    try { put(); } catch {
      // Quota: retry without the thumbnail
      try { meta.thumb = undefined; put(); } catch { throw new StorageFullError(); }
    }
    return meta;
  }

  async remove(id: string) {
    localStorage.removeItem(LS_PROJECT(id));
    this.writeIndex(this.listSync().filter(m => m.id !== id));
  }
}

export const localBackend = new LocalBackend();

// ── account (API) ──────────────────────────────────────────
interface ApiProject { id: string; name: string; createdAt: number; updatedAt: number; items: number; thumb?: string | null; doc?: DesignDoc }

function toMeta(p: ApiProject, thumb?: string): ProjectMeta {
  return {
    id: p.id, name: p.name, items: Number(p.items) || 0,
    createdAt: Number(p.createdAt) || Date.now(), updatedAt: Number(p.updatedAt) || Date.now(),
    thumb: (p.thumb ?? thumb) || undefined,
  };
}

class AccountBackend implements ProjectBackend {
  readonly kind = 'account' as const;
  readonly scope: string;
  constructor(readonly email: string) { this.scope = `acct:${email}`; }

  async list(): Promise<ProjectMeta[]> {
    const r = await api<{ projects: ApiProject[] }>('GET', '/projects');
    return (r.projects ?? []).map(p => toMeta(p));
  }

  async read(id: string): Promise<DesignDoc | null> {
    try {
      const r = await api<{ project: ApiProject }>('GET', `/projects/${encodeURIComponent(id)}`);
      return r.project?.doc ?? null;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') return null;
      throw e;
    }
  }

  async write(p: ProjectWrite, doc: DesignDoc): Promise<ProjectMeta> {
    const body = (thumb?: string) => ({ name: p.name, doc, items: p.items, thumb, createdAt: p.createdAt });
    const path = `/projects/${encodeURIComponent(p.id)}`;
    try {
      const r = await api<{ project: ApiProject }>('PUT', path, body(p.thumb));
      return toMeta(r.project, p.thumb);
    } catch (e) {
      // Over the size limit: the thumbnail is the only optional part — retry once without it.
      if (e instanceof ApiError && e.code === 'too_large' && p.thumb) {
        const r = await api<{ project: ApiProject }>('PUT', path, body(undefined));
        return toMeta(r.project);
      }
      throw e;
    }
  }

  async remove(id: string) {
    await api('DELETE', `/projects/${encodeURIComponent(id)}`);
  }
}

export function accountBackend(email: string): ProjectBackend {
  return new AccountBackend(email);
}

/** Run `fn` over `items` with at most `n` calls in flight. Results keep the input order. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await fn(items[i], i) }; }
      catch (reason) { out[i] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
