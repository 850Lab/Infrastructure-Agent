import { log } from "./index";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const FIELDS: Record<string, string> = {
  companyName: "company_name",
  phone: "phone",
  employeeCount: "employee_count",
  city: "city",
  state: "state",
  website: "website",
  lastContactedAt: "last_contacted_at",
  mobilizedInPlant: "mobilized_in_plant",
  priorOutcome: "prior_outcome",
  callToday: "call_today",
  callRank: "call_rank",
  callPackDate: "call_pack_date",
  activeWorkScore: "Active_Work_Score",
};

const GULF_COAST_CITIES = new Set([
  "baytown", "deer park", "pasadena", "la porte", "texas city",
  "port arthur", "beaumont", "lake charles", "baton rouge",
  "corpus christi", "houston", "galveston", "freeport", "channelview",
  "mont belvieu", "crosby", "dayton", "liberty", "orange",
  "nederland", "groves", "port neches", "sulphur", "westlake",
  "plaquemine", "geismar", "gonzales", "donaldsonville",
]);

const GULF_COAST_STATES = new Set(["tx", "la", "texas", "louisiana"]);

const WEBSITE_KEYWORDS = [
  "turnaround", "outage", "refinery", "plant services",
  "scaffolding", "insulation", "hydroblasting", "industrial cleaning",
  "shutdown", "chemical plant", "petrochemical", "mechanical contractor",
];

export interface ForemanCandidate {
  recordId: string;
  companyName: string;
  phone: string;
  city: string;
  state: string;
  employeeCount: number;
  website: string;
  score: number;
  scoreBreakdown: string[];
  mobilizedInPlant: boolean;
  priorOutcome: string;
  lastContactedAt: string | null;
}

export interface CallPackLead {
  external_id: string;
  company_name: string;
  phone: string;
  city: string;
  state: string;
  rank: number;
  score: number;
  reason: string;
  opener: string;
}

export interface CallPack {
  date: string;
  title: string;
  mode: string;
  leads: CallPackLead[];
}

function getField(fields: Record<string, any>, key: string): any {
  const mapped = FIELDS[key];
  if (!mapped) return undefined;

  const val = fields[mapped];
  if (val !== undefined) return val;

  const variations = [
    mapped,
    mapped.replace(/_/g, " "),
    mapped.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
    mapped.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join("_"),
    key,
    key.charAt(0).toUpperCase() + key.slice(1),
  ];

  for (const v of variations) {
    if (fields[v] !== undefined) return fields[v];
  }
  return undefined;
}

function scoreCandidate(fields: Record<string, any>): { score: number; breakdown: string[] } {
  let score = 0;
  const breakdown: string[] = [];

  const empCount = parseInt(getField(fields, "employeeCount") || "0", 10);
  if (empCount >= 50) {
    score += 30;
    breakdown.push(`50+ emp (${empCount})`);
  }

  const phone = getField(fields, "phone");
  if (phone && String(phone).trim().length > 5) {
    score += 20;
    breakdown.push("has phone");
  }

  const city = String(getField(fields, "city") || "").toLowerCase().trim();
  const state = String(getField(fields, "state") || "").toLowerCase().trim();
  if (GULF_COAST_CITIES.has(city) || GULF_COAST_STATES.has(state)) {
    score += 15;
    breakdown.push("Gulf Coast");
  }

  const website = String(getField(fields, "website") || "").toLowerCase();
  const activeWorkScore = parseInt(getField(fields, "activeWorkScore") || "0", 10);
  if (activeWorkScore > 0) {
    if (activeWorkScore >= 60) {
      score += 20;
      breakdown.push(`website signals (AWS=${activeWorkScore})`);
    } else if (activeWorkScore >= 40) {
      score += 10;
      breakdown.push(`partial website signals (AWS=${activeWorkScore})`);
    }
  } else {
    const matchedKeywords = WEBSITE_KEYWORDS.filter(kw => website.includes(kw));
    if (matchedKeywords.length > 0) {
      score += 20;
      breakdown.push(`website keywords: ${matchedKeywords.slice(0, 3).join(", ")}`);
    }
  }

  const lastContacted = getField(fields, "lastContactedAt");
  if (lastContacted) {
    const lastDate = new Date(lastContacted);
    const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) {
      score += 10;
      breakdown.push("not contacted 7d+");
    }
  } else {
    score += 10;
    breakdown.push("never contacted");
  }

  const mobilized = getField(fields, "mobilizedInPlant");
  if (mobilized === true || mobilized === "true" || mobilized === 1) {
    score += 30;
    breakdown.push("mobilized in plant");
  }

  const outcome = String(getField(fields, "priorOutcome") || "").toLowerCase();
  if (outcome.includes("transferred to ops") || outcome.includes("transfer")) {
    score += 10;
    breakdown.push("prior transfer to ops");
  }

  return { score, breakdown };
}

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured");
  }
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchCandidates(tableName = "Companies"): Promise<ForemanCandidate[]> {
  const encoded = encodeURIComponent(tableName);
  const candidates: ForemanCandidate[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);

    const data = await airtableRequest(`${encoded}?${params.toString()}`);
    log(`Fetched page: ${data.records?.length || 0} records (offset: ${offset || "none"})`, "foreman");

    for (const record of data.records || []) {
      const fields = record.fields;
      const phone = String(getField(fields, "phone") || "").trim();

      const { score, breakdown } = scoreCandidate(fields);

      candidates.push({
        recordId: record.id,
        companyName: String(getField(fields, "companyName") || "Unknown"),
        phone,
        city: String(getField(fields, "city") || ""),
        state: String(getField(fields, "state") || ""),
        employeeCount: parseInt(getField(fields, "employeeCount") || "0", 10),
        website: String(getField(fields, "website") || ""),
        score,
        scoreBreakdown: breakdown,
        mobilizedInPlant: !!(getField(fields, "mobilizedInPlant")),
        priorOutcome: String(getField(fields, "priorOutcome") || ""),
        lastContactedAt: getField(fields, "lastContactedAt") || null,
      });
    }

    offset = data.offset;
  } while (offset);

  log(`Total candidates fetched: ${candidates.length}`, "foreman");
  return candidates;
}

