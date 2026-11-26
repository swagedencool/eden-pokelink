// Routage des entrées : clavier → jeu, ou clavier → interface.
// Quand un panneau est ouvert, le jeu ne reçoit plus rien (le personnage ne bouge pas en arrière-plan)
// mais l'émulation continue normalement. Les amis sont « solides » : avancer vers eux fait seulement
// se tourner (appui de 4 frames, mesuré sur Platine : ≤ 6 frames = demi-tour sans pas).

import { Emitter } from './core.js';

export const KEYMAP = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  KeyX: 'A', KeyZ: 'B', KeyS: 'X', KeyA: 'Y', KeyQ: 'L', KeyW: 'R', Enter: 'START', Backspace: 'SELECT',
};
export const HOTKEYS = { KeyP: 'follower', KeyC: 'profile', KeyE: 'emote', KeyR: 'rules' };
const DIR_OF = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 };
const TURN_TAP_FRAMES = 4;

export class InputRouter extends Emitter {
  constructor(target = window) {
    super();
    this.held = new Set();      // touches DS tenues (après routage)
    this.taps = new Map();      // touche -> frames restantes (demi-tours)
    this.blocked = new Set();   // directions retenues (ami devant)
    this.uiActive = () => false;
    this.isBlocked = () => false;  // (dir) => un ami occupe la case dans cette direction ?
    this.facing = () => 1;
    target.addEventListener('keydown', e => this.down(e));
    target.addEventListener('keyup', e => this.up(e));
  }
  down(e) {
    if (e.target?.tagName === 'INPUT' && !['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.code)) return;
    const k = KEYMAP[e.code];
    if (e.repeat) { e.preventDefault?.(); return; }
    if (this.uiActive()) {
      e.preventDefault?.();
      const nav = k || (e.code === 'Escape' ? 'B' : null);
      if (nav) this.emit('nav', nav);
      return;
    }
    if (HOTKEYS[e.code]) { e.preventDefault?.(); this.emit('hotkey', HOTKEYS[e.code]); return; }
    if (!k) return;
    e.preventDefault?.();
    if (k === 'A') {
      this._consumeA = false;
      this.emit('a-press');
      if (this._consumeA) { this._consumeA = false; return; }
    }
    if (k in DIR_OF && this.isBlocked(DIR_OF[k])) {
      this.blocked.add(k);
      if (this.facing() !== DIR_OF[k]) this.taps.set(k, TURN_TAP_FRAMES);
      return;
    }
    this.held.add(k);
  }
  up(e) {
    const k = KEYMAP[e.code];
    if (!k) return;
    this.held.delete(k); this.blocked.delete(k);
  }
  /** Le gestionnaire d'interface peut « prendre » le A (ex. pour ouvrir le menu d'un ami). */
  consumeA() { this._consumeA = true; }
  /** Libère tout (ouverture d'un panneau pendant qu'une touche est tenue). */
  releaseAll() { this.held.clear(); this.taps.clear(); }
  /** Touches à envoyer à l'émulateur pour cette frame. */
  frameKeys() {
    const out = new Set(this.uiActive() ? [] : this.held);
    for (const [k, n] of this.taps) { out.add(k); if (n <= 1) this.taps.delete(k); else this.taps.set(k, n - 1); }
    // une direction retenue se libère si l'ami s'est écarté
    for (const k of this.blocked) if (!this.isBlocked(DIR_OF[k])) { this.blocked.delete(k); this.held.add(k); }
    return out;
  }
}
