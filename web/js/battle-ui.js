// Combat entre joueurs : rendu « glass » au-dessus du jeu, piloté par le flux du simulateur (serveur).
// Sprites de combat, noms, attaques et types viennent de la ROM du joueur.
import { h, ease, setTO, clamp } from './core.js';
import { icon } from './icons.js';
import { TYPE_COLORS } from './gamedata.js';
import { Panel, keycap, tap } from './ui.js';

const STAT = { atk: "L'Attaque", def: 'La Défense', spa: "L'Attaque Spé.", spd: 'La Défense Spé.', spe: 'La Vitesse', accuracy: 'La Précision', evasion: "L'Esquive" };
const STATUS = { par: ['PAR', '#e6c229', 'est paralysé ! Il aura du mal à attaquer.'], brn: ['BRÛ', '#f08030', 'est brûlé !'], psn: ['PSN', '#a040a0', 'est empoisonné !'], tox: ['PSN', '#a040a0', 'est gravement empoisonné !'], slp: ['SOM', '#8a8aa8', "s'est endormi !"], frz: ['GEL', '#98d8d8', 'est gelé !'] };
const WEATHER = { RainDance: 'Il commence à pleuvoir !', SunnyDay: 'Le soleil brille !', Sandstorm: 'Une tempête de sable se lève !', Hail: 'Il commence à grêler !', none: 'Le temps redevient normal.' };
const POS = { foe: { cx: 548, cy: 232, scale: 2, plat: [264, 64] }, ally: { cx: 204, cy: 410, scale: 3, plat: [330, 76] },
  // combat en duo : deux Pokémon de chaque côté
  foe0: { cx: 470, cy: 222, scale: 1.7, plat: [190, 50] }, foe1: { cx: 630, cy: 206, scale: 1.7, plat: [190, 50] },
  ally0: { cx: 128, cy: 414, scale: 2, plat: [210, 54] }, ally1: { cx: 318, cy: 398, scale: 2, plat: [210, 54] } };
const isAlly = k => k.startsWith('ally');
const NEEDS_TARGET = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

