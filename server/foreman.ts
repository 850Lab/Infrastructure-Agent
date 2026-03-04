import { log } from "./index";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const FIELDS: Record<string, string> = {
  companyName: "company_name",
  phone: "phone",
  city: "city",
  state: "state",
  website: "website",
  isRefineryRelated: "is_refinery_related",
  industrialRelevanceScore: "industrial_relevance_score",
  heatExposureScore: "heat_exposure_score",
  decisionMakerProbability: "decision_maker_probability",
  industryType: "industry_type",
  pipelineStage: "pipeline_stage",
  lastContactedAt: "last_contacted_at",
  callToday: "call_today",
  callRank: "call_rank",
  callPackDate: "call_pack_date",
  activeWorkScore: "Active_Work_Score",
  enrichmentStatus: "enrichment_status",
  createdAt: "created_at",
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
  website: string;
  isRefineryRelated: string;
  enrichmentStatus: string;
  score: number;
  scoreBreakdown: string[];
  lastContactedAt: string | null;
  dmName?: string;
  dmTitle?: string;
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
  dm_name?: string;
  dm_title?: string;
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

  // is_refinery_related = "YES" → strongest signal (+30)
  const isRefinery = String(getField(fields, "isRefineryRelated") || "").toUpperCase();
  if (isRefinery === "YES") {
    score += 30;
    breakdown.push("refinery-related");
  }

  // has phone → callable (+20)
  const phone = getField(fields, "phone");
  if (phone && String(phone).trim().length > 5) {
    score += 20;
    breakdown.push("has phone");
  }

  // Gulf Coast geo match (+15)
  const city = String(getField(fields, "city") || "").toLowerCase().trim();
  const state = String(getField(fields, "state") || "").toLowerCase().trim();
  if (GULF_COAST_CITIES.has(city) || GULF_COAST_STATES.has(state)) {
    score += 15;
    breakdown.push("Gulf Coast");
  }

  // Website keyword signals or Active_Work_Score (+20)
  const website = String(getField(fields, "website") || "").toLowerCase();
  const activeWorkScore = parseInt(getField(fields, "activeWorkScore") || "0", 10);
  if (activeWorkScore >= 60) {
    score += 20;
    breakdown.push(`website signals (AWS=${activeWorkScore})`);
  } else if (activeWorkScore >= 40) {
    score += 10;
    breakdown.push(`partial website signals (AWS=${activeWorkScore})`);
  } else {
    const matchedKeywords = WEBSITE_KEYWORDS.filter(kw => website.includes(kw));
    if (matchedKeywords.length > 0) {
      score += 20;
      breakdown.push(`website keywords: ${matchedKeywords.slice(0, 3).join(", ")}`);
    }
  }

  // decision_maker_probability > 50 → likely has a reachable DM (+10)
  const dmProb = parseInt(getField(fields, "decisionMakerProbability") || "0", 10);
  if (dmProb > 50) {
    score += 10;
    breakdown.push(`DM prob ${dmProb}%`);
  }

  // industry_type signals (+5)
  const industryType = String(getField(fields, "industryType") || "").toLowerCase();
  if (industryType && industryType !== "unknown" && industryType !== "") {
    const industrialTypes = ["refinery", "chemical", "petrochemical", "industrial", "energy", "oil", "gas", "manufacturing", "construction"];
    if (industrialTypes.some(t => industryType.includes(t))) {
      score += 5;
      breakdown.push(`industry: ${industryType}`);
    }
  }

  // not contacted in 7+ days or never contacted (+10)
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

  // has website at all (+5)
  if (website && website.length > 5) {
    score += 5;
    breakdown.push("has website");
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
        website: String(getField(fields, "website") || ""),
        isRefineryRelated: String(getField(fields, "isRefineryRelated") || ""),
        enrichmentStatus: String(getField(fields, "enrichmentStatus") || ""),
        score,
        scoreBreakdown: breakdown,
        lastContactedAt: getField(fields, "lastContactedAt") || null,
      });
    }

    offset = data.offset;
  } while (offset);

  log(`Total candidates fetched: ${candidates.length}`, "foreman");

  const enriched = candidates.filter(c => c.enrichmentStatus === "done");
  if (enriched.length > 0) {
    try {
      const dmTable = encodeURIComponent("Decision_Makers");
      const dmByCompany = new Map<string, { name: string; title: string; priority: number }>();

      const DEPT_PRIORITY: Record<string, number> = {
        operations: 1, maintenance: 2, safety: 3, executive: 4, sales: 5, finance: 6, other: 7,
      };
      const SENIORITY_PRIORITY: Record<string, number> = {
        vp: 1, director: 2, c_suite: 3, manager: 4, other: 5,
      };

      let dmOffset: string | undefined;
      do {
        const url = dmOffset
          ? `${dmTable}?pageSize=100&offset=${dmOffset}`
          : `${dmTable}?pageSize=100`;
        const dmData = await airtableRequest(url);

        for (const rec of dmData.records || []) {
          const compName = String(rec.fields.company_name_text || "").trim().toLowerCase();
          if (!compName) continue;

          const dept = String(rec.fields.department || "other").toLowerCase();
          const seniority = String(rec.fields.seniority || "other").toLowerCase();
          const priority = (DEPT_PRIORITY[dept] || 7) * 10 + (SENIORITY_PRIORITY[seniority] || 5);

          const existing = dmByCompany.get(compName);
          if (!existing || priority < existing.priority) {
            dmByCompany.set(compName, {
              name: rec.fields.full_name || "",
              title: rec.fields.title || "",
              priority,
            });
          }
        }

        dmOffset = dmData.offset;
      } while (dmOffset);

      for (const c of candidates) {
        const key = c.companyName.trim().toLowerCase();
        const dm = dmByCompany.get(key);
        if (dm) {
          c.dmName = dm.name;
          c.dmTitle = dm.title;
          c.score += 15;
          c.scoreBreakdown.push("has DM contact");
        }
      }

      log(`Matched DM names for ${dmByCompany.size} companies`, "foreman");
    } catch (e: any) {
      log(`Failed to fetch DM data: ${e.message}`, "foreman");
    }
  }

  return candidates;
}

