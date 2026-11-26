// Routage des entrées : clavier → jeu, ou clavier → interface.
// Quand un panneau est ouvert, le jeu ne reçoit plus rien (le personnage ne bouge pas en arrière-plan)
// mais l'émulation continue normalement. Les amis sont « solides » : avancer vers eux fait seulement
// se tourner (appui de 4 frames, mesuré sur Platine : ≤ 6 frames = demi-tour sans pas).

import { Emitter } from './core.js';
import { settings, DS_BUTTONS } from './settings.js';

// Touches réglables (voir settings.js). Dans les menus, flèches, Entrée et Échap marchent toujours en plus.
const MENU_FALLBACK = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'A', NumpadEnter: 'A', Escape: 'B' };
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
    this.speed = () => 1;      // vitesse du jeu : un demi-tour dure 4 images du jeu, quel que soit le turbo
    this.capture = null;
    this.auto = null;          // touches tenues par la marche à la souris
    target.addEventListener('keydown', e => this.down(e), true);
    target.addEventListener('keyup', e => this.up(e));
  }
  down(e) {
    if (this.capture) {                       // réglage d'une touche : la prochaine touche pressée est prise telle quelle
      e.preventDefault?.(); e.stopPropagation?.();
      const f = this.capture; this.capture = null; f(e.code); return;
    }
    const tag = e.target?.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.code)) return;
    const act = settings.action(e.code), k = DS_BUTTONS.has(act) ? act : null;
    if (e.repeat) { if (k || act) e.preventDefault?.(); return; }
    if (this.uiActive()) {
      const nav = k || MENU_FALLBACK[e.code] || null;
      if (nav || act) e.preventDefault?.();
      if (nav) this.emit('nav', nav);
      else if (act === 'settings' || act === 'invite') this.emit('hotkey', act);
      return;
    }
    if (act && !k) { e.preventDefault?.(); this.emit('hotkey', act); return; }
    if (!k) return;
    e.preventDefault?.();
    if (k === 'A') {
      this._consumeA = false;
      this.emit('a-press');
      if (this._consumeA) { this._consumeA = false; return; }
    }
    if (k in DIR_OF && this.auto) { this.auto = null; this.emit('manual'); }   // le clavier reprend la main
    if (k in DIR_OF && this.isBlocked(DIR_OF[k])) {
      this.blocked.add(k);
      if (this.facing() !== DIR_OF[k]) this.taps.set(k, this.turnTap());
      return;
    }
    this.held.add(k);
  }
  up(e) {
    const act = settings.action(e.code);
    if (act === 'turbo') this.emit('hotkey-up', act);
    if (!DS_BUTTONS.has(act)) return;
    this.held.delete(act); this.blocked.delete(act);
  }
  turnTap() { return Math.max(1, Math.round(TURN_TAP_FRAMES / this.speed())); }
  /** Le gestionnaire d'interface peut « prendre » le A (ex. pour ouvrir le menu d'un ami). */
  consumeA() { this._consumeA = true; }
  /** Libère tout (ouverture d'un panneau pendant qu'une touche est tenue). */
  releaseAll() { this.held.clear(); this.taps.clear(); }
  /** Touches à envoyer à l'émulateur pour cette frame. */
  frameKeys() {
    const out = new Set(this.uiActive() ? [] : this.held);
    if (this.auto && !this.uiActive()) for (const k of this.auto) out.add(k);   // marche à la souris
    for (const [k, n] of this.taps) { out.add(k); if (n <= 1) this.taps.delete(k); else this.taps.set(k, n - 1); }
    // une direction retenue se libère si l'ami s'est écarté
    for (const k of this.blocked) if (!this.isBlocked(DIR_OF[k])) { this.blocked.delete(k); this.held.add(k); }
    return out;
  }
}
