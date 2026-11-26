// Adaptateur « Pokémon Platine » pour l'émulateur du navigateur : même interface que le banc de la preview
// (state, readPartyRaw, writePartyMon, mapInfo, patchRom, topCanvas, bottomCanvas). Adresses : docs/memoire.md.
import { findNdsRam } from './host.js';
import { PartyMirror, monIsStable, PARTY } from '../pk4.js';

const RAM = 0x02000000;
export const PROFILES = {
  CPUF: {
    savePtr: 0x02101f20, location: 0x1294, headers: 0x020e60a4, headerCount: 593, trainer: 0x7c,
    // Plafond de niveau : les trois tests « niveau 100 » du jeu, retrouvés dans le code (Thumb) :
    //   movs r1,#0xA1 (niveau) · movs r2,#0 · bl Pokemon_GetValue · cmp r0,#100 · branchement
    // On remplace 100 par le plafond, et « égal / différent » par « supérieur ou égal / inférieur ».
    levelChecks: [
      { at: 0x022492e8, sig: 'a12100222bf610f9', orig: [0x64, 0x28, 0x00, 0xd1], cap: c => [c, 0x28, 0x00, 0xd3] },  // EXP en combat (overlay 16)
      { at: 0x021e66b8, sig: 'a12100228df628ff', orig: [0x64, 0x28, 0x13, 0xd0], cap: c => [c, 0x28, 0x13, 0xd2] },  // Pension (overlay 5)
      { at: 0x02096606, sig: 'a1210022ddf781ff', orig: [0x64, 0x28, 0x05, 0xd2], cap: c => [c, 0x28, 0x05, 0xd2] },  // Super Bonbon (arm9)
    ],
  },
};
// Cadre du Pokétch (écran du bas) : présent sur la carte, absent dans les menus et les combats.
// Le rapport de luminosité donne aussi le fondu de l'écran (la console assombrit les deux écrans ensemble).
const POKETCH_PROBES = [[4, 4, 224, 224, 224], [128, 4, 48, 48, 48], [240, 60, 248, 64, 72], [240, 130, 248, 64, 72], [128, 188, 48, 48, 48]];

export class PlatinumGame {
  constructor(host, romBytes) {
    this.host = host;
    this.code = String.fromCharCode(...romBytes.subarray(12, 16));
    this.profile = PROFILES[this.code];
    if (!this.profile) throw new Error('Version de Platine non prise en charge : ' + this.code);
    this.header = romBytes.slice(0, 0x200);
    this.romTail = romBytes.slice(0x4000, 0x4040);
    const mk = () => Object.assign(document.createElement('canvas'), { width: 256, height: 192 });
    this.topCanvas = mk(); this.bottomCanvas = mk();
    this.botCtx = this.bottomCanvas.getContext('2d');
    // les points de contrôle du Pokétch sont lus sur une petite copie (une seule lecture, une image sur trois)
    this.probeCanvas = Object.assign(document.createElement('canvas'), { width: 256, height: 192 });
    this.probeCtx = this.probeCanvas.getContext('2d', { willReadFrequently: true });
    this.frameN = 0;
    this.topCtx = this.topCanvas.getContext('2d');
    this.botCtx.imageSmoothingEnabled = this.topCtx.imageSmoothingEnabled = false;
    this.base = -1; this.romBase = -1; this.obj = 0; this.mirror = new PartyMirror(); this.pending = new Map();
    this.view = { fade: 0, field: false };
    this.playerBase = 'lucas'; this.headers = null;
  }

  // ---------------------------------------------------------------------------------------- mémoire
  attach() {
    const heap = this.host.heap;
    if (this.base < 0 || heap[this.base + 0x3ffe00] !== this.header[0]) this.base = findNdsRam(heap, this.header);
    return this.base >= 0;
  }
  u8(a) { return this.host.heap[this.base + ((a - RAM) & 0x3fffff)]; }
  u16(a) { const h = this.host.heap, o = this.base + ((a - RAM) & 0x3fffff); return h[o] | (h[o + 1] << 8); }
  u32(a) { const h = this.host.heap, o = this.base + ((a - RAM) & 0x3fffff); return (h[o] | (h[o + 1] << 8) | (h[o + 2] << 16) | (h[o + 3] << 24)) >>> 0; }
  s32(a) { return this.u32(a) | 0; }
  bytes(a, n) { const o = this.base + ((a - RAM) & 0x3fffff); return this.host.heap.slice(o, o + n); }
  write(a, data) { this.host.heap.set(data, this.base + ((a - RAM) & 0x3fffff)); }
  saveBase() { const p = this.u32(this.profile.savePtr); return p >= RAM && p < RAM + 0x400000 ? p : 0; }