export function rankAndSelect(
  candidates: ForemanCandidate[],
  count: number,
  _minEmployee: number,
  geo: string,
): { selected: ForemanCandidate[]; filtered: number } {
  let filtered = candidates;

  // Must have a phone number to be callable
  filtered = filtered.filter(c => c.phone.length > 5);

  if (geo === "gulf_coast") {
    const geoMatches = filtered.filter(c =>
      GULF_COAST_CITIES.has(c.city.toLowerCase()) || GULF_COAST_STATES.has(c.state.toLowerCase())
    );
    log(`Gulf Coast matches: ${geoMatches.length}/${filtered.length}`, "foreman");
  }

  filtered.sort((a, b) => b.score - a.score);

  const selected = filtered.slice(0, count);
  log(`Selected top ${selected.length} from ${filtered.length} eligible candidates`, "foreman");

  return { selected, filtered: filtered.length };
}

export function buildCallPack(selected: ForemanCandidate[], mode: string): CallPack {
  const today = new Date().toISOString().split("T")[0];

  const leads: CallPackLead[] = selected.map((c, i) => {
    let opener = "Hey, quick question — are you guys currently mobilized inside any refineries or chemical plants right now?";
    if (c.dmName) {
      opener = `Hi, may I speak with ${c.dmName}? Quick question about whether you're currently mobilized inside any refineries or chemical plants right now.`;
    }

    return {
      external_id: c.recordId,
      company_name: c.companyName,
      phone: c.phone,
      city: c.city,
      state: c.state,
      rank: i + 1,
      score: c.score,
      reason: c.scoreBreakdown.join(" + "),
      opener,
      dm_name: c.dmName,
      dm_title: c.dmTitle,
    };
  });

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

  const rawText = await res.text();
  let body: any;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = { raw: rawText.slice(0, 500) };
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const isHtml = contentType.includes("text/html") || rawText.trim().startsWith("<!DOCTYPE") || rawText.trim().startsWith("<html");

  if (isHtml) {
    log(`CallCenter returned HTML instead of JSON — endpoint likely doesn't exist`, "foreman");
    return { ok: false, status: res.status, body: { error: "CallCenter returned HTML — /api/call-packs/upsert-today endpoint not found" } };
  }

  log(`CallCenter response: ${res.status} (json: ${isJson})`, "foreman");
  return { ok: res.ok, status: res.status, body };
}

export async function tagAirtableRecords(selected: ForemanCandidate[], tableName = "Companies"): Promise<number> {
  const encoded = encodeURIComponent(tableName);
  const today = new Date().toISOString().split("T")[0];

  let clearOffset: string | undefined;
  let totalCleared = 0;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    params.set("filterByFormula", `AND({${FIELDS.callToday}} = TRUE(), {${FIELDS.callPackDate}} != '${today}')`);
    if (clearOffset) params.set("offset", clearOffset);

    const oldRecords = await airtableRequest(`${encoded}?${params.toString()}`);

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
      totalCleared += oldRecords.records.length;
    }

    clearOffset = oldRecords.offset;
  } while (clearOffset);

  if (totalCleared > 0) {
    log(`Cleared ${totalCleared} old call_today flags`, "foreman");
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
