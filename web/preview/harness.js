// Banc de démonstration : le vrai jeu (ta ROM + ta sauvegarde, DeSmuME piloté par Python image par image)
// + la vraie interface. Les touches « utilisateur » sont de vrais KeyboardEvent qui passent par le routeur
// d'entrées ; l'équipe est lue dans la mémoire du jeu ; les écritures (échange, résultat du combat) y retournent.
// L'ami est simulé côté réseau (sa position vient d'une 2e instance du jeu) ; ses combats passent par
// le vrai serveur (simulateur Showdown) via deux vraies connexions WebSocket.
import { NdsRom, loadAssets } from '../js/rom.js';
import { ICON_PALETTES } from '../js/data/icon-palettes.js';
import { loadGameData, decodeString } from '../js/gamedata.js';
import { decodeMon, toBattleSet, PartyMirror } from '../js/pk4.js';
import { PokeLinkApp } from '../js/app.js';
import { RoomClient } from '../js/net.js';
import { BattleView } from '../js/battle-ui.js';
import { chooseFor } from './policy.js';

const FPS = 60, FRIEND_T0 = 20, SEED = [16, 112, 1234, 42];
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const tob64 = u8 => { let s = ''; for (const v of u8) s += String.fromCharCode(v); return btoa(s); };

class HarnessGame {
  constructor() {
    const mk = () => Object.assign(document.createElement('canvas'), { width: 256, height: 192 });
    this.topCanvas = mk(); this.bottomCanvas = mk();
    this._state = null; this.patches = []; this.playerBase = 'lucas'; this.mirror = new PartyMirror(); this.headers = null;
  }
  state() { return this._state; }
  readPartyRaw() { return this.mirror.bytes; }
  /** Écrit un Pokémon d'équipe (236 octets) dans la sauvegarde vivante du jeu (appliqué sur une image stable). */
  writePartyMon(slot, bytes) {
    this.patches.push({ kind: 'mem', rel: 0xb4 + slot * 236, data: tob64(bytes) });
    this.mirror.write(slot, bytes); // vue immédiate côté interface
  }
  mapInfo(map) { const h = this.headers; return h && map * 24 + 24 <= h.length ? { label: h[map * 24 + 0x12], cam: h[map * 24 + 0x15], matrix: h[map * 24 + 2] | (h[map * 24 + 3] << 8) } : null; }
  patchRom(offset, colors) { this.patches.push({ offset, colors }); }
  blit(canvas, s) { canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(b64(s).buffer), 256, 192), 0, 0); }
}

/** Serveur + client de l'ami simulés en mémoire, sauf les combats (vrai serveur). */
class MockRoom {
  constructor() { this.id = 'me'; this.h = new Map(); this.inbox = []; this.f = 0; }
  on(t, f) { (this.h.get(t) || this.h.set(t, []).get(t)).push(f); }
  send(t, d) { this.onSend?.(t, d); }
  deliver(t, d, delay = 3) { this.inbox.push({ at: this.f + delay, t, d: { from: 'ami', ...d } }); }
  pump(f) {
    this.f = f;
    const due = this.inbox.filter(m => m.at <= f); this.inbox = this.inbox.filter(m => m.at > f);
    for (const m of due) (this.h.get(m.t) || []).forEach(fn => fn(m.d));
  }
}