  // ---------------------------------------------------------------------------------------- image
  /** Recopie les deux écrans depuis le canvas de l'émulateur (une image sur deux suffit à 30 i/s de jeu). */
  blit() {
    const c = this.host.canvas;
    if (!c || !c.width) return;
    const half = c.height / 2;
    // l'écran du haut suit la résolution de l'émulateur (3D HD : 512 × 384 et plus)
    if (this.topCanvas.width !== c.width || this.topCanvas.height !== half) { this.topCanvas.width = c.width; this.topCanvas.height = half; this.topCtx.imageSmoothingEnabled = false; }
    this.topCtx.imageSmoothingEnabled = false; this.botCtx.imageSmoothingEnabled = false;
    this.topCtx.drawImage(c, 0, 0, c.width, half, 0, 0, c.width, half);
    this.botCtx.drawImage(c, 0, half, c.width, half, 0, 0, 256, 192);
    if (this.frameN++ % 3 === 0) this.probe();
    this._st = undefined;                                     // état relu une fois par image
  }
  probe() {
    // Chaque point du cadre doit avoir sa couleur d'origine, assombrie du même facteur partout (fondu au noir).
    this.probeCtx.drawImage(this.bottomCanvas, 0, 0);
    const all = this.probeCtx.getImageData(0, 0, 256, 192).data;
    const px = POKETCH_PROBES.map(([x, y]) => all.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4));
    const ks = POKETCH_PROBES.map(([, , r, g, b], i) => (px[i][0] + px[i][1] + px[i][2] + 1) / (r + g + b + 1));
    const k = ks.reduce((a, v) => a + v, 0) / ks.length;
    const consistent = Math.max(...ks) - Math.min(...ks) < 0.2 && k > 0.06 && k < 1.15;
    const close = POKETCH_PROBES.every(([, , r, g, b], i) => Math.abs(px[i][0] - r * k) + Math.abs(px[i][1] - g * k) + Math.abs(px[i][2] - b * k) < 40);
    this.view.field = consistent && close;
    this.view.fade = this.view.field ? Math.max(0, Math.min(1, 1 - k)) : 1;
  }

  // ---------------------------------------------------------------------------------------- état pour l'overlay
  state() {
    if (this._st === undefined) this._st = this.readState();
    return this._st;
  }
  readState() {
    if (!this.attach()) return null;
    const sb = this.saveBase(); if (!sb) return null;
    const L = sb + this.profile.location, map = this.s32(L), x = this.s32(L + 8), z = this.s32(L + 12);
    if (map < 0 || map >= this.profile.headerCount) return null;
    if (this.obj) {
      const tx = this.s32(this.obj + 0x64), tz = this.s32(this.obj + 0x6c), px = this.s32(this.obj + 0x70) / 4096;
      if (Math.abs(tx - x) > 1 || Math.abs(tz - z) > 1 || Math.abs(px - (tx * 16 + 8)) > 17) this.obj = 0;
    }
    if (!this.obj) this.obj = this.findPlayer(x, z);
    if (!this.obj) return null;
    const o = this.obj, hdr = this.profile.headers + map * 24;
    return {
      map, x: this.s32(o + 0x70) / 4096, y: this.s32(o + 0x74) / 4096, z: this.s32(o + 0x78) / 4096, face: this.s32(o + 0x28),
      tx: this.s32(o + 0x64), tz: this.s32(o + 0x6c), fade: this.view.fade, field: this.view.field,
      cam: this.u8(hdr + 0x15), label: this.u8(hdr + 0x12),
    };
  }
  /** Personnage du joueur : objet de carte dont la case et la position 3D correspondent à la position sauvegardée. */
  findPlayer(x, z) {
    const h = this.host.heap, start = this.base + 0x200000;
    const v = new Int32Array(h.buffer, h.byteOffset + start, 0x200000 / 4 - 0x20);
    const fx = (x * 16 + 8) * 4096, fz = (z * 16 + 8) * 4096;
    for (let i = 0; i < v.length - 0x20; i++) {
      if (v[i + 0x19] === x && v[i + 0x1b] === z && v[i + 0x1c] === fx && v[i + 0x1e] === fz) return 0x02200000 + i * 4;
    }
    return 0;
  }
  mapInfo(map) {
    if (!this.attach() || map < 0 || map >= this.profile.headerCount) return null;
    const a = this.profile.headers + map * 24;
    return { label: this.u8(a + 0x12), cam: this.u8(a + 0x15), matrix: this.u16(a + 2) };
  }

  // ---------------------------------------------------------------------------------------- dresseur et règles
  /** Genre du personnage dans la partie (0 = Lucas, 1 = Aurore) : le jeu le relit en changeant de zone. */
  gender() { const sb = this.attach() && this.saveBase(); return sb ? this.u8(sb + this.profile.trainer + 0x18) : null; }
  setGender(g) {
    const sb = this.attach() && this.saveBase(); if (!sb) return false;
    this.host.heap[this.base + ((sb + this.profile.trainer + 0x18 - RAM) & 0x3fffff)] = g ? 1 : 0;
    this.playerBase = g ? 'aurore' : 'lucas';
    return true;
  }
  badges() { const sb = this.attach() && this.saveBase(); return sb ? this.u8(sb + this.profile.trainer + 0x1a) : 0; }
  storyCleared() { const sb = this.attach() && this.saveBase(); return sb ? !!(this.u8(sb + this.profile.trainer + 0x1d) & 1) : false; }
  /** Plafond de niveau (null = aucun). Réécrit à chaque image : le code de combat n'est en mémoire que pendant les combats. */
  setLevelCap(level) {
    if (!this.attach()) return;
    const cap = level && level < 100 ? Math.max(2, level | 0) : null;
    for (const c of this.profile.levelChecks) {
      const sig = this.bytes(c.at, 8);
      if (Array.from(sig, b => b.toString(16).padStart(2, '0')).join('') !== c.sig) continue;   // code absent (overlay non chargé)
      const want = cap ? c.cap(cap) : c.orig, cur = this.bytes(c.at + 8, 4);
      if (want.some((v, i) => v !== cur[i])) this.write(c.at + 8, Uint8Array.from(want));
    }
  }

  // ---------------------------------------------------------------------------------------- équipe
  readPartyRaw() {
    if (!this.attach()) return this.mirror.bytes;
    const sb = this.saveBase(); if (!sb) return this.mirror.bytes;
    return this.mirror.ingest(this.bytes(sb + PARTY.count, 4 + 6 * PARTY.size));
  }
  /** Écriture différée : appliquée à la première image où le Pokémon est au repos, puis vérifiée. */
  writePartyMon(slot, bytes) { this.pending.set(slot, { data: new Uint8Array(bytes), ok: 0, tries: 0 }); this.mirror.write(slot, bytes); }
  tick() {
    if (!this.pending.size || !this.attach()) return;
    const sb = this.saveBase(); if (!sb) return;
    for (const [slot, p] of this.pending) {
      const a = sb + PARTY.mons + slot * PARTY.size, cur = this.bytes(a, PARTY.size);
      if (cur.every((v, i) => v === p.data[i])) { if (++p.ok >= 6) this.pending.delete(slot); continue; }
      if (monIsStable(cur)) { this.write(a, p.data); p.tries++; p.ok = 0; }
      if (p.tries > 20) this.pending.delete(slot);
    }
  }

  // ---------------------------------------------------------------------------------------- ROM chargée
  /** Couleurs du personnage : écrites dans la copie de la ROM que l'émulateur lit ; visibles au prochain chargement de zone. */
  /** Réécrit des couleurs dans la ROM chargée. Le cœur peut en garder plusieurs copies en mémoire
   *  (fichier lu par l'interface libretro + copie de l'émulateur) : on les corrige toutes. */
  patchRom(offset, colors) {
    const h = this.host.heap;
    const isRom = i => {
      if (h[i] !== this.header[0] || h[i + 12] !== this.header[12]) return false;
      for (let j = 0; j < 0x40; j++) if (h[i + j] !== this.header[j] || h[i + 0x4000 + j] !== this.romTail[j]) return false;
      return true;
    };
    if (!this.romBases || this.romHeapLen !== h.length || !this.romBases.every(isRom)) {
      this.romBases = [];
      for (let i = 0; i < h.length - 0x4040; i += 4) if (isRom(i)) this.romBases.push(i);
      this.romHeapLen = h.length;
      this.romBase = this.romBases[0] ?? -1;
    }
    const write = (buf, base) => colors.forEach(([r, g, b], i) => {
      if (!i) return;
      const v = (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10), o = base + offset + 2 * i;
      buf[o] = v & 0xff; buf[o + 1] = v >> 8;
    });
    for (const base of this.romBases) write(h, base);
    // DeSmuME lit aussi la ROM directement dans son fichier (système de fichiers en mémoire d'EmulatorJS)
    let files = 0;
    try {
      const FS = this.host.gm.FS, name = this.host.ejs.fileName;
      for (const path of [name, '/' + name].filter(Boolean)) {
        const node = FS.analyzePath(path).exists && FS.lookupPath(path).node;
        if (node?.contents && node.contents.length >= offset + 2 * colors.length) { write(node.contents, 0); files++; break; }
      }
    } catch {}
    return this.romBases.length + files > 0;
  }
}
