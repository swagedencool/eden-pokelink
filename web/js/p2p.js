// Rooms sans serveur : les navigateurs se parlent directement (WebRTC, chiffré de bout en bout).
// Le code de room sert seulement à se trouver, via des relais publics gratuits (Nostr) fournis par Trystero (MIT).
// Même interface que l'ancien client WebSocket : connect(), on(type, fn), send(type, data), id, code.
//
// Ce que faisait le serveur, chaque navigateur le fait maintenant :
//  - à l'arrivée d'un joueur, chacun lui renvoie son profil, son Pokémon sorti, ses âmes liées, les règles et la run ;
//  - un combat est simulé dans le navigateur d'un des deux joueurs (l'« hôte » : le plus petit identifiant) ;
//  - si quelqu'un part en plein combat, il déclare forfait.

const APP_ID = 'pokelink.app/v1';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

// ------------------------------------------------------------------------------------------ transports
/** Internet : WebRTC + signalisation par relais publics (Trystero). */
class TrysteroTransport {
  async join(appId, code) {
    const { joinRoom } = await import('../vendor/trystero.js');
    const cfg = { appId, password: 'pokelink:' + code };
    try { this.room = joinRoom({ ...cfg, identity: 'none' }, code); } catch { this.room = joinRoom(cfg, code); }
    this.act = this.room.makeAction('m');
    const self = await this.room.getSelf();
    return self.peerId;
  }
  send(m, target) { this.act.send(m, target ? { target } : undefined).catch(() => {}); }
  onMessage(fn) { this.act.onMessage((data, ctx) => fn(data, ctx.peerId)); }
  onPeerJoin(fn) { this.room.onPeerJoin(ctx => fn(ctx.peerId)); }
  onPeerLeave(fn) { this.room.onPeerLeave(ctx => fn(ctx.peerId)); }
  ping(id) { return this.room.ping(id); }
  leave() { this.room?.leave(); }
}

/** Même navigateur (onglets) : BroadcastChannel. Sert aux tests et à jouer à plusieurs sur un seul PC. */
class LocalTransport {
  async join(appId, code) {
    this.id = 'L' + Math.random().toString(36).slice(2, 10);
    this.ch = new BroadcastChannel(`${appId}:${code}`);
    this.peers = new Map(); this.fns = { msg: [], join: [], leave: [] }; this.waits = new Map();
    this.ch.onmessage = e => this.recv(e.data);
    this.post({ k: 'hi' });
    this.hb = setInterval(() => {
      this.post({ k: 'hb' });
      for (const [id, t] of this.peers) if (Date.now() - t > 4000) { this.peers.delete(id); this.fns.leave.forEach(f => f(id)); }
    }, 1000);
    addEventListener('pagehide', () => this.leave());
    return this.id;
  }
  post(x) { this.ch.postMessage({ ...x, id: this.id }); }
  seen(id) { const fresh = !this.peers.has(id); this.peers.set(id, Date.now()); if (fresh) this.fns.join.forEach(f => f(id)); }
  recv(x) {
    if (x.id === this.id || (x.to && x.to !== this.id)) return;
    if (x.k === 'bye') { if (this.peers.delete(x.id)) this.fns.leave.forEach(f => f(x.id)); return; }
    this.seen(x.id);
    if (x.k === 'hi') this.post({ k: 'hey', to: x.id });
    if (x.k === 'msg') this.fns.msg.forEach(f => f(x.m, x.id));
    if (x.k === 'ping') this.post({ k: 'pong', to: x.id, n: x.n });
    if (x.k === 'pong') this.waits.get(x.n)?.();
  }
  send(m, target) { this.post({ k: 'msg', m, to: target || undefined }); }
  onMessage(fn) { this.fns.msg.push(fn); }
  onPeerJoin(fn) { this.fns.join.push(fn); }
  onPeerLeave(fn) { this.fns.leave.push(fn); }
  ping(id) {
    const n = Math.random(), t0 = performance.now();
    return new Promise(res => { this.waits.set(n, () => { this.waits.delete(n); res(performance.now() - t0); }); this.post({ k: 'ping', to: id, n }); });
  }
  leave() { if (!this.ch) return; this.post({ k: 'bye' }); clearInterval(this.hb); this.ch.close(); this.ch = null; }
}

