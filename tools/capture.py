# Filme la preview : DeSmuME (vrai jeu, ta ROM) piloté frame par frame + la vraie interface dans Chrome.
import sys, os, json, base64, struct, asyncio, subprocess, shutil, time
import numpy as np
sys.path.insert(0, '/home/claude/scripts')
import emu as emu_mod
from emu import Emu, K
from desmume.controls import keymask
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8765/preview/index.html'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/work/preview.mp4'
END_OVERRIDE = int(sys.argv[2]) if len(sys.argv) > 2 else None
STILLS = set(int(x) for x in sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] else set()
SAVE_PTR, OW_OFF = 0x02101F20, 0x1294
ROM_ORIG = '/home/claude/work/pt.nds'

def s32(b, o): return struct.unpack_from('<i', b, o)[0]

class Game:
    def __init__(self):
        self.em = Emu('/home/claude/work/st_cal.dst'); self.em.run(2)
        self.addr = None; self.rom = ROM_ORIG
    def loc(self):
        b = self.em.u32(SAVE_PTR) + OW_OFF
        raw = bytes(self.em.e.memory.unsigned[b:b + 20])
        return dict(map=s32(raw, 0), x=s32(raw, 8), z=s32(raw, 12))
    def find(self, loc):
        ram = np.frombuffer(self.em.ram(0x02200000, 0x200000), dtype='<i4')
        n = len(ram) - 0x80
        x, z = loc['x'], loc['z']
        m = (ram[0x64 // 4:0x64 // 4 + n] == x) & (ram[0x6C // 4:0x6C // 4 + n] == z) \
            & (ram[0x70 // 4:0x70 // 4 + n] == (x * 16 + 8) * 4096) & (ram[0x78 // 4:0x78 // 4 + n] == (z * 16 + 8) * 4096)
        idx = np.nonzero(m)[0]
        return 0x02200000 + int(idx[0]) * 4 if len(idx) else None
    def state(self):
        loc = self.loc()
        if self.addr:
            b = bytes(self.em.e.memory.unsigned[self.addr:self.addr + 0x80])
            ok = abs(s32(b, 0x64) - loc['x']) <= 1 and abs(s32(b, 0x6C) - loc['z']) <= 1 and abs(s32(b, 0x70) / 4096 - (s32(b, 0x64) * 16 + 8)) <= 17
            if not ok: self.addr = None
        if not self.addr:
            self.addr = self.find(loc)
            if not self.addr: return None
        b = bytes(self.em.e.memory.unsigned[self.addr:self.addr + 0x80])
        mb = self.em.e.memory.unsigned.read_short(0x0400006C)   # MASTER_BRIGHT (moteur principal = écran du haut)
        fade = (mb & 0x1F) / 16 if (mb & 0xC000) else 0
        return dict(map=loc['map'], x=s32(b, 0x70) / 4096, y=s32(b, 0x74) / 4096, z=s32(b, 0x78) / 4096,
                    face=s32(b, 0x28), tx=s32(b, 0x64), tz=s32(b, 0x6C), fade=min(fade, 1))
    def screens(self):
        im = self.em.e.screenshot().convert('RGBA')
        raw = im.tobytes()
        return base64.b64encode(raw[:256 * 192 * 4]).decode(), base64.b64encode(raw[256 * 192 * 4:]).decode()
    def set_keys(self, keys):
        m = 0
        for k in keys: m |= keymask(K[k])
        self.em.e.input.keypad_update(m)
    def patch_rom(self, patches):
        # la palette recolorée est écrite dans la ROM « chargée » ; le jeu la relira au prochain chargement de zone
        data = bytearray(open(self.rom, 'rb').read())
        for p in patches:
            for i, (r, g, b) in enumerate(p['colors']):
                if i == 0: continue
                v = (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)
                struct.pack_into('<H', data, p['offset'] + 2 * i, v)
        newrom = '/home/claude/work/pt_live.nds'
        open(newrom, 'wb').write(data)
        st = '/tmp/pl_swap.dst'
        self.em.e.savestate.save_file(st)
        self.em.e.close(); self.em.e.open(newrom); self.em.e.savestate.load_file(st)
        self.rom = newrom

async def main():
    g = Game()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--force-color-profile=srgb'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        logs = []
        pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append('ERR ' + str(e)))
        await pg.goto(URL)
        await pg.wait_for_function("document.title==='ready' || document.title==='error'", timeout=60000)
        if await pg.title() == 'error':
            print('BOOT ERROR', await pg.evaluate('window.__err'), logs); return
        END = END_OVERRIDE or await pg.evaluate('PL.END')
        ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
                               '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
        t0 = time.time(); nshots = 0
        for f in range(1, END + 1):
            keys = await pg.evaluate(f'PL.tick({f})')
            g.set_keys(keys)
            g.em.run(1)
            if f % 2: continue
            s = g.state()
            top, bot = g.screens()
            patches = await pg.evaluate('([f,s,t,b]) => PL.present(f,s,t,b)', [f, s, top, bot])
            if patches: g.patch_rom(patches); print('rom patched at', f, flush=True)
            jpg = await pg.screenshot(type='jpeg', quality=94)
            ff.stdin.write(jpg); nshots += 1
            if f in STILLS: open(f'/home/claude/work/still_{f}.jpg', 'wb').write(jpg)
            if f % 300 == 0: print('frame', f, 'state', s and (s['map'], s['tx'], s['tz'], s['face']), round(time.time() - t0, 1), 's', flush=True)
        ff.stdin.close(); ff.wait()
        print('PERF', json.dumps(await pg.evaluate('PL.perf()')))
        print('LOGS', [l for l in logs if 'favicon' not in l and '404' not in l][:20])
        await b.close()
    print('done', nshots, 'frames')

asyncio.run(main())
