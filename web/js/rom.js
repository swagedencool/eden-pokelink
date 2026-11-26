// PokéLink — lecture de la ROM du joueur, directement dans le navigateur.
// Aucun fichier Nintendo n'est livré avec le site : sprites, palettes et icônes
// sont extraits de la ROM que le joueur charge lui-même.

const td = new TextDecoder('latin1');
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const tag = (b, o) => td.decode(b.subarray(o, o + 4));

/** Versions reconnues. savePtr : pointeur vers les données de partie (voir docs/memoire.md). */
export const VERSIONS = {
  CPUF: { name: 'Pokémon Platine (FR)', family: 'pt', savePtr: 0x02101f20 },
};

/** Système de fichiers NitroROM (FNT/FAT). */
export class NdsRom {
  constructor(buffer) {
    this.u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const b = this.u8;
    this.title = td.decode(b.subarray(0, 12)).replace(/\0+$/, '');
    this.code = td.decode(b.subarray(12, 16));
    this.version = VERSIONS[this.code] || null;
    this.fntOff = u32(b, 0x40);
    this.fatOff = u32(b, 0x48);
    this._paths = null;
  }
  fileRange(id) {
    const o = this.fatOff + id * 8;
    return [u32(this.u8, o), u32(this.u8, o + 4)];
  }
  file(id) {
    const [s, e] = this.fileRange(id);
    return this.u8.subarray(s, e);
  }
  /** Construit la table chemin -> id une seule fois. */
  paths() {
    if (this._paths) return this._paths;
    const b = this.u8, fnt = this.fntOff, map = new Map();
    const walk = (dirId, prefix) => {
      const d = fnt + (dirId & 0xfff) * 8;
      let p = fnt + u32(b, d);
      let fid = u16(b, d + 4);
      for (;;) {
        const len = b[p++];
        if (len === 0) break;
        const isDir = len & 0x80, n = len & 0x7f;
        const name = td.decode(b.subarray(p, p + n)); p += n;
        if (isDir) { const sub = u16(b, p); p += 2; walk(sub, prefix + name + '/'); }
        else map.set(prefix + name, fid++);
      }
    };
    walk(0xf000, '');
    return (this._paths = map);
  }
  fileByPath(path) {
    const id = this.paths().get(path);
    if (id === undefined) throw new Error('Fichier absent de la ROM : ' + path);
    return { id, data: this.file(id), offset: this.fileRange(id)[0] };
  }
}

/** Archive NARC -> membres (sous-tableaux) + offsets absolus. */
export function parseNarc(b, absBase = 0) {
  if (tag(b, 0) !== 'NARC') throw new Error('NARC invalide');
  let p = u16(b, 12);
  const btafSize = u32(b, p + 4), count = u16(b, p + 8);
  const ranges = [];
  for (let i = 0; i < count; i++) ranges.push([u32(b, p + 12 + 8 * i), u32(b, p + 16 + 8 * i)]);
  p += btafSize;
  p += u32(b, p + 4); // BTNF
  const base = p + 8; // GMIF
  return {
    count,
    member: i => b.subarray(base + ranges[i][0], base + ranges[i][1]),
    memberOffset: i => absBase + base + ranges[i][0],
  };
}

const bgr555 = v => [((v & 31) * 255 / 31) | 0, (((v >> 5) & 31) * 255 / 31) | 0, (((v >> 10) & 31) * 255 / 31) | 0];

function nnsDict(b, off) {
  const count = b[off + 1];
  let p = off + 4 + 8 + 4 * count;
  const esz = u16(b, p); p += 4;
  const entries = [];
  for (let i = 0; i < count; i++) entries.push(p + i * esz);
  p += esz * count;
  const names = [];
  for (let i = 0; i < count; i++) names.push(td.decode(b.subarray(p + i * 16, p + i * 16 + 16)).replace(/\0.*$/, ''));
  return { count, entries, names };
}

/** Textures 3D NSBTX (format utilisé par les sprites du monde). */
export function parseBtx0(b) {
  if (tag(b, 0) !== 'BTX0') throw new Error('BTX0 invalide');
  const tex0 = u32(b, 0x10);
  const texInfo = tex0 + u16(b, tex0 + 0x0e), texData = tex0 + u32(b, tex0 + 0x14);
  const palInfo = tex0 + u32(b, tex0 + 0x34), palData = tex0 + u32(b, tex0 + 0x38);
  const td_ = nnsDict(b, texInfo), pd = nnsDict(b, palInfo);
  const textures = td_.entries.map((e, i) => {
    const prm = u32(b, e);
    const w = 8 << ((prm >> 20) & 7), h = 8 << ((prm >> 23) & 7), fmt = (prm >> 26) & 7;
    const off = texData + ((prm & 0xffff) << 3);
    const n = +td_.names[i].split('.').pop();
    const idx = new Uint8Array(w * h);
    if (fmt === 3) for (let k = 0; k < w * h; k++) idx[k] = (b[off + (k >> 1)] >> ((k & 1) * 4)) & 15;
    else if (fmt === 4) idx.set(b.subarray(off, off + w * h));
    return { name: td_.names[i], frame: n, w, h, fmt, idx };
  });
  const palettes = pd.entries.map((e, i) => {
    const off = palData + (u16(b, e) << 3);
    const colors = [];
    for (let k = 0; k < 16; k++) colors.push(bgr555(u16(b, off + 2 * k)));
    return { name: pd.names[i], offset: off, colors };
  });
  return { textures, palettes };
}

