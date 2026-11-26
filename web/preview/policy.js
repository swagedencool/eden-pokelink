// Joueur automatique de démonstration (utilisé par la preview et par la simulation hors ligne) :
// attaque la plus forte (puissance × STAB × efficacité), changement forcé vers le premier Pokémon valide.
// Table des types de la 4G (ordre du jeu : Normal, Combat, Vol, Poison, Sol, Roche, Insecte, Spectre, Acier, ???, Feu, Eau, Plante, Électrik, Psy, Glace, Dragon, Ténèbres).
const T = 18, E = Array.from({ length: T }, () => Array(T).fill(1));
const set = (a, list, v) => list.forEach(d => (E[a][d] = v));
set(0, [5, 8], 0.5); set(0, [7], 0);
set(1, [0, 5, 8, 15, 17], 2); set(1, [2, 3, 6, 14], 0.5); set(1, [7], 0);
set(2, [1, 6, 12], 2); set(2, [5, 8, 13], 0.5);
set(3, [12], 2); set(3, [3, 4, 5, 7], 0.5); set(3, [8], 0);
set(4, [3, 5, 8, 10, 13], 2); set(4, [6, 12], 0.5); set(4, [2], 0);
set(5, [2, 6, 10, 15], 2); set(5, [1, 4, 8], 0.5);
set(6, [12, 14, 17], 2); set(6, [1, 2, 3, 7, 8, 10], 0.5);
set(7, [7, 14], 2); set(7, [8, 17], 0.5); set(7, [0], 0);
set(8, [5, 15], 2); set(8, [8, 10, 11, 13], 0.5);
set(10, [6, 8, 12, 15], 2); set(10, [5, 10, 11, 16], 0.5);
set(11, [4, 5, 10], 2); set(11, [11, 12, 16], 0.5);
set(12, [4, 5, 11], 2); set(12, [2, 3, 6, 8, 10, 12, 16], 0.5);
set(13, [2, 11], 2); set(13, [12, 13, 16], 0.5); set(13, [4], 0);
set(14, [1, 3], 2); set(14, [8, 14], 0.5); set(14, [17], 0);
set(15, [2, 4, 12, 16], 2); set(15, [8, 10, 11, 15], 0.5);
set(16, [16], 2); set(16, [8], 0.5);
set(17, [7, 14], 2); set(17, [1, 8, 17], 0.5);
export const effectiveness = (atk, defTypes) => [...new Set(defTypes)].reduce((k, d) => k * E[atk][d], 1);

/** request : requête Showdown · names : dictionnaire du serveur · gd : données de la ROM · foe : numéro d'espèce adverse */
export function chooseFor(request, names, gd, foe) {
  if (request.wait) return null;
  if (request.forceSwitch) { const i = request.side.pokemon.findIndex(p => !p.active && !p.condition.endsWith('fnt')); return 'switch ' + (i + 1); }
  const me = request.side.pokemon.find(p => p.active);
  const mine = gd.species(names.species[me.details.split(', ')[0]] || 1).types, foeTypes = gd.species(foe || 1).types;
  let best = -1, bestScore = -1;
  request.active[0].moves.forEach((m, i) => {
    if (m.disabled || m.pp === 0) return;
    const n = names.moves[m.move], mv = n ? gd.move(n) : null;
    const score = !mv || mv.category === 2 || !mv.power ? 1 : mv.power * (mine.includes(mv.type) ? 1.5 : 1) * effectiveness(mv.type, foeTypes);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return 'move ' + (best + 1);
}
