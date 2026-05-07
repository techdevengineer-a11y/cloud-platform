/**
 * Config safety system — risk classification, validation, and rollback rules.
 *
 * Every field that the cloud can write to a device is tagged with a risk
 * level so the UI can warn appropriately and the API can reject dangerous
 * values before they leave the cloud.
 *
 *   safe     – tweakable any time, no connectivity impact
 *   caution  – could degrade service if wrong (recoverable via reboot/web UI)
 *   critical – could lock the device out of remote management
 */
export type Risk = "safe" | "caution" | "critical";

export const FIELD_RISK: Record<string, Risk> = {
  // workMode
  "workMode.workAgreement":     "critical",
  "workMode.clientId":          "caution",
  "workMode.username":          "caution",
  "workMode.password":          "caution",
  "workMode.takeOverTopic":     "caution",
  "workMode.sendTopic":         "caution",
  "workMode.heartbeatInterval": "caution",
  "workMode.heartbeatString":   "safe",
  "workMode.reportInterval":    "safe",
  "workMode.batchReportsNum":   "safe",
  "workMode.dataCache":         "safe",
  "workMode.debugLevel":        "safe",
  "workMode.clearSerialCache":  "safe",
  "workMode.productKey":        "safe",

  // centralServer
  "centralServer.serverIp":         "critical",
  "centralServer.serverPort":       "critical",
  "centralServer.protocol":         "critical",
  "centralServer.backupServerIp":   "caution",
  "centralServer.backupServerPort": "caution",

  // wirelessDialing — careful, this is the cellular link
  "wirelessDialing.dialNumber":        "critical",
  "wirelessDialing.apn":               "critical",
  "wirelessDialing.username":          "caution",
  "wirelessDialing.password":          "caution",
  "wirelessDialing.netMode":           "critical",
  "wirelessDialing.findNetMode":       "caution",
  "wirelessDialing.pppCert":           "caution",
  "wirelessDialing.pppRedialInterval": "safe",
  "wirelessDialing.redialsMaxNumber":  "safe",
  "wirelessDialing.primaryDns":        "caution",
  "wirelessDialing.prepareDns":        "safe",

  // globalParameters
  "globalParameters.pppLayerDetection": "caution",
  "globalParameters.dataFrameInterval": "safe",
  "globalParameters.mtuLength":         "caution",
  "globalParameters.resWait":           "safe",
  "globalParameters.maxResTimes":       "safe",
  "globalParameters.aftFail":           "caution",
  "globalParameters.waitFail":          "safe",
  "globalParameters.smsCenter":         "safe",
  "globalParameters.heartbeatInterval": "caution",
  "globalParameters.modbusDeviceNo":    "safe",

  // deviceManager
  "deviceManager.managerPlatform":  "critical",
  "deviceManager.platformId":       "critical",
  "deviceManager.transferProtocol": "critical",
  "deviceManager.serverIp":         "critical",
  "deviceManager.port":             "critical",
  "deviceManager.ntpInterval":      "safe",
  "deviceManager.ntpServer":        "safe",

  // serialPort, ioApp, smsSettings, otherParameters, gpsSettings, modbusConfiguration
  // serial baud / mode is caution (breaks PLC link)
  "serialPort.rs232_1.ipr":     "caution",
  "serialPort.rs232_1.serMode": "caution",
  "serialPort.rs232_1.bindCnt": "caution",
  "serialPort.rs232_2.ipr":     "caution",
  "serialPort.rs232_2.serMode": "caution",
  "serialPort.rs232_2.bindCnt": "caution",
  "serialPort.rs485.ipr":       "caution",
  "serialPort.rs485.serMode":   "caution",
  "serialPort.rs485.bindCnt":   "caution",
  "serialPort.gps.ipr":         "safe",
  "serialPort.gps.serMode":     "safe",
  "serialPort.gps.bindCnt":     "safe",

  "otherParameters.webPort":        "critical",
  "otherParameters.webUsername":    "caution",
  "otherParameters.webPassword":    "caution",
  "otherParameters.telnetEnabled":  "caution",
  "otherParameters.sshEnabled":     "caution",
};

export function riskOf(path: string): Risk {
  return FIELD_RISK[path] ?? "safe";
}

/** Validators reject obviously broken values before the device ever sees them. */
export type ValidationError = { path: string; message: string };

export function validateConfig(cfg: any): ValidationError[] {
  const errs: ValidationError[] = [];
  const ip = (s: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s);

  // 🚫 Manager Platform Off — locks device out of remote mgmt
  if (cfg.deviceManager?.managerPlatform === "Off") {
    errs.push({
      path: "deviceManager.managerPlatform",
      message: "Refused: turning Manager Platform Off would lock you out of this device permanently. To do this, use the device's local web UI.",
    });
  }

  // Server IP must be a valid IP
  if (cfg.deviceManager?.serverIp && !ip(cfg.deviceManager.serverIp)) {
    errs.push({ path: "deviceManager.serverIp", message: "Server IP must be a valid IPv4 address." });
  }
  if (cfg.centralServer?.serverIp && !ip(cfg.centralServer.serverIp)) {
    errs.push({ path: "centralServer.serverIp", message: "Server IP must be a valid IPv4 address." });
  }

  // Port range
  for (const path of ["centralServer.serverPort", "deviceManager.port", "otherParameters.webPort"]) {
    const v = path.split(".").reduce((o: any, k) => o?.[k], cfg);
    if (v !== undefined && (v < 1 || v > 65535)) {
      errs.push({ path, message: `Port must be between 1 and 65535 (got ${v}).` });
    }
  }

  // Heartbeat = 0 → reboot loop
  const hb = cfg.workMode?.heartbeatInterval;
  if (hb !== undefined && hb < 10) {
    errs.push({
      path: "workMode.heartbeatInterval",
      message: "Heartbeat interval below 10s can cause reboot loops. Minimum allowed: 10s.",
    });
  }

  // APN can't be empty
  if (cfg.wirelessDialing && !cfg.wirelessDialing.apn) {
    errs.push({ path: "wirelessDialing.apn", message: "APN cannot be empty — device won't be able to dial cellular." });
  }

  // MTU sane range
  const mtu = cfg.globalParameters?.mtuLength;
  if (mtu !== undefined && (mtu < 576 || mtu > 1500)) {
    errs.push({ path: "globalParameters.mtuLength", message: `MTU should be 576–1500 (got ${mtu}).` });
  }

  return errs;
}

/** Compute path:value diff between two configs. */
export function diffConfig(oldCfg: any, newCfg: any, prefix = ""): Array<{
  path: string; oldValue: any; newValue: any; risk: Risk;
}> {
  const out: any[] = [];
  const keys = new Set([...Object.keys(oldCfg ?? {}), ...Object.keys(newCfg ?? {})]);
  for (const k of keys) {
    const a = oldCfg?.[k];
    const b = newCfg?.[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (a && b && typeof a === "object" && !Array.isArray(a) && typeof b === "object" && !Array.isArray(b)) {
      out.push(...diffConfig(a, b, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ path, oldValue: a, newValue: b, risk: riskOf(path) });
    }
  }
  return out;
}

export const RISK_LABEL: Record<Risk, string> = {
  safe:     "Safe",
  caution:  "Caution",
  critical: "Critical",
};

export const RISK_COLOR: Record<Risk, { bg: string; text: string; border: string; dot: string }> = {
  safe:     { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
  caution:  { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   dot: "bg-amber-500" },
  critical: { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200",     dot: "bg-red-500" },
};