// ------------------------------------------------------------------------------------------ room
export class P2PRoom {
  /** mode : 'internet' (par défaut) ou 'local' (onglets du même navigateur) ; ?p2p=local dans l'adresse force le local. */
  constructor({ mode } = {}) {
    this.mode = mode || (new URLSearchParams(location.search).get('p2p') === 'local' ? 'local' : 'internet');
    this.handlers = new Map(); this.mine = {}; this.roomState = {}; this.peers = new Set();
    this.battles = new Map(); this.pending = new Map(); this.battleHost = new Map(); this.battlePeer = new Map();
  }
  on(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, []); this.handlers.get(t).push(fn); return this; }
  emit(m) { for (const f of this.handlers.get(m.t) || []) { try { f(m); } catch (e) { console.error(e); } } }

  async connect(_url, action, code) {
    const c = action === 'create' ? makeCode() : cleanCode(code);
    if (!c) throw new Error('Code de room invalide');
    this.code = c;
    this.tp = this.mode === 'local' ? new LocalTransport() : new TrysteroTransport();
    this.id = await this.tp.join(APP_ID, c);
    this.tp.onMessage((m, from) => this.receive(m, from));
    this.tp.onPeerJoin(id => this.peerJoined(id));
    this.tp.onPeerLeave(id => this.peerLeft(id));
    this.pingTimer = setInterval(() => this.measure(), 2000);
    addEventListener('pagehide', () => this.close());
    return { code: c, id: this.id, peers: [] };
  }
  close() { clearInterval(this.pingTimer); this.tp?.leave(); }

  send(t, data = {}) {
    const m = { t, ...data };
    if (t === 'ping') return;
    if (t === 'hello' || t === 'profile') this.mine.hello = { t: 'hello', profile: m.profile, team: m.team };
    if (t === 'follower') this.mine.follower = m.out ? { t: 'follower', out: true, species: m.species } : null;
    if (t === 'soul') this.mine.soul = { t: 'soul', name: m.name, mons: m.mons, dead: m.dead };
    if (t === 'rules') this.roomState.rules = { ...m, from: this.id };
    if (t === 'run-config') this.roomState.run = { ...m, from: this.id };
    if (t === 'battle-team') return this.teamToHost(m);
    if (t === 'battle-choice') { const host = this.battleHost.get(m.rid); return host === this.id ? this.battles.get(m.rid)?.choose(this.id, String(m.choice || '')) : this.tp.send(m, host); }
    this.tp.send(m, m.to || null);
  }

  receive(m, from) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'battle-team') return this.hostBattle(m, from);
    if (m.t === 'battle-choice') return this.battles.get(m.rid)?.choose(from, String(m.choice || ''));
    if (m.t === 'rules') this.roomState.rules = { ...m, from };
    if (m.t === 'run-config') this.roomState.run = { ...m, from };
    if (m.t === 'battle' && m.ev === 'end') { this.battleHost.delete(m.rid); this.battlePeer.delete(m.rid); }
    this.emit({ ...m, from });
  }

  /** Nouveau joueur : on lui donne tout ce qu'un serveur lui aurait donné. */
  peerJoined(id) {
    this.peers.add(id);
    for (const x of [this.mine.hello, this.mine.follower && { ...this.mine.follower, instant: true }, this.mine.soul]) if (x) this.tp.send(x, id);
    for (const x of [this.roomState.run, this.roomState.rules]) if (x) this.tp.send(x, id);
  }
  peerLeft(id) {
    if (!this.peers.delete(id)) return;
    for (const b of this.battles.values()) if (!b.ended && b.sides[id]) b.choose(id, 'forfeit');      // il déclare forfait
    for (const [rid, host] of this.battleHost) if (host === id) {                                        // l'hôte du combat est parti
      this.battleHost.delete(rid);
      this.emit({ t: 'battle', rid, ev: 'end', winner: this.myName, team: [], from: id, left: true });
    }
    this.emit({ t: 'leave', from: id });
  }

  // ---------------------------------------------------------------------------------------- combats
  teamToHost(m) {
    const host = [this.id, String(m.opponent)].sort()[0];
    this.battleHost.set(m.rid, host); this.battlePeer.set(m.rid, m.opponent); this.myName = m.name;
    if (host === this.id) this.hostBattle(m, this.id); else this.tp.send(m, host);
  }
  /** Les deux joueurs envoient leur équipe à l'hôte ; le combat démarre quand les deux sont là. */
  async hostBattle(m, from) {
    const rid = String(m.rid || '').slice(0, 64);
    if (!rid || this.battles.has(rid) || !Array.isArray(m.team) || !m.team.length || m.team.length > 6) return;
    const p = this.pending.get(rid) || {};
    p[from] = { id: from, name: String(m.name || 'Dresseur').slice(0, 18), team: m.team, opponent: m.opponent, seed: m.seed };
    this.pending.set(rid, p);
    const ids = Object.keys(p);
    if (ids.length < 2) return;
    const [a, b] = ids.map(i => p[i]);
    if (a.opponent !== b.id || b.opponent !== a.id) return;
    this.pending.delete(rid);
    const seed = Array.isArray(a.seed) && a.seed.length === 4 ? a.seed.map(Number) : undefined;
    const send = (id, msg) => (id === this.id ? this.receive(msg, this.id) : this.tp.send(msg, id));
    try {
      const [sim, { Battle }] = await Promise.all([import('../vendor/sim.js'), import('./battle-core.js')]);
      this.battles.set(rid, new Battle(sim, { id: rid, players: [a, b], seed, send, onEnd: () => setTimeout(() => this.battles.delete(rid), 60000) }));
    } catch (e) {
      for (const x of [a, b]) send(x.id, { t: 'battle', rid, ev: 'error', error: 'Combat impossible : ' + e.message });
    }
  }

  async measure() {
    const first = [...this.peers][0];
    if (!first) return;
    try { const ms = await this.tp.ping(first); this.emit({ t: 'ping', ms: Math.round(ms) }); } catch {}
  }
}
