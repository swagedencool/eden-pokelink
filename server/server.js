// PokéLink — serveur de rooms : seulement de petits messages JSON entre joueurs (jamais de ROM ni de sauvegarde).
// Seule exception, l'atelier ROM (workshop.js) : la ROM y passe le temps de la randomisation, puis est supprimée.
// Relais : un message avec `to` va à un seul joueur, sinon à toute la room (sauf l'expéditeur).
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Battle } = require('./battle');
const { createWorkshop } = require('./workshop');

const TYPES = new Set(['hello', 'profile', 'state', 'follower', 'emote', 'req', 'res', 'trade', 'ping', 'battle-team', 'battle-choice', 'run-config', 'rules', 'soul']);
const MAX_PARTY = 6;
const MAX_PER_ROOM = 8, MAX_MSG = 8 * 1024, RATE = 90; // messages / seconde / joueur
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createServer({ port = 3000, staticDir = path.join(__dirname, '..', 'web'), workshop = {} } = {}) {
  const app = express();
  app.use((req, res, next) => (req.path.startsWith('/_local') ? res.sendStatus(404) : next())); // jamais de fichiers de test
  const atelier = workshop ? createWorkshop(workshop) : null;
  if (atelier) atelier.routes(app);
  app.use(express.static(staticDir));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });
  const rooms = new Map(); // code -> { clients: Map<id, ws>, cache: Map<id, {hello, follower}>, battles: Map<rid, Battle>, pending: Map<rid, {}> }
  let nextId = 1;

  const code = () => { let c; do c = Array.from({ length: 6 }, () => ALPHABET[(Math.random() * ALPHABET.length) | 0]).join(''); while (rooms.has(c)); return c; };
  const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

  wss.on('connection', ws => {
    ws.alive = true; ws.on('pong', () => (ws.alive = true));
    ws.bucket = { t: Date.now(), n: 0 };
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      const now = Date.now();
      if (now - ws.bucket.t > 1000) ws.bucket = { t: now, n: 0 };
      if (++ws.bucket.n > RATE) return; // trop de messages : ignorés

      if (m.t === 'create' || m.t === 'join') {
        if (ws.room) return;
        const c = m.t === 'create' ? code() : String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (m.t === 'create') rooms.set(c, { clients: new Map(), cache: new Map(), battles: new Map(), pending: new Map() });
        const room = rooms.get(c);
        if (!room) return send(ws, { t: 'error', error: 'Room introuvable' });
        if (room.clients.size >= MAX_PER_ROOM) return send(ws, { t: 'error', error: 'Room pleine' });
        ws.id = 'p' + nextId++; ws.room = c;
        room.clients.set(ws.id, ws); delete room.emptyAt;
        send(ws, { t: 'joined', code: c, id: ws.id, peers: [...room.clients.keys()].filter(i => i !== ws.id) });
        // un joueur qui arrive reçoit tout de suite le profil et le Pokémon sorti des autres
        for (const [id, c2] of room.cache) {
          if (c2.hello) send(ws, { ...c2.hello, from: id });
          if (c2.follower) send(ws, { ...c2.follower, from: id, instant: true });
          if (c2.soul) send(ws, { ...c2.soul, from: id });
        }
        if (room.run) send(ws, room.run);            // la configuration de run partagée par l'hôte
        if (room.rules) send(ws, room.rules);        // règles en vigueur (Âmes liées, plafond de niveau)
        return;
      }
      const room = rooms.get(ws.room);
      if (!room || !TYPES.has(m.t)) return;
      const out = { ...m, from: ws.id };
      if (m.t === 'hello' || m.t === 'profile') { const c2 = room.cache.get(ws.id) || {}; c2.hello = { t: 'hello', profile: m.profile, team: m.team }; room.cache.set(ws.id, c2); }
      if (m.t === 'follower') { const c2 = room.cache.get(ws.id) || {}; c2.follower = m.out ? { t: 'follower', out: true, species: m.species } : null; room.cache.set(ws.id, c2); }
      if (m.t === 'soul') { const c2 = room.cache.get(ws.id) || {}; c2.soul = { t: 'soul', name: m.name, mons: m.mons, dead: m.dead }; room.cache.set(ws.id, c2); }
      if (m.t === 'rules') room.rules = { t: 'rules', rules: m.rules, by: m.by, from: ws.id };
      if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c });
      if (m.t === 'run-config') {                  // réglages + graine de la run, gardés pour les joueurs qui arrivent après
        if (JSON.stringify(m.run || {}).length > 6000) return;
        room.run = { t: 'run-config', run: m.run, from: ws.id };
      }
      if (m.t === 'battle-team') return joinBattle(room, ws, m);
      if (m.t === 'battle-choice') return room.battles.get(m.rid)?.choose(ws.id, String(m.choice || ''));
      if (m.to) { const dest = room.clients.get(m.to); if (dest) send(dest, out); return; }
      for (const [id, c2] of room.clients) if (id !== ws.id) send(c2, out);
    });
    ws.on('close', () => {
      const room = rooms.get(ws.room);
      if (!room) return;
      for (const b of room.battles.values()) if (!b.ended && b.sides[ws.id]) b.choose(ws.id, 'forfeit');
      room.clients.delete(ws.id); room.cache.delete(ws.id);
      for (const c2 of room.clients.values()) send(c2, { t: 'leave', from: ws.id });
      if (!room.clients.size) room.emptyAt = Date.now();
    });
  });

  /** Les deux joueurs envoient leur équipe ; le combat démarre quand les deux sont là. */
  function joinBattle(room, ws, m) {
    const rid = String(m.rid || '').slice(0, 64);
    if (!rid || room.battles.has(rid) || !Array.isArray(m.team) || !m.team.length || m.team.length > MAX_PARTY) return;
    const p = room.pending.get(rid) || {};
    p[ws.id] = { id: ws.id, name: String(m.name || 'Dresseur').slice(0, 18), team: m.team, opponent: m.opponent, seed: m.seed };
    room.pending.set(rid, p);
    const ids = Object.keys(p);
    if (ids.length < 2) return;
    const [a, b] = ids.map(i => p[i]);
    if (a.opponent !== b.id || b.opponent !== a.id) return send(ws, { t: 'error', error: 'Adversaire incohérent' });
    room.pending.delete(rid);
    const seed = Array.isArray(a.seed) && a.seed.length === 4 ? a.seed.map(Number) : undefined;
    try {
      room.battles.set(rid, new Battle({ id: rid, players: [a, b], seed, send: (id, msg) => { const c = room.clients.get(id); if (c) send(c, msg); }, onEnd: () => setTimeout(() => room.battles.delete(rid), 60000) }));
    } catch (e) { for (const x of [a, b]) { const c = room.clients.get(x.id); if (c) send(c, { t: 'error', error: 'Combat impossible : ' + e.message }); } }
  }

  const timer = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
    for (const [c, r] of rooms) if (!r.clients.size && Date.now() - r.emptyAt > 3600e3) rooms.delete(c);
  }, 30000);
  server.on('close', () => clearInterval(timer));
  server.on('close', () => atelier?.close());
  return new Promise(res => server.listen(port, () => res({ server, wss, rooms, atelier })));
}

if (require.main === module) createServer({ port: +process.env.PORT || 3000 }).then(() => console.log('PokéLink sur http://localhost:' + (process.env.PORT || 3000)));
module.exports = { createServer };
