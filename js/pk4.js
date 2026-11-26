// Pokémon de la 4e génération : déchiffrement / rechiffrement (format documenté par pret/pokeplatinum).
// Utilisé sur la RAM du jeu (équipe vivante) ; aucune donnée ne quitte le navigateur sans action du joueur.
import { decodeString } from './gamedata.js';

const ORDER = [[0,1,2,3],[0,1,3,2],[0,2,1,3],[0,3,1,2],[0,2,3,1],[0,3,2,1],[1,0,2,3],[1,0,3,2],[2,0,1,3],[3,0,1,2],[2,0,3,1],[3,0,2,1],
  [1,2,0,3],[1,3,0,2],[2,1,0,3],[3,1,0,2],[2,3,0,1],[3,2,0,1],[1,2,3,0],[1,3,2,0],[2,1,3,0],[3,1,2,0],[2,3,1,0],[3,2,1,0]];
const NATURES = ['Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky'];
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function crypt(src, seed) {
  const out = new Uint8Array(src);
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i += 2) {
    s = (Math.imul(s, 0x41c64e6d) + 0x6073) >>> 0;
    const v = u16(out, i) ^ (s >>> 16);
    out[i] = v & 0xff; out[i + 1] = v >> 8;
  }
  return out;
}

/**
 * Un Pokémon en RAM est « stable » quand il est au repos : chiffré, somme de contrôle juste, aucun
 * contexte de déchiffrement ouvert (drapeaux octets 4-5). Sur la carte, Platine tourne à 30 images/s :
 * une image émulée sur deux tombe au milieu d'un rechiffrement du Pokémon de tête. Lire ou écrire à ce
 * moment-là donnerait un Pokémon corrompu (« Œuf mauvais »), d'où cette vérification avant tout accès.
 */
export function monIsStable(raw) {
  if (raw.length < 136) return false;
  if (raw.every(v => v === 0)) return true;                       // emplacement vide
  if (u16(raw, 4) & 3) return false;                              // déchiffrement en cours
  const chk = u16(raw, 6), blocks = crypt(raw.subarray(8, 136), chk);
  let sum = 0; for (let i = 0; i < 128; i += 2) sum = (sum + u16(blocks, i)) & 0xffff;
  return sum === chk;
}

/**
 * Miroir de l'équipe vivante : garde, emplacement par emplacement, la dernière lecture stable, et la
 * dernière écriture demandée tant que la RAM ne l'a pas encore reçue (l'écriture attend une image stable).
 */
export class PartyMirror {
  constructor() { this.bytes = null; this.pending = new Map(); }
  ingest(ram) {
    const S = PARTY.size, prev = this.bytes, out = new Uint8Array(ram);
    for (let k = 0; k < 6; k++) {
      const at = 4 + k * S, cur = ram.subarray(at, at + S);
      const want = this.pending.get(k);
      if (want) {
        if (want.every((v, i) => v === cur[i])) this.pending.delete(k); else { out.set(want, at); continue; }
      }
      if (!monIsStable(cur) && prev) out.set(prev.subarray(at, at + S), at);
    }
    this.bytes = out;
    return out;
  }
  write(slot, bytes) {
    this.pending.set(slot, new Uint8Array(bytes));
    if (this.bytes) { this.bytes = this.bytes.slice(); this.bytes.set(bytes, 4 + slot * PARTY.size); }
  }
}

/** raw : 236 octets (équipe) ou 136 (boîte). null si vide ou somme de contrôle invalide. */
export function decodeMon(raw, gd) {
  const pid = u32(raw, 0), chk = u16(raw, 6);
  const blocks = crypt(raw.subarray(8, 136), chk);
  let sum = 0; for (let i = 0; i < 128; i += 2) sum = (sum + u16(blocks, i)) & 0xffff;
  if (sum !== chk) return null;
  const pos = ORDER[((pid & 0x3e000) >>> 13) % 24];
  const blk = k => blocks.subarray(pos[k] * 32, pos[k] * 32 + 32);
  const A = blk(0), B = blk(1), C = blk(2), D = blk(3);
  const species = u16(A, 0);
  if (!species || species > 493) return null;
  const otid = u32(A, 4), ivw = u32(B, 16);
  const m = {
    pid, species, item: u16(A, 2), otid, exp: u32(A, 8), friendship: A[12], ability: A[13],
    evs: [A[16], A[17], A[18], A[19], A[20], A[21]],                         // PV, Atq, Déf, Vit, AtqS, DéfS
    ivs: [0, 1, 2, 3, 4, 5].map(i => (ivw >>> (5 * i)) & 31),
    moves: [u16(B, 0), u16(B, 2), u16(B, 4), u16(B, 6)].filter(Boolean), pp: [B[8], B[9], B[10], B[11]],
    isEgg: (ivw >>> 30) & 1, hasNick: (ivw >>> 31) & 1, gender: (B[0x18] >> 1) & 3, form: B[0x18] >> 3,
    nature: NATURES[pid % 25], nickname: decodeString(C, 0, 11), ot: decodeString(D, 0, 8),
    shiny: (((otid & 0xffff) ^ (otid >>> 16) ^ (pid & 0xffff) ^ (pid >>> 16)) >>> 0) < 8,
    // lieu de rencontre : champ Platine (bloc B + 0x1E), sinon champ Diamant/Perle (bloc D + 0x18)
    metLocation: u16(B, 0x1e) || u16(D, 0x18),
  };
  // identité stable : le PID seul ne suffit pas (Pokémon générés qui partagent un PID, vu sur la sauvegarde de test)
  m.uid = `${pid.toString(16)}-${(ivw & 0x3fffffff).toString(16)}-${m.metLocation}`;
  m.name = m.hasNick ? m.nickname : gd?.text.species[species] || m.nickname;
  if (raw.length >= 236) {
    const P = crypt(raw.subarray(136, 236), pid);
    m.status = u32(P, 0); m.level = P[4]; m.hp = u16(P, 6); m.maxhp = u16(P, 8);
    m.stats = { hp: m.maxhp, atk: u16(P, 10), def: u16(P, 12), spe: u16(P, 14), spa: u16(P, 16), spd: u16(P, 18) };
  } else if (gd) m.level = gd.levelFromExp(species, m.exp);
  return m;
}

