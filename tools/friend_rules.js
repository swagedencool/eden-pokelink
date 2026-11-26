// Ami simulé : rejoint la room, marche à côté, puis annonce que son Tiplouf de la Route 201 est tombé (Âmes liées).
const WebSocket = require('/home/claude/eden-pokelink/server/node_modules/ws');
const track = require('/home/claude/eden-pokelink/web/preview/friend-track.json');
const [code, delay] = [process.argv[2], +(process.argv[3] || 0)];
const ws = new WebSocket('ws://127.0.0.1:3000');
const send = m => ws.send(JSON.stringify(m));
ws.on('open', () => send({ t: 'join', code }));
let i = 0;
ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.t === 'joined') {
    send({ t: 'hello', profile: { name: 'Nova', base: 'aurore', colors: { hat: '#8b5cf6', coat: '#14b8a6', hair: '#f472b6', detail: '#fde047' }, buddy: 393 }, team: [{ species: 393, name: 'Tiplouf', level: 12, gender: 0, hp: 30, maxhp: 30 }] });
    send({ t: 'soul', name: 'Nova', mons: [{ uid: 'n9', species: 393, name: 'Tiplouf', loc: 16, level: 12 }, { uid: 'n10', species: 396, name: 'Étourmi', loc: 18, level: 9 }], dead: [] });
    setInterval(() => { const s = track[Math.min(i, track.length - 1)]; i += 4; send({ t: 'state', map: s.map, x: s.x, y: s.y, z: s.z, face: s.face, tx: s.tx, tz: s.tz }); }, 66);
  }
  if (m.t === 'rules' && m.rules.soulLink && !this.sent) {
    this.sent = true;
    console.log('ami : Âmes liées actives, mon Tiplouf tombe dans', delay, 'ms');
    setTimeout(() => send({ t: 'soul', name: 'Nova', mons: [{ uid: 'n9', species: 393, name: 'Tiplouf', loc: 16, level: 12 }, { uid: 'n10', species: 396, name: 'Étourmi', loc: 18, level: 9 }], dead: ['n9'] }), delay);
  }
});
setTimeout(() => process.exit(0), 900000);