export async function boot() {
  const rom = new NdsRom(await (await fetch('../_local/pt.nds')).arrayBuffer());
  const sav = new Uint8Array(await (await fetch('../_local/pt.sav')).arrayBuffer());
  const assets = loadAssets(rom, ICON_PALETTES), gd = loadGameData(rom);
  const track = await (await fetch('friend-track.json')).json();
  // L'ami : son équipe vient des boîtes de la même sauvegarde (pour la démo)
  const boxRaw = (b, s) => sav.subarray(0xcf2c + 4 + ((b - 1) * 30 + s) * 0x88, 0xcf2c + 4 + ((b - 1) * 30 + s + 1) * 0x88);
  const friendRaw = [[4, 3], [5, 28], [12, 19], [16, 8], [16, 1], [13, 15]].map(([b, s]) => boxRaw(b, s));
  const friendTeam = friendRaw.map(r => decodeMon(r, gd));
  const game = new HarnessGame(), net = new MockRoom();
  window.PL = { ready: false };
  let app = null, friend = { name: 'Ami', base: 'aurore', colors: {}, buddy: 393 };
  const summary = t => t.map(({ species, name, level, gender, hp, maxhp }) => ({ species, name, level, gender, hp: hp ?? 1, maxhp: maxhp ?? 1 }));

  // Vraies connexions au serveur de rooms, pour le combat
  const WS = 'ws://127.0.0.1:3000';
  const meReal = new RoomClient(), friendReal = new RoomClient();
  const joined = await meReal.connect(WS, 'create');
  await friendReal.connect(WS, 'join', joined.code);
  let rid = null;
  const battleRid = 'ami-1-battle';

  // ---- scénario (frames du jeu à 60 i/s) ----
  const T = [];
  const at = (f, fn) => T.push({ f, fn });
  const dispatch = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  const key = (f, code, hold = 6) => { at(f, () => dispatch('keydown', code)); at(f + hold, () => dispatch('keyup', code)); };
  let F = 0, END = Infinity, ti = 0;
  const resort = () => { T.sort((a, b) => a.f - b.f); ti = T.findIndex(x => x.f > F); if (ti < 0) ti = T.length; };

  at(1, () => net.deliver('hello', { profile: friend, team: summary(friendTeam) }, 0));
  at(2, () => net.deliver('follower', { out: true, species: 393, instant: true }, 0));
  key(150, 'KeyP');                                                   // sortir son Pokémon
  key(262, 'ArrowLeft', 10);                                          // se tourner vers l'ami (il est solide)
  key(330, 'KeyX');                                                   // A : interagir
  key(385, 'ArrowDown');                                              // → Échanger
  key(425, 'KeyX');
  at(505, () => net.deliver('res', { rid, accept: true }));
  at(600, () => net.deliver('trade', { rid, action: 'cursor', slot: 1 }));
  key(612, 'ArrowDown'); key(632, 'ArrowRight');                      // curseur sur Drip
  at(645, () => net.deliver('trade', { rid, action: 'cursor', slot: 2 }));
  key(664, 'KeyX');                                                   // je propose Drip
  at(692, () => net.deliver('trade', { rid, action: 'pick', slot: 2 })); // l'ami propose MILOBELLUS
  key(764, 'KeyX');                                                   // je confirme
  at(792, () => net.deliver('trade', { rid, action: 'data', raw: tob64(friendRaw[2]) }));
  at(815, () => net.deliver('trade', { rid, action: 'confirm' }));
  at(1040, () => net.deliver('emote', { kind: 'heart' }));
  at(1130, () => { friend = { ...friend, name: 'Nova' }; net.deliver('profile', { profile: friend }); });
  at(1220, () => { friend = { ...friend, colors: { hat: '#8b5cf6', coat: '#14b8a6', hair: '#f472b6', detail: '#fde047' } }; net.deliver('profile', { profile: friend }); });
  key(1330, 'KeyC');                                                  // mon personnage
  key(1372, 'ArrowDown'); key(1400, 'ArrowDown');                     // Personnage → Béret
  for (let i = 0; i < 7; i++) key(1424 + i * 14, 'ArrowRight', 4);    // violet
  key(1540, 'ArrowDown'); for (let i = 0; i < 5; i++) key(1560 + i * 14, 'ArrowRight', 4); // Manteau sarcelle
  key(1650, 'ArrowDown'); for (let i = 0; i < 3; i++) key(1670 + i * 14, 'ArrowRight', 4); // Détails jaune
  key(1730, 'ArrowDown'); key(1746, 'ArrowDown'); key(1780, 'KeyX'); // Enregistrer
  at(1870, () => net.deliver('req', { rid: battleRid, kind: 'battle' })); // Nova lance un défi
  key(1965, 'KeyX');                                                  // accepter

  // Ce que la simulation envoie au serveur : l'échange (côté ami) et le combat (vrai serveur)
  net.onSend = (t, d) => {
    if (t === 'req') rid = d.rid;
    if (t === 'trade' && d.action === 'data') friendTeam[2] = decodeMon(b64(d.raw), gd); // l'ami reçoit Drip
    if (t === 'battle-team') {
      meReal.send('battle-team', { ...d, opponent: friendReal.id, seed: SEED });
      friendReal.send('battle-team', { rid: d.rid, name: friend.name, team: friendTeam.slice(0, 3).map(toBattleSet), opponent: meReal.id, seed: SEED });
    }
    if (t === 'battle-choice') meReal.send('battle-choice', d);
  };
  meReal.on('battle', m => (net.h.get('battle') || []).forEach(fn => fn(m)));
  // L'ami joue avec la même politique que la simulation hors ligne
  let fNames = null, myActive = 0;
  friendReal.on('battle', m => {
    if (m.ev === 'start') fNames = m.names;
    if (m.ev === 'log') for (const l of m.lines) { const p = l.split('|'); if (p[1] === 'switch' && p[2].startsWith('p1')) myActive = fNames.species[p[3].split(', ')[0]]; }
    if (m.ev === 'request') { const c = chooseFor(m.request, fNames, gd, myActive); if (c) { at(F + 50, () => friendReal.send('battle-choice', { rid: m.rid, choice: c })); resort(); } }
  });

  // Mes choix pendant le combat : la même politique, mais en appuyant sur les touches de l'interface
  let planned = null, after = null;
  const planBattle = () => {
    const v = app.battle?.view;
    if (!v || !v.lastReq || planned === v.lastReq || (v.cur !== 'act' && v.cur !== 'switch')) return;
    planned = v.lastReq;
    const c = chooseFor(v.lastReq, v.names, gd, v.state[v.foeSide].active?.num || 0);
    if (!c) return;
    const seq = [];
    if (c.startsWith('move')) {
      // plus court chemin au D-pad, en utilisant exactement la même règle de navigation que l'interface
      const target = [0, 1, 3, 4][+c.split(' ')[1] - 1];
      const KEYS = { UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' };
      const prev = new Map([[v.sel, null]]), q = [v.sel];
      while (q.length && !prev.has(target)) { const s = q.shift(); for (const k of Object.keys(KEYS)) { const n = BattleView.step(v.grid, s, k); if (!prev.has(n)) { prev.set(n, [s, k]); q.push(n); } } }
      const path = []; for (let s = target; prev.get(s); s = prev.get(s)[0]) path.unshift(KEYS[prev.get(s)[1]]);
      seq.push(...path);
    } else {
      const target = +c.split(' ')[1] - 1; let sel = v.sel, guard = 0;
      while (sel !== target && guard++ < 6) { seq.push('ArrowRight'); do sel = (sel + 1) % v.cards.length; while (v.cards[sel].off); }
    }
    seq.push('KeyX');
    seq.forEach((k, i) => key(F + 55 + i * 16, k, 5));
    resort();
  };
  T.sort((a, b) => a.f - b.f);

  let lastFriend = -1;
  const DS = new Set(['A', 'B', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'START', 'SELECT', 'X', 'Y', 'L', 'R']);
  Object.assign(window.PL, {
    tick(f) {
      F = f;
      if (!app) return [];
      if (f >= END) return null;
      while (ti < T.length && T[ti].f <= f) T[ti++].fn();
      const k = f - FRIEND_T0;
      if (k >= 0 && f - lastFriend >= 4) { const s = track[Math.min(k, track.length - 1)]; net.deliver('state', { map: s.map, x: s.x, y: s.y, z: s.z, face: s.face, tx: s.tx, tz: s.tz }, 2); lastFriend = f; }
      if (f % 30 === 0) net.deliver('ping', { ms: 28 + ((f / 30) % 5) }, 0);
      net.pump(f);
      planBattle();
      // après le combat : ouvrir le menu Pokémon du jeu pour voir le résultat écrit dans la partie
      if (!after && app.lastBattleEnd) {
        after = f;
        key(f + 220, 'Enter', 6); key(f + 270, 'ArrowDown', 6); key(f + 300, 'KeyX', 6);
        resort();
        END = f + 600;
      }
      return [...app.input.frameKeys()].filter(x => DS.has(x));
    },
    present(f, state, top, bottom, party, extra) {
      if (top) game.blit(game.topCanvas, top);
      if (bottom) game.blit(game.bottomCanvas, bottom);
      if (party) game.mirror.ingest(b64(party));
      if (extra) {
        game.headers = b64(extra.headers);
        const trainer = decodeString(b64(extra.trainer), 0, 8);
        app = new PokeLinkApp({ root: document.getElementById('root'), assets, gd, game, net, room: joined.code,
          profile: { name: trainer, base: 'lucas', colors: {}, buddy: 392 } });
        app.battleSeed = SEED; window.PL.app = app;
        const orig = app.applyBattleResult.bind(app);
        app.applyBattleResult = end => { orig(end); app.lastBattleEnd = end; };
      }
      game._state = state;
      if (app) app.update((f * 1000) / FPS);
      const patches = game.patches; game.patches = [];
      return patches;
    },
    perf() { const o = app.overlay.stats, a = app.perf; return { overlayAvg: o.ms / o.frames, overlayMax: o.max, updateAvg: a.ms / a.n, updateMax: a.max, frames: a.n }; },
  });
  document.title = 'ready';
}
