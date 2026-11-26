// Règles de la room : Âmes liées (liens, K.O. qui se propagent, Pokémon morts gardés K.O.) et plafond de niveau
// (correctif du code du jeu, posé puis retiré). Pokémon et mémoire synthétiques : aucune ROM nécessaire.
import assert from 'assert';
import { crypt, decodeParty, PARTY } from '../web/js/pk4.js';
import { soulGroups, autoCap, RoomRules, DEFAULT_RULES } from '../web/js/rules.js';
import { PlatinumGame, PROFILES } from '../web/js/emu/platinum.js';
import { createRequire } from 'module';

globalThis.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); } };

// ------------------------------------------------------------------ Pokémon synthétiques (format 4G)
const ORDER = [[0,1,2,3],[0,1,3,2],[0,2,1,3],[0,3,1,2],[0,2,3,1],[0,3,2,1],[1,0,2,3],[1,0,3,2],[2,0,1,3],[3,0,1,2],[2,0,3,1],[3,0,2,1],
  [1,2,0,3],[1,3,0,2],[2,1,0,3],[3,1,0,2],[2,3,0,1],[3,2,0,1],[1,2,3,0],[1,3,2,0],[2,1,3,0],[3,1,2,0],[2,3,1,0],[3,2,1,0]];
const w16 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
function mon(pid, species, loc, hp) {
  const plain = new Uint8Array(128), pos = ORDER[((pid & 0x3e000) >>> 13) % 24];
  const A = pos[0] * 32, B = pos[1] * 32, C = pos[2] * 32;
  w16(plain, A, species); w16(plain, B + 0x1e, loc);
  for (let i = 0; i < 11; i++) w16(plain, C + i * 2, i === 0 ? 0x012b : 0xffff);   // surnom court
  let chk = 0; for (let i = 0; i < 128; i += 2) chk = (chk + (plain[i] | (plain[i + 1] << 8))) & 0xffff;
  const raw = new Uint8Array(236);
  raw[0] = pid & 0xff; raw[1] = (pid >> 8) & 0xff; raw[2] = (pid >> 16) & 0xff; raw[3] = pid >>> 24; w16(raw, 6, chk);
  raw.set(crypt(plain, chk), 8);
  const P = new Uint8Array(100); P[4] = 30; w16(P, 6, hp); w16(P, 8, 100);
  raw.set(crypt(P, pid), 136);
  return raw;
}
const party = mons => { const r = new Uint8Array(4 + 6 * 236); r[0] = mons.length; mons.forEach((m, i) => r.set(m, 4 + i * 236)); return r; };

// ------------------------------------------------------------------ groupes et plafond automatique
const me = { id: 'me', name: 'Mattia', mons: [{ uid: 'a', loc: 16 }, { uid: 'b', loc: 18 }, { uid: 'c', loc: 16 }], dead: new Set() };
const nova = { id: 'n', name: 'Nova', mons: [{ uid: 'z', loc: 16 }, { uid: 'y', loc: 48 }], dead: new Set(['z']) };
const g = soulGroups([me, nova]);
assert.strictEqual(g.length, 1, 'un seul lieu commun');
assert.deepStrictEqual(g[0].members.map(x => x.mon.uid), ['a', 'z'], 'le premier Pokémon de chaque joueur pour ce lieu');
assert(g[0].dead, 'le K.O. de Nova rend le groupe mort');
const bosses = [14, 22, 26, 32, 37, 41, 44, 50, 62].map((level, i) => ({ name: 'B' + i, level }));
assert.strictEqual(autoCap(bosses, 0, false).level, 14);
assert.strictEqual(autoCap(bosses, 0b111, false).level, 32, '3 badges : 4e champion');
assert.strictEqual(autoCap(bosses, 0xff, false).level, 62, '8 badges : Ligue');
assert.strictEqual(autoCap(bosses, 0xff, true).level, 100, 'Ligue terminée : aucun plafond');

// ------------------------------------------------------------------ moteur de règles avec un faux jeu
const sent = [], toasts = [];
let ram = party([mon(0x11111111, 390, 16, 50), mon(0x22222222, 403, 18, 60), mon(0x11111111, 407, 48, 70)]);
const U = [0, 1, 2].map(i => decodeParty(ram)[i].uid);
assert.strictEqual(new Set(U).size, 3, 'deux Pokémon au même PID gardent des identités distinctes');
const writes = [];
const game = {
  readPartyRaw: () => ram, state: () => ({ field: true }), badges: () => 0b11, storyCleared: () => false, caps: [],
  setLevelCap(l) { this.caps.push(l); },
  writePartyMon(slot, bytes) { writes.push(slot); ram = ram.slice(); ram.set(bytes, 4 + slot * 236); },
};
const app = { game, gd: null, me: { profile: { name: 'Mattia' } }, peers: new Map(), net: { send: (t, m) => sent.push({ t, ...m }) }, ui: { toasts: { show: t => toasts.push(t.title) } } };
const rules = new RoomRules(app, { bosses });
rules.tick();
assert.strictEqual(game.caps.at(-1), null, 'aucun plafond par défaut');
rules.set({ levelCap: true });
rules.tick();
assert.strictEqual(game.caps.at(-1), 26, 'plafond automatique : 2 badges → 3e champion');
rules.set({ capMode: 'manual', capValue: 40 }); rules.tick();
assert.strictEqual(game.caps.at(-1), 40, 'plafond fixé');
rules.set({ levelCap: false }); rules.tick();
assert.strictEqual(game.caps.at(-1), null, 'plafond retiré');

