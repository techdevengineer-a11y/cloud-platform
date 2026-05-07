"use client";
import { useEffect, useRef, useState } from "react";

const WS_URL = (typeof window !== "undefined")
  ? `ws://${window.location.hostname}:10001`
  : "";

type WsEvent =
  | { type: "live_devices"; devices: string[] }
  | { type: "device_online"; deviceCode: string; remote: string; ts: number }
  | { type: "device_offline"; deviceCode: string; ts: number }
  | { type: "device_heartbeat"; deviceCode: string; ts: number }
  | { type: "tcp_connect"; remote: string; ts: number }
  | { type: "tcp_disconnect"; remote: string; ts: number }
  | { type: "tcp_data"; remote: string; deviceCode: string | null; kind: string; hex: string; ts: number }
  | { type: "config_pushed"; deviceCode: string; ts: number }
  | { type: "push_result"; deviceCode: string; ok: boolean; reason?: string; bytes?: number };

export function useWebSocket(onEvent?: (ev: WsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const [liveDevices, setLiveDevices] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const callbackRef = useRef(onEvent);

  useEffect(() => { callbackRef.current = onEvent; });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let ws: WebSocket | null = null;
    let retry: any = null;
    let stopped = false;

    function connect() {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();

      ws.onmessage = (e) => {
        try {
          const msg: WsEvent = JSON.parse(e.data);
          if (msg.type === "live_devices") {
            setLiveDevices(new Set(msg.devices));
          } else if (msg.type === "device_online") {
            setLiveDevices((prev) => new Set(prev).add(msg.deviceCode));
          } else if (msg.type === "device_offline") {
            setLiveDevices((prev) => { const n = new Set(prev); n.delete(msg.deviceCode); return n; });
          }
          callbackRef.current?.(msg);
        } catch {}
      };
    }
    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  function send(msg: any) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  return { connected, liveDevices, send };
}
