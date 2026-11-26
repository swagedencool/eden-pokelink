// Petit onglet « Jeux testés » dans l'en-tête des pages : dit honnêtement ce qui marche aujourd'hui.
import { icon } from './icons.js';

const GAMES = [
  { ok: true, name: 'Pokémon Platine', text: 'Testé et fonctionnel : amis visibles dans le monde, échanges, combats, Pokémon qui suit, Âmes liées, Plafond de niveau, random map et randomizer.' },
  { ok: false, name: 'Les autres jeux (Gen 1 à 5)', text: 'Pas encore testés. Ils se lancent dans l’émulateur et passent dans le randomizer, mais le jeu à plusieurs n’y fonctionne pas encore.' },
];

let listening = false;
function setOpen(wrap, open) {
  wrap.querySelector('.pl-info-panel').hidden = !open;
  wrap.querySelector('button').setAttribute('aria-expanded', String(open));
}

export function mountInfoTab(header) {
  if (!header || header.querySelector('.pl-info')) return;
  const wrap = document.createElement('div');
  wrap.className = 'pl-info';
  wrap.innerHTML = `
    <button class="pl-info-tab" type="button" aria-expanded="false" aria-controls="pl-info-panel">
      <span class="pl-info-dot" aria-hidden="true"></span>Jeux testés<span class="pl-info-chev" aria-hidden="true">${icon('chevron-right', 14)}</span>
    </button>
    <div class="pl-info-panel glass" id="pl-info-panel" role="dialog" aria-label="État des jeux" hidden>
      <b class="pl-info-title">Pour l’instant, seul Pokémon Platine est testé et fonctionnel.</b>
      ${GAMES.map(g => `
        <div class="pl-info-row ${g.ok ? 'ok' : 'wait'}">
          <span class="pl-info-ic">${icon(g.ok ? 'check' : 'hourglass', 14)}</span>
          <div><b>${g.name}</b><p>${g.text}</p></div>
        </div>`).join('')}
      <p class="pl-info-foot">Les autres jeux arrivent petit à petit.</p>
    </div>`;
  const btn = wrap.querySelector('button'), panel = wrap.querySelector('.pl-info-panel');
  btn.onclick = e => { e.stopPropagation(); setOpen(wrap, panel.hidden); };
  panel.onclick = e => e.stopPropagation();
  if (!listening) {
    listening = true;
    const closeAll = () => document.querySelectorAll('.pl-info').forEach(w => setOpen(w, false));
    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
  }
  header.append(wrap);
  return wrap;
}
