// Atelier ROM : randomizer (Universal Pokémon Randomizer ZX sur le serveur) + random map (dans le navigateur).
import { h } from '../core.js';
import { icon } from '../icons.js';
import { P2PRoom } from '../p2p.js';
import { saveRom } from '../store.js';
import { NdsRom } from '../rom.js';
import { loadGameData } from '../gamedata.js';
import { SECTIONS, TWEAKS_FR, RULES, PRESETS } from './schema.js';
import { detectRom, prettyName, sizeLabel } from './games.js';
import { DOOR_GAMES, DOOR_MODES, shuffleDoors } from '../rando/doors.js';
import { uprInfo, uprRandomize } from './upr-browser.js';

const DOOR_CHOICES = [
  ['off', 'Portes normales', 'Chaque porte mène où prévu.'],
  ['city', 'Mélange par ville', 'Les bâtiments d’une ville échangent leurs portes. Toujours finissable.'],
  ['region', 'Mélange régional', 'Un bâtiment peut se retrouver dans une autre ville, jamais plus loin que prévu dans l’histoire. Finissable.'],
  ['chaos', 'Chaos', 'Bâtiments, grottes, escaliers : chaque porte téléporte n’importe où. On revient toujours par où on est entré.'],
];

// Valeurs de départ (identiques à UPR à l'ouverture) ; remplacées par celles renvoyées par le serveur pour ce jeu.
const DEFAULTS = {};
for (const s of SECTIONS) for (const f of s.fields) {
  if (f.type === 'choice') DEFAULTS[f.key] = f.options[0][0];
  if (f.type === 'bool') DEFAULTS[f.key] = false;
  if (f.type === 'int') DEFAULTS[f.key] = f.min > 0 ? f.min : 0;
}
Object.assign(DEFAULTS, { wildPokemonRestrictionMod: 'NONE', selectedEXPCurve: 'MEDIUM_FAST', guaranteedMoveCount: 2, movesetsGoodDamagingPercent: 0,
  trainersForceFullyEvolvedLevel: 30, minimumCatchRateLevel: 1, allowWonderGuard: true, customStarters: [1, 1, 1] });

const S = {
  rom: null, file: null, bytes: null, upload: { state: 'idle' }, info: null,
  values: { ...DEFAULTS }, tweaks: new Set(), doors: 'off', rules: new Set(), seed: randomSeed(),
  section: 'pokemon', preset: null, result: null, busy: false, step: '',
  net: null, room: null, me: null, peers: new Map(), incoming: null, hostRun: null,
};
function randomSeed() { return String(Math.floor(Math.random() * 9e14) + 1e14); }

const root = document.getElementById('atelier');
const els = {};

// ------------------------------------------------------------------------------------------ structure
function build() {
  root.replaceChildren(
    h('header.at-head', {},
      h('a.at-brand', { href: 'index.html' }, h('span.at-logo', { html: icon('link-2', 18) }), h('b', {}, 'PokéLink'), h('span', {}, 'Atelier ROM')),
      els.roomChip = h('div.at-room'),
    ),
    h('main.at-grid', {},
      h('aside.at-side', {},
        els.romCard = h('section.at-card.glass'),
        els.presetCard = h('section.at-card.glass'),
        els.seedCard = h('section.at-card.glass'),
      ),
      h('section.at-main.glass', {},
        els.nav = h('nav.at-nav'),
        h('div.at-panel', {}, els.banner = h('div.at-banner-slot'), els.fields = h('div.at-fields')),
      ),
    ),
    els.bar = h('footer.at-bar.glass'),
    els.modal = h('div.at-modal-slot'),
  );
  renderAll();
}
const renderAll = () => { renderRoom(); renderRom(); renderPresets(); renderSeed(); renderNav(); renderBanner(); renderFields(); renderBar(); };

