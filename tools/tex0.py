import struct
from PIL import Image
def _dict(b, off, entry_size):
    count = b[off+1]
    # skip header (4) + unknown block (8 + 4*count)
    p = off + 4 + 8 + 4*count
    esz, _ = struct.unpack_from('<HH', b, p); p += 4
    entries = [b[p+i*esz:p+(i+1)*esz] for i in range(count)]
    p += esz*count
    names = [b[p+i*16:p+(i+1)*16].split(b'\0')[0].decode('latin1') for i in range(count)]
    return names, entries
def rgb555(v): return ((v&31)<<3, ((v>>5)&31)<<3, ((v>>10)&31)<<3)
def parse_btx(b):
    assert b[:4]==b'BTX0', b[:4]
    tex0 = struct.unpack_from('<I', b, 0x10)[0]
    t = b[tex0:]
    texInfo = struct.unpack_from('<H', t, 0x0E)[0]
    texData = struct.unpack_from('<I', t, 0x14)[0]
    palInfo = struct.unpack_from('<I', t, 0x34)[0]
    palData = struct.unpack_from('<I', t, 0x38)[0]
    tnames, tents = _dict(t, texInfo, 8)
    pnames, pents = _dict(t, palInfo, 4)
    pals = []
    for e in pents:
        off = (struct.unpack_from('<H', e, 0)[0] << 3) + palData
        pals.append([rgb555(struct.unpack_from('<H', t, off+2*i)[0]) for i in range(256) if off+2*i+2 <= len(t)])
    texs = []
    for name, e in zip(tnames, tents):
        prm = struct.unpack_from('<I', e, 0)[0]
        off = ((prm & 0xFFFF) << 3) + texData
        w = 8 << ((prm >> 20) & 7); h = 8 << ((prm >> 23) & 7); fmt = (prm >> 26) & 7; c0 = (prm >> 29) & 1
        texs.append(dict(name=name, off=off, w=w, h=h, fmt=fmt, c0=c0))
    return t, texs, pals, pnames
def render(t, tx, pal):
    w,h,fmt=tx['w'],tx['h'],tx['fmt']; img=Image.new('RGBA',(w,h)); px=img.load(); o=tx['off']
    for y in range(h):
        for x in range(w):
            i=y*w+x
            if fmt==3: v=(t[o+i//2]>>((i&1)*4))&15
            elif fmt==4: v=t[o+i]
            elif fmt==2: v=(t[o+i//4]>>((i&3)*2))&3
            else: return None
            a = 0 if (v==0 and tx['c0']) else 255
            r,g,bb = pal[v] if v < len(pal) else (255,0,255)
            px[x,y]=(r,g,bb,a)
    return img
