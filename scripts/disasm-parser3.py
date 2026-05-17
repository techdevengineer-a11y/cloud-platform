"""
Find the WebMaster mana-packet parser by its __LINE__ immediates.

From the real-cloud UART capture the parser logs:
  WebMaster.c:732  recv cmd =%d            732 = 0x2DC
  WebMaster.c:680  cmd=%d,len=%d (send)    680 = 0x2A8
  WebMaster.c:367  pSrc = %s               367 = 0x16F
  WebMaster.c:829  err pack data len %d,%d 829 = 0x33D   (from 2026-05-09 log)
  WebMaster.c:378  get cmd %s              378 = 0x17A

The debug macro is `_dbg(file, line, fmt, ...)`, so a `movw rX,#line`
appears within a few instructions of the parser logic. Disassemble a wide
window around each occurrence and print bytes so the length math and the
field offsets between the 15-byte seq and the AT text are visible.
"""
from pathlib import Path
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_LITTLE_ENDIAN

BIN = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin")
DATA = BIN.read_bytes()
N = len(DATA)

LINES = {0x2DC: "L732 recv cmd", 0x2A8: "L680 cmd=,len= send",
         0x16F: "L367 pSrc", 0x33D: "L829 err pack data len",
         0x17A: "L378 get cmd"}

md = Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_LITTLE_ENDIAN)
md.detail = True

# Sweep the whole image (resync past data) and record every `movw rX,#imm`
# whose imm is one of our target line numbers, plus the surrounding context.
sites = []   # (addr, imm)
pos = 0
while pos < N - 1:
    progressed = False
    for ins in md.disasm(DATA[pos:], pos):
        progressed = True
        if ins.mnemonic == "movw" and ", #" in ins.op_str:
            try:
                imm = int(ins.op_str.split(", #")[1], 0)
                if imm in LINES:
                    sites.append((ins.address, imm))
            except Exception:
                pass
        pos = ins.address + ins.size
    pos += 2

print(f"movw-#line sites: {len(sites)}")
for a, imm in sites:
    print(f"  0x{a:06x}  movw _,#0x{imm:x}  ({LINES[imm]})")
print()

def window(center, name, back=0xC0, fwd=0x60):
    start = max(0, (center - back) & ~1)
    end = min(N, center + fwd)
    print(f"=== {name}: 0x{center:06x}  [0x{start:06x}..0x{end:06x}] ===")
    for ins in md.disasm(DATA[start:end], start):
        bys = " ".join(f"{x:02x}" for x in DATA[ins.address:ins.address + ins.size])
        mark = "  <==LINE" if abs(ins.address - center) < 2 else ""
        print(f"  0x{ins.address:06x}: {bys:<12} {ins.mnemonic:<7} {ins.op_str}{mark}")
    print()

for a, imm in sites:
    window(a, LINES[imm])
