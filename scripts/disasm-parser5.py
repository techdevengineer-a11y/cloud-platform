"""
WebMaster mana-packet parser hunt, attempt 5.

base=0 confirmed (adr resolves to file offsets). Parser strings:
  0x2ba1c '[%s:%d]recv cmd =%d'      (L732 in capture)
  0x2bc88 '[%s:%d]err pack data len %d,%d' (L829)
  0x2bc6c '[%s:%d]err date len %d-%d'
  0x2bde3 '[%s:%d]cmd=%d,len=%d'     (L680 send path)
ADR has ~±4KB reach, so the code is ~0x2a000..0x2c800. Resync-disassemble
that range, resolve adr/ldr-literal operands to strings, and dump a context
window around every `bl 0x2c87c` (the global debug printf) so we can read
(file,line,fmt) and the surrounding length validation / struct offsets.
"""
from pathlib import Path
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_LITTLE_ENDIAN

DATA = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin").read_bytes()
md = Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_LITTLE_ENDIAN)
md.detail = True
DBG = 0x2c87c

def cstr(off, m=72):
    e = off
    while e < len(DATA) and e - off < m and 0x20 <= DATA[e] < 0x7f:
        e += 1
    return DATA[off:e].decode("latin1") if e > off else ""

LO, HI = 0x2A000, 0x2C820

# Resync sweep: collect a flat list of decoded instructions.
prog = []
pos = LO
while pos < HI - 1:
    any_ = False
    for ins in md.disasm(DATA[pos:HI], pos):
        any_ = True
        prog.append(ins)
        pos = ins.address + ins.size
    pos += 2
prog.sort(key=lambda i: i.address)
# de-dup overlapping decodes (keep first seen per address)
seen, flat = set(), []
for i in prog:
    if i.address in seen:
        continue
    seen.add(i.address)
    flat.append(i)

def ann(ins):
    if ins.mnemonic == "adr":
        try:
            imm = int(ins.op_str.split("#")[1], 0)
        except Exception:
            return ""
        sign = -1 if ins.op_str.split("#")[1].lstrip().startswith("-") else 1
        tgt = ((ins.address + 4) & ~3) + sign * imm
        s = cstr(tgt)
        return f"   ; ->0x{tgt:06x}" + (f' "{s}"' if s else "")
    if ins.mnemonic.startswith("ldr") and "[pc" in ins.op_str:
        try:
            imm = int(ins.op_str.split("#")[1].rstrip("]"), 0)
        except Exception:
            return ""
        a = ((ins.address + 4) & ~3) + imm
        if 0 <= a + 4 <= len(DATA):
            v = int.from_bytes(DATA[a:a+4], "little")
            s = cstr(v) if 0 <= v < len(DATA) else ""
            return f"   ; [0x{a:06x}]=0x{v:08x}" + (f' "{s}"' if s else "")
    if ins.mnemonic == "bl" and hex(DBG) in ins.op_str:
        return "   ; >>> DBG(fmt,file,line,...)"
    return ""

idx = {ins.address: k for k, ins in enumerate(flat)}
calls = [k for k, ins in enumerate(flat)
         if ins.mnemonic == "bl" and hex(DBG) in ins.op_str]
print(f"decoded {len(flat)} ins in [0x{LO:x},0x{HI:x}]; DBG calls: {len(calls)}\n")

for k in calls:
    a = flat[k].address
    s = max(0, k - 14)
    print(f"--- DBG call @0x{a:06x} ---")
    for j in range(s, min(len(flat), k + 3)):
        ins = flat[j]
        bys = " ".join(f"{x:02x}" for x in DATA[ins.address:ins.address + ins.size])
        print(f"  0x{ins.address:06x}: {bys:<12} {ins.mnemonic:<7} {ins.op_str}{ann(ins)}")
    print()
