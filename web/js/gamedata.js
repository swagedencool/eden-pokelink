// Données de jeu lues dans la ROM du joueur : textes français, attaques, espèces, sprites de combat.
import { parseNarc } from './rom.js';
import { CHARMAP } from './data/charmap.js';

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const CH = new Map(Object.entries(CHARMAP).map(([k, v]) => [parseInt(k, 16), v]));

/** Chaîne 4G (codes 16 bits, 0xFFFF = fin). */
export function decodeString(b, off = 0, max = 64) {
  let s = '';
  for (let i = 0; i < max; i++) {
    const c = u16(b, off + 2 * i);
    if (c === 0xffff) break;
    s += c === 0xe000 ? '\n' : CH.get(c) ?? '';
  }
  return s;
}

/** Banque de messages chiffrée (format msgdata de la 4G). */
export function decodeBank(b) {
  const count = u16(b, 0), key = u16(b, 2), out = [];
  for (let i = 1; i <= count; i++) {
    let k = (765 * i * key) & 0xffff; k = (k | (k << 16)) >>> 0;
    const off = (u32(b, 4 + 8 * (i - 1)) ^ k) >>> 0, len = (u32(b, 8 + 8 * (i - 1)) ^ k) >>> 0;
    let seed = (i * 596947) & 0xffff, s = '';
    for (let j = 0; j < len; j++) {
      const c = u16(b, off + 2 * j) ^ seed; seed = (seed + 18749) & 0xffff;
      if (c === 0xffff) break;
      if (c === 0xe000) { s += '\n'; continue; }
      if (c === 0xfffe) { s += '{}'; continue; }
      s += CH.get(c) ?? '';
    }
    out.push(s);
  }
  return out;
}

// Banques de pl_msg.narc (identiques entre les versions européennes de Platine)
const BANK = { natures: 202, items: 392, species: 412, places: 433, abilities: 610, types: 624, moves: 647 };
export const TYPE_COLORS = ['#a8a878', '#c03028', '#a890f0', '#a040a0', '#e0c068', '#b8a038', '#a8b820', '#705898', '#b8b8d0', '#68a090', '#f08030', '#6890f0', '#78c850', '#f8d030', '#f85888', '#98d8d8', '#7038f8', '#705848'];

/** Courbes d'expérience de la 4G (index = octet 0x13 des données d'espèce). */
function expFor(g, L) {
  const c = L ** 3;
  switch (g) {
    case 0: return c;
    case 1: return L <= 50 ? Math.floor((c * (100 - L)) / 50) : L <= 68 ? Math.floor((c * (150 - L)) / 100) : L <= 98 ? Math.floor((c * Math.floor((1911 - 10 * L) / 3)) / 500) : Math.floor((c * (160 - L)) / 100);
    case 2: return L <= 15 ? Math.floor((c * (Math.floor((L + 1) / 3) + 24)) / 50) : L <= 36 ? Math.floor((c * (L + 14)) / 50) : Math.floor((c * (Math.floor(L / 2) + 32)) / 50);
    case 3: return Math.floor(1.2 * c - 15 * L * L + 100 * L - 140);
    case 4: return Math.floor(0.8 * c);
    case 5: return Math.floor(1.25 * c);
  }
  return c;
}

export function loadGameData(rom) {
  const msg = parseNarc(rom.fileByPath('msgdata/pl_msg.narc').data);
  const text = {};
  for (const [k, i] of Object.entries(BANK)) text[k] = decodeBank(msg.member(i));
  const waza = parseNarc(rom.fileByPath('poketool/waza/pl_waza_tbl.narc').data);
  const pers = parseNarc(rom.fileByPath('poketool/personal/pl_personal.narc').data);
  const gra = parseNarc(rom.fileByPath('poketool/pokegra/pl_pokegra.narc').data);

  const move = n => { const b = waza.member(n); return { num: n, name: text.moves[n], category: b[2], power: b[3], type: b[4], accuracy: b[5], pp: b[6] }; };
  const species = n => {
    const b = pers.member(n);
    return { num: n, name: text.species[n], base: [b[0], b[1], b[2], b[4], b[5], b[3]], types: [b[6], b[7]], growth: b[0x13] };
  };
  const levelFromExp = (sp, exp) => { const g = species(sp).growth; let L = 1; while (L < 100 && expFor(g, L + 1) <= exp) L++; return L; };

  // Sprites de combat : 6 fichiers par espèce (dos ♀, dos ♂, face ♀, face ♂, palette, palette chromatique)
  const sprCache = new Map();
  const battleSprite = (sp, view = 'front', { female = false, shiny = false } = {}) => {
    const key = `${sp}|${view}|${female}|${shiny}`;
    if (sprCache.has(key)) return sprCache.get(key);
    const base = sp * 6;
    let idx = (view === 'back' ? 0 : 2) + (female ? 0 : 1);
    let pix = decodeBattleNcgr(gra.member(base + idx));
    if (!pix.some(v => v)) pix = decodeBattleNcgr(gra.member(base + (view === 'back' ? 1 : 3))); // pas de variante ♀
    const pal = gra.member(base + (shiny ? 5 : 4));
    const p = u16(pal, 12), off = p + 8 + u32(pal, p + 0x14), colors = [];
    for (let k = 0; k < 16; k++) { const v = u16(pal, off + 2 * k); colors.push([((v & 31) * 255) / 31 | 0, (((v >> 5) & 31) * 255) / 31 | 0, (((v >> 10) & 31) * 255) / 31 | 0]); }
    const f0 = new Uint8Array(80 * 80), f1 = new Uint8Array(80 * 80);
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) { f0[y * 80 + x] = pix[y * 160 + x]; f1[y * 80 + x] = pix[y * 160 + 80 + x]; }
    const frames = [f0, f1];
    const r = { frames, palette: colors, w: 80, h: 80 };
    sprCache.set(key, r);
    return r;
  };
  return { text, move, species, levelFromExp, battleSprite };
}

/** NCGR des sprites de combat de Platine : 160×80, 4 bits, chiffré (graine = premier mot, LCG 0x4E6D/0x6073). */
function decodeBattleNcgr(b) {
  const p = u16(b, 12), size = u32(b, p + 0x18);
  const data = new Uint8Array(b.subarray(p + 0x20, p + 0x20 + size));
  let seed = u16(data, 0);
  for (let i = 0; i < size; i += 2) {
    const v = u16(data, i) ^ (seed & 0xffff);
    data[i] = v & 0xff; data[i + 1] = v >> 8;
    seed = (Math.imul(seed, 0x4e6d) + 0x6073) >>> 0;
  }
  const pix = new Uint8Array(160 * 80);
  for (let k = 0; k < 160 * 80; k++) pix[k] = (data[k >> 1] >> ((k & 1) * 4)) & 15;
  return pix;
}

/** Nom affiché d'une espèce : le jeu les écrit en capitales, on garde ce style. */
export const speciesLabel = (gd, n) => gd.text.species[n] || `#${n}`;
