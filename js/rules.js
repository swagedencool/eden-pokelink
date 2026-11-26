// Règles de la room, activables et désactivables à tout moment par n'importe quel joueur :
//  - Âmes liées : les Pokémon rencontrés au même endroit sont liés entre amis ; si l'un tombe K.O., les autres tombent aussi.
//  - Plafond de niveau : au plafond, un Pokémon ne gagne plus d'expérience (combats, Pension) et les Super Bonbons sont sans effet.
import { parseNarc } from './rom.js';
import { decodeParty, withPartyHP } from './pk4.js';

/** Champions dans l'ordre de l'histoire (identifiants de dresseur de Platine, pret/pokeplatinum). */
export const PT_BOSSES = [
  { name: 'Pierrick', ids: [246] }, { name: 'Flo', ids: [315] }, { name: 'Kiméra', ids: [318] }, { name: 'Mélina', ids: [317] },
  { name: 'Lovis', ids: [316] }, { name: 'Charles', ids: [250] }, { name: 'Gladys', ids: [319] }, { name: 'Tanguy', ids: [320] },
  { name: 'Conseil 4 et Cynthia', ids: [261, 262, 263, 264, 267] },
];
const MON_SIZE = [8, 16, 10, 18];          // taille d'un Pokémon de dresseur selon le type de données (avec attaques, objet…)

/** Niveau du Pokémon le plus fort de chaque champion, lu dans la ROM du joueur (donc après randomisation). */
export function bossLevels(rom) {
  try {
    const open = p => { const f = rom.fileByPath(p); return parseNarc(f.data, f.offset); };
    const td = open('poketool/trainer/trdata.narc'), tp = open('poketool/trainer/trpoke.narc');
    return PT_BOSSES.map(b => ({ name: b.name, level: Math.max(...b.ids.flatMap(id => {
      const hd = td.member(id), p = tp.member(id), sz = MON_SIZE[hd[0]] || 8;
      return Array.from({ length: hd[3] }, (_, i) => p[i * sz + 2] | (p[i * sz + 3] << 8));
    })) }));
  } catch { return PT_BOSSES.map((b, i) => ({ name: b.name, level: [14, 22, 26, 32, 37, 41, 44, 50, 62][i] })); }
}

/** Plafond automatique : le Pokémon le plus fort du prochain champion (aucun plafond une fois la Ligue terminée). */
export function autoCap(levels, badges, cleared) {
  if (cleared) return { level: 100, next: null };
  let n = 0; for (let b = badges; b; b &= b - 1) n++;
  const boss = levels[Math.min(n, levels.length - 1)];
  return { level: boss.level, next: boss.name };
}

/**
 * Groupes d'âmes liées : pour chaque lieu de rencontre, le premier Pokémon de chaque joueur.
 * players : [{ id, name, mons: [{ uid, species, name, loc }], dead: Set(uid) }]
 * Renvoie [{ loc, members: [{ player, mon, dead }], dead }] — un groupe est mort si l'un de ses membres l'est.
 */
export function soulGroups(players) {
  const byLoc = new Map();
  for (const pl of players) {
    const seen = new Set();
    for (const m of pl.mons) {
      if (!m.loc || seen.has(m.loc)) continue;
      seen.add(m.loc);
      if (!byLoc.has(m.loc)) byLoc.set(m.loc, []);
      byLoc.get(m.loc).push({ player: pl, mon: m, dead: pl.dead.has(m.uid) });
    }
  }
  return [...byLoc].filter(([, ms]) => ms.length > 1).map(([loc, members]) => ({ loc, members, dead: members.some(x => x.dead) }));
}

export const DEFAULT_RULES = { soulLink: false, levelCap: false, capMode: 'auto', capValue: 50 };