/** Icônes de Pokémon (NCGR 4bpp 32×64 = 2 images) et leurs palettes (NCLR). */
export function parseNclr(b) {
  const p = u16(b, 12); // TTLP
  const size = u32(b, p + 0x10), off = p + 8 + u32(b, p + 0x14);
  const all = [];
  for (let i = 0; i < size / 2; i++) all.push(bgr555(u16(b, off + 2 * i)));
  const pals = [];
  for (let i = 0; i < all.length; i += 16) pals.push(all.slice(i, i + 16));
  return pals;
}
export function decodeIcon(ncgr) {
  const p = u16(ncgr, 12); // RAHC
  const data = ncgr.subarray(p + 0x20, p + 0x20 + 1024);
  const frames = [new Uint8Array(1024), new Uint8Array(1024)];
  for (let t = 0; t < 32; t++) {
    const f = t >> 4, tt = t & 15, tx = tt & 3, ty = tt >> 2;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = (data[t * 32 + y * 4 + (x >> 1)] >> ((x & 1) * 4)) & 15;
      frames[f][(ty * 8 + y) * 32 + tx * 8 + x] = v;
    }
  }
  return frames;
}

/** Membres utiles de data/mmodel/mmodel.narc (Platine). */
export const MMODEL = {
  avatars: { lucas: 90, aurore: 91 },
  // espèce -> membre : sprites de Pokémon marchant dans 4 directions présents dans Platine
  pokemon: { 387: 383, 388: 384, 389: 385, 390: 386, 391: 387, 392: 388, 393: 389, 394: 390, 395: 391,
             25: 69, 35: 70, 39: 71, 54: 72, 255: 76, 300: 77, 417: 371, 66: 375, 453: 392 },
};

/** Parties recolorables (indices de palette) — relevées sur les sprites de Platine. */
export const COLOR_SLOTS = {
  lucas: [
    { id: 'hat', label: 'Béret', idx: [1, 2, 3] },
    { id: 'coat', label: 'Manteau', idx: [5, 6, 8] },
    { id: 'detail', label: 'Détails', idx: [10, 12, 13] },
  ],
  aurore: [
    { id: 'hat', label: 'Bonnet', idx: [1, 3, 4] },
    { id: 'coat', label: 'Manteau', idx: [11, 12, 13] },
    { id: 'hair', label: 'Cheveux', idx: [2, 6] },
    { id: 'detail', label: 'Accessoires', idx: [7, 8] },
  ],
};

/** Charge tout ce dont l'overlay a besoin depuis la ROM. Rapide (< 50 ms) : quelques Ko décodés. */
export function loadAssets(rom, iconPalettes) {
  const mm = rom.fileByPath('data/mmodel/mmodel.narc');
  const narc = parseNarc(mm.data, mm.offset);
  const sheet = member => {
    const btx = parseBtx0(narc.member(member));
    const frames = [];
    for (const t of btx.textures) frames[t.frame - 1] = t.idx;
    return { member, frames, palette: btx.palettes[0].colors, paletteRomOffset: narc.memberOffset(member) + btx.palettes[0].offset };
  };
  const avatars = {};
  for (const [k, m] of Object.entries(MMODEL.avatars)) avatars[k] = sheet(m);
  const pokemon = {};
  for (const [sp, m] of Object.entries(MMODEL.pokemon)) pokemon[sp] = sheet(m);

  const ic = rom.fileByPath('poketool/icongra/pl_poke_icon.narc');
  const icNarc = parseNarc(ic.data);
  const iconPals = parseNclr(icNarc.member(0));
  const iconCache = new Map();
  const icon = species => {
    if (!iconCache.has(species)) {
      const frames = decodeIcon(icNarc.member(7 + species));
      iconCache.set(species, { frames, palette: iconPals[iconPalettes[species] || 0] });
    }
    return iconCache.get(species);
  };
  return { avatars, pokemon, icon };
}

/** Écrit une palette (16 couleurs RGB) dans la ROM en mémoire : le jeu la relit au prochain chargement de zone. */
export function writePalette(romU8, offset, colors) {
  for (let i = 1; i < 16; i++) {
    const [r, g, b] = colors[i];
    const v = (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);
    romU8[offset + 2 * i] = v & 0xff;
    romU8[offset + 2 * i + 1] = v >> 8;
  }
}
