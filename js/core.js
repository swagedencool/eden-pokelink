// Outils de base : horloge, animations pilotées par la boucle, événements, DOM.
// Les animations ne touchent que transform / opacity (composition GPU, pas de reflow),
// et sont avancées par la même boucle que le jeu : rien ne tourne quand rien ne bouge.

export class Emitter {
  constructor() { this._h = new Map(); }
  on(t, f) { (this._h.get(t) || this._h.set(t, new Set()).get(t)).add(f); return () => this._h.get(t).delete(f); }
  emit(t, ...a) { this._h.get(t)?.forEach(f => f(...a)); }
}

export const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  linear: t => t,
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Gestionnaire d'animations : une liste de tweens avancés à chaque frame. */
export class Animator {
  constructor() { this.list = new Set(); this.now = 0; }
  /** from/to : objets de nombres ; apply(values) appelé à chaque frame. */
  tween({ from, to, dur = 250, delay = 0, easing = ease.out, apply, done }) {
    const t = { from, to, dur, start: this.now + delay, easing, apply, done, cancelled: false };
    this.list.add(t);
    apply?.(from);
    return { cancel: () => { t.cancelled = true; this.list.delete(t); }, finished: new Promise(r => (t.resolve = r)) };
  }
  wait(ms) { return new Promise(r => this.tween({ from: { v: 0 }, to: { v: 1 }, dur: ms, apply: () => {}, done: r })); }
  update(now) {
    this.now = now;
    for (const t of [...this.list]) {
      if (now < t.start) continue;
      const k = clamp((now - t.start) / t.dur, 0, 1), e = t.easing(k), v = {};
      for (const key in t.to) v[key] = lerp(t.from[key], t.to[key], e);
      t.apply?.(v);
      if (k >= 1) { this.list.delete(t); t.done?.(); t.resolve?.(); }
    }
  }
}

/** Petite fabrique d'éléments : h('div.card.glass', {attr}, ...children) */
export function h(sel, props = {}, ...kids) {
  const [tagName, ...classes] = sel.split('.');
  const el = document.createElement(tagName || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

/** Style « transform/opacity » appliqué en une écriture. */
export function setTO(el, { x = 0, y = 0, s = 1, o = 1 } = {}) {
  el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
  el.style.opacity = o.toFixed(3);
}
