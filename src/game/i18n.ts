// Game mode strings (FR / EN). Kept inside the lazily loaded game chunk so
// the app's dictionaries (and main bundle) only carry the toolbar / shortcut
// labels. The language is the app's (core/i18n `lang`).
import { lang } from '../core/i18n';

const fr = {
  'title': 'Jeu',
  'start': 'Cliquer pour jouer',
  'startSub': 'Échap pour quitter',
  'paused': 'Pause',
  'pausedSub': 'Échap à nouveau pour quitter',
  'retry': 'Cliquez à nouveau pour reprendre',
  'resume': 'Reprendre',
  'quit': 'Quitter',
  'loading': 'Chargement…',
  'goal': 'Détruisez tous les meubles et objets !',
  'keysMove': 'Se déplacer',
  'keysTurn': 'Tourner',
  'keysLook': 'Viser',
  'keysRun': 'Courir',
  'keysJump': 'Sauter',
  'keysCrouch': 'S’accroupir',
  'keysAttack': 'Frapper / tirer',
  'keysWeapon': 'Changer d’arme',
  'keysSound': 'Son',
  'mouse': 'souris',
  'click': 'clic',
  'space': 'Espace',
  'dragLook': 'Glisser pour viser (verrouillage du pointeur indisponible)',
  'weapon.none': 'Mains nues',
  'weapon.fists': 'Poings',
  'weapon.shotgun': 'Fusil à pompe',
  'soundOn': 'Son activé',
  'soundOff': 'Son coupé',
  'completion': 'Destruction',
  'win': 'WIN',
  'winSub': 'Tout est détruit !',
  'winStats': '{n} objets détruits en {time}',
  'replay': 'Rejouer',
  'exit': 'Sortir',
  'hud': 'T arme · M son · Échap pause',
  'noWeapon': 'T pour prendre une arme',
  'esc': 'Échap',
  'pauseWord': 'pause',
};
type Key = keyof typeof fr;

const en: Record<Key, string> = {
  'title': 'Game',
  'start': 'Click to play',
  'startSub': 'Esc to exit',
  'paused': 'Paused',
  'pausedSub': 'Esc again to exit',
  'retry': 'Click again to resume',
  'resume': 'Resume',
  'quit': 'Quit',
  'loading': 'Loading…',
  'goal': 'Destroy every piece of furniture and object!',
  'keysMove': 'Move',
  'keysTurn': 'Turn',
  'keysLook': 'Aim',
  'keysRun': 'Run',
  'keysJump': 'Jump',
  'keysCrouch': 'Crouch',
  'keysAttack': 'Punch / shoot',
  'keysWeapon': 'Switch weapon',
  'keysSound': 'Sound',
  'mouse': 'mouse',
  'click': 'click',
  'space': 'Space',
  'dragLook': 'Drag to aim (pointer lock unavailable)',
  'weapon.none': 'Bare hands',
  'weapon.fists': 'Fists',
  'weapon.shotgun': 'Pump shotgun',
  'soundOn': 'Sound on',
  'soundOff': 'Sound off',
  'completion': 'Destruction',
  'win': 'WIN',
  'winSub': 'Everything is destroyed!',
  'winStats': '{n} objects destroyed in {time}',
  'replay': 'Play again',
  'exit': 'Exit',
  'hud': 'T weapon · M sound · Esc pause',
  'noWeapon': 'T to pick a weapon',
  'esc': 'Esc',
  'pauseWord': 'pause',
};

const dict: Record<Key, string> = lang === 'fr' ? fr : en;

export function gt(key: Key, params?: Record<string, string | number>): string {
  const s = dict[key] ?? fr[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}
