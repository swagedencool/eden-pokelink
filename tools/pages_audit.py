import asyncio, sys
sys.path.insert(0, '/home/claude/scripts')
from playwright.async_api import async_playwright
import atelier_shots
AUDIT = atelier_shots.AUDIT.replace("#atelier *, .at-modal *", "body *").replace("'.at-card,.at-field,.at-toggle,.at-door,.at-preset,.at-tab,.at-bar,.at-banner'", "'.at-card,.at-field,.at-toggle,.at-door,.at-preset,.at-tab,.at-bar,.at-banner,.hm-card,.hm-join,.pl-radio'").replace(".at-banner-ic')", ".at-banner-ic,.hm-ic,.pl-radio > span:first-child')")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for w, hgt in ((1440, 900), (390, 844)):
            pg = await b.new_page(viewport={'width': w, 'height': hgt})
            await pg.route('https://**', lambda r: r.abort())
            for url in ['index.html', 'play.html', 'atelier.html']:
                await pg.goto('http://127.0.0.1:3000/' + url); await pg.wait_for_timeout(500)
                if url == 'play.html':
                    await pg.set_input_files('input[type=file] >> nth=0', '/home/claude/work/pt.nds'); await pg.wait_for_timeout(1500)
                issues = await pg.evaluate(AUDIT)
                await pg.screenshot(path=f'/home/claude/work/audit_{w}_{url[:-5]}.png', full_page=True)
                print(w, url, len(issues), issues[:5])
        await b.close()
asyncio.run(main())
