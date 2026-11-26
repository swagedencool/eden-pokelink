// Random map : mélange des portes de Pokémon Platine, directement dans la ROM du joueur (dans le navigateur).
//
// Données (pret/pokeplatinum, vérifiées sur la ROM FR) :
//  - table des en-têtes de carte dans arm9 : 24 octets par carte ; +0x10 = fichier d'événements,
//    +0x12 = nom du lieu, +0x16 & 0x7F = type (1 ville, 2 extérieur, 3 grotte, 4 intérieur, 5 Centre Pokémon) ;
//  - fielddata/eventdata/zone_event.narc : [n, n×20 décors] [n, n×32 personnages] [n, n×12 téléporteurs] [n, n×16 déclencheurs] ;
//    téléporteur = x u16, z u16, carte de destination u16, téléporteur d'arrivée u16, 4 octets libres.
//
// Une « porte » = les cases d'une carte qui mènent au même endroit (une grande porte fait 2 cases).
// On ne touche qu'aux portes réciproques (A mène à B et B ramène à A) et on garde cette réciprocité :
// en ressortant, on revient toujours par où l'on est entré — on ne peut jamais rester coincé.
import { NdsRom, parseNarc } from '../rom.js';
import { PT_MAP_NAMES } from '../data/pt-maps.js';

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const w16 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };

/** Jeux pris en charge : adresse de la table des en-têtes (RAM = arm9 chargé à 0x02000000). */
export const DOOR_GAMES = {
  CPUF: { headers: 0x020e60a4, count: 593, names: PT_MAP_NAMES },
};

export const DOOR_MODES = {
  city:   { label: 'Bâtiments mélangés dans chaque ville', safe: true },
  region: { label: 'Bâtiments mélangés dans toute la région', safe: true },
  chaos:  { label: 'Chaos : toutes les portes, grottes et escaliers', safe: false },
};

const TYPE = { CITY: 1, OUTDOORS: 2, CAVE: 3, INDOORS: 4, CENTER: 5 };
const OUTSIDE = t => t === TYPE.CITY || t === TYPE.OUTDOORS;
const INSIDE = t => t === TYPE.INDOORS || t === TYPE.CENTER;

// Lieux jamais touchés : début de partie scripté, Ligue, Monde Distorsion, souterrain, installations de combat.
const BLACKLIST = /^(everywhere|nothing|underground|distortion_world|pokemon_league|hall_of_fame|spear_pillar|turnback_cave|union_room|battle_|fight_area_battle|twinleaf_town_player|twinleaf_town_rival|sandgem_town_pokemon_research_lab|global_terminal_b|unused|.*_elevator|.*colosseum)/;

// Paliers de progression (ordre de l'histoire) : un bâtiment important n'est jamais envoyé plus loin que sa ville d'origine.
const CITY_TIER = [
  [/^(twinleaf|sandgem|jubilife|route_20[12]|route_219|lake_verity)/, 0],
  [/^(oreburgh|route_20[37])/, 1], [/^(floaroma|eterna|route_20[45]|route_211)/, 2],
  [/^(hearthome|route_20[68])/, 3], [/^(solaceon|veilstone|route_209|route_21[05])/, 4],
  [/^(pastoria|route_21[234]|lake_valor)/, 5], [/^(celestic|canalave|route_218)/, 6],
  [/^(snowpoint|route_21[67]|lake_acuity)/, 7], [/^(sunyshore|route_22[0-3])/, 8],
  [/^(route_224)/, 9], [/^(fight_area|survival_area|resort_area|route_22[5-9]|route_230)/, 10],
];
const tierOf = name => { for (const [re, t] of CITY_TIER) if (re.test(name)) return t; return 10; };

