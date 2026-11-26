// Tests du serveur de rooms : 3 clients, relais, cache pour les arrivants, unicast, limite de débit.
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { createServer } = require('./server');
const PORT = 3998;

function client() {
  return new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT);
    ws.inbox = []; ws.waiters = [];
    ws.on('message', d => { const m = JSON.parse(d); const w = ws.waiters.findIndex(x => x.pred(m)); if (w >= 0) ws.waiters.splice(w, 1)[0].res(m); else ws.inbox.push(m); });
    ws.next = (pred = () => true, ms = 2000) => new Promise((res, rej) => {
      const i = ws.inbox.findIndex(pred); if (i >= 0) return res(ws.inbox.splice(i, 1)[0]);
      const t = setTimeout(() => rej(new Error('timeout')), ms); ws.waiters.push({ pred, res: m => { clearTimeout(t); res(m); } });
    });
    ws.j = m => ws.send(JSON.stringify(m));
    ws.on('open', () => res(ws));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise(r => http.get('http://127.0.0.1:' + PORT + p, x => r(x.statusCode)));

(async () => {
  const { server } = await createServer({ port: PORT });
  const A = await client(); A.j({ t: 'create' });
  const ja = await A.next(m => m.t === 'joined'); assert.match(ja.code, /^[A-Z2-9]{6}$/);
  A.j({ t: 'hello', profile: { name: 'Alex', base: 'lucas', colors: { hat: '#8b5cf6' } }, team: [{ species: 390 }] });
  A.j({ t: 'follower', out: true, species: 390 });
  await sleep(50);

  const B = await client(); B.j({ t: 'join', code: ja.code.toLowerCase() });
  const jb = await B.next(m => m.t === 'joined'); assert.deepStrictEqual(jb.peers, [ja.id]);
  const hb = await B.next(m => m.t === 'hello'); assert.strictEqual(hb.profile.name, 'Alex'); assert.strictEqual(hb.from, ja.id);
  const fb = await B.next(m => m.t === 'follower'); assert.strictEqual(fb.species, 390); assert.strictEqual(fb.instant, true);

  const C = await client(); C.j({ t: 'join', code: ja.code }); await C.next(m => m.t === 'joined');

  B.j({ t: 'state', map: 411, x: 1848, y: 16, z: 14216, face: 3, tx: 115, tz: 888 });
  const sa = await A.next(m => m.t === 'state'); assert.strictEqual(sa.from, jb.id); assert.strictEqual(sa.tx, 115);
  await C.next(m => m.t === 'state');

  A.j({ t: 'req', rid: 'r1', kind: 'trade', to: jb.id });
  const rb = await B.next(m => m.t === 'req'); assert.strictEqual(rb.kind, 'trade');
  await assert.rejects(C.next(m => m.t === 'req', 300), /timeout/); // unicast : C ne voit rien
  B.j({ t: 'res', rid: 'r1', accept: true, to: ja.id });
  assert.strictEqual((await A.next(m => m.t === 'res')).accept, true);

  A.j({ t: 'ping', c: 42 }); assert.strictEqual((await A.next(m => m.t === 'pong')).c, 42);
  A.j({ t: 'evil', x: 1 }); await assert.rejects(B.next(m => m.t === 'evil', 200), /timeout/); // type inconnu ignoré

  for (let i = 0; i < 200; i++) A.j({ t: 'emote', kind: 'heart', i });
  await sleep(300);
  const got = B.inbox.filter(m => m.t === 'emote').length;
  assert.ok(got <= 90 && got > 50, 'limite de débit : ' + got);

  assert.strictEqual(await get('/_local/pt.nds'), 404);
  assert.strictEqual(await get('/js/app.js'), 200);

  B.close(); const lv = await A.next(m => m.t === 'leave'); assert.strictEqual(lv.from, jb.id);
  console.log('OK — 12 vérifications passées (relais, cache arrivants, unicast, ping, filtrage, débit, fichiers, départ)');
  [A, C].forEach(w => w.close()); server.close(); process.exit(0);
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
