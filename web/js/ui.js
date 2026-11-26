// Composants d'interface « glass ». Chaque panneau est une couche de focus : quand il est ouvert,
// il reçoit les touches (D-pad, A, B) et le jeu n'en reçoit aucune.
// Images : toujours via ui.portrait / ui.mon / ui.trainer (vignettes carrées déjà centrées sur leurs pixels).
import { h, ease, setTO, clamp } from './core.js';
import { icon } from './icons.js';
import { COLOR_SLOTS } from './rom.js';
import { settings, ACTIONS, SPEEDS, keyName } from './settings.js';
import { FILTERS } from './emu/screen.js';
import { TYPE_COLORS } from './gamedata.js';

const KIND = {
  battle: { label: 'Combattre', sub: 'Défier en combat', accent: 'var(--c-battle)', icon: 'swords' },
  trade: { label: 'Échanger', sub: 'Proposer un échange', accent: 'var(--c-trade)', icon: 'arrow-left-right' },
  duo: { label: 'Combat en duo', sub: '2 Pokémon chacun sur le terrain', accent: 'var(--c-duo)', icon: 'users' },
  team: { label: 'Voir son équipe', sub: 'Pokémon et niveaux', accent: 'var(--c-team)', icon: 'eye' },
  react: { label: 'Réagir', sub: 'Envoyer une émote', accent: 'var(--c-react)', icon: 'smile' },
};
export const EMOTES = ['heart', 'music', 'laugh', 'thumbs-up', 'zap', 'circle-help'];
export const SWATCHES = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
export const keycap = k => h('span.kc' + (k.length === 1 ? '.a' : ''), {}, k);
const hint = (k, text) => h('span', {}, keycap(k), text);
/** Souris : clic (et survol facultatif) sur un élément de panneau. Le clic ne traverse pas jusqu'au jeu. */
export function tap(el, fn, hover) {
  el.classList.add('pl-click');
  el.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); fn(e); });
  if (hover) el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') hover(e); });
  return el;
}
const genderSign = g => (g === 'M' || g === 0 ? '♂' : g === 'F' || g === 1 ? '♀' : '');

/** Base : ouverture / fermeture animées, couche de focus. */
export class Panel {
  constructor(ui, el) { this.ui = ui; this.el = el; this.closed = false; this.x = 0; this.y = 0; }
  open({ from = { s: 0.94, o: 0, y: 10 }, dur = 240 } = {}) {
    this.ui.layer.append(this.el);
    this.ui.anim.tween({ from: { ...from }, to: { s: 1, o: 1, y: 0 }, dur, easing: ease.back,
      apply: v => setTO(this.el, { x: this.x, y: this.y + v.y, s: v.s, o: clamp(v.o, 0, 1) }) });
    return this;
  }
  close(dur = 170) {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.ui.drop(this);
    return this.ui.anim.tween({ from: { s: 1, o: 1 }, to: { s: 0.96, o: 0 }, dur, easing: ease.out,
      apply: v => setTO(this.el, { x: this.x, y: this.y, s: v.s, o: v.o }), done: () => this.el.remove() }).finished;
  }
  nav() { return false; }
}

// ---------------------------------------------------------------------------------------------
export class InteractionMenu extends Panel {
  constructor(ui, peer, { onPick, onEmote, onClose }) {
    const items = Object.entries(KIND).map(([id, k]) => {
      const el = h('div.pl-item', { style: { '--accent': k.accent } },
        h('div.ib', { html: icon(k.icon, 20) }),
        h('div.tx', {}, h('div.tt', {}, k.label), h('small', {}, k.sub)),
        h('span.chev', { html: icon('chevron-right', 18) }));
      return { id, el };
    });
    const list = h('div', {}, items.map(i => i.el));
    const emotes = h('div.pl-emotes', { style: { display: 'none' } }, EMOTES.map(e => h('div.e', { html: icon(e, 20) })));
    const el = h('div.pl-menu.glass', {},
      h('header', {}, ui.portrait(peer.profile, 44),
        h('div', {}, h('div.t', {}, peer.profile.name), h('small', { html: icon('map-pin', 12) + ui.app.placeName(peer.map) + (() => { const l = ui.app.me.last; if (!l || l.map !== peer.map) return ''; const d = Math.abs(peer.tx - l.tx) + Math.abs(peer.tz - l.tz); return d ? ` · à ${d} pas` : ''; })() }))),
      list, emotes,
      h('div.pl-hints', {}, tap(hint('A', 'Choisir'), () => this.nav('A')), tap(hint('B', 'Fermer'), () => this.nav('B'))));
    super(ui, el);
    Object.assign(this, { peer, items, list, emotes, onPick, onEmote, onClose, sel: 0, mode: 'list', esel: 0 });
    items.forEach((it, i) => tap(it.el, () => { this.sel = i; this.nav('A'); }, () => { this.sel = i; this.refresh(); }));
    [...emotes.children].forEach((e, i) => tap(e, () => { this.esel = i; this.nav('A'); }, () => { this.esel = i; this.refresh(); }));
    this.refresh();
    // à côté du groupe (ami + soi) sans recouvrir aucun des deux : à gauche s'il y a la place, sinon à droite
    const a = ui.app.overlay.screen.get(peer.id) || { x: 384, y: 240 }, W = 304, H = 410, GAP = 56;
    const left = Math.min(a.x, 384) - GAP - W, right = Math.max(a.x, 384) + GAP;
    this.x = left >= 16 ? left : clamp(right, 16, 768 - W - 16);
    this.y = clamp(a.y - 96, 16, 576 - H - 16);
  }
  refresh() {
    this.items.forEach((it, i) => it.el.classList.toggle('sel', i === this.sel));
    [...this.emotes.children].forEach((e, i) => e.classList.toggle('sel', i === this.esel));
  }
  nav(k) {
    if (this.mode === 'emote') {
      if (k === 'LEFT') this.esel = (this.esel + EMOTES.length - 1) % EMOTES.length;
      else if (k === 'RIGHT') this.esel = (this.esel + 1) % EMOTES.length;
      else if (k === 'A') { this.onEmote(EMOTES[this.esel]); this.close(); this.onClose?.(); }
      else if (k === 'B') { this.mode = 'list'; this.list.style.display = ''; this.emotes.style.display = 'none'; }
      if (!this.closed) this.refresh(); return true;
    }
    if (k === 'UP') this.sel = (this.sel + this.items.length - 1) % this.items.length;
    else if (k === 'DOWN') this.sel = (this.sel + 1) % this.items.length;
    else if (k === 'A') {
      const id = this.items[this.sel].id;
      if (id === 'react') { this.mode = 'emote'; this.list.style.display = 'none'; this.emotes.style.display = 'grid'; }
      else this.onPick(id, this);
    } else if (k === 'B') { this.close(); this.onClose?.(); }
    this.refresh(); return true;
  }
}

