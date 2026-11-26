# PokéLink : notes techniques

Détails pour qui veut comprendre ou faire évoluer le projet. Pour la présentation, voir le [README](../README.md).

## Ce qui est fait et vérifié sur une vraie ROM (Platine FR) et une vraie sauvegarde

| Fonction | État |
|---|---|
| Émulateur dans le navigateur : Platine démarre, la sauvegarde du joueur est chargée, touches et écran tactile passent par PokéLink | ✅ vérifié |
| Mémoire du jeu lue dans le navigateur : position, carte, équipe, écran « carte » ou menu, fondus | ✅ vérifié |
| Position, carte, direction lues dans la mémoire du jeu ; projection pour les 17 caméras de Platine | ✅ vérifié au pixel |
| Amis affichés et animés dans le monde ; masqués derrière son propre personnage ; « solides » | ✅ |
| Menu d'interaction, demandes avec compte à rebours, émotes | ✅ |
| Échange synchronisé, **Pokémon reçu écrit dans l'équipe du jeu** (stats recalculées = celles du jeu) | ✅ vérifié |
| Combat entre joueurs (simulateur Showdown, règles 4G) et **résultat écrit dans la partie** | ✅ vérifié |
| Lectures/écritures d'équipe sûres : jamais pendant que le jeu rechiffre un Pokémon (voir `docs/memoire.md`) | ✅ vérifié |
| Profil : pseudo, Lucas/Aurore, couleurs, Pokémon compagnon ; recoloration aussi dans le jeu | ✅ vérifié |
| **Atelier : Universal Pokémon Randomizer ZX 4.6.1**, réglages en français, formules, import de réglages UPR, graine partagée, empreinte de run | ✅ vérifié |
| **Random map** : par ville, régional (toujours finissable), chaos ; chaque porte ramène d'où l'on vient | ✅ vérifié dans le jeu |
| **Âmes liées** : Pokémon rencontrés au même endroit liés entre amis ; un K.O. emporte les autres, qui restent K.O. (même après un Centre Pokémon) | ✅ |
| **Plafond de niveau** : automatique (prochain champion, lu dans ta ROM, donc randomisée) ou fixe ; plus d'EXP en combat ni à la Pension, Super Bonbon sans effet | ✅ vérifié dans le jeu |
| Les deux règles s'activent et se coupent à tout moment, par n'importe quel joueur (touche R), et sont transmises aux arrivants | ✅ |
| Bouton **Sauvegarder** (télécharge ton `.sav`), **Sauvegarder et quitter**, **Quitter sans sauvegarder** ; sauvegarde aussi gardée dans le navigateur toutes les 30 s | ✅ vérifié |
| **Écran tactile** : la souris sert de stylet sur l'écran du bas (tutoriel, Pokétch…) | ✅ vérifié |
| **Réglages** en jeu : toutes les touches modifiables, volume, accélération ×1,5 à ×4 (vraie vitesse, son coupé par défaut) | ✅ vérifié |
| **Image** : Pixels d'origine, Net et régulier, Contours HD (Scale3x), Écran LCD, rendus à l'échelle entière ; mode économie | ✅ vérifié |
| Le jeu **continue en arrière-plan** (autre fenêtre devant, onglet caché) | ✅ vérifié |
| Cliquer sur un ami (dans le jeu, son nom, ou la liste « Dans la room ») ouvre son menu, où qu'il soit | ✅ |
| Échanges fiabilisés : état renvoyé chaque seconde, messages en avance gardés, annulation gérée | ✅ |
| **Combat en duo** : 4 contre 4, deux Pokémon de chaque côté sur le terrain, choix de la cible | ✅ |
| Image nette sur les écrans zoomés (Windows 125 %, 150 %…) : l'émulateur dessine toujours en 256 × 384 | ✅ |
| **Équipe d'un ami** en un coup d'œil : sprites, niveaux, types, PV, objet, talent, attaques | ✅ |
| **Badge d'activité** au-dessus d'un ami et dans la liste : en combat, en échange, occupé | ✅ |
| **Souris sur l'écran du haut** : clic pour marcher jusqu'à une case, parler en butant sur quelqu'un, avancer les dialogues ; clic droit = B | ✅ |
| **Lucas ↔ Aurore** dans sa propre partie ; tenue visible à pied, à vélo, en surf | ✅ |
| Export de la sauvegarde guidé : **sauvegarder d'abord dans le jeu**, heure de la dernière sauvegarde affichée | ✅ |
| **Inviter un ami** : lien de la room à copier ou partager | ✅ |
| Tout se fait **à la souris** : menus, échanges, combats, profil, règles (le clavier marche toujours) | ✅ |
| Audit automatique de l'interface (débordements, centrage, marges, texte coupé) | ✅ 0 problème |
| Tests serveur : rooms, format 4G, random map, combats, atelier | ✅ `npm test` |

