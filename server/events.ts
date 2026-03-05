import type { Response } from "express";

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
}

class EventBus {
  private subscribers: Set<Response> = new Set();
  private buffer: SSEEvent[] = [];
  private readonly maxBuffer = 200;

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

  publish(type: EventType, payload: Record<string, any>): void {
    const event: SSEEvent = { type, payload: { ...payload, ts: payload.ts ?? Date.now() }, ts: Date.now() };

    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(-this.maxBuffer);
    }

    const data = `event: ${type}\ndata: ${JSON.stringify(event.payload)}\n\n`;

    for (const res of this.subscribers) {
      try {
        res.write(data);
      } catch {
        this.subscribers.delete(res);
      }
    }
  }
}

export const eventBus = new EventBus();
