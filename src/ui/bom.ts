// Bill of materials UI: priced shopping list, clipboard text, pinned total footer.
import { store } from '../core/store';
import { buildBom, fmtEur, type BomLine } from '../core/finishes';
import { h } from './dom';
import { icon } from './icons';

export const PRICE_SOURCE = 'Prix IKEA France, nov. 2026';

export type Bom = ReturnType<typeof buildBom>;

/** BOM of the visible composition (what the footer and the Composition panel show). */
export function currentBom(): Bom {
  return buildBom(store.visibleItems(), store.doc.finish, store.doc.basket);
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
export function articleCount(b: Bom): number { return b.lines.reduce((s, l) => s + l.qty, 0); }

/** "6 articles · 1 non chiffré" */
export function bomSummary(b: Bom): string {
  const n = articleCount(b);
  if (!n) return 'Aucun article';
  return plural(n, 'article', 'articles') + (b.unpriced ? ` · ${plural(b.unpriced, 'non chiffré', 'non chiffrés')}` : '');
}

function bomRow(l: BomLine): HTMLElement {
  return h('li', { class: `bom-row kind-${l.kind}${l.unit == null ? ' unpriced' : ''}${l.note ? ' has-note' : ''}` },
    h('span', { class: 'qty' }, `${l.qty}×`),
    h('span', { class: 'bom-main' },
      h('span', { class: 'bom-label' }, l.label),
      h('small', { class: 'bom-detail' }, l.detail)),
    h('span', { class: 'bom-price' },
      h('span', { class: 'bom-total' }, l.total != null ? fmtEur(l.total) : '—'),
      l.unit != null && l.qty > 1 ? h('small', { class: 'bom-unit' }, `${fmtEur(l.unit)} /u`) : null,
      l.unit == null ? h('small', { class: 'bom-unit' }, 'sans prix') : null),
    l.note ? h('small', { class: 'bom-note' }, icon('warning', 11), h('span', null, l.note)) : null,
  );
}

export function bomList(b: Bom): HTMLElement {
  const ul = h('ul', { class: 'shop-list bom-list', 'aria-label': 'Liste de courses chiffrée' });
  if (!b.lines.length) ul.appendChild(h('li', { class: 'empty' }, 'Aucun meuble pour l’instant.'));
  for (const l of b.lines) ul.appendChild(bomRow(l));
  return ul;
}

/** Plain-text version (clipboard). */
export function bomText(b: Bom, title: string): string {
  const out = [`${title} — liste de courses`, `(${PRICE_SOURCE})`, ''];
  for (const l of b.lines) {
    const price = l.unit == null ? 'prix non renseigné'
      : l.qty > 1 ? `${l.qty} × ${fmtEur(l.unit)} = ${fmtEur(l.total!)}` : fmtEur(l.unit);
    out.push(`${l.qty} × ${l.label} (${l.detail}) — ${price}`);
    if (l.note) out.push(`    ⚠ ${l.note}`);
  }
  out.push('', `Total : ${fmtEur(b.total)}` + (b.unpriced ? ` (+ ${plural(b.unpriced, 'article non chiffré', 'articles non chiffrés')})` : ''));
  return out.join('\n');
}

// ── pinned total footer ──────────────────────────────────────
export function buildTotalFooter(onActivate: () => void): HTMLElement {
  const amount = h('span', { class: 'total-amount' });
  const sub = h('span', { class: 'total-sub' });
  const btn = h('button', { type: 'button', class: 'total-card' },
    h('span', { class: 'total-row' },
      h('span', { class: 'total-label' }, 'Total'),
      amount),
    h('span', { class: 'total-row total-row-sub' },
      sub,
      h('span', { class: 'total-go', 'aria-hidden': 'true' }, 'Détail', icon('chevronRight', 11))),
  );
  btn.addEventListener('click', onActivate);
  const el = h('footer', { class: 'insp-total', 'aria-label': 'Total de la composition' },
    btn,
    h('p', { class: 'total-source' }, PRICE_SOURCE));

  let last = '';
  const update = () => {
    const b = currentBom();
    const txt = fmtEur(b.total);
    amount.textContent = txt;
    sub.textContent = bomSummary(b);
    sub.classList.toggle('has-unpriced', b.unpriced > 0);
    btn.setAttribute('aria-label', `Total ${txt}, ${bomSummary(b)}. Afficher le détail.`);
    if (last && last !== txt) {
      amount.classList.remove('bump');
      void amount.offsetWidth;
      amount.classList.add('bump');
    }
    last = txt;
  };
  let raf = 0;
  store.on(ev => { if (ev === 'doc' && !raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); });
  update();
  return el;
}
