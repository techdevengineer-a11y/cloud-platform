// Default config for a Four-Faith F2816 v4 — matches the screenshots
export const DEFAULT_CONFIG = {
  workMode: {
    workAgreement: "MQTT",
    productKey: "",
    reportInterval: 5,
    batchReportsNum: 1,
    dataCache: "Off",
    clientId: "",
    username: "",
    password: "",
    takeOverTopic: "",
    sendTopic: "",
    heartbeatInterval: 60,
    heartbeatString: "",
    debugLevel: 2,
    clearSerialCache: "Off",
  },
  centralServer: {
    serverIp: "159.138.121.43",
    serverPort: 10000,
    backupServerIp: "",
    backupServerPort: 0,
    protocol: "TCP",
  },
  serialPort: {
    rs232_1: { ipr: 115200, serMode: "8N1", bindCnt: "ALL" },
    rs232_2: { ipr: 115200, serMode: "8N1", bindCnt: "None" },
    rs485:   { ipr: 115200, serMode: "8N1", bindCnt: "ALL" },
    gps:     { ipr: 115200, serMode: "8N1", bindCnt: "None" },
  },
  ioApp: {
    enabled: false,
    digitalInputs: 0,
    digitalOutputs: 0,
    analogInputs: 0,
  },
  wirelessDialing: {
    dialNumber: "*99#",
    apn: "jazz",
    username: "",
    password: "",
    netMode: "AUTO",
    findNetMode: "LTE",
    pppCert: "AUTO",
    pppRedialInterval: 30,
    redialsMaxNumber: 5,
    primaryDns: "8.8.8.8",
    prepareDns: "8.8.4.4",
  },
  globalParameters: {
    pppLayerDetection: "Off",
    dataFrameInterval: 0,
    mtuLength: 1450,
    resWait: 1000,
    maxResTimes: 3,
    aftFail: "Reconnect",
    waitFail: 20,
    smsCenter: "",
    heartbeatInterval: 60,
    modbusDeviceNo: 1,
  },
  smsSettings: {
    smsConfig: "Off",
    phoneNumbers: "",
    smsAck: "Off",
  },
  deviceManager: {
    managerPlatform: "On",
    platformId: "",
    transferProtocol: "TCP",
    serverIp: "159.138.121.43",
    port: 10000,
    ntpInterval: 720,
    ntpServer: "pk.pool.ntp.org",
  },
  otherParameters: {
    webPort: 80,
    webUsername: "admin",
    webPassword: "admin",
    telnetEnabled: false,
    sshEnabled: false,
  },
  gpsSettings: {
    protocolMode: "",
    gpsId: "",
    gpsInterval: 60,
    outputGPRMC: "Not Output",
    outputGPVTG: "Not Output",
    outputGPGGA: "No Output",
    outputGPGSA: "",
    outputGPGSV: "Not Output",
    outputGPGLL: "Not Output",
    gpsCenter: "",
    gpsPort: "",
    gpsMode: "TCP",
  },
  modbusConfiguration: {
    modbusQueryInterval: 3600,
    queryTimeout: 200,
    retryCount: 3,
    devices: [] as Array<{
      deviceEnable: boolean;
      deviceAddress: number;
      functionCode: number;
      registerAddress: number;
      dataType: string;
      decimalPlaces: number;
      bindPort: string;
      tagName: string;
      dataChange: string;
    }>,
  },
};

export type AppConfig = typeof DEFAULT_CONFIG;
