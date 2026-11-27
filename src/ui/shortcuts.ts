// ─────────────────────────────────────────────────────────────
// Keyboard & mouse shortcuts sheet (modal <dialog>, "?" or the … menu).
//
// Apple-style grouped lists: one card per section, flowing in 1 – 3
// columns (CSS multi-column, sections never split). Key caps follow the
// platform: ⌘ ⇧ ⌥ ⌃ glyphs on macOS (Apple modifier order ⌃⌥⇧⌘), Ctrl /
// Shift / Alt joined with "+" elsewhere. Mouse gestures are pill chips with
// a small icon ("glisser", "molette", "clic droit"…).
//
// Every entry below is wired in the code — keyboard.ts, main.ts (⌘S / ⌘O),
// select-move.ts, marquee.ts, viewport.ts (OrbitControls), rotate-tool.ts,
// walk/walk-mode.ts. Keep this list in sync when a shortcut changes.
// ─────────────────────────────────────────────────────────────
import { h, isMac, svg } from './dom';
import { icon } from './icons';
import { t, type TKey } from '../core/i18n';

type Mouse = 'click' | 'dblclick' | 'clickEmpty' | 'drag' | 'rdrag' | 'mdrag' | 'wheel' | 'pinch' | 'mouse';
type Part = string | { m: Mouse };
type Combo = Part[];
interface Row { label: string; note?: string; combos: Combo[] }
type SectionId = 'nav' | 'select' | 'edit' | 'rotate' | 'project' | 'walk';
interface Section { id: SectionId; icon: string; title: string; rows: Row[] }