/** Générateur pseudo-aléatoire reproductible à partir d'une graine texte (même graine = même mélange). */
export function seededRandom(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const c of String(seed)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0, b = Math.imul(h, 0x9e3779b9) >>> 0, c = (h ^ 0x85ebca6b) >>> 0, d = 1;
  return () => {                                                 // sfc32
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; const r = (t + d) | 0; c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rnd) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

/** Lit cartes, téléporteurs et portes réciproques d'une ROM. */
export function readDoors(romU8) {
  const rom = new NdsRom(romU8), g = DOOR_GAMES[rom.code];
  if (!g) throw new Error(`Random map : jeu ${rom.code} pas encore pris en charge (Platine FR pour l'instant)`);
  const b = rom.u8, arm9 = u32(b, 0x20), table = arm9 + (g.headers - 0x02000000);
  const ev = rom.fileByPath('fielddata/eventdata/zone_event.narc'), narc = parseNarc(ev.data, ev.offset);
  const maps = [], evUse = new Map();
  for (let h = 0; h < g.count; h++) {
    const o = table + h * 24, events = u16(b, o + 0x10);
    maps.push({ h, name: g.names[h] || `map_${h}`, label: b[o + 0x12], type: u16(b, o + 0x16) & 0x7f, events, warps: [] });
    evUse.set(events, (evUse.get(events) || 0) + 1);
  }
  for (const m of maps) {
    if (m.events >= narc.count) continue;
    const d = narc.member(m.events), base = narc.memberOffset(m.events);
    let p = 0;
    p += 4 + u32(d, p) * 20; p += 4 + u32(d, p) * 32;
    const n = u32(d, p); p += 4;
    for (let i = 0; i < n; i++, p += 12) {
      m.warps.push({ i, x: u16(d, p), z: u16(d, p + 2), dest: u16(d, p + 4), destWarp: u16(d, p + 6), off: base + p });
    }
    m.shared = evUse.get(m.events) > 1;                                 // fichier partagé : on n'y touche pas
  }
  // portes = cases d'une carte qui mènent au même endroit
  const doors = [], doorAt = new Map();
  for (const m of maps) {
    const groups = new Map();
    for (const w of m.warps) {
      const k = w.dest + ':' + w.destWarp;
      if (!groups.has(k)) { const door = { id: doors.length, m, warps: [], dest: w.dest, destWarp: w.destWarp }; groups.set(k, door); doors.push(door); }
      groups.get(k).warps.push(w);
      doorAt.set(m.h + ':' + w.i, groups.get(k));
    }
  }
  const pairs = [];
  for (const d of doors) {
    const p = doorAt.get(d.dest + ':' + d.destWarp);
    if (!p || p === d || p.dest !== d.m.h || !d.warps.some(w => w.i === p.destWarp)) continue;
    d.partner = p;
    if (d.id < p.id) pairs.push([d, p]);
  }
  return { rom, maps, doors, pairs };
}

const usable = d => !d.m.shared && !BLACKLIST.test(d.m.name);

/**
 * Mélange les portes. mode : 'city' | 'region' | 'chaos'. Modifie romU8 sur place.
 * Renvoie le journal : nombre de portes mélangées et la liste des nouvelles liaisons.
 */
export function shuffleDoors(romU8, { mode = 'city', seed = 'pokelink' } = {}) {
  if (!DOOR_MODES[mode]) throw new Error('mode inconnu ' + mode);
  const { maps, pairs } = readDoors(romU8);
  const rnd = seededRandom(`${seed}|doors|${mode}`);
  const links = [];                                                    // nouvelles paires [porte, porte]

  if (mode === 'chaos') {
    const ends = pairs.filter(([a, b]) => usable(a) && usable(b)).flat();
    shuffle(ends, rnd);
    for (let i = 0; i + 1 < ends.length; i += 2) links.push([ends[i], ends[i + 1]]);
  } else {
    // bâtiments = groupes de cartes intérieures reliées entre elles, avec UNE seule porte vers l'extérieur
    const parent = maps.map((_, i) => i), find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const [a, b] of pairs) if (INSIDE(a.m.type) && INSIDE(b.m.type)) parent[find(a.m.h)] = find(b.m.h);
    const entrances = new Map(), tainted = new Set();
    for (const [a, b] of pairs) {
      const [out, inn] = OUTSIDE(a.m.type) && INSIDE(b.m.type) ? [a, b] : OUTSIDE(b.m.type) && INSIDE(a.m.type) ? [b, a] : [null, null];
      if (!out) continue;
      const c = find(inn.m.h);
      if (!entrances.has(c)) entrances.set(c, []);
      entrances.get(c).push({ out, inn });
      if (!usable(out) || !usable(inn)) tainted.add(c);
    }
    for (const m of maps) if (INSIDE(m.type) && (m.shared || BLACKLIST.test(m.name))) tainted.add(find(m.h));
    const buildings = [...entrances].filter(([c, e]) => e.length === 1 && !tainted.has(c)).map(([, e]) => ({ ...e[0], tier: tierOf(e[0].out.m.name) }));
    if (mode === 'city') {
      const byPlace = new Map();
      for (const bld of buildings) { const k = bld.out.m.label; if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(bld); }
      for (const group of byPlace.values()) {
        const inns = shuffle(group.map(x => x.inn), rnd);
        group.forEach((x, i) => links.push([x.out, inns[i]]));
      }
    } else {
      // palier : un bâtiment de palier t va derrière une porte de palier ≤ t (tous les placements restent possibles)
      const free = buildings.map(x => ({ out: x.out, tier: x.tier }));
      const order = shuffle(buildings.slice(), rnd).sort((p, q) => p.tier - q.tier);
      for (const bld of order) {
        const ok = free.filter(f => f.tier <= bld.tier);
        const pick = ok[Math.floor(rnd() * ok.length)];
        free.splice(free.indexOf(pick), 1);
        links.push([pick.out, bld.inn]);
      }
    }
  }

  const touched = new Set(links.flat());
  for (const [a, c] of links) {
    for (const w of a.warps) { w16(romU8, w.off + 4, c.m.h); w16(romU8, w.off + 6, c.warps[0].i); }
    for (const w of c.warps) { w16(romU8, w.off + 4, a.m.h); w16(romU8, w.off + 6, a.warps[0].i); }
  }
  const moved = links.filter(([a, c]) => a.partner !== c).length;
  return {
    mode, seed, doors: touched.size, changed: moved,
    links: links.map(([a, c]) => ({ from: { map: a.m.h, name: a.m.name, label: a.m.label, x: a.warps[0].x, z: a.warps[0].z }, to: { map: c.m.h, name: c.m.name, label: c.m.label, x: c.warps[0].x, z: c.warps[0].z } })),
  };
}

/** Vérifie que chaque porte réciproque le reste (après un mélange). */
export function checkDoors(romU8) {
  const { doors } = readDoors(romU8);
  let broken = 0;
  const at = new Map(); for (const d of doors) for (const w of d.warps) at.set(d.m.h + ':' + w.i, d);
  for (const d of doors) {
    if (!d.partner) continue;
    const p = at.get(d.dest + ':' + d.destWarp);
    if (!p || p.dest !== d.m.h || !d.warps.some(w => w.i === p.destWarp)) broken++;
  }
  return { doors: doors.length, reciprocal: doors.filter(d => d.partner).length, broken };
}
