"""
Search more carefully for code references to the err_pack format string.
Try multiple base address assumptions and look for any 32-bit value within
+/- 0x100 of the string offset.
"""
from pathlib import Path
import struct, re

BIN = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin")
DATA = BIN.read_bytes()

# Brute-force: scan every 4-byte LE value in the file and count how often we
# see values that look like pointers near our error string offset (0x2BC88).
# That'll help identify the correct base offset.
err_pack = 0x2BC88

print("Brute-force base detection: count 4-byte LE values matching 0x2BC88 + base")
print()
counts = {}
for i in range(0, len(DATA) - 4, 4):
    v = struct.unpack_from("<I", DATA, i)[0]
    # Check if v is in plausible flash range and string offset matches err_pack
    if 0x20000 <= v <= 0x100000:
        base = (v - err_pack) & ~0xFFF  # round down to 4K boundary
        if (v - err_pack) % 4 == 0:
            counts.setdefault(v, 0)
            counts[v] += 1

# A base is likely correct if many strings have pointers to them.
# We'll specifically check err_pack's exact offset.
for base in [0, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000]:
    target = base + err_pack
    needle = struct.pack("<I", target)
    refs = [i for i in range(len(DATA) - 4) if DATA[i:i+4] == needle]
    if refs:
        print(f"  base 0x{base:06x}  target=0x{target:08x}  refs at {[hex(r) for r in refs]}")
print()

# Also look for pointers to ANY string in our cluster (0x2BC23, 0x2BC44, 0x2BC6C, 0x2BC88, 0x2BDE3).
# Whichever base hits multiple of them is the right one.
cluster = [0x2BA1B, 0x2BC23, 0x2BC44, 0x2BC6C, 0x2BC88, 0x2BDE3, 0x2BE00, 0x2BE14]
print("Looking for pointer-cluster matches across base candidates:")
for base in [0, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000, 0x100000]:
    found = []
    for s in cluster:
        target = base + s
        needle = struct.pack("<I", target)
        if needle in DATA:
            found.append(s)
    if len(found) >= 2:
        print(f"  base 0x{base:08x}: {len(found)} matched: {[hex(x) for x in found]}")
print()

# Now look for 32-bit values that fall in [0x2B000, 0x2C000] (the rdata cluster
# containing our error strings, no base assumption).
print("Pointers landing inside [0x2B000, 0x2C000] file range:")
hits = {}
for i in range(0, len(DATA) - 4, 1):
    v = struct.unpack_from("<I", DATA, i)[0]
    if 0x2B000 <= v <= 0x2C000:
        hits.setdefault(v, []).append(i)
print(f"  unique target values: {len(hits)}, with refs at {sum(len(v) for v in hits.values())} sites")
for v in sorted(hits.keys())[:30]:
    print(f"    target=0x{v:06x}  ref count={len(hits[v])}  first ref offsets: {[hex(x) for x in hits[v][:3]]}")
