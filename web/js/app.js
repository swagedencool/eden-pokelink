// PokéLink — orchestration : jeu ↔ overlay ↔ interface ↔ réseau.
import { Animator, h, ease, setTO } from './core.js';
import { DIRS } from './projection.js';
import { SpriteLibrary, DIR_BASE } from './sprites.js';
import { COLOR_SLOTS, writePalette } from './rom.js';
import { RemotePlayer, Follower } from './world.js';
import { Overlay } from './overlay.js';
import { InputRouter } from './input.js';
import { icon } from './icons.js';
import { InteractionMenu, RequestCard, TradePanel, VersusCard, ProfilePanel, RulesPanel, Toasts, keycap } from './ui.js';
import { RoomRules } from './rules.js';
import { BattleView } from './battle-ui.js';
import { decodeParty, toBattleSet, withPartyHP, boxToParty, PARTY } from './pk4.js';

const DEFAULT_ACCENT = { lucas: '#e8384f', aurore: '#ec4899' };
const accentOf = p => p.colors?.coat || p.colors?.hat || DEFAULT_ACCENT[p.base] || '#a78bfa';

/** Racine de l'interface : pile de focus + fabriques d'images (toujours des carrés centrés sur les pixels visibles). */
export class UIRoot {
  constructor(app, layer) {
    this.app = app; this.layer = layer; this.anim = app.anim; this.lib = app.lib; this.stack = [];
    this.toasts = new Toasts(this);
  }
  open(panel, opts) { this.stack.push(panel); this.app.input?.releaseAll(); panel.open(opts); return panel; }
  drop(panel) { this.stack = this.stack.filter(p => p !== panel); }
  get active() { return this.stack.length > 0; }
  top() { return this.stack[this.stack.length - 1]; }
  nav(k) { this.top()?.nav(k); }
  update(now) { for (const p of this.stack) p.update?.(now); }
  avatarSheet(p) { return this.lib.avatar(p.base, p.colors); }
  portraitURL(p, size = 44) { return this.lib.portraitURL(this.avatarSheet(p), DIR_BASE[1], size, size >= 40 ? 2 : 1); }
  portrait(p, size = 44) { return h('div.thumb', { style: { width: size + 'px', height: size + 'px' } }, h('img', { src: this.portraitURL(p, size) })); }
  monURL(species) { return this.lib.fitURL(this.lib.icon(species), 0, 64, { maxScale: 2, frames: [0, 1] }); }
  mon(species) { return h('div.cell64', {}, h('img', { src: this.monURL(species) })); }
  thumbMon(species, size = 32) { return h('div.thumb', { style: { width: size + 'px', height: size + 'px' } }, h('img', { src: this.lib.fitURL(this.lib.icon(species), 0, size, { maxScale: 1, frames: [0, 1] }) })); }
  trainerURL(p, dir = 1) { return this.lib.fitURL(this.avatarSheet(p), DIR_BASE[dir], 160, { maxScale: 5 }); }
  monCardChildren(m) {
    const g = m.gender === 'M' || m.gender === 0 ? '♂' : m.gender === 'F' || m.gender === 1 ? '♀' : '';
    return [this.mon(m.species), h('div.n', {}, m.name), h('div.l', {}, `Nv. ${m.level} ${g}`.trim()),
      h('div.hp', {}, h('i', { style: { width: Math.round((100 * (m.hp ?? 1)) / (m.maxhp || 1)) + '%' } }))];
  }
  slotOriginal(base, slot) {
    const pal = this.app.assets.avatars[base].palette, mid = pal[slot.idx[Math.floor(slot.idx.length / 2)]];
    return `rgb(${mid.join(',')})`;
  }
}

