// Galerie d'audit : chaque composant, dans chaque état, avec les vraies données de la sauvegarde,
// puis des mesures automatiques (débordement des pixels visibles, centrage, symétrie des marges, texte coupé).
import { NdsRom, loadAssets } from '../js/rom.js';
import { ICON_PALETTES } from '../js/data/icon-palettes.js';
import { loadGameData } from '../js/gamedata.js';
import { decodeParty, decodeMon } from '../js/pk4.js';
import { PokeLinkApp } from '../js/app.js';
import { InteractionMenu, RequestCard, TradePanel, VersusCard, ProfilePanel } from '../js/ui.js';
import { BattleView } from '../js/battle-ui.js';

const load = async u => new Uint8Array(await (await fetch(u)).arrayBuffer());
const img = u => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = u; });

export async function boot() {
  const rom = new NdsRom(await load('../_local/pt.nds'));
  const sav = await load('../_local/pt.sav');
  const assets = loadAssets(rom, ICON_PALETTES), gd = loadGameData(rom);
  const party = decodeParty(sav.subarray(0x9c, 0x9c + 4 + 6 * 236), gd);
  const box = (b, s) => decodeMon(sav.subarray(0xcf2c + 4 + ((b - 1) * 30 + s) * 0x88, 0xcf2c + 4 + ((b - 1) * 30 + s + 1) * 0x88), gd);
  const friendTeam = [[4, 3], [5, 28], [12, 19], [16, 8], [16, 1], [13, 15]].map(([b, s]) => box(b, s));
  const top = await img('../_local/top_jubilife.png'), bot = await img('../_local/bot_jubilife.png');
  const mk = () => Object.assign(document.createElement('canvas'), { width: 256, height: 192 });
  const game = { topCanvas: mk(), bottomCanvas: mk(), playerBase: 'lucas', state: () => game._s, patchRom() {} };
  game.topCanvas.getContext('2d').drawImage(top, 0, 0); game.bottomCanvas.getContext('2d').drawImage(bot, 0, 0);
  game._s = { map: 3, x: 174 * 16 + 8, y: 0, z: 758 * 16 + 8, face: 2, tx: 174, tz: 758, fade: 0 };
  const h = new Map();
  const net = { id: 'me', on: (t, f) => (h.get(t) || h.set(t, []).get(t)).push(f), send() {}, deliver: (t, d) => (h.get(t) || []).forEach(f => f({ ...d, from: 'nova' })) };
  const app = new PokeLinkApp({ root: document.getElementById('root'), assets, gd, game, net, room: 'K7Q-2MD', places: { 3: gd.text.places[6] },
    profile: { name: 'Mattia', base: 'lucas', colors: {}, buddy: 392 }, team: party });
  const nova = { name: 'Nova', base: 'aurore', colors: { hat: '#8b5cf6', coat: '#14b8a6', hair: '#f472b6', detail: '#fde047' }, buddy: 393 };
  net.deliver('hello', { profile: nova, team: friendTeam });
  for (let k = 0; k < 4; k++) net.deliver('state', { map: 3, x: 173 * 16 + 8, y: 0, z: 758 * 16 + 8, face: 3, tx: 173, tz: 758 });
  net.deliver('follower', { out: true, species: 393, instant: true });
  let now = 1000;
  const settle = () => { for (let i = 0; i < 40; i++) { now += 100; app.update(now); } };
  settle();
  const peer = app.peers.get('nova');
  const close = () => { for (const p of [...app.ui.stack]) p.close(); settle(); };

  const scenes = {
    world: () => { app.me.follower.spawn(now, app.me.leader); settle(); app.overlay.bubble('nova', 'heart', now - 600); app.update(now); },
    menu: () => { const m = new InteractionMenu(app.ui, peer, { onPick() {}, onEmote() {} }); app.ui.open(m); m.nav('DOWN'); settle(); },
    'menu-emote': () => { const m = new InteractionMenu(app.ui, peer, { onPick() {}, onEmote() {} }); app.ui.open(m); for (const k of ['DOWN', 'DOWN', 'DOWN', 'DOWN', 'A', 'RIGHT']) m.nav(k); settle(); },
    'req-out': () => { app.ui.open(new RequestCard(app.ui, { dir: 'out', kind: 'trade', peer })); settle(); },
    'req-in': () => { app.ui.open(new RequestCard(app.ui, { dir: 'in', kind: 'battle', peer })); settle(); },
    'req-ok': () => { const c = new RequestCard(app.ui, { dir: 'out', kind: 'battle', peer }); app.ui.open(c); c.resolve(true); settle(); },
    toasts: () => {
      app.ui.toasts.show({ profile: nova, title: "Ami s'appelle désormais Nova", sub: 'Nom mis à jour pour toute la room', dur: 99999 });
      app.ui.toasts.show({ species: 471, title: 'Bebe a rejoint ton équipe !', sub: 'Échange terminé avec Nova', dur: 99999 });
      app.ui.toasts.show({ ic: 'users', accent: 'var(--c-duo)', title: 'Duo activé avec Nova', sub: 'Vos combats se jouent à 2 contre 2', dur: 99999 });
      settle();
    },
    'trade-pick': () => { const t = new TradePanel(app.ui, { peer, mine: party.map(m => ({ ...m })), theirs: friendTeam.map(m => ({ ...m })) }); app.ui.open(t); t.nav('RIGHT'); t.remote({ action: 'cursor', slot: 2 }); settle(); },
    'trade-both': () => { const t = new TradePanel(app.ui, { peer, mine: party.map(m => ({ ...m })), theirs: friendTeam.map(m => ({ ...m })) }); app.ui.open(t); t.nav('DOWN'); t.nav('RIGHT'); t.nav('A'); t.remote({ action: 'pick', slot: 1 }); settle(); },
    'trade-wait': () => { const t = new TradePanel(app.ui, { peer, mine: party.map(m => ({ ...m })), theirs: friendTeam.map(m => ({ ...m })) }); app.ui.open(t); t.nav('A'); t.remote({ action: 'pick', slot: 4 }); settle(); t.nav('A'); settle(); },
    vs: () => { const v = new VersusCard(app.ui, { me: app.me.profile, peer: nova, myTeam: party, theirTeam: friendTeam, rules: ['3 contre 3', 'K.O. = perdu (Nuzlocke)', 'Simple'] }); app.ui.open(v); settle(); v.ready('Équipes prêtes · le combat commence'); },
    'profile-lucas': () => { const p = new ProfilePanel(app.ui, { profile: { ...app.me.profile, colors: { hat: '#8b5cf6' } }, team: party, onSave() {} }); app.ui.open(p); p.nav('DOWN'); p.nav('DOWN'); settle(); },
    'profile-aurore': () => { const p = new ProfilePanel(app.ui, { profile: { ...nova }, team: party, onSave() {} }); app.ui.open(p); for (let i = 0; i < 7; i++) p.nav('DOWN'); p.nav('RIGHT'); settle(); },
  };
  const names = { species: { Infernape: 392, Gengar: 94, Luxray: 405, Roserade: 407 }, moves: { 'Flare Blitz': 394, 'Close Combat': 370, 'U-turn': 369, 'Grass Knot': 447, 'Shadow Punch': 325 }, items: { Leftovers: 234 }, abilities: {} };
  const req = (forced) => ({ ...(forced ? { forceSwitch: [true] } : { active: [{ moves: [
      { move: 'Close Combat', pp: 7, maxpp: 8, disabled: false }, { move: 'U-turn', pp: 32, maxpp: 32, disabled: true },
      { move: 'Flare Blitz', pp: 23, maxpp: 24, disabled: false }, { move: 'Grass Knot', pp: 32, maxpp: 32, disabled: false }] }] }),
    side: { name: 'Mattia', id: 'p1', pokemon: [
      { ident: 'p1: Calabrese', details: 'Infernape, M', condition: forced ? '0 fnt' : '203/293', active: true },
      { ident: 'p1: Shin-Chan', details: 'Luxray, F', condition: '364/364', active: false },
      { ident: 'p1: VioletASMR', details: 'Roserade, F', condition: '262/262', active: false }] } });
  const battle = async (forced) => {
    const v = new BattleView(app.ui, { gd, side: 'p1', names, me: app.me.profile, peer: nova, myTeam: party.slice(0, 3), onChoice() {} });
    app.ui.open(v);
    v.log(['|player|p1|Mattia', '|player|p2|Nova', '|switch|p1a: Calabrese|Infernape, M|293/293', '|switch|p2a: ECTOPLASMA|Gengar, L88, M|224/224', '|turn|2',
      '|move|p2a: ECTOPLASMA|Shadow Punch|p1a: Calabrese', '|-damage|p1a: Calabrese|203/293', '|-status|p2a: ECTOPLASMA|brn']);
    for (let i = 0; i < 120; i++) { now += 100; app.update(now); await new Promise(r => setTimeout(r, 0)); }
    v.request(req(forced)); settle();
  };
  scenes.rules = () => {
    const R = app.rules;
    R.state = { soulLink: true, levelCap: true, capMode: 'manual', capValue: 45 };
    R.mine = party.slice(0, 4).map(m => ({ uid: m.uid, species: m.species, name: m.name, loc: m.metLocation, level: m.level }));
    R.peerSoul('nova', { name: 'Nova', mons: friendTeam.slice(0, 3).map((m, i) => ({ uid: 'n' + i, species: m.species, name: m.name, loc: R.mine[i].loc })), dead: ['n1'] });
    R.dead.add(R.mine[1].uid);
    app.onRulesChanged(); app.openRules();
    const p = app.rulesPanel; p.nav('DOWN'); p.nav('DOWN'); settle();
  };
  scenes['battle-act'] = () => battle(false);
  scenes['battle-switch'] = () => battle(true);
  scenes['battle-result'] = async () => {
    const v = new BattleView(app.ui, { gd, side: 'p1', names, me: app.me.profile, peer: nova, myTeam: party.slice(0, 3), onChoice() {}, onEnd() {} });
    app.ui.open(v);
    v.log(['|player|p1|Mattia', '|player|p2|Nova', '|switch|p1a: Shin-Chan|Luxray, F|118/364', '|switch|p2a: Drip|Drifblim, M|441/441', '|turn|4',
      '|move|p2a: Drip|Explosion|p1a: Shin-Chan', '|-damage|p1a: Shin-Chan|118/364', '|faint|p2a: Drip', '|win|Mattia']);
    v.end({ winner: 'Mattia', team: [] });
    v.close = () => {};                                   // on fige l'écran de résultat pour l'audit
    for (let i = 0; i < 160; i++) { now += 100; app.update(now); await new Promise(r => setTimeout(r, 0)); }
    settle();
  };
  window.G = { app, scenes, async run(name) { close(); app.overlay.bubbles.forEach(b => b.el.remove()); app.overlay.bubbles = []; await scenes[name](); return document.querySelectorAll('.pl-layer *').length; }, audit };
  document.title = 'ready';
}

