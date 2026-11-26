#!/bin/sh
# Construit upr.jar : Universal Pokémon Randomizer ZX (GPL-3.0) + le pont PokéLink.
# Prérequis : git, JDK 11 ou plus récent (le jar produit vise Java 8, ce qu'exécute CheerpJ dans le navigateur).
set -e
cd "$(dirname "$0")"
UPR_COMMIT=7f00eb866ed35c8fe3963f078b6a2e0979dc2b8c
if [ ! -d src-upr ]; then
  git clone -q https://github.com/Ajarmar/universal-pokemon-randomizer-zx.git src-upr
fi
git -C src-upr checkout -q "$UPR_COMMIT"
rm -rf build && mkdir -p build
find src-upr/src -name '*.java' > build/sources.txt
echo PokeLinkUPR.java >> build/sources.txt
javac -nowarn -encoding UTF-8 --release 8 -d build @build/sources.txt 2>&1 | grep -v '^Note:' || true
# ressources d'UPR (tables de textes, offsets par version, patchs, textes de l'interface)
(cd src-upr/src && find . -type f ! -name '*.java' -exec cp --parents {} ../../build/ \;)
(cd build && jar cf ../upr.jar .)
rm -rf build
mkdir -p ../../web/vendor/upr && cp upr.jar ../../web/vendor/upr/upr.jar     # le site l'exécute dans le navigateur (CheerpJ)
echo "upr.jar prêt ($(du -h upr.jar | cut -f1)), copié dans web/vendor/upr"
