// Émulateur dans le navigateur : EmulatorJS (GPL-3.0) et ses cœurs libretro compilés en WebAssembly
// (melonDS pour la DS, mGBA pour la GBA, Gambatte pour la Game Boy / Color), servis depuis /vendor/emulatorjs.
//
// PokéLink ne garde de l'interface d'EmulatorJS que le moteur : l'image est recopiée dans les écrans
// de PokéLink, les touches sont injectées par PokéLink (interface glass et jeu se partagent le clavier),
// et la mémoire du jeu est lue directement dans la mémoire WebAssembly du cœur.

// DS : DeSmuME 2015 par défaut (melonDS affiche « Erreur de communication » au démarrage avec certaines
// sauvegardes de Platine : le menu principal y échoue à initialiser le sans-fil). melonDS reste disponible.
export const CORES = { nds: 'desmume2015', gba: 'mgba', gbc: 'gambatte', gb: 'gambatte' };
/** Dossier de sauvegarde de chaque cœur (RetroArch range les sauvegardes par nom de cœur). */
const SAVE_DIR = { melonds: 'melonDS', desmume2015: 'DeSmuME 2015', mgba: 'mGBA', gambatte: 'Gambatte' };
/** Numéros des boutons libretro (RETRO_DEVICE_ID_JOYPAD_*). */
export const RETRO = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 };

const HIDDEN_BUTTONS = ['playPause', 'restart', 'mute', 'settings', 'fullscreen', 'saveState', 'loadState', 'screenRecord', 'gamepad', 'cheat',
  'volume', 'saveSavFiles', 'loadSavFiles', 'quickSave', 'quickLoad', 'screenshot', 'cacheManager', 'exitEmulation', 'netplay', 'diskButton', 'contextMenu'];

let patched = false;
/** L'image doit pouvoir être recopiée après le rendu : on garde le tampon WebGL (coût négligeable). */
function keepDrawingBuffer() {
  if (patched) return; patched = true;
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(type)) attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
    return orig.call(this, type, attrs);
  };
}

export class EmuHost {
  /** ownInput : PokéLink gère le clavier (sinon EmulatorJS garde ses touches par défaut). */
  constructor({ mount, platform, dataPath = 'vendor/emulatorjs/', core, ownInput = true }) {
    Object.assign(this, { mount, platform, dataPath, ownInput, keys: new Set() });
    this.core = core || CORES[platform];
    if (!this.core) throw new Error('Console non prise en charge : ' + platform);
  }
  /** Démarre le jeu. save : octets de la sauvegarde du joueur (facultatif). */
  start(rom, name, save) {
    keepDrawingBuffer();
    return new Promise((resolve, reject) => {
      const w = window;
      Object.assign(w, {
        EJS_player: this.mount, EJS_core: this.core, EJS_gameName: 'pokelink-' + name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase(),
        EJS_pathtodata: this.dataPath, EJS_startOnLoaded: true, EJS_threads: false, EJS_volume: 0.6, EJS_language: 'fr-FR',
        EJS_Buttons: Object.fromEntries(HIDDEN_BUTTONS.map(b => [b, false])),
        ...(this.ownInput ? { EJS_defaultControls: { 0: {}, 1: {}, 2: {}, 3: {} } } : {}),
        EJS_backgroundColor: '#000000', EJS_noAutoFocus: true,
      });
      // La sauvegarde du joueur est posée dans le dossier des sauvegardes AVANT le chargement du jeu :
      // le cœur la trouve au démarrage, exactement comme une cartouche (pas de redémarrage, pas d'erreur de mémoire).
      const key = this.saveKey = w.EJS_gameName;
      w.EJS_gameUrl = new File([rom], key + '.' + (this.platform === 'nds' ? 'nds' : this.platform));
      const hook = () => {
        const e = window.EJS_emulator;
        if (!e) return setTimeout(hook, 30);
        e.on('saveDatabaseLoaded', FS => {
          const dir = `/data/saves/${SAVE_DIR[this.core]}`;
          try { if (!FS.analyzePath(dir).exists) FS.mkdir(dir); } catch {}
          for (const p of ['sav', 'srm', 'dsv'].flatMap(ext => [`${dir}/${key}.${ext}`, `/data/saves/${key}.${ext}`])) {
            try {
              if (save) FS.writeFile(p, p.endsWith('.dsv') ? toDsv(new Uint8Array(save)) : rawSave(new Uint8Array(save)));
              else if (FS.analyzePath(p).exists) FS.unlink(p);          // nouvelle partie : pas de sauvegarde d'un autre jeu
            } catch {}
          }
        });
      };
      hook();
      w.EJS_onGameStart = () => resolve(this);
      const s = document.createElement('script');
      s.src = this.dataPath + 'loader.js';
      s.onerror = () => reject(new Error('Émulateur introuvable (vendor/emulatorjs)'));
      document.body.append(s);
      setTimeout(() => window.EJS_emulator?.failedToStart && reject(new Error('Le jeu n’a pas pu démarrer')), 120000);
    });
  }
  get ejs() { return window.EJS_emulator; }
  get gm() { return window.EJS_emulator.gameManager; }
  get heap() { return this.gm.Module.HEAPU8; }                    // relu à chaque fois : la mémoire peut grandir
  get canvas() { return this.ejs.canvas; }
  frame() { return this.gm.getFrameNum(); }
  /** Touches tenues pour cette image (noms DS : A B X Y L R START SELECT UP DOWN LEFT RIGHT). */
  setKeys(keys) {
    const next = new Set(keys);
    for (const k of this.keys) if (!next.has(k) && RETRO[k] !== undefined) this.gm.simulateInput(0, RETRO[k], 0);
    for (const k of next) if (!this.keys.has(k) && RETRO[k] !== undefined) this.gm.simulateInput(0, RETRO[k], 1);
    this.keys = next;
  }
  /** Sauvegarde du jeu en .sav brut (lisible par tous les émulateurs et linkers). */
  exportSave() { const s = this.gm.getSaveFile(); return s ? rawSave(s) : null; }
}

