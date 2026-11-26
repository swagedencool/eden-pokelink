// Tests de l'atelier ROM. Avec une vraie ROM (variable ROM=chemin), on vérifie la randomisation complète ;
// sans ROM, seulement les refus (fichier invalide, session inconnue) — aucune ROM n'est livrée avec le projet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createServer } = require('./server');

(async () => {
  if (!fs.existsSync(path.join(__dirname, 'upr', 'upr.jar'))) { console.log('SAUTÉ — upr.jar absent (lancer upr/build.sh)'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-atelier-test-'));
  const { server } = await createServer({ port: 0, workshop: { dir } });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, type = 'application/octet-stream') => fetch(base + url, { method: 'POST', body, headers: { 'content-type': type } }).then(async r => ({ status: r.status, json: await r.json() }));

  // fichier qui n'est pas une ROM : refusé et supprimé
  const bad = await post('/api/atelier/rom', Buffer.alloc(4096, 7));
  assert.strictEqual(bad.status, 400); assert.strictEqual(fs.readdirSync(dir).length, 0, 'fichier refusé supprimé');
  assert.strictEqual((await fetch(base + '/api/atelier/inconnu/rom')).status, 404);
  let msg = 'refus vérifiés';

  const ROM = process.env.ROM;
  if (ROM && fs.existsSync(ROM)) {
    const up = await post('/api/atelier/rom', fs.readFileSync(ROM));
    assert.strictEqual(up.status, 200, JSON.stringify(up.json));
    const { token, info } = up.json;
    assert(info.gen >= 1 && info.gen <= 5 && info.pokemon.length > 100, 'infos du jeu');
    const settings = { wildPokemonMod: 'RANDOM', startersMod: 'COMPLETELY_RANDOM', trainersMod: 'RANDOM', miscTweaks: [info.tweaks[0].bit] };
    const r1 = await post(`/api/atelier/${token}/randomize`, JSON.stringify({ settings, seed: '123456789' }), 'application/json');
    assert(r1.json.ok, JSON.stringify(r1.json));
    const rom1 = Buffer.from(await (await fetch(`${base}/api/atelier/${token}/rom?keep=1`)).arrayBuffer());
    const r2 = await post(`/api/atelier/${token}/randomize`, JSON.stringify({ settings, seed: '123456789' }), 'application/json');
    assert.strictEqual(r2.json.check, r1.json.check, 'même graine, même résultat');
    const r3 = await post(`/api/atelier/${token}/randomize`, JSON.stringify({ settingsString: r1.json.settingsString, seed: '123456789' }), 'application/json');
    assert.strictEqual(r3.json.check, r1.json.check, 'la chaîne de réglages UPR redonne le même résultat');
    const rom2 = Buffer.from(await (await fetch(`${base}/api/atelier/${token}/rom`)).arrayBuffer());
    assert(rom1.equals(rom2) && rom1.length > 1e6, 'ROM identique téléchargée');
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(fs.readdirSync(dir).length, 0, 'ROM supprimée du serveur après téléchargement');
    msg += ` · ${info.name} randomisé (graine reproductible, chaîne UPR, suppression après téléchargement)`;
  }
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK — atelier : ' + msg);
})().catch(e => { console.error(e); process.exit(1); });
