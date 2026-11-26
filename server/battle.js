// Combats entre joueurs : simulateur Pokémon Showdown (licence MIT), règles de la 4e génération.
// Le serveur fait autorité : il reçoit les équipes (numéros du jeu) et les choix, il calcule tout.
const { BattleStream, getPlayerStreams, Teams, Dex } = require('pokemon-showdown');

const dex = Dex.forGen(4);
const index = (list, max) => {
  const m = new Map();
  for (const x of list) if (x.num > 0 && x.num <= max && !m.has(x.num) && (!x.forme || x.forme === '')) m.set(x.num, x);
  return m;
};
const SPECIES = index(dex.species.all().filter(s => !s.forme), 493);
const MOVES = index(dex.moves.all(), 467);
const ITEMS = index(dex.items.all(), 536);
const ABILITIES = index(dex.abilities.all(), 123);

/** Ensemble venant du jeu (numéros) -> ensemble Showdown (noms). */
function toShowdown(s) {
  const sp = SPECIES.get(s.species);
  if (!sp) throw new Error('Espèce inconnue : ' + s.species);
  return {
    name: String(s.name || sp.name).slice(0, 18), species: sp.name,
    item: ITEMS.get(s.item)?.name || '', ability: ABILITIES.get(s.ability)?.name || sp.abilities[0],
    moves: (s.moves || []).map(n => MOVES.get(n)?.name).filter(Boolean).slice(0, 4),
    nature: s.nature || 'Hardy', gender: s.gender === 'N' ? '' : s.gender, level: Math.max(1, Math.min(100, s.level | 0)),
    shiny: !!s.shiny, happiness: s.happiness ?? 255, evs: s.evs || {}, ivs: s.ivs || {},
  };
}

/** Dictionnaire nom anglais -> numéro du jeu, pour que le client affiche les noms français de sa ROM. */
function namesFor(teams) {
  const names = { species: {}, moves: { Struggle: 165 }, items: {}, abilities: {} };
  for (const t of teams) for (const s of t) {
    const sp = SPECIES.get(s.species); if (sp) names.species[sp.name] = s.species;
    for (const n of s.moves || []) { const m = MOVES.get(n); if (m) names.moves[m.name] = n; }
    const it = ITEMS.get(s.item); if (it) names.items[it.name] = s.item;
    const ab = ABILITIES.get(s.ability); if (ab) names.abilities[ab.name] = s.ability;
  }
  return names;
}

class Battle {
  /** players : [{ id, name, team }] (2 joueurs) · send(id, message) */
  constructor({ id, players, send, seed, onEnd }) {
    Object.assign(this, { id, players, send, onEnd, ended: false, last: { p1: {}, p2: {} } });
    this.sides = { [players[0].id]: 'p1', [players[1].id]: 'p2' };
    const teams = players.map(p => p.team);
    const names = namesFor(teams);
    const stream = new BattleStream();
    this.ps = getPlayerStreams(stream);
    for (const [i, p] of players.entries()) {
      const side = i ? 'p2' : 'p1';
      send(p.id, { t: 'battle', rid: id, ev: 'start', side, names, opponent: players[1 - i].id });
      this.pump(p.id, side);
    }
    const spec = { formatid: 'gen4customgame' };
    if (seed) spec.seed = seed;
    const pack = t => JSON.stringify(Teams.pack(t.map(toShowdown)));
    this.ps.omniscient.write(`>start ${JSON.stringify(spec)}\n>player p1 {"name":${JSON.stringify(players[0].name)},"team":${pack(teams[0])}}\n>player p2 {"name":${JSON.stringify(players[1].name)},"team":${pack(teams[1])}}`);
  }
  async pump(pid, side) {
    for await (const chunk of this.ps[side]) {
      const lines = chunk.split('\n').filter(l => l && !l.startsWith('|t:|'));
      const log = [];
      for (const l of lines) {
        if (l.startsWith('|request|')) {
          const req = JSON.parse(l.slice(9) || 'null');
          if (req) {
            for (const m of req.side?.pokemon || []) this.track(side, m.ident, m.condition);
            this.send(pid, { t: 'battle', rid: this.id, ev: 'request', request: req });
          }
        } else {
          log.push(l);
          const [, kind, who, cond] = l.split('|');
          if (who?.startsWith(side) && (kind === '-damage' || kind === '-heal' || kind === 'switch' || kind === 'drag')) this.track(side, who, kind === 'switch' || kind === 'drag' ? l.split('|')[4] : cond);
          if (kind === 'faint' && who?.startsWith(side)) this.track(side, who, '0 fnt');
        }
      }
      if (log.length) this.send(pid, { t: 'battle', rid: this.id, ev: 'log', lines: log });
      const win = log.find(l => l.startsWith('|win|') || l === '|tie');
      if (win && !this.ended) this.finish(win.startsWith('|win|') ? win.slice(5) : null);
    }
  }
  /** Suivi des PV exacts de sa propre équipe (identifiant « p1: Nom »). */
  track(side, ident, condition) {
    if (!condition) return;
    const key = ident.replace(/^(p[12])[a-c]?:/, '$1:');
    const [hp, rest = ''] = condition.split(' ');
    const [cur, max] = hp.split('/').map(Number);
    const t = this.last[side];
    const prev = t[key] || {};
    t[key] = { ident: key, hp: rest === 'fnt' ? 0 : cur, maxhp: max || prev.maxhp || 0, fainted: rest === 'fnt' || cur === 0 };
  }
  choose(pid, choice) {
    const side = this.sides[pid];
    if (!side || this.ended) return;
    if (!/^(move [1-4]|switch [1-6]|forfeit|default)$/.test(choice)) return;
    try {
      if (choice === 'forfeit') this.ps.omniscient.write(`>forcelose ${side}`);
      else this.ps[side].write(choice);
    } catch (e) { // un choix refusé par le simulateur ne doit jamais faire tomber le serveur
      this.send(pid, { t: 'battle', rid: this.id, ev: 'error', error: String(e.message || e) });
    }
  }
  finish(winnerName) {
    this.ended = true;
    // état final de chaque équipe (PV restants, K.O.) pour réécrire le résultat dans les jeux
    for (const p of this.players) {
      const side = this.sides[p.id];
      const team = Object.values(this.last[side] || {});
      this.send(p.id, { t: 'battle', rid: this.id, ev: 'end', winner: winnerName, team });
    }
    this.onEnd?.();
  }
}

module.exports = { Battle, toShowdown, namesFor };