## Générations et jeux

- **Jouables dans le navigateur avec la room** : Gen 1 à 5 via les cœurs fournis (GB/GBC : Gambatte, GBA : mGBA,
  DS : DeSmuME 2015 — melonDS est aussi fourni, mais il affiche « Erreur de communication » avec certaines
  sauvegardes de Platine). Testé de bout en bout avec Platine ; les autres jeux restent à tester sur leurs ROMs.
- **Randomizer** : toutes les versions reconnues par UPR ZX, françaises comprises (Rouge/Bleu/Jaune, Or/Argent/Cristal,
  Rubis/Saphir/Émeraude, RougeFeu/VertFeuille, Diamant/Perle/Platine, HeartGold/SoulSilver, Noir/Blanc, Noir 2/Blanc 2).
- **Amis visibles dans le monde, échanges et combats intégrés** : Platine FR (adresses vérifiées). Chaque autre jeu
  demande sa table d'adresses (position, carte, équipe), à vérifier sur la vraie ROM : `web/js/emu/platinum.js` sert de modèle.
- **Random map** : Platine FR ; les autres jeux demandent leur table de portes.

## Comment ça marche sans serveur

- **Rooms** : le code de room sert de point de rendez-vous sur des relais Nostr publics (Trystero), puis les
  navigateurs se connectent directement entre eux en WebRTC. Les relais ne voient que la mise en relation, chiffrée
  avec le code de la room ; position, profil, échanges et combats passent ensuite d'un joueur à l'autre.
- **Combats** : simulés par `@pkmn/sim` (le moteur de Pokémon Showdown) dans le navigateur d'un des deux joueurs.
- **Atelier** : l'Universal Pokémon Randomizer ZX (Java) tourne dans le navigateur grâce à CheerpJ.
  La ROM ne quitte jamais ton ordinateur.
- **Sauvegardes** : gardées dans le navigateur (IndexedDB) toutes les 30 s, export en `.sav`.

## Confidentialité

ROMs et sauvegardes restent sur l'ordinateur de chaque joueur : rien n'est envoyé nulle part. Les autres joueurs
de la room ne reçoivent que de petits messages (position, profil, demandes, combats, règles).

## Arborescence

```
web/
  index.html, play.html, atelier.html
  css/pokelink.css       interface glass en jeu (grille de 4 px)
  css/atelier.css        atelier et pages du site
  js/emu/host.js         émulateur (EmulatorJS) : démarrage, sauvegarde, touches, mémoire WebAssembly
  js/emu/platinum.js     adaptateur Platine : état pour l'overlay, équipe, couleurs dans la ROM chargée
  js/play.js             page de jeu
  js/atelier/            atelier ROM : réglages UPR en français, formules, reconnaissance des ROMs
  js/rando/doors.js      random map
  js/p2p.js              rooms pair-à-pair (Trystero / WebRTC)
  js/battle-core.js      combats simulés dans le navigateur
  js/atelier/upr-browser.js  randomizer dans le navigateur (CheerpJ)
  js/rules.js            Âmes liées et Plafond de niveau
  js/rom.js · gamedata.js · pk4.js · sprites.js · projection.js · world.js · overlay.js · input.js · ui.js · battle-ui.js · app.js · net.js · store.js
  vendor/emulatorjs/     EmulatorJS 4.2.3 (GPL-3.0) et cœurs desmume2015, melonds, mgba, gambatte
  vendor/upr/upr.jar     Universal Pokémon Randomizer ZX + pont PokeLinkUPR (GPL-3.0)
  vendor/sim.js, trystero.js  @pkmn/sim (MIT), Trystero (MIT)
  preview/               banc de démo, galerie d'audit, page de test de l'émulateur
server/                  outils et tests (plus utilisé pour jouer)
  upr/                   pont PokeLinkUPR.java + build.sh (UPR ZX, GPL-3.0)
tools/build-site.sh      construit le site statique dans dist/
docs/memoire.md          adresses, structures et formats vérifiés
tools/                   scripts Python de la preview (DeSmuME + Playwright)
```