// ------------------------------------------------------------------------------------------ ROM
function renderRom() {
  const r = S.rom, up = S.upload;
  const input = h('input', { type: 'file', accept: '.nds,.gba,.gb,.gbc,.sgb', hidden: true, onchange: e => e.target.files[0] && pickRom(e.target.files[0]) });
  if (!r) {
    els.romCard.replaceChildren(
      h('h2.at-h', {}, h('span', { html: icon('file-up', 16) }), 'Ta ROM'),
      h('label.at-drop', { ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: e => e.currentTarget.classList.remove('over'),
        ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('over'); e.dataTransfer.files[0] && pickRom(e.dataTransfer.files[0]); } },
        input, h('span.at-drop-ic', { html: icon('upload', 22) }), h('b', {}, 'Choisir ou déposer une ROM'), h('small', {}, 'Gen 1 à 5 · .gb .gbc .gba .nds')),
    );
    return;
  }
  const status = {
    idle: ['', ''], reading: ['Lecture de la ROM', ''], analyzing: ['Démarrage du randomizer dans ton navigateur', ''],
    ready: ['Prête', ''], error: [up.error || 'Erreur', ''], local: ['Prête (random map seul)', ''],
  }[up.state];
  els.romCard.replaceChildren(
    h('h2.at-h', {}, h('span', { html: icon('file-up', 16) }), 'Ta ROM'),
    h('div.at-game', {},
      h('div.at-cart', { 'data-p': r.platform }, h('span', {}, r.platform.toUpperCase())),
      h('div.at-game-txt', {}, h('b', {}, r.name), h('small', {}, [`Gen ${r.gen}`, r.lang, sizeLabel(S.file.size)].filter(Boolean).join(' · '))),
      h('label.at-icon-btn', { title: 'Changer de ROM' }, input, h('span', { html: icon('rotate-ccw', 16) })),
    ),
    h('div.at-status', { 'data-s': up.state },
      h('div.at-progress', {}, h('i', { style: { transform: `scaleX(${up.state === 'idle' ? 0 : 1})` } })),
      h('div.at-status-row', {}, h('span', {}, status[0]), h('span', {}, status[1])),
    ),
    h('p.at-note', {}, h('span', { html: icon('lock', 12) }), 'Elle reste sur ton ordinateur : le randomizer tourne dans ton navigateur.'),
  );
}

async function pickRom(file) {
  const head = new Uint8Array(await file.slice(0, 0x200).arrayBuffer());
  const rom = detectRom(head, file.name);
  S.result = null;
  if (!rom) { S.rom = null; toast('Ce fichier n’est pas une ROM Pokémon Gen 1 à 5 reconnue.'); renderAll(); return; }
  Object.assign(S, { rom, file, info: null, bytes: null, upload: { state: 'reading' } });
  if (!DOOR_GAMES[rom.code] && S.doors !== 'off') S.doors = 'off';
  renderAll();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (S.file !== file) return;
    S.bytes = bytes; S.upload = { state: 'analyzing' }; renderRom();
    const info = await uprInfo(bytes, rom.platform);
    if (S.file !== file) return;
    S.info = info; S.upload = { state: 'ready' };
    // valeurs par défaut d'UPR pour ce jeu, sans écraser ce que le joueur a déjà choisi
    const changed = Object.keys(S.values).filter(k => JSON.stringify(S.values[k]) !== JSON.stringify(DEFAULTS[k]));
    for (const [k, v] of Object.entries(info.defaults || {})) if (k in DEFAULTS && !changed.includes(k)) S.values[k] = v;
    for (const b of [...S.tweaks]) if (!info.tweaks.some(t => t.bit === b)) S.tweaks.delete(b);
  } catch (e) {
    if (S.file !== file) return;
    // sans randomizer, le random map reste possible : il est écrit en JavaScript
    S.upload = { state: DOOR_GAMES[rom.code] ? 'local' : 'error', error: e.message };
    toast(e.message);
  }
  renderAll();
}

// ------------------------------------------------------------------------------------------ formules, graine, room
function renderPresets() {
  els.presetCard.replaceChildren(
    h('h2.at-h', {}, h('span', { html: icon('wand-sparkles', 16) }), 'Formules'),
    h('div.at-presets', {}, ...PRESETS.map(p => h('button.at-preset', { 'aria-pressed': String(S.preset === p.id), onclick: () => applyPreset(p) },
      h('b', {}, p.name), h('small', {}, p.sub)))),
  );
}
function applyPreset(p) {
  S.values = { ...DEFAULTS, ...(S.info?.defaults ? pick(S.info.defaults) : {}), ...p.settings };
  S.tweaks = new Set(p.tweaks.filter(b => !S.info || S.info.tweaks.some(t => t.bit === b)));
  S.doors = S.rom && !DOOR_GAMES[S.rom.code] ? 'off' : p.doors;
  S.rules = new Set(p.rules); S.preset = p.id; S.result = null; S.imported = null;
  renderAll();
}
const pick = o => Object.fromEntries(Object.entries(o).filter(([k]) => k in DEFAULTS));