/** Applique les règles dans la partie du joueur. host : l'app PokéLink (réseau, jeu, interface). */
export class RoomRules {
  constructor(app, { bosses } = {}) {
    Object.assign(this, { app, bosses: bosses || PT_BOSSES.map((b, i) => ({ name: b.name, level: [14, 22, 26, 32, 37, 41, 44, 50, 62][i] })) });
    this.state = { ...DEFAULT_RULES };
    this.dead = new Set(JSON.parse(localStorage.getItem('pokelink.dead') || '[]'));   // mes Pokémon morts (identifiant uid)
    this.lastHp = new Map();
    this.peerSouls = new Map();            // id → { mons, dead:Set }
    this.mine = [];
    this.fromHost = false;
  }
  get cap() {
    if (!this.state.levelCap) return null;
    if (this.state.capMode === 'manual') return { level: this.state.capValue, next: null };
    const g = this.app.game;
    return autoCap(this.bosses, g.badges?.() ?? 0, g.storyCleared?.() ?? false);
  }
  /** Changement demandé par ce joueur : appliqué tout de suite et partagé avec la room. */
  set(patch, by = this.app.me.profile.name) {
    this.state = { ...this.state, ...patch };
    this.app.net.send('rules', { rules: this.state, by });
    this.changed(by, patch, true);
  }
  receive(m) {
    const before = this.state;
    this.state = { ...DEFAULT_RULES, ...m.rules };
    const patch = Object.fromEntries(Object.entries(this.state).filter(([k, v]) => before[k] !== v));
    if (Object.keys(patch).length) this.changed(m.by || 'Un ami', patch, false);
  }
  /** Réglages choisis dans l'atelier (formule) : servent de départ tant que personne n'a rien changé en jeu. */
  fromRun(run) {
    if (this.fromHost || !run?.rules) return;
    this.state = { ...this.state, soulLink: run.rules.includes('shared'), levelCap: run.rules.includes('levelCap') };
    this.app.onRulesChanged?.();
  }
  changed(by, patch, mine) {
    this.fromHost = true;
    const t = this.app.ui.toasts;
    const who = mine ? 'Tu as' : `${by} a`;
    if ('soulLink' in patch) t.show({ ic: 'link-2', accent: 'var(--c-duo)', title: `${who} ${patch.soulLink ? 'activé' : 'désactivé'} les Âmes liées`, sub: patch.soulLink ? 'Un K.O. emporte les Pokémon liés de toute la room' : 'Plus aucun Pokémon n’est forcé K.O.' });
    if ('levelCap' in patch || 'capMode' in patch || 'capValue' in patch) {
      const c = this.cap;
      t.show({ ic: 'gauge', accent: 'var(--c-trade)', title: c ? `${who} réglé le plafond : N.${c.level}` : `${who} retiré le plafond de niveau`, sub: c ? (c.next ? `Niveau du plus fort Pokémon de ${c.next}` : 'Niveau fixé pour toute la room') : 'Les Pokémon regagnent de l’expérience' });
    }
    this.app.onRulesChanged?.();
  }

  // ------------------------------------------------------------------------------------- âmes liées
  peerSoul(id, m) { this.peerSouls.set(id, { name: m.name, mons: m.mons || [], dead: new Set(m.dead || []) }); this.app.onRulesChanged?.(); }
  forget(id) { this.peerSouls.delete(id); }
  publish() {
    this.app.net.send('soul', { name: this.app.me.profile.name, mons: this.mine.map(({ uid, species, name, loc, level }) => ({ uid, species, name, loc, level })), dead: [...this.dead] });
  }
  groups() {
    const players = [{ id: 'me', name: this.app.me.profile.name, mons: this.mine, dead: this.dead }];
    for (const [id, p] of this.peerSouls) players.push({ id, name: this.app.peers.get(id)?.profile.name || p.name, mons: p.mons, dead: p.dead });
    return soulGroups(players);
  }
  /** Appelée régulièrement : suit l'équipe, détecte les K.O., applique les liens et le plafond. */
  tick() {
    const g = this.app.game;
    g.setLevelCap?.(this.cap?.level ?? null);
    const raw = g.readPartyRaw?.();
    if (!raw) return;
    const team = decodeParty(raw, this.app.gd);
    const mine = team.map(m => ({ uid: m.uid, species: m.species, name: m.name, loc: m.metLocation, level: m.level, hp: m.hp, slot: m.slot }));
    let changed = JSON.stringify(mine.map(m => m.uid)) !== JSON.stringify(this.mine.map(m => m.uid));
    this.mine = mine;
    if (!this.state.soulLink) { for (const m of mine) this.lastHp.set(m.uid, m.hp); if (changed) this.publish(); return; }
    // K.O. : passage de PV > 0 à 0 pendant que la règle est active
    for (const m of mine) {
      const before = this.lastHp.get(m.uid);
      if (before > 0 && m.hp === 0 && !this.dead.has(m.uid)) { this.kill(m, null); changed = true; }
      this.lastHp.set(m.uid, m.hp);
    }
    // liens : un membre mort emporte les autres
    for (const grp of this.groups()) {
      if (!grp.dead) continue;
      const own = grp.members.find(x => x.player.id === 'me');
      if (own && !this.dead.has(own.mon.uid)) { this.kill(own.mon, grp.members.find(x => x.dead && x.player.id !== 'me')); changed = true; }
    }
    // un Pokémon mort reste K.O. dans l'équipe (Centre Pokémon, Rappel…), seulement hors combat et sur la carte
    const s = g.state?.();
    if (s && s.field && !this.app.battle?.view) {
      for (const m of mine) if (this.dead.has(m.uid) && m.hp > 0) {
        const at = 4 + m.slot * 236;
        g.writePartyMon(m.slot, withPartyHP(raw.subarray(at, at + 236), 0, 0));
        this.lastHp.set(m.uid, 0);
      }
    }
    if (changed) this.publish();
  }
  kill(mon, cause) {
    this.dead.add(mon.uid);
    localStorage.setItem('pokelink.dead', JSON.stringify([...this.dead]));
    const place = this.app.gd?.text.places[mon.loc] || 'ce lieu';
    this.app.ui.toasts.show(cause
      ? { species: mon.species, accent: 'var(--c-battle)', title: `${mon.name} rejoint ${cause.mon.name}`, sub: `Âmes liées (${place}) : le Pokémon de ${cause.player.name} est tombé`, dur: 4200 }
      : { species: mon.species, accent: 'var(--c-battle)', title: `${mon.name} est tombé`, sub: `Âmes liées : ses liens de ${place} tombent avec lui`, dur: 4200 });
    this.app.onRulesChanged?.();
  }
}
