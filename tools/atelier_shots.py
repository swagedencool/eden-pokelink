# Captures et vérifications de l'atelier ROM (vraie ROM, vrai serveur, vrai randomizer).
import sys, json, asyncio
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:3000/atelier.html' + (sys.argv[1] if len(sys.argv) > 1 else '')
OUT = '/home/claude/work/at_'

AUDIT = r"""() => {
  const issues = [];
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll('#atelier *, .at-modal *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect(), p = el.parentElement?.getBoundingClientRect();
    // texte coupé
    if ((el.scrollWidth > el.clientWidth + 1) && getComputedStyle(el).overflow !== 'visible' && !/ellipsis/.test(getComputedStyle(el).textOverflow) && !el.matches('pre,select,.at-nav,.at-dialog-body,textarea,input'))
      issues.push('coupé: ' + el.className + ' ' + el.textContent.slice(0, 30));
    // débordement du parent
    if (p && el.parentElement.matches('.at-card,.at-field,.at-toggle,.at-door,.at-preset,.at-tab,.at-bar,.at-banner') && (r.right > p.right + 1 || r.left < p.left - 1))
      issues.push('déborde: ' + el.className + ' dans ' + el.parentElement.className);
    // icônes centrées dans leur pastille
    if (el.matches('.at-tab-ic,.at-sec-ic,.at-door-ic,.at-drop-ic,.at-icon-btn,.at-logo,.at-banner-ic')) {
      const svg = el.querySelector('svg'); if (svg) { const q = svg.getBoundingClientRect();
        const dx = (q.left + q.right) / 2 - (r.left + r.right) / 2, dy = (q.top + q.bottom) / 2 - (r.top + r.bottom) / 2;
        if (Math.abs(dx) > 0.75 || Math.abs(dy) > 0.75) issues.push(`icône décentrée ${el.className} (${dx.toFixed(1)}, ${dy.toFixed(1)})`); }
    }
  }
  // marges symétriques des cartes
  for (const c of document.querySelectorAll('.at-card')) {
    const r = c.getBoundingClientRect(), kids = [...c.children].map(k => k.getBoundingClientRect());
    const l = Math.min(...kids.map(k => k.left)) - r.left, rr = r.right - Math.max(...kids.map(k => k.right));
    if (Math.abs(l - rr) > 1) issues.push(`marges inégales ${c.className} ${l.toFixed(1)}/${rr.toFixed(1)}`);
  }
  return issues;
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--force-color-profile=srgb'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ' ' + m.text)); pg.on('pageerror', lambda e: logs.append('ERR ' + str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(600)
        async def shot(name):
            await pg.wait_for_timeout(250)
            issues = await pg.evaluate(AUDIT)
            await pg.screenshot(path=OUT + name + '.png')
            print(name, len(issues), 'problème(s)', issues[:6], flush=True)
        await shot('0_vide')
        await pg.set_input_files('input[type=file]', '/home/claude/work/pt.nds')
        await pg.wait_for_function("window.ATELIER.S.upload.state === 'ready' || window.ATELIER.S.upload.state === 'error'", timeout=120000)
        print('upload', await pg.evaluate('window.ATELIER.S.upload.state'), await pg.evaluate('window.ATELIER.S.info && window.ATELIER.S.info.name'))
        await shot('1_rom')
        await pg.evaluate("window.ATELIER.applyPreset('nuzlocke')")
        await shot('2_nuzlocke')
        for sec in ['trainers', 'wild', 'misc', 'doors', 'rules', 'starters']:
            await pg.click(f'.at-tab:nth-child({["pokemon","starters","moves","trainers","wild","tms","items","misc","doors","rules"].index(sec)+1})')
            if sec == 'doors': await pg.click('.at-door:nth-child(3)')
            if sec == 'starters':
                await pg.click('.at-seg-btn:has-text("Choisis par moi")')
                await pg.select_option('.at-starters select >> nth=0', '395')
                await pg.select_option('.at-starters select >> nth=1', '158')
                await pg.select_option('.at-starters select >> nth=2', '7')
            await shot('3_' + sec)
        await pg.click('.at-bar .at-btn.primary')
        await pg.wait_for_function("window.ATELIER.S.result || !window.ATELIER.S.busy", timeout=180000)
        await pg.wait_for_timeout(300)
        r = await pg.evaluate("(() => { const r = window.ATELIER.S.result; return r && { fp: r.fingerprint, size: r.bytes.length, doors: r.doors && r.doors.changed, warn: r.upr && r.upr.warnings, starters: r.upr && r.upr.log.split('\\n').filter(l => /^Set starter/.test(l)) }; })()")
        print('RESULT', json.dumps(r, ensure_ascii=False))
        await shot('4_pret')
        await pg.click('.at-bar-actions .at-btn:has-text("Journal")')
        await shot('5_journal')
        print('LOGS', [l for l in logs if 'favicon' not in l][:10])
        await b.close()

if __name__ == "__main__":
    asyncio.run(main())
