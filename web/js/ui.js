// Composants d'interface « glass ». Chaque panneau est une couche de focus : quand il est ouvert,
// il reçoit les touches (D-pad, A, B) et le jeu n'en reçoit aucune.
// Images : toujours via ui.portrait / ui.mon / ui.trainer (vignettes carrées déjà centrées sur leurs pixels).
import { h, ease, setTO, clamp } from './core.js';
import { icon } from './icons.js';
import { COLOR_SLOTS } from './rom.js';

const KIND = {
  battle: { label: 'Combattre', sub: 'Défier en combat', accent: 'var(--c-battle)', icon: 'swords' },
  trade: { label: 'Échanger', sub: 'Proposer un échange', accent: 'var(--c-trade)', icon: 'arrow-left-right' },
  duo: { label: 'Faire équipe', sub: 'Combats en duo, 2 contre 2', accent: 'var(--c-duo)', icon: 'users' },
  team: { label: 'Voir son équipe', sub: 'Pokémon et niveaux', accent: 'var(--c-team)', icon: 'eye' },
  react: { label: 'Réagir', sub: 'Envoyer une émote', accent: 'var(--c-react)', icon: 'smile' },
};
export const EMOTES = ['heart', 'music', 'laugh', 'thumbs-up', 'zap', 'circle-help'];
export const SWATCHES = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
export const keycap = k => h('span.kc' + (k.length === 1 ? '.a' : ''), {}, k);
const hint = (k, text) => h('span', {}, keycap(k), text);
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
        h('div', {}, h('div.t', {}, peer.profile.name), h('small', { html: icon('map-pin', 12) + ui.app.placeName(peer.map) + ' · à 1 pas' }))),
      list, emotes,
      h('div.pl-hints', {}, hint('A', 'Choisir'), hint('B', 'Fermer')));
    super(ui, el);
    Object.assign(this, { peer, items, list, emotes, onPick, onEmote, onClose, sel: 0, mode: 'list', esel: 0 });
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
      this.refresh(); return true;
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
  out: { battle: 'Défi envoyé', trade: "Demande d'échange envoyée", duo: 'Demande de duo envoyée' },
  in: { battle: n => `${n} te défie en combat !`, trade: n => `${n} te propose un échange`, duo: n => `${n} veut faire équipe` },
  chips: { battle: ['3 contre 3', 'Règles de la room'], trade: ['Échange direct', 'Sauvegarde conseillée après'], duo: ['Combats 2 contre 2', 'Pokémon de chacun'] },
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
      ? h('div.acts', {}, h('span.pl-btn.primary', { style: { '--accent': k.accent } }, keycap('A'), 'Accepter'), h('span.pl-btn', {}, keycap('B'), 'Refuser'))
      : h('div.acts', {}, h('span.pl-btn', {}, keycap('B'), 'Annuler'));
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
    this.sub.textContent = accepted ? ({ trade: "Ouverture de la fenêtre d'échange…", battle: 'Préparation du combat…', duo: 'Duo activé' })[this.kind] : 'Une autre fois peut-être !';
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
    this.refresh();
  }
  open() {
    this.ui.layer.append(this.bg);
    this.ui.anim.tween({ from: { o: 0 }, to: { o: 1 }, dur: 220, apply: v => (this.bg.style.opacity = v.o) });
    return super.open({ from: { s: 0.94, o: 0, y: 12 }, dur: 300 });
  }
  close() { this.ui.anim.tween({ from: { o: 1 }, to: { o: 0 }, dur: 200, apply: v => (this.bg.style.opacity = v.o), done: () => this.bg.remove() }); return super.close(200); }
  remote(ev) {
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
        h('div.foot', {}, h('div.pl-note', { html: icon('sparkles', 14) + '<span>Visible tout de suite par tes amis, et sur ton écran au prochain changement de zone</span>' }), acts)),
      h('div.pl-form', {},
        h('h3', { html: icon('palette', 20) + ' Mon personnage' }),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 172px', gap: '4px' } }, nameRow, baseRow),
        colorRows, buddyRow));
    super(ui, el);
    Object.assign(this, { draft, cv, nm, input, seg, buddies, save, cancel, team, onSave, onCancel, r: 0, cols: {}, colorRows, act: 1 });
    this.fixed = { name: { id: 'name', el: nameRow }, base: { id: 'base', el: baseRow }, buddy: { id: 'buddy', el: buddyRow }, actions: { id: 'actions', el: acts } };
    this.ctx = cv.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    this.buildColorRows();
    this.refresh();
  }
  buildColorRows() {
    const rows = COLOR_SLOTS[this.draft.base].map(s => {
      const sw = [h('i', { style: { background: this.ui.slotOriginal(this.draft.base, s) }, title: 'Origine' }), ...SWATCHES.map(c => h('i', { style: { background: c } })), h('i.custom')];
      const cur = this.draft.colors?.[s.id];
      this.cols[s.id] = cur ? Math.max(0, SWATCHES.indexOf(cur) + 1) : 0;
      return { id: 'color:' + s.id, el: h('div.pl-row', {}, h('label', {}, s.label), h('div.pl-swatches', {}, sw)), slot: s, sw };
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
    else if (row.id === 'base' && (k === 'LEFT' || k === 'RIGHT')) {
      const base = k === 'LEFT' ? 'lucas' : 'aurore';
      if (base !== this.draft.base) { this.draft.base = base; this.draft.colors = {}; this.buildColorRows(); }
    } else if (row.slot && (k === 'LEFT' || k === 'RIGHT')) {
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
