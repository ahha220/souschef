"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/browser";

export type RobotEvent =
  | { type: "step_complete"; [key: string]: unknown }
  | { type: "photo_ready"; [key: string]: unknown }
  | { type: "kitchen_scan_result"; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

type ConnectionState = "connecting" | "open" | "closed" | "error";

export function useRobotSocket() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("closed");
  const [lastEvents, setLastEvents] = useState<
    { id: string; data: RobotEvent }[]
  >([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      setConnectionState("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setConnectionState("open");
      };

      ws.onerror = () => {
        if (!cancelled) setConnectionState("error");
      };

      ws.onclose = () => {
        if (!cancelled) setConnectionState("closed");
        wsRef.current = null;
        if (!cancelled) {
          reconnectRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onmessage = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data as string) as RobotEvent;
          const id = crypto.randomUUID();
          setLastEvents((prev) => [...prev.slice(-49), { id, data }]);
        } catch {
          /* non-JSON payload — ignore */
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    const w = wsRef.current;
    if (w?.readyState === WebSocket.OPEN) {
      w.send(JSON.stringify(payload));
    }
  }, []);

  return { connectionState, lastEvents, sendJson };
}
