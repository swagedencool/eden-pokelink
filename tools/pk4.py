# Décodage / encodage des Pokémon de 4e génération (format documenté par pret/pokeplatinum).
import struct

ORDER = {}  # index -> positions (A,B,C,D) dans les données stockées
_cases = [(0,1,2,3),(0,1,3,2),(0,2,1,3),(0,3,1,2),(0,2,3,1),(0,3,2,1),(1,0,2,3),(1,0,3,2),(2,0,1,3),(3,0,1,2),(2,0,3,1),(3,0,2,1),
          (1,2,0,3),(1,3,0,2),(2,1,0,3),(3,1,0,2),(2,3,0,1),(3,2,0,1),(1,2,3,0),(1,3,2,0),(2,1,3,0),(3,1,2,0),(2,3,1,0),(3,2,1,0)]
for i, c in enumerate(_cases): ORDER[i] = c
for i in range(24, 32): ORDER[i] = _cases[i - 24]

def crypt(data, seed):
    out = bytearray(data)
    for i in range(0, len(out), 2):
        seed = (seed * 0x41C64E6D + 0x6073) & 0xFFFFFFFF
        v = struct.unpack_from('<H', out, i)[0] ^ (seed >> 16)
        struct.pack_into('<H', out, i, v)
    return bytes(out)

CHARS = {}
for line in open('/home/claude/pokeplatinum/tools/msgenc/charmap.txt', encoding='utf-8'):
    line = line.split('//')[0].rstrip('\n')
    if '=' in line and len(line.split('=')[0].strip()) == 4:
        k, v = line.split('=', 1)
        try: CHARS.setdefault(int(k.strip(), 16), v)
        except ValueError: pass

def text(b):
    s = ''
    for i in range(0, len(b), 2):
        c = struct.unpack_from('<H', b, i)[0]
        if c == 0xFFFF: break
        s += CHARS.get(c, '?')
    return s

NATURES = ['Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky']

def decode(raw):
    """raw : 236 octets (équipe) ou 136 (boîte). Renvoie un dict, ou None si la somme de contrôle est fausse."""
    pid, flags, chk = struct.unpack_from('<IHH', raw, 0)
    blocks = crypt(raw[8:136], chk)
    if sum(struct.unpack('<64H', blocks)) & 0xFFFF != chk: return None
    pos = ORDER[(pid & 0x3E000) >> 13]
    A, B, C, D = (blocks[p * 32:(p + 1) * 32] for p in pos)
    species, item, otid, exp = struct.unpack_from('<HHII', A, 0)
    friendship, ability = A[12], A[13]
    evs = list(A[16:22])
    moves = list(struct.unpack_from('<4H', B, 0)); pp = list(B[8:12]); ppup = list(B[12:16])
    ivw = struct.unpack_from('<I', B, 16)[0]
    ivs = [(ivw >> (5 * i)) & 31 for i in range(6)]
    gender = (B[0x18] >> 1) & 3; form = B[0x18] >> 3
    m = dict(pid=pid, species=species, item=item, otid=otid, exp=exp, friendship=friendship, ability=ability,
             evs=evs, ivs=ivs, moves=moves, pp=pp, ppup=ppup, isEgg=(ivw >> 30) & 1, hasNick=(ivw >> 31) & 1,
             gender=gender, form=form, nature=NATURES[pid % 25], nickname=text(C[0:22]), ot=text(D[0:16]),
             shiny=((otid & 0xFFFF) ^ (otid >> 16) ^ (pid & 0xFFFF) ^ (pid >> 16)) < 8)
    if len(raw) >= 236:
        P = crypt(raw[136:236], pid)
        status, level = struct.unpack_from('<IB', P, 0)
        hp, maxhp, atk, df, spe, spa, spd = struct.unpack_from('<7H', P, 6)
        m.update(status=status, level=level, hp=hp, maxhp=maxhp, stats=[maxhp, atk, df, spa, spd, spe])
    return m

def set_party_hp(raw, hp, status=None):
    """Réécrit les PV (et le statut) d'un Pokémon d'équipe : déchiffre, modifie, rechiffre (clé = PID)."""
    pid = struct.unpack_from('<I', raw, 0)[0]
    P = bytearray(crypt(raw[136:236], pid))
    struct.pack_into('<H', P, 6, hp)
    if status is not None: struct.pack_into('<I', P, 0, status)
    return raw[:136] + crypt(bytes(P), pid)

def set_level_exp(raw, level, exp):
    """Change le niveau (données d'équipe) et l'EXP (bloc A) d'un Pokémon d'équipe, somme de contrôle recalculée."""
    pid, flags, chk = struct.unpack_from('<IHH', raw, 0)
    blocks = bytearray(crypt(raw[8:136], chk))
    pos = ORDER[(pid & 0x3E000) >> 13]
    struct.pack_into('<I', blocks, pos[0] * 32 + 8, exp)
    chk = sum(struct.unpack('<64H', bytes(blocks))) & 0xFFFF
    head = bytearray(raw[:8]); struct.pack_into('<H', head, 6, chk)
    P = bytearray(crypt(raw[136:236], pid)); P[4] = level
    return bytes(head) + crypt(bytes(blocks), chk) + crypt(bytes(P), pid)
