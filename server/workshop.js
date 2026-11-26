// Atelier ROM : exécute l'Universal Pokémon Randomizer ZX (Java, GPL-3.0) sur la ROM envoyée par le joueur.
// La ROM n'est gardée que le temps de la session d'atelier (15 min max, dossier temporaire privé), jamais servie
// à quelqu'un d'autre, et supprimée après le téléchargement du résultat ou à l'expiration.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const JAR = path.join(__dirname, 'upr', 'upr.jar');
const MAX_ROM = 600 * 1024 * 1024;           // Noir 2 / Blanc 2 font 512 Mo
const TTL = 15 * 60 * 1000;
const MAX_SESSIONS = 6;                      // sessions ouvertes en même temps sur le serveur
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{1,60}$/;

function createWorkshop({ dir = path.join(os.tmpdir(), 'pokelink-atelier'), java = 'java', jar = JAR } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sessions = new Map();                // token -> { rom, out, timer, info, busy }
  let queue = Promise.resolve();             // un seul randomizer à la fois

  const run = args => (queue = queue.then(() => new Promise(resolve => {
    execFile(java, ['-Xmx1500m', '-cp', jar, 'PokeLinkUPR', ...args], { timeout: 180000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      const line = String(stdout || '').trim().split('\n').pop();
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: err ? (err.killed ? 'Temps dépassé' : 'Le randomizer a échoué') : 'Réponse illisible' }); }
    });
  }))).then(r => r);

  const drop = token => {
    const s = sessions.get(token);
    if (!s) return;
    clearTimeout(s.timer);
    for (const f of [s.rom, s.out, s.out + '.log', s.settings]) fs.rmSync(f, { force: true });
    sessions.delete(token);
  };
  const touch = token => { const s = sessions.get(token); clearTimeout(s.timer); s.timer = setTimeout(() => drop(token), TTL); };
  const get = (req, res) => {
    const s = sessions.get(String(req.params.token || ''));
    if (!s) { res.status(404).json({ ok: false, error: 'Session expirée : renvoie ta ROM' }); return null; }
    return s;
  };

  function routes(app) {
    app.post('/api/atelier/rom', (req, res) => {
      if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ ok: false, error: 'Atelier occupé, réessaie dans une minute' });
      const len = Number(req.headers['content-length'] || 0);
      if (!len || len > MAX_ROM) return res.status(413).json({ ok: false, error: 'ROM trop grande ou vide' });
      const token = crypto.randomBytes(18).toString('base64url');
      const base = path.join(dir, token);
      const s = { rom: base + '.rom', out: base + '.out', settings: base + '.txt', busy: false };
      sessions.set(token, s); touch(token);
      let size = 0, aborted = false;
      const ws = fs.createWriteStream(s.rom, { mode: 0o600 });
      req.on('data', c => { size += c.length; if (size > MAX_ROM && !aborted) { aborted = true; req.destroy(); drop(token); } });
      req.on('aborted', () => { aborted = true; drop(token); });
      req.pipe(ws);
      ws.on('finish', async () => {
        if (aborted) return;
        const info = await run(['info', s.rom]);
        if (!info.ok) { drop(token); return res.status(400).json({ ok: false, error: info.error || 'ROM non reconnue' }); }
        s.info = info;
        res.json({ ok: true, token, info, expiresIn: TTL / 1000 });
      });
    });

    app.post('/api/atelier/:token/randomize', require('express').json({ limit: '64kb' }), async (req, res) => {
      const s = get(req, res); if (!s) return;
      if (s.busy) return res.status(409).json({ ok: false, error: 'Randomisation déjà en cours' });
      const { settings = {}, settingsString, seed } = req.body || {};
      const lines = [];
      if (typeof settingsString === 'string' && /^[0-9]{3}[A-Za-z0-9+/=]+$/.test(settingsString)) lines.push('settingsString=' + settingsString);
      for (const [k, v] of Object.entries(settings)) {
        if (!KEY_RE.test(k)) continue;
        const val = Array.isArray(v) ? v.map(Number).filter(Number.isFinite).join(',') : String(v);
        if (/^[A-Za-z0-9_,.-]{0,200}$/.test(val)) lines.push(`${k}=${val}`);
      }
      const seedNum = BigInt.asIntN(64, BigInt(/^-?\d{1,19}$/.test(String(seed)) ? String(seed) : '0'));
      fs.writeFileSync(s.settings, lines.join('\n'), { mode: 0o600 });
      s.busy = true; touch(req.params.token);
      const r = await run(['randomize', s.rom, s.out, s.settings, seedNum.toString()]);
      s.busy = false;
      if (!r.ok) return res.status(500).json(r);
      let log = '';
      try { log = fs.readFileSync(s.out + '.log', 'utf8'); } catch {}
      res.json({ ...r, log, size: fs.statSync(s.out).size });
    });

    app.get('/api/atelier/:token/rom', (req, res) => {
      const s = get(req, res); if (!s) return;
      if (!fs.existsSync(s.out)) return res.status(404).json({ ok: false, error: 'Rien à télécharger' });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      const rs = fs.createReadStream(s.out);
      rs.pipe(res);
      rs.on('close', () => { if (req.query.keep !== '1') drop(req.params.token); });
    });

    app.delete('/api/atelier/:token', (req, res) => { drop(String(req.params.token)); res.json({ ok: true }); });
    app.post('/api/atelier/:token/close', (req, res) => { drop(String(req.params.token)); res.json({ ok: true }); });   // départ de la page
  }

  return { routes, sessions, close: () => { for (const t of [...sessions.keys()]) drop(t); } };
}

module.exports = { createWorkshop };
