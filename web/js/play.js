// Page de jeu : choisir sa ROM (ou celle préparée dans l'atelier), sa sauvegarde et sa room, puis jouer.
// Le jeu tourne dans le navigateur (EmulatorJS) ; PokéLink lit sa mémoire pour afficher les amis dans le monde.
import { h } from './core.js';
import { icon } from './icons.js';
import { mountInfoTab } from './info-tab.js';
import { P2PRoom } from './p2p.js';
import { loadRom, saveRom } from './store.js';
import { detectRom, sizeLabel } from './atelier/games.js';
import { EmuHost, appFrame } from './emu/host.js';
import { settings } from './settings.js';
import { PlatinumGame } from './emu/platinum.js';
import { NdsRom, loadAssets } from './rom.js';
import { ICON_PALETTES } from './data/icon-palettes.js';
import { loadGameData, decodeString } from './gamedata.js';
import { decodeParty } from './pk4.js';
import { PokeLinkApp } from './app.js';
import { bossLevels } from './rules.js';

/** Jeux dont la mémoire est vérifiée : amis visibles dans le monde, échanges, combats, couleurs. */
const LIVE = { CPUF: 'Platine FR' };
const DS = new Set(['A', 'B', 'X', 'Y', 'L', 'R', 'START', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT']);

const params = new URLSearchParams(location.search);
const S = {
  rom: null, save: null, saveMode: 'auto', lastSave: null,
  name: localStorage.getItem('pokelink.name') || '', room: (params.get('room') || '').toUpperCase(), roomMode: params.get('room') ? 'join' : 'create',
};
const setup = document.getElementById('setup');

// ------------------------------------------------------------------------------------------ préparation
async function init() {
  if (params.get('rom') === 'current') {
    const r = await loadRom('current').catch(() => null);
    if (r) await useRom(new Uint8Array(r.bytes), r.name, 'atelier', r.fingerprint);
  }
  render();
}

async function useRom(bytes, name, source, fingerprint) {
  const info = detectRom(bytes.subarray(0, 0x200), name);
  if (!info) { alertBox('Ce fichier n’est pas une ROM Pokémon reconnue.'); return; }
  S.rom = { bytes, name, info, source, key: `${info.code}-${fingerprint || bytes.length}` };
  S.lastSave = await loadRom('save:' + S.rom.key).catch(() => null);
  S.saveMode = S.lastSave ? 'auto' : 'new';
  render();
}

function render() {
  const r = S.rom;
  const live = r && LIVE[r.info.code];
  const fileInput = (accept, fn) => h('input', { type: 'file', accept, hidden: true, onchange: e => e.target.files[0] && fn(e.target.files[0]) });
  const romCard = h('section.at-card.glass', {},
    h('h2.at-h', {}, h('span', { html: icon('gamepad-2', 16) }), 'Le jeu'),
    r ? h('div.at-game', {},
      h('div.at-cart', { 'data-p': r.info.platform }, h('span', {}, r.info.platform.toUpperCase())),
      h('div.at-game-txt', {}, h('b', {}, r.info.name), h('small', {}, [`Gen ${r.info.gen}`, r.info.lang, sizeLabel(r.bytes.length), r.source === 'atelier' ? 'préparée dans l’atelier' : null].filter(Boolean).join(' · '))),
      h('label.at-icon-btn', { title: 'Changer de ROM' }, fileInput('.nds,.gba,.gb,.gbc', pickRom), h('span', { html: icon('rotate-ccw', 16) })))
      : h('label.at-drop', {}, fileInput('.nds,.gba,.gb,.gbc', pickRom), h('span.at-drop-ic', { html: icon('upload', 22) }), h('b', {}, 'Choisir ma ROM'), h('small', {}, 'Elle reste sur cet ordinateur')),
    r ? h('p.at-note', {}, h('a', { href: 'atelier.html' + (S.room ? `?room=${S.room}` : ''), style: { color: '#c4b5fd' } }, 'La randomiser dans l’atelier avant de jouer')) : null,
  );
  const saveCard = h('section.at-card.glass', {},
    h('h2.at-h', {}, h('span', { html: icon('scroll-text', 16) }), 'Sauvegarde'),
    h('div.pl-choice', {},
      S.lastSave ? radio('auto', 'rotate-ccw', 'Reprendre ma partie', `Gardée dans ce navigateur · ${new Date(S.lastSave.at).toLocaleString('fr-FR')}`) : null,
      radio('file', 'file-up', S.save ? S.save.name : 'Charger un fichier .sav', S.save ? sizeLabel(S.save.bytes.length) : 'Sauvegarde d’un émulateur ou d’une cartouche', fileInput('.sav,.dsv,.srm', pickSave)),
      radio('new', 'sparkles', 'Nouvelle partie', 'Commencer l’aventure depuis le début'),
    ),
  );
  const roomCard = h('section.at-card.glass.wide', {},
    h('h2.at-h', {}, h('span', { html: icon('users', 16) }), 'Ta room'),
    h('div.pl-fieldrow', {},
      h('input.at-input', { value: S.name, placeholder: 'Ton pseudo', maxlength: 12, 'aria-label': 'Pseudo', oninput: e => { S.name = e.target.value.trim(); localStorage.setItem('pokelink.name', S.name); } }),
      h('input.at-input.mono', { value: S.room, placeholder: 'Code de room (vide = en créer une)', maxlength: 8, 'aria-label': 'Code de room',
        oninput: e => { S.room = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); S.roomMode = S.room ? 'join' : 'create'; } }),
    ),
    h('p.at-note', {}, 'Laisse le code vide pour créer une room, puis donne le code à tes amis.'),
  );
  const support = !r ? null : live
    ? h('span.pl-support.ok', { html: icon('check', 14) + ' Amis visibles dans le monde, échanges et combats' })
    : h('span.pl-support.part', { html: icon('info', 14) + ' Jouable avec ta room ; amis dans le monde bientôt pour ce jeu' });
  setup.replaceChildren(h('div.pl-setup', {},
    h('header.at-head', {}, h('a.at-brand', { href: 'index.html' }, h('span.at-logo', { html: icon('link-2', 18) }), h('b', {}, 'PokéLink'), h('span', {}, 'Jouer'))),
    h('div.pl-hero', {}, h('h1', {}, 'Prêt à jouer ?'), h('p', {}, 'Ta ROM et ta sauvegarde ne quittent pas cet ordinateur. Seule ta position est partagée avec ta room.')),
    h('div.pl-setup-grid', {}, romCard, saveCard, roomCard),
    h('div.pl-start', {}, support || h('span'), h('button.at-btn.primary', { disabled: !r, onclick: start }, h('span', { html: icon('play', 18) }), 'Lancer la partie')),
  ));
  mountInfoTab(setup.querySelector('.at-head'));
}
function radio(id, ic, title, sub, input) {
  const on = S.saveMode === id;
  const el = h(input ? 'label.pl-radio' : 'button.pl-radio', { role: 'radio', 'aria-checked': String(on), onclick: () => { if (!input) { S.saveMode = id; render(); } } },
    h('span', { html: icon(ic, 18) }), h('div', {}, h('b', {}, title), h('small', {}, sub)), input || null);
  return el;
}
async function pickRom(file) { await useRom(new Uint8Array(await file.arrayBuffer()), file.name, 'file'); }
async function pickSave(file) { S.save = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }; S.saveMode = 'file'; render(); }

