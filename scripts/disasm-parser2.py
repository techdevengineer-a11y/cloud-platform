"""
Locate the WebMaster mana-packet parser via literal-pool pointers to its
debug strings, then disassemble the function body to read the length math
and the 11-byte field offset.
"""
from pathlib import Path
import struct
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_LITTLE_ENDIAN

BIN = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin")
DATA = BIN.read_bytes()
N = len(DATA)

STRS = {
    0x2ba1c: "recv cmd =%d",
    0x2bc23: "mana buf err 0x%X",
    0x2bc44: "mana buf err crc",
    0x2bc6c: "err date len %d-%d",
    0x2bc88: "err pack data len %d,%d",
    0x2bde3: "cmd=%d,len=%d (send)",
    0x2be00: "dtu send massage",
    0x2be30: "dtu_mana_packet_data",
    0x2294c: "WebMaster.c (path)",
    0x709ef: "WebMaster.c",
    0x229a4: "WebProcessRemoteCmd",
}

def find_le32(val):
    needle = struct.pack("<I", val)
    out, p = [], 0
    while True:
        i = DATA.find(needle, p)
        if i < 0:
            break
        out.append(i)
        p = i + 1
    return out

print("=== literal-pool pointers to parser strings (base=0) ===")
pool = {}
for addr, name in STRS.items():
    refs = find_le32(addr)
    if refs:
        print(f"  0x{addr:06x} {name:<26} <- refs at {[hex(r) for r in refs]}")
        for r in refs:
            pool[r] = (addr, name)
    else:
        print(f"  0x{addr:06x} {name:<26} <- (no le32 literal)")
print()

# Also try a non-zero base in case rodata is linked higher than file offset.
for base in (0x10000, 0x20000, 0x40000, 0x60000, 0x08000000):
    hits = sum(len(find_le32(a + base)) for a in STRS)
    if hits:
        print(f"  base 0x{base:08x}: {hits} pointer hits across the string set")
print()

md = Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_LITTLE_ENDIAN)
md.detail = True

def disasm_window(lit_off, name):
    """A literal pool sits AFTER the function code that uses it (PC-relative,
    forward reference, small positive offset). Disassemble the ~0x140 bytes
    of code preceding the literal pool."""
    start = max(0, (lit_off - 0x160) & ~1)
    end = lit_off + 8
    print(f"=== code before literal pool @0x{lit_off:06x}  (-> {name}) "
          f"[0x{start:06x}..0x{end:06x}] ===")
    for ins in md.disasm(DATA[start:end], start):
        b = " ".join(f"{x:02x}" for x in DATA[ins.address:ins.address + ins.size])
        print(f"  0x{ins.address:06x}: {b:<12} {ins.mnemonic:<7} {ins.op_str}")
    print()

for r, (addr, name) in sorted(pool.items()):
    if name in ("err pack data len %d,%d", "recv cmd =%d", "err date len %d-%d",
                "mana buf err crc", "cmd=%d,len=%d (send)"):
        disasm_window(r, name)
