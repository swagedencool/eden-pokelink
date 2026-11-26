// Le combat qui tourne dans le navigateur (web/js/battle-core.js + web/vendor/sim.js) doit donner exactement
// le même déroulé que le serveur historique (pokemon-showdown) : même graine, mêmes équipes, mêmes choix.
import assert from 'assert';
import { createRequire } from 'module';
import * as sim from '../web/vendor/sim.js';
import { Battle as BrowserBattle } from '../web/js/battle-core.js';
const require = createRequire(import.meta.url);
const { Battle: ServerBattle } = require('./battle.js');
const teams = require('./fixtures/teams.json');
const [A, B] = Object.values(teams).map(t => t.slice(0, 3));

async function play(make) {
  const log = [], ends = {};
  let battle;
  const send = (id, m) => {
    if (m.ev === 'log') { if (id === 'a') log.push(...m.lines); }
    if (m.ev === 'request' && !m.request.wait) {
      const r = m.request;
      // choix déterministe : 1re attaque utilisable, sinon le 1er Pokémon valide
      let c = 'default';
      if (r.forceSwitch) { const i = r.side.pokemon.findIndex(p => !p.active && !p.condition.endsWith(' fnt')); c = i >= 0 ? `switch ${i + 1}` : 'default'; }
      else if (r.active) { const k = r.active[0].moves.findIndex(x => !x.disabled); c = k >= 0 ? `move ${k + 1}` : 'default'; }
      setTimeout(() => battle.choose(id, c), 0);
    }
    if (m.ev === 'end') ends[id] = m;
  };
  battle = make(send);
  for (let i = 0; i < 2000 && Object.keys(ends).length < 2; i++) await new Promise(r => setTimeout(r, 2));
  return { log: log.filter(l => !l.startsWith('|t:|') && !l.startsWith('|gametype') && !l.startsWith('|gen|')), ends };
}
const players = [{ id: 'a', name: 'Mattia', team: A }, { id: 'b', name: 'Nova', team: B }];
const seed = [16, 112, 1234, 42];
const srv = await play(send => new ServerBattle({ id: 'x', players, send, seed }));
const web = await play(send => new BrowserBattle(sim, { id: 'x', players, send, seed }));
assert(srv.ends.a && web.ends.a, 'les deux combats se terminent');
assert.strictEqual(web.ends.a.winner, srv.ends.a.winner, 'même vainqueur');
assert.deepStrictEqual(web.ends.a.team, srv.ends.a.team, 'mêmes PV restants');
const core = l => l.filter(x => /^\|(move|-damage|faint|switch|turn|win|-crit|-supereffective)\|/.test(x));
assert.deepStrictEqual(core(web.log), core(srv.log), 'même déroulé, coup par coup');
console.log(`OK — combat dans le navigateur identique au serveur : ${core(web.log).filter(l => l.startsWith('|turn|')).length} tours, vainqueur ${web.ends.a.winner}`);
process.exit(0);
