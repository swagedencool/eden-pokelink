// Réglages du joueur (touches, volume, vitesse), gardés dans ce navigateur.
import { Emitter } from './core.js';

/** Actions qu'on peut associer à une touche : boutons de la console, puis raccourcis PokéLink. */
export const ACTIONS = [
  { id: 'UP', label: 'Haut', group: 'ds' }, { id: 'DOWN', label: 'Bas', group: 'ds' },
  { id: 'LEFT', label: 'Gauche', group: 'ds' }, { id: 'RIGHT', label: 'Droite', group: 'ds' },
  { id: 'A', label: 'A', group: 'ds' }, { id: 'B', label: 'B', group: 'ds' },
  { id: 'X', label: 'X', group: 'ds' }, { id: 'Y', label: 'Y', group: 'ds' },
  { id: 'L', label: 'L', group: 'ds' }, { id: 'R', label: 'R', group: 'ds' },
  { id: 'START', label: 'Start', group: 'ds' }, { id: 'SELECT', label: 'Select', group: 'ds' },
  { id: 'follower', label: 'Sortir son Pokémon', group: 'pl' }, { id: 'profile', label: 'Profil', group: 'pl' },
  { id: 'emote', label: 'Émote', group: 'pl' }, { id: 'rules', label: 'Règles de la room', group: 'pl' },
  { id: 'turbo', label: 'Accélérer le jeu', group: 'pl' }, { id: 'invite', label: 'Inviter un ami', group: 'pl' },
  { id: 'settings', label: 'Réglages', group: 'pl' },
];
export const DS_BUTTONS = new Set(ACTIONS.filter(a => a.group === 'ds').map(a => a.id));

export const DEFAULT_KEYS = {
  UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
  A: 'KeyX', B: 'KeyZ', X: 'KeyS', Y: 'KeyA', L: 'KeyQ', R: 'KeyW', START: 'Enter', SELECT: 'Backspace',
  follower: 'KeyP', profile: 'KeyC', emote: 'KeyE', rules: 'KeyR', turbo: 'Space', invite: 'KeyI', settings: 'KeyO',
};
export const SPEEDS = [1.5, 2, 3, 4];
const DEFAULTS = { keys: DEFAULT_KEYS, volume: 0.6, muted: false, turboSpeed: 2 };
const STORE = 'pokelink.settings';

// Noms lisibles des touches. Sur Chrome et Edge, la disposition réelle du clavier (AZERTY…) est utilisée.
const NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Entrée', Backspace: 'Retour', Space: 'Espace',
  Tab: 'Tab', ShiftLeft: 'Maj g.', ShiftRight: 'Maj d.', ControlLeft: 'Ctrl g.', ControlRight: 'Ctrl d.', AltLeft: 'Alt', AltRight: 'Alt Gr',
  Escape: 'Échap', CapsLock: 'Verr. maj', Delete: 'Suppr', Insert: 'Inser', Home: 'Début', End: 'Fin', PageUp: 'Pg préc.', PageDown: 'Pg suiv.' };
let layout = null;
navigator.keyboard?.getLayoutMap?.().then(m => { layout = m; settings.emit('change', settings.state); }).catch(() => {});

export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  const l = layout?.get(code);
  if (l && l.trim()) return l.toUpperCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Pavé ' + code.slice(6);
  if (/^F\d+$/.test(code)) return code;
  return code;
}

class Settings extends Emitter {
  constructor() {
    super();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
    this.state = { ...DEFAULTS, ...saved, keys: { ...DEFAULT_KEYS, ...(saved.keys || {}) } };
    this.reindex();
  }
  reindex() { this.byCode = new Map(Object.entries(this.state.keys).map(([a, c]) => [c, a])); }
  save() { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch {} this.emit('change', this.state); }
  /** Action associée à une touche (code physique de KeyboardEvent.code). */
  action(code) { return this.byCode.get(code) || null; }
  key(action) { return this.state.keys[action]; }
  label(action) { return keyName(this.state.keys[action]); }
  /** Associe une touche ; si elle servait déjà, les deux actions échangent leurs touches. Renvoie l'action échangée. */
  bind(action, code) {
    const keys = this.state.keys, other = this.byCode.get(code);
    if (other === action) return null;
    if (other) keys[other] = keys[action];
    keys[action] = code;
    this.reindex(); this.save();
    return other || null;
  }
  resetKeys() { this.state.keys = { ...DEFAULT_KEYS }; this.reindex(); this.save(); }
  set(patch) { Object.assign(this.state, patch); this.save(); }
  get effectiveVolume() { return this.state.muted ? 0 : this.state.volume; }
}

export const settings = new Settings();
