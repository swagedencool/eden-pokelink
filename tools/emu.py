import os, sys
os.environ.setdefault('SDL_VIDEODRIVER','dummy'); os.environ.setdefault('SDL_AUDIODRIVER','dummy')
from desmume.emulator import DeSmuME
from desmume.controls import Keys, keymask
K = {'A':Keys.KEY_A,'B':Keys.KEY_B,'SELECT':Keys.KEY_SELECT,'START':Keys.KEY_START,'RIGHT':Keys.KEY_RIGHT,
     'LEFT':Keys.KEY_LEFT,'UP':Keys.KEY_UP,'DOWN':Keys.KEY_DOWN,'R':Keys.KEY_R,'L':Keys.KEY_L,'X':Keys.KEY_X,'Y':Keys.KEY_Y}
ROM='/home/claude/work/pt.nds'
class Emu:
    def __init__(self, state=None):
        self.e = DeSmuME()
        self.e.volume_set(0)
        self.e.open(ROM)
        if state: self.e.savestate.load_file(state)
        self.frame = 0
    def run(self, n=1):
        for _ in range(n): self.e.cycle(with_joystick=False); self.frame += 1
    def press(self, key, hold=6, after=10):
        m = keymask(K[key]); self.e.input.keypad_add_key(m); self.run(hold)
        self.e.input.keypad_rm_key(m); self.run(after)
    def hold(self, key, frames):
        m = keymask(K[key]); self.e.input.keypad_add_key(m); self.run(frames); self.e.input.keypad_rm_key(m)
    def touch(self, x, y, frames=6, after=20):
        self.e.input.touch_set_pos(x, y); self.run(frames); self.e.input.touch_release(); self.run(after)
    def shot(self, path): self.e.screenshot().save(path); return path
    def save(self, path): self.e.savestate.save_file(path)
    def u32(self, a): return self.e.memory.unsigned.read_long(a)
    def u16(self, a): return self.e.memory.unsigned.read_short(a)
    def ram(self, start=0x02000000, size=0x400000): return bytes(self.e.memory.unsigned[start:start+size])