export function rankAndSelect(
  candidates: ForemanCandidate[],
  count: number,
  minEmployee: number,
  geo: string,
): { selected: ForemanCandidate[]; filtered: number } {
  let filtered = candidates;

  if (minEmployee > 0) {
    filtered = filtered.filter(c => c.employeeCount >= minEmployee || c.employeeCount === 0);
  }

  if (geo === "gulf_coast") {
    // Don't hard-filter by geo — the scoring already rewards Gulf Coast.
    // But log how many match.
    const geoMatches = filtered.filter(c =>
      GULF_COAST_CITIES.has(c.city.toLowerCase()) || GULF_COAST_STATES.has(c.state.toLowerCase())
    );
    log(`Gulf Coast matches: ${geoMatches.length}/${filtered.length}`, "foreman");
  }

  filtered = filtered.filter(c => c.phone.length > 5);

  filtered.sort((a, b) => b.score - a.score);

  const selected = filtered.slice(0, count);
  log(`Selected top ${selected.length} from ${filtered.length} eligible candidates`, "foreman");

  return { selected, filtered: filtered.length };
}

export function buildCallPack(selected: ForemanCandidate[], mode: string): CallPack {
  const today = new Date().toISOString().split("T")[0];

  const leads: CallPackLead[] = selected.map((c, i) => ({
    external_id: c.recordId,
    company_name: c.companyName,
    phone: c.phone,
    city: c.city,
    state: c.state,
    rank: i + 1,
    score: c.score,
    reason: c.scoreBreakdown.join(" + "),
    opener: "Hey, quick question — are you guys currently mobilized inside any refineries or chemical plants right now?",
  }));

  return {
    date: today,
    title: `Foreman: Call These ${selected.length}`,
    mode,
    leads,
  };
}

export async function pushToCallCenter(callPack: CallPack): Promise<{ ok: boolean; status: number; body: any }> {
  const baseUrl = process.env.CALLCENTER_BASE_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!baseUrl) throw new Error("CALLCENTER_BASE_URL not configured");
  if (!apiKey) throw new Error("INTERNAL_API_KEY not configured");

  const url = `${baseUrl.replace(/\/$/, "")}/api/call-packs/upsert-today`;
  log(`Pushing call pack to ${url} (${callPack.leads.length} leads)`, "foreman");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(callPack),
  });

  let body: any;
  try {
    body = await res.json();
  } catch {
    body = { raw: await res.text() };
  }
  log(`CallCenter response: ${res.status}`, "foreman");

  return { ok: res.ok, status: res.status, body };
}

export async function tagAirtableRecords(selected: ForemanCandidate[], tableName = "Companies"): Promise<number> {
  const encoded = encodeURIComponent(tableName);
  const today = new Date().toISOString().split("T")[0];

  const clearFormula = encodeURIComponent(`AND({${FIELDS.callToday}} = TRUE(), {${FIELDS.callPackDate}} != '${today}')`);
  const oldRecords = await airtableRequest(`${encoded}?filterByFormula=${clearFormula}&pageSize=100`);

  if (oldRecords.records?.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < oldRecords.records.length; i += batchSize) {
      const batch = oldRecords.records.slice(i, i + batchSize);
      await airtableRequest(encoded, {
        method: "PATCH",
        body: JSON.stringify({
          records: batch.map((r: any) => ({
            id: r.id,
            fields: {
              [FIELDS.callToday]: false,
              [FIELDS.callRank]: null,
            },
          })),
        }),
      });
    }
    log(`Cleared ${oldRecords.records.length} old call_today flags`, "foreman");
  }

  const batchSize = 10;
  let tagged = 0;
  for (let i = 0; i < selected.length; i += batchSize) {
    const batch = selected.slice(i, i + batchSize);
    await airtableRequest(encoded, {
      method: "PATCH",
      body: JSON.stringify({
        records: batch.map((c, j) => ({
          id: c.recordId,
          fields: {
            [FIELDS.callToday]: true,
            [FIELDS.callRank]: i + j + 1,
            [FIELDS.callPackDate]: today,
          },
        })),
      }),
    });
    tagged += batch.length;
  }

  log(`Tagged ${tagged} records for today's call pack`, "foreman");
  return tagged;
}
