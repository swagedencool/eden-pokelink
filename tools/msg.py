import struct, sys
sys.path.insert(0,'/home/claude/scripts')
from pk4 import CHARS
def decode_bank(b):
    count, key = struct.unpack_from('<HH', b, 0)
    out = []
    for i in range(1, count + 1):
        off, ln = struct.unpack_from('<II', b, 4 + 8 * (i - 1))
        k = (765 * i * key) & 0xFFFF; k |= k << 16
        off ^= k; ln ^= k
        seed = (i * 596947) & 0xFFFF
        s = ''
        for j in range(ln):
            c = struct.unpack_from('<H', b, off + 2 * j)[0] ^ seed
            seed = (seed + 18749) & 0xFFFF
            if c == 0xFFFF: break
            if c == 0xE000: s += '\n'; continue
            if c == 0xFFFE: s += '{}'; continue
            s += CHARS.get(c, '?')
        out.append(s)
    return out
