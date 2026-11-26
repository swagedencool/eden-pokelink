// Réglages de l'atelier ROM. Les clés sont exactement celles de la classe Settings de
// l'Universal Pokémon Randomizer ZX (setXxx) : le serveur les applique telles quelles.
// gen : générations concernées · cap : possibilité du jeu requise (réponse « info » d'UPR) · if : visible si…

const C = (key, label, options, extra = {}) => ({ type: 'choice', key, label, options, ...extra });
const B = (key, label, extra = {}) => ({ type: 'bool', key, label, ...extra });
const N = (key, label, min, max, step, unit, extra = {}) => ({ type: 'int', key, label, min, max, step, unit, ...extra });
const on = (k, ...vals) => s => (vals.length ? vals.includes(s[k]) : !!s[k]);
const not = (k, v) => s => s[k] !== v;

export const SECTIONS = [
  {
    id: 'pokemon', icon: 'dna', title: 'Pokémon', sub: 'Stats, types, talents, évolutions',
    fields: [
      C('baseStatisticsMod', 'Stats de base', [['UNCHANGED', 'Inchangées'], ['SHUFFLE', 'Mélangées entre elles'], ['RANDOM', 'Aléatoires']]),
      B('baseStatsFollowEvolutions', 'Les évolutions gardent la même répartition', { if: not('baseStatisticsMod', 'UNCHANGED') }),
      C('typesMod', 'Types', [['UNCHANGED', 'Inchangés'], ['RANDOM_FOLLOW_EVOLUTIONS', 'Aléatoires (suivent l’évolution)'], ['COMPLETELY_RANDOM', 'Totalement aléatoires']]),
      B('dualTypeOnly', 'Toujours deux types', { if: not('typesMod', 'UNCHANGED') }),
      C('abilitiesMod', 'Talents', [['UNCHANGED', 'Inchangés'], ['RANDOMIZE', 'Aléatoires']], { gen: [3, 5] }),
      B('abilitiesFollowEvolutions', 'Les évolutions gardent le talent', { if: on('abilitiesMod', 'RANDOMIZE'), gen: [3, 5] }),
      B('allowWonderGuard', 'Autoriser Garde Mystik', { if: on('abilitiesMod', 'RANDOMIZE'), gen: [3, 5] }),
      B('banTrappingAbilities', 'Interdire les talents qui piègent', { if: on('abilitiesMod', 'RANDOMIZE'), gen: [3, 5] }),
      B('banNegativeAbilities', 'Interdire les talents négatifs', { if: on('abilitiesMod', 'RANDOMIZE'), gen: [3, 5] }),
      B('banBadAbilities', 'Interdire les talents inutiles', { if: on('abilitiesMod', 'RANDOMIZE'), gen: [3, 5] }),
      C('evolutionsMod', 'Évolutions', [['UNCHANGED', 'Inchangées'], ['RANDOM', 'Aléatoires'], ['RANDOM_EVERY_LEVEL', 'Une évolution à chaque niveau']]),
      B('evosSimilarStrength', 'Évolue vers un Pokémon de force proche', { if: on('evolutionsMod', 'RANDOM') }),
      B('evosSameTyping', 'Garde un type en commun', { if: on('evolutionsMod', 'RANDOM') }),
      B('evosMaxThreeStages', 'Trois stades au maximum', { if: on('evolutionsMod', 'RANDOM') }),
      B('changeImpossibleEvolutions', 'Évolutions par échange rendues possibles en solo', { hint: 'Recommandé : les évolutions par échange passent par un niveau ou un objet.' }),
      B('makeEvolutionsEasier', 'Évolutions plus faciles (niveaux abaissés)'),
      B('removeTimeBasedEvolutions', 'Plus d’évolutions liées à l’heure', { gen: [2, 5] }),
      B('standardizeEXPCurves', 'Même courbe d’expérience pour tous'),
      C('selectedEXPCurve', 'Courbe utilisée', [['MEDIUM_FAST', 'Moyenne'], ['FAST', 'Rapide'], ['MEDIUM_SLOW', 'Parabolique'], ['SLOW', 'Lente']], { if: on('standardizeEXPCurves') }),
    ],
  },
  {
    id: 'starters', icon: 'sparkles', title: 'Starters', sub: 'Starters, légendaires, échanges',
    fields: [
      C('startersMod', 'Starters', [['UNCHANGED', 'Inchangés'], ['CUSTOM', 'Choisis par moi'], ['COMPLETELY_RANDOM', 'Aléatoires'], ['RANDOM_WITH_TWO_EVOLUTIONS', 'Aléatoires à 3 stades']]),
      { type: 'starters', key: 'customStarters', label: 'Mes trois starters', if: on('startersMod', 'CUSTOM') },
      B('randomizeStartersHeldItems', 'Objet tenu aléatoire', { cap: 'supportsStarterHeldItems' }),
      C('staticPokemonMod', 'Pokémon fixes (légendaires, cadeaux)', [['UNCHANGED', 'Inchangés'], ['RANDOM_MATCHING', 'Légendaire contre légendaire'], ['SIMILAR_STRENGTH', 'Force proche'], ['COMPLETELY_RANDOM', 'Aléatoires']], { cap: 'canChangeStaticPokemon' }),
      B('limitMainGameLegendaries', 'Un seul légendaire par lieu de l’histoire', { if: not('staticPokemonMod', 'UNCHANGED'), cap: 'hasMainGameLegendaries' }),
      B('staticLevelModified', 'Changer leur niveau', { if: not('staticPokemonMod', 'UNCHANGED') }),
      N('staticLevelModifier', 'Niveau des Pokémon fixes', -50, 50, 5, '%', { if: on('staticLevelModified') }),
      C('inGameTradesMod', 'Échanges avec les PNJ', [['UNCHANGED', 'Inchangés'], ['RANDOMIZE_GIVEN', 'Pokémon reçu aléatoire'], ['RANDOMIZE_GIVEN_AND_REQUESTED', 'Reçu et demandé aléatoires']]),
      B('randomizeInGameTradesNicknames', 'Surnoms aléatoires', { if: not('inGameTradesMod', 'UNCHANGED') }),
      B('randomizeInGameTradesItems', 'Objets tenus aléatoires', { if: not('inGameTradesMod', 'UNCHANGED') }),
    ],
  },
  {
    id: 'moves', icon: 'zap', title: 'Attaques', sub: 'Données et capacités apprises',
    fields: [
      B('randomizeMovePowers', 'Puissance aléatoire'),
      B('randomizeMoveAccuracies', 'Précision aléatoire'),
      B('randomizeMovePPs', 'PP aléatoires'),
      B('randomizeMoveTypes', 'Type aléatoire'),
      B('randomizeMoveCategory', 'Catégorie physique/spéciale aléatoire', { cap: 'hasPhysicalSpecialSplit' }),
      C('movesetsMod', 'Attaques apprises', [['UNCHANGED', 'Inchangées'], ['RANDOM_PREFER_SAME_TYPE', 'Aléatoires (même type de préférence)'], ['COMPLETELY_RANDOM', 'Totalement aléatoires'], ['METRONOME_ONLY', 'Métronome uniquement']]),
      B('startWithGuaranteedMoves', 'Commencer avec plusieurs attaques', { if: s => s.movesetsMod === 'RANDOM_PREFER_SAME_TYPE' || s.movesetsMod === 'COMPLETELY_RANDOM', cap: 'supportsFourStartingMoves' }),
      N('guaranteedMoveCount', 'Attaques au départ', 2, 4, 1, '', { if: on('startWithGuaranteedMoves') }),
      B('reorderDamagingMoves', 'Attaques offensives de plus en plus fortes', { if: s => s.movesetsMod === 'RANDOM_PREFER_SAME_TYPE' || s.movesetsMod === 'COMPLETELY_RANDOM' }),
      B('movesetsForceGoodDamaging', 'Assez d’attaques offensives', { if: s => s.movesetsMod === 'RANDOM_PREFER_SAME_TYPE' || s.movesetsMod === 'COMPLETELY_RANDOM' }),
      N('movesetsGoodDamagingPercent', 'Part d’attaques offensives', 0, 100, 10, '%', { if: on('movesetsForceGoodDamaging') }),
    ],
  },
  {
    id: 'trainers', icon: 'swords', title: 'Dresseurs', sub: 'Équipes, niveaux, combats en duo',
    fields: [
      C('trainersMod', 'Équipes des dresseurs', [['UNCHANGED', 'Inchangées'], ['RANDOM', 'Aléatoires'], ['DISTRIBUTED', 'Aléatoires, Pokémon répartis'], ['MAINPLAYTHROUGH', 'Répartis sur l’histoire'], ['TYPE_THEMED', 'Thème par type'], ['TYPE_THEMED_ELITE4_GYMS', 'Thème par type (Arènes et Conseil 4)']]),
      B('trainersUsePokemonOfSimilarStrength', 'Pokémon de force proche', { if: not('trainersMod', 'UNCHANGED') }),
      B('rivalCarriesStarterThroughout', 'Le rival garde son starter', { if: not('trainersMod', 'UNCHANGED') }),
      B('trainersMatchTypingDistribution', 'Garder la répartition des types', { if: not('trainersMod', 'UNCHANGED') }),
      B('trainersBlockLegendaries', 'Pas de légendaires chez les dresseurs', { if: not('trainersMod', 'UNCHANGED') }),
      B('trainersBlockEarlyWonderGuard', 'Pas de Garde Mystik au début', { if: not('trainersMod', 'UNCHANGED'), gen: [3, 5] }),
      B('trainersForceFullyEvolved', 'Pokémon entièrement évolués à partir d’un niveau'),
      N('trainersForceFullyEvolvedLevel', 'À partir du niveau', 30, 65, 1, '', { if: on('trainersForceFullyEvolved') }),
      B('trainersLevelModified', 'Changer le niveau des dresseurs'),
      N('trainersLevelModifier', 'Niveau des dresseurs', -50, 50, 5, '%', { if: on('trainersLevelModified') }),
      N('additionalRegularTrainerPokemon', 'Pokémon en plus (dresseurs normaux)', 0, 5, 1, '', { gen: [3, 5] }),
      N('additionalImportantTrainerPokemon', 'Pokémon en plus (rival, Team)', 0, 5, 1, '', { gen: [3, 5] }),
      N('additionalBossTrainerPokemon', 'Pokémon en plus (champions, Conseil 4)', 0, 5, 1, '', { gen: [3, 5] }),
      B('randomizeHeldItemsForBossTrainerPokemon', 'Objets tenus pour les champions', { gen: [3, 5] }),
      B('doubleBattleMode', 'Tous les combats de dresseurs en duo', { gen: [3, 5], hint: 'Chaque dresseur se bat en 2 contre 2 : idéal pour une aventure en équipe.' }),
      B('betterTrainerMovesets', 'Attaques des dresseurs plus malines', { gen: [3, 5] }),
      B('randomizeTrainerNames', 'Noms des dresseurs aléatoires', { cap: 'canChangeTrainerText' }),
    ],
  },
  {
    id: 'wild', icon: 'leaf', title: 'Sauvages', sub: 'Rencontres, niveaux, captures',
    fields: [
      C('wildPokemonMod', 'Rencontres', [['UNCHANGED', 'Inchangées'], ['RANDOM', 'Aléatoires'], ['AREA_MAPPING', 'Remplacées zone par zone'], ['GLOBAL_MAPPING', 'Remplacées dans tout le jeu']]),
      C('wildPokemonRestrictionMod', 'Règle', [['NONE', 'Aucune'], ['SIMILAR_STRENGTH', 'Force proche de l’original'], ['CATCH_EM_ALL', 'Tous attrapables'], ['TYPE_THEME_AREAS', 'Un type par zone']], { if: not('wildPokemonMod', 'UNCHANGED') }),
      B('useTimeBasedEncounters', 'Rencontres différentes jour et nuit', { if: not('wildPokemonMod', 'UNCHANGED'), cap: 'hasTimeBasedEncounters' }),
      B('blockWildLegendaries', 'Pas de légendaires sauvages', { if: not('wildPokemonMod', 'UNCHANGED') }),
      B('useMinimumCatchRate', 'Captures plus faciles'),
      N('minimumCatchRateLevel', 'Facilité de capture', 1, 5, 1, '', { if: on('useMinimumCatchRate') }),
      B('wildLevelsModified', 'Changer le niveau des sauvages'),
      N('wildLevelModifier', 'Niveau des sauvages', -50, 50, 5, '%', { if: on('wildLevelsModified') }),
      B('randomizeWildPokemonHeldItems', 'Objets tenus aléatoires', { gen: [2, 5] }),
    ],
  },
  {
    id: 'tms', icon: 'package', title: 'CT, CS, tuteurs', sub: 'Attaques enseignées',
    fields: [
      C('tmsMod', 'Attaques des CT', [['UNCHANGED', 'Inchangées'], ['RANDOM', 'Aléatoires']]),
      B('keepFieldMoveTMs', 'Garder les CT utiles hors combat', { if: on('tmsMod', 'RANDOM') }),
      B('tmLevelUpMoveSanity', 'Cohérentes avec les attaques apprises', { if: on('tmsMod', 'RANDOM') }),
      C('tmsHmsCompatibilityMod', 'Qui peut apprendre quoi', [['UNCHANGED', 'Inchangé'], ['RANDOM_PREFER_TYPE', 'Aléatoire (même type de préférence)'], ['COMPLETELY_RANDOM', 'Totalement aléatoire'], ['FULL', 'Tout le monde apprend tout']]),
      B('fullHMCompat', 'Tout le monde peut apprendre les CS'),
      C('moveTutorMovesMod', 'Attaques des tuteurs', [['UNCHANGED', 'Inchangées'], ['RANDOM', 'Aléatoires']], { cap: 'hasMoveTutors' }),
      C('moveTutorsCompatibilityMod', 'Qui peut les apprendre', [['UNCHANGED', 'Inchangé'], ['RANDOM_PREFER_TYPE', 'Aléatoire (même type de préférence)'], ['COMPLETELY_RANDOM', 'Totalement aléatoire'], ['FULL', 'Tout le monde']], { cap: 'hasMoveTutors' }),
    ],
  },
  {
    id: 'items', icon: 'trees', title: 'Objets', sub: 'Au sol, magasins, Ramassage',
    fields: [
      C('fieldItemsMod', 'Objets au sol', [['UNCHANGED', 'Inchangés'], ['SHUFFLE', 'Mélangés'], ['RANDOM', 'Aléatoires'], ['RANDOM_EVEN', 'Aléatoires équilibrés']]),
      B('banBadRandomFieldItems', 'Pas d’objets inutiles', { if: s => s.fieldItemsMod === 'RANDOM' || s.fieldItemsMod === 'RANDOM_EVEN' }),
      C('shopItemsMod', 'Magasins', [['UNCHANGED', 'Inchangés'], ['SHUFFLE', 'Mélangés'], ['RANDOM', 'Aléatoires']], { cap: 'hasShopRandomization' }),
      B('guaranteeEvolutionItems', 'Pierres d’évolution toujours en vente', { if: not('shopItemsMod', 'UNCHANGED') }),
      B('balanceShopPrices', 'Prix équilibrés', { if: not('shopItemsMod', 'UNCHANGED') }),
      C('pickupItemsMod', 'Objets de Ramassage', [['UNCHANGED', 'Inchangés'], ['RANDOM', 'Aléatoires']], { gen: [3, 5] }),
    ],
  },
  { id: 'misc', icon: 'sliders-horizontal', title: 'Confort', sub: 'Réglages propres à ton jeu', fields: [{ type: 'tweaks', key: 'miscTweaks', label: 'Options du jeu' }] },
  { id: 'doors', icon: 'door-open', title: 'Random map', sub: 'Chaque porte mène ailleurs', fields: [{ type: 'doors', key: 'doors', label: 'Portes' }] },
  { id: 'rules', icon: 'shield', title: 'Règles de la run', sub: 'Nuzlocke, limites, défis', fields: [{ type: 'rules', key: 'rules', label: 'Règles' }] },
];