function renderSeed() {
  const inp = h('input.at-input.mono', { value: S.seed, inputmode: 'numeric', maxlength: 15, 'aria-label': 'Graine',
    onchange: e => { const v = e.target.value.replace(/\D/g, '').slice(0, 15); S.seed = v || randomSeed(); S.result = null; renderSeed(); renderBar(); } });
  els.seedCard.replaceChildren(
    h('h2.at-h', {}, h('span', { html: icon('dices', 16) }), 'Graine de la run'),
    h('div.at-seed', {}, inp, h('button.at-icon-btn', { title: 'Nouvelle graine', onclick: () => { S.seed = randomSeed(); S.result = null; renderSeed(); renderBar(); } }, h('span', { html: icon('shuffle', 16) }))),
    h('p.at-note', {}, 'Même ROM, mêmes réglages, même graine : exactement la même aventure pour tout le monde.'),
    h('p.at-note', {}, 'Randomizer : Universal Pokémon Randomizer ZX, exécuté dans ton navigateur · Built with CheerpJ'),
    h('div.at-row2', {},
      h('button.at-btn.ghost', { onclick: importString }, h('span', { html: icon('clipboard-paste', 14) }), 'Coller des réglages UPR'),
      S.net ? h('button.at-btn.ghost', { onclick: shareRun, disabled: !S.rom }, h('span', { html: icon('share-2', 14) }), 'Proposer à la room') : null,
    ),
  );
}

function renderRoom() {
  if (!S.room) { els.roomChip.replaceChildren(); return; }
  els.roomChip.replaceChildren(h('span.at-chip', {}, 'ROOM ', h('b', {}, S.room)), h('span.at-chip', {}, h('i.dot'), `${S.peers.size + 1} joueur${S.peers.size ? 's' : ''}`));
}

async function connectRoom() {
  const code = new URLSearchParams(location.search).get('room');
  if (!code) return;
  const net = new P2PRoom();
  try {
    const j = await net.connect('', 'join', code);
    S.net = net; S.room = j.code; S.me = j.id;
    for (const p of j.peers) S.peers.set(p, { name: 'Ami' });
    const name = localStorage.getItem('pokelink.name') || 'Moi';
    net.send('hello', { profile: { name }, team: [] });
    net.on('hello', m => { S.peers.set(m.from, { name: m.profile?.name || 'Ami' }); renderRoom(); renderBanner(); });
    net.on('leave', m => { S.peers.delete(m.from); renderRoom(); });
    net.on('run-config', m => { if (m.from === S.me) return; S.incoming = m.run; S.hostRun = m.run; renderBanner(); renderBar(); });
    renderAll();
  } catch (e) { toast('Room : ' + e.message); }
}

function runConfig() {
  const settings = {};
  for (const [k, v] of Object.entries(S.values)) if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) settings[k] = v;
  return { game: S.rom?.code, gameName: S.rom?.name, settings, tweaks: [...S.tweaks], doors: S.doors, rules: [...S.rules], seed: S.seed,
    preset: S.preset, by: localStorage.getItem('pokelink.name') || 'Hôte', fingerprint: S.result?.fingerprint || null };
}
function shareRun() {
  S.net.send('run-config', { run: runConfig() });
  toast('Réglages et graine proposés à la room.');
}
function applyRun(run) {
  S.values = { ...DEFAULTS, ...(S.info?.defaults ? pick(S.info.defaults) : {}), ...run.settings };
  S.tweaks = new Set(run.tweaks); S.doors = run.doors; S.rules = new Set(run.rules); S.seed = run.seed; S.preset = run.preset; S.result = null;
  S.incoming = null;
  renderAll();
}
function renderBanner() {
  const run = S.incoming;
  if (!run && S.imported) {
    els.banner.replaceChildren(h('div.at-banner', {}, h('span.at-banner-ic', { html: icon('clipboard-paste', 18) }),
      h('div', {}, h('b', {}, 'Réglages UPR importés'), h('small.mono', {}, S.imported.slice(0, 42) + (S.imported.length > 42 ? '…' : ''))),
      h('button.at-icon-btn', { title: 'Retirer', onclick: () => { S.imported = null; renderAll(); } }, h('span', { html: icon('x', 16) }))));
    return;
  }
  if (!run) { els.banner.replaceChildren(); return; }
  const n = Object.keys(run.settings).length + run.tweaks.length + (run.doors !== 'off' ? 1 : 0);
  els.banner.replaceChildren(h('div.at-banner', {},
    h('span.at-banner-ic', { html: icon('users', 18) }),
    h('div', {}, h('b', {}, `${run.by} propose une run`), h('small', {}, `${run.gameName || 'Jeu'} · graine ${run.seed} · ${n} réglage${n > 1 ? 's' : ''}${run.doors !== 'off' ? ' · ' + DOOR_CHOICES.find(d => d[0] === run.doors)[1].toLowerCase() : ''}`)),
    h('button.at-btn', { onclick: () => applyRun(run) }, 'Appliquer'),
    h('button.at-icon-btn', { title: 'Ignorer', onclick: () => { S.incoming = null; renderBanner(); } }, h('span', { html: icon('x', 16) })),
  ));
}

