import type { Response } from "express";
import { toNarrative } from "./narrative";

export type EventType =
  | "STEP_STARTED"
  | "STEP_DONE"
  | "TRIGGER_FIRED"
  | "CALL_ANALYSIS_COMPLETE"
  | "SMS_RECEIVED"
  | "ERROR"
  | "HEARTBEAT"
  | "RUN_STARTED"
  | "RUN_DONE";

export interface SSEEvent {
  type: EventType;
  payload: Record<string, any>;
  ts: number;
  seq: number;
  clientId?: string;
}

interface SubscriberEntry {
  res: Response;
  clientId: string | null;
  isPlatformAdmin: boolean;
}

class EventBus {
  private subscribers: Map<string, SubscriberEntry> = new Map();
  private buffer: SSEEvent[] = [];
  private readonly maxBuffer = 200;
  private seq = 0;
  private subIdCounter = 0;

  subscribe(res: Response, clientId: string | null, isPlatformAdmin: boolean = false): string {
    const subId = `sub_${++this.subIdCounter}`;
    this.subscribers.set(subId, { res, clientId, isPlatformAdmin });
    return subId;
  }

  unsubscribe(subId: string): void {
    this.subscribers.delete(subId);
  }

  unsubscribeByRes(res: Response): void {
    for (const [id, entry] of this.subscribers) {
      if (entry.res === res) {
        this.subscribers.delete(id);
        break;
      }
    }
  }

  getRecentEvents(n?: number, clientId?: string): SSEEvent[] {
    const count = n ?? this.buffer.length;
    let events = this.buffer;
    if (clientId) {
      events = events.filter(e => e.clientId === clientId);
    }
    return events.slice(-count);
  }

  getEventsSince(sinceSeq: number, limit = 50, clientId?: string): SSEEvent[] {
    let events = this.buffer.filter((e) => e.seq > sinceSeq);
    if (clientId) {
      events = events.filter(e => e.clientId === clientId);
    }
    return events.slice(-limit);
  }

  publish(type: EventType, payload: Record<string, any>, clientId?: string): void {
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

    const event: SSEEvent = { type, payload: enrichedPayload, ts, seq: this.seq, clientId };

    if (type !== "HEARTBEAT") {
      this.buffer.push(event);
      if (this.buffer.length > this.maxBuffer) {
        this.buffer = this.buffer.slice(-this.maxBuffer);
      }
    }

    const data = `event: ${type}\ndata: ${JSON.stringify(enrichedPayload)}\n\n`;

    for (const [id, entry] of this.subscribers) {
      try {
        if (entry.isPlatformAdmin || !clientId || entry.clientId === clientId) {
          entry.res.write(data);
        }
      } catch {
        this.subscribers.delete(id);
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
      this.unsubscribeByRes(res);
    }
  }

  getCurrentSeq(): number {
    return this.seq;
  }
}

export const eventBus = new EventBus();
