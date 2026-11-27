// Component storage backends (same pattern as project-store.ts):
//   - local:   this browser (localStorage) — signed out, or accounts unavailable;
//   - account: the user's account through the API (GET/PUT/DELETE /api/components).
import { api, ApiError } from './api';
import { validComponentData, type Component, type ComponentData } from '../core/components';
import { StorageFullError } from './project-store';

export interface ComponentWrite {
  id: string;
  name: string;
  data: ComponentData;
  thumb?: string;
  createdAt?: number;
}

export interface ComponentBackend {
  readonly kind: 'local' | 'account';
  readonly scope: string;
  list(): Promise<Component[]>;
  write(c: ComponentWrite): Promise<Component>;
  remove(id: string): Promise<void>;
}

// ── this browser ───────────────────────────────────────────
const LS_COMPONENTS = 'kallax-designer:components';

class LocalComponents implements ComponentBackend {
  readonly kind = 'local' as const;
  readonly scope = 'local';

  listSync(): Component[] {
    try {
      const v = JSON.parse(localStorage.getItem(LS_COMPONENTS) || '[]');
      return Array.isArray(v) ? v.filter(c => c && typeof c.id === 'string' && validComponentData(c.data)) : [];
    } catch { return []; }
  }
  private save(list: Component[]) {
    localStorage.setItem(LS_COMPONENTS, JSON.stringify(list));
  }
  async list() { return this.listSync(); }
  async write(c: ComponentWrite): Promise<Component> {
    const list = this.listSync();
    const prev = list.find(x => x.id === c.id);
    const now = Date.now();
    const comp: Component = {
      id: c.id, name: c.name, data: c.data, thumb: c.thumb ?? prev?.thumb,
      createdAt: c.createdAt ?? prev?.createdAt ?? now, updatedAt: now,
    };
    const put = () => this.save([comp, ...list.filter(x => x.id !== c.id)]);
    try { put(); } catch {
      try { comp.thumb = undefined; put(); } catch { throw new StorageFullError(); }
    }
    return comp;
  }
  async remove(id: string) {
    this.save(this.listSync().filter(c => c.id !== id));
  }
}

export const localComponents = new LocalComponents();

// ── account (API) ──────────────────────────────────────────
interface ApiComponent { id: string; name: string; data?: unknown; thumb?: string | null; createdAt: number; updatedAt: number }

class AccountComponents implements ComponentBackend {
  readonly kind = 'account' as const;
  readonly scope: string;
  constructor(email: string) { this.scope = `acct:${email}`; }

  async list(): Promise<Component[]> {
    const r = await api<{ components: ApiComponent[] }>('GET', '/components');
    return (r.components ?? []).filter(c => validComponentData(c.data)).map(c => ({
      id: c.id, name: c.name, data: c.data as ComponentData, thumb: c.thumb || undefined,
      createdAt: Number(c.createdAt) || Date.now(), updatedAt: Number(c.updatedAt) || Date.now(),
    }));
  }

  async write(c: ComponentWrite): Promise<Component> {
    const path = `/components/${encodeURIComponent(c.id)}`;
    const body = (thumb?: string) => ({ name: c.name, data: c.data, thumb, createdAt: c.createdAt });
    let r: { component?: ApiComponent };
    let thumb = c.thumb;
    try {
      r = await api<{ component?: ApiComponent }>('PUT', path, body(thumb));
    } catch (e) {
      // over the size limit: the thumbnail is the only optional part
      if (!(e instanceof ApiError && e.code === 'too_large' && thumb)) throw e;
      thumb = undefined;
      r = await api<{ component?: ApiComponent }>('PUT', path, body(undefined));
    }
    const now = Date.now();
    return {
      id: c.id, name: r.component?.name ?? c.name, data: c.data, thumb,
      createdAt: Number(r.component?.createdAt) || c.createdAt || now,
      updatedAt: Number(r.component?.updatedAt) || now,
    };
  }

  async remove(id: string) {
    await api('DELETE', `/components/${encodeURIComponent(id)}`);
  }
}

export function accountComponents(email: string): ComponentBackend {
  return new AccountComponents(email);
}