export class PokeLinkApp {
  /**
   * root : conteneur DOM · assets : extraits de la ROM · game : adaptateur émulateur
   * net : client de room (WebSocket ou simulation) · profile : { name, base, colors, buddy }
   */
  constructor({ root, assets, gd, game, net, profile, team, room, places = {}, bosses }) {
    Object.assign(this, { root, assets, gd, game, net, room, places });
    if (!team && game.readPartyRaw) team = decodeParty(game.readPartyRaw(), gd);
    this.anim = new Animator();
    this.lib = new SpriteLibrary(assets);
    this.me = { id: net.id, profile: { ...profile }, team, follower: new Follower(profile.buddy || team[0]?.species), last: null, speed: 0 };
    this.peers = new Map();
    this.requests = new Map();
    this.duo = new Set();
    this.lastSent = 0; this.frame = 0; this.perf = { n: 0, ms: 0, max: 0 };
    this.buildDom();
    this.input = new InputRouter(window);
    this.ui = new UIRoot(this, this.uiLayer);
    this.overlay = new Overlay({ canvas: this.ovCanvas, dom: this.domLayer, lib: this.lib, scale: 3 });
    this.rules = new RoomRules(this, { bosses });
    this.onRulesChanged();
    this.wireInput();
    this.wireNet();
    net.send('hello', { profile: this.me.profile, team: this.teamSummary() });
  }

  // ---------------------------------------------------------------- DOM
  buildDom() {
    const top = this.game.topCanvas, bottom = this.game.bottomCanvas;
    top.className = 'px';
    this.ovCanvas = h('canvas.px', { width: 256, height: 192 });
    this.domLayer = h('div.pl-layer');
    this.uiLayer = h('div.pl-layer');
    this.ambient = h('canvas', { width: 32, height: 24 });
    this.playersEl = h('div.pl-players');
    this.duoChip = h('span.pl-chip.duo', { style: { display: 'none' } });
    this.pingEl = h('span', {}, '—');
    this.rulesChip = h('span.pl-chip.rules');
    this.countEl = h('b', {}, '1');
    const key = (k, t) => h('span.pl-key', {}, h('kbd', {}, k), t);
    this.stage = h('div.pl-stage', {},
      h('div.pl-ambient', {}, this.ambient), h('div.pl-grain'),
      h('header.pl-header', {},
        h('div.pl-brand', {}, h('div.logo', { html: icon('link-2', 17) }), 'PokéLink', h('small', {}, 'Platine')),
        h('span.pl-chip', {}, 'ROOM', h('b', {}, this.room)),
        h('span.pl-chip', {}, h('i.pl-dot'), this.countEl, ' joueurs'),
        this.duoChip, this.rulesChip, h('span.pl-spacer'),
        h('span.pl-chip', { html: icon('wifi', 15) }, this.pingEl)),
      h('section.pl-game', {}, top, this.ovCanvas, this.domLayer, this.uiLayer),
      h('aside.pl-side', {},
        h('div.pl-bottom.glass-light', {}, bottom),
        h('div.pl-room.glass-light', {}, h('h4', { html: icon('users', 14) + ' Dans la room' }), this.playersEl,
          h('div.pl-keys', {}, key('X', 'Interagir'), key('P', 'Pokémon'), key('C', 'Profil'), key('E', 'Émote')))));
    bottom.className = '';
    this.root.append(this.stage);
  }

  // ---------------------------------------------------------------- entrées
  wireInput() {
    const inp = this.input;
    inp.uiActive = () => this.ui.active;
    inp.facing = () => this.me.last?.face ?? 1;
    inp.isBlocked = dir => {
      const s = this.me.last; if (!s) return false;
      const [dx, dz] = DIRS[dir], tx = s.tx + dx, tz = s.tz + dz;
      for (const p of this.peers.values()) if (p.map === s.map && p.tx === tx && p.tz === tz) return true;
      return false;
    };
    inp.on('nav', k => this.ui.nav(k));
    inp.on('a-press', () => { if (this.promptPeer) { inp.consumeA(); this.openMenu(this.promptPeer); } });
    inp.on('hotkey', k => {
      if (k === 'follower') this.toggleFollower();
      if (k === 'profile') this.openProfile();
      if (k === 'emote') this.sendEmote('heart');
      if (k === 'rules') this.openRules();
    });
  }

