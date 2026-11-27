// Default names written in the other language ("Window" in a French session,
// "Calque 2" in an English one) are switched to the current language when a
// document is loaded: autosave at startup, project open, JSON import, demo.
// Only names the app generated are touched; anything the user typed is kept.
import type { DesignDoc } from '../core/types';
import { t, tIn, lang, translatorFor, type Lang, type TKey } from '../core/i18n';
import { autoName, objLabel } from './object-labels';
import { eketDisplayName } from '../core/eket';

/** Short default names of older versions (fr, en), by block shape. */
const LEGACY: Partial<Record<string, [string, string][]>> = {
  cylinder: [['Poutre', 'Beam']],
  square: [['Poutre carrée', 'Square beam']],
  box: [['Bloc', 'Block'], ['Brique', 'Brick']],
};

const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `{n}` template of `key` in language `l` → regex capturing n. */
function numbered(l: Lang, key: TKey): RegExp {
  return new RegExp(`^${reEsc(tIn(l, key, { n: '\u0000' })).replace('\u0000', '(\\d+)')}$`);
}

export function localizeDoc(d: DesignDoc): void {
  const other: Lang = lang === 'fr' ? 'en' : 'fr';
  const tr = translatorFor(other);
  const swap = (v: string, keys: TKey[]): string => {
    for (const k of keys) if (v === tIn(other, k)) return t(k);
    return v;
  };

  d.name = swap(d.name, ['doc.untitled', 'seed.docName']);
  if (/^default library$/i.test(d.name) || d.name === tIn(other, 'seed.defaultName')) d.name = t('seed.defaultName');

  const layerRe = numbered(other, 'layer.default');
  for (const l of d.layers) {
    const m = l.name.match(layerRe);
    l.name = m ? t('layer.default', { n: Number(m[1]) }) : swap(l.name, ['seed.furniture', 'seed.existing']);
  }

  if (d.groups) {
    const groupRe = numbered(other, 'group.defaultName');
    for (const g of Object.values(d.groups)) {
      const m = g.name.match(groupRe);
      if (m) g.name = t('group.defaultName', { n: Number(m[1]) });
    }
  }

  const legsOther = tIn(other, 'kallax.legsSuffix');
  for (const it of d.items) {
    if (it.kind === 'kallax') {
      if (it.name.endsWith(legsOther) && /^Kallax \d×\d/.test(it.name)) it.name = it.name.slice(0, -legsOther.length) + t('kallax.legsSuffix');
    } else if (it.kind === 'eket') {
      const label = tIn(other, `eket.v.${camel(it.variant)}` as TKey);
      if (it.name === tIn(other, 'eket.name', { variant: label })) it.name = eketDisplayName(it.variant);
    } else {
      if (it.name === autoName(it.shape, it.variant, tr, it.opts)) it.name = autoName(it.shape, it.variant, undefined, it.opts);
      else if (it.name === objLabel(it.shape, tr)) it.name = objLabel(it.shape);
      else if (it.name === tIn(other, 'preset.frenchWindow')) it.name = t('preset.frenchWindow');
      else {
        const pair = LEGACY[it.shape ?? 'box']?.find(p => p[other === 'fr' ? 0 : 1] === it.name);
        if (pair) it.name = pair[lang === 'fr' ? 0 : 1];
      }
    }
  }
}
