// Ami simulé pour le test de bout en bout : rejoint la room et marche à côté du joueur (trajet enregistré).
const WebSocket = require('/home/claude/eden-pokelink/server/node_modules/ws');
const track = require('/home/claude/eden-pokelink/web/preview/friend-track.json');
const code = process.argv[2];
const ws = new WebSocket('ws://127.0.0.1:3000');
const send = m => ws.send(JSON.stringify(m));
ws.on('open', () => send({ t: 'join', code }));
let i = 0;
ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.t === 'joined') {
    console.log('ami connecté', m.id);
    send({ t: 'hello', profile: { name: 'Nova', base: 'aurore', colors: { hat: '#8b5cf6', coat: '#14b8a6', hair: '#f472b6', detail: '#fde047' }, buddy: 393 }, team: [{ species: 393, name: 'Tiplouf', level: 12, gender: 0, hp: 30, maxhp: 30 }] });
    send({ t: 'follower', out: true, species: 393 });
    setInterval(() => { const s = track[Math.min(i, track.length - 1)]; i += 4; send({ t: 'state', map: s.map, x: s.x, y: s.y, z: s.z, face: s.face, tx: s.tx, tz: s.tz }); }, 66);
    setTimeout(() => send({ t: 'emote', kind: 'heart' }), 9000);
  }
});
setTimeout(() => process.exit(0), 600000);