  // ---------------------------------------------------------------- réseau
  wireNet() {
    const n = this.net, now = () => this.anim.now;
    const peer = (id, profile) => {
      if (!this.peers.has(id)) { this.peers.set(id, new RemotePlayer(id, profile || { name: 'Dresseur', base: 'lucas', colors: {} })); this.refreshSide(true); }
      return this.peers.get(id);
    };
    n.on('hello', m => { const p = peer(m.from, m.profile); p.profile = m.profile; p.team = m.team; this.net.send('profile', { profile: this.me.profile, team: this.teamSummary() }); if (this.me.follower.out) this.sendFollower(true, true); });
    n.on('profile', m => this.onProfile(peer(m.from), m));
    n.on('state', m => peer(m.from).push(now(), m));
    n.on('leave', m => { this.peers.delete(m.from); this.rules.forget(m.from); this.refreshSide(true); });
    n.on('rules', m => this.rules.receive(m));
    n.on('soul', m => this.rules.peerSoul(m.from, m));
    n.on('run-config', m => this.rules.fromRun(m.run));
    n.on('follower', m => {
      const p = peer(m.from);
      if (!m.out) return p.follower?.recall(now());
      p.follower = new Follower(m.species);
      // déjà sorti quand on rejoint la room : pas d'animation, il apparaît derrière son dresseur
      if (m.instant || !p.leader) p.follower.pending = true; else p.follower.spawn(now(), p.leader);
    });
    n.on('emote', m => this.overlay.bubble(m.from, m.kind, now()));
    n.on('req', m => this.onRequest(peer(m.from), m));
    n.on('res', m => this.onResponse(m));
    n.on('trade', m => {
      if (this.trade?.rid !== m.rid) return;
      if (m.action === 'data') this.trade.incoming = Uint8Array.from(atob(m.raw), c => c.charCodeAt(0));
      else this.trade.panel.remote(m);
    });
    n.on('battle', m => this.onBattle(m));
    n.on('ping', m => (this.pingEl.textContent = m.ms + ' ms'));
  }
  teamSummary() { return this.me.team.map(({ species, name, level, gender, hp, maxhp }) => ({ species, name, level, gender, hp, maxhp })); }

  onProfile(p, m) {
    const old = p.profile;
    p.profile = m.profile; if (m.team) p.team = m.team;
    const changedLook = old && (old.base !== m.profile.base || JSON.stringify(old.colors) !== JSON.stringify(m.profile.colors));
    if (old && old.name !== m.profile.name) this.ui.toasts.show({ profile: m.profile, title: `${old.name} s'appelle désormais ${m.profile.name}`, sub: 'Nom mis à jour pour toute la room' });
    else if (changedLook) this.ui.toasts.show({ profile: m.profile, title: `${m.profile.name} a changé de tenue`, dur: 1800 });
    if (changedLook || (old && old.name !== m.profile.name)) this.overlay.sparkle(p.id, this.anim.now);
    this.refreshSide(true);
  }

