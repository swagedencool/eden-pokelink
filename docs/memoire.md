# Mémoire et données de Pokémon Platine (FR, CPUF rev 0) — tout ce qui a été vérifié

Méthode : ROM et sauvegarde du joueur dans DeSmuME, déplacements scriptés, comparaison de la RAM, puis
recoupement avec la décompilation [pret/pokeplatinum](https://github.com/pret/pokeplatinum) (version US).

## Sauvegarde vivante (RAM)

- `0x02101F20` : pointeur vers `SaveData` (`sSaveDataPtr`). Stable d'une zone à l'autre.
- `SaveData + 0x14` : début des données, identiques au bloc général du fichier `.sav` (décalage 0x14).
- `SaveData + 0x7C` : nom du dresseur (8 caractères 16 bits).
- `SaveData + 0xAC / 0xB0 / 0xB4` : équipe — capacité, nombre, puis 6 Pokémon de 236 octets.
  Écrire ici modifie l'équipe du jeu (vérifié dans le menu Pokémon du jeu).
- `SaveData + 0x1294` : `Location` du joueur : carte, sortie, x, z (cases ; dehors : coordonnées globales).

## Pokémon (format 4G)

- 136 octets de boîte + 100 octets d'équipe. Blocs A/B/C/D mélangés selon `(PID & 0x3E000) >> 13`,
  chiffrés par LCG (0x41C64E6D, 0x6073) avec la somme de contrôle (boîte) ou le PID (équipe).
- Les stats d'équipe recalculées (formules 4G + stats de base de la ROM) sont identiques à celles du jeu (6/6).
- Boîtes du fichier `.sav` : `0xCF2C + 4 + index × 0x88`.
- **Piège trouvé avec ta sauvegarde** : sur la carte, le jeu tourne à 30 images/s et retravaille le Pokémon
  de tête à chaque image de jeu. Une image émulée sur deux s'arrête au milieu de son rechiffrement
  (octets 114 à 135 encore en clair, somme de contrôle fausse). Lire à ce moment-là fait « disparaître »
  le Pokémon ; écrire à ce moment-là le corromprait (le jeu finit de chiffrer par-dessus).
  Règle appliquée : on ne lit et n'écrit un Pokémon que s'il est au repos (drapeaux octets 4-5 à 0 et somme
  juste) — `monIsStable` et `PartyMirror` dans `web/js/pk4.js` ; l'écriture attend la prochaine image
  stable puis est vérifiée pendant 6 images (`apply_pending` dans `tools/capture2.py`). Vérifié : PV écrits
  sur une image instable → appliqués à l'image suivante, visibles dans le menu Pokémon du jeu.

## Joueur et caméra

- `MapObject` du joueur (tas, retrouvé par balayage après chaque changement de zone) : direction +0x28,
  case x/y/z +0x64/+0x68/+0x6C (mise à jour au début du pas), position fx32 +0x70/+0x74/+0x78.
- Table des en-têtes de carte : `0x020E60A4`, 24 octets par carte : matrice +0x02 (0 = monde extérieur),
  nom du lieu +0x12, type de caméra +0x15.
- 17 types de caméra (`field_camera.c`) ; perspective vérifiée dehors (Bonaugure), orthographique (type 4)
  vérifiée en intérieur (maison du joueur).
- `0x0400006C` (MASTER_BRIGHT) : fondus au noir (bits 14-15 = mode, bits 0-4 = niveau 0–16).
- `0x04000000` (DISPCNT) bit 3 : calque 3D actif = le joueur est sur la carte (0 dans les menus).
- Un appui de direction de 6 frames ou moins tourne le personnage sans le faire avancer.

## Fichiers de la ROM

- `msgdata/pl_msg.narc` : textes chiffrés ; banques 412 espèces, 647 attaques, 392 objets, 610 talents,
  624 types, 433 lieux, 202 natures. Table de caractères : `tools/msgenc/charmap.txt` de la décompilation.
- `poketool/waza/pl_waza_tbl.narc` : attaques (catégorie +2, puissance +3, type +4, précision +5, PP +6).
- `poketool/personal/pl_personal.narc` : espèces (stats de base, types +6/+7, courbe d'expérience +0x13).
- `poketool/pokegra/pl_pokegra.narc` : sprites de combat, 6 fichiers par espèce (dos ♀/♂, face ♀/♂,
  palette, palette chromatique) ; NCGR 160×80 chiffré (graine = 1er mot, LCG 0x4E6D/0x6073).
- `poketool/icongra/pl_poke_icon.narc` : icônes ; espèce `s` → membre `7 + s`.
- `data/mmodel/mmodel.narc` : sprites du monde ; Lucas 90, Aurore 91 ; Pokémon qui marchent : starters, Pikachu…
- Palette du joueur réécrite dans la ROM chargée → relue au prochain chargement de zone (vérifié).

## Mode partenaire (pour le duo)

- `SystemFlag_CheckHasPartner` + `SystemVars_GetPartnerTrainerID` : rencontres sauvages en 2 contre 2 avec
  partenaire IA, dresseurs en paire avec partenaire. À adapter : dresseurs seuls, soin automatique.

## Émulateur du navigateur (EmulatorJS)

- La RAM principale de la DS (4 Mo) est retrouvée dans la mémoire WebAssembly du cœur grâce à l'en-tête de la
  cartouche, que la console recopie en 0x027FFE00 et 0x027FFA80 (`findNdsRam`). Vérifié avec DeSmuME 2015 et melonDS.
- Sauvegarde : posée dans `/data/saves/<cœur>/<jeu>.dsv|.sav` avant le chargement du jeu. DeSmuME 2015 veut le pied
  de page `.dsv` (taille, type 6 = Flash 4 Mbit, 3 octets d'adresse) : `toDsv()` le produit, identique octet pour octet
  à celui de DeSmuME ; `rawSave()` le retire à l'export.
- melonDS (cœur d'EmulatorJS 4.2.3) : avec la sauvegarde de test, le menu principal de Platine échoue à initialiser le
  sans-fil (Cadeau Mystère débloqué) et affiche « Erreur de communication » (`HeapCanaryFailed`, type 2). DeSmuME 2015 non.
- Écran « carte » ou menu, et fondu : les registres d'affichage ne sont pas lisibles depuis la page. On lit 5 pixels du
  cadre du Pokétch sur l'écran du bas : mêmes couleurs, assombries d'un même facteur = carte visible ; le facteur
  donne le fondu. Vérifié : carte → oui, menu Pokémon, journal, écran blanc → non.

## Random map (Platine)

- `fielddata/eventdata/zone_event.narc` : [n, n×20 décors] [n, n×32 personnages] [n, n×12 téléporteurs] [n, n×16 déclencheurs].
  Téléporteur : x, z, carte d'arrivée, téléporteur d'arrivée (u16), 4 octets libres. 256 = arrivée dynamique (non touché).
- Table des en-têtes en clair dans arm9 (0x020E60A4 pour CPUF) : +0x10 fichier d'événements, +0x12 lieu, +0x16 & 0x7F type.
- 1 123 portes, 489 paires réciproques. Vérifié dans le jeu : porte du Centre Pokémon de Féli-Cité → Global Terminal,
  sortie → retour devant la même porte.

## Règles de la room (Platine FR)

- Plafond de niveau : le jeu teste « niveau 100 » à trois endroits (code Thumb : `movs r1,#0xA1` (niveau) ·
  `movs r2,#0` · `bl Pokemon_GetValue` · `cmp r0,#100` · branchement). PokéLink remplace 100 par le plafond et le
  branchement « égal/différent » par « ≥ / < », à chaque image et seulement si la signature est en mémoire :
  - EXP en combat, overlay 16 : 0x022492F0 `64 28 00 D1` → `cap 28 00 D3` ;
  - Pension, overlay 5 : 0x021E66C0 `64 28 13 D0` → `cap 28 13 D2` ;
  - Super Bonbon, arm9 : 0x0209660E `64 28 05 D2` → `cap 28 05 D2`.
  Vérifié en combat sauvage (Route 204) : Calabrese niveau 60, plafond 50 → EXP inchangée ; sans plafond ou plafond 70 → +33 EXP.
  Rien n'est écrit dans la ROM ni la sauvegarde : couper la règle remet le code d'origine.
- Plafond automatique : badges = TrainerInfo + 0x1A (SaveData + 0x96), Ligue terminée = TrainerInfo + 0x1D bit 0.
  Niveaux des champions lus dans `poketool/trainer/trdata.narc` / `trpoke.narc` (dresseurs 246, 315, 318, 317, 316, 250,
  319, 320 puis 261–264 et 267) : 14, 22, 26, 32, 37, 41, 44, 50, puis 62.
- Lieu de rencontre d'un Pokémon : bloc B + 0x1E (Platine), sinon bloc D + 0x18 (Diamant/Perle). Vérifié sur l'équipe de test
  (Calabrese Route 201, Shin-Chan Route 203, VioletASMR Forêt Vestigion…).
