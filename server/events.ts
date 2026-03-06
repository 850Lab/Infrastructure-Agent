import type { Response } from "express";
import { toNarrative } from "./narrative";

export type EventType =
  | "STEP_STARTED"
  | "STEP_DONE"
  | "TRIGGER_FIRED"
  | "ERROR"
  | "HEARTBEAT"
  | "RUN_STARTED"
  | "RUN_DONE";

export interface SSEEvent {
  type: EventType;
  payload: Record<string, any>;
  ts: number;
  seq: number;
}

class EventBus {
  private subscribers: Set<Response> = new Set();
  private buffer: SSEEvent[] = [];
  private readonly maxBuffer = 200;
  private seq = 0;

  subscribe(res: Response): void {
    this.subscribers.add(res);
  }

  unsubscribe(res: Response): void {
    this.subscribers.delete(res);
  }

  getRecentEvents(n?: number): SSEEvent[] {
    const count = n ?? this.buffer.length;
    return this.buffer.slice(-count);
  }

  getEventsSince(sinceSeq: number, limit = 50): SSEEvent[] {
    const events = this.buffer.filter((e) => e.seq > sinceSeq);
    return events.slice(-limit);
  }

  publish(type: EventType, payload: Record<string, any>): void {
    const ts = Date.now();
    this.seq++;
    const narrative = toNarrative(type, { ...payload, ts: payload.ts ?? ts });

    const enrichedPayload = {
      ...payload,
      ts: payload.ts ?? ts,
      seq: this.seq,
      raw_type: narrative.raw_type,
      raw_step: narrative.raw_step,
      raw_trigger: narrative.raw_trigger,
      human_title: narrative.human_title,
      human_message: narrative.human_message,
      severity: narrative.severity,
    };

    const event: SSEEvent = { type, payload: enrichedPayload, ts, seq: this.seq };

    if (type !== "HEARTBEAT") {
      this.buffer.push(event);
      if (this.buffer.length > this.maxBuffer) {
        this.buffer = this.buffer.slice(-this.maxBuffer);
      }
    }

    const data = `event: ${type}\ndata: ${JSON.stringify(enrichedPayload)}\n\n`;

    for (const res of this.subscribers) {
      try {
        res.write(data);
      } catch {
        this.subscribers.delete(res);
      }
    }
  }

  sendHeartbeatTo(res: Response): void {
    this.seq++;
    const payload = { ts: Date.now(), seq: this.seq };
    const data = `event: HEARTBEAT\ndata: ${JSON.stringify(payload)}\n\n`;
    try {
      res.write(data);
    } catch {
      this.subscribers.delete(res);
    }
  }

  getCurrentSeq(): number {
    return this.seq;
  }
}

export const eventBus = new EventBus();