/** Repère la RAM principale de la DS (4 Mo) dans la mémoire WebAssembly : la console y recopie l'en-tête
 *  de la cartouche en 0x027FFE00 (= RAM + 0x3FFE00). Renvoie l'offset de 0x02000000 dans le tas, ou -1. */
export function findNdsRam(heap, romHeader) {
  const h0 = romHeader[0], need = romHeader.subarray(0, 0x40);
  for (let i = 0x3ffe00; i < heap.length - 0x40; i += 4) {
    if (heap[i] !== h0) continue;
    let ok = true;
    for (let j = 1; j < 0x40; j++) if (heap[i + j] !== need[j]) { ok = false; break; }
    if (!ok) continue;
    const base = i - 0x3ffe00;
    if (heap[base + 0x3ffe00 - 0x380] === h0) return base;          // 2e copie de l'en-tête en 0x027FFA80 : c'est bien la RAM
  }
  return -1;
}

// ------------------------------------------------------------------------------------------ format .dsv de DeSmuME
const DSV_TXT = '|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:', DSV_COOKIE = '|-DESMUME SAVE-|';
const enc = s => Uint8Array.from(s, c => c.charCodeAt(0));
/** .sav brut → .dsv (pied de page DeSmuME : taille, type de mémoire, taille d'adresse). */
export function toDsv(raw) {
  if (raw.length > 122 && String.fromCharCode(...raw.subarray(raw.length - 16)) === DSV_COOKIE) return raw;   // déjà un .dsv
  const n = raw.length;
  const [type, addr] = n <= 512 ? [1, 1] : n <= 8192 ? [2, 2] : n <= 32768 ? [4, 2] : n <= 65536 ? [3, 2] : n <= 262144 ? [5, 3] : n <= 524288 ? [6, 3] : [7, 3];
  const info = new DataView(new ArrayBuffer(24));
  [n, n, type, addr, n, 0].forEach((v, i) => info.setUint32(i * 4, v, true));
  const out = new Uint8Array(n + DSV_TXT.length + 24 + 16);
  out.set(raw, 0); out.set(enc(DSV_TXT), n); out.set(new Uint8Array(info.buffer), n + DSV_TXT.length); out.set(enc(DSV_COOKIE), n + DSV_TXT.length + 24);
  return out;
}
/** .dsv → .sav brut (sans pied de page). */
export function rawSave(data) {
  if (data.length > 122 && String.fromCharCode(...data.subarray(data.length - 16)) === DSV_COOKIE) {
    const at = data.length - 16 - 24, size = new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0, true);
    return data.slice(0, size);
  }
  return data;
}
