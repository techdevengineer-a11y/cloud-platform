/**
 * Round-trip test for the mgmt-frame parser/builder against captured bytes.
 * Run: npx tsx scripts/test-mgmt-frame.ts
 */
import {
  parseMgmtFrame,
  buildShortMgmtFrame,
  bcdEncodeManaId,
  bcdDecodeManaId,
  crc16Modbus,
  MgmtCmd,
} from "../lib/protocol";

let failed = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. Captured cmd=1 empty probe (device → cloud)
//    7E 0A 00 00 01 99 99 99 98 00 00 FE 6D 7E
// ---------------------------------------------------------------------------
const probe = Buffer.from("7E0A0000019999999800 00FE6D7E".replace(/\s/g, ""), "hex");
const probeFrame = parseMgmtFrame(probe);
if (!probeFrame || probeFrame.kind !== "short") {
  console.log("✗ parse cmd=1 probe — got null or wrong kind");
  failed++;
} else {
  expect("probe cmd",     probeFrame.cmd, 1);
  expect("probe manaId",  probeFrame.manaId, "99999998");
  expect("probe payload", probeFrame.payload.length, 0);
  expect("probe rawLen",  probeFrame.raw.length, 14);
}

// ---------------------------------------------------------------------------
// 2. Captured LS ACK (cloud → device, cmd=2 login ACK)
//    7E 0C 00 00 02 99 99 99 98 02 00 4C 53 E0 38 7E
// ---------------------------------------------------------------------------
const lsCaptured = Buffer.from("7E0C00000299999998 0200 4C53 E038 7E".replace(/\s/g, ""), "hex");
const lsParsed = parseMgmtFrame(lsCaptured);
if (!lsParsed || lsParsed.kind !== "short") {
  console.log("✗ parse LS ACK — got null or wrong kind");
  failed++;
} else {
  expect("ls cmd",     lsParsed.cmd, 2);
  expect("ls manaId",  lsParsed.manaId, "99999998");
  expect("ls payload", lsParsed.payload.toString("ascii"), "LS");
  expect("ls rawLen",  lsParsed.raw.length, 16);
}

// ---------------------------------------------------------------------------
// 3. Build LS ACK ourselves and confirm it matches the captured bytes
// ---------------------------------------------------------------------------
const lsBuilt = buildShortMgmtFrame(MgmtCmd.Login, "99999998", "LS");
expect("rebuild LS bytes", lsBuilt.toString("hex").toUpperCase(), lsCaptured.toString("hex").toUpperCase());

// ---------------------------------------------------------------------------
// 4. Build the cmd=1 reply we'll send when a device probes us
// ---------------------------------------------------------------------------
const replyPayload = "54.254.49.133\r10000";
const reply = buildShortMgmtFrame(MgmtCmd.ServerAddrSync, "99999998", replyPayload);
const reparsed = parseMgmtFrame(reply);
if (!reparsed || reparsed.kind !== "short") {
  console.log("✗ reparse cmd=1 reply — null or wrong kind");
  failed++;
} else {
  expect("reply cmd",     reparsed.cmd, 1);
  expect("reply manaId",  reparsed.manaId, "99999998");
  expect("reply payload", reparsed.payload.toString("ascii"), replyPayload);
  // CRC must verify
  const innerStart = 3;
  const innerEnd = reply.length - 3;
  const inner = reply.subarray(innerStart, innerEnd);
  const crcOnWire = reply.readUInt16LE(innerEnd);
  expect("reply CRC matches Modbus(inner)", crcOnWire, crc16Modbus(inner));
  // Frame envelope sanity
  expect("reply starts with 7E",  reply[0], 0x7E);
  expect("reply ends with 7E",    reply[reply.length - 1], 0x7E);
}
console.log(`reply on wire: ${reply.toString("hex").toUpperCase().match(/../g)!.join(" ")}`);

// ---------------------------------------------------------------------------
// 5. BCD round-trip
// ---------------------------------------------------------------------------
expect("BCD encode 99999998", bcdEncodeManaId("99999998").toString("hex").toUpperCase(), "99999998");
expect("BCD decode 99999998", bcdDecodeManaId(Buffer.from([0x99, 0x99, 0x99, 0x98])), "99999998");
expect("BCD encode pads",     bcdEncodeManaId("12345").toString("hex").toUpperCase(), "00012345");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll assertions passed.`);
