// Game easter egg — entry point, loaded lazily by the walk mode's T key
// (src/interaction/walk/walk-mode.ts). Remove that block and src/game/ to
// take the game out: nothing else in the app imports this folder.
export { startGame } from './game';
export type { GameOptions, GameStart } from './game';