function spriteCanvas(spr) {
  const c = document.createElement('canvas'); c.width = 80; c.height = 80;
  const ctx = c.getContext('2d'), img = ctx.createImageData(80, 80);
  let x0 = 80, x1 = 0, y1 = 0;
  spr.frames[0].forEach((v, i) => {
    if (!v) return;
    const [r, g, b] = spr.palette[v], x = i % 80, y = (i / 80) | 0;
    img.data.set([r, g, b, 255], i * 4); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  ctx.putImageData(img, 0, 0);
  c.feet = { cx: (x0 + x1 + 1) / 2, bottom: y1 + 1 };
  return c;
}

export class BattleView extends Panel {
  constructor(ui, { gd, side, names, me, peer, myTeam, onChoice, doubles = false }) {
    const el = h('div.pl-battle' + (doubles ? '.doubles' : ''));
    super(ui, el);
    Object.assign(this, { gd, side, names, me, peer, myTeam, onChoice, doubles, queue: [], busy: false, req: null, turn: 0, ended: null });
    this.foeSide = side === 'p1' ? 'p2' : 'p1';
    this.state = { [side]: { active: [], team: {} }, [this.foeSide]: { active: [], team: {} } };
    this.slots = doubles ? [0, 1] : [0];
    this.kinfo = {};
    for (const who of ['foe', 'ally']) for (const slot of this.slots) this.kinfo[who + (doubles ? slot : '')] = { side: who === 'ally' ? side : this.foeSide, slot };
    this.keys = Object.keys(this.kinfo);
    this.bg = h('div.pl-battle-bg');
    this.plat = {}; this.spr = {}; this.info = {};
    for (const k of this.keys) { this.plat[k] = h('div.plat.' + k); this.spr[k] = h('div.bmon.' + k); this.info[k] = this.infoCard(k); }
    this.turnChip = h('div.pl-chip.turn', {}, 'Tour 1');
    this.prompt = h('div.bprompt.glass');
    this.panel = h('div.bpanel.glass');
    this.msg = h('div.bmsg');
    el.append(this.bg, ...this.keys.map(k => this.plat[k]), ...this.keys.map(k => this.spr[k]), ...this.keys.map(k => this.info[k].el), this.turnChip, this.prompt, this.panel);
    for (const k of this.keys) {
      const [w, hh] = POS[k].plat;
      Object.assign(this.plat[k].style, { width: w + 'px', height: hh + 'px', left: POS[k].cx - w / 2 + 'px', top: POS[k].cy - hh / 2 + 'px' });
    }
    this.mode('msg', '');
    this.prompt.style.opacity = 0;
  }

  infoCard(k) {
    const name = h('span.nm'), lvl = h('span.lv'), st = h('span.st'), fill = h('i'), num = h('div.num');
    const balls = h('div.balls');
    const el = h('div.binfo.glass.' + k, {}, h('div.row', {}, name, st, lvl), h('div.hpbar', {}, h('b', {}, 'PV'), h('div.track', {}, fill)), isAlly(k) ? num : null, balls);
    el.style.opacity = 0;
    return { el, name, lvl, st, fill, num, balls, shown: 0 };
  }
  sideKey(s, slot = 0) { return (s === this.side ? 'ally' : 'foe') + (this.doubles ? slot : ''); }
  parseIdent(id) { const [pos, nm] = id.split(': '); return { side: pos.slice(0, 2), slot: pos[2] === 'b' ? 1 : 0, name: nm }; }
  speciesOf(details) {
    const [sp, ...rest] = details.split(', ');
    const lv = rest.find(x => /^L\d+/.test(x)); const g = rest.find(x => x === 'M' || x === 'F');
    return { num: this.names.species[sp.replace(/-.*$/, '')] || 0, level: lv ? +lv.slice(1) : 100, gender: g || '' };
  }
  moveName(en) { const n = this.names.moves[en]; return n ? this.gd.move(n).name : en; }
  itemName(en) { const n = this.names.items[en]; return n ? this.gd.text.items[n] : en; }
  /** Nom affiché : le surnom, ou le nom français de l'espèce quand le Pokémon n'a pas de surnom. */
  disp(side, name) { return this.state[side]?.team[name]?.disp || name; }
  label(side, name) { const n = this.disp(side, name); return side === this.side ? n : `${n} de ${this.peer.name}`; }

  // ------------------------------------------------------------------ flux
  log(lines) { for (const l of lines) this.queue.push(l); this.pump(); }
  request(req) { this.req = req; this.pump(); }
  end(info) { this.ended = info; this.pump(); }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) await this.step(this.queue.shift());
    this.busy = false;
    if (this.ended) return this.finish();
    if (this.req) this.showRequest();
  }
  say(text, ms = 1150) { this.mode('msg', text); return this.ui.anim.wait(ms); }

  async step(line) {
    const p = line.split('|'); const kind = p[1];
    const A = this.ui.anim;
    if (kind === 'switch' || kind === 'drag') {
      const { side, slot, name } = this.parseIdent(p[2]), sp = this.speciesOf(p[3]), [hp, max] = p[4].split(' ')[0].split('/').map(Number);
      const k = this.sideKey(side, slot), st = this.state[side], cur = st.active[slot];
      if (cur && this.spr[k].firstChild) {
        await this.say(side === this.side ? `${cur.disp || cur.name}, reviens !` : `${this.peer.name} rappelle ${cur.disp || cur.name} !`, 700);
        await this.animOut(k);
      }
      const en = p[3].split(', ')[0], fr = this.gd.text.species[sp.num];
      const disp = fr && name.toUpperCase() === en.toUpperCase() ? fr.charAt(0) + fr.slice(1).toLowerCase() : name;
      st.active[slot] = st.team[name] ? Object.assign(st.team[name], { hp, max }) : { name, disp, ...sp, hp, max, status: '' };
      st.team[name] = st.active[slot];
      this.mode('msg', side === this.side ? `En avant, ${st.active[slot].disp} !` : `${this.peer.name} envoie ${st.active[slot].disp} !`);
      await this.animIn(k, st.active[slot]);
      this.refreshInfo(k);
      return A.wait(500);
    }
    if (kind === 'move') {
      const { side, slot, name } = this.parseIdent(p[2]); const k = this.sideKey(side, slot);
      this.lunge(k);
      return this.say(`${this.label(side, name)} utilise ${this.moveName(p[3])} !`, 950);
    }
    if (kind === '-damage' || kind === '-heal') {
      const { side, slot, name } = this.parseIdent(p[2]); const k = this.sideKey(side, slot), st = this.state[side].team[name];
      if (!st) return null;
      const [hp, max] = p[3].split(' ')[0].split('/').map(Number);
      const from = p.find(x => x?.startsWith('[from]'));
      if (kind === '-damage' && !from) this.hit(k);
      await this.tweenHP(k, st, hp, max || st.max);
      if (from) {
        const src = from.slice(7).trim();
        if (src.startsWith('item:')) return this.say(kind === '-heal' ? `${this.label(side, name)} récupère des PV grâce aux ${this.itemName(src.slice(6).trim())}.` : `${this.label(side, name)} est blessé par ${this.itemName(src.slice(6).trim())} !`);
        if (src === 'psn' || src === 'tox') return this.say(`${this.label(side, name)} souffre du poison !`);
        if (src === 'brn') return this.say(`${this.label(side, name)} souffre de sa brûlure !`);
        if (src === 'Sandstorm' || src === 'Hail') return this.say(`${this.label(side, name)} subit ${src === 'Hail' ? 'la grêle' : 'la tempête de sable'} !`);
        if (src === 'Recoil' || src.includes('recoil')) return this.say(`${this.label(side, name)} subit le contrecoup !`);
      }
      return A.wait(200);
    }
    if (kind === '-supereffective') return this.say("C'est super efficace !", 1000);
    if (kind === '-resisted') return this.say("Ce n'est pas très efficace…", 1000);
    if (kind === '-crit') return this.say('Coup critique !', 900);
    if (kind === '-immune') { const { side, name } = this.parseIdent(p[2]); return this.say(`Ça n'affecte pas ${this.label(side, name)}…`); }
    if (kind === '-miss') { const t = p[3] ? this.parseIdent(p[3]) : null; return this.say(t ? `${this.label(t.side, t.name)} évite l'attaque !` : "L'attaque échoue !"); }
    if (kind === '-fail') return this.say('Mais cela échoue !');
    if (kind === 'faint') {
      const { side, slot, name } = this.parseIdent(p[2]); const k = this.sideKey(side, slot), st = this.state[side].team[name];
      if (!st) return null;
      if (st.hp > 0) await this.tweenHP(k, st, 0, st.max);   // Explosion, Souvenir… : la jauge se vide avant le K.O.
      st.fainted = true;
      await this.animFaint(k);
      this.refreshInfo(k);
      return this.say(`${this.label(side, name)} est K.O. !`, 1100);
    }
    if (kind === '-status') {
      const { side, slot, name } = this.parseIdent(p[2]); const k = this.sideKey(side, slot), s = STATUS[p[3]];
      if (!this.state[side].team[name]) return null;
      this.state[side].team[name].status = p[3]; this.refreshInfo(k);
      return s ? this.say(`${this.label(side, name)} ${s[2]}`) : null;
    }
    if (kind === '-curestatus') { const { side, slot, name } = this.parseIdent(p[2]); const m = this.state[side].team[name]; if (m) { m.status = ''; this.refreshInfo(this.sideKey(side, slot)); } return null; }
    if (kind === '-boost' || kind === '-unboost') {
      const { side, name } = this.parseIdent(p[2]); const n = +p[4];
      return this.say(`${STAT[p[3]] || 'Une stat'} de ${this.label(side, name)} ${kind === '-boost' ? (n > 1 ? 'augmente beaucoup' : 'augmente') : (n > 1 ? 'baisse beaucoup' : 'baisse')} !`, 1000);
    }
    if (kind === '-weather' && !p.includes('[upkeep]')) return WEATHER[p[2]] ? this.say(WEATHER[p[2]]) : null;
    if (kind === 'cant') {
      const { side, name } = this.parseIdent(p[2]);
      const why = { par: 'est paralysé ! Il ne peut pas attaquer !', slp: 'dort profondément.', frz: 'est gelé !', recharge: 'doit récupérer.', flinch: 'a la trouille ! Il ne peut pas attaquer !' }[p[3]];
      return why ? this.say(`${this.label(side, name)} ${why}`) : null;
    }
    if (kind === 'player') { (this.players ||= {})[p[2]] = p[3]; return null; }
    if (kind === 'turn') { this.turn = +p[2]; this.turnChip.textContent = `Tour ${this.turn}`; return null; }
    if (kind === 'win') return this.say(`${p[2]} remporte le combat !`, 1400);
    return null;
  }

  // ------------------------------------------------------------------ animations
  animIn(k, mon) {
    const spr = this.gd.battleSprite(mon.num, isAlly(k) ? 'back' : 'front', { female: mon.gender === 'F' });
    const cv = spriteCanvas(spr), P = POS[k], S = P.scale;
    cv.style.width = cv.style.height = 80 * S + 'px';
    const box = this.spr[k]; box.replaceChildren(cv);
    const x = P.cx - cv.feet.cx * S, y = P.cy - cv.feet.bottom * S + (isAlly(k) ? 10 : 6);
    box.base = { x, y };
    const ball = h('div.bball'); this.el.append(ball);
    return Promise.all([
      this.ui.anim.tween({ from: { k: 0 }, to: { k: 1 }, dur: 260, easing: ease.out, apply: v => setTO(ball, { x: P.cx - 10 + (isAlly(k) ? -60 : 60) * (1 - v.k), y: P.cy - 60 - Math.sin(v.k * Math.PI) * 40, s: 1, o: 1 - Math.max(0, v.k - 0.8) * 5 }), done: () => ball.remove() }).finished,
      this.ui.anim.tween({ from: { s: 0.2, w: 1 }, to: { s: 1, w: 0 }, dur: 340, delay: 220, easing: ease.back, apply: v => { setTO(box, { x, y: y + (1 - v.s) * 40 * S / 2, s: v.s, o: 1 }); box.style.filter = `brightness(${1 + v.w * 4})`; } }).finished,
    ]).then(() => { box.style.filter = ''; this.showInfo(k); });
  }
  animOut(k) {
    const box = this.spr[k], b = box.base;
    return this.ui.anim.tween({ from: { s: 1, w: 0 }, to: { s: 0.2, w: 1 }, dur: 260, apply: v => { setTO(box, { x: b.x, y: b.y + (1 - v.s) * 60, s: v.s, o: 1 - v.w * 0.6 }); box.style.filter = `brightness(${1 + v.w * 4})`; }, done: () => { box.replaceChildren(); box.style.filter = ''; } }).finished;
  }
  animFaint(k) {
    const box = this.spr[k], b = box.base;
    return this.ui.anim.tween({ from: { d: 0 }, to: { d: 1 }, dur: 520, easing: ease.inOut, apply: v => setTO(box, { x: b.x, y: b.y + v.d * 70, s: 1, o: 1 - v.d }), done: () => box.replaceChildren() }).finished;
  }
  lunge(k) {
    const box = this.spr[k], b = box.base; if (!b) return;
    const dx = isAlly(k) ? 26 : -26, dy = isAlly(k) ? -14 : 10;
    this.ui.anim.tween({ from: { t: 0 }, to: { t: 1 }, dur: 300, easing: ease.linear, apply: v => { const q = Math.sin(v.t * Math.PI); setTO(box, { x: b.x + dx * q, y: b.y + dy * q }); } });
  }
  hit(k) {
    const box = this.spr[k], b = box.base; if (!b) return;
    this.ui.anim.tween({ from: { t: 0 }, to: { t: 1 }, dur: 420, delay: 120, easing: ease.linear, apply: v => { const blink = Math.floor(v.t * 6) % 2 && v.t < 1; setTO(box, { x: b.x + Math.sin(v.t * 40) * 4 * (1 - v.t), y: b.y, o: blink ? 0.15 : 1 }); } });
  }
  tweenHP(k, mon, hp, max) {
    const from = mon.hp / mon.max, to = hp / max; mon.hp = hp; mon.max = max;
    return this.ui.anim.tween({ from: { r: from }, to: { r: to }, dur: 650, delay: 180, easing: ease.out, apply: v => this.drawHP(k, v.r, mon) }).finished;
  }
  drawHP(k, r, mon) {
    const c = this.info[k];
    c.fill.style.transform = `scaleX(${clamp(r, 0, 1).toFixed(4)})`;
    c.fill.style.background = r > 0.5 ? 'linear-gradient(90deg,#34d399,#a3e635)' : r > 0.2 ? 'linear-gradient(90deg,#f59e0b,#facc15)' : 'linear-gradient(90deg,#ef4444,#f97316)';
    if (isAlly(k)) c.num.textContent = `${Math.round(r * mon.max)} / ${mon.max}`;
  }
  showInfo(k) { const c = this.info[k]; if (c.shown) return; c.shown = 1; this.ui.anim.tween({ from: { o: 0, x: isAlly(k) ? 20 : -20 }, to: { o: 1, x: 0 }, dur: 260, apply: v => setTO(c.el, v) }); }
  refreshInfo(k) {
    const { side, slot } = this.kinfo[k], st = this.state[side], m = st.active[slot], c = this.info[k];
    if (!m) return;
    c.name.textContent = m.disp || m.name;
    c.lvl.textContent = `Nv. ${m.level}`;
    const s = STATUS[m.status];
    c.st.replaceChildren(...(m.gender ? [h('span.g.' + m.gender, {}, m.gender === 'M' ? '♂' : '♀')] : []), ...(s ? [h('span.sb', { style: { background: s[1] } }, s[0])] : []));
    this.drawHP(k, m.hp / m.max, m);
    // ma propre équipe est connue d'avance ; celle de l'adversaire se découvre au fil du combat
    const balls = side === this.side
      ? this.myTeam.map(t => st.team[t.name.slice(0, 18)]?.fainted ? '.ko' : '.on')
      : Array.from({ length: Math.max(3, Object.keys(st.team).length) }, (_, i) => { const m = Object.values(st.team)[i]; return m ? (m.fainted ? '.ko' : '.on') : ''; });
    c.balls.replaceChildren(...balls.map(b => h('i' + b)));
  }

  // ------------------------------------------------------------------ commandes
  mode(m, text) {
    this.cur = m;
    if (m === 'msg') { this.msg.textContent = text; this.panel.replaceChildren(this.msg); this.prompt.style.opacity = 0; }
  }
  showRequest() {
    const r = this.req; this.req = null;
    if (r.wait) return this.waiting();
    this.lastReq = r;
    // une décision par Pokémon sur le terrain (deux en duo) ; « pass » pour ceux qui n'ont rien à faire
    this.plan = { req: r, choices: [], slot: 0 };
    this.nextSlot();
  }
  nextSlot() {
    const P = this.plan, r = P.req, mons = r.side.pokemon;
    while (P.slot < this.slots.length) {
      const i = P.slot, mon = mons[i];
      if (r.forceSwitch) {
        if (r.forceSwitch[i]) return this.showSwitch(r, true);
      } else if (r.active?.[i] && mon && !mon.condition.endsWith(' fnt') && !r.active[i].commanding) return this.showSlot();
      P.choices[i] = 'pass'; P.slot++;
    }
    const choice = this.doubles ? P.choices.join(', ') : P.choices[0];
    this.plan = null;
    this.onChoice(choice); this.waiting();
  }
  /** Retour en arrière : dans la même décision, ou à celle du Pokémon précédent (duo). */
  back() {
    const P = this.plan; if (!P) return;
    if (this.cur === 'act' && P.slot > 0) {                  // on revient à la décision du Pokémon précédent
      let j = P.slot - 1;
      while (j > 0 && P.choices[j] === 'pass') j--;
      if (P.choices[j] === 'pass') return;                     // rien à corriger avant
      P.slot = j; P.choices.length = j;
      return this.nextSlot();
    }
    this.showSlot();
  }
  showSlot() {
    const r = this.plan.req, i = this.plan.slot, act = r.active[i], mon = this.state[this.side].active[i];
    this.prompt.textContent = `Que doit faire ${mon?.disp || mon?.name || r.side.pokemon[i]?.ident.split(': ')[1]} ?`; this.prompt.style.opacity = 1;
    if (this.doubles && i > 0) this.prompt.append(tap(h('span.bback', {}, h('span', { html: icon('chevron-left', 14) }), 'Retour'), () => this.back()));
    this.buttons = act.moves.map((mv, j) => {
      const n = this.names.moves[mv.move], info = n ? this.gd.move(n) : null, col = TYPE_COLORS[info?.type ?? 0];
      const el = h('div.bmove' + (mv.disabled || mv.pp === 0 ? '.off' : ''), { style: { '--t': col } },
        h('div.mn', {}, info ? info.name : mv.move),
        h('div.mm', {}, h('span.ty', {}, this.gd.text.types[info?.type ?? 0]), h('span.pp', {}, `PP ${mv.pp}/${mv.maxpp}`)));
      return { el, choice: `move ${j + 1}`, target: mv.target, name: info ? info.name : mv.move, off: mv.disabled || mv.pp === 0 };
    });
    while (this.buttons.length < 4) this.buttons.push({ el: h('div.bmove.empty'), off: true });
    const trapped = act.trapped || act.maybeTrapped;
    const sw = { el: h('div.bside' + (trapped ? '.off' : ''), {}, h('span', { html: icon('users', 18) }), 'Pokémon'), choice: 'switch-menu', off: !!act.trapped };
    const ff = { el: h('div.bside.warn', {}, h('span', { html: icon('x', 18) }), 'Abandonner'), choice: 'forfeit' };
    this.grid = [this.buttons[0], this.buttons[1], sw, this.buttons[2], this.buttons[3], ff];
    this.ffArmed = false;
    // sélection initiale : la première attaque utilisable (jamais « Pokémon » ni « Abandonner » par défaut)
    this.sel = [0, 1, 3, 4].find(j => !this.grid[j].off) ?? 2;
    this.panel.replaceChildren(h('div.bacts', {}, h('div.bmoves', {}, this.buttons.map(b => b.el)), h('div.bsides', {}, sw.el, ff.el)));
    this.grid.forEach((b, j) => !b.off && tap(b.el, () => { if (this.cur !== 'act') return; this.sel = j; this.nav('A'); }, () => { if (this.cur === 'act') { this.sel = j; this.refreshSel(); } }));
    this.cur = 'act'; this.refreshSel();
  }
  /** Duo : sur qui lancer l'attaque (adversaires, ou le partenaire pour les attaques qui le permettent). */
  showTarget(b) {
    const i = this.plan.slot, foes = this.state[this.foeSide].active, mine = this.state[this.side].active;
    const opts = [];
    foes.forEach((m, j) => { if (m && !m.fainted) opts.push({ label: m.disp || m.name, sub: 'Adversaire', num: m.num, t: j + 1 }); });
    if (b.target !== 'adjacentFoe') {
      const o = 1 - i, ally = mine[o];
      if (ally && !ally.fainted && b.target !== 'adjacentAllyOrSelf') opts.push({ label: ally.disp || ally.name, sub: 'Ton partenaire', num: ally.num, t: -(o + 1) });
      if (b.target === 'adjacentAllyOrSelf' && mine[i]) opts.push({ label: mine[i].disp || mine[i].name, sub: 'Lui-même', num: mine[i].num, t: -(i + 1) });
      if (b.target === 'adjacentAlly') opts.splice(0, opts.length, ...opts.filter(x => x.t < 0));
    }
    if (opts.length <= 1) return this.choose(opts.length ? `${b.choice} ${opts[0].t}` : b.choice);
    this.prompt.textContent = `${b.name} : quelle cible ?`; this.prompt.style.opacity = 1;
    this.prompt.append(tap(h('span.bback', {}, h('span', { html: icon('chevron-left', 14) }), 'Retour'), () => this.back()));
    this.cards = opts.map(o => ({ el: h('div.bcard.target' + (o.t < 0 ? '.ally' : ''), {}, this.ui.mon(o.num), h('div.n', {}, o.label), h('span.tag', {}, o.sub)), choice: `${b.choice} ${o.t}`, off: false }));
    this.forced = false; this.sel = 0;
    this.panel.replaceChildren(h('div.bcards.targets', {}, this.cards.map(c => c.el)));
    this.cards.forEach((c, j) => tap(c.el, () => { if (this.cur !== 'target') return; this.sel = j; this.nav('A'); }, () => { if (this.cur === 'target') { this.sel = j; this.refreshSel(); } }));
    this.cur = 'target'; this.refreshSel();
  }
  showSwitch(r, forced = false) {
    this.lastReq = r;
    const taken = new Set((this.plan?.choices || []).filter(c => c?.startsWith('switch')).map(c => +c.split(' ')[1] - 1));
    this.prompt.textContent = forced ? 'Choisis le prochain Pokémon' : 'Quel Pokémon envoyer ?'; this.prompt.style.opacity = 1;
    this.cards = r.side.pokemon.map((p, i) => {
      const [hp, rest = ''] = p.condition.split(' '), [c, m] = hp.split('/').map(Number), fnt = rest === 'fnt';
      const sp = this.names.species[p.details.split(', ')[0]] || 0, name = p.ident.split(': ')[1];
      const off = fnt || p.active || taken.has(i);
      const el = h('div.bcard' + (off ? '.off' : ''), {}, this.ui.mon(sp), h('div.n', {}, name),
        h('div.hp', {}, h('i', { style: { width: (fnt ? 0 : Math.round((100 * c) / m)) + '%' } })), p.active ? h('span.tag', {}, 'Au combat') : fnt ? h('span.tag', {}, 'K.O.') : taken.has(i) ? h('span.tag', {}, 'Choisi') : null);
      return { el, choice: `switch ${i + 1}`, off };
    });
    this.forced = forced;
    this.sel = this.cards.findIndex(c => !c.off);
    if (this.sel < 0) { if (this.plan) { this.plan.choices[this.plan.slot] = 'pass'; this.plan.slot++; return this.nextSlot(); } }
    this.panel.replaceChildren(h('div.bcards', {}, this.cards.map(c => c.el)));
    this.cards.forEach((c, i) => !c.off && tap(c.el, () => { if (this.cur !== 'switch') return; this.sel = i; this.nav('A'); }, () => { if (this.cur === 'switch') { this.sel = i; this.refreshSel(); } }));
    if (!forced) this.prompt.append(tap(h('span.bback', {}, h('span', { html: icon('chevron-left', 14) }), 'Retour'), () => this.back()));
    this.cur = 'switch'; this.refreshSel();
  }
  waiting() { this.prompt.style.opacity = 0; this.panel.replaceChildren(h('div.bmsg.wait', {}, h('span.pl-spin'), `En attente de ${this.peer.name}…`)); this.cur = 'wait'; }
  refreshSel() {
    if (this.cur === 'act') this.grid.forEach((b, i) => b.el.classList.toggle('sel', i === this.sel));
    if (this.cur === 'switch' || this.cur === 'target') this.cards.forEach((c, i) => c.el.classList.toggle('sel', i === this.sel));
  }
  nav(k) {
    if (this.cur === 'act') {
      const before = this.sel;
      this.sel = BattleView.step(this.grid, this.sel, k);
      if (this.ffArmed && (this.sel !== before || k === 'B')) { this.ffArmed = false; const f = this.grid[5]; f.el.lastChild.textContent = 'Abandonner'; f.el.classList.remove('armed'); }
      if (k === 'A') {
        const b = this.grid[this.sel];
        if (b.choice === 'switch-menu') return this.showSwitch(this.lastReq), true;
        if (this.doubles && b.choice.startsWith('move') && NEEDS_TARGET.has(b.target)) return this.showTarget(b), true;
        if (b.choice === 'forfeit' && !this.ffArmed) {          // abandon : demande une confirmation
          this.ffArmed = true; b.el.lastChild.textContent = 'Confirmer ?'; b.el.classList.add('armed');
          this.refreshSel(); return true;
        }
        this.choose(b.choice);
        return true;
      }
      if (k === 'B' && this.doubles && this.plan?.slot > 0) return this.back(), true;
      this.refreshSel(); return true;
    }
    if (this.cur === 'switch' || this.cur === 'target') {
      const step = k === 'LEFT' ? -1 : k === 'RIGHT' ? 1 : 0;
      if (step) { let n = this.sel; do n = (n + step + this.cards.length) % this.cards.length; while (this.cards[n].off && n !== this.sel); this.sel = n; }
      if (k === 'A' && !this.cards[this.sel].off) return this.choose(this.cards[this.sel].choice), true;
      if (k === 'B' && !this.forced) return this.back(), true;
      this.refreshSel(); return true;
    }
    return true;
  }
  choose(choice) {
    if (choice === 'forfeit' || !this.plan) { this.plan = null; this.onChoice(choice); return this.waiting(); }
    this.plan.choices[this.plan.slot] = choice; this.plan.slot++;
    this.nextSlot();
  }
  /**
   * Déplacement dans la grille 2 × 3 (attaques | Pokémon / Abandonner) en sautant les cases désactivées :
   * gauche/droite vont à la prochaine case active de la ligne ; haut/bas changent de ligne vers la case
   * active la plus proche de la même colonne.
   */
  static step(grid, sel, k) {
    const row = Math.floor(sel / 3), col = sel % 3, ok = i => grid[i] && !grid[i].off;
    if (k === 'LEFT' || k === 'RIGHT') {
      const d = k === 'LEFT' ? -1 : 1;
      for (let c = col + d; c >= 0 && c <= 2; c += d) if (ok(row * 3 + c)) return row * 3 + c;
      return sel;
    }
    if (k === 'UP' || k === 'DOWN') {
      const r = 1 - row;
      const order = [col, col - 1, col + 1, col - 2, col + 2].filter(c => c >= 0 && c <= 2);
      for (const c of order) if (ok(r * 3 + c)) return r * 3 + c;
      return sel;
    }
    return sel;
  }

  async finish() {
    if (this.done) return; this.done = true;
    const win = this.ended.winner === (this.players?.[this.side] ?? this.me.name);
    this.ended.won = win;
    const card = h('div.bresult.glass', {}, h('div.big', {}, win ? 'Victoire !' : 'Défaite…'),
      h('div.sub', {}, win ? `Tu as battu ${this.peer.name}` : `${this.peer.name} remporte le combat`));
    const scrim = h('div.bscrim');
    this.el.append(scrim, card);
    // l'arène s'efface derrière la carte : rien ne transparaît sous le verre
    const fade = [...this.keys.map(k => this.info[k].el), this.prompt].map(e => [e, +(getComputedStyle(e).opacity || 1)]);
    this.ui.anim.tween({ from: { o: 0 }, to: { o: 1 }, dur: 300, apply: v => { scrim.style.opacity = v.o; fade.forEach(([e, o0]) => (e.style.opacity = o0 * (1 - v.o))); } });
    this.ui.anim.tween({ from: { s: 0.8, o: 0 }, to: { s: 1, o: 1 }, dur: 380, delay: 80, easing: ease.back, apply: v => setTO(card, v) });
    await this.ui.anim.wait(2200);
    this.onEnd?.(this.ended);
    this.close();
  }
  open() {
    this.ui.layer.append(this.el);
    this.ui.anim.tween({ from: { o: 0 }, to: { o: 1 }, dur: 320, apply: v => (this.el.style.opacity = v.o) });
    return this;
  }
  close() {
    this.closed = true; this.ui.drop(this);
    return this.ui.anim.tween({ from: { o: 1 }, to: { o: 0 }, dur: 380, apply: v => (this.el.style.opacity = v.o), done: () => this.el.remove() }).finished;
  }
}