// ------------------------------------------------------------------------------------------ sections et réglages
const visibleField = f => {
  const gen = S.rom?.gen;
  if (f.gen && gen && (gen < f.gen[0] || gen > f.gen[1])) return false;
  if (f.cap && S.info && !S.info.caps[f.cap]) return false;
  if (f.if && !f.if(S.values)) return false;
  return true;
};
const sectionChanges = sec => sec.fields.reduce((n, f) => {
  if (f.type === 'tweaks') return n + S.tweaks.size;
  if (f.type === 'doors') return n + (S.doors !== 'off' ? 1 : 0);
  if (f.type === 'rules') return n + S.rules.size;
  return n + (visibleField(f) && JSON.stringify(S.values[f.key]) !== JSON.stringify(DEFAULTS[f.key]) ? 1 : 0);
}, 0);

function renderNav() {
  els.nav.replaceChildren(...SECTIONS.map(sec => {
    const n = sectionChanges(sec);
    return h('button.at-tab', { 'aria-current': String(S.section === sec.id), onclick: () => { S.section = sec.id; renderNav(); renderFields(); } },
      h('span.at-tab-ic', { html: icon(sec.icon, 18) }),
      h('span.at-tab-txt', {}, h('b', {}, sec.title), h('small', {}, sec.sub)),
      h('span.at-count', { hidden: !n }, String(n)));
  }));
}

function set(key, v) {
  S.values[key] = v; S.preset = null; S.result = null; S.imported = null;
  renderFields(); renderNav(); renderPresets(); renderBar();
}

function renderFields() {
  const sec = SECTIONS.find(s => s.id === S.section);
  const head = h('div.at-sec-head', {}, h('span.at-sec-ic', { html: icon(sec.icon, 22) }), h('div', {}, h('h1', {}, sec.title), h('p', {}, sec.sub)));
  const rows = [];
  for (const f of sec.fields) {
    if (!visibleField(f)) continue;
    if (f.type === 'choice') rows.push(h('div.at-field', {}, h('label.at-label', {}, f.label),
      h('div.at-seg', { role: 'radiogroup' }, ...f.options.map(([v, l]) => h('button.at-seg-btn', { role: 'radio', 'aria-checked': String(S.values[f.key] === v), onclick: () => set(f.key, v) }, l)))));
    if (f.type === 'bool') rows.push(toggleRow(f.label, f.hint, !!S.values[f.key], v => set(f.key, v)));
    if (f.type === 'int') {
      const val = S.values[f.key] ?? f.min, out = h('output.at-val', {}, fmt(val, f));
      rows.push(h('div.at-field.sub', {}, h('div.at-label-row', {}, h('label.at-label', {}, f.label), out),
        h('input.at-range', { type: 'range', min: f.min, max: f.max, step: f.step, value: val, oninput: e => { out.textContent = fmt(+e.target.value, f); }, onchange: e => set(f.key, +e.target.value) })));
    }
    if (f.type === 'starters') rows.push(startersField());
    if (f.type === 'tweaks') rows.push(...tweaksFields());
    if (f.type === 'doors') rows.push(doorsField());
    if (f.type === 'rules') rows.push(...RULES.map(([id, name, desc]) => toggleRow(name, desc, S.rules.has(id), v => { v ? S.rules.add(id) : S.rules.delete(id); S.preset = null; renderFields(); renderNav(); renderPresets(); renderBar(); })));
  }
  if (sec.id === 'rules') rows.push(h('p.at-note.pad', {}, 'Choix de départ, partagés avec la room. En jeu, la touche R permet à chacun de les activer ou de les couper à tout moment (Platine pour l’instant).'));
  els.fields.replaceChildren(head, h('div.at-rows', {}, ...rows));
}
const fmt = (v, f) => f.unit === '%' ? `${v > 0 ? '+' : ''}${v} %` : String(v);

