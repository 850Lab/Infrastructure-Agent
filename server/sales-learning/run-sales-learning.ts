import { buildObservation, writeObservation, type CallInput } from "./observation-engine";
import { buildLearning, writeLearning } from "./interpretation-engine";
import { refreshPatterns } from "./pattern-engine";
import { generatePatches } from "./optimization-engine";
import { scopedFormula } from "../airtable-scoped";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning] ${msg}`);
}

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID!;

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${path}`;
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

interface UnprocessedCall {
  id: string;
  fields: {
    Company?: string;
    Outcome?: string;
    Gatekeeper_Name?: string;
    Call_Time?: string;
    Transcription?: string;
    Client_ID?: string;
  };
}

async function fetchUnprocessedCalls(clientId: string, limit: number): Promise<UnprocessedCall[]> {
  const table = encodeURIComponent("Calls");
  const baseFormula = `AND({Transcription}!='',OR({Sales_Learning_Processed}=FALSE(),{Sales_Learning_Processed}=BLANK()))`;
  const formula = encodeURIComponent(scopedFormula(clientId, baseFormula));
  const fields = ["Company", "Outcome", "Gatekeeper_Name", "Call_Time", "Transcription", "Client_ID"];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

  const all: UnprocessedCall[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&sort[0][field]=Call_Time&sort[0][direction]=desc&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    all.push(...(data.records || []));
    offset = data.offset;
    if (all.length >= limit) break;
  } while (offset);

  return all.slice(0, limit);
}

async function markProcessed(callId: string): Promise<void> {
  const table = encodeURIComponent("Calls");
  await airtableRequest(`${table}/${callId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: { Sales_Learning_Processed: true } }),
  });
}

export interface SalesLearningResult {
  calls_processed: number;
  observations_created: number;
  learning_records_created: number;
  patterns_created: number;
  patterns_updated: number;
  patches_created: number;
  patches_skipped: number;
  errors: string[];
  duration_ms: number;
}

export async function runSalesLearning(
  clientId: string,
  options: { limit?: number } = {}
): Promise<SalesLearningResult> {
  const startTime = Date.now();
  const limit = options.limit ?? 50;

  const result: SalesLearningResult = {
    calls_processed: 0,
    observations_created: 0,
    learning_records_created: 0,
    patterns_created: 0,
    patterns_updated: 0,
    patches_created: 0,
    patches_skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  log(`Starting sales learning pipeline for client ${clientId} (limit: ${limit})`);

  let calls: UnprocessedCall[];
  try {
    calls = await fetchUnprocessedCalls(clientId, limit);
    log(`Found ${calls.length} unprocessed calls with transcriptions`);
  } catch (e: any) {
    log(`Failed to fetch unprocessed calls: ${e.message}`);
    result.errors.push(`fetch: ${e.message}`);
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  if (calls.length === 0) {
    log("No unprocessed calls found. Pipeline complete.");
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  for (const call of calls) {
    const f = call.fields;
    const transcript = f.Transcription || "";
    if (transcript.length < 20) {
      log(`Skipping call ${call.id}: transcript too short (${transcript.length} chars)`);
      continue;
    }

    try {
      const input: CallInput = {
        callId: call.id,
        companyId: f.Company || "Unknown",
        companyName: f.Company || "Unknown",
        transcript,
        outcome: f.Outcome || "Unknown",
        gatekeeperName: f.Gatekeeper_Name || "",
        callTime: f.Call_Time || "",
        clientId,
      };

      const observation = buildObservation(input);
      await writeObservation(observation);
      result.observations_created++;

      const learning = buildLearning(observation, transcript);
      await writeLearning(learning);
      result.learning_records_created++;

      await markProcessed(call.id);
      result.calls_processed++;
    } catch (e: any) {
      log(`Error processing call ${call.id}: ${e.message}`);
      result.errors.push(`call ${call.id}: ${e.message}`);
    }
  }

  log(`Processed ${result.calls_processed} calls. Running pattern aggregation...`);

  try {
    const patternResult = await refreshPatterns(clientId);
    result.patterns_created = patternResult.created;
    result.patterns_updated = patternResult.updated;
  } catch (e: any) {
    log(`Pattern aggregation error: ${e.message}`);
    result.errors.push(`patterns: ${e.message}`);
  }

  try {
    const patchResult = await generatePatches(clientId);
    result.patches_created = patchResult.created;
    result.patches_skipped = patchResult.skipped;
  } catch (e: any) {
    log(`Patch generation error: ${e.message}`);
    result.errors.push(`patches: ${e.message}`);
  }

  result.duration_ms = Date.now() - startTime;
  log(`Sales learning pipeline complete in ${result.duration_ms}ms: ${result.calls_processed} calls, ${result.observations_created} observations, ${result.learning_records_created} learning records, ${result.patterns_created} patterns, ${result.patches_created} patches`);

  return result;
}
