import sys, struct
sys.path.insert(0,'/home/claude/scripts')
import emu as E
from pk4 import decode, set_level_exp
CAP = int(sys.argv[1])          # 0 = pas de plafond
em = E.Emu('/home/claude/work/st_route.dst'); em.run(2)
base = lambda: em.u32(0x02101F20) + 0xB4
def party():
    out = []
    for k in range(6):
        for t in range(6):
            raw = bytes(em.ram(base() + 236 * k, 236))
            d = decode(raw) if (raw[4] & 3) == 0 else None
            if d: break
            em.run(1)
        out.append(d and (d['nickname'], d['level'], d['exp']))
    return out
def patch():
    if CAP and bytes(em.ram(0x022492E8, 4)) == bytes.fromhex('a1210022'):
        for i, v in enumerate([CAP, 0x28, 0x00, 0xD3]): em.e.memory.unsigned[0x022492F0 + i] = v
em.run(1)
for t in range(4):                                   # niveau 60 pour le test (EXP exacte du niveau 60, courbe parabolique)
    raw = bytes(em.ram(base(), 236))
    if decode(raw): break
    em.run(1)
new = set_level_exp(raw, 60, 211060)
for i, v in enumerate(new): em.e.memory.unsigned[base() + i] = v
before = party()
print('avant', before[:2], flush=True)
inb = lambda: bytes(em.ram(0x022492E8, 4)) == bytes.fromhex('a1210022')
for k in ['UP','UP','UP','LEFT','LEFT','LEFT','LEFT','LEFT','LEFT','UP','UP','UP']: em.press(k, 16, 2)
for i in range(200):
    em.press('LEFT' if (i // 3) % 2 else 'RIGHT', 16, 2)
    for f in range(4):
        if inb(): break
        em.run(10)
    if inb(): print('combat sauvage au pas', i, flush=True); break
for i in range(260):
    em.e.input.keypad_update(E.keymask(E.K['A']) if i % 2 == 0 else 0)
    for f in range(12): patch(); em.run(1)
    if i > 30 and bytes(em.ram(0x022492E8, 4)) != bytes.fromhex('a1210022'): print('combat fini au tour', i, flush=True); break
em.e.input.keypad_update(0)
for f in range(400): patch(); em.run(1)
after = party()
print('après', after[:2], flush=True)
em.shot(f'/home/claude/work/cap_{CAP}.png')