  // ---------------------------------------------------------------- flux d'interaction
  openMenu(peer) {
    const menu = new InteractionMenu(this.ui, peer, {
      onPick: (kind, m) => {
        if (kind === 'team') return this.showTeam(peer, m);
        m.close(); this.sendRequest(kind, peer);
      },
      onEmote: kind => this.sendEmote(kind),
    });
    this.ui.open(menu, { from: { s: 0.9, o: 0, y: 6 }, dur: 260 });
  }
  sendRequest(kind, peer) {
    const rid = `${this.me.id}-${++this.frame}-${kind}`;
    const card = new RequestCard(this.ui, { dir: 'out', kind, peer, onCancel: () => { this.requests.delete(rid); this.net.send('res', { rid, cancel: true, to: peer.id }); } });
    this.requests.set(rid, { kind, peer, card, dir: 'out' });
    this.ui.open(card, { from: { s: 0.96, o: 0, y: -14 } });
    this.net.send('req', { rid, kind, to: peer.id });
  }
  onRequest(peer, m) {
    if (this.requests.has(m.rid)) return;
    const card = new RequestCard(this.ui, {
      dir: 'in', kind: m.kind, peer,
      onAccept: () => { this.net.send('res', { rid: m.rid, accept: true, to: peer.id }); this.startFlow(m.kind, peer, m.rid); },
      onDecline: () => this.net.send('res', { rid: m.rid, accept: false, to: peer.id }),
    });
    this.requests.set(m.rid, { kind: m.kind, peer, card, dir: 'in' });
    this.ui.open(card, { from: { s: 0.96, o: 0, y: -14 } });
  }
  async onResponse(m) {
    const r = this.requests.get(m.rid);
    if (r && r.dir === 'in' && m.cancel) { r.card.settled = true; r.card.close(); this.requests.delete(m.rid); return; }
    if (!r || r.dir !== 'out') return;
    r.card.resolve(!!m.accept);
    this.busy = true;
    await this.anim.wait(m.accept ? 750 : 1300);
    if (m.accept) this.startFlow(r.kind, r.peer, m.rid); // la fenêtre suivante s'ouvre pendant que la carte se ferme
    await r.card.close();
    this.requests.delete(m.rid);
    this.busy = false;
  }
  startFlow(kind, peer, rid) {
    if (kind === 'trade') return this.openTrade(peer, rid);
    if (kind === 'battle') return this.openBattle(peer, rid);
    if (kind === 'duo') {
      this.duo.add(peer.id);
      this.duoChip.style.display = ''; this.duoChip.innerHTML = icon('users', 14) + ` Duo avec ${peer.profile.name}`;
      this.game.setPartner?.(peer);
      this.ui.toasts.show({ ic: 'users', accent: 'var(--c-duo)', title: `Duo activé avec ${peer.profile.name}`, sub: 'Vos combats se jouent à 2 contre 2' });
    }
  }
  openTrade(peer, rid) {
    const panel = new TradePanel(this.ui, {
      peer, mine: this.me.team.map(m => ({ ...m })), theirs: (peer.team || []).map(m => ({ ...m })),
      onPick: (slot, what) => this.net.send('trade', { rid, to: peer.id, action: what === 'cursor' ? 'cursor' : slot === null ? 'unpick' : 'pick', slot }),
      onConfirm: () => {
        // les données du Pokémon (format de boîte, 136 octets) partent vers l'ami au moment de la confirmation
        const mon = this.me.team[panel.pick];
        const raw = this.game.readPartyRaw?.().subarray(4 + mon.slot * PARTY.size, 4 + mon.slot * PARTY.size + 136);
        if (raw) this.net.send('trade', { rid, to: peer.id, action: 'data', raw: btoa(String.fromCharCode(...raw)) });
        this.net.send('trade', { rid, to: peer.id, action: 'confirm' });
      },
      onCancel: () => { this.net.send('trade', { rid, to: peer.id, action: 'cancel' }); this.trade = null; },
    });
    panel.onDone = mon => {
      const given = this.me.team[panel.pick], incoming = this.trade?.incoming;
      this.trade = null;
      if (incoming && this.game.writePartyMon) {
        this.game.writePartyMon(given.slot, boxToParty(incoming, this.gd)); // le Pokémon reçu prend la place dans l'équipe du jeu
        this.refreshTeam();
      }
      this.ui.toasts.show({ species: mon.species, accent: 'var(--c-trade)', title: `${mon.name} a rejoint ton équipe !`, sub: `Échange terminé avec ${peer.profile.name} · enregistré dans ta partie` });
      this.refreshSide(true);
    };
    this.trade = { rid, panel };
    this.ui.open(panel);
  }
  refreshTeam() {
    if (this.game.readPartyRaw) this.me.team = decodeParty(this.game.readPartyRaw(), this.gd);
    this.net.send('profile', { profile: this.me.profile, team: this.teamSummary() });
  }
  /** Combat 3 contre 3 : les 3 premiers Pokémon de chaque équipe, simulés par le serveur. */
  async openBattle(peer, rid) {
    const mine = this.me.team.slice(0, 3), theirs = (peer.team || []).slice(0, 3);
    const vs = new VersusCard(this.ui, { me: this.me.profile, peer: peer.profile, myTeam: mine, theirTeam: theirs, rules: ['3 contre 3', 'K.O. = perdu (Nuzlocke)', 'Simple'] });
    this.ui.open(vs);
    this.battle = { rid, peer, vs, mine, pending: [] };
    this.net.send('battle-team', { rid, name: this.me.profile.name, team: mine.map(toBattleSet), opponent: peer.id, seed: this.battleSeed });
    await this.anim.wait(1500);
    vs.ready('Équipes prêtes · le combat commence');
    await this.anim.wait(1100);
    this.battle.ready = true;
    this.flushBattle();
  }
  onBattle(m) {
    const b = this.battle;
    if (!b || m.rid !== b.rid) return;
    b.pending.push(m);
    this.flushBattle();
  }
  flushBattle() {
    const b = this.battle;
    if (!b?.ready) return;
    for (const m of b.pending.splice(0)) {
      if (m.ev === 'start') {
        b.vs.close();
        b.view = new BattleView(this.ui, { gd: this.gd, side: m.side, names: m.names, me: this.me.profile, peer: b.peer.profile, myTeam: b.mine,
          onChoice: choice => this.net.send('battle-choice', { rid: b.rid, choice }) });
        b.view.onEnd = end => this.applyBattleResult(end);
        this.ui.open(b.view);
      } else if (m.ev === 'log') b.view?.log(m.lines);
      else if (m.ev === 'request') b.view?.request(m.request);
      else if (m.ev === 'end') b.view?.end(m);
    }
  }
  /** Règles de la room (Nuzlocke) : les PV restants et les K.O. sont réécrits dans l'équipe du jeu. */
  applyBattleResult(end) {
    const lines = [];
    for (const r of end.team || []) {
      const name = r.ident.split(': ')[1], mon = this.me.team.find(m => m.name.slice(0, 18) === name);
      if (!mon || !this.game.writePartyMon) continue;
      const raw = this.game.readPartyRaw().subarray(4 + mon.slot * PARTY.size, 4 + (mon.slot + 1) * PARTY.size);
      this.game.writePartyMon(mon.slot, withPartyHP(raw, Math.max(0, r.hp), r.fainted ? 0 : undefined));
      lines.push(r.fainted ? `${name} K.O.` : `${name} ${r.hp}/${r.maxhp} PV`);
    }
    this.battle = null;
    this.refreshTeam();
    const win = end.won ?? end.winner === this.me.profile.name;
    this.ui.toasts.show({ ic: win ? 'crown' : 'shield', accent: win ? '#fbbf24' : 'var(--c-battle)', title: win ? 'Victoire enregistrée dans ta partie' : 'Défaite enregistrée dans ta partie', sub: lines.join(' · '), dur: 4200 });
  }
  showTeam(peer, menu) {
    menu.close();
    const team = peer.team || [];
    this.ui.toasts.show({ ic: 'eye', accent: 'var(--c-team)', title: `Équipe de ${peer.profile.name}`, sub: team.map(m => `${m.name} Nv.${m.level}`).join(' · '), dur: 3600 });
  }
  sendEmote(kind) { this.net.send('emote', { kind }); this.overlay.bubble('me', kind, this.anim.now); }