function toggleRow(label, hint, on, onChange) {
  return h('button.at-toggle', { role: 'switch', 'aria-checked': String(on), onclick: () => onChange(!on) },
    h('span.at-toggle-txt', {}, h('b', {}, label), hint ? h('small', {}, hint) : null),
    h('span.at-switch', {}, h('i')));
}

function startersField() {
  const list = S.info?.pokemon || [];
  const sel = i => h('select.at-select', { onchange: e => { const a = [...S.values.customStarters]; a[i] = +e.target.value; set('customStarters', a); } },
    h('option', { value: 1 }, 'Au hasard'),
    ...list.filter(([n]) => n <= 649).map(([n, name]) => h('option', { value: n + 1, selected: S.values.customStarters[i] === n + 1 }, `${String(n).padStart(3, '0')} · ${prettyName(name)}`)));
  return h('div.at-field', {}, h('label.at-label', {}, 'Mes trois starters'),
    list.length ? h('div.at-starters', {}, sel(0), sel(1), sel(2)) : h('p.at-note', {}, 'Charge ta ROM pour choisir parmi les Pokémon de ton jeu.'));
}

function tweaksFields() {
  const avail = S.info ? S.info.tweaks : null;
  if (!avail) return [h('p.at-note.pad', {}, 'Les options de confort dépendent du jeu : charge ta ROM pour les voir.')];
  return avail.map(t => {
    const [name, desc] = TWEAKS_FR[t.bit] || [t.name, ''];
    return toggleRow(name, desc, S.tweaks.has(t.bit), v => { v ? S.tweaks.add(t.bit) : S.tweaks.delete(t.bit); S.preset = null; S.result = null; renderFields(); renderNav(); renderPresets(); renderBar(); });
  });
}

function doorsField() {
  const ok = !S.rom || DOOR_GAMES[S.rom.code];
  return h('div.at-field', {},
    h('div.at-doors', {}, ...DOOR_CHOICES.map(([id, name, desc]) => h('button.at-door', { 'aria-pressed': String(S.doors === id), disabled: !ok && id !== 'off',
      onclick: () => { S.doors = id; S.preset = null; S.result = null; renderFields(); renderNav(); renderPresets(); renderBar(); } },
      h('span.at-door-ic', { html: icon(id === 'off' ? 'map' : id === 'chaos' ? 'sparkles' : id === 'region' ? 'footprints' : 'door-open', 20) }),
      h('b', {}, name), h('small', {}, desc)))),
    ok ? h('p.at-note.pad', {}, 'Le mélange des portes se fait dans ton navigateur, après le randomizer.')
      : h('p.at-note.pad.warn', {}, h('span', { html: icon('info', 12) }), `Random map pas encore disponible pour ${S.rom.name} : Platine d’abord, les autres jeux arrivent.`),
  );
}

// ------------------------------------------------------------------------------------------ barre d'action et résultat
const uprChanged = () => !!S.imported || Object.keys(S.values).some(k => JSON.stringify(S.values[k]) !== JSON.stringify(DEFAULTS[k])) || S.tweaks.size > 0;

