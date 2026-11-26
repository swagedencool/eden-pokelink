import sys, json; sys.path.insert(0,'/home/claude/scripts')
import numpy as np
from emu import Emu, K; from pos import pos; from mapobj import read_obj
from desmume.controls import keymask
em=Emu('/home/claude/work/st_sv3.dst'); em.run(5)
def find(loc):
    ram=np.frombuffer(em.ram(0x02200000,0x200000),dtype='<i4'); n=len(ram)-0x80; x,z=loc['x'],loc['z']
    m=(ram[0x64//4:0x64//4+n]==x)&(ram[0x6C//4:0x6C//4+n]==z)&(ram[0x70//4:0x70//4+n]==(x*16+8)*4096)
    return 0x02200000+int(np.nonzero(m)[0][0])*4
PB=find(pos(em))
def step(d):
    p=pos(em); em.hold(d,16); em.run(6)
    if (pos(em)['x'],pos(em)['z'])==(p['x'],p['z']): em.hold(d,16); em.run(6)
for _ in range(5): step('LEFT')
em.run(30); print('preroll', pos(em))
log=[]
def tick(n):
    for _ in range(n):
        em.run(1); o=read_obj(em,PB); l=pos(em)
        log.append(dict(map=l['map'],x=o['px'],y=o['py'],z=o['pz'],face=o['face'],tx=o['x'],tz=o['z']))
def hold(d,n):
    m=keymask(K[d]); em.e.input.keypad_add_key(m); tick(n); em.e.input.keypad_rm_key(m)
tick(6); hold('RIGHT',4); tick(6); hold('RIGHT',64); tick(60)
print('end', log[-1], len(log))
json.dump(log, open('/home/claude/eden-pokelink/web/preview/friend-track.json','w'))
