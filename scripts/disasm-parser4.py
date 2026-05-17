"""
Disassemble the WebMaster long-frame parser (found at ~0x2e3xx-0x2e7xx via the
line-367 'pSrc' debug call) and resolve every adr/ldr-literal string operand.

base = 0 (ADR is pc-relative & base-independent anyway). The debug call is
`bl 0x2c87c` with args (r0=fmt, r1=file, r2=line, r3=arg, [sp]=more).
Mapping known capture lines:
  367 pSrc | 378 get cmd | 388 cmd ret | 680 cmd=,len= | 732 recv cmd
  829 err pack data len
"""
from pathlib import Path
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_LITTLE_ENDIAN

BIN = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin")
DATA = BIN.read_bytes()

md = Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_LITTLE_ENDIAN)
md.detail = True

def cstr(off, maxlen=64):
    e = off
    while e < len(DATA) and e - off < maxlen and 0x20 <= DATA[e] < 0x7f:
        e += 1
    return DATA[off:e].decode("latin1")

def resolve_adr(ins):
    # adr rX, #imm  -> (align(pc+4,4)) +/- imm ; capstone gives op_str "rX, #0xNNN"
    try:
        imm = int(ins.op_str.split("#")[1], 0)
    except Exception:
        return None
    base = (ins.address + 4) & ~3
    return base + imm

def resolve_ldr_lit(ins):
    # ldr rX, [pc, #imm]  -> word at align(pc+4,4)+imm
    if "[pc" not in ins.op_str:
        return None
    try:
        imm = int(ins.op_str.split("#")[1].rstrip("]"), 0)
    except Exception:
        return None
    a = ((ins.address + 4) & ~3) + imm
    if 0 <= a + 4 <= len(DATA):
        return ("lit", int.from_bytes(DATA[a:a+4], "little"), a)
    return None

START, END = 0x2E200, 0x2E760
print(f"=== WebMaster long-frame parser  [0x{START:06x}..0x{END:06x}] ===\n")
for ins in md.disasm(DATA[START:END], START):
    bys = " ".join(f"{x:02x}" for x in DATA[ins.address:ins.address + ins.size])
    note = ""
    if ins.mnemonic == "adr":
        tgt = resolve_adr(ins)
        if tgt is not None:
            note = f"   ; -> 0x{tgt:06x} \"{cstr(tgt)}\""
    elif ins.mnemonic.startswith("ldr") and "[pc" in ins.op_str:
        r = resolve_ldr_lit(ins)
        if r:
            _, v, a = r
            s = cstr(v) if 0 <= v < len(DATA) else ""
            note = f"   ; [0x{a:06x}]=0x{v:08x}" + (f" \"{s}\"" if s else "")
    elif ins.mnemonic in ("movw", "movs", "mov") and ", #" in ins.op_str:
        try:
            imm = int(ins.op_str.split(", #")[1], 0)
            if imm in (367, 378, 388, 680, 732, 829, 246, 247):
                note = f"   ; <== __LINE__ {imm}"
        except Exception:
            pass
    elif ins.mnemonic == "bl" and "0x2c87c" in ins.op_str:
        note = "   ; >>> debug printf"
    print(f"  0x{ins.address:06x}: {bys:<12} {ins.mnemonic:<7} {ins.op_str}{note}")
