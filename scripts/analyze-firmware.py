"""
Analyze F2X16V4 V1.0.2 firmware for clues about cmd=7/8 long-frame format.
Goal: figure out what 2 bytes are missing from our cmd=8 push.
"""
import re, sys, struct
from pathlib import Path

BIN = Path("E:/duplicate fourfaith/F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin")
DATA = BIN.read_bytes()
print(f"firmware size: {len(DATA)} bytes (0x{len(DATA):x})")
print()

# 1. Extract all printable-ASCII runs >= 4 chars with offsets
def find_strings(data, minlen=4):
    out = []
    cur_start, cur = None, []
    for i, b in enumerate(data):
        if 0x20 <= b < 0x7f:
            if cur_start is None:
                cur_start = i
            cur.append(chr(b))
        else:
            if cur and len(cur) >= minlen:
                out.append((cur_start, ''.join(cur)))
            cur, cur_start = [], None
    if cur and len(cur) >= minlen:
        out.append((cur_start, ''.join(cur)))
    return out

strs = find_strings(DATA, 4)
print(f"total strings (>=4 chars): {len(strs)}")
print()

# 2. Locate the WebMaster.c parser error format strings
TARGET_PATTERNS = [
    r"err pack data len",
    r"mana buf err",
    r"recv cmd",
    r"err date len",
    r"WebMaster\.c",
    r"dtu_mana_packet",
    r"head or tail error",
    r"phone len error",
    r"data len err",
    r"WebProcessRemoteCmd",
    r"recv svr add",
    r"get srv err",
    r"save svr ok",
    r"login info",
    r"customer",
    r"msgseq",
    r"manage_packet",
    r"mng_pack",
]
print("=== Targeted string offsets ===")
for off, s in strs:
    for pat in TARGET_PATTERNS:
        if re.search(pat, s, re.I):
            print(f"  0x{off:06x}  {s!r}")
            break

print()

# 3. Look at the immediate vicinity of the 'err pack data len' error string.
# The compiler usually puts related format strings close together (read-only data section).
# Print 300 bytes of strings around that error.
err_pack = None
for off, s in strs:
    if "err pack data len" in s:
        err_pack = off
        break
if err_pack is not None:
    print(f"=== Strings within 0x300 of err_pack at 0x{err_pack:x} ===")
    for off, s in strs:
        if abs(off - err_pack) <= 0x300:
            marker = "<-- ERR" if off == err_pack else ""
            print(f"  0x{off:06x}  {s!r}  {marker}")
print()

# 4. Search for byte signatures that might be the long-frame prelude/header.
# We expect:
#   - constant 0x7E (frame delimiter)
#   - constant 0x01 (long-frame prelude)
#   - constant 0x0D (CR separator)
# Look for known byte patterns in code that might be these constants used in
# packet construction. Search for "test 0x7e" style instructions on Cortex-M is hard
# without a disassembler — but constants often appear nearby format strings.

# 5. Search for short numeric constants 41, 42, 44, 45, 46 that match the err numbers.
# These would appear as encoded immediates in ARM Thumb (could be hard to find raw),
# but plain bytes might be in lookup tables.

# 6. Look for AT+ command list (the dispatch table) — gives us a sense of what's expected.
print("=== AT command strings (dispatch table candidates) ===")
at_strs = [(off, s) for off, s in strs if s.startswith("AT+")]
print(f"  total AT+ strings: {len(at_strs)}")
# show first 30 sorted by offset
for off, s in sorted(at_strs[:60]):
    print(f"  0x{off:06x}  {s!r}")
print()

# 7. Look for plausible struct sizes / lengths near the error string.
# In ARM Thumb code, immediate values 41, 42, 44 might be encoded as `mov r0, #44`
# or similar. We can scan for the literal bytes 0x29 (=41), 0x2A (=42), 0x2C (=44),
# 0x2E (=46) in the .text section near the error reference. But without a
# disassembler this is noisy.

# Instead, search for ASCII literals that name known long-frame fields.
print("=== Strings mentioning 'cust', 'msg', 'sess', 'tag', 'pack' ===")
for off, s in strs:
    if re.search(r"cust|msg.*seq|sessio?n|head|tail|prelude|tag", s, re.I) and len(s) >= 6:
        print(f"  0x{off:06x}  {s!r}")
