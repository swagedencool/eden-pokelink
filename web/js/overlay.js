// Rendu par-dessus l'écran du jeu.
// - Sprites (amis, Pokémon qui suivent, effets) : un canvas à la résolution native de la DS (256×192),
//   agrandi comme le jeu → mêmes pixels que le jeu, coût de quelques drawImage par frame.
// - Étiquettes, bulles et invite : éléments DOM déplacés par transform (aucun reflow).
import { project, SPRITE_ANCHOR, SCREEN_W, SCREEN_H } from './projection.js';
import { h, ease, clamp } from './core.js';
import { icon } from './icons.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function pokeball() {
  const c = mk(10, 10), x = c.getContext('2d');
  const px = (col, pts) => { x.fillStyle = col; pts.forEach(([a, b]) => x.fillRect(a, b, 1, 1)); };
  for (let yy = 0; yy < 10; yy++) for (let xx = 0; xx < 10; xx++) {
    const d = Math.hypot(xx - 4.5, yy - 4.5);
    if (d > 4.9) continue;
    x.fillStyle = d > 4.0 ? '#1b1b26' : yy < 4 ? '#e8384f' : yy === 4 || yy === 5 ? '#1b1b26' : '#f4f4f8';
    x.fillRect(xx, yy, 1, 1);
  }
  px('#f4f4f8', [[4, 4], [5, 4], [4, 5], [5, 5]]);
  px('#ff8a98', [[3, 2], [2, 3]]);
  return c;
}