/** Noms français des options « divers » d'UPR, par valeur de bit. */
export const TWEAKS_FR = {
  1: ['Expérience façon Noir et Blanc', 'Plus d’expérience contre les Pokémon de niveau supérieur.'],
  2: ['Précision X moins puissante', 'L’objet n’assure plus de toucher les attaques K.O. en un coup.'],
  4: ['Taux de coups critiques corrigé', 'Comme dans les jeux suivants.'],
  8: ['Texte instantané', 'Les dialogues s’affichent d’un coup.'],
  16: ['Courir à l’intérieur', 'Les Chaussures de Course marchent partout.'],
  32: ['Objet du PC aléatoire', 'L’objet stocké au début est tiré au sort.'],
  64: ['Pikachu peut évoluer', 'Dans Pokémon Jaune.'],
  128: ['Pokédex National dès le début', 'Tous les Pokémon apparaissent au Pokédex.'],
  256: ['Table des types moderne', 'Efficacités des types des jeux récents.'],
  512: ['Mode Défi forcé', 'Noir 2 et Blanc 2 : dresseurs plus forts.'],
  1024: ['Noms de Pokémon en minuscules', 'Bulbizarre au lieu de BULBIZARRE.'],
  2048: ['Tutoriel de capture aléatoire', 'Un autre Pokémon dans la démonstration.'],
  4096: ['Œuf Chance interdit', 'Il n’apparaît nulle part.'],
  8192: ['Pas d’Œuf Chance offert', 'Le cadeau du jeu est retiré.'],
  16384: ['Objets du Maniaque interdits', 'Les objets de revente chers disparaissent.'],
  65536: ['Niveaux des Pokémon fixes équilibrés', 'Adaptés à l’avancée de l’histoire.'],
  131072: ['Garder les formes alternatives', 'Les formes restent possibles.'],
  262144: ['Courir sans Chaussures de Course', 'Dès le début du jeu.'],
  524288: ['Barres de PV et d’EXP plus rapides', 'Les combats vont plus vite.'],
  1048576: ['Monde Distorsion accéléré', 'Moins d’allers-retours.'],
  2097152: ['Types modernes de Motisma', 'Les formes de Motisma prennent leurs types actuels.'],
  4194304: ['Sans musique de PV faibles', 'Plus de bip quand les PV sont bas.'],
};

