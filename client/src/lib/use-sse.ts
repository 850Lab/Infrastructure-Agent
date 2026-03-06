import { useState, useEffect, useRef, useCallback } from "react";

export interface SSEEvent {
  type: string;
  payload: Record<string, any>;
  receivedAt: number;
}

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

export interface SSEState {
  recentEvents: SSEEvent[];
  activeNodes: Set<string>;
  runStatus: "standby" | "running" | "error";
  eventRate: number;
  lastRunId: string | null;
  connected: boolean;
  connectionStatus: ConnectionStatus;
}

const HEARTBEAT_INTERVAL = 15000;
const HEARTBEAT_MISS_THRESHOLD = 2;
const MAX_RETRY_DELAY = 30000;
const INITIAL_RETRY_DELAY = 1000;

export function useSSE(token: string | null): SSEState {
  const [recentEvents, setRecentEvents] = useState<SSEEvent[]>([]);
  const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set());
  const [runStatus, setRunStatus] = useState<"standby" | "running" | "error">("standby");
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("offline");
  const [eventRate, setEventRate] = useState(0);

  const eventTimestamps = useRef<number[]>([]);

  const processEvent = useCallback((type: string, payload: Record<string, any>) => {
    const now = Date.now();

    if (type === "HEARTBEAT") return;

    const event: SSEEvent = { type, payload, receivedAt: now };

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
    if (!token) {
      setConnectionStatus("offline");
      return;
    }

    let cancelled = false;
    let retryDelay = INITIAL_RETRY_DELAY;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;
    let lastHeartbeat = 0;
    let lastSeq = 0;
    let seenSeqs = new Set<number>();
    let intentionalClose = false;

    function clearRetryTimer() {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    }

    function clearHeartbeatTimer() {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function teardown() {
      intentionalClose = true;
      clearRetryTimer();
      clearHeartbeatTimer();
      if (es) {
        es.close();
        es = null;
      }
    }

    function scheduleReconnect() {
      clearRetryTimer();
      clearHeartbeatTimer();
      if (cancelled) return;
      setConnectionStatus("reconnecting");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    }

    function handleEvent(type: string, data: string) {
      try {
        const payload = JSON.parse(data);
        const seq = payload.seq as number | undefined;

        if (seq !== undefined) {
          if (seq < lastSeq && seq < 10) {
            seenSeqs = new Set();
            lastSeq = 0;
          }

          if (seenSeqs.has(seq)) return;
          seenSeqs.add(seq);
          if (seenSeqs.size > 300) {
            const arr = Array.from(seenSeqs).sort((a, b) => a - b);
            seenSeqs = new Set(arr.slice(-200));
          }
          if (seq > lastSeq) lastSeq = seq;
        }

        if (type === "HEARTBEAT") {
          lastHeartbeat = Date.now();
          return;
        }

        processEvent(type, payload);
      } catch {}
    }

    function connect() {
      if (cancelled) return;
      teardownCurrentConnection();

      intentionalClose = false;
      const url = lastSeq > 0
        ? `/api/events?token=${encodeURIComponent(token!)}&since_seq=${lastSeq}`
        : `/api/events?token=${encodeURIComponent(token!)}`;

      es = new EventSource(url);

      es.onopen = () => {
        if (cancelled) return;
        setConnectionStatus("connected");
        retryDelay = INITIAL_RETRY_DELAY;
        lastHeartbeat = Date.now();
        startHeartbeatMonitor();
      };

      const eventTypes = ["STEP_STARTED", "STEP_DONE", "TRIGGER_FIRED", "ERROR", "HEARTBEAT", "RUN_STARTED", "RUN_DONE"];
      for (const type of eventTypes) {
        es.addEventListener(type, (e: MessageEvent) => {
          handleEvent(type, e.data);
        });
      }

      es.onerror = () => {
        if (intentionalClose || cancelled) return;
        if (es) {
          es.close();
          es = null;
        }
        scheduleReconnect();
      };
    }

    function teardownCurrentConnection() {
      intentionalClose = true;
      clearHeartbeatTimer();
      if (es) {
        es.close();
        es = null;
      }
    }

    function startHeartbeatMonitor() {
      clearHeartbeatTimer();
      heartbeatTimer = setInterval(() => {
        if (cancelled) {
          clearHeartbeatTimer();
          return;
        }
        const elapsed = Date.now() - lastHeartbeat;
        const missedBeats = Math.floor(elapsed / HEARTBEAT_INTERVAL);

        if (missedBeats >= HEARTBEAT_MISS_THRESHOLD && es) {
          teardownCurrentConnection();
          scheduleReconnect();
        }
      }, HEARTBEAT_INTERVAL);
    }

    connect();

    return () => {
      cancelled = true;
      teardown();
      setConnectionStatus("offline");
    };
  }, [token, processEvent]);

  const connected = connectionStatus === "connected";

  return { recentEvents, activeNodes, runStatus, eventRate, lastRunId, connected, connectionStatus };
}