function renderBar() {
  const total = SECTIONS.reduce((n, s) => n + sectionChanges(s), 0) + (S.imported ? 1 : 0);
  const canRun = S.rom && !S.busy && (S.upload.state === 'ready' || (S.upload.state === 'local' && !uprChanged() && S.doors !== 'off')) && total > 0;
  const host = S.hostRun && S.result && S.hostRun.fingerprint && S.hostRun.game === S.rom?.code
    ? (S.hostRun.fingerprint === S.result.fingerprint ? h('span.at-match.ok', { html: icon('check', 14) + ` Même aventure que ${S.hostRun.by}` }) : h('span.at-match.ko', { html: icon('circle-alert', 14) + ` Différente de celle de ${S.hostRun.by}` }))
    : null;
  els.bar.replaceChildren(...[
    h('div.at-bar-txt', {},
      h('b', {}, S.result ? 'ROM prête' : total ? `${total} réglage${total > 1 ? 's' : ''} modifié${total > 1 ? 's' : ''}` : 'Aucun réglage modifié'),
      h('small', {}, S.result ? `Empreinte ${S.result.fingerprint} · graine ${S.seed}` : S.busy ? S.step : S.rom ? `${S.rom.name} · graine ${S.seed}` : 'Charge ta ROM pour commencer'),
    ),
    host,
    S.result ? h('div.at-bar-actions', {},
      h('button.at-btn.ghost', { onclick: showLog }, h('span', { html: icon('scroll-text', 16) }), 'Journal'),
      h('button.at-btn.ghost', { onclick: download }, h('span', { html: icon('download', 16) }), 'Télécharger'),
      h('a.at-btn.primary', { href: `play.html?rom=current${S.room ? '&room=' + S.room : ''}` }, h('span', { html: icon('play', 16) }), 'Jouer'),
    ) : h('button.at-btn.primary', { disabled: !canRun, onclick: randomize }, S.busy ? h('span.at-spin') : h('span', { html: icon('wand-sparkles', 16) }), S.busy ? 'Randomisation…' : 'Randomiser'),
  ].filter(Boolean));
}

async function randomize() {
  S.busy = true; S.step = 'Le randomizer prépare ta ROM…'; renderBar();
  try {
    let bytes, upr = null;
    if (uprChanged()) {
      const settings = {};
      for (const sec of SECTIONS) for (const f of sec.fields) if (['choice', 'bool', 'int'].includes(f.type)) settings[f.key] = S.values[f.key];
      if (S.values.startersMod === 'CUSTOM') settings.customStarters = S.values.customStarters;
      settings.miscTweaks = [...S.tweaks];
      const r = await uprRandomize(S.rom.platform, S.imported ? { settingsString: S.imported } : { values: settings }, S.seed);
      upr = r; bytes = r.bytes;
    } else {
      bytes = (S.bytes || new Uint8Array(await S.file.arrayBuffer())).slice();
    }
    let doors = null;
    if (S.doors !== 'off') { S.step = 'Mélange des portes…'; renderBar(); await new Promise(r => setTimeout(r, 30)); doors = shuffleDoors(bytes, { mode: S.doors, seed: S.seed }); }
    const fingerprint = makeFingerprint(upr?.check ?? 0, doors);
    S.result = { bytes, upr, doors, fingerprint, name: outName() };
    await saveRom('current', { name: S.result.name, code: S.rom.code, platform: S.rom.platform, bytes, fingerprint, run: runConfig(), at: Date.now() }).catch(() => {});
    if (S.net && S.hostRun == null) S.net.send('run-config', { run: runConfig() });   // l'hôte partage aussi son empreinte
  } catch (e) { toast(e.message); }
  S.busy = false; renderBar(); renderSeed();
}

function makeFingerprint(check, doors) {
  let hsh = 0x811c9dc5;
  const mix = s => { for (const c of String(s)) hsh = Math.imul(hsh ^ c.charCodeAt(0), 16777619) >>> 0; };
  mix(check); if (doors) for (const l of doors.links) mix(`${l.from.map}:${l.from.x}:${l.to.map}`);
  const a = (check >>> 0).toString(16).toUpperCase().padStart(8, '0'), b = hsh.toString(16).toUpperCase().padStart(8, '0');
  return `${a.slice(0, 4)}-${b.slice(0, 4)}`;
}
const outName = () => `${S.rom.name.replace('Pokémon ', 'Pokemon ')} - PokeLink ${S.seed}.${S.rom.platform === 'nds' ? 'nds' : S.rom.platform}`;