export const RULES = [
  ['nuzlocke', 'Nuzlocke', 'Première rencontre de chaque zone seulement · un K.O. est définitif · surnoms obligatoires.'],
  ['shared', 'Âmes liées', 'Les Pokémon rencontrés au même endroit sont liés entre amis : si l’un tombe K.O., les autres aussi, pour de bon. Appliqué dans le jeu.'],
  ['levelCap', 'Plafond de niveau', 'Au niveau du plus fort Pokémon du prochain champion : plus d’expérience ni de Super Bonbon au-delà. Appliqué dans le jeu.'],
  ['noItems', 'Sans objets en combat', 'Aucune potion pendant les combats.'],
  ['duoOnly', 'Duo obligatoire', 'Les combats entre amis se jouent à deux contre deux.'],
];

export const PRESETS = [
  {
    id: 'nuzlocke', name: 'Nuzlocke', sub: 'Défi classique, sauvages et dresseurs aléatoires',
    settings: { startersMod: 'RANDOM_WITH_TWO_EVOLUTIONS', wildPokemonMod: 'RANDOM', wildPokemonRestrictionMod: 'SIMILAR_STRENGTH', blockWildLegendaries: true,
      trainersMod: 'RANDOM', trainersUsePokemonOfSimilarStrength: true, rivalCarriesStarterThroughout: true, trainersLevelModified: true, trainersLevelModifier: 10,
      staticPokemonMod: 'SIMILAR_STRENGTH', changeImpossibleEvolutions: true, useMinimumCatchRate: true, minimumCatchRateLevel: 2, fieldItemsMod: 'SHUFFLE' },
    tweaks: [8, 524288, 262144, 16], doors: 'off', rules: ['nuzlocke', 'levelCap'],
  },
  {
    id: 'aventure', name: 'Aventure entre amis', sub: 'Tout le monde capture tout, Arènes à thème',
    settings: { startersMod: 'COMPLETELY_RANDOM', wildPokemonMod: 'AREA_MAPPING', wildPokemonRestrictionMod: 'CATCH_EM_ALL', trainersMod: 'TYPE_THEMED_ELITE4_GYMS',
      trainersUsePokemonOfSimilarStrength: true, changeImpossibleEvolutions: true, makeEvolutionsEasier: true, tmsHmsCompatibilityMod: 'RANDOM_PREFER_TYPE', fullHMCompat: true },
    tweaks: [8, 524288, 262144, 128], doors: 'city', rules: ['shared'],
  },
  {
    id: 'duo', name: 'Duo', sub: 'Chaque combat de dresseur en 2 contre 2',
    settings: { doubleBattleMode: true, additionalRegularTrainerPokemon: 1, trainersMod: 'RANDOM', trainersUsePokemonOfSimilarStrength: true, wildPokemonMod: 'RANDOM', wildPokemonRestrictionMod: 'SIMILAR_STRENGTH', changeImpossibleEvolutions: true },
    tweaks: [8, 524288], doors: 'off', rules: ['duoOnly'],
  },
  {
    id: 'chaos', name: 'Chaos total', sub: 'Stats, types, attaques, portes : tout bouge',
    settings: { baseStatisticsMod: 'RANDOM', typesMod: 'COMPLETELY_RANDOM', abilitiesMod: 'RANDOMIZE', evolutionsMod: 'RANDOM', startersMod: 'COMPLETELY_RANDOM', movesetsMod: 'COMPLETELY_RANDOM',
      startWithGuaranteedMoves: true, guaranteedMoveCount: 4, trainersMod: 'RANDOM', wildPokemonMod: 'RANDOM', staticPokemonMod: 'COMPLETELY_RANDOM', tmsMod: 'RANDOM',
      tmsHmsCompatibilityMod: 'COMPLETELY_RANDOM', fieldItemsMod: 'RANDOM', shopItemsMod: 'RANDOM', randomizeMovePowers: true, randomizeMoveTypes: true, changeImpossibleEvolutions: true },
    tweaks: [8, 524288, 262144], doors: 'chaos', rules: [],
  },
];