// ------------------------------------------------------------------------------------------ audit
const opaqueCache = new Map();
function opaqueBox(imgEl) {
  if (opaqueCache.has(imgEl.src)) return opaqueCache.get(imgEl.src);
  const c = document.createElement('canvas'); c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(imgEl, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 8) { x0 = Math.min(x0, xx); y0 = Math.min(y0, y); x1 = Math.max(x1, xx); y1 = Math.max(y1, y); }
  const r = x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1, w: c.width, h: c.height };
  opaqueCache.set(imgEl.src, r); return r;
}
const name = el => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName.toLowerCase()) + (el.textContent ? ` «${el.textContent.trim().slice(0, 24)}»` : '');
const visible = el => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return false; let e = el; while (e) { if (parseFloat(getComputedStyle(e).opacity) === 0) return false; e = e.parentElement; } return el.getClientRects().length > 0; };
const BOXES = '.thumb, .cell64, .pl-card, .pl-player, .pl-toast, .pl-item, .pl-menu, .pl-trade, .pl-profile, .pl-request, .team, .pl-btn, .pl-chip, .pl-key, .pl-row, .pl-bottom, .pl-room, .pl-game, .pl-side, .side, .pl-preview';

function audit(scope = document) {
  const issues = [];
  const push = (type, el, detail) => issues.push({ type, el: name(el), detail });
  // 1. pixels visibles des images : dans leur boîte, et pas coupés par elle
  for (const im of scope.querySelectorAll('img')) {
    if (!visible(im) || !im.naturalWidth) continue;
    const ob = opaqueBox(im); if (!ob) continue;
    const r = im.getBoundingClientRect(), sx = r.width / ob.w, sy = r.height / ob.h;
    const vis = { l: r.left + ob.x0 * sx, t: r.top + ob.y0 * sy, r: r.left + ob.x1 * sx, b: r.top + ob.y1 * sy };
    const box = im.parentElement.closest(BOXES);
    if (!box) continue;
    const br = box.getBoundingClientRect();
    const out = Math.max(br.left - vis.l, vis.r - br.right, br.top - vis.t, vis.b - br.bottom);
    if (out > 0.5) push(getComputedStyle(box).overflow === 'hidden' ? 'sprite-coupé' : 'sprite-déborde', im, `${out.toFixed(1)} px hors de ${name(box)}`);
    // centrage des pixels visibles dans les vignettes carrées (sauf portraits, cadrés sur la tête)
    const cbox = im.parentElement.matches('.lead-mon') ? im.parentElement : box;
    if ((cbox.matches('.cell64, .lead-mon') || (cbox.matches('.thumb') && !im.src.includes('#'))) && !cbox.closest('.pl-player .thumb, .pl-menu header, .ring, .pl-toast .thumb, h5')) {
      const cr = cbox.getBoundingClientRect();
      const dx = (vis.l + vis.r) / 2 - (cr.left + cr.right) / 2, dy = (vis.t + vis.b) / 2 - (cr.top + cr.bottom) / 2;
      if (Math.abs(dx) > 1.01 || Math.abs(dy) > 1.01) push('sprite-décentré', im, `dx ${dx.toFixed(1)} dy ${dy.toFixed(1)}`);
    }
  }
  // 2. pictogrammes centrés dans leur boîte
  for (const b of scope.querySelectorAll('.ib, .kc, .logo, .swap, .ico, .pl-check, .e, .pl-bubble, .thumb')) {
    if (!visible(b)) continue;
    const c = b.querySelector(':scope > svg') || (b.matches('.kc') ? b : null);
    if (!c) continue;
    const br = b.getBoundingClientRect();
    let cr = c.getBoundingClientRect();
    if (c === b) { const rg = document.createRange(); rg.selectNodeContents(b); cr = rg.getBoundingClientRect(); }
    const dx = (cr.left + cr.right) / 2 - (br.left + br.right) / 2, dy = (cr.top + cr.bottom) / 2 - (br.top + br.bottom) / 2;
    if (Math.abs(dx) > 0.75 || Math.abs(dy) > 0.75) push('icône-décentrée', b, `dx ${dx.toFixed(2)} dy ${dy.toFixed(2)}`);
  }
  // 3. contenu des boutons / pastilles : marges gauche = droite, haut = bas
  for (const b of scope.querySelectorAll('.pl-btn, .pl-chip, .pl-key, .pl-mini, .pl-seg span, .badge, .pl-hints span')) {
    if (!visible(b)) continue;
    const rg = document.createRange(); rg.selectNodeContents(b);
    const rects = [...rg.getClientRects()].filter(r => r.width > 0);
    if (!rects.length) continue;
    const u = rects.reduce((a, r) => ({ l: Math.min(a.l, r.left), r: Math.max(a.r, r.right), t: Math.min(a.t, r.top), b: Math.max(a.b, r.bottom) }), { l: 1e9, r: -1e9, t: 1e9, b: -1e9 });
    const br = b.getBoundingClientRect();
    const dl = u.l - br.left, dr = br.right - u.r;
    if (b.matches('.pl-btn, .pl-key, .pl-mini, .pl-seg span') && Math.abs(dl - dr) > 1.5) push('marges-inégales', b, `gauche ${dl.toFixed(1)} / droite ${dr.toFixed(1)}`);
    if (u.l < br.left - 0.5 || u.r > br.right + 0.5) push('contenu-déborde', b, `${dl.toFixed(1)} / ${dr.toFixed(1)}`);
  }
  // 4. texte coupé
  for (const el of scope.querySelectorAll('.pl-layer *, .pl-side *, .pl-header *')) {
    if (!visible(el) || el.children.length) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') push('texte-coupé', el, `${el.scrollWidth} > ${el.clientWidth}`);
  }
  // 5. éléments d'interface hors de l'écran de jeu
  const game = document.querySelector('.pl-game').getBoundingClientRect();
  for (const el of scope.querySelectorAll('.pl-layer > *:not(.pl-toasts), .pl-toast')) {
    if (!visible(el) || el.matches('.pl-tag, .pl-bubble, .pl-prompt')) continue;
    const r = el.getBoundingClientRect();
    if (r.left < game.left - 0.5 || r.right > game.right + 0.5 || r.top < game.top - 0.5 || r.bottom > game.bottom + 0.5) push('hors-écran', el, `${Math.round(r.left - game.left)},${Math.round(r.top - game.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // 6. marges intérieures des panneaux : la boîte englobant les enfants est centrée horizontalement
  for (const p of scope.querySelectorAll('.pl-menu, .pl-request, .pl-trade, .pl-toast, .pl-room, .pl-bottom, .pl-form, .pl-player')) {
    if (!visible(p)) continue;
    const kids = [...p.children].filter(visible);
    if (!kids.length) continue;
    const br = p.getBoundingClientRect(), s = getComputedStyle(p);
    const u = kids.map(k => k.getBoundingClientRect()).reduce((a, r) => ({ l: Math.min(a.l, r.left), r: Math.max(a.r, r.right) }), { l: 1e9, r: -1e9 });
    const bl = parseFloat(s.borderLeftWidth), brw = parseFloat(s.borderRightWidth);
    const dl = u.l - br.left - bl, dr = br.right - brw - u.r;
    if (!p.matches('.pl-player, .pl-toast') && Math.abs(dl - dr) > 1) push('panneau-asymétrique', p, `gauche ${dl.toFixed(1)} / droite ${dr.toFixed(1)}`);
  }
  return issues;
}