rules.set({ soulLink: true }); rules.tick();
rules.peerSoul('n', { name: 'Nova', mons: [{ uid: 'z', species: 393, name: 'Tiplouf', loc: 16 }], dead: ['z'] });
rules.tick();
assert(rules.dead.has(U[0]), 'le Pokémon lié (même lieu) tombe avec celui de Nova');
assert.deepStrictEqual(writes, [0], 'il est mis K.O. dans la partie');
assert.strictEqual(decodeParty(ram)[0].hp, 0);
assert.strictEqual(decodeParty(ram)[1].hp, 60, 'le Pokémon non lié est intact');
assert.strictEqual(decodeParty(ram)[2].hp, 70, 'même PID, autre Pokémon : intact');
assert(sent.some(m => m.t === 'soul' && m.dead.includes(U[0])), 'la room est prévenue');
// soigné au Centre Pokémon : il redevient K.O.
ram = party([mon(0x11111111, 390, 16, 100), mon(0x22222222, 403, 18, 60), mon(0x11111111, 407, 48, 70)]);
rules.tick();
assert.strictEqual(decodeParty(ram)[0].hp, 0, 'un Pokémon mort reste K.O.');
assert.strictEqual(decodeParty(ram)[2].hp, 70);
// K.O. de mon Pokémon de la Route 203 : détecté et annoncé
ram = party([mon(0x11111111, 390, 16, 0), mon(0x22222222, 403, 18, 0)]);
rules.tick();
assert(rules.dead.has(U[1]), 'K.O. pendant la règle = mort');
// règle coupée : plus rien n'est forcé
rules.set({ soulLink: false });
ram = party([mon(0x11111111, 390, 16, 100), mon(0x22222222, 403, 18, 60)]);
const before = writes.length; rules.tick();
assert.strictEqual(writes.length, before, 'Âmes liées coupées : aucune écriture');
// réception des règles d'un ami
rules.receive({ rules: { ...DEFAULT_RULES, soulLink: true }, by: 'Nova' });
assert(rules.state.soulLink && toasts.some(t => /Nova a activé les Âmes liées/.test(t)), 'changement d’un ami appliqué et annoncé');

// ------------------------------------------------------------------ correctif du code (mémoire DS simulée)
const heap = new Uint8Array(0x400000);
const put = (a, hex) => heap.set(Uint8Array.from(hex.match(/../g).map(x => parseInt(x, 16))), a - 0x02000000);
for (const c of PROFILES.CPUF.levelChecks) { put(c.at, c.sig); heap.set(c.orig, c.at + 8 - 0x02000000); }
const pg = Object.create(PlatinumGame.prototype);
Object.assign(pg, { host: { heap }, base: 0, header: [heap[0x3ffe00]], profile: PROFILES.CPUF });
pg.setLevelCap(50);
const at = (a, n = 4) => Array.from(heap.subarray(a - 0x02000000, a - 0x02000000 + n));
assert.deepStrictEqual(at(0x022492f0), [50, 0x28, 0x00, 0xd3], 'EXP en combat : cmp #50 ; bcc');
assert.deepStrictEqual(at(0x021e66c0), [50, 0x28, 0x13, 0xd2], 'Pension : cmp #50 ; bhs');
assert.deepStrictEqual(at(0x0209660e), [50, 0x28, 0x05, 0xd2], 'Super Bonbon : cmp #50');
pg.setLevelCap(null);
for (const c of PROFILES.CPUF.levelChecks) assert.deepStrictEqual(at(c.at + 8), c.orig, 'code d’origine remis');
heap.fill(0, 0x022492e8 - 0x02000000, 0x022492e8 - 0x02000000 + 8);           // overlay de combat absent
pg.setLevelCap(50);
assert.deepStrictEqual(at(0x022492f0), [0x64, 0x28, 0x00, 0xd1], 'rien n’est écrit si le code n’est pas en mémoire');

// ------------------------------------------------------------------ serveur : règles et liens donnés aux arrivants
const require = createRequire(import.meta.url);
const { createServer } = require('./server.js');
const WebSocket = require('ws');
const { server } = await createServer({ port: 0, workshop: false });
const url = `ws://127.0.0.1:${server.address().port}`;
const client = () => new Promise(res => { const ws = new WebSocket(url); const inbox = []; ws.on('message', d => inbox.push(JSON.parse(d))); ws.on('open', () => res({ ws, inbox, send: m => ws.send(JSON.stringify(m)) })); });
const wait = (c, f) => new Promise((res, rej) => { const t0 = Date.now(); const loop = () => { const m = c.inbox.find(f); if (m) res(m); else if (Date.now() - t0 > 3000) rej(new Error('message absent')); else setTimeout(loop, 10); }; loop(); });
const A = await client(); A.send({ t: 'create' });
const code = (await wait(A, m => m.t === 'joined')).code;
A.send({ t: 'rules', rules: { ...DEFAULT_RULES, soulLink: true, levelCap: true }, by: 'Mattia' });
A.send({ t: 'soul', name: 'Mattia', mons: [{ uid: 'a', species: 390, name: 'Ouisticram', loc: 16 }], dead: [] });
await new Promise(r => setTimeout(r, 100));
const B = await client(); B.send({ t: 'join', code });
const r = await wait(B, m => m.t === 'rules'), so = await wait(B, m => m.t === 'soul');
assert(r.rules.soulLink && r.by === 'Mattia' && so.mons[0].loc === 16, 'un arrivant reçoit les règles et les liens');
A.ws.close(); B.ws.close(); server.close();

console.log('OK — règles : âmes liées (liens, K.O. propagés, morts gardés K.O., règle coupée), plafond (auto, fixe, retiré, code du jeu), transmis aux arrivants');