  toggleFollower() {
    const f = this.me.follower, s = this.me.leader;
    if (!s || this.ui.active) return;
    const mon = this.me.team.find(m => m.species === f.species) || this.me.team[0];
    if (f.out && f.fx?.kind !== 'recall') {
      f.recall(this.anim.now);
      this.ui.toasts.show({ species: mon.species, title: `${mon.name}, reviens !`, dur: 1500 });
    } else {
      f.species = this.me.profile.buddy || mon.species;
      f.spawn(this.anim.now, s);
      const m = this.me.team.find(x => x.species === f.species) || mon;
      this.ui.toasts.show({ species: m.species, accent: '#f97316', title: `${m.name} te suit !`, sub: 'Appuie sur P pour le faire rentrer', dur: 2200 });
    }
    this.sendFollower(f.fx?.kind !== 'recall');
  }
  sendFollower(out = this.me.follower.out, instant = false) { this.net.send('follower', { out, species: this.me.follower.species, instant }); }

  openRules() {
    if (this.ui.active) return;
    const panel = new RulesPanel(this.ui, { rules: this.rules, places: loc => this.gd?.text.places[loc] || `Lieu ${loc}`, onChange: patch => this.rules.set(patch) });
    this.ui.open(panel, { from: { s: 0.92, o: 0, y: 14 }, dur: 300 });
    this.rulesPanel = panel;
  }
  /** Règles modifiées (par moi ou un ami) : puce de l'en-tête et panneau ouvert mis à jour. */
  onRulesChanged() {
    const st = this.rules.state, cap = this.rules.cap, on = st.soulLink || !!cap;
    const parts = [st.soulLink ? 'Âmes liées' : null, cap ? `N.${cap.level}` : null].filter(Boolean);
    this.rulesChip.classList.toggle('on', on);
    this.rulesChip.replaceChildren(keycap('R'), on ? parts.join(' · ') : 'Règles');
    if (this.rulesPanel && !this.rulesPanel.closed) this.rulesPanel.refresh();
  }