/** Platform modifier caps. */
const K = isMac
  ? { cmd: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
  : { cmd: 'Ctrl', shift: t('kc.shift'), alt: 'Alt', ctrl: 'Ctrl' };

const M = (m: Mouse): Part => ({ m });
const row = (label: TKey, combos: Combo[], note?: TKey): Row => ({ label: t(label), combos, note: note ? t(note) : undefined });

// ── mouse gesture glyphs (24 grid, drawn like icons.ts) ──
const MOUSE_BODY = '<rect x="6.5" y="2.75" width="11" height="18.5" rx="5.5"/>';
const BTN_SPLIT = '<path d="M6.5 9.25h11M12 2.75v6.5"/>';
const FILL_L = '<path d="M12 2.75a5.5 5.5 0 0 0-5.5 5.5v1H12z" fill="currentColor" stroke="none"/>';
const FILL_R = '<path d="M12 2.75a5.5 5.5 0 0 1 5.5 5.5v1H12z" fill="currentColor" stroke="none"/>';
const WHEEL = '<rect x="10.6" y="5" width="2.8" height="5.2" rx="1.4" fill="currentColor" stroke="none"/>';
const GLYPH: Record<Mouse, string> = {
  click: MOUSE_BODY + BTN_SPLIT + FILL_L,
  dblclick: MOUSE_BODY + BTN_SPLIT + FILL_L,
  clickEmpty: MOUSE_BODY + BTN_SPLIT + FILL_L,
  rdrag: MOUSE_BODY + BTN_SPLIT + FILL_R,
  mdrag: MOUSE_BODY + '<path d="M6.5 11.5h11"/>' + WHEEL,
  wheel: MOUSE_BODY + '<path d="M6.5 11.5h11"/>' + WHEEL,
  mouse: MOUSE_BODY + BTN_SPLIT,
  drag: '<path d="M12 3v18M3 12h18"/><path d="m9 5.6 3-2.6 3 2.6M9 18.4l3 2.6 3-2.6M5.6 9 3 12l2.6 3M18.4 9l2.6 3-2.6 3"/>',
  pinch: '<path d="M4 4l5.5 5.5M10 4.8v5.2H4.8M20 20l-5.5-5.5M14 19.2V14h5.2"/>',
};
const MOUSE_LABEL: Record<Mouse, TKey> = {
  click: 'ms.click', dblclick: 'ms.dblclick', clickEmpty: 'ms.clickEmpty', drag: 'ms.drag', rdrag: 'ms.rdrag',
  mdrag: 'ms.mdrag', wheel: 'ms.wheel', pinch: 'ms.pinch', mouse: 'ms.mouse',
};
const glyph = (m: Mouse) => svg(`<svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${GLYPH[m]}</svg>`);

function sections(): Section[] {
  const esc = t('key.esc');
  const arrows = '←↑→↓';
  const del: Combo[] = isMac ? [['⌫'], ['⌦']] : [['⌫'], [t('key.del')]];
  return [
    { id: 'nav', icon: 'orbit', title: t('sc.secNav'), rows: [
      row('sc.orbit', [[M('drag')]], 'sc.orbitNote'),
      row('sc.pan', [[K.ctrl, M('drag')], [M('rdrag')], [M('mdrag')]]),
      row('sc.zoom', [[M('wheel')], [M('pinch')]]),
      row('sc.fit', [['F']]),
      row('sc.viewCube', [[M('click')]], 'sc.viewCubeNote'),
      row('sc.iso', [['1']]),
      row('sc.cavalier', [['2']]),
      row('sc.proj', [['P']]),
      row('sc.dims', [['M']]),
      row('sc.grid', [['G']]),
    ] },
    { id: 'select', icon: 'cursor', title: t('sc.secSelect'), rows: [
      row('sc.select', [[M('click')]]),
      row('sc.toggle', [[K.shift, M('click')], [K.cmd, M('click')]]),
      row('sc.marquee', [[K.shift, M('drag')]], 'sc.marqueeNote'),
      row('sc.marqueeAdd', [isMac ? [K.shift, K.cmd, M('drag')] : [K.shift, K.alt, M('drag')]]),
      row('sc.selectAll', [[K.cmd, 'A']]),
      row('sc.deselect', [[esc], [M('clickEmpty')]]),
      row('sc.enterGroup', [[M('dblclick')], [K.alt, M('click')]]),
      row('sc.exitGroup', [[esc]]),
    ] },
    { id: 'edit', icon: 'duplicate', title: t('sc.secEdit'), rows: [
      row('sc.move', [[M('drag')]], 'sc.moveNote'),
      row('sc.dupDrag', [[K.alt, M('drag')]]),
      row('sc.dupRight', [[K.cmd, 'D']]),
      row('sc.delete', del),
      row('sc.nudge', [[arrows]]),
      row('sc.nudge10', [[K.shift, arrows]]),
      row('sc.nudgeFine', [[K.alt, arrows]]),
      row('sc.upDown', [[t('kc.pageUp')], [t('kc.pageDown')]]),
      row('sc.group', [[K.cmd, 'G']]),
      row('sc.ungroup', [isMac ? [K.shift, K.cmd, 'G'] : [K.cmd, K.shift, 'G']]),
      row('sc.undo', [[K.cmd, 'Z']]),
      row('sc.redo', [isMac ? [K.shift, K.cmd, 'Z'] : [K.cmd, K.shift, 'Z'], [K.cmd, 'Y']]),
      row('sc.cancel', [[esc]]),
    ] },
    { id: 'rotate', icon: 'rotateCw', title: t('sc.secRotate'), rows: [
      row('sc.rotCw', [['R']]),
      row('sc.rotCcw', [[K.shift, 'R']]),
      { ...row('sc.tilt', [['X'], ['Y']]), note: t('sc.tiltNote', { shift: K.shift }) },
      row('sc.rotHandle', [[M('drag')]], 'sc.rotHandleNote'),
      { ...row('sc.rotKeys', [['←→'], [K.alt, '←→']]), note: t('sc.rotKeysNote', { alt: K.alt }) },
      row('sc.rotLock', [[M('click')]]),
      row('sc.rotPick', [[M('click')]]),
      row('sc.rotPickCancel', [[esc]]),
    ] },
    { id: 'project', icon: 'folder', title: t('sc.secProject'), rows: [
      row('sc.save', [[K.cmd, 'S']]),
      row('sc.saveAs', [isMac ? [K.shift, K.cmd, 'S'] : [K.cmd, K.shift, 'S']]),
      row('sc.open', [[K.cmd, 'O']]),
      row('sc.shortcuts', [['?']]),
    ] },
    { id: 'walk', icon: 'walk', title: t('sc.secWalk'), rows: [
      row('sc.walk', [['V']]),
      row('sc.walkStart', [[M('click')], [t('kc.enter')]]),
      row('sc.walkLook', [[M('mouse')]]),
      row('sc.walkMove', [['ZQSD'], ['WASD'], [arrows]]),
      row('sc.walkRun', [[K.shift]]),
      row('sc.walkJump', [[t('walk.space')]]),
      row('sc.walkCrouch', [['C']]),
      row('sc.walkHeight', [['E']]),
      row('sc.walkSound', [['M']]),
      row('sc.walkBob', [['B']]),
      row('sc.walkExit', [[esc]]),
    ] },
  ];
}

const isKey = (p: Part): p is string => typeof p === 'string';
const MOD_GLYPHS = new Set(['⌘', '⇧', '⌥', '⌃']);

function renderCombo(c: Combo): HTMLElement {
  const out = h('span', { class: 'sc-combo' });
  c.forEach((p, i) => {
    if (i > 0) {
      // macOS: modifier caps sit side by side (⇧⌘Z); "+" only before a mouse gesture
      const prev = c[i - 1];
      const plus = !isMac || !isKey(p) || !isKey(prev);
      if (plus) out.append(h('span', { class: 'sc-plus', 'aria-hidden': 'true' }, '+'));
    }
    if (isKey(p)) {
      const cls = ['sc-key'];
      if (MOD_GLYPHS.has(p)) cls.push('mod');
      if (p.length > 1 && !MOD_GLYPHS.has(p)) cls.push('wide');
      if (/^[←↑→↓]+$/.test(p)) cls.push('arrows');
      out.append(h('kbd', { class: cls.join(' ') }, p));
    } else {
      out.append(h('span', { class: `sc-mouse sc-mouse-${p.m}` }, glyph(p.m), h('span', null, t(MOUSE_LABEL[p.m]))));
    }
  });
  return out;
}

function renderRow(r: Row): HTMLElement {
  const keys = h('div', { class: 'sc-keys' });
  r.combos.forEach((c, i) => {
    const combo = renderCombo(c);
    // "ou" travels with the alternative it introduces (never dangles at a line end)
    if (i > 0) combo.prepend(h('span', { class: 'sc-or' }, t('sc.or')));
    keys.append(combo);
  });
  return h('li', { class: 'sc-row' },
    h('div', { class: 'sc-label' }, h('span', null, r.label), r.note ? h('span', { class: 'sc-note' }, r.note) : null),
    keys);
}

/**
 * Sections per column, balanced by hand (row counts) for each column count;
 * one column keeps the natural order.
 */
const LAYOUTS: Record<1 | 2 | 3, SectionId[][]> = {
  3: [['nav', 'select'], ['edit', 'project'], ['rotate', 'walk']],
  2: [['nav', 'select', 'rotate'], ['edit', 'project', 'walk']],
  1: [['nav', 'select', 'edit', 'rotate', 'project', 'walk']],
};
/** Minimum comfortable column width (CSS px). */
const COL_MIN = 300;

export function buildShortcutsSheet() {
  const close = h('button', { type: 'button', class: 'sheet-close', 'aria-label': t('common.close') }, icon('xmark', 14));
  const els = new Map<SectionId, HTMLElement>(sections().map(s => [s.id,
    h('section', { class: 'sc-section', 'aria-labelledby': `sc-sec-${s.id}` },
      h('h3', { id: `sc-sec-${s.id}` }, icon(s.icon, 15), s.title),
      h('ul', { class: 'sc-card' }, s.rows.map(renderRow)))]));
  // the body takes focus on open (scrollable with the keyboard, no focus ring on the close button)
  const body = h('div', { class: 'sc-body', tabindex: '-1', autofocus: true });
  let cols = 0;
  const layout = () => {
    const w = body.clientWidth - 40; // minus the side padding
    const n: 1 | 2 | 3 = w >= COL_MIN * 3 + 44 ? 3 : w >= COL_MIN * 2 + 22 ? 2 : 1;
    if (n === cols) return;
    cols = n;
    body.style.setProperty('--sc-cols', String(n));
    body.replaceChildren(...LAYOUTS[n].map(ids => h('div', { class: 'sc-col' }, ids.map(id => els.get(id)!))));
  };
  new ResizeObserver(() => { if (body.clientWidth) layout(); }).observe(body);
  const dlg = h('dialog', { class: 'sheet sc-sheet', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'sheet-head sc-head' },
      h('div', { class: 'sc-badge' }, icon('keyboard', 18)),
      h('div', { class: 'sc-titles' },
        h('h2', { id: 'sheet-title' }, t('sc.title')),
        h('p', null, isMac ? t('sc.platformMac') : t('sc.platformPc'))),
      close),
    body,
  );
  close.addEventListener('click', () => closeSheet());
  // click on the backdrop (outside the panel) closes
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  document.body.appendChild(dlg);
  let closing = 0;
  function closeSheet() {
    if (!dlg.open || closing) return;
    dlg.classList.add('closing');
    closing = window.setTimeout(() => { closing = 0; dlg.classList.remove('closing'); dlg.close(); }, 160);
  }
  return {
    open() { if (!dlg.open) { dlg.showModal(); layout(); body.scrollTop = 0; body.focus({ preventScroll: true }); } },
    isOpen: () => dlg.open,
  };
}