/** Équipe vivante : SaveData + 0xAC (capacité), + 0xB0 (nombre), + 0xB4 (6 × 236 octets). */
export const PARTY = { count: 0xb0, mons: 0xb4, size: 236 };
export function decodeParty(bytes, gd) {
  const n = Math.min(6, u32(bytes, 0));
  const out = [];
  for (let k = 0; k < n; k++) { const m = decodeMon(bytes.subarray(4 + k * 236, 4 + (k + 1) * 236), gd); if (m) out.push({ ...m, slot: k }); }
  return out;
}

/** Rechiffre la partie « équipe » d'un Pokémon avec de nouveaux PV / statut (clé = PID). */
export function withPartyHP(raw, hp, status) {
  const pid = u32(raw, 0);
  const P = crypt(raw.subarray(136, 236), pid);
  P[6] = hp & 0xff; P[7] = hp >> 8;
  if (status !== undefined) { P[0] = status & 0xff; P[1] = (status >> 8) & 0xff; P[2] = (status >> 16) & 0xff; P[3] = status >>> 24; }
  const out = new Uint8Array(raw); out.set(crypt(P, pid), 136);
  return out;
}

/** Ensemble « Showdown » (numéros 4G = numéros Showdown). Les noms sont résolus côté serveur. */
export function toBattleSet(m) {
  const [hp, atk, def, spe, spa, spd] = [0, 1, 2, 3, 4, 5];
  const ev = m.evs, iv = m.ivs;
  return {
    name: m.name, species: m.species, item: m.item, ability: m.ability, moves: m.moves, nature: m.nature,
    level: m.level, gender: m.gender === 0 ? 'M' : m.gender === 1 ? 'F' : 'N', shiny: m.shiny, happiness: m.friendship,
    evs: { hp: ev[hp], atk: ev[atk], def: ev[def], spa: ev[spa], spd: ev[spd], spe: ev[spe] },
    ivs: { hp: iv[hp], atk: iv[atk], def: iv[def], spa: iv[spa], spd: iv[spd], spe: iv[spe] },
  };
}

/** Facteurs de nature (ordre des stats : Atq, Déf, Vit, AtqS, DéfS). */
const NATURE_MOD = i => { const up = Math.floor(i / 5), down = i % 5, m = [1, 1, 1, 1, 1]; if (up !== down) { m[up] = 1.1; m[down] = 0.9; } return m; };

/**
 * Pokémon de boîte (136 octets) -> Pokémon d'équipe (236 octets) : on garde les données d'origine
 * telles quelles (même PID, même somme de contrôle) et on calcule la partie « équipe » (niveau, PV, stats)
 * avec les formules de la 4G et les stats de base lues dans la ROM.
 */
export function boxToParty(boxRaw, gd) {
  const m = decodeMon(boxRaw, gd);
  if (!m) throw new Error('Pokémon invalide');
  const sp = gd.species(m.species), L = m.level, nat = NATURE_MOD(m.pid % 25);
  const [bHP, bAtk, bDef, bSpA, bSpD, bSpe] = sp.base;                       // PV, Atq, Déf, AtqS, DéfS, Vit
  const [ivHP, ivAtk, ivDef, ivSpe, ivSpA, ivSpD] = m.ivs, [evHP, evAtk, evDef, evSpe, evSpA, evSpD] = m.evs;
  const st = (b, iv, ev, k) => Math.floor((Math.floor(((2 * b + iv + Math.floor(ev / 4)) * L) / 100) + 5) * k);
  const hp = m.species === 292 ? 1 : Math.floor(((2 * bHP + ivHP + Math.floor(evHP / 4)) * L) / 100) + L + 10;
  const vals = [hp, hp, st(bAtk, ivAtk, evAtk, nat[0]), st(bDef, ivDef, evDef, nat[1]), st(bSpe, ivSpe, evSpe, nat[2]), st(bSpA, ivSpA, evSpA, nat[3]), st(bSpD, ivSpD, evSpD, nat[4])];
  const P = new Uint8Array(100);
  P[4] = L;
  vals.forEach((v, i) => { P[6 + 2 * i] = v & 0xff; P[7 + 2 * i] = v >> 8; });
  const out = new Uint8Array(236);
  out.set(boxRaw.subarray(0, 136), 0);
  out.set(crypt(P, m.pid), 136);
  return out;
}
