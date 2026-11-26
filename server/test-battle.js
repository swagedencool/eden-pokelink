// Test de bout en bout : deux joueurs, vraies équipes de la sauvegarde, combat jusqu'à la victoire.
const assert = require('assert');
const WebSocket = require('ws');
const { createServer } = require('./server');
const teams = require('./fixtures/teams.json');
const PORT = 3997;

const client = () => new Promise(res => {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT);
  ws.msgs = []; ws.j = m => ws.send(JSON.stringify(m));
  ws.on('message', d => { const m = JSON.parse(d); ws.msgs.push(m); ws.onmsg?.(m); });
  ws.on('open', () => res(ws));
});
const wait = (ws, pred, ms = 4000) => new Promise((res, rej) => {
  const f = ws.msgs.find(pred); if (f) return res(f);
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  const prev = ws.onmsg; ws.onmsg = m => { prev?.(m); if (pred(m)) { clearTimeout(t); ws.onmsg = prev; res(m); } };
});

(async () => {
  const { server } = await createServer({ port: PORT });
  const A = await client(); A.j({ t: 'create' });
  const ja = await wait(A, m => m.t === 'joined');
  const B = await client(); B.j({ t: 'join', code: ja.code });
  const jb = await wait(B, m => m.t === 'joined');
  const rid = 'test-battle-1';
  // politique simple : la première attaque disponible, ou le premier Pokémon valide si changement forcé
  const play = (ws) => ws.onmsg = m => {
    if (m.t !== 'battle' || m.ev !== 'request') return;
    const r = m.request;
    if (r.wait) return;
    if (r.forceSwitch) { const i = r.side.pokemon.findIndex(p => !p.active && !p.condition.endsWith('fnt')); return ws.j({ t: 'battle-choice', rid, choice: 'switch ' + (i + 1) }); }
    const mv = r.active[0].moves.findIndex(x => !x.disabled);
    ws.j({ t: 'battle-choice', rid, choice: 'move ' + (mv + 1) });
  };
  play(A); play(B);
  A.j({ t: 'battle-team', rid, name: 'Alex', team: teams.alex.slice(0, 3), opponent: jb.id, seed: [7, 7, 7, 7] });
  B.j({ t: 'battle-team', rid, name: 'Nova', team: teams.nova.slice(0, 3), opponent: ja.id });
  const sa = await wait(A, m => m.ev === 'start'); assert.strictEqual(sa.side, 'p1');
  assert.strictEqual(sa.names.species.Infernape, 392); assert.strictEqual(sa.names.moves['Close Combat'], 370);
  const endA = await wait(A, m => m.ev === 'end', 20000);
  const endB = await wait(B, m => m.ev === 'end', 5000);
  const turns = A.msgs.filter(m => m.ev === 'log').flatMap(m => m.lines).filter(l => l.startsWith('|turn|')).length;
  assert.ok(endA.winner === 'Alex' || endA.winner === 'Nova');
  assert.strictEqual(endA.team.length, 3); assert.ok(endA.team.every(p => p.maxhp > 0));
  const loser = endA.winner === 'Alex' ? endB : endA;
  assert.ok(loser.team.every(p => p.fainted), 'le perdant a toute son équipe K.O.');
  // choix invalides ignorés, combat terminé = plus de choix acceptés
  A.j({ t: 'battle-choice', rid, choice: 'move 9; rm -rf' });
  // Abandon : le simulateur doit recevoir une commande valide et désigner l'autre joueur vainqueur
  const rid2 = 'test-battle-2';
  A.onmsg = null; B.onmsg = null;
  A.j({ t: 'battle-team', rid: rid2, name: 'Alex', team: teams.alex.slice(0, 1), opponent: jb.id });
  B.j({ t: 'battle-team', rid: rid2, name: 'Nova', team: teams.nova.slice(0, 1), opponent: ja.id });
  await wait(A, m => m.rid === rid2 && m.ev === 'request');
  A.j({ t: 'battle-choice', rid: rid2, choice: 'forfeit' });
  const ff = await wait(B, m => m.rid === rid2 && m.ev === 'end');
  assert.strictEqual(ff.winner, 'Nova');
  // Déconnexion en plein combat : le serveur reste debout, l'adversaire gagne
  const C = await client(); C.j({ t: 'join', code: ja.code }); const jc = await wait(C, m => m.t === 'joined');
  const rid3 = 'test-battle-3';
  A.j({ t: 'battle-team', rid: rid3, name: 'Alex', team: teams.alex.slice(0, 1), opponent: jc.id });
  C.j({ t: 'battle-team', rid: rid3, name: 'Cleo', team: teams.nova.slice(0, 1), opponent: ja.id });
  await wait(A, m => m.rid === rid3 && m.ev === 'request');
  C.close();
  const dc = await wait(A, m => m.rid === rid3 && m.ev === 'end');
  assert.strictEqual(dc.winner, 'Alex');
  A.j({ t: 'ping', c: 7 }); assert.strictEqual((await wait(A, m => m.t === 'pong' && m.c === 7)).c, 7);
  // Navigation dans un menu verrouillé (Mouchoir Choix) : jamais « Abandonner » par accident
  const { BattleView } = await import('../web/js/battle-ui.js');
  const g = [{ off: true }, { off: true }, {}, {}, { off: true }, {}];
  assert.strictEqual(BattleView.step(g, 3, 'LEFT'), 3);
  assert.strictEqual(BattleView.step(g, 3, 'UP'), 2);
  assert.strictEqual(BattleView.step([{}, { off: true }, {}, { off: true }, {}, {}], 0, 'RIGHT'), 2);
  console.log(`OK — combat complet en ${turns} tours, vainqueur : ${endA.winner} · abandon et déconnexion gérés · navigation sûre`);
  console.log('Alex :', endA.team.map(p => `${p.ident.split(': ')[1]} ${p.hp}/${p.maxhp}${p.fainted ? ' K.O.' : ''}`).join(' · '));
  console.log('Nova :', endB.team.map(p => `${p.ident.split(': ')[1]} ${p.hp}/${p.maxhp}${p.fainted ? ' K.O.' : ''}`).join(' · '));
  [A, B].forEach(w => w.close()); server.close(); process.exit(0);
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