// ---------------------------------------------------------------------------------------------
const TITLES = {
  out: { battle: 'Défi envoyé', trade: "Demande d'échange envoyée", duo: 'Défi en duo envoyé' },
  in: { battle: n => `${n} te défie en combat !`, trade: n => `${n} te propose un échange`, duo: n => `${n} te défie en duo (2 contre 2) !` },
  chips: { battle: ['3 contre 3', 'Règles de la room'], trade: ['Échange direct', 'Sauvegarde conseillée après'], duo: ['4 contre 4', '2 sur le terrain'] },
};
export class RequestCard extends Panel {
  constructor(ui, { dir, kind, peer, timeout = 30000, onAccept, onDecline, onCancel }) {
    const k = KIND[kind], R = 25, C = 2 * Math.PI * R;
    const ring = h('div.ring', { style: { '--accent': k.accent }, html:
      `<svg class="arc" viewBox="0 0 56 56" width="56" height="56"><circle cx="28" cy="28" r="${R}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="3.5"/><circle cx="28" cy="28" r="${R}" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="0"/></svg>` });
    ring.append(h('div.ico', { html: dir === 'in' ? '' : icon(k.icon, 22) }));
    if (dir === 'in') ring.lastChild.append(h('img', { src: ui.portraitURL(peer.profile, 44) }));
    const title = h('div.t', {}, dir === 'in' ? TITLES.in[kind](peer.profile.name) : TITLES.out[kind]);
    const sub = h('div.s', {}, dir === 'in' ? 'Réponds avant la fin du compte à rebours' : `En attente de la réponse de ${peer.profile.name}…`);
    const chips = h('div.chips', {}, TITLES.chips[kind].map(c => h('span.pl-mini', {}, c)));
    const acts = dir === 'in'
      ? h('div.acts', {}, tap(h('span.pl-btn.primary', { style: { '--accent': k.accent } }, keycap('A'), 'Accepter'), () => this.nav('A')), tap(h('span.pl-btn', {}, keycap('B'), 'Refuser'), () => this.nav('B')))
      : h('div.acts', {}, tap(h('span.pl-btn', {}, keycap('B'), 'Annuler'), () => this.nav('B')));
    const el = h('div.pl-request.glass', { style: { '--accent': k.accent } }, ring, h('div.body', {}, title, sub, chips), acts);
    super(ui, el);
    Object.assign(this, { dir, kind, peer, timeout, onAccept, onDecline, onCancel, title, sub, ringArc: ring.querySelector('circle:last-child'), C, t0: ui.anim.now, acts });
  }
  update(now) {
    if (this.closed || this.settled) return;
    const k = clamp((now - this.t0) / this.timeout, 0, 1);
    this.ringArc.setAttribute('stroke-dashoffset', (this.C * k).toFixed(2));
    if (k >= 1) { this.settled = true; this.dir === 'in' ? this.onDecline?.('timeout') : this.onCancel?.('timeout'); this.close(); }
  }
  /** Réponse reçue pour une demande envoyée. */
  resolve(accepted) {
    this.settled = true;
    this.title.replaceChildren(accepted ? h('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, h('span.pl-check', { html: icon('check', 14) }), `${this.peer.profile.name} a accepté !`) : `${this.peer.profile.name} a refusé`);
    this.sub.textContent = accepted ? ({ trade: "Ouverture de la fenêtre d'échange…", battle: 'Préparation du combat…', duo: 'Préparation du combat en duo…' })[this.kind] : 'Une autre fois peut-être !';
    this.ringArc.setAttribute('stroke-dashoffset', '0');
    this.acts.style.display = 'none';
  }
  nav(k) {
    if (this.settled) return true;
    if (this.dir === 'in') {
      if (k === 'A') { this.settled = true; this.close(); this.onAccept?.(); }
      else if (k === 'B') { this.settled = true; this.close(); this.onDecline?.('refuse'); }
    } else if (k === 'B') { this.settled = true; this.close(); this.onCancel?.('cancel'); }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
export class TradePanel extends Panel {
  constructor(ui, { peer, mine, theirs, onPick, onConfirm, onCancel }) {
    const card = m => h('div.pl-card', {}, ui.mon(m.species),
      h('div.n', {}, m.name), h('div.l', {}, `Nv. ${m.level} ${genderSign(m.gender)}`.trim()),
      h('div.hp', {}, h('i', { style: { width: Math.round((100 * (m.hp ?? 1)) / (m.maxhp || 1)) + '%' } })));
    const mineEls = mine.map(card), theirEls = theirs.map(card);
    const steps = h('div.pl-steps', {}, h('i.on'), h('i'), h('i'));
    const sum = h('div.sum');
    const back = h('span.pl-btn', {}, keycap('B'), 'Retour');
    const btn = h('span.pl-btn.primary.dim', { style: { '--accent': 'var(--c-trade)' } }, keycap('A'), "Confirmer l'échange");
    const me = ui.app.me.profile;
    const el = h('div.pl-trade.glass', { style: { '--peer': peer.profile.color || '#a78bfa' } },
      h('header', {}, h('div.ib', { html: icon('arrow-left-right', 20) }),
        h('div', {}, h('h3', {}, `Échange avec ${peer.profile.name}`), h('small', {}, 'Chacun choisit, puis les deux confirment')), steps),
      h('div.pl-cols', {},
        h('div.pl-col', {}, h('h5', {}, ui.portrait(me, 22), `${me.name} · toi`), h('div.pl-grid', {}, mineEls)),
        h('div.pl-mid', {}, h('div.swap', { html: icon('arrow-left-right', 20) })),
        h('div.pl-col', {}, h('h5', {}, ui.portrait(peer.profile, 22), peer.profile.name), h('div.pl-grid', {}, theirEls))),
      h('footer', {}, sum, back, btn));
    super(ui, el);
    Object.assign(this, { peer, mine, theirs, mineEls, theirEls, steps, sum, btn, back, onPick, onConfirm, onCancel,
      cur: 0, pick: null, rcur: 0, rpick: null, confirmed: false, rconfirmed: false, phase: 'pick' });
    this.bg = h('div.pl-modal-bg');
    mineEls.forEach((e, i) => tap(e, () => this.clickMine(i), () => {
      if (this.phase === 'pick' && this.pick === null && this.cur !== i) { this.cur = i; this.onPick?.(i, 'cursor'); this.refresh(); }
    }));
    tap(btn, () => { if (this.phase === 'confirm') this.nav('A'); });
    tap(back, () => this.nav('B'));
    this.refresh();
  }
  /** Clic sur un de mes Pokémon : le proposer (ou changer d'avis tant que je n'ai pas confirmé). */
  clickMine(i) {
    if (this.phase === 'swap' || this.phase === 'done' || this.confirmed) return;
    if (this.phase === 'confirm') { this.phase = 'pick'; this.pick = null; }
    if (this.pick === i) { this.pick = null; this.onPick?.(null); this.refresh(); return; }
    this.cur = i; this.onPick?.(i, 'cursor');
    this.pick = null; this.nav('A');
  }
  open() {
    this.ui.layer.append(this.bg);
    this.ui.anim.tween({ from: { o: 0 }, to: { o: 1 }, dur: 220, apply: v => (this.bg.style.opacity = v.o) });
    return super.open({ from: { s: 0.94, o: 0, y: 12 }, dur: 300 });
  }
  close() { this.ui.anim.tween({ from: { o: 1 }, to: { o: 0 }, dur: 200, apply: v => (this.bg.style.opacity = v.o), done: () => this.bg.remove() }); return super.close(200); }
  remote(ev) {
    if (this.phase === 'done' || this.phase === 'swap') return;
    if (ev.action === 'state') {                          // état complet de l'ami (renvoyé chaque seconde)
      if (ev.cur !== undefined && ev.cur !== null) this.rcur = ev.cur;
      this.rpick = ev.pick ?? null;
      this.rconfirmed = !!ev.confirmed && this.rpick !== null;
      this.refresh(); this.maybeSwap(); return;
    }
    if (ev.action === 'confirm' && ev.slot !== undefined && ev.slot !== null) this.rpick = ev.slot;
    if (ev.action === 'cursor') this.rcur = ev.slot;
    if (ev.action === 'pick') this.rpick = ev.slot;
    if (ev.action === 'unpick') { this.rpick = null; this.rconfirmed = false; }
    if (ev.action === 'confirm') this.rconfirmed = true;
    this.refresh(); this.maybeSwap();
  }
  badge(el, on) {
    el.querySelector('.badge')?.remove();
    if (on) el.append(h('span.badge', {}, h('span', { html: icon('check', 12) }), 'Prêt'));
  }
  refresh() {
    this.mineEls.forEach((e, i) => { e.classList.toggle('cur', i === this.cur && this.phase === 'pick' && this.pick === null); e.classList.toggle('pick', i === this.pick); this.badge(e, i === this.pick && this.confirmed); });
    this.theirEls.forEach((e, i) => { e.classList.toggle('remote-cur', i === this.rcur && this.rpick === null); e.classList.toggle('remote-pick', i === this.rpick); this.badge(e, i === this.rpick && this.rconfirmed); });
    const both = this.pick !== null && this.rpick !== null;
    [...this.steps.children].forEach((s, i) => s.classList.toggle('on', i === 0 || (i === 1 && both) || (i === 2 && (this.phase === 'swap' || this.phase === 'done'))));
    this.btn.classList.toggle('dim', !(both && !this.confirmed && this.phase !== 'swap' && this.phase !== 'done'));
    this.btn.classList.toggle('sel', both && !this.confirmed && this.phase === 'confirm');
    const mon = sp => this.ui.thumbMon(sp, 32);
    const sum = this.sum; sum.replaceChildren();
    if (this.phase === 'done') sum.append(h('span.pl-check', { html: icon('check', 14) }), h('b', {}, 'Échange réussi !'));
    else if (this.phase === 'swap') sum.append(h('span.pl-spin'), 'Échange en cours…');
    else if (this.confirmed && !this.rconfirmed) sum.append(h('span.pl-spin'), `Confirmé · en attente de ${this.peer.profile.name}…`);
    else if (this.pick === null) sum.append('Choisis le Pokémon que tu proposes');
    else if (this.rpick === null) sum.append('Tu proposes', mon(this.mine[this.pick].species), h('b', {}, this.mine[this.pick].name), `· ${this.peer.profile.name} choisit…`);
    else sum.append('Tu donnes', mon(this.mine[this.pick].species), h('b', {}, this.mine[this.pick].name), '· tu reçois', mon(this.theirs[this.rpick].species), h('b', {}, this.theirs[this.rpick].name));
  }
  nav(k) {
    if (this.phase === 'swap' || this.phase === 'done') return true;
    const n = this.mine.length;
    if (this.phase === 'pick') {
      const before = this.cur;
      if (k === 'UP') this.cur = (this.cur - 2 + n) % n;
      else if (k === 'DOWN') this.cur = (this.cur + 2) % n;
      else if (k === 'LEFT') this.cur = this.cur % 2 ? this.cur - 1 : Math.min(n - 1, this.cur + 1);
      else if (k === 'RIGHT') this.cur = this.cur % 2 ? this.cur - 1 : Math.min(n - 1, this.cur + 1);
      else if (k === 'A') { this.pick = this.cur; this.onPick?.(this.pick); if (this.rpick !== null) this.phase = 'confirm'; }
      else if (k === 'B') { if (this.pick !== null) { this.pick = null; this.onPick?.(null); } else { this.close(); this.onCancel?.(); } }
      if (this.cur !== before) this.onPick?.(this.cur, 'cursor');
    } else if (this.phase === 'confirm') {
      if (k === 'A' && !this.confirmed) { this.confirmed = true; this.onConfirm?.(); this.maybeSwap(); }
      else if (k === 'B') { this.confirmed = false; this.pick = null; this.phase = 'pick'; this.onPick?.(null); }
    }
    this.refresh(); return true;
  }
  update(now) {
    if (this.phase === 'pick' && this.pick !== null && this.rpick !== null) { this.phase = 'confirm'; this.refresh(); }
    const sp = this.sum.querySelector('.pl-spin'); if (sp) sp.style.transform = `rotate(${(now * 0.5) % 360}deg)`;
  }
  async maybeSwap() {
    if (!(this.confirmed && this.rconfirmed) || this.phase === 'swap' || this.phase === 'done') return;
    this.phase = 'swap'; this.refresh();
    const a = this.mineEls[this.pick], b = this.theirEls[this.rpick];
    const box = this.el.getBoundingClientRect();
    const at = el => { const r = el.querySelector('.cell64').getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top }; };
    const pa = at(a), pb = at(b);
    const fly = (sp, p) => { const im = h('img.pl-fly', { src: this.ui.monURL(sp) }); setTO(im, p); this.el.append(im); return im; };
    const fa = fly(this.mine[this.pick].species, pa), fb = fly(this.theirs[this.rpick].species, pb);
    a.querySelector('.cell64').style.opacity = 0; b.querySelector('.cell64').style.opacity = 0;
    const burst = h('div.pl-burst'); this.el.append(burst);
    const mx = (pa.x + pb.x) / 2 + 32, my = Math.min(pa.y, pb.y) - 30;
    this.ui.anim.tween({ from: { k: 0 }, to: { k: 1 }, dur: 1000, easing: ease.inOut, apply: ({ k }) => {
      const arc = Math.sin(k * Math.PI);
      setTO(fa, { x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k - arc * 70, s: 1 + arc * 0.35 });
      setTO(fb, { x: pb.x + (pa.x - pb.x) * k, y: pb.y + (pa.y - pb.y) * k + arc * 40, s: 1 + arc * 0.35 });
      setTO(burst, { x: mx - 70, y: my - 30, s: 0.2 + arc * 1.1, o: arc * 0.9 });
    } });
    await this.ui.anim.wait(1000);
    [this.mine[this.pick], this.theirs[this.rpick]] = [this.theirs[this.rpick], this.mine[this.pick]];
    const fill = (el, m) => el.replaceChildren(...this.ui.monCardChildren(m));
    fill(a, this.mine[this.pick]); fill(b, this.theirs[this.rpick]);
    fa.remove(); fb.remove(); burst.remove();
    this.phase = 'done'; this.confirmed = this.rconfirmed = false; this.refresh();
    this.received = this.mine[this.pick];
    await this.ui.anim.wait(1300);
    this.close();
    this.onDone?.(this.received);
  }
}

// ---------------------------------------------------------------------------------------------
export class VersusCard extends Panel {
  constructor(ui, { me, peer, myTeam, theirTeam, rules }) {
    const side = (p, team, dir) => h('div.side', {},
      h('img.trainer', { src: ui.trainerURL(p, dir) }),
      h('div.nm', {}, p.name),
      h('div.team.glass', {}, team.map(m => ui.mon(m.species))));
    const L = side(me, myTeam, 3), R = side(peer, theirTeam, 2);
    const mid = h('div.mid', {}, h('div.big', {}, 'VS'));
    const status = h('div.status.glass', {}, h('span.pl-spin'), h('span', {}, 'Synchronisation des équipes…'));
    const chips = h('div.chips', {}, rules.map(r => h('span.pl-chip', {}, r)));
    super(ui, h('div.pl-vs', {}, L, mid, R, chips, status));
    Object.assign(this, { L, R, mid, status });
  }
  open() {
    this.ui.layer.append(this.el);
    const A = this.ui.anim;
    A.tween({ from: { o: 0 }, to: { o: 1 }, dur: 260, apply: v => (this.el.style.opacity = v.o) });
    A.tween({ from: { x: -260, o: 0 }, to: { x: 0, o: 1 }, dur: 520, delay: 80, easing: ease.back, apply: v => setTO(this.L, { x: v.x, o: v.o }) });
    A.tween({ from: { x: 260, o: 0 }, to: { x: 0, o: 1 }, dur: 520, delay: 80, easing: ease.back, apply: v => setTO(this.R, { x: v.x, o: v.o }) });
    A.tween({ from: { s: 2.4, o: 0 }, to: { s: 1, o: 1 }, dur: 420, delay: 420, easing: ease.back, apply: v => setTO(this.mid, { s: v.s, o: v.o }) });
    return this;
  }
  update(now) { const sp = this.status.querySelector('.pl-spin'); if (sp) sp.style.transform = `rotate(${(now * 0.5) % 360}deg)`; }
  ready(text) { this.status.replaceChildren(h('span.pl-check', { html: icon('check', 14) }), h('span', {}, text)); }
  nav() { return true; }
  close() {
    this.closed = true; this.ui.drop(this);
    return this.ui.anim.tween({ from: { o: 1 }, to: { o: 0 }, dur: 380, apply: v => (this.el.style.opacity = v.o), done: () => this.el.remove() }).finished;
  }
}

// ---------------------------------------------------------------------------------------------
export class ProfilePanel extends Panel {
  constructor(ui, { profile, team, onSave, onCancel }) {
    const draft = JSON.parse(JSON.stringify(profile));
    const cv = h('canvas', { width: 48, height: 48 });
    const nm = h('div.nm', {}, draft.name);
    const input = h('input.pl-input', { value: draft.name, maxlength: 12, spellcheck: 'false' });
    const seg = h('div.pl-seg', {}, h('span', {}, 'Lucas'), h('span', {}, 'Aurore'));
    const save = h('span.pl-btn.primary', { style: { '--accent': 'var(--brand-a)' } }, keycap('A'), 'Enregistrer');
    const cancel = h('span.pl-btn', {}, keycap('B'), 'Annuler');
    const acts = h('div.acts', {}, cancel, save);
    const nameRow = h('div.pl-row', {}, h('label', {}, 'Pseudo'), input);
    const baseRow = h('div.pl-row', {}, h('label', {}, 'Personnage'), seg);
    const colorRows = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
    const buddies = h('div.pl-buddies', {}, team.map(m => ui.mon(m.species)));
    const buddyRow = h('div.pl-row', {}, h('label', {}, 'Pokémon compagnon'), buddies);
    const el = h('div.pl-profile.glass', {},
      h('div.pl-preview', {}, h('div.floor'), cv, nm, h('small', {}, 'Ce que tes amis voient en jeu'),
        h('div.foot', {}, h('div.pl-note', { html: icon('sparkles', 14) + '<span>Tes amis te voient tout de suite. Dans ton jeu (à pied, à vélo, en surf) : dès que tu passes une porte. Lucas/Aurore change aussi ton personnage dans la partie.</span>' }), acts)),
      h('div.pl-form', {},
        h('h3', { html: icon('palette', 20) + ' Mon personnage' }),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 172px', gap: '4px' } }, nameRow, baseRow),
        colorRows, buddyRow));
    super(ui, el);
    Object.assign(this, { draft, cv, nm, input, seg, buddies, save, cancel, team, onSave, onCancel, r: 0, cols: {}, colorRows, act: 1 });
    this.fixed = { name: { id: 'name', el: nameRow }, base: { id: 'base', el: baseRow }, buddy: { id: 'buddy', el: buddyRow }, actions: { id: 'actions', el: acts } };
    this.ctx = cv.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    this.picker = h('input', { type: 'color', tabindex: '-1', style: { position: 'absolute', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none', left: '50%', top: '50%' } });
    el.append(this.picker);
    this.picker.addEventListener('input', () => this.pickCustom(this.picker.value));
    // souris : chaque ligne se sélectionne au clic, chaque choix se fait directement
    const go = id => { const i = this.rows.findIndex(r => r.id === id); if (i >= 0) this.r = i; };
    tap(nameRow, () => { go('name'); this.refresh(); this.input.focus(); });
    this.input.addEventListener('focus', () => { if (this.rows[this.r].id !== 'name') { go('name'); this.refresh(); } });
    this.input.addEventListener('input', () => this.refresh());
    [...seg.children].forEach((x, i) => tap(x, () => { go('base'); this.setBase(i === 0 ? 'lucas' : 'aurore'); this.refresh(); }));
    tap(save, () => { this.close(); this.onSave(this.draft); });
    tap(cancel, () => { this.close(); this.onCancel?.(); });
    this.buildColorRows();
    [...buddies.children].forEach((b, i) => tap(b, () => { go('buddy'); if (this.team[i]) this.draft.buddy = this.team[i].species; this.refresh(); }));
    this.refresh();
  }
  setBase(base) { if (base !== this.draft.base) { this.draft.base = base; this.draft.colors = {}; this.buildColorRows(); } }
  pickCustom(hex) {
    const row = this.customRow; if (!row) return;
    this.cols[row.slot.id] = SWATCHES.length + 1;
    row.sw[SWATCHES.length + 1].style.background = hex;
    this.draft.colors = { ...this.draft.colors, [row.slot.id]: hex };
    this.refresh();
  }
  buildColorRows() {
    const rows = COLOR_SLOTS[this.draft.base].map(s => {
      const cur = this.draft.colors?.[s.id], custom = cur && !SWATCHES.includes(cur);
      const sw = [h('i', { style: { background: this.ui.slotOriginal(this.draft.base, s) }, title: 'Couleur d’origine' }), ...SWATCHES.map(c => h('i', { style: { background: c } })),
        h('i.custom', { title: 'Autre couleur…', style: custom ? { background: cur } : {} })];
      this.cols[s.id] = !cur ? 0 : custom ? SWATCHES.length + 1 : SWATCHES.indexOf(cur) + 1;
      const row = { id: 'color:' + s.id, el: h('div.pl-row', {}, h('label', {}, s.label), h('div.pl-swatches', {}, sw)), slot: s, sw };
      sw.forEach((x, i) => tap(x, () => {
        this.r = this.rows.indexOf(row);
        if (i === SWATCHES.length + 1) { this.customRow = row; this.picker.value = /^#[0-9a-f]{6}$/i.test(this.draft.colors?.[s.id] || '') ? this.draft.colors[s.id] : '#ffffff'; this.picker.click(); return this.refresh(); }
        this.cols[s.id] = i;
        this.draft.colors = { ...this.draft.colors, [s.id]: i === 0 ? undefined : SWATCHES[i - 1] };
        this.refresh();
      }));
      return row;
    });
    this.colorRows.replaceChildren(...rows.map(r => r.el));
    const f = this.fixed;
    this.rows = [f.name, f.base, ...rows, f.buddy, f.actions];
  }
  refresh() {
    this.rows.forEach((r, i) => r.el.classList.toggle('sel', i === this.r && r.id !== 'actions'));
    const id = this.rows[this.r].id, onName = id === 'name';
    this.input.classList.toggle('focus', onName);
    if (onName && document.activeElement !== this.input) this.input.focus({ preventScroll: true });
    if (!onName && document.activeElement === this.input) this.input.blur();
    [...this.seg.children].forEach((s, i) => s.classList.toggle('on', (i === 0) === (this.draft.base === 'lucas')));
    for (const r of this.rows) if (r.slot) r.sw.forEach((s, i) => { s.classList.toggle('on', i === this.cols[r.slot.id]); s.classList.toggle('cur', i === this.cols[r.slot.id] && this.rows[this.r] === r); });
    [...this.buddies.children].forEach((b, i) => b.classList.toggle('on', this.team[i]?.species === this.draft.buddy));
    this.save.classList.toggle('sel', id === 'actions' && this.act === 1); this.cancel.classList.toggle('sel', id === 'actions' && this.act === 0);
    this.draft.name = this.input.value.trim() || 'Dresseur';
    this.nm.textContent = this.draft.name;
  }
  nav(k) {
    const row = this.rows[this.r];
    if (k === 'UP') this.r = Math.max(0, this.r - 1);
    else if (k === 'DOWN') this.r = Math.min(this.rows.length - 1, this.r + 1);
    else if (row.id === 'base' && (k === 'LEFT' || k === 'RIGHT')) this.setBase(k === 'LEFT' ? 'lucas' : 'aurore'); else if (row.slot && (k === 'LEFT' || k === 'RIGHT')) {
      const c = clamp(this.cols[row.slot.id] + (k === 'LEFT' ? -1 : 1), 0, SWATCHES.length);
      this.cols[row.slot.id] = c;
      this.draft.colors = { ...this.draft.colors, [row.slot.id]: c === 0 ? undefined : SWATCHES[c - 1] };
    } else if (row.id === 'buddy' && (k === 'LEFT' || k === 'RIGHT')) {
      const i = this.team.findIndex(m => m.species === this.draft.buddy);
      this.draft.buddy = this.team[clamp(i + (k === 'LEFT' ? -1 : 1), 0, this.team.length - 1)].species;
    } else if (row.id === 'actions' && (k === 'LEFT' || k === 'RIGHT')) this.act = k === 'LEFT' ? 0 : 1;
    else if (k === 'A' && row.id === 'actions') { this.close(); this.act === 1 ? this.onSave(this.draft) : this.onCancel?.(); }
    else if (k === 'B') { this.close(); this.onCancel?.(); }
    this.refresh(); return true;
  }
  /** Aperçu 48×48 (×4) : le personnage marche en changeant de direction, son compagnon derrière lui. */
  update(now) {
    const c = this.ctx; c.clearRect(0, 0, 48, 48);
    const sheet = this.ui.lib.avatar(this.draft.base, this.draft.colors);
    const dir = [1, 3, 0, 2][Math.floor(now / 1400) % 4], step = [0, 1, 0, 3][Math.floor(now / 133) % 4];
    const bud = this.draft.buddy && this.ui.lib.pokemon(this.draft.buddy);
    if (bud) c.drawImage(bud.sheet, (bud.kind === 'walk' ? dir * 4 + step : Math.floor(now / 260) % 2) * 32, 0, 32, 32, 16, 13, 32, 32);
    c.drawImage(sheet, (dir * 4 + step) * 32, 0, 32, 32, 0, 13, 32, 32);
  }
}

// ---------------------------------------------------------------------------------------------
export class Toasts {
  constructor(ui) { this.ui = ui; this.el = h('div.pl-toasts'); ui.layer.append(this.el); }
  /** lead : { profile } (portrait) · { species } (icône de Pokémon) · { icon } (pictogramme) */
  show({ profile, species, ic, title, sub, accent = 'var(--brand-a)', dur = 2600 }) {
    const lead = profile ? this.ui.portrait(profile, 44)
      : species ? h('div.lead-mon', {}, h('img', { src: this.ui.monURL(species) }))
      : h('div.thumb', { style: { color: accent }, html: icon(ic || 'sparkles', 20) });
    const t = h('div.pl-toast.glass', {}, lead, h('div.txt', {}, title, sub ? h('small', {}, sub) : null));
    this.el.append(t);
    const A = this.ui.anim;
    A.tween({ from: { y: -16, o: 0, s: 0.96 }, to: { y: 0, o: 1, s: 1 }, dur: 280, easing: ease.back, apply: v => setTO(t, v) });
    A.tween({ from: { o: 1, y: 0 }, to: { o: 0, y: -10 }, dur: 260, delay: dur, apply: v => setTO(t, v), done: () => t.remove() });
  }
}

// ---------------------------------------------------------------------------------------------
/** Règles de la room : Âmes liées et Plafond de niveau, activables par n'importe quel joueur, à tout moment. */
export class RulesPanel extends Panel {
  constructor(ui, { rules, places, onChange }) {
    const sw = () => h('span.pl-switch', {}, h('i'));
    const row = (ic, title, sub, right) => h('div.pl-rule', {}, h('span.ic', { html: icon(ic, 18) }), h('div.txt', {}, h('b', {}, title), h('small', {}, sub)), right);
    const soulSw = sw(), capSw = sw();
    const seg = h('div.pl-seg.small', {}, h('span', {}, 'Automatique'), h('span', {}, 'Fixe'));
    const val = h('div.pl-capval', {}, h('span.arrow', { html: icon('chevron-left', 16) }), h('b'), h('span.arrow', { html: icon('chevron-right', 16) }));
    const capInfo = h('small.pl-capinfo');
    const links = h('div.pl-links');
    const el = h('div.pl-rules.glass', {},
      h('div.head', {}, h('span.hic', { html: icon('shield', 22) }), h('div', {}, h('h3', {}, 'Règles de la room'), h('small', {}, 'Chacun peut les activer ou les couper, à tout moment'))),
      h('div.rows', {},
        row('link-2', 'Âmes liées', 'Les Pokémon rencontrés au même endroit sont liés entre amis : si l’un tombe K.O., les autres aussi, pour de bon.', soulSw),
        row('gauge', 'Plafond de niveau', 'Au plafond, plus d’expérience en combat ni à la Pension, et les Super Bonbons sont sans effet.', capSw),
        h('div.pl-rule.sub', {}, h('div.txt', {}, h('b', {}, 'Plafond'), capInfo), seg),
        h('div.pl-rule.sub.val', {}, h('div.txt', {}, h('b', {}, 'Niveau fixé')), val)),
      h('div.sec', {}, h('h4', { html: icon('users', 14) + ' Liens de la room' }), links),
      h('div.foot', {}, h('span', {}, keycap('A'), 'Activer'), h('span', {}, keycap('◀'), keycap('▶'), 'Régler'), h('span', {}, keycap('B'), 'Fermer')));
    super(ui, el);
    Object.assign(this, { rules, places, onChange, soulSw, capSw, seg, val, capInfo, links, r: 0 });
    this.rowEls = [...el.querySelectorAll('.pl-rule')];
    const pick = i => { this.r = Math.max(0, this.visibleRows.indexOf(i)); };
    tap(this.rowEls[0], () => { pick(0); this.nav('A'); });
    tap(this.rowEls[1], () => { pick(1); this.nav('A'); });
    [...seg.children].forEach((x, i) => tap(x, () => { pick(2); this.onChange({ capMode: i === 0 ? 'auto' : 'manual' }); this.refresh(); }));
    const [less, , more] = val.children;
    tap(less, () => { pick(3); this.nav('LEFT'); }); tap(more, () => { pick(3); this.nav('RIGHT'); });
    const [fa, , fb] = el.querySelector('.foot').children;
    tap(fa, () => this.nav('A')); tap(fb, () => this.nav('B'));
    el.append(tap(h('span.pl-x', { title: 'Fermer', html: icon('x', 18) }), () => this.nav('B')));
    this.refresh();
  }
  get visibleRows() { const s = this.rules.state; return [0, 1, ...(s.levelCap ? [2] : []), ...(s.levelCap && s.capMode === 'manual' ? [3] : [])]; }
  refresh() {
    const s = this.rules.state, cap = this.rules.cap, vis = this.visibleRows;
    this.r = Math.min(this.r, vis.length - 1);
    this.rowEls.forEach((e, i) => { e.style.display = vis.includes(i) ? '' : 'none'; e.classList.toggle('sel', vis[this.r] === i); });
    this.soulSw.classList.toggle('on', s.soulLink); this.capSw.classList.toggle('on', s.levelCap);
    [...this.seg.children].forEach((x, i) => x.classList.toggle('on', (i === 0) === (s.capMode !== 'manual')));
    this.val.querySelector('b').textContent = `N.${s.capValue}`;
    this.capInfo.textContent = !cap ? '' : s.capMode === 'manual' ? 'Le même niveau pour toute la room'
      : cap.next ? `N.${cap.level} · le plus fort Pokémon de ${cap.next}` : 'Ligue terminée : aucun plafond';
    // liens : un par lieu, avec le Pokémon de chaque joueur
    const groups = this.rules.groups();
    this.links.replaceChildren(...(groups.length ? groups.slice(0, 5).map(g => h('div.pl-link' + (g.dead ? '.dead' : ''), {},
      h('span.where', {}, this.places(g.loc)),
      h('span.mons', {}, ...g.members.map(x => h('span.m' + (x.dead ? '.ko' : ''), {}, h('img.pl-linkmon', { src: this.ui.monURL(x.mon.species) }), h('span', {}, h('b', {}, x.mon.name), h('small', {}, x.player.name))))),
      h('span.st', {}, g.dead ? 'Tombés' : 'En vie'))) : [h('p.empty', {}, s.soulLink ? 'Aucun lien pour l’instant : capturez des Pokémon aux mêmes endroits.' : 'Activez les Âmes liées pour lier vos Pokémon rencontrés aux mêmes endroits.')]));
  }
  nav(k) {
    const s = this.rules.state, row = this.visibleRows[this.r];
    if (k === 'UP') this.r = Math.max(0, this.r - 1);
    else if (k === 'DOWN') this.r = Math.min(this.visibleRows.length - 1, this.r + 1);
    else if (k === 'A' && row === 0) this.onChange({ soulLink: !s.soulLink });
    else if (k === 'A' && row === 1) this.onChange({ levelCap: !s.levelCap });
    else if (row === 2 && (k === 'LEFT' || k === 'RIGHT' || k === 'A')) this.onChange({ capMode: k === 'LEFT' ? 'auto' : k === 'RIGHT' ? 'manual' : s.capMode === 'manual' ? 'auto' : 'manual' });
    else if (row === 3 && (k === 'LEFT' || k === 'RIGHT')) this.onChange({ capValue: clamp(s.capValue + (k === 'LEFT' ? -1 : 1), 5, 99) });
    else if (k === 'B') { this.close(); return true; }
    this.refresh(); return true;
  }
}

// ---------------------------------------------------------------------------------------------
/** Réglages : son, vitesse du jeu et touches. Pensé pour la souris (tout est cliquable), Échap ferme. */
export class SettingsPanel extends Panel {
  constructor(ui, { turbo, onTurbo, capture }) {
    const tabs = h('div.pl-tabs', {}, h('span', {}, h('span', { html: icon('volume-2', 15) }), 'Son & vitesse'), h('span', {}, h('span', { html: icon('sparkles', 15) }), 'Image'), h('span', {}, h('span', { html: icon('keyboard', 15) }), 'Touches'));
    const body = h('div.pl-set-body');
    const el = h('div.pl-settings.glass', {},
      h('div.head', {}, h('span.hic', { html: icon('settings', 22) }),
        h('div', {}, h('h3', {}, 'Réglages'), h('small', {}, 'Gardés dans ce navigateur')), tabs),
      body,
      h('div.foot', {}, h('small.pl-set-msg'), h('span.pl-btn', {}, 'Fermer')));
    super(ui, el);
    Object.assign(this, { tabs, body, turbo, onTurbo, capture, tab: 0, waiting: null });
    this.msg = el.querySelector('.pl-set-msg');
    [...tabs.children].forEach((t, i) => tap(t, () => { this.tab = i; this.render(); }));
    tap(el.querySelector('.foot .pl-btn'), () => this.nav('B'));
    el.append(tap(h('span.pl-x', { title: 'Fermer', html: icon('x', 18) }), () => this.nav('B')));
    this.off = settings.on('change', () => this.render());
    this.render();
  }
  render() {
    if (this.closed) return;
    [...this.tabs.children].forEach((t, i) => t.classList.toggle('on', i === this.tab));
    this.body.replaceChildren(this.tab === 0 ? this.general() : this.tab === 1 ? this.video() : this.keys());
  }
  general() {
    const st = settings.state, vol = Math.round(st.volume * 100);
    const range = h('input.pl-range', { type: 'range', min: 0, max: 100, step: 1, value: vol, 'aria-label': 'Volume' });
    range.style.setProperty('--v', (st.muted ? 0 : vol) + '%');
    const pct = h('b.pl-pct', {}, st.muted ? 'Muet' : vol + ' %');
    range.addEventListener('input', () => {
      const v = +range.value;
      range.style.setProperty('--v', v + '%'); pct.textContent = v + ' %';
      settings.state.volume = v / 100; settings.state.muted = v === 0;
      clearTimeout(this.saveT); this.saveT = setTimeout(() => settings.save(), 150);
      this.ui.app.applySound?.();
    });
    const mute = tap(h('span.pl-iconbtn' + (st.muted ? '.on' : ''), { title: st.muted ? 'Remettre le son' : 'Couper le son', html: icon(st.muted ? 'volume-x' : 'volume-2', 18) }),
      () => settings.set({ muted: !st.muted, volume: st.volume || 0.6 }));
    const on = this.turbo();
    const sw = tap(h('span.pl-switch' + (on ? '.on' : ''), {}, h('i')), () => { this.onTurbo(!this.turbo()); this.render(); });
    const speeds = h('div.pl-seg.speeds', {}, SPEEDS.map(x => tap(h('span' + (st.turboSpeed === x ? '.on' : ''), {}, '×' + String(x).replace('.', ',')),
      () => { settings.set({ turboSpeed: x }); if (!this.turbo()) this.onTurbo(true); })));
    return h('div.rows', {},
      h('div.pl-rule', {}, h('span.ic', { html: icon(st.muted || !st.volume ? 'volume-x' : st.volume < 0.5 ? 'volume-1' : 'volume-2', 18) }),
        h('div.txt', {}, h('b', {}, 'Volume du jeu'), h('small', {}, 'Le son de l’émulateur, sur cet ordinateur seulement')),
        h('div.pl-vol', {}, range, pct, mute)),
      h('div.pl-rule', {}, h('span.ic', { html: icon('fast-forward', 18) }),
        h('div.txt', {}, h('b', {}, 'Accélérer le jeu'), h('small', {}, `Touche ${settings.label('turbo')} pour l’activer ou le couper en jeu. Tes amis ne sont pas accélérés.`)), sw),
      h('div.pl-rule.sub', {}, h('div.txt', {}, h('b', {}, 'Vitesse en accéléré'), h('small', {}, 'La vitesse réelle s’affiche sur le bouton en haut : si elle reste en dessous, ton ordinateur est à fond')), speeds),
      h('div.pl-rule.sub', {}, h('div.txt', {}, h('b', {}, 'Son pendant l’accélération'), h('small', {}, 'Coupé par défaut : le son accéléré grésille')),
        tap(h('span.pl-switch' + (st.turboSound ? '.on' : ''), {}, h('i')), () => settings.set({ turboSound: !st.turboSound }))),
      h('div.pl-tip', { html: icon('mouse-pointer-click', 16) + '<span>Astuce : tout se fait à la souris. Clique sur un ami dans le jeu (la bulle « Interagir ») ou sur les boutons à droite.</span>' }));
  }
  video() {
    const st = settings.state;
    const cards = h('div.pl-filters', {}, FILTERS.map(f => tap(h('div.pl-filter' + (st.filter === f.id ? '.on' : ''), {},
      h('div.pv.' + f.id), h('b', {}, f.label), h('small', {}, f.sub)), () => settings.set({ filter: f.id }))));
    const sw = (on, fn) => tap(h('span.pl-switch' + (on ? '.on' : ''), {}, h('i')), fn);
    return h('div.rows', {},
      h('div.pl-rule', {}, h('span.ic', { html: icon('sparkles', 18) }), h('div.txt', {}, h('b', {}, 'Rendu de l’image'), h('small', {}, 'S’applique tout de suite, aux deux écrans'))),
      cards,
      h('div.pl-rule', {}, h('span.ic', { html: icon('gauge', 18) }),
        h('div.txt', {}, h('b', {}, 'Mode économie'), h('small', {}, 'Dessine une image sur deux : à essayer si le son grésille ou si le jeu rame')),
        sw(st.eco, () => settings.set({ eco: !st.eco }))));
  }
  keys() {
    const col = (title, group) => h('div.pl-keycol', {}, h('h4', {}, title),
      ...ACTIONS.filter(a => a.group === group).map(a => {
        const waiting = this.waiting === a.id;
        return tap(h('div.pl-keyrow' + (waiting ? '.wait' : ''), {}, h('span', {}, a.label), h('span.pl-keycap', {}, waiting ? 'Appuie sur une touche…' : settings.label(a.id))),
          () => this.listen(a));
      }));
    return h('div.pl-keys2', {}, col('Console', 'ds'), col('PokéLink', 'pl'),
      h('div.pl-keyfoot', {}, h('small', {}, 'Clique sur une action, puis appuie sur la nouvelle touche. Échap pour annuler.'),
        tap(h('span.pl-btn', {}, h('span', { html: icon('rotate-ccw', 15) }), 'Touches par défaut'), () => { settings.resetKeys(); this.say('Touches remises par défaut'); })));
  }
  listen(a) {
    this.waiting = a.id; this.render();
    this.capture(code => {
      this.waiting = null;
      if (code === 'Escape') { this.render(); return; }
      const other = settings.bind(a.id, code);
      const o = other && ACTIONS.find(x => x.id === other);
      this.say(o ? `${keyName(code)} → ${a.label} · « ${o.label} » prend ${settings.label(o.id)}` : `${a.label} : ${keyName(code)}`);
      this.render();
    });
  }
  say(t) { this.msg.textContent = t; clearTimeout(this.msgT); this.msgT = setTimeout(() => (this.msg.textContent = ''), 4000); }
  nav(k) {
    if (k === 'B') { this.off?.(); this.close(); return true; }
    if (k === 'LEFT' || k === 'RIGHT') { this.tab = Math.max(0, Math.min(2, this.tab + (k === 'LEFT' ? -1 : 1))); this.render(); }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
/** Inviter un ami : le lien de la room, à copier ou partager. */
export class InvitePanel extends Panel {
  constructor(ui, { code, link }) {
    const field = h('input.pl-input.mono', { value: link, readonly: true, spellcheck: 'false', 'aria-label': 'Lien de la room' });
    const copy = h('span.pl-btn.primary', { style: { '--accent': 'var(--brand-a)' } }, h('span', { html: icon('copy', 16) }), h('span', {}, 'Copier le lien'));
    const share = navigator.share ? h('span.pl-btn', {}, h('span', { html: icon('share-2', 16) }), 'Partager…') : null;
    const el = h('div.pl-invite.glass', {},
      h('div.head', {}, h('span.hic', { html: icon('user-plus', 22) }), h('div', {}, h('h3', {}, 'Inviter un ami'), h('small', {}, 'Envoie-lui ce lien : il arrive directement dans ta room'))),
      h('div.pl-code', {}, ...code.split('').map(c => h('span', {}, c))),
      h('div.pl-linkrow', {}, field, copy),
      h('ol.pl-steps-txt', {},
        h('li', {}, 'Ton ami ouvre le lien.'),
        h('li', {}, 'Il charge sa ROM Pokémon Platine (et sa sauvegarde s’il en a une).'),
        h('li', {}, 'Il clique sur « Lancer la partie » : il apparaît dans ton jeu.')),
      h('div.foot', {}, share, tap(h('span.pl-btn', {}, 'Fermer'), () => this.nav('B'))));
    super(ui, el);
    Object.assign(this, { field, copy, link });
    tap(field, () => field.select());
    tap(copy, () => this.doCopy());
    if (share) tap(share, () => navigator.share({ title: 'Rejoins ma room PokéLink', text: `Rejoins ma room PokéLink (code ${code})`, url: link }).catch(() => {}));
    el.append(tap(h('span.pl-x', { title: 'Fermer', html: icon('x', 18) }), () => this.nav('B')));
  }
  async doCopy() {
    let ok = false;
    try { await navigator.clipboard.writeText(this.link); ok = true; } catch {
      this.field.select(); try { ok = document.execCommand('copy'); } catch {}
    }
    this.copy.replaceChildren(h('span', { html: icon(ok ? 'check' : 'copy', 16) }), h('span', {}, ok ? 'Lien copié !' : 'Copie le lien ci-contre'));
    this.copy.classList.toggle('done', ok);
    clearTimeout(this.t); this.t = setTimeout(() => !this.closed && this.copy.replaceChildren(h('span', { html: icon('copy', 16) }), h('span', {}, 'Copier le lien')), 2500);
  }
  nav(k) { if (k === 'B') this.close(); else if (k === 'A') this.doCopy(); return true; }
}

// ---------------------------------------------------------------------------------------------
/** L'équipe d'un ami : six cartes avec sprite, niveau, types, PV, objet, talent et attaques. */
export class TeamPanel extends Panel {
  constructor(ui, { peer, gd, onTrade, onBattle }) {
    const team = peer.team || [], T = gd.text;
    const nice = x => x && x === x.toUpperCase() ? x.charAt(0) + x.slice(1).toLowerCase() : x;
    const typeChip = t => h('span.pl-type', { style: { '--t': TYPE_COLORS[t] || '#888' } }, T.types?.[t] || '?');
    const card = m => {
      const sp = gd.species(m.species), types = [...new Set(sp.types)];
      const pct = m.maxhp ? Math.max(0, Math.min(1, m.hp / m.maxhp)) : 1;
      const g = m.gender === 'M' ? h('span.g.m', {}, '♂') : m.gender === 'F' ? h('span.g.f', {}, '♀') : null;
      const moves = (m.moves || []).map(n => { const mv = gd.move(n); return h('span.pl-mv', { style: { '--t': TYPE_COLORS[mv.type] || '#888' } }, mv.name); });
      return h('div.pl-tcard' + (m.hp === 0 ? '.ko' : ''), {},
        h('div.top', {}, h('div.spr', {}, ui.mon(m.species), m.shiny ? h('span.shiny', { title: 'Chromatique' }, '✦') : null),
          h('div.id', {}, h('b', {}, nice(m.name), g), h('small', {}, (sp.name && sp.name.toLowerCase() !== String(m.name).toLowerCase() ? nice(sp.name) + ' · ' : '') + 'Nv. ' + m.level), h('div.types', {}, types.map(typeChip)))),
        h('div.hp', {}, h('i', { style: { width: (pct * 100).toFixed(0) + '%', background: pct > 0.5 ? '#34d399' : pct > 0.2 ? '#fbbf24' : '#f87171' } }), h('small', {}, m.maxhp ? `${m.hp}/${m.maxhp} PV` : '')),
        h('div.info', {}, m.item ? h('span', { title: 'Objet tenu', html: icon('package', 12) + (T.items?.[m.item] || 'Objet') }) : h('span.none', {}, 'Aucun objet'),
          m.ability ? h('span', { title: 'Talent', html: icon('sparkles', 12) + (T.abilities?.[m.ability] || '') }) : null),
        h('div.moves', {}, moves.length ? moves : h('small', {}, 'Attaques inconnues')));
    };
    const el = h('div.pl-teampanel.glass', {},
      h('div.head', {}, ui.portrait(peer.profile, 44),
        h('div', {}, h('h3', {}, `Équipe de ${peer.profile.name}`), h('small', {}, team.length ? `${team.length} Pokémon · niveau moyen ${Math.round(team.reduce((a, m) => a + m.level, 0) / team.length)}` : 'Équipe pas encore reçue'))),
      h('div.pl-tgrid', {}, team.map(card)),
      h('div.foot', {},
        tap(h('span.pl-btn', { style: { '--accent': 'var(--c-trade)' } }, h('span', { html: icon('arrow-left-right', 15) }), 'Proposer un échange'), () => { this.close(); onTrade(); }),
        tap(h('span.pl-btn', { style: { '--accent': 'var(--c-battle)' } }, h('span', { html: icon('swords', 15) }), 'Défier en combat'), () => { this.close(); onBattle(); }),
        h('span.pl-spacer'),
        tap(h('span.pl-btn', {}, keycap('B'), 'Fermer'), () => this.close())));
    super(ui, el);
    el.append(tap(h('span.pl-x', { title: 'Fermer', html: icon('x', 18) }), () => this.close()));
  }
  nav(k) { if (k === 'B' || k === 'A') this.close(); return true; }
}

// ---------------------------------------------------------------------------------------------
/** Exporter sa sauvegarde : rappelle qu'il faut d'abord sauvegarder DANS LE JEU, puis télécharge le .sav. */
export class SavePanel extends Panel {
  constructor(ui, { quit, savedAt, startKey, onDownload }) {
    const status = h('div.pl-savestate');
    const dl = h('span.pl-btn.primary', { style: { '--accent': '#10b981' } }, h('span', { html: icon('download', 16) }), h('span.lbl'));
    const el = h('div.pl-savepanel.glass', {},
      h('div.head', {}, h('span.hic', { html: icon('download', 22) }),
        h('div', {}, h('h3', {}, quit ? 'Sauvegarder et quitter' : 'Exporter ta sauvegarde'), h('small', {}, 'Ton fichier .sav, à garder ou à charger sur un autre émulateur'))),
      h('div.pl-warn', { html: icon('triangle-alert', 20) + `<div><b>Sauvegarde d’abord DANS LE JEU, puis exporte.</b><span>Le fichier .sav ne contient que ce que le jeu a enregistré : tout ce que tu as fait depuis ta dernière sauvegarde dans le jeu n’y sera pas.</span></div>` }),
      h('ol.pl-savesteps', {},
        h('li', {}, h('b', {}, 'Dans le jeu : '), `ouvre le menu (touche ${startKey}), choisis `, h('b', {}, 'SAUVER'), ', puis ', h('b', {}, 'OUI'), '.'),
        h('li', {}, 'Attends le message ', h('i', {}, '« … a sauvegardé la partie. »')),
        h('li', {}, 'Reviens ici et clique sur ', h('b', {}, quit ? 'Télécharger et quitter' : 'Télécharger'), '.')),
      status,
      h('div.foot', {}, tap(h('span.pl-btn', {}, h('span', { html: icon('chevron-left', 15) }), 'Retour au jeu pour sauvegarder'), () => this.close()), h('span.pl-spacer'), dl));
    super(ui, el);
    Object.assign(this, { status, dl, quit, savedAt });
    tap(dl, () => { this.close(); onDownload(); });
    el.append(tap(h('span.pl-x', { title: 'Fermer', html: icon('x', 18) }), () => this.close()));
    this.render(); this.t = setInterval(() => this.closed ? clearInterval(this.t) : this.render(), 1000);
  }
  render() {
    const at = this.savedAt?.(), ago = at ? Math.round((Date.now() - at) / 60000) : null;
    this.status.className = 'pl-savestate ' + (at ? 'ok' : 'no');
    this.status.innerHTML = at
      ? icon('check', 16) + `<span>Sauvegardé dans le jeu ${ago < 1 ? 'à l’instant' : `il y a ${ago} min`} : ton fichier sera à jour.</span>`
      : icon('circle-alert', 16) + '<span>Tu n’as pas encore sauvegardé dans le jeu depuis le lancement : le fichier sera celui du début de la session.</span>';
    this.dl.querySelector('.lbl').textContent = (at ? 'Télécharger' : 'Télécharger quand même') + (this.quit ? ' et quitter' : '');
  }
  nav(k) { if (k === 'B') this.close(); return true; }
}
