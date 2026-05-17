// Verify buildLongMgmtFrame LEN math against the two real-cloud capture frames
// (New folder/New Text Document.txt): small inner LEN=0x005A(90), big=0x01DC(476).
import { buildLongMgmtFrame, parseMgmtFrame } from "../lib/protocol";

const CR = "\r";
const q = (keys: string[]) => keys.map((k) => `AT+${k}?${CR}`).join("");

const small = q(["ENCODEHEXSMS", "HEXSMS", "DEBUG", "SERHC"]);
const fs = buildLongMgmtFrame(small, { msgSeq: "205573397880344", cmd: 8, deviceCode: "11993345" });
const LS = fs.readUInt16LE(1);
console.log(`small: wire=${fs.length} LEN=0x${LS.toString(16)}(${LS})  expect wire=94 LEN=0x5a(90): ${fs.length === 94 && LS === 0x5a ? "PASS" : "FAIL"}`);

const ps: any = parseMgmtFrame(fs);
console.log(`parse: kind=${ps.kind} cmd=${ps.cmd} mana=${ps.manaId} seq=${ps.msgSeq} cust=${ps.sessionCustomerId}`);
console.log(`atText roundtrip: ${ps.atText === small ? "PASS" : "FAIL"}  ${JSON.stringify(ps.atText.slice(0, 40))}`);

const big = q(["PROMODE","IDNT","PHON","STRAIGHT","DEVMODE","TRNPRO","ENHRT","HEXLOGIN","CONNRGST","CONNRGSTREP","LINKRGST","LINKRGSTREP","LPORT","HTTPREQMODE","MQTTCLIENTID","MQTTPRODUCTKEY","MQTTUSERNAME","MQTTREPORPERIOD","MQTTPASSWORD","MQTTBATCHREPORT","MQTTRECVTOPIC","MQTTCACHEEANBLE","MQTTSENDTOPIC","SETHITV","SETHSTR","PHONE1","PHONE2","PHONE3","PHONE4","PHONE5","PHONENOSHOW"]);
const fb = buildLongMgmtFrame(big, { msgSeq: "205573399831114", cmd: 8, deviceCode: "11993345" });
const LB = fb.readUInt16LE(1);
console.log(`big: payload=${big.length} LEN=0x${LB.toString(16)}(${LB})  expect 0x1dc(476): ${LB === 0x1dc ? "PASS" : "FAIL"}`);