function alertBox(text) {
  document.querySelector('.at-toast')?.remove();
  const t = h('div.at-toast.glass', {}, h('span', { html: icon('circle-alert', 16) }), text);
  document.body.append(t); setTimeout(() => t.remove(), 5000);
}
function loading(title, sub) {
  let el = document.querySelector('.pl-loading');
  if (!title) { el?.remove(); return; }
  if (!el) { el = h('div.pl-loading'); document.body.append(el); }
  el.replaceChildren(h('div.at-card.glass', {}, h('span.at-spin'), h('b', {}, title), h('small', {}, sub || '')));
}

// ------------------------------------------------------------------------------------------ partie
async function start() {
  const r = S.rom;
  const save = S.saveMode === 'auto' ? S.lastSave?.bytes : S.saveMode === 'file' ? S.save?.bytes : null;
  try {
    loading('Connexion à la room…');
    const net = new P2PRoom();
    const joined = await net.connect('', S.roomMode, S.room);
    const keep = new URLSearchParams(location.search); keep.set('room', joined.code);
    history.replaceState(null, '', 'play.html?' + keep);

    loading('Démarrage du jeu…', 'Le premier lancement télécharge l’émulateur (quelques secondes).');
    const host = new EmuHost({ mount: '#emu', platform: r.info.platform, ownInput: !!LIVE[r.info.code] });
    host.volume = settings.effectiveVolume;
    host.options = { frameskip: settings.state.eco ? 1 : 0 };
    await host.start(r.bytes, `${r.info.name}.${r.info.platform}`, save ? new Uint8Array(save) : null);
    loading();
    host.setVolume(settings.effectiveVolume);
    setup.hidden = true;
    S.checkSave = autoBackup(host, r.key);
    if (LIVE[r.info.code]) startLive(host, net, joined, save);
    else startSimple(host, net, joined);
  } catch (e) { loading(); alertBox(e.message || String(e)); }
}

