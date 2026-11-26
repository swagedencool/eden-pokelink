#!/bin/sh
# Prépare le dossier à mettre en ligne : le site entier, sans les fichiers de test ni les ROMs locales.
# Ensuite, n'importe quel hébergement de fichiers statiques convient (GitHub Pages, Cloudflare Pages, Netlify…).
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
cp -r web/index.html web/play.html web/atelier.html web/css web/js web/vendor web/icons dist/ 2>/dev/null || cp -r web/index.html web/play.html web/atelier.html web/css web/js web/vendor dist/
[ -f dist/vendor/upr/upr.jar ] || echo "Attention : dist/vendor/upr/upr.jar absent (lancer server/upr/build.sh)"
touch dist/.nojekyll                    # GitHub Pages : servir tel quel
# Version affichée en haut des pages : SITE_VERSION (nom de la release), sinon le dernier tag git
VERSION="${SITE_VERSION:-$(git describe --tags --always 2>/dev/null || echo dev)}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo '')}"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"version":"%s","sha":"%s","date":"%s"}\n' "$VERSION" "$SHA" "$DATE" > dist/version.json
printf '// Généré par tools/build-site.sh\nexport const BUILD = { version: "%s", sha: "%s", date: "%s" };\n' "$VERSION" "$SHA" "$DATE" > dist/js/version.js
echo "Version : $VERSION"
find dist -name '*.nds' -o -name '*.sav' -o -name '*.dsv' | grep . && { echo "ROM ou sauvegarde trouvée dans dist : arrêt"; exit 1; } || true
echo "dist/ prêt : $(du -sh dist | cut -f1), $(find dist -type f | wc -l) fichiers"
