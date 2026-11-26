import asyncio, json, time, subprocess
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ' ' + m.text[:200])); pg.on('pageerror', lambda e: logs.append('ERR ' + str(e)[:300]))
        await pg.route('https://**', lambda r: r.abort())
        await pg.goto('http://127.0.0.1:3000/index.html'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='/home/claude/work/pl_home.png')
        await pg.goto('http://127.0.0.1:3000/play.html'); await pg.wait_for_timeout(500)
        await pg.set_input_files('input[type=file] >> nth=0', '/home/claude/work/pt.nds'); await pg.wait_for_timeout(1500)
        await pg.set_input_files('input[accept=".sav,.dsv,.srm"]', '/home/claude/work/save/pt.sav'); await pg.wait_for_timeout(500)
        await pg.fill('input[aria-label=Pseudo]', 'Mattia')
        await pg.screenshot(path='/home/claude/work/pl_setup.png')
        t0 = time.time()
        await pg.click('.pl-start .at-btn.primary')
        await pg.wait_for_function('window.PL && window.PL.app', timeout=400000)
        code = (await pg.evaluate('location.search')).split('room=')[1][:6]
        print('jeu lancé en', round(time.time() - t0), 's · room', code, flush=True)
        fr = subprocess.Popen(['node', '/tmp/friend.js', code])
        await pg.wait_for_function('PL.host.frame() > 2600', timeout=600000, polling=500)
        async def key(k, hold=150, after=1300, frames=0):
            f0 = await pg.evaluate('PL.host.frame()')
            await pg.keyboard.down(k)
            await pg.wait_for_function(f'PL.host.frame() >= {f0 + 8}', timeout=60000, polling=30)   # tenue au moins 8 images
            await pg.keyboard.up(k)
            if frames: await pg.wait_for_function(f'PL.host.frame() >= {f0 + frames}', timeout=120000, polling=100)
            else: await pg.wait_for_timeout(after)
        for i in range(16):
            await key('x' if i < 3 else 'z', frames=170 if i < 3 else 90)
            st = await pg.evaluate('PL.game.state()')
            if st and st['field']: print('sur la carte après', i + 1, 'touches', flush=True); break
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path='/home/claude/work/pl_live1.png')
        for k in ['ArrowLeft'] * 2: await key(k, frames=24)
        await key('z', frames=60)
        await pg.screenshot(path='/home/claude/work/pl_live2.png')
        await key('p', frames=120)                                   # sortir son Pokémon
        await pg.screenshot(path='/home/claude/work/pl_live3.png')
        info = await pg.evaluate("({ state: PL.game.state(), peers: [...PL.app.peers.values()].map(p => p.profile && p.profile.name), team: PL.app.me.team.map(m => m.name), perf: PL.app.perf && PL.app.perf.ms / PL.app.perf.n })")
        print('INFO', json.dumps(info, ensure_ascii=False))
        fr.kill()
        print('\n'.join(l for l in logs if ('ERR' in l or 'error' in l) and 'TUNNEL' not in l and 'min.' not in l)[:1500])
        await b.close()
asyncio.run(main())
