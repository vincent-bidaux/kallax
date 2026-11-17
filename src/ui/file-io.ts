// New / open / export (JSON, PNG).
import { store } from '../core/store';
import type { DesignDoc } from '../core/types';
import { ui } from '../interaction/context';
import { h, toast } from './dom';

function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'kallax';
}

function download(href: string, filename: string) {
  const a = h('a', { href, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function newDocument() {
  store.newDoc();
  ui.viewport.zoomToFit(true);
  toast(`Nouveau document — ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Z pour annuler`);
}

export function exportJSON() {
  const blob = new Blob([JSON.stringify(store.doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(url, `${slug(store.doc.name)}.kallax.json`);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Document exporté (JSON)');
}

function validDoc(d: unknown): d is DesignDoc {
  const x = d as DesignDoc;
  return !!x && x.version === 1 && Array.isArray(x.items) && Array.isArray(x.layers) && x.layers.length > 0 &&
    x.items.every(i => i && typeof i.id === 'string' && (i.kind === 'kallax' || i.kind === 'block') && i.position);
}

export function openJSON() {
  const input = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.remove();
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!validDoc(d)) throw new Error('format');
      if (!d.layers.some(l => l.id === d.activeLayerId)) d.activeLayerId = d.layers[0].id;
      store.loadDoc(d);
      ui.viewport.zoomToFit(true);
      toast(`« ${d.name} » ouvert`);
    } catch {
      toast('Fichier invalide — un export JSON de Kallax Designer est attendu');
    }
  }, { once: true });
  input.click();
}

export function exportPNG() {
  const vp = ui.viewport;
  let done = false;
  const off = vp.onAfterRender(() => {
    if (done) return;
    done = true;
    queueMicrotask(() => off());
    try {
      const url = vp.getRenderer().domElement.toDataURL('image/png');
      download(url, `${slug(store.doc.name)}.png`);
      toast('Image exportée (PNG)');
    } catch {
      toast('Export PNG impossible');
    }
  });
  vp.requestRender();
}
