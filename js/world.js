// Entités du monde : joueurs distants (positions interpolées) et Pokémon qui suivent.
import { DIRS, OPPOSITE, TILE, tileOf } from './projection.js';
import { DIR_BASE } from './sprites.js';
import { clamp } from './core.js';

const center = t => t * TILE + TILE / 2;
/** Case « logique » du meneur : celle vers laquelle il marche (mise à jour au début du pas). */
const leaderTile = l => (l.tx !== undefined ? [l.tx, l.tz] : [tileOf(l.x), tileOf(l.z)]);

/** Image de marche : pas gauche / neutre / pas droit / neutre, une alternance par case. */
export function walkFrame(face, moving, dist) {
  if (!moving) return DIR_BASE[face];
  const step = Math.floor(dist / TILE) % 2 ? 3 : 1;
  return DIR_BASE[face] + ((dist % TILE) < TILE / 2 ? step : 0);
}

/** Joueur distant : tampon de positions reçues (15 Hz) rejoué avec 100 ms de retard, sans à-coups. */
export class RemotePlayer {
  constructor(id, profile) {
    this.id = id;
    this.profile = profile;
    this.buf = [];
    this.pos = null; this.face = 1; this.moving = false; this.dist = 0; this.map = -1;
    this.lastStep = 0;
  }
  push(now, s) {
    this.buf.push({ t: now, ...s });
    if (this.buf.length > 32) this.buf.shift();
  }
  update(now, delay = 100) {
    if (!this.buf.length) return;
    const t = now - delay;
    let a = this.buf[0], b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].t <= t && this.buf[i + 1].t >= t) { a = this.buf[i]; b = this.buf[i + 1]; break; }
    }
    const k = b.t === a.t || a.map !== b.map ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
    const src = a.map !== b.map ? b : a;
    const np = { x: src.x + (b.x - src.x) * k, y: src.y + (b.y - src.y) * k, z: src.z + (b.z - src.z) * k };
    const d = this.pos && this.map === b.map ? Math.abs(np.x - this.pos.x) + Math.abs(np.z - this.pos.z) : 0;
    this.moving = d > 0.01;
    if (this.moving) { this.dist += d; this.lastStep = now; }
    else if (now - this.lastStep > 60) this.dist = 0;
    const dt = this._lastNow ? now - this._lastNow : 16.7;
    this._lastNow = now;
    this.speed = this.moving ? d / Math.max(dt, 1) : 0;
    this.pos = np; this.face = b.face; this.map = b.map;
    this.tx = b.tx ?? tileOf(np.x); this.tz = b.tz ?? tileOf(np.z);
  }
  /** Vue « meneur » pour son Pokémon qui suit. */
  get leader() { return this.pos && { map: this.map, ...this.pos, face: this.face, tx: this.tx, tz: this.tz, speed: this.speed }; }
  get tile() { return this.pos ? [tileOf(this.pos.x), tileOf(this.pos.z)] : [0, 0]; }
  get frame() { return walkFrame(this.face, this.moving, this.dist); }
}

/**
 * Pokémon qui suit (façon HeartGold/SoulSilver) : il occupe toujours la case que son meneur
 * vient de quitter, à la même vitesse que lui. Fonctionne pour soi comme pour les amis.
 */
export class Follower {
  constructor(species) {
    this.species = species;
    this.out = false;
    this.tile = null; this.pos = null; this.face = 1; this.dist = 0; this.moving = false;
    this.move = null; this.leaderTile = null; this.leaderMap = null;
    this.fx = null; // effet en cours : { kind: 'spawn'|'recall'|'appear', t0, from, to }
  }
  placeBehind(leader) {
    const [dx, dz] = DIRS[OPPOSITE[leader.face]];
    this.tile = [tileOf(leader.x) + dx, tileOf(leader.z) + dz];
    this.pos = { x: center(this.tile[0]), y: leader.y, z: center(this.tile[1]) };
    this.face = leader.face;
    this.leaderTile = leaderTile(leader);
    this.leaderMap = leader.map;
    this.move = null; this.hidden = false; this.waitStep = false;
  }
  /** Sortir le Pokémon : lancer de Poké Ball depuis le joueur vers la case derrière lui. */
  spawn(now, leader) {
    this.placeBehind(leader);
    this.out = true;
    this.fx = { kind: 'spawn', t0: now };
  }
  recall(now) { this.fx = { kind: 'recall', t0: now }; }
  update(now, leader) {
    if (!this.out || !leader) return;
    if (this.fx?.kind === 'recall' && now - this.fx.t0 > 520) { this.out = false; this.fx = null; return; }
    if (leader.map !== this.leaderMap) { // changement de zone : il attend le premier pas pour sortir derrière son dresseur
      this.leaderMap = leader.map; this.leaderTile = leaderTile(leader);
      this.hidden = true; this.waitStep = true; this.move = null; this.fx = null;
      return;
    }
    const lt = leaderTile(leader);
    if (this.waitStep) {
      if (lt[0] !== this.leaderTile[0] || lt[1] !== this.leaderTile[1]) {
        this.tile = this.leaderTile;
        this.pos = { x: center(this.tile[0]), y: leader.y, z: center(this.tile[1]) };
        this.face = leader.face; this.leaderTile = lt; this.waitStep = false; this.hidden = false;
        this.fx = { kind: 'appear', t0: now };
      }
      return;
    }
    if (lt[0] !== this.leaderTile[0] || lt[1] !== this.leaderTile[1]) {
      const prev = this.leaderTile;
      // même vitesse que le meneur : marche 16 frames/case, course 8, vélo 4
      const dur = leader.speed > 0.005 ? clamp(TILE / leader.speed, 60, 280) : 266;
      if (prev[0] !== this.tile[0] || prev[1] !== this.tile[1]) {
        const from = { ...this.pos };
        const dx = prev[0] - this.tile[0], dz = prev[1] - this.tile[1];
        if (Math.abs(dx) + Math.abs(dz) > 2) { this.placeBehind(leader); }
        else {
          this.face = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 3 : 2) : (dz > 0 ? 1 : 0);
          this.move = { from, to: { x: center(prev[0]), y: leader.y, z: center(prev[1]) }, t0: now, dur };
          this.tile = prev;
        }
      }
      this.leaderTile = lt;
    }
    if (this.move) {
      const k = clamp((now - this.move.t0) / this.move.dur, 0, 1);
      const np = {
        x: this.move.from.x + (this.move.to.x - this.move.from.x) * k,
        y: this.move.to.y,
        z: this.move.from.z + (this.move.to.z - this.move.from.z) * k,
      };
      this.dist += Math.abs(np.x - this.pos.x) + Math.abs(np.z - this.pos.z);
      this.pos = np; this.moving = k < 1;
      if (k >= 1) this.move = null;
    } else this.moving = false;
  }
  get frame() { return walkFrame(this.face, this.moving, this.dist); }
}
