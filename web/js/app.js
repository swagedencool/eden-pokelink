// PokéLink — orchestration : jeu ↔ overlay ↔ interface ↔ réseau.
import { Animator, h, ease, setTO } from './core.js';
import { DIRS } from './projection.js';
import { SpriteLibrary, DIR_BASE } from './sprites.js';
import { COLOR_SLOTS, writePalette } from './rom.js';
import { RemotePlayer, Follower } from './world.js';
import { Overlay } from './overlay.js';
import { InputRouter } from './input.js';
import { icon } from './icons.js';
import { InteractionMenu, RequestCard, TradePanel, VersusCard, ProfilePanel, RulesPanel, SettingsPanel, InvitePanel, TeamPanel, SavePanel, Toasts, keycap, tap } from './ui.js';
import { settings } from './settings.js';
import { ScreenFilter } from './emu/screen.js';
import { skinPalette } from './rom.js';
import { mountVersion } from './version-badge.js';
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
  constructor({ root, assets, gd, game, host, net, profile, team, room, places = {}, bosses }) {
    Object.assign(this, { root, assets, gd, game, host, net, room, places, turboOn: false });
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
    mountVersion(this.brandEl);
    this.wireMouse();
    this.wireNet();
    settings.on('change', () => { this.applySound(); this.applyVideo(); if (this.turboOn) this.host?.setSpeed(settings.state.turboSpeed); this.refreshControls(); });
    this._eco = !!settings.state.eco;
    this.applySound(); this.applyVideo();
    this.refreshControls();
    if (Object.keys(this.me.profile.colors || {}).length) this.applyOwnPalette();
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
    // filtres d'image (WebGL) : l'écran du haut avec les amis, l'écran du bas seul
    this.topScreen = new ScreenFilter(top, this.ovCanvas); this.topScreen.el.classList.add('px');
    this.botScreen = new ScreenFilter(bottom);
    const chipBtn = (cls, title, ic, fn, label) => tap(h('span.pl-chip.btn' + cls, { title }, h('span.ic', { html: icon(ic, 15) }), label || null), fn);
    this.roomChip = tap(h('span.pl-chip.btn', { title: 'Inviter un ami dans la room' }, 'ROOM', h('b', {}, this.room)), () => this.openInvite());
    this.inviteChip = chipBtn('.invite', 'Envoyer le lien de la room à un ami', 'user-plus', () => this.openInvite(), h('span', {}, 'Inviter un ami'));
    this.turboChip = chipBtn('.turbo', 'Accélérer le jeu', 'fast-forward', () => this.setTurbo(!this.turboOn), h('span'));
    this.soundChip = chipBtn('.sound', 'Couper ou remettre le son', 'volume-2', () => settings.set({ muted: !settings.state.muted, volume: settings.state.volume || 0.6 }));
    this.settingsChip = chipBtn('.gear', 'Réglages : touches, volume, vitesse', 'settings', () => this.openSettings(), h('span', {}, 'Réglages'));
    tap(this.rulesChip, () => this.openRules());
    // Sauvegarder (fichier .sav) · menu : Sauvegarder et quitter
    this.saveMain = tap(h('span.main', { title: 'Enregistrer ta partie et télécharger ton fichier de sauvegarde (.sav)' }, h('span.ic', { html: icon('download', 16) }), h('span', {}, 'Sauvegarder')), () => this.save(false));
    this.saveMore = tap(h('span.more', { title: 'Plus d’options', html: icon('chevron-right', 14) }), () => this.toggleSaveMenu());
    this.saveMenu = h('div.pl-savemenu.glass', { hidden: true },
      tap(h('div.opt', {}, h('span.ic', { html: icon('download', 16) }), h('div', {}, h('b', {}, 'Sauvegarder'), h('small', {}, 'Sauvegarde d’abord dans le jeu, puis télécharge ton .sav'))), () => this.save(false)),
      tap(h('div.opt.quit', {}, h('span.ic', { html: icon('door-open', 16) }), h('div', {}, h('b', {}, 'Sauvegarder et quitter'), h('small', {}, 'Sauvegarde dans le jeu, télécharge ton .sav, puis quitte'))), () => this.save(true)),
      this.quitOpt = tap(h('div.opt.nosave', {}, h('span.ic', { html: icon('x', 16) }), h('div', {}, h('b', {}, 'Quitter sans sauvegarder'), h('small', {}, 'Ce que tu as fait depuis ta dernière sauvegarde est perdu'))), e => this.quitNoSave(e)));
    this.saveBtn = h('div.pl-save', {}, this.saveMain, this.saveMore, this.saveMenu);
    document.addEventListener('pointerdown', e => { if (!this.saveMenu.hidden && !e.target.closest?.('.pl-save')) this.toggleSaveMenu(false); }, true);
    const key = (action, t, fn) => tap(h('span.pl-key', { title: t }, h('kbd'), t), fn);
    this.keyEls = {
      A: key('A', 'Interagir', () => {
        const p = this.promptPeer || this.nearestPeer();
        if (p) return this.openMenu(p);
        this.ui.toasts.show({ ic: 'users', title: this.peers.size ? 'Ton ami est sur une autre carte' : 'Personne dans la room pour l’instant', sub: this.peers.size ? 'Clique sur lui dans la liste « Dans la room »' : 'Invite un ami avec le bouton « Inviter un ami »', dur: 2600 });
      }),
      follower: key('follower', 'Pokémon', () => this.toggleFollower()),
      profile: key('profile', 'Profil', () => this.openProfile()),
      emote: key('emote', 'Émote', () => this.sendEmote('heart')),
    };
    this.stage = h('div.pl-stage', {},
      h('div.pl-ambient', {}, this.ambient), h('div.pl-grain'),
      h('header.pl-header', {},
        this.brandEl = h('div.pl-brand', {}, h('div.logo', { html: icon('link-2', 17) }), 'PokéLink', h('small', {}, 'Platine')),
        this.roomChip,
        h('span.pl-chip', {}, h('i.pl-dot'), this.countEl, ' joueurs'),
        this.inviteChip, this.duoChip, this.rulesChip, h('span.pl-spacer'),
        this.saveBtn, this.turboChip, this.soundChip, this.settingsChip,
        h('span.pl-chip', { html: icon('wifi', 15), title: 'Latence avec la room' }, this.pingEl)),
      this.gameEl = h('section.pl-game', {}, top, this.ovCanvas, this.topScreen.el, this.domLayer, this.uiLayer),
      h('aside.pl-side', {},
        h('div.pl-bottom.glass-light', {}, bottom, this.botScreen.el),
        h('div.pl-room.glass-light', {}, h('h4', { html: icon('users', 14) + ' Dans la room' }), this.playersEl,
          h('div.pl-keys', {}, ...Object.values(this.keyEls)))));
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
    inp.speed = () => (this.turboOn ? settings.state.turboSpeed : 1);
    inp.on('hotkey', k => {
      if (k === 'follower') this.toggleFollower();
      if (k === 'profile') this.openProfile();
      if (k === 'emote') this.sendEmote('heart');
      if (k === 'rules') this.openRules();
      if (k === 'turbo') this.setTurbo(!this.turboOn);
      if (k === 'invite') this.ui.top() instanceof InvitePanel ? this.ui.top().nav('B') : this.openInvite();
      if (k === 'settings') this.ui.top() instanceof SettingsPanel ? this.ui.top().nav('B') : this.openSettings();
    });
  }

  // ---------------------------------------------------------------- souris
  wireMouse() {
    // la bulle « Interagir » au-dessus d'un ami
    tap(this.overlay.prompt, () => this.promptPeer && !this.ui.active && this.openMenu(this.promptPeer));
    // clic sur un ami (son personnage ou son nom) : son menu s'ouvre, où qu'il soit sur la carte
    const hit = e => {
      const r = this.gameEl.getBoundingClientRect(), k = r.width / 768;
      const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
      let best = null, bd = 1e9;
      for (const p of this.peers.values()) {
        if (p.map !== this.me.last?.map) continue;
        const a = this.overlay.screen.get(p.id); if (!a) continue;
        if (Math.abs(x - a.x) > 44 || y < a.y - 24 || y > a.feet + 12) continue;
        const d = Math.abs(x - a.x) + Math.abs(y - (a.y + a.feet) / 2) * 0.5;
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    };
    this.gameEl.addEventListener('click', e => {
      if (this.ui.active || this.busy || e.target.closest('.pl-click, .glass:not(.pl-tag)')) return;
      const p = hit(e);
      if (p) { e.stopPropagation(); this.openMenu(p); return; }
      this.topClick(e);
    });
    // clic droit sur l'écran du haut : bouton B (fermer, revenir)
    this.gameEl.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.ui.active || e.target.closest('.glass:not(.pl-tag)')) return;
      this.walk = null; this.input.auto = null; this.input.taps.set('B', 6);
    });
    this.input.on('manual', () => { this.walk = null; });
    this.gameEl.addEventListener('mousemove', e => {
      const over = !this.ui.active && !e.target.closest('.glass:not(.pl-tag)') && hit(e);
      this.gameEl.classList.toggle('pl-overpeer', !!over);
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
    n.on('leave', m => { if (this.trade?.peer?.id === m.from && this.trade.panel && !this.trade.panel.closed) { this.trade.panel.close(); this.endTrade(); this.ui.toasts.show({ ic: 'circle-alert', title: 'Échange annulé', sub: 'Ton ami a quitté la room', dur: 2600 }); }
      this.peers.delete(m.from); this.rules.forget(m.from); this.refreshSide(true); });
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
    n.on('trade', m => this.onTrade(m));
    n.on('status', m => { const p = this.peers.get(m.from); if (p) { p.status = m.status || null; this.refreshSide(true); } });
    n.on('battle', m => this.onBattle(m));
    n.on('ping', m => (this.pingEl.textContent = m.ms + ' ms'));
  }
  teamSummary() { return this.me.team.map(({ species, name, level, gender, hp, maxhp, moves, item, ability, nature, shiny }) => ({ species, name, level, gender, hp, maxhp, moves, item, ability, nature, shiny })); }

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
    if (this.ui.active || this.busy) return;
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
        // les données du Pokémon (format de boîte, 136 octets) partent avec la confirmation, dans le même message
        this.trade.raw = this.tradeRaw(panel.pick);
        this.net.send('trade', { rid, to: peer.id, action: 'confirm', slot: panel.pick, raw: this.trade.raw });
      },
      onCancel: () => { this.net.send('trade', { rid, to: peer.id, action: 'cancel' }); this.endTrade(); },
    });
    panel.onDone = mon => {
      const given = this.me.team[panel.pick], incoming = this.trade?.incoming;
      this.endTrade();
      if (incoming && this.game.writePartyMon) {
        this.game.writePartyMon(given.slot, boxToParty(incoming, this.gd)); // le Pokémon reçu prend la place dans l'équipe du jeu
        this.refreshTeam();
      }
      this.ui.toasts.show({ species: mon.species, accent: 'var(--c-trade)', title: `${mon.name} a rejoint ton équipe !`, sub: `Échange terminé avec ${peer.profile.name} · enregistré dans ta partie` });
      this.refreshSide(true);
    };
    this.trade = { rid, panel, peer, raw: null, incoming: null };
    this.ui.open(panel);
    // état complet renvoyé chaque seconde : un message perdu ne peut plus bloquer l'échange
    this.trade.sync = setInterval(() => {
      if (panel.closed) return this.endTrade(rid);
      const busy = panel.phase === 'swap' || panel.phase === 'done';
      this.net.send('trade', { rid, to: peer.id, action: 'state', pick: panel.pick, cur: panel.cur,
        confirmed: panel.confirmed || busy, raw: panel.confirmed || busy ? this.trade?.raw : undefined });
    }, 1000);
    for (const m of this.tradeEarly?.get(rid) || []) this.onTrade(m);   // messages arrivés avant l'ouverture de la fenêtre
    this.tradeEarly?.delete(rid);
  }
  tradeRaw(slot) {
    const mon = this.me.team[slot];
    const raw = mon && this.game.readPartyRaw?.()?.subarray(4 + mon.slot * PARTY.size, 4 + mon.slot * PARTY.size + 136);
    return raw ? btoa(String.fromCharCode(...raw)) : null;
  }
  endTrade(rid) {
    if (!this.trade || (rid && this.trade.rid !== rid)) return;
    clearInterval(this.trade.sync);
    this.trade = null;
  }
  onTrade(m) {
    if (this.trade?.rid !== m.rid || !this.trade.panel) {
      // la fenêtre n'est pas encore ouverte (l'autre joueur a été plus rapide) : on garde le message
      if (!this.tradeEarly) this.tradeEarly = new Map();
      const q = this.tradeEarly.get(m.rid) || []; if (q.length < 64) q.push(m); this.tradeEarly.set(m.rid, q);
      setTimeout(() => this.tradeEarly?.delete(m.rid), 15000);
      return;
    }
    const t = this.trade;
    if (m.raw && (m.action === 'data' || m.action === 'confirm' || m.action === 'state')) t.incoming = Uint8Array.from(atob(m.raw), c => c.charCodeAt(0));
    if (m.action === 'data') return;
    if (m.action === 'cancel') {
      t.panel.settled = true; t.panel.close(); this.endTrade();
      this.ui.toasts.show({ profile: t.peer.profile, title: `${t.peer.profile.name} a annulé l'échange`, dur: 2400 });
      return;
    }
    t.panel.remote(m);
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
    menu?.close();
    this.ui.open(new TeamPanel(this.ui, { peer, gd: this.gd,
      onTrade: () => this.sendRequest('trade', peer), onBattle: () => this.sendRequest('battle', peer) }), { from: { s: 0.94, o: 0, y: 12 }, dur: 300 });
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
      this.ui.toasts.show({ species: m.species, accent: '#f97316', title: `${m.name} te suit !`, sub: `Touche ${settings.label('follower')} ou bouton « Pokémon » pour le faire rentrer`, dur: 2200 });
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
    this.rulesChip.replaceChildren(keycap(settings.label('rules')), on ? parts.join(' · ') : 'Règles');
    if (this.rulesPanel && !this.rulesPanel.closed) this.rulesPanel.refresh();
  }

  /** Mon activité, envoyée aux amis quand elle change : en combat (contre qui), en échange, occupé (menu, combat du jeu…). */
  updateStatus(now) {
    const s = this.game.state?.();
    if (s && s.field) this.fieldAt = now;
    let st = null;
    if (this.battle) st = { kind: 'battle', with: this.battle.peer?.profile?.name || this.battle.opponent || '' };
    else if (this.trade?.panel && !this.trade.panel.closed) st = { kind: 'trade', with: this.trade.peer?.profile?.name || '' };
    else if (this.fieldAt && now - this.fieldAt > 1500) st = { kind: 'busy' };
    const key = st ? st.kind + '|' + (st.with || '') : '';
    if (key !== this.statusKey || now - (this.statusSent || 0) > 8000) {      // renvoyé de temps en temps pour les arrivants
      this.statusKey = key; this.statusSent = now; this.myStatus = st;
      this.net.send('status', { status: st });
    }
  }
  /** Souris sur l'écran du haut : dans le jeu, marcher jusqu'à la case cliquée (et parler si on bute sur quelqu'un) ;
   *  pendant un dialogue ou un menu du jeu, un clic fait avancer (bouton A). */
  topClick(e) {
    const s = this.game.state?.(); if (!s) return;
    const r = this.gameEl.getBoundingClientRect(), k = r.width / 256;
    const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
    if (!s.field) { this.input.taps.set('A', 6); return; }
    let best = null, bd = 1e9;
    for (let dz = -9; dz <= 9; dz++) for (let dx = -11; dx <= 11; dx++) {
      const p = this.overlay.screenOf(s, { x: (s.tx + dx) * 16 + 8, y: s.y, z: (s.tz + dz) * 16 + 8 });
      const d = Math.hypot(x - p.x, y - (p.y - 6 * (p.scale || 1)));
      if (d < bd) { bd = d; best = { dx, dz, p }; }
    }
    if (!best || bd > 16) return;
    if (!best.dx && !best.dz) { this.input.taps.set('A', 6); return; }           // clic sur soi : bouton A
    this.walk = { tx: s.tx + best.dx, tz: s.tz + best.dz, last: s.tx + ',' + s.tz, still: 0, alt: false, tries: 0 };
    // petit repère à l'endroit visé
    const m = h('div.pl-walkmark', { style: { left: best.p.x * 3 + 'px', top: (best.p.y - 6 * (best.p.scale || 1)) * 3 + 'px' } });
    this.domLayer.append(m); setTimeout(() => m.remove(), 700);
  }
  /** Une image : avance vers la case visée, contourne si bloqué, parle si on bute juste devant la cible. */
  stepWalk(s) {
    const w = this.walk; if (!w) return;
    const stop = () => { this.walk = null; this.input.auto = null; };
    if (!s || !s.field || this.ui.active) return stop();
    const dx = w.tx - s.tx, dz = w.tz - s.tz;
    if (!dx && !dz) return stop();
    const here = s.tx + ',' + s.tz;
    if (here !== w.last) { w.last = here; w.still = 0; w.tries = 0; } else w.still++;
    if (w.still > 22) {                                                  // bloqué : on essaie l'autre axe
      w.still = 0; w.tries++; w.alt = !w.alt;
      if (Math.abs(dx) + Math.abs(dz) === 1 || w.tries > 2) {             // juste devant la cible (ou impasse) : on parle
        if (Math.abs(dx) + Math.abs(dz) === 1) this.input.taps.set('A', 6);
        return stop();
      }
    }
    const xFirst = Math.abs(dx) >= Math.abs(dz);
    const useX = dx && (!dz || (xFirst !== w.alt));
    this.input.auto = new Set([useX ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dz > 0 ? 'DOWN' : 'UP')]);
  }
  /** L'ami le plus proche sur la même carte (pour le bouton « Interagir »). */
  nearestPeer() {
    const l = this.me.last; let best = null, bd = 1e9;
    for (const p of this.peers.values()) {
      if (!l || p.map !== l.map) continue;
      const d = Math.abs(p.tx - l.tx) + Math.abs(p.tz - l.tz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  /** Quitter sans sauvegarder : un second clic confirme. */
  quitNoSave(e) {
    e?.stopPropagation();
    if (!this.quitArmed) {
      this.quitArmed = true; this.quitOpt.classList.add('armed');
      this.quitOpt.querySelector('b').textContent = 'Clique encore pour quitter';
      clearTimeout(this.quitT); this.quitT = setTimeout(() => this.disarmQuit(), 4000);
      return;
    }
    this.onQuit ? this.onQuit() : (location.href = 'index.html');
  }
  disarmQuit() { this.quitArmed = false; this.quitOpt.classList.remove('armed'); this.quitOpt.querySelector('b').textContent = 'Quitter sans sauvegarder'; }
  toggleSaveMenu(open = this.saveMenu.hidden) {
    if (!open && this.quitArmed) this.disarmQuit();
    this.saveMenu.hidden = !open;
    this.saveBtn.classList.toggle('open', open);
  }
  /** Sauvegarde : le jeu écrit son fichier, gardé dans le navigateur et téléchargé ; quit : retour à l'accueil. */
  /** Bouton Sauvegarder : d'abord la fenêtre qui rappelle de sauvegarder dans le jeu. */
  save(quit) {
    this.toggleSaveMenu(false);
    if (this.ui.active || this.saving) return;
    this.checkSave?.();
    this.ui.open(new SavePanel(this.ui, { quit, savedAt: () => this.savedAt?.(), startKey: settings.label('START'), onDownload: () => this.download(quit) }), { from: { s: 0.94, o: 0, y: 12 }, dur: 280 });
  }
  async download(quit) {
    if (this.saving) return;
    this.saving = true; this.saveBtn.classList.add('busy');
    try {
      const r = await this.onSave?.(quit);
      if (!quit) this.ui.toasts.show({ ic: 'check', accent: '#10b981', title: 'Partie sauvegardée', sub: r?.name ? `Fichier ${r.name} téléchargé · aussi gardé dans ce navigateur` : 'Gardée dans ce navigateur', dur: 3600 });
    } catch (e) {
      this.ui.toasts.show({ ic: 'circle-alert', accent: '#ef4444', title: 'Sauvegarde impossible', sub: e.message || String(e), dur: 4200 });
    } finally { this.saving = false; this.saveBtn.classList.remove('busy'); }
  }

  openSettings() {
    if (this.ui.active) return;
    const panel = new SettingsPanel(this.ui, { turbo: () => this.turboOn, onTurbo: on => this.setTurbo(on), capture: fn => (this.input.capture = fn) });
    this.ui.open(panel, { from: { s: 0.92, o: 0, y: 14 }, dur: 300 });
  }
  openInvite() {
    if (this.ui.active) return;
    const link = new URL('play.html', location.href); link.search = '?room=' + this.room;
    this.ui.open(new InvitePanel(this.ui, { code: this.room, link: link.href }), { from: { s: 0.92, o: 0, y: 14 }, dur: 280 });
  }
  setTurbo(on) {
    this.turboOn = !!on;
    this.host?.setSpeed(on ? settings.state.turboSpeed : 1);
    this.applySound();
    this.refreshControls();
    this.ui.toasts.show({ ic: 'fast-forward', accent: '#fbbf24', title: on ? `Jeu accéléré ×${String(settings.state.turboSpeed).replace('.', ',')}` : 'Vitesse normale', sub: `Touche ${settings.label('turbo')} pour ${on ? 'revenir à la normale' : 'accélérer'}`, dur: 1600 });
  }
  applySound() { this.host?.setVolume(this.turboOn && !settings.state.turboSound ? 0 : settings.effectiveVolume); }
  /** Image : filtre d'agrandissement, économie (une image sur deux dessinée). */
  applyVideo() {
    const st = settings.state;
    this.topScreen.setMode(st.filter); this.botScreen.setMode(st.filter);
    if (this._eco !== st.eco) { this._eco = st.eco; if (this.host) { this.host.options = { ...(this.host.options || {}), frameskip: st.eco ? 1 : 0 }; if (!this.turboOn) this.host.setCoreOption('desmume_frameskip', st.eco ? 1 : 0); } }
  }
  /** Puces de l'en-tête et touches affichées : suivent les réglages (touches choisies, son, turbo). */
  refreshControls() {
    const st = settings.state, vol = settings.effectiveVolume;
    this.turboChip.classList.toggle('on', this.turboOn);
    const real = this.turboOn && this.realSpeed > 0.2 ? Math.min(this.realSpeed, st.turboSpeed) : null;
    this.turboChip.lastChild.textContent = this.turboOn ? '×' + (real ? real.toFixed(1) : String(st.turboSpeed)).replace('.', ',') : '×1';
    this.turboChip.title = this.turboOn && this.realSpeed ? `Vitesse réelle : ×${this.realSpeed.toFixed(1).replace('.', ',')} (si elle reste sous la vitesse choisie, ton ordinateur est à fond)` : 'Accélérer le jeu';
    this.soundChip.firstChild.innerHTML = icon(vol === 0 ? 'volume-x' : vol < 0.5 ? 'volume-1' : 'volume-2', 15);
    this.soundChip.classList.toggle('off', vol === 0);
    for (const [a, el] of Object.entries(this.keyEls)) el.firstChild.textContent = settings.label(a);
    this.onRulesChanged?.();
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
    // Lucas ↔ Aurore : le personnage change aussi dans la partie (gardé à la prochaine sauvegarde dans le jeu)
    if (draft.base !== this.game.playerBase) this.game.setGender?.(draft.base === 'aurore' ? 1 : 0);
    this.applyOwnPalette();
    try { localStorage.setItem('pokelink.colors', JSON.stringify(this.me.profile.colors)); localStorage.setItem('pokelink.name', this.me.profile.name); } catch {}
    if (this.me.follower.out && draft.buddy !== before.buddy) { this.me.follower.species = draft.buddy; this.sendFollower(true); }
    this.ui.toasts.show({ profile: this.me.profile, title: 'Profil enregistré', sub: 'Tes amis te voient déjà ainsi · ton personnage change dès que tu passes une porte ou ouvres un menu', dur: 3200 });
    this.refreshSide(true);
  }

  /** Son propre personnage : sa palette est réécrite dans la ROM chargée ; le jeu la relit au prochain chargement
   *  de zone (porte, menu plein écran…). */
  applyOwnPalette() {
    const base = this.me.profile.base, a = this.assets.avatars[base];
    if (!a || base !== this.game.playerBase) return false;
    const pal = this.lib.avatarPalette(base, this.me.profile.colors || {});
    let ok = this.game.patchRom(a.paletteRomOffset, pal, writePalette);
    // à vélo, en surf, à la pêche… et de dos en combat
    for (const t of this.assets.skins?.[base] || []) ok = this.game.patchRom(t.offset, skinPalette(t, a.palette, pal), writePalette) && ok;
    return ok;
  }


  // ---------------------------------------------------------------- boucle
  /** Appelée une fois par frame affichée. now en ms. */
  update(now) {
    const t0 = performance.now();
    if (!this.stT || now - this.stT > 500) { this.stT = now; this.updateStatus(now); }
    // vitesse réelle du jeu (images du jeu par seconde / 60), affichée sur le bouton d'accélération
    if (!this.rate || now - this.rate.t >= 1000) {
      const f = this.host?.frame?.() ?? 0;
      if (this.rate && now > this.rate.t) this.realSpeed = (f - this.rate.f) / ((now - this.rate.t) / 1000) / 60;
      this.rate = { t: now, f };
      if (this.turboOn) this.refreshControls();
    }
    this.anim.now = now;
    const s = this.game.state();
    if (this.walk) this.stepWalk(s);
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
    this.topScreen.present(); this.botScreen.present();
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
        tag: { name: p.profile.name, color: accentOf(p.profile), duo: this.duo.has(p.id), status: p.status } });
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
    for (const p of this.peers.values()) rows.push({ id: p.id, profile: p.profile, map: p.map, follower: p.follower, status: p.status, dist: this.me.last && p.map === this.me.last.map ? Math.abs(p.tx - this.me.last.tx) + Math.abs(p.tz - this.me.last.tz) : null });
    const sig = JSON.stringify(rows.map(r => [r.profile.name, r.profile.base, r.profile.colors, r.map, r.follower?.out, r.follower?.species, r.dist, r.status?.kind, r.status?.with]));
    if (!force && sig === this._sideSig) return;
    this._sideSig = sig;
    this.countEl.textContent = rows.length;
    this.playersEl.replaceChildren(...rows.map(r => (r.me ? (x => x) : x => tap(x, () => { const p = this.peers.get(r.id); if (p && !this.ui.active) this.openMenu(p); }))(h('div.pl-player', { title: r.me ? null : `Proposer un échange, un combat… à ${r.profile.name}` },
      this.ui.portrait(r.profile, 44),
      h('div.who', {},
        h('div.name', {}, h('span.nm', {}, r.profile.name), r.me ? h('span.you', {}, 'TOI') : null, this.duo.has(r.id) ? h('span', { style: { color: 'var(--c-duo)' }, html: icon('link-2', 14) }) : null),
        r.status ? h('div.pl-st.' + r.status.kind, { html: icon({ battle: 'swords', trade: 'arrow-left-right', busy: 'hourglass' }[r.status.kind] || 'hourglass', 12) + ({ battle: 'En combat', trade: 'En échange', busy: 'Occupé dans le jeu' }[r.status.kind] || '') + (r.status.with ? ' avec ' + r.status.with : '') })
          : h('div.where', { html: icon('map-pin', 12) + (r.map !== undefined ? this.placeName(r.map) : '—') + (r.dist !== null && r.dist !== undefined ? ` · ${r.dist} pas` : '') })),
      r.follower?.out ? this.ui.mon(r.follower.species) : null))));
  }
}
