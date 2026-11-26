// Tests du format Pokémon 4G et du miroir d'équipe (sans ROM ni sauvegarde : Pokémon synthétique).
import assert from 'assert';
import { crypt, monIsStable, PartyMirror, withPartyHP } from '../web/js/pk4.js';

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
function makeMon(pid, hp) {
  const plain = new Uint8Array(128);
  for (let i = 0; i < 128; i++) plain[i] = (i * 37 + pid) & 0xff;
  let chk = 0; for (let i = 0; i < 128; i += 2) chk = (chk + u16(plain, i)) & 0xffff;
  const raw = new Uint8Array(236);
  raw[0] = pid & 0xff; raw[1] = (pid >> 8) & 0xff; raw[2] = (pid >> 16) & 0xff; raw[3] = pid >>> 24;
  raw[6] = chk & 0xff; raw[7] = chk >> 8;
  raw.set(crypt(plain, chk), 8);
  const P = new Uint8Array(100); P[4] = 50; P[6] = hp & 0xff; P[7] = hp >> 8; P[8] = 200; P[9] = 0;
  raw.set(crypt(P, pid), 136);
  return raw;
}
const hpOf = raw => { const P = crypt(raw.subarray(136, 236), (raw[0] | raw[1] << 8 | raw[2] << 16 | raw[3] << 24) >>> 0); return u16(P, 6); };

const a = makeMon(0x7942ef72, 150), b = makeMon(0x12345678, 90);
assert(monIsStable(a) && monIsStable(b), 'Pokémon synthétique stable');

// Pokémon de tête « à mi-rechiffrement » : les derniers octets du bloc sont encore en clair.
const mid = a.slice(); const plainTail = crypt(a.subarray(8, 136), u16(a, 6)).subarray(106, 128); mid.set(plainTail, 114);
assert(!monIsStable(mid), 'mi-rechiffrement détecté');
const open = a.slice(); open[4] |= 1;
assert(!monIsStable(open), 'contexte de déchiffrement ouvert détecté');
assert(monIsStable(new Uint8Array(236)), 'emplacement vide accepté');

const party = (m0, m1) => { const r = new Uint8Array(4 + 6 * 236); r[0] = 2; r.set(m0, 4); r.set(m1, 240); return r; };
const mirror = new PartyMirror();
mirror.ingest(party(a, b));
let view = mirror.ingest(party(mid, b));
assert.deepStrictEqual(view.subarray(4, 240), a, 'lecture instable remplacée par la dernière lecture stable');

const ko = withPartyHP(a, 0, 0);
assert.strictEqual(hpOf(ko), 0); assert(monIsStable(ko), 'écriture des PV : Pokémon toujours valide');
mirror.write(0, ko);
view = mirror.ingest(party(a, b));
assert.strictEqual(hpOf(view.subarray(4, 240)), 0, "l'écriture en attente reste visible tant que la RAM ne l'a pas reçue");
assert.strictEqual(mirror.pending.size, 1);
mirror.ingest(party(ko, b));
assert.strictEqual(mirror.pending.size, 0, 'écriture confirmée dès que la RAM la contient');

console.log('OK — format 4G : stabilité, mi-rechiffrement, miroir d’équipe, écriture des PV');
