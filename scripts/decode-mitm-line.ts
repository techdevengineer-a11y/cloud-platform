/**
 * Decode a captured long cmd=7/8 frame and print every inner field, so the
 * MITM step that resolves the last unknowns (inner[29..32] RESV4, and the
 * inner[34..37]=MANAID confirmation) is a single command.
 *
 * Usage:
 *   npx tsx scripts/decode-mitm-line.ts <hex>
 *   npx tsx scripts/decode-mitm-line.ts ".data/captures/mitm-….log"   # last long frame
 *   <cmd that prints a mitm log line> | npx tsx scripts/decode-mitm-line.ts
 *
 * Accepts a bare hex string, a full mitm log line ("… | ascii | <hex>"),
 * or a path to a mitm log (uses the last CLOUD->DEV long frame in it).
 */
import fs from "node:fs";
import { parseMgmtFrame, bcdDecodeManaId } from "../lib/protocol";

function hexFromLine(s: string): string | null {
  // longest run of hex chars (even length) on the line — mitm puts it last
  const cands = s.match(/[0-9a-fA-F]{2,}/g) ?? [];
  let best = "";
  for (const c of cands) if (c.length % 2 === 0 && c.length > best.length) best = c;
  return best.length >= 86 ? best.toLowerCase() : null;
}

function getInput(): string {
  const arg = process.argv[2];
  let text: string;
  if (arg && fs.existsSync(arg)) {
    const lines = fs.readFileSync(arg, "utf8").split(/\r?\n/);
    const longs = lines.filter((l) => /CLOUD->DEV long/.test(l) && hexFromLine(l));
    if (!longs.length) { console.error("no 'CLOUD->DEV long' line with hex in", arg); process.exit(1); }
    return hexFromLine(longs[longs.length - 1])!;
  }
  if (arg) {
    text = arg;
  } else {
    text = fs.readFileSync(0, "utf8").trim(); // stdin
  }
  const h = /^[0-9a-fA-F]+$/.test(text.replace(/\s/g, ""))
    ? text.replace(/\s/g, "").toLowerCase()
    : hexFromLine(text);
  if (!h) { console.error("could not find a frame hex in input"); process.exit(1); }
  return h;
}

const hex = getInput();
const buf = Buffer.from(hex, "hex");
const b = (lo: number, hi: number) => buf.subarray(lo, hi);
const H = (lo: number, hi: number) => b(lo, hi).toString("hex");

console.log(`frame: ${buf.length} bytes`);
if (buf[0] !== 0x7e) console.log(`!! byte[0]=0x${buf[0].toString(16)} (expected 0x7E)`);
const LEN = buf.readUInt16LE(1);
console.log(`  [0]      7E`);
console.log(`  [1..2]   LEN      = 0x${LEN.toString(16)} (${LEN})   wire-4 = ${buf.length - 4}  ${LEN === buf.length - 4 ? "OK" : "MISMATCH"}`);
console.log(`  [3]      marker   = 0x${buf[3].toString(16)}  ${buf[3] === 1 ? "(long)" : "(NOT 1!)"}`);
console.log(`  [4..15]  custId   = "${b(4, 16).toString("ascii")}"`);
console.log(`  [16]     CR       = 0x${buf[16].toString(16)}  ${buf[16] === 0x0d ? "OK" : "NOT 0x0D!"}`);
console.log(`  [17..31] msgSeq   = "${b(17, 32).toString("ascii")}"`);
console.log(`  [32..35] RESV4    = ${H(32, 36)}   <<< the unknown 4 bytes`);
console.log(`  [36]     CMD      = 0x${buf[36].toString(16)} (${buf[36]})  ${buf[36] === 7 ? "Set" : buf[36] === 8 ? "Read" : "?"}`);
console.log(`  [37..40] MANAID   = ${H(37, 41)}  -> bcd "${bcdDecodeManaId(b(37, 41))}"`);
const plen = buf.readUInt16LE(41);
console.log(`  [41..42] PLEN     = ${plen}   payload-from-framing = ${LEN - 2 - 40}  ${plen === LEN - 2 - 40 ? "OK" : "MISMATCH"}`);
const atEnd = Math.min(43 + plen, buf.length - 3);
console.log(`  [43..]   AT text  = ${JSON.stringify(b(43, atEnd).toString("ascii").slice(0, 120))}${atEnd - 43 > 120 ? "…" : ""}`);
console.log(`  [-3..-2] CRC      = ${H(buf.length - 3, buf.length - 1)} (LE)`);
console.log(`  [-1]     7E       ${buf[buf.length - 1] === 0x7e ? "OK" : "MISSING!"}`);

const p: any = parseMgmtFrame(buf);
console.log(`\nparseMgmtFrame: ${p ? `kind=${p.kind} cmd=${p.cmd} mana=${p.manaId} seq=${p.msgSeq}` : "FAILED"}`);

const r = b(32, 36);
console.log(`\n>>> paste into lib/protocol.ts once confirmed:`);
console.log(`    export let LONG_FRAME_RESV4 = Buffer.from([${[...r].map((x) => "0x" + x.toString(16).padStart(2, "0")).join(", ")}]);`);
console.log(`    // then set LONG_FRAME_LAYOUT_CONFIRMED = true (verify MANAID source matches bcd "${bcdDecodeManaId(b(37, 41))}")`);
