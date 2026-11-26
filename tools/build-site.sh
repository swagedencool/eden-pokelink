#!/bin/sh
# Prépare le dossier à mettre en ligne : le site entier, sans les fichiers de test ni les ROMs locales.
# Ensuite, n'importe quel hébergement de fichiers statiques convient (GitHub Pages, Cloudflare Pages, Netlify…).
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
cp -r web/index.html web/play.html web/atelier.html web/css web/js web/vendor web/icons dist/ 2>/dev/null || cp -r web/index.html web/play.html web/atelier.html web/css web/js web/vendor dist/
[ -f dist/vendor/upr/upr.jar ] || echo "Attention : dist/vendor/upr/upr.jar absent (lancer server/upr/build.sh)"
touch dist/.nojekyll                    # GitHub Pages : servir tel quel
find dist -name '*.nds' -o -name '*.sav' -o -name '*.dsv' | grep . && { echo "ROM ou sauvegarde trouvée dans dist : arrêt"; exit 1; } || true
echo "dist/ prêt : $(du -sh dist | cut -f1), $(find dist -type f | wc -l) fichiers"
