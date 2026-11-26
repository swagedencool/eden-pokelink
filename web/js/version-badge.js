// Pastille de version en haut des pages : on voit tout de suite quelle version du site est chargée,
// et si une version plus récente est en ligne (par exemple juste après une release), un clic la charge.
import { BUILD } from './version.js';

const REPO = 'https://github.com/swagedencool/eden-pokelink';
let online = null;

function fmt(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return d; }
}

/** container : où ajouter la pastille ; after : élément après lequel la placer (sinon à la fin). */
export function mountVersion(container, after = null) {
  if (!container || container.querySelector('.pl-ver')) return;
  const dev = BUILD.version === 'dev';
  const a = document.createElement('a');
  a.className = 'pl-ver' + (dev ? ' dev' : '');
  a.textContent = dev ? 'dev' : BUILD.version;
  a.title = dev ? 'Version locale (non publiée)' : `Version ${BUILD.version}${BUILD.date ? ' · publiée le ' + fmt(BUILD.date) : ''}${BUILD.sha ? ' · ' + BUILD.sha.slice(0, 7) : ''}`;
  a.href = dev ? REPO : `${REPO}/releases/tag/${encodeURIComponent(BUILD.version)}`;
  a.target = '_blank'; a.rel = 'noopener';
  after ? after.after(a) : container.append(a);
  if (dev) return;
  const check = async () => {
    try {
      online = online || await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
      if (online && online.version && online.version !== BUILD.version) {
        a.classList.add('update');
        a.textContent = `${BUILD.version} → ${online.version}`;
        a.title = `Une version plus récente est en ligne (${online.version}). Clique pour la charger.`;
        a.removeAttribute('target');
        a.onclick = e => { e.preventDefault(); if (!window.PL || confirm('Charger la nouvelle version ? Pense à sauvegarder ta partie avant.')) location.reload(); };
      }
    } catch {}
  };
  check(); setInterval(() => { online = null; check(); }, 5 * 60 * 1000);
}
