import sys, json, asyncio
from playwright.async_api import async_playwright

SCENES = sys.argv[1].split(',') if len(sys.argv) > 1 and sys.argv[1] else None

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--force-color-profile=srgb'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720}, device_scale_factor=2)
        logs = []
        pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append('ERR ' + str(e)))
        await pg.goto('http://127.0.0.1:8765/preview/gallery.html')
        await pg.wait_for_function("document.title==='ready' || document.title==='error'", timeout=90000)
        if await pg.title() == 'error':
            print('BOOT ERROR', await pg.evaluate('window.__err')); return
        names = SCENES or await pg.evaluate('Object.keys(G.scenes)')
        total = 0
        for n in names:
            await pg.evaluate(f'G.run({json.dumps(n)})')
            await pg.wait_for_timeout(120)
            issues = await pg.evaluate('G.audit()')
            total += len(issues)
            print(f'== {n}: {len(issues)} problème(s)')
            for i in issues[:25]: print('   ', i['type'], '|', i['el'], '|', i['detail'])
            await pg.screenshot(path=f'/home/claude/work/gal_{n}.png')
        print('TOTAL', total, '| console:', [l for l in logs if '404' not in l][:8])
        await b.close()

asyncio.run(main())
