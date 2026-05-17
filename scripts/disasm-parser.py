"""
Disassemble the WebMaster mana-packet parser to find the 11-byte field that
sits between the 15-digit msg-seq and the AT text in long cmd=7/8 frames.

base = 0x00000000 (RA6M4 code flash; vector table at file offset 0,
reset handler = 0x000246cd → Thumb).

Strategy:
  1. Find every code site that materialises a pointer into the rdata string
     cluster [0x2B000,0x2C200] via Thumb-2 MOVW/MOVT or PC-relative LDR.
  2. Flag the ones referencing the parser's own format strings:
       0x2ba1c '[%s:%d]recv cmd =%d'
       0x2bc6c '[%s:%d]err date len %d-%d'
       0x2bc88 '[%s:%d]err pack data len %d,%d'
       0x2bde3 '[%s:%d]cmd=%d,len=%d'   (device send path)
  3. Disassemble a window around each so we can read the length math
     (expecting an immediate compare against 0x2C = 44, per the 2026-05-09
     'err pack data len 41,44' device log).
"""
from pathlib import Path
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_LITTLE_ENDIAN

BIN = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin")
DATA = BIN.read_bytes()

STR_LO, STR_HI = 0x2B000, 0x2C200
TARGETS = {
    0x2ba1c: "recv cmd =%d",
    0x2bc6c: "err date len %d-%d",
    0x2bc88: "err pack data len %d,%d",
    0x2bde3: "cmd=%d,len=%d (send)",
    0x2be30: "dtu_mana_packet_data",
    0x2be00: "dtu send massage",
}

md = Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_LITTLE_ENDIAN)
md.detail = True

# --- pass 1: track MOVW/MOVT register-immediate construction across a linear
# Thumb sweep, and PC-relative LDR literal loads. Record when a built address
# lands in the string cluster. ---
hits = []              # (code_off, reg, addr)

def lit_at(pc, off):
    """value loaded by `ldr rX,[pc,#imm]` — pc is aligned(pc+4)+off"""
    base = (pc + 4) & ~3
    a = base + off
    if 0 <= a + 4 <= len(DATA):
        return int.from_bytes(DATA[a:a+4], "little")
    return None

# Robust resync sweep: capstone stops at the first undecodable halfword
# (data, vector table, literal pools). Restart 2 bytes later and continue
# until the whole image is covered. Track MOVW then a later MOVT to the same
# reg, and PC-relative LDR literals.
pos = 0
N = len(DATA)
last_movw = {}         # reg -> (imm16, code_off)  most recent movw
while pos < N - 1:
    progressed = False
    for ins in md.disasm(DATA[pos:], pos):
        progressed = True
        m, op = ins.mnemonic, ins.op_str
        if m == "movw" and ", #" in op:
            try:
                r, imm = op.split(", #")
                last_movw[r.strip()] = (int(imm, 0) & 0xFFFF, ins.address)
            except Exception:
                pass
        elif m == "movt" and ", #" in op:
            try:
                r, imm = op.split(", #")
                r = r.strip()
                if r in last_movw:
                    lo, lo_off = last_movw[r]
                    v = lo | ((int(imm, 0) & 0xFFFF) << 16)
                    if STR_LO <= v <= STR_HI:
                        hits.append((lo_off, r, v))
            except Exception:
                pass
        elif m == "ldr" and "[pc" in op:
            try:
                reg = op.split(",")[0].strip()
                off = int(op.split("#")[1].rstrip("]"), 0)
                v = lit_at(ins.address, off)
                if v is not None and STR_LO <= v <= STR_HI:
                    hits.append((ins.address, reg, v))
            except Exception:
                pass
        pos = ins.address + ins.size
    if not progressed:
        pos += 2
    else:
        pos += 2  # resync past the halfword that stopped the stream

print(f"address-build sites into [0x{STR_LO:x},0x{STR_HI:x}]: {len(hits)}")
print()

def near(v):
    best = None
    for t in TARGETS:
        if abs(v - t) <= 24:
            if best is None or abs(v - t) < abs(v - best):
                best = t
    return best

for off, reg, v in sorted(hits):
    t = near(v)
    tag = f"  (~ {TARGETS[t]} @0x{t:x}, +{v-t})" if t is not None else ""
    print(f"  code 0x{off:06x}  {reg} <- 0x{v:06x}{tag}")
print()

flagged = [(off, reg, v, near(v)) for off, reg, v in hits if near(v) is not None]

# --- pass 2: disassemble a window around the err_pack / recv_cmd refs ---
def dump(center, back=0xA0, fwd=0x90, label=""):
    start = max(0, (center - back) & ~1)
    print(f"=== window {label} around 0x{center:06x}  [0x{start:06x}..0x{center+fwd:06x}] ===")
    for ins in md.disasm(DATA[start:center+fwd], start):
        mark = "  <==" if abs(ins.address - center) < 2 else ""
        print(f"  0x{ins.address:06x}: {ins.mnemonic:<8} {ins.op_str}{mark}")
    print()

seen = set()
for off, reg, v, t in flagged:
    if TARGETS[t] in ("err pack data len %d,%d", "recv cmd =%d", "err date len %d-%d"):
        key = off & ~0x3F
        if key in seen:
            continue
        seen.add(key)
        dump(off, label=TARGETS[t])
