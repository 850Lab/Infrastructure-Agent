import { useState, useEffect, useRef, useCallback } from "react";

export interface SSEEvent {
  type: string;
  payload: Record<string, any>;
  receivedAt: number;
}

export interface SSEState {
  recentEvents: SSEEvent[];
  activeNodes: Set<string>;
  runStatus: "standby" | "running" | "error";
  eventRate: number;
  lastRunId: string | null;
  connected: boolean;
}

export function useSSE(token: string | null): SSEState {
  const [recentEvents, setRecentEvents] = useState<SSEEvent[]>([]);
  const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set());
  const [runStatus, setRunStatus] = useState<"standby" | "running" | "error">("standby");
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [eventRate, setEventRate] = useState(0);

  const eventTimestamps = useRef<number[]>([]);
  const retryDelay = useRef(1000);
  const eventSourceRef = useRef<EventSource | null>(null);

  const processEvent = useCallback((type: string, payload: Record<string, any>) => {
    const now = Date.now();
    const event: SSEEvent = { type, payload, receivedAt: now };

    if (type === "HEARTBEAT") {
      return;
    }

    setRecentEvents((prev) => {
      const next = [...prev, event];
      return next.length > 200 ? next.slice(-200) : next;
    });

    eventTimestamps.current.push(now);
    eventTimestamps.current = eventTimestamps.current.filter((t) => now - t < 10000);
    setEventRate(eventTimestamps.current.length / 10);

    switch (type) {
      case "STEP_STARTED":
        setActiveNodes((prev) => new Set([...prev, payload.step]));
        break;
      case "STEP_DONE":
        setActiveNodes((prev) => {
          const next = new Set(prev);
          next.delete(payload.step);
          return next;
        });
        break;
      case "RUN_STARTED":
        setRunStatus("running");
        setLastRunId(payload.run_id);
        break;
      case "RUN_DONE":
        setActiveNodes(new Set());
        setRunStatus(payload.status === "error" ? "error" : "standby");
        break;
      case "ERROR":
        setRunStatus("error");
        break;
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const es = new EventSource(`/api/events?token=${encodeURIComponent(token!)}`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        retryDelay.current = 1000;
      };

      const eventTypes = ["STEP_STARTED", "STEP_DONE", "TRIGGER_FIRED", "ERROR", "HEARTBEAT", "RUN_STARTED", "RUN_DONE"];
      for (const type of eventTypes) {
        es.addEventListener(type, (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data);
            processEvent(type, payload);
          } catch {}
        });
      }

      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!cancelled) {
          setTimeout(connect, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [token, processEvent]);

  return { recentEvents, activeNodes, runStatus, eventRate, lastRunId, connected };
}