  openProfile() {
    if (this.ui.active) return;
    const panel = new ProfilePanel(this.ui, {
      profile: this.me.profile, team: this.me.team,
      onSave: draft => this.applyProfile(draft),
    });
    this.ui.open(panel, { from: { s: 0.92, o: 0, y: 14 }, dur: 300 });
    this.profilePanel = panel;
  }
  applyProfile(draft) {
    const before = this.me.profile;
    this.me.profile = { ...draft, colors: Object.fromEntries(Object.entries(draft.colors || {}).filter(([, v]) => v)) };
    this.net.send('profile', { profile: this.me.profile, team: this.teamSummary() });
    // Son propre personnage : on réécrit sa palette dans la ROM chargée ; le jeu la relit au prochain chargement de zone.
    const a = this.assets.avatars[this.me.profile.base];
    if (a && this.me.profile.base === this.game.playerBase) {
      const pal = this.lib.avatarPalette(this.me.profile.base, this.me.profile.colors);
      this.game.patchRom(a.paletteRomOffset, pal, writePalette);
    }
    if (this.me.follower.out && draft.buddy !== before.buddy) { this.me.follower.species = draft.buddy; this.sendFollower(true); }
    this.ui.toasts.show({ profile: this.me.profile, title: 'Profil enregistré', sub: 'Tes amis te voient déjà ainsi · ton écran suit au prochain changement de zone', dur: 3200 });
    this.refreshSide(true);
  }

