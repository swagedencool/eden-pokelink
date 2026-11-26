// L'Universal Pokémon Randomizer ZX (Java, GPL-3.0) exécuté dans le navigateur grâce à CheerpJ
// (machine virtuelle Java en WebAssembly, licence Community gratuite pour un usage personnel, « Built with CheerpJ »).
// La ROM ne quitte jamais l'ordinateur : elle est passée à Java en mémoire (/str/), le résultat est relu de /files/.

const LOADER = 'https://cjrtnc.leaningtech.com/5.0/loader.js';
let ready = null;

/** Charge CheerpJ une seule fois (quelques Mo au premier lancement, mis en cache par le navigateur ensuite). */
export function loadJava() {
  if (!ready) ready = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LOADER;
    s.onload = async () => {
      try { await window.cheerpjInit({ version: 8 }); resolve(); } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error('Le randomizer n’a pas pu se charger (CheerpJ injoignable : connexion internet ?)'));
    document.head.append(s);
  }).catch(e => { ready = null; throw e; });
  return ready;
}

// /app/ = la racine du site vue par Java : le jar est servi avec le site.
const jarPath = () => '/app' + new URL('vendor/upr/upr.jar', document.baseURI).pathname;
let run = 0;

async function java(args, resultFile) {
  await loadJava();
  const code = await window.cheerpjRunMain('PokeLinkUPR', jarPath(), ...args);
  let res;
  try { res = JSON.parse(await (await window.cjFileBlob(resultFile)).text()); } catch { res = null; }
  if (!res) throw new Error(`Le randomizer s’est arrêté (code ${code})`);
  if (!res.ok) throw new Error(String(res.error || 'Le randomizer a échoué').replace(/^([\w.$]*(Exception|Error):\s*)+/, ''));
  return res;
}

/** Infos du jeu : nom, génération, possibilités, réglages par défaut, liste des Pokémon. */
export async function uprInfo(bytes, ext) {
  await loadJava();
  window.cheerpOSAddStringFile(`/str/rom.${ext}`, bytes);
  const out = `/files/info-${++run}.json`;
  return java(['info', `/str/rom.${ext}`, out], out);
}

/** Randomise la ROM (déjà passée par uprInfo) ; renvoie le résultat, la ROM modifiée et le journal. */
export async function uprRandomize(ext, settings, seed) {
  await loadJava();
  const lines = [];
  if (settings.settingsString) lines.push('settingsString=' + settings.settingsString);
  for (const [k, v] of Object.entries(settings.values || {})) lines.push(`${k}=${Array.isArray(v) ? v.join(',') : v}`);
  window.cheerpOSAddStringFile('/str/settings.txt', lines.join('\n'));
  const n = ++run, rom = `/files/out-${n}.${ext}`, out = `/files/result-${n}.json`;
  const res = await java(['randomize', `/str/rom.${ext}`, rom, '/str/settings.txt', String(seed), out], out);
  const bytes = new Uint8Array(await (await window.cjFileBlob(rom)).arrayBuffer());
  let log = '';
  try { log = await (await window.cjFileBlob(rom + '.log')).text(); } catch {}
  return { ...res, bytes, log };
}