function download() {
  const url = URL.createObjectURL(new Blob([S.result.bytes], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: S.result.name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function showLog() {
  const r = S.result, parts = [];
  if (r.upr) parts.push(h('section.at-log-sec', {}, h('h3', {}, 'Randomizer'), h('pre.at-pre', {}, summarizeLog(r.upr.log))));
  if (r.doors) parts.push(h('section.at-log-sec', {}, h('h3', {}, `Random map · ${r.doors.changed} portes déplacées`), h('pre.at-pre', {}, doorLog(r))));
  if (r.upr?.warnings?.length) parts.push(h('section.at-log-sec', {}, h('h3', {}, 'Remarques'), h('ul', {}, ...r.upr.warnings.map(w => h('li', {}, w)))));
  const close = () => els.modal.replaceChildren();
  els.modal.replaceChildren(h('div.at-modal', { onclick: e => e.target === e.currentTarget && close() },
    h('div.at-dialog.glass', {},
      h('div.at-dialog-head', {}, h('h2', {}, 'Journal de la run'), h('button.at-icon-btn', { onclick: close, title: 'Fermer' }, h('span', { html: icon('x', 18) }))),
      h('div.at-dialog-body', {}, ...parts),
      h('div.at-dialog-foot', {}, h('button.at-btn.ghost', { onclick: () => navigator.clipboard?.writeText(r.upr?.settingsString || '') }, h('span', { html: icon('copy', 14) }), 'Copier les réglages UPR')),
    )));
}
// Le journal d'UPR est très long : on garde l'essentiel lisible (starters, statiques, échanges), le reste reste disponible en entier.
function summarizeLog(log = '') {
  const keep = [], lines = log.split(/\r?\n/);
  let on = false;
  for (const l of lines) {
    if (/^--.*(Starters|Static Pokemon|In-Game Trades|Random Seed|Settings String)/i.test(l) || /^Random Seed|^Randomizer Version/.test(l)) on = true;
    else if (/^--/.test(l)) on = false;
    if ((on || /^Random Seed/.test(l)) && !/nchanged/.test(l)) keep.push(l);
  }
  return keep.join('\n').trim() || log.slice(0, 4000);
}
function doorLog(r) {
  let places = [];
  try { places = loadGameData(new NdsRom(r.bytes)).text.places; } catch {}
  const kind = n => /pokecenter/.test(n) ? 'Centre Pokémon' : /mart|store/.test(n) ? 'Boutique' : /gym/.test(n) ? 'Arène' : /house|condominium/.test(n) ? 'Maison'
    : /gate/.test(n) ? 'Poste de garde' : /cave|tunnel|ruins|mt_|cavern|mansion/.test(n) ? 'Grotte ou ruines' : /^route|_city$|_town$/.test(n) ? 'Extérieur' : 'Bâtiment';
  const place = e => places[e.label] || prettyName(e.name.replace(/_/g, ' '));
  return r.doors.links.filter(l => l.from.map !== l.to.map)
    .map(l => `${place(l.from)} (${l.from.x}, ${l.from.z})  →  ${kind(l.to.name)} · ${place(l.to)}`).join('\n');
}

function importString() {
  const ta = h('textarea.at-input.mono.at-ta', { rows: 4, placeholder: '322AAgEBgL…', spellcheck: false });
  const close = () => els.modal.replaceChildren();
  const ok = () => {
    const str = ta.value.trim();
    if (!/^[0-9]{3}[A-Za-z0-9+/=]+$/.test(str)) { toast('Ce n’est pas une chaîne de réglages UPR valide.'); return; }
    S.imported = str; S.preset = null; S.result = null; close(); renderAll();
  };
  els.modal.replaceChildren(h('div.at-modal', { onclick: e => e.target === e.currentTarget && close() },
    h('div.at-dialog.small.glass', {},
      h('div.at-dialog-head', {}, h('h2', {}, 'Réglages de l’Universal Randomizer'), h('button.at-icon-btn', { onclick: close, title: 'Fermer' }, h('span', { html: icon('x', 18) }))),
      h('div.at-dialog-body', {}, h('p.at-note', {}, 'Colle la chaîne copiée depuis UPR (« Settings string ») : elle sera appliquée telle quelle, à l’identique.'), ta),
      h('div.at-dialog-foot', {}, h('button.at-btn.ghost', { onclick: close }, 'Annuler'), h('button.at-btn.primary', { onclick: ok }, 'Utiliser ces réglages')),
    )));
  ta.focus();
}


// ------------------------------------------------------------------------------------------ messages
let toastTimer;
function toast(text) {
  document.querySelector('.at-toast')?.remove();
  const t = h('div.at-toast.glass', {}, h('span', { html: icon('info', 16) }), text);
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4200);
}

build();
connectRoom();
window.ATELIER = { S, renderAll, applyPreset: id => applyPreset(PRESETS.find(p => p.id === id)), pickRom };