export class Overlay {
  constructor({ canvas, dom, lib, scale = 3 }) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    this.dom = dom; this.lib = lib; this.S = scale;
    this.scratch = mk(48, 48); this.sctx = this.scratch.getContext('2d'); this.sctx.imageSmoothingEnabled = false;
    this.ball = pokeball();
    this.tags = new Map(); this.bubbles = []; this.sparkles = []; this.screen = new Map(); // id -> position écran (px) au-dessus de la tête
    this.prompt = h('div.pl-prompt', {}, h('span.kc.a', {}, 'A'), h('span', {}, 'Interagir'));
    this.prompt.style.opacity = 0; this.dom.append(this.prompt);
    this.promptState = { target: null, k: 0 };
    this.stats = { frames: 0, ms: 0, max: 0 };
  }

  screenOf(me, p) {
    return project(p.x - me.x, p.y - me.y, p.z - me.z, me.cam || 0);
  }

  /** Dessine une image d'une feuille 32×32 posée au point (sx, sy), avec masquage éventuel derrière le joueur. */
  drawSprite(sheet, frame, sx, sy, scale, { alpha = 1, white = 0, clip = null, squash = 1 } = {}) {
    const w = Math.round(32 * scale), hh = Math.round(32 * scale * squash);
    const x = Math.round(sx + SPRITE_ANCHOR.x * scale), y = Math.round(sy + SPRITE_ANCHOR.y * scale * squash);
    if (!clip && !white && alpha >= 1) { this.ctx.drawImage(sheet, frame * 32, 0, 32, 32, x, y, w, hh); return; }
    const s = this.sctx; s.clearRect(0, 0, 48, 48); s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1;
    s.drawImage(sheet, frame * 32, 0, 32, 32, 0, 0, w, hh);
    if (white > 0) { s.globalCompositeOperation = 'source-atop'; s.globalAlpha = white; s.fillStyle = '#fff'; s.fillRect(0, 0, 48, 48); s.globalAlpha = 1; }
    if (clip) { s.globalCompositeOperation = 'destination-out'; s.drawImage(clip.mask, clip.x - x, clip.y - y); }
    s.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = alpha; this.ctx.drawImage(this.scratch, 0, 0, 48, 48, x, y, 48, 48); this.ctx.globalAlpha = 1;
  }

  /**
   * me : { map, x, y, z, face, silhouettes } — le joueur local (dessiné par le jeu).
   * items : [{ id, kind, sheet, frame, pos, map, fx, tag, iconKind }]
   */
  render(now, me, items, { prompt = null, fade = 0 } = {}) {
    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    const vis = 1 - fade;
    if (this._vis !== vis) { this._vis = vis; this.cv.style.opacity = vis; this.dom.style.opacity = vis; }
    if (vis <= 0) { this.layoutDom(now, me, items, null); return; }
    const draw = [];
    for (const it of items) {
      if (!it.pos || it.map !== me.map) continue;
      const p = this.screenOf(me, it.pos);
      if (p.x < -40 || p.x > SCREEN_W + 40 || p.y < -20 || p.y > SCREEN_H + 50) continue;
      draw.push({ it, p });
    }
    draw.sort((a, b) => a.p.y - b.p.y);
    const meMask = me.silhouettes?.[me.face];
    const meClip = meMask && { mask: meMask, x: 128 + SPRITE_ANCHOR.x, y: 96 + SPRITE_ANCHOR.y };
    for (const { it, p } of draw) {
      // derrière le joueur et assez proche pour le chevaucher : on masque par sa silhouette
      const behind = p.y < 96 && Math.abs(p.x - 128) < 26 && 96 - p.y < 30;
      const clip = behind ? meClip : null;
      if (it.kind === 'pokemon') this.drawPokemon(now, me, it, p, clip);
      else this.drawSprite(it.sheet, it.frame, p.x, p.y, p.scale, { clip, alpha: it.alpha ?? 1 });
    }
    this.drawSparkles(now, me, items);
    this.layoutDom(now, me, items, prompt);
    const dt = performance.now() - t0;
    this.stats.frames++; this.stats.ms += dt; this.stats.max = Math.max(this.stats.max, dt);
  }

  drawPokemon(now, me, it, p, clip) {
    const fx = it.fx;
    const walk = it.sheetKind === 'walk';
    const frame = walk ? it.frame : (Math.floor(now / 260) % 2);
    const shadow = () => { const c = this.ctx; c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(Math.round(p.x) + 1, Math.round(p.y) + 1, 7 * p.scale, 2.6 * p.scale, 0, 0, Math.PI * 2); c.fill(); };
    if (!fx || (fx.kind === 'appear' && now < fx.t0)) {
      if (fx?.kind === 'appear') return; // pendant le fondu de changement de zone
      if (!walk) shadow();
      this.drawSprite(it.sheet, frame, p.x, p.y, p.scale, { clip });
      return;
    }
    const t = now - fx.t0;
    const meP = { x: 128, y: 84 };
    if (fx.kind === 'spawn') {
      if (t < 380) { // la Poké Ball part du joueur en cloche
        const k = t / 380, bx = meP.x + (p.x - meP.x) * k, by = meP.y + (p.y - 6 - meP.y) * k - Math.sin(k * Math.PI) * 18;
        this.ctx.save(); this.ctx.translate(Math.round(bx), Math.round(by)); this.ctx.rotate(k * 9);
        this.ctx.drawImage(this.ball, -5, -5); this.ctx.restore();
        return;
      }
      const k = clamp((t - 380) / 260, 0, 1);
      this.flash(p.x, p.y - 8, (t - 380) / 200);
      const s = 0.35 + 0.65 * ease.back(k);
      this.drawSprite(it.sheet, frame, p.x, p.y, p.scale * s, { white: 1 - k, clip });
      if (k >= 1) it.fx = null;
      return;
    }
    if (fx.kind === 'recall') {
      if (t < 220) { const k = t / 220; this.drawSprite(it.sheet, frame, p.x, p.y, p.scale * (1 - 0.6 * k), { white: k, clip }); this.flash(p.x, p.y - 8, k * 0.6); return; }
      const k = clamp((t - 220) / 300, 0, 1);
      const bx = p.x + (meP.x - p.x) * k, by = p.y - 6 + (meP.y - (p.y - 6)) * k - Math.sin(k * Math.PI) * 14;
      if (k < 1) this.ctx.drawImage(this.ball, Math.round(bx) - 5, Math.round(by) - 5);
      return;
    }
    if (fx.kind === 'appear') {
      const k = clamp(t / 300, 0, 1);
      if (!walk) shadow();
      this.drawSprite(it.sheet, frame, p.x, p.y - Math.sin(k * Math.PI) * 4, p.scale, { alpha: k, clip });
      if (k >= 1) it.fx = null;
    }
  }

  flash(x, y, k) {
    if (k <= 0 || k >= 1) return;
    const c = this.ctx, r = 4 + 14 * ease.out(k);
    c.globalAlpha = (1 - k) * 0.9; c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
  }

  /** Scintillement quand un ami change d'apparence. */
  sparkle(id, now) { this.sparkles.push({ id, t0: now }); }
  drawSparkles(now, me, items) {
    this.sparkles = this.sparkles.filter(s => now - s.t0 < 900);
    for (const s of this.sparkles) {
      const it = items.find(i => i.id === s.id);
      if (!it?.pos || it.map !== me.map) continue;
      const p = this.screenOf(me, it.pos), t = (now - s.t0) / 900;
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4 + t * 3, r = 9 + 8 * Math.sin(t * Math.PI + i);
        const x = Math.round(p.x + Math.cos(a) * r), y = Math.round(p.y - 12 + Math.sin(a) * r * 0.9);
        const on = ((now / 70 + i) | 0) % 3 !== 0;
        if (!on) continue;
        this.ctx.globalAlpha = 1 - t;
        this.ctx.fillStyle = i % 2 ? '#ffffff' : '#fff4a8';
        this.ctx.fillRect(x, y - 1, 1, 3); this.ctx.fillRect(x - 1, y, 3, 1);
      }
      this.ctx.globalAlpha = 1;
    }
  }

  // ---------- DOM : étiquettes, bulles, invite ----------
  tagFor(it) {
    let t = this.tags.get(it.id);
    if (!t) {
      const sw = h('i.sw'), nm = h('span.name'), link = h('span.link', { html: icon('link-2', 14) });
      const el = h('div.pl-tag', {}, sw, nm, link);
      this.dom.append(el);
      t = { el, sw, nm, link, text: null, color: null, w: 0, shown: 0, duo: null };
      this.tags.set(it.id, t);
    }
    return t;
  }
  setTag(t, it) {
    if (t.text !== it.tag.name) {
      t.text = it.tag.name; t.nm.textContent = it.tag.name; t.w = t.el.offsetWidth; // mesure uniquement si le texte change
      t.el.animate?.([{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 500 });
    }
    if (t.color !== it.tag.color) { t.color = it.tag.color; t.sw.style.background = it.tag.color; }
    if (t.duo !== !!it.tag.duo) { t.duo = !!it.tag.duo; t.el.classList.toggle('duo', t.duo); t.w = t.el.offsetWidth; }
  }
  layoutDom(now, me, items, prompt) {
    const S = this.S, seen = new Set();
    for (const it of items) {
      if (!it.tag) continue;
      const t = this.tagFor(it); seen.add(it.id);
      const vis = it.pos && it.map === me.map;
      if (!vis) { t.el.style.opacity = 0; continue; }
      this.setTag(t, it);
      const p = this.screenOf(me, it.pos);
      const x = p.x * S - t.w / 2, y = (p.y - 24 * p.scale) * S - 30;
      t.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      t.el.style.opacity = it.tagAlpha ?? 1;
      this.screen.set(it.id, { x: p.x * S, y: (p.y - 24 * p.scale) * S - 30, feet: p.y * S });
    }
    for (const [id, t] of this.tags) if (!seen.has(id)) { t.el.remove(); this.tags.delete(id); }

    // invite « A Interagir » au-dessus de l'ami ciblé
    const ps = this.promptState;
    const target = prompt && items.find(i => i.id === prompt.id);
    const want = target && target.map === me.map ? 1 : 0;
    ps.k = clamp(ps.k + (want ? 0.18 : -0.25), 0, 1);
    if (target) ps.last = target;
    if (ps.k > 0 && ps.last?.pos) {
      const p = this.screenOf(me, ps.last.pos), k = ease.back(ps.k);
      if (prompt?.label && this.prompt.lastChild.textContent !== prompt.label) this.prompt.lastChild.textContent = prompt.label;
      const w = this.prompt.offsetWidth || 120;
      this.prompt.style.transform = `translate3d(${(p.x * S - w / 2).toFixed(1)}px, ${((p.y - 24 * p.scale) * S - 74 + (1 - k) * 12).toFixed(1)}px, 0) scale(${(0.85 + 0.15 * k).toFixed(3)})`;
      this.prompt.style.opacity = ps.k.toFixed(3);
    } else this.prompt.style.opacity = 0;

    // bulles d'émotes
    this.bubbles = this.bubbles.filter(b => { if (now - b.t0 > 1900) { b.el.remove(); return false; } return true; });
    for (const b of this.bubbles) {
      let pos;
      if (b.target === 'me') pos = { x: 128, y: 96, scale: 1 };
      else { const it = items.find(i => i.id === b.target); if (!it?.pos || it.map !== me.map) { b.el.style.opacity = 0; continue; } pos = this.screenOf(me, it.pos); }
      const t = now - b.t0, kin = clamp(t / 220, 0, 1), kout = clamp((t - 1550) / 350, 0, 1);
      const s = 0.4 + 0.6 * ease.back(kin);
      // à droite de la tête, sans masquer l'étiquette ni l'invite
      const away = b.target !== 'me' && pos.x < 128; // du côté opposé au joueur, pour ne pas le masquer
      b.el.style.transformOrigin = away ? '100% 100%' : '0 100%';
      b.el.style.borderRadius = away ? '14px 14px 4px 14px' : '14px 14px 14px 4px';
      b.el.style.transform = `translate3d(${(pos.x * S + (away ? -38 - 44 : 38)).toFixed(1)}px, ${((pos.y - 21 * pos.scale) * S - 48 - 10 * kout).toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
      b.el.style.opacity = (kin * (1 - kout)).toFixed(3);
    }
  }
  bubble(target, kind, now) {
    const el = h('div.pl-bubble.' + kind, { html: icon(kind, 22) });
    this.dom.append(el);
    this.bubbles.push({ target, el, t0: now });
  }
}
