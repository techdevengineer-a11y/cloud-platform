import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { FIRMWARE_INFO, SUPPORTED_MODES } from "@/lib/protocol";

export const dynamic = "force-dynamic";

export async function GET() {
  const filePath = path.join(process.cwd(), FIRMWARE_INFO.fileName);
  let onDisk: { exists: boolean; size?: number; sha256?: string; modified?: number } = { exists: false };
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    const buf = fs.readFileSync(filePath);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    onDisk = { exists: true, size: stat.size, sha256, modified: stat.mtimeMs };
  }
  return NextResponse.json({
    info: FIRMWARE_INFO,
    modes: SUPPORTED_MODES,
    onDisk,
    findings: {
      hardware: "Renesas RA6M4 (ARM Cortex-M33), FreeRTOS, lwIP",
      cellularStack: "Quectel-style AT commands (Q*, AT^*)",
      mqttTopicFormat: "sngpl/telemetry/<deviceCode>/data",
      packetStructure: "[length:2 BE][opcode:1][payload:N][crc16:2 Modbus]",
      crcAlgo: "CRC-16/Modbus (poly 0xA001, init 0xFFFF)",
      knownProtocolModes: SUPPORTED_MODES.length,
      otaCommands: ["AT+QFOTADL", "AT+STPUPGRADE", "AT+RMTUPGRADE"],
      bootloader: FIRMWARE_INFO.bootloader,
    },
  });
}
