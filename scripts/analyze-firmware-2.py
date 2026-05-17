"""
Find code references to 'err pack data len' and inspect surrounding bytes
for length-validation logic.
"""
from pathlib import Path
import struct

BIN = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin")
DATA = BIN.read_bytes()

# Firmware in flash starts at 0x00000 in the file. Many ARM firmwares are linked
# to load at a non-zero base address (e.g. 0x00010000 for the application section
# after bootloader). The string offsets we found are file offsets — but pointers
# in the .text section are LINKED addresses. Try a few common base offsets.
err_pack_file_off = 0x2BC88

print(f"err_pack file offset: 0x{err_pack_file_off:x}")
print()

# Find the bootloader / application split. The file is 498048 bytes total.
# Common F2X16 layout: bootloader at 0, application at 0x10000+, but we have a
# single combined image. Look for vector tables / reset vectors.
# Print first 16 bytes to see if it's a Cortex-M vector table.
print("first 32 bytes (vector table?):")
print(" ", DATA[:32].hex(' '))
print()

# Cortex-M boots from offset 0; first 4 bytes = initial SP, next 4 = reset handler.
sp = struct.unpack("<I", DATA[:4])[0]
rh = struct.unpack("<I", DATA[4:8])[0]
print(f"  initial SP : 0x{sp:08x}")
print(f"  reset hand : 0x{rh:08x}")
print()

# If reset handler points to 0x00xxxxxx, code is loaded at 0x00000000.
# If it points to e.g. 0x08020000+, code is at flash base 0x08000000.
# Try multiple base candidates and search for the error string pointer.
candidates = [0x00000000, 0x00010000, 0x00020000, 0x08000000, 0x08010000, 0x10000000, 0x20000000]
for base in candidates:
    target = base + err_pack_file_off
    needle = struct.pack("<I", target)
    refs = []
    pos = 0
    while True:
        i = DATA.find(needle, pos)
        if i < 0: break
        refs.append(i)
        pos = i + 4
    if refs:
        print(f"  base 0x{base:08x}  target=0x{target:08x}  refs found: {len(refs)} at {[hex(r) for r in refs]}")
print()

# The most likely base is whatever resolves the reset vector to a valid address
# AND gives a hit when searching for the string pointer. Let's try base = 0.
# Pointer to the string in code would be 0x0002BC88 LE = 88 BC 02 00.
needle = struct.pack("<I", err_pack_file_off)
refs = []
pos = 0
while True:
    i = DATA.find(needle, pos)
    if i < 0: break
    refs.append(i)
    pos = i + 4
print(f"refs to file-offset 0x{err_pack_file_off:x} (assuming base 0): {len(refs)}")
for r in refs:
    print(f"  ref @ 0x{r:06x}    surrounding bytes:")
    print(f"    [0x{r-32:06x}..0x{r+32:06x}]: {DATA[max(0,r-32):r+32].hex(' ')}")
print()

# Let's also try common ARM Thumb literal pool patterns. PC-relative LDR
# often uses small offsets. The format string pointer appears in a literal
# pool somewhere in the .text. Pointer value will usually be the linked addr.
# If reset_handler_addr & 0x0000FFFF is the file offset of the reset handler,
# then BASE = reset_handler_addr & 0xFFFF0000.
likely_base = rh & 0xFFFF0000
likely_target = likely_base + err_pack_file_off
print(f"likely base from reset handler: 0x{likely_base:08x}")
print(f"likely target ptr: 0x{likely_target:08x}")
needle = struct.pack("<I", likely_target)
refs = []
pos = 0
while True:
    i = DATA.find(needle, pos)
    if i < 0: break
    refs.append(i)
    pos = i + 4
print(f"refs found: {len(refs)} at {[hex(r) for r in refs[:10]]}")
print()

# Show wider context around any code refs we found.
for r in refs[:5]:
    code_start = max(0, r - 0x40)
    code_end = min(len(DATA), r + 0x40)
    chunk = DATA[code_start:code_end]
    print(f"=== context around code ref @ 0x{r:06x} ===")
    print(f"   bytes (-{r-code_start:+d}..+{code_end-r-4:+d}):")
    # 16 bytes per row
    for i in range(0, len(chunk), 16):
        line = chunk[i:i+16]
        addr = code_start + i
        hex_part = ' '.join(f'{b:02x}' for b in line)
        ascii_part = ''.join(chr(b) if 0x20<=b<0x7f else '.' for b in line)
        marker = ' <-- ptr' if code_start+i <= r < code_start+i+4 else ''
        print(f"  0x{addr:06x}  {hex_part:<48} |{ascii_part}|{marker}")
    print()
