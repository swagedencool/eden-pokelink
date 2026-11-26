// Recoloration des sprites et caches de rendu.
// Tout le travail coûteux (décodage, recoloration) est fait une fois par changement
// d'apparence ; à chaque frame on ne fait que des drawImage depuis ces caches.

import { COLOR_SLOTS } from './rom.js';

const mk = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

// --- couleurs ---------------------------------------------------------------
export function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHls([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const d = mx - mn, s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, l, s];
}
function hlsToRgb([h, l, s]) {
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

/** Recolore une palette en gardant le dégradé d'origine de chaque partie (ombres et reflets). */
export function recolorPalette(palette, base, colors) {
  const out = palette.map(c => c.slice());
  for (const slot of COLOR_SLOTS[base] || []) {
    const hex = colors?.[slot.id];
    if (!hex) continue;
    const [th, tl, ts] = rgbToHls(hexToRgb(hex));
    const Ls = slot.idx.map(i => rgbToHls(palette[i])[1]);
    const mean = Ls.reduce((a, b) => a + b, 0) / Ls.length;
    slot.idx.forEach((i, k) => {
      const nl = Math.min(0.97, Math.max(0.06, tl + (Ls[k] - mean)));
      out[i] = hlsToRgb([th, nl, ts]);
    });
  }
  return out;
}

/** Feuille de sprites : toutes les images côte à côte, transparence sur l'index 0. */
export function buildSheet(frames, palette, w = 32, h = 32) {
  const c = mk(w * frames.length, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w * frames.length, h), d = img.data;
  frames.forEach((idx, f) => {
    if (!idx) return;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = idx[y * w + x];
      if (!v) continue;
      const o = (y * w * frames.length + f * w + x) * 4, col = palette[v];
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  });
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Silhouette (union des 4 images d'une direction) : sert à masquer ce qui passe derrière le joueur. */
export function buildSilhouettes(frames, w = 32, h = 32) {
  const masks = [];
  for (let dir = 0; dir < 4; dir++) {
    const c = mk(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
    for (let k = 0; k < 4; k++) {
      const idx = frames[dir * 4 + k];
      for (let p = 0; p < w * h; p++) if (idx[p]) img.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    masks.push(c);
  }
  return masks;
}

export class SpriteLibrary {
  constructor(assets) { this.assets = assets; this.cache = new Map(); }
  avatar(base, colors) {
    const key = 'a|' + base + '|' + JSON.stringify(colors || {});
    if (!this.cache.has(key)) {
      const s = this.assets.avatars[base];
      this.cache.set(key, buildSheet(s.frames.slice(0, 16), recolorPalette(s.palette, base, colors)));
    }
    return this.cache.get(key);
  }
  avatarPalette(base, colors) { return recolorPalette(this.assets.avatars[base].palette, base, colors); }
  silhouettes(base) {
    const key = 's|' + base;
    if (!this.cache.has(key)) this.cache.set(key, buildSilhouettes(this.assets.avatars[base].frames));
    return this.cache.get(key);
  }
  pokemon(species) {
    const key = 'p|' + species;
    if (!this.cache.has(key)) {
      const s = this.assets.pokemon[species];
      if (s) this.cache.set(key, { kind: 'walk', sheet: buildSheet(s.frames.slice(0, 16), s.palette) });
      else { // repli : icône d'équipe (2 images), pour les espèces sans sprite de marche dans la ROM
        const ic = this.assets.icon(species);
        this.cache.set(key, { kind: 'icon', sheet: buildSheet(ic.frames, ic.palette) });
      }
    }
    return this.cache.get(key);
  }
  icon(species) {
    const key = 'i|' + species;
    if (!this.cache.has(key)) { const ic = this.assets.icon(species); this.cache.set(key, buildSheet(ic.frames, ic.palette)); }
    return this.cache.get(key);
  }
  /** Boîte des pixels visibles (union de plusieurs images d'une feuille). */
  opaqueBox(sheet, frames, w = 32, h = 32) {
    const key = 'b|' + this.keyOf(sheet) + '|' + frames.join(',');
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this._rb) { this._rb = document.createElement('canvas'); this._rb.width = w; this._rb.height = h; this._rbx = this._rb.getContext('2d', { willReadFrequently: true }); }
    const c = this._rbx, box = { x0: w, y0: h, x1: -1, y1: -1 };
    for (const f of frames) {
      c.clearRect(0, 0, w, h); c.drawImage(sheet, f * w, 0, w, h, 0, 0, w, h);
      const d = c.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) {
        box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
      }
    }
    this.cache.set(key, box);
    return box;
  }
  /**
   * Image centrée sur ses pixels visibles, dans un carré de `size` px, à l'échelle entière la plus grande
   * (≤ maxScale) qui tient entièrement : jamais de débordement, toujours centrée au pixel près.
   */
  fitURL(sheet, frame, size, { maxScale = 2, frames = [frame], w = 32, h = 32 } = {}) {
    const key = 'f|' + this.keyOf(sheet) + '|' + frame + '|' + size + '|' + maxScale + '|' + frames.join(',');
    if (this.cache.has(key)) return this.cache.get(key);
    const b = this.opaqueBox(sheet, frames, w, h), bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const sc = Math.max(1, Math.min(maxScale, Math.floor(size / Math.max(bw, bh))));
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const dx = Math.round((size - bw * sc) / 2), dy = Math.round((size - bh * sc) / 2);
    ctx.drawImage(sheet, frame * w + b.x0, b.y0, bw, bh, dx, dy, bw * sc, bh * sc);
    const url = c.toDataURL();
    this.cache.set(key, url);
    return url;
  }
  /** Portrait (tête et épaules) d'un personnage, centré, pour les vignettes rondes ou carrées. */
  portraitURL(sheet, frame, size = 44, scale = 2) {
    const key = 'pt|' + this.keyOf(sheet) + '|' + frame + '|' + size + '|' + scale;
    if (this.cache.has(key)) return this.cache.get(key);
    const b = this.opaqueBox(sheet, [frame]), win = Math.floor(size / scale);
    const cx = Math.round((b.x0 + b.x1 + 1) / 2), sx = cx - Math.floor(win / 2), sy = b.y0 - 2;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, frame * 32 + sx, sy, win, win, 0, 0, win * scale, win * scale);
    const url = c.toDataURL();
    this.cache.set(key, url);
    return url;
  }
  /** URL d'image (pour le DOM) d'une image d'une feuille. */
  frameURL(sheet, frame, scale = 1, w = 32, h = 32) {
    const key = 'u|' + this.keyOf(sheet) + '|' + frame + '|' + scale;
    if (!this.cache.has(key)) {
      const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
      const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet, frame * w, 0, w, h, 0, 0, w * scale, h * scale);
      this.cache.set(key, c.toDataURL());
    }
    return this.cache.get(key);
  }
  keyOf(obj) {
    if (!this._ids) { this._ids = new WeakMap(); this._n = 0; }
    if (!this._ids.has(obj)) this._ids.set(obj, ++this._n);
    return this._ids.get(obj);
  }
}

/** Direction (0 haut, 1 bas, 2 gauche, 3 droite) -> image de base dans les feuilles 16 images. */
export const DIR_BASE = [0, 4, 8, 12];