  // ---------------------------------------------------------------- boucle
  /** Appelée une fois par frame affichée. now en ms. */
  update(now) {
    const t0 = performance.now();
    this.anim.now = now;
    const s = this.game.state();
    if (s) {
      const l = this.me.last;
      const d = l && l.map === s.map ? Math.abs(s.x - l.x) + Math.abs(s.z - l.z) : 0;
      const dt = l ? now - this.me.lastT : 16.7;
      this.me.speed = d > 0.01 ? d / Math.max(dt, 1) : 0;
      this.me.last = s; this.me.lastT = now;
      this.me.leader = { ...s, speed: this.me.speed };
      if (now - this.lastSent > 66) { this.net.send('state', { map: s.map, x: s.x, y: s.y, z: s.z, face: s.face, tx: s.tx, tz: s.tz }); this.lastSent = now; }
    }
    for (const p of this.peers.values()) {
      p.update(now);
      const f = p.follower;
      if (f?.pending && p.leader) { f.placeBehind(p.leader); f.out = true; f.pending = false; }
      f?.update(now, p.leader);
    }
    this.me.follower.update(now, this.me.leader);

    // invite : un ami se trouve sur la case devant soi
    this.promptPeer = null;
    if (s && !s.fade && s.field !== false && !this.ui.active && !this.busy && !this.requests.size) {
      const [dx, dz] = DIRS[s.face];
      for (const p of this.peers.values()) if (p.map === s.map && p.tx === s.tx + dx && p.tz === s.tz + dz && !p.moving) this.promptPeer = p;
    }
    this.anim.update(now);
    this.ui.update(now);
    if (s) this.render(now, s);
    else if (this.overlay._vis !== 0) { this.overlay._vis = 0; this.ovCanvas.style.opacity = 0; this.domLayer.style.opacity = 0; } // transition : rien à afficher
    if (++this.frame % 8 === 0) this.refreshSide();
    if (this.frame % 20 === 0) this.rules.tick();
    if (this.frame % 6 === 0) this.updateAmbient();
    const dt = performance.now() - t0;
    this.perf.n++; this.perf.ms += dt; this.perf.max = Math.max(this.perf.max, dt);
  }
  render(now, s) {
    const items = [];
    for (const p of this.peers.values()) {
      if (!p.pos) continue;
      items.push({ id: p.id, kind: 'avatar', sheet: this.lib.avatar(p.profile.base, p.profile.colors), frame: p.frame, pos: p.pos, map: p.map,
        tag: { name: p.profile.name, color: accentOf(p.profile), duo: this.duo.has(p.id) } });
      if (p.follower?.out && !p.follower.hidden) items.push(this.followerItem(p.id + ':f', p.follower, p.map));
    }
    if (this.me.follower.out && !this.me.follower.hidden) items.push(this.followerItem('me:f', this.me.follower, this.me.follower.leaderMap));
    const me = { ...s, silhouettes: this.lib.silhouettes(this.game.playerBase) };
    // l'overlay suit les fondus du jeu (registre de luminosité de la DS) : rien ne reste affiché sur un écran noir
    this.overlay.render(now, me, items, { fade: s.field === false || this.battle?.view ? 1 : s.fade || 0, prompt: this.promptPeer && { id: this.promptPeer.id, label: `Interagir avec ${this.promptPeer.profile.name}` } });
  }
  followerItem(id, f, map) {
    const spr = this.lib.pokemon(f.species);
    return { id, kind: 'pokemon', sheet: spr.sheet, sheetKind: spr.kind, frame: f.frame, pos: f.pos, map, get fx() { return f.fx; }, set fx(v) { f.fx = v; } };
  }
  updateAmbient() {
    const c = this.ambient.getContext('2d');
    c.drawImage(this.game.topCanvas, 0, 0, 32, 24);
  }
  placeName(map) {
    const info = this.game.mapInfo?.(map);
    if (info && this.gd) return this.gd.text.places[info.label] || `Zone ${map}`;
    return this.places[map] || `Zone ${map}`;
  }

  refreshSide(force = false) {
    const rows = [{ id: 'me', profile: this.me.profile, map: this.me.last?.map, follower: this.me.follower, me: true }];
    for (const p of this.peers.values()) rows.push({ id: p.id, profile: p.profile, map: p.map, follower: p.follower, dist: this.me.last && p.map === this.me.last.map ? Math.abs(p.tx - this.me.last.tx) + Math.abs(p.tz - this.me.last.tz) : null });
    const sig = JSON.stringify(rows.map(r => [r.profile.name, r.profile.base, r.profile.colors, r.map, r.follower?.out, r.follower?.species, r.dist]));
    if (!force && sig === this._sideSig) return;
    this._sideSig = sig;
    this.countEl.textContent = rows.length;
    this.playersEl.replaceChildren(...rows.map(r => h('div.pl-player', {},
      this.ui.portrait(r.profile, 44),
      h('div.who', {},
        h('div.name', {}, h('span.nm', {}, r.profile.name), r.me ? h('span.you', {}, 'TOI') : null, this.duo.has(r.id) ? h('span', { style: { color: 'var(--c-duo)' }, html: icon('link-2', 14) }) : null),
        h('div.where', { html: icon('map-pin', 12) + (r.map !== undefined ? this.placeName(r.map) : '—') + (r.dist !== null && r.dist !== undefined ? ` · ${r.dist} pas` : '') })),
      r.follower?.out ? this.ui.mon(r.follower.species) : null)));
  }
}
