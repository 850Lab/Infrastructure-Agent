import { log } from "./logger";
import * as fs from "fs";
import * as path from "path";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";
const TABLE_NAME = "Run_History";
const MAX_RUNS = 200;
const JSON_PATH = path.join(process.cwd(), "data", "run_history.json");

export interface RunStep {
  step: string;
  started_at: number;
  finished_at?: number;
  duration_ms?: number;
  stats?: Record<string, any>;
  status: "running" | "ok" | "error" | "skipped";
}

export interface Run {
  run_id: string;
  started_at: number;
  finished_at?: number;
  steps: RunStep[];
  summary?: Record<string, any>;
  errors: string[];
  status: "running" | "completed" | "error";
  duration_ms?: number;
  _airtable_id?: string;
  clientId?: string;
}

const runs: Run[] = [];
let loaded = false;

function hasAirtable(): boolean {
  return !!(AIRTABLE_API_KEY() && AIRTABLE_BASE_ID());
}

async function airtableRequest(pathStr: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${pathStr}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

function ensureDataDir(): void {
  const dir = path.dirname(JSON_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadFromJson(): Run[] {
  try {
    if (fs.existsSync(JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
      return Array.isArray(data) ? data : [];
    }
  } catch (e: any) {
    log(`Failed to load run history JSON: ${e.message}`, "run-history");
  }
  return [];
}

function saveToJson(data: Run[]): void {
  try {
    ensureDataDir();
    fs.writeFileSync(JSON_PATH, JSON.stringify(data.slice(0, MAX_RUNS), null, 2));
  } catch (e: any) {
    log(`Failed to save run history JSON: ${e.message}`, "run-history");
  }
}

async function loadFromAirtable(): Promise<Run[]> {
  try {
    const encoded = encodeURIComponent(TABLE_NAME);
    const records: any[] = [];
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({
        pageSize: "100",
        "sort[0][field]": "started_at",
        "sort[0][direction]": "desc",
      });
      if (offset) params.set("offset", offset);

      const data = await airtableRequest(`${encoded}?${params.toString()}`);
      records.push(...(data.records || []));
      offset = data.offset;
    } while (offset && records.length < MAX_RUNS);

    return records.map((r: any) => ({
      run_id: r.fields.run_id || r.id,
      started_at: r.fields.started_at ? new Date(r.fields.started_at).getTime() : 0,
      finished_at: r.fields.finished_at ? new Date(r.fields.finished_at).getTime() : undefined,
      status: r.fields.status || "completed",
      steps: safeJsonParse(r.fields.steps_json, []),
      summary: safeJsonParse(r.fields.summary_json, {}),
      errors: safeJsonParse(r.fields.errors_json, []),
      duration_ms: r.fields.duration_ms || undefined,
      _airtable_id: r.id,
    }));
  } catch (e: any) {
    log(`Failed to load from Airtable Run_History: ${e.message}`, "run-history");
    return [];
  }
}

function safeJsonParse(val: any, fallback: any): any {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

async function saveToAirtable(run: Run): Promise<string | null> {
  try {
    const fields: Record<string, any> = {
      run_id: run.run_id,
      started_at: new Date(run.started_at).toISOString(),
      status: run.status === "completed" ? "success" : run.status,
      steps_json: JSON.stringify(run.steps),
      summary_json: JSON.stringify(run.summary || {}),
      errors_json: JSON.stringify(run.errors || []),
    };
    if (run.finished_at) {
      fields.finished_at = new Date(run.finished_at).toISOString();
      fields.duration_ms = run.finished_at - run.started_at;
    }

    if (run._airtable_id) {
      await airtableRequest(encodeURIComponent(TABLE_NAME), {
        method: "PATCH",
        body: JSON.stringify({
          records: [{ id: run._airtable_id, fields }],
        }),
      });
      return run._airtable_id;
    } else {
      const result = await airtableRequest(encodeURIComponent(TABLE_NAME), {
        method: "POST",
        body: JSON.stringify({
          records: [{ fields }],
        }),
      });
      return result.records?.[0]?.id || null;
    }
  } catch (e: any) {
    log(`Failed to save run to Airtable: ${e.message}`, "run-history");
    return null;
  }
}

async function trimAirtable(): Promise<void> {
  try {
    const encoded = encodeURIComponent(TABLE_NAME);
    const allRecords: any[] = [];
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({
        pageSize: "100",
        "sort[0][field]": "started_at",
        "sort[0][direction]": "desc",
        "fields[]": "run_id",
      });
      if (offset) params.set("offset", offset);

      const data = await airtableRequest(`${encoded}?${params.toString()}`);
      allRecords.push(...(data.records || []));
      offset = data.offset;
    } while (offset);

    if (allRecords.length > MAX_RUNS) {
      const toDelete = allRecords.slice(MAX_RUNS).map((r: any) => r.id);
      for (let i = 0; i < toDelete.length; i += 10) {
        const batch = toDelete.slice(i, i + 10);
        const params = batch.map((id: string) => `records[]=${id}`).join("&");
        await airtableRequest(`${encoded}?${params}`, { method: "DELETE" });
      }
      log(`Trimmed ${toDelete.length} old runs from Airtable`, "run-history");
    }
  } catch (e: any) {
    log(`Failed to trim Airtable run history: ${e.message}`, "run-history");
  }
}

export async function loadHistory(): Promise<void> {
  if (loaded) return;

  if (hasAirtable()) {
    const airtableRuns = await loadFromAirtable();
    if (airtableRuns.length > 0) {
      runs.length = 0;
      runs.push(...airtableRuns);
      log(`Loaded ${airtableRuns.length} runs from Airtable`, "run-history");
      loaded = true;
      return;
    }
  }

  const jsonRuns = loadFromJson();
  if (jsonRuns.length > 0) {
    runs.length = 0;
    runs.push(...jsonRuns);
    log(`Loaded ${jsonRuns.length} runs from JSON file`, "run-history");
  }
  loaded = true;
}

export function startRun(run_id: string, clientId?: string): Run {
  const run: Run = {
    run_id,
    started_at: Date.now(),
    steps: [],
    errors: [],
    status: "running",
    clientId,
  };
  runs.unshift(run);
  if (runs.length > MAX_RUNS) {
    runs.pop();
  }

  persistRun(run);
  return run;
}

export function addStep(run_id: string, stepUpdate: Partial<RunStep> & { step: string }): void {
  const run = runs.find((r) => r.run_id === run_id);
  if (!run) return;

  const existing = run.steps.find((s) => s.step === stepUpdate.step);
  if (existing) {
    Object.assign(existing, stepUpdate);
  } else {
    run.steps.push({
      step: stepUpdate.step,
      started_at: stepUpdate.started_at ?? Date.now(),
      status: stepUpdate.status ?? "running",
      ...stepUpdate,
    });
  }

  saveToJson(runs);
}

export function completeRun(
  run_id: string,
  data: { finished_at?: number; summary?: Record<string, any>; errors?: string[]; status?: "completed" | "error" }
): Run | undefined {
  const run = runs.find((r) => r.run_id === run_id);
  if (!run) return undefined;
  run.finished_at = data.finished_at ?? Date.now();
  run.duration_ms = run.finished_at - run.started_at;
  if (data.summary) run.summary = data.summary;
  if (data.errors) run.errors = data.errors;
  run.status = data.status ?? "completed";

  persistRun(run);
  return run;
}

function persistRun(run: Run): void {
  saveToJson(runs);

  if (hasAirtable()) {
    saveToAirtable(run)
      .then((airtableId) => {
        if (airtableId && !run._airtable_id) {
          run._airtable_id = airtableId;
        }
      })
      .catch((e) => log(`Airtable persist error: ${e.message}`, "run-history"));

    if (runs.length >= MAX_RUNS) {
      trimAirtable().catch(() => {});
    }
  }
}

export function getHistory(clientId?: string, includeGlobal: boolean = false): Run[] {
  if (!clientId) return runs;
  if (includeGlobal) {
    return runs.filter(r => !r.clientId || r.clientId === clientId);
  }
  return runs.filter(r => r.clientId === clientId);
}

export function getRunById(run_id: string): Run | undefined {
  return runs.find((r) => r.run_id === run_id);
}

export function getRunStatus(): {
  is_running: boolean;
  current_run_id: string | null;
  current_step: string | null;
} {
  const running = runs.find((r) => r.status === "running");
  if (!running) {
    return { is_running: false, current_run_id: null, current_step: null };
  }
  const activeStep = running.steps.find((s) => s.status === "running");
  return {
    is_running: true,
    current_run_id: running.run_id,
    current_step: activeStep?.step || null,
  };
}
