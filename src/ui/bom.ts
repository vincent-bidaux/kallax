// Bill of materials UI: priced shopping list, clipboard text, pinned total footer.
import { store } from '../core/store';
import { buildBom, fmtEur, type BomLine } from '../core/finishes';
import { h } from './dom';
import { icon } from './icons';
import { t, tn } from '../core/i18n';

export const PRICE_SOURCE = t('bom.source');

export type Bom = ReturnType<typeof buildBom>;

/** BOM of the visible composition (what the footer and the Composition panel show). */
export function currentBom(): Bom {
  return buildBom(store.visibleItems(), store.doc.finish, store.doc.basket, store.doc.eketFinish);
}

export function articleCount(b: Bom): number { return b.lines.reduce((s, l) => s + l.qty, 0); }

/** "6 articles · 1 non chiffré" */
export function bomSummary(b: Bom): string {
  const n = articleCount(b);
  if (!n) return t('bom.none');
  return tn('bom.articles', n) + (b.unpriced ? ` · ${tn('bom.unpriced', b.unpriced)}` : '');
}

function bomRow(l: BomLine): HTMLElement {
  return h('li', { class: `bom-row kind-${l.kind}${l.unit == null ? ' unpriced' : ''}${l.note ? ' has-note' : ''}` },
    h('span', { class: 'qty' }, `${l.qty}×`),
    h('span', { class: 'bom-main' },
      h('span', { class: 'bom-label' }, l.label),
      h('small', { class: 'bom-detail' }, l.detail)),
    h('span', { class: 'bom-price' },
      h('span', { class: 'bom-total' }, l.total != null ? fmtEur(l.total) : '—'),
      l.unit != null && l.qty > 1 ? h('small', { class: 'bom-unit' }, t('bom.perUnit', { price: fmtEur(l.unit) })) : null,
      l.unit == null ? h('small', { class: 'bom-unit' }, t('bom.noPrice')) : null),
    l.note ? h('small', { class: 'bom-note' }, icon('warning', 11), h('span', null, l.note)) : null,
  );
}

export function bomList(b: Bom): HTMLElement {
  const ul = h('ul', { class: 'shop-list bom-list', 'aria-label': t('bom.listAria') });
  if (!b.lines.length) ul.appendChild(h('li', { class: 'empty' }, t('bom.empty')));
  for (const l of b.lines) ul.appendChild(bomRow(l));
  return ul;
}

/** Plain-text version (clipboard). */
export function bomText(b: Bom, title: string): string {
  const out = [t('bom.textTitle', { title }), `(${PRICE_SOURCE})`, ''];
  for (const l of b.lines) {
    const price = l.unit == null ? t('bom.textNoPrice')
      : l.qty > 1 ? `${l.qty} × ${fmtEur(l.unit)} = ${fmtEur(l.total!)}` : fmtEur(l.unit);
    out.push(`${l.qty} × ${l.label} (${l.detail}) — ${price}`);
    if (l.note) out.push(`    ⚠ ${l.note}`);
  }
  out.push('', t('bom.textTotal', { amount: fmtEur(b.total) }) + (b.unpriced ? ` (+ ${tn('bom.textUnpriced', b.unpriced)})` : ''));
  return out.join('\n');
}

// ── pinned total footer ──────────────────────────────────────
export function buildTotalFooter(onActivate: () => void): HTMLElement {
  const amount = h('span', { class: 'total-amount' });
  const sub = h('span', { class: 'total-sub' });
  const btn = h('button', { type: 'button', class: 'total-card' },
    h('span', { class: 'total-row' },
      h('span', { class: 'total-label' }, t('common.total')),
      amount),
    h('span', { class: 'total-row total-row-sub' },
      sub,
      h('span', { class: 'total-go', 'aria-hidden': 'true' }, t('bom.details'), icon('chevronRight', 11))),
  );
  btn.addEventListener('click', onActivate);
  const el = h('footer', { class: 'insp-total', 'aria-label': t('bom.footerAria') },
    btn,
    h('p', { class: 'total-source' }, PRICE_SOURCE));

  let last = '';
  const update = () => {
    const b = currentBom();
    const txt = fmtEur(b.total);
    amount.textContent = txt;
    sub.textContent = bomSummary(b);
    sub.classList.toggle('has-unpriced', b.unpriced > 0);
    btn.setAttribute('aria-label', t('bom.totalAria', { amount: txt, summary: bomSummary(b) }));
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
