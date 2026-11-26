// Simulation hors ligne : mêmes équipes que la preview (après l'échange Drip ⇄ MILOBELLUS), même politique.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BattleStream, getPlayerStreams, Teams } = require('pokemon-showdown');
const { toShowdown, namesFor } = require('./battle.js');
const { NdsRom } = await import('../web/js/rom.js');
const { loadGameData } = await import('../web/js/gamedata.js');
const { decodeParty, decodeMon, toBattleSet } = await import('../web/js/pk4.js');
const { chooseFor } = await import('../web/preview/policy.js');
const gd = loadGameData(new NdsRom(fs.readFileSync('/home/claude/work/pt.nds')));
const sav = new Uint8Array(fs.readFileSync('/home/claude/work/save/pt.sav'));
const party = decodeParty(sav.subarray(0x9c, 0x9c + 4 + 6 * 236), gd);
const box = (b, s) => decodeMon(sav.subarray(0xcf2c + 4 + ((b - 1) * 30 + s) * 0x88, 0xcf2c + 4 + ((b - 1) * 30 + s + 1) * 0x88), gd);
const friend = [[4, 3], [5, 28], [12, 19], [16, 8], [16, 1], [13, 15]].map(([b, s]) => box(b, s));
const mine = party.slice(); const theirs = friend.slice();
[mine[3], theirs[2]] = [theirs[2], mine[3]];                      // échange Drip ⇄ MILOBELLUS
const A = mine.slice(0, 3).map(toBattleSet), B = theirs.slice(0, 3).map(toBattleSet);
const names = namesFor([A, B]);
async function run(seed) {
  const s = new BattleStream(); const ps = getPlayerStreams(s);
  const active = { p1: 0, p2: 0 }, log = [];
  const pump = async side => { for await (const chunk of ps[side]) for (const l of chunk.split('\n')) {
    if (l.startsWith('|request|')) { const r = JSON.parse(l.slice(9)); const other = side === 'p1' ? 'p2' : 'p1'; const c = chooseFor(r, names, gd, active[other]); if (c) setTimeout(() => ps[side].write(c), 0); }
    else { if (side === 'p1') log.push(l); const p = l.split('|'); if (p[1] === 'switch') active[p[2].slice(0, 2)] = names.species[p[3].split(', ')[0]]; }
  } };
  pump('p1'); pump('p2');
  ps.omniscient.write(`>start {"formatid":"gen4customgame","seed":${JSON.stringify(seed)}}\n>player p1 {"name":"Mattia","team":${JSON.stringify(Teams.pack(A.map(toShowdown)))}}\n>player p2 {"name":"Nova","team":${JSON.stringify(Teams.pack(B.map(toShowdown)))}}`);
  for (let i = 0; i < 200 && !log.some(l => l.startsWith('|win|')); i++) await new Promise(r => setTimeout(r, 5));
  return log;
}
const results = [];
for (let k = 1; k <= 60; k++) {
  const seed = [k, k * 7 % 65536, 1234, 42];
  const log = await run(seed);
  const turns = log.filter(l => l.startsWith('|turn|')).length, win = (log.find(l => l.startsWith('|win|')) || '').slice(5);
  const se = log.filter(l => l.startsWith('|-supereffective')).length, crit = log.filter(l => l.startsWith('|-crit')).length, faint = log.filter(l => l.startsWith('|faint')).length;
  const lines = log.filter(l => /^\|(move|-supereffective|-crit|faint|-resisted|-immune|switch|-miss)\|/.test(l)).length;
  results.push({ seed, turns, win, se, crit, faint, lines });
}
const good = results.filter(r => r.win === 'Mattia').sort((a, b) => a.lines - b.lines);
console.log('Mattia gagne :', good.length, '/', results.length);
console.log(good.slice(0, 8).map(r => JSON.stringify(r)).join('\n'));
const pick = good.find(r => r.crit >= 1 && r.se >= 1 && r.turns >= 4) || good[0];
console.log('CHOIX', JSON.stringify(pick));
const log = await run(pick.seed);
console.log(log.filter(l => /^\|(move|-damage|-supereffective|-crit|faint|-resisted|-immune|switch|turn|win|-miss|-status|cant|-boost|-unboost|-heal)\|/.test(l)).join('\n'));
process.exit(0);
