import struct
STRIDE=0x128
def s32(b,o): return struct.unpack_from('<i',b,o)[0]
def find_player_obj(em, loc):
    ram=em.ram(0x02200000, 0x200000)
    for o in range(0, len(ram)-0x128, 4):
        if s32(ram,o+0x64)==loc['x'] and s32(ram,o+0x6C)==loc['z'] and s32(ram,o+0x0C)==loc['map'] \
           and s32(ram,o+0x70)==(loc['x']*16+8)*4096:
            return 0x02200000+o
def read_obj(em, base):
    b=em.ram(base, STRIDE)
    return dict(addr=hex(base), status=struct.unpack_from('<I',b,0)[0], localID=s32(b,8), map=s32(b,0xC), gfx=s32(b,0x10),
                face=s32(b,0x28), x=s32(b,0x64), y=s32(b,0x68), z=s32(b,0x6C),
                px=s32(b,0x70)/4096, py=s32(b,0x74)/4096, pz=s32(b,0x78)/4096)
