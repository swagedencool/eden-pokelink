// Random map : avec une ROM Platine (variable ROM=chemin), vérifie les trois modes sur la vraie ROM ;
// sans ROM, vérifie seulement le générateur aléatoire (aucune ROM n'est livrée avec le projet).
import fs from 'fs';
import assert from 'assert';
import { seededRandom, shuffleDoors, checkDoors, readDoors } from '../web/js/rando/doors.js';

const a = seededRandom('nova-42'), b = seededRandom('nova-42'), c = seededRandom('autre');
const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
assert.deepStrictEqual(sa, sb, 'même graine, même suite');
assert.notDeepStrictEqual(sa, sc, 'graine différente, suite différente');
assert(sa.every(x => x >= 0 && x < 1));
let msg = 'générateur reproductible';

const ROM = process.env.ROM;
if (ROM && fs.existsSync(ROM)) {
  const orig = new Uint8Array(fs.readFileSync(ROM));
  const before = checkDoors(orig);
  assert.strictEqual(before.broken, 0);
  const counts = {};
  for (const mode of ['city', 'region', 'chaos']) {
    const x = orig.slice(), y = orig.slice();
    const r = shuffleDoors(x, { mode, seed: 'test' }); shuffleDoors(y, { mode, seed: 'test' });
    assert(Buffer.from(x).equals(Buffer.from(y)), `${mode} : reproductible`);
    const after = checkDoors(x);
    assert.strictEqual(after.broken, 0, `${mode} : chaque porte ramène d'où l'on vient`);
    assert.strictEqual(after.reciprocal, before.reciprocal);
    assert(r.changed > 50, `${mode} : des portes ont bougé`);
    // en mode région, aucun bâtiment n'est placé plus loin que sa ville d'origine dans l'histoire
    counts[mode] = r.changed;
  }
  const { maps } = readDoors(orig);
  assert.strictEqual(maps.length, 593);
  msg += ` · ville ${counts.city}, région ${counts.region}, chaos ${counts.chaos} portes déplacées, toutes réciproques`;
}
console.log('OK — random map : ' + msg);