/** Bouton « Sauvegarder » : le jeu écrit son fichier, gardé dans le navigateur, et le .sav est téléchargé. */
async function saveGame(host, quit, trainer = S.name) {
  const sav = host.exportSave();
  if (!sav || !sav.length) throw new Error('Le jeu n’a pas encore de sauvegarde (sauvegarde une fois dans le menu du jeu).');
  await saveRom('save:' + S.rom.key, { bytes: sav, at: Date.now() });
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const who = String(trainer || 'partie').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'partie';
  const name = `PokeLink-${S.rom.info.name.replace(/[^a-zA-Z0-9]+/g, '')}-${who}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}.sav`;
  const url = URL.createObjectURL(new Blob([sav], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  if (quit) { S.leaving = true; setTimeout(() => { location.href = 'index.html'; }, 900); }
  return { name };
}

/** Sauvegarde gardée dans le navigateur toutes les 30 s (et en quittant la page). */
function autoBackup(host, key) {
  let last = null;
  // empreinte de TOUT le fichier : le jeu écrit tantôt dans la 1re copie, tantôt dans la 2de (0x40000)
  const sigOf = s0 => { const s = s0.byteOffset & 3 ? s0.slice() : s0; const w = new Uint32Array(s.buffer, s.byteOffset, s.byteLength >> 2); let h = 0x811c9dc5 ^ s.length; for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 16777619); return h >>> 0; };
  const keep = () => {
    const s = host.exportSave();
    if (!s || !s.length) return;
    const sig = sigOf(s);
    if (sig === last) return;
    if (last !== null) S.gameSavedAt = Date.now();      // le joueur vient de sauvegarder dans le jeu
    last = sig;
    saveRom('save:' + key, { bytes: s, at: Date.now() }).catch(() => {});
  };
  setTimeout(keep, 4000);
  setInterval(keep, 8000);
  window.addEventListener('pagehide', keep);
  return keep;
}

/** Jeu dont la mémoire est connue : toute l'interface PokéLink (amis dans le monde, échanges, combats…). */
function startLive(host, net, joined, save) {
  const rom = new NdsRom(S.rom.bytes);
  const assets = loadAssets(rom, ICON_PALETTES), gd = loadGameData(rom);
  const game = new PlatinumGame(host, S.rom.bytes);
  // nom et personnage : depuis la sauvegarde (Dresseur en +0x68, sexe en +0x80), sinon le pseudo
  let trainer = S.name || 'Moi', base = 'lucas', team = [];
  if (save && save.length >= 0x80000) {
    // deux copies de la sauvegarde (0 et 0x40000) : on lit la plus récente (compteur du pied de bloc, +0xCF1C)
    const all = new Uint8Array(save), dv = new DataView(all.buffer, all.byteOffset);
    const valid = b => dv.getUint32(b + 0xcf20, true) === 0xcf2c;
    const pick = valid(0x40000) && (!valid(0) || dv.getUint32(0x40000 + 0xcf1c, true) > dv.getUint32(0xcf1c, true)) ? 0x40000 : 0;
    const sv = all.subarray(pick, pick + 0xcf2c);
    trainer = S.name || decodeString(sv, 0x68, 8) || trainer;
    base = sv[0x80] === 1 ? 'aurore' : 'lucas';
    team = decodeParty(sv.subarray(0x9c, 0x9c + 4 + 6 * 236), gd);
  }
  game.playerBase = base;
  const wrap = document.getElementById('stage-wrap'), root = document.getElementById('root');
  wrap.hidden = false;
  const app = new PokeLinkApp({ root, assets, gd, game, host, net, room: joined.code, team, bosses: bossLevels(rom),
    profile: { name: trainer, base, colors: JSON.parse(localStorage.getItem('pokelink.colors') || '{}'), buddy: team[0]?.species || 392 } });
  window.PL = { app, host, game };
  app.onSave = quit => saveGame(host, quit, trainer);
  app.onQuit = () => { S.leaving = true; location.href = 'index.html'; };
  app.savedAt = () => S.gameSavedAt || null;
  app.checkSave = () => S.checkSave?.();
  // quitter par erreur (fermer l'onglet, recharger) : le navigateur demande confirmation
  addEventListener('beforeunload', e => { if (!S.leaving) { e.preventDefault(); e.returnValue = ''; } });
  const fit = () => { const k = Math.min(innerWidth / 1280, innerHeight / 720); root.style.transform = `scale(${k})`; };
  fit(); addEventListener('resize', fit);
  forwardTouch(game.bottomCanvas, host);

  let lastTeam = '';
  const loop = now => {
    game.blit();
    game.tick();
    app.update(now);
    host.setKeys([...app.input.frameKeys()].filter(k => DS.has(k)));
    // l'équipe du jeu change (capture, évolution…) : la room est prévenue
    if (app.frame % 60 === 0) {
      const raw = game.readPartyRaw();
      const sig = raw ? raw.subarray(0, 4 + 6 * 8).join(',') : '';
      if (raw && sig !== lastTeam) { lastTeam = sig; app.refreshTeam?.(); }
    }
    appFrame(loop);
  };
  appFrame(loop);
}

/** Écran tactile : la souris (ou le doigt) sur l'écran du bas de PokéLink sert de stylet pour l'émulateur.
 *  Un appui est tenu au moins 6 images : un clic très rapide serait sinon invisible pour le jeu. */
function forwardTouch(canvas, host) {
  let down = false, t0 = 0, upTimer = 0;
  const send = (type, e) => {
    const r = canvas.getBoundingClientRect(), c = host.canvas, cr = c.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const ev = { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: cr.left + x * cr.width, clientY: cr.top + (0.5 + y / 2) * cr.height };
    c.dispatchEvent(new MouseEvent(type, ev));
  };
  canvas.style.cursor = 'pointer';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault(); clearTimeout(upTimer);
    canvas.setPointerCapture?.(e.pointerId);
    down = true; t0 = performance.now(); send('mousemove', e); send('mousedown', e);
  });
  canvas.addEventListener('pointermove', e => { if (down) send('mousemove', e); });
  const up = e => {
    if (!down) return; down = false;
    const wait = Math.max(0, 100 - (performance.now() - t0)), p = { clientX: e.clientX, clientY: e.clientY };
    upTimer = setTimeout(() => send('mouseup', p), wait);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

/** Autres jeux : l'écran du jeu dans le cadre PokéLink, avec la room. */
function startSimple(host, net, joined) {
  const emu = document.getElementById('emu');
  Object.assign(emu.style, { opacity: 1, pointerEvents: 'auto', zIndex: 1, position: 'fixed', inset: '72px 24px 24px', width: 'auto', height: 'auto' });
  const players = new Map();
  const bar = h('div.at-bar.glass', { style: { top: '12px', bottom: 'auto' } });
  const draw = () => bar.replaceChildren(h('div.at-bar-txt', {}, h('b', {}, `${S.rom.info.name} · room ${joined.code}`), h('small', {}, [S.name || 'Moi', ...players.values()].join(' · '))));
  net.on('hello', m => { players.set(m.from, m.profile?.name || 'Ami'); draw(); });
  net.on('leave', m => { players.delete(m.from); draw(); });
  net.send('hello', { profile: { name: S.name || 'Moi' }, team: [] });
  document.body.append(bar); draw();
  host.ejs.elements?.parent?.focus?.();
}

init();
