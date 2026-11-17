// Popovers anchored to a toolbar button (arrow + soft shadow), and menus.
import { h } from './dom';
import { icon } from './icons';
import { hideTip } from './controls';

let current: Popover | null = null;

export class Popover {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private arrow: HTMLElement;
  private isOpen = false;
  onOpen?: () => void;

  constructor(readonly anchor: HTMLElement, opts: { title?: string; cls?: string; role?: string; width?: number } = {}) {
    const id = `pop-${Math.random().toString(36).slice(2, 8)}`;
    this.arrow = h('div', { class: 'popover-arrow', 'aria-hidden': 'true' });
    this.body = h('div', { class: 'popover-body' });
    this.el = h('div', {
      class: `popover ${opts.cls ?? ''}`, id,
      role: opts.role ?? 'dialog',
      'aria-label': opts.title ?? anchor.getAttribute('aria-label') ?? '',
      tabindex: '-1',
      style: opts.width ? `width:${opts.width}px` : undefined,
    }, this.arrow,
      opts.title ? h('div', { class: 'popover-title' }, opts.title) : null,
      this.body);
    document.body.appendChild(this.el);
    anchor.setAttribute('aria-haspopup', opts.role === 'menu' ? 'menu' : 'dialog');
    anchor.setAttribute('aria-expanded', 'false');
    anchor.setAttribute('aria-controls', id);
    anchor.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); }
      if (opts.role === 'menu' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = [...this.el.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled]), [role=menuitemradio]:not([disabled])')];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const j = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[j]?.focus();
      }
    });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (current && current !== this) current.close();
    current = this;
    hideTip();
    this.isOpen = true;
    this.onOpen?.();
    this.position();
    this.el.classList.add('open');
    this.anchor.classList.add('active');
    this.anchor.setAttribute('aria-expanded', 'true');
    const first = this.el.querySelector<HTMLElement>('[role=menuitem], button, input, [tabindex="0"]');
    requestAnimationFrame(() => (first ?? this.el).focus({ preventScroll: true }));
  }

  close(returnFocus = false) {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (current === this) current = null;
    this.el.classList.remove('open');
    this.anchor.classList.remove('active');
    this.anchor.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.anchor.focus();
  }

  get opened() { return this.isOpen; }

  position() {
    const r = this.anchor.getBoundingClientRect();
    this.el.style.visibility = 'hidden';
    this.el.classList.add('measure');
    const w = this.el.offsetWidth;
    this.el.classList.remove('measure');
    this.el.style.visibility = '';
    const cx = r.left + r.width / 2;
    const left = Math.max(10, Math.min(window.innerWidth - w - 10, cx - w / 2));
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(r.bottom + 10)}px`;
    this.arrow.style.left = `${Math.round(cx - left)}px`;
    this.el.style.transformOrigin = `${Math.round(cx - left)}px -8px`;
  }
}

export function closeAllPopovers() { current?.close(); }

export function installPopoverDismiss() {
  document.addEventListener('pointerdown', (e) => {
    if (!current) return;
    const t = e.target as Node;
    if (current.el.contains(t) || current.anchor.contains(t)) return;
    current.close();
  }, true);
  window.addEventListener('resize', () => current?.position());
  window.addEventListener('blur', () => current?.close());
}

export interface MenuItem {
  label: string;
  icon?: string;
  kbd?: string;
  action: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
  /** Checkable item (menuitemradio): shows a checkmark in the icon column. */
  checked?: boolean;
  /** Small section heading shown above the item (after the separator). */
  heading?: string;
  /** `lang` attribute of the label (e.g. a language name in its own language). */
  lang?: string;
}

/** Fill a popover with menu items (role=menu). */
export function fillMenu(pop: Popover, items: MenuItem[]) {
  pop.body.classList.add('menu');
  for (const it of items) {
    if (it.separatorBefore) pop.body.appendChild(h('div', { class: 'menu-sep', role: 'separator' }));
    if (it.heading) pop.body.appendChild(h('div', { class: 'menu-heading', 'aria-hidden': 'true' }, it.heading));
    const checkable = it.checked !== undefined;
    const b = h('button', {
      type: 'button', role: checkable ? 'menuitemradio' : 'menuitem', tabindex: '-1',
      class: `menu-item ${it.destructive ? 'destructive' : ''}${it.checked ? ' checked' : ''}`,
      'aria-checked': checkable ? String(!!it.checked) : undefined,
    },
      checkable ? (it.checked ? icon('check', 15, 'menu-check') : h('span', { class: 'icon-spacer' }))
        : it.icon ? icon(it.icon, 15) : h('span', { class: 'icon-spacer' }),
      h('span', { class: 'menu-label', lang: it.lang }, it.label),
      it.kbd ? h('kbd', null, it.kbd) : null);
    b.addEventListener('click', () => { pop.close(); it.action(); });
    b.addEventListener('pointermove', () => { if (document.activeElement !== b) b.focus({ preventScroll: true }); });
    pop.body.appendChild(b);
  }
}
