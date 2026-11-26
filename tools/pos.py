SAVE_PTR = 0x02101F20      # Platine FR (CPUF rev0)
OW_OFF   = 0x1294          # FieldOverworldState.player (Location)
def pos(em):
    b = em.u32(SAVE_PTR) + OW_OFF
    s = lambda o: int.from_bytes(em.u32(b+o).to_bytes(4,'little'), 'little', signed=True)
    return dict(map=s(0), warp=s(4), x=s(8), z=s(12), face=s(16))
