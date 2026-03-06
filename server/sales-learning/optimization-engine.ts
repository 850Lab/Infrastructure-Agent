import { scopedFormula } from "../airtable-scoped";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:optimization] ${msg}`);
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

const PATCH_TYPE_TEMPLATES: Record<string, { title: string; instruction: string }> = {
  add_gatekeeper_redirect_line: {
    title: "Add Gatekeeper Redirect Line",
    instruction: 'When gatekeeper says "[DEFLECTION]", respond: "I understand — before I do, who typically handles [service area] decisions? I want to make sure the right person sees this."',
  },
  strengthen_value_prop: {
    title: "Strengthen Value Proposition",
    instruction: "Lead with a specific, measurable benefit within the first 20 seconds. Replace generic language with concrete outcomes relevant to the prospect's industry.",
  },
  simplify_opener: {
    title: "Simplify Opener",
    instruction: "Reduce opener to 2 sentences max: who you are + why you're calling. Remove filler and get to the qualifying question faster.",
  },
  add_qualifying_question: {
    title: "Add Qualifying Question",
    instruction: "Insert a qualifying question after the value prop: ask about crew size, project timeline, or current cooling solution. This engages the prospect and qualifies the opportunity.",
  },
  add_objection_handler: {
    title: "Add Objection Handler",
    instruction: 'Add a response to "[OBJECTION]" objection: acknowledge, pivot to evidence, then ask a follow-up question.',
  },
  shorten_response_after_deflection: {
    title: "Shorten Response After Deflection",
    instruction: "After any deflection, limit response to 1 sentence + 1 question. Do not continue pitching after being brushed off.",
  },
  reposition_authority_redirect: {
    title: "Reposition Authority Redirect",
    instruction: "Move authority redirect earlier in the gatekeeper conversation. Ask for the decision maker by role before delivering the full pitch.",
  },
  add_followup_email_angle: {
    title: "Add Follow-up Email Angle",
    instruction: "After unsuccessful call, send a follow-up email within 2 hours referencing the specific conversation point and offering a different entry angle.",
  },
  increase_targeting_weight: {
    title: "Increase Targeting Weight",
    instruction: "This segment shows higher conversion signals. Increase call frequency and prioritize in daily call list.",
  },
  decrease_targeting_weight: {
    title: "Decrease Targeting Weight",
    instruction: "This segment shows consistently low engagement. Reduce call frequency and consider email-only outreach.",
  },
  route_to_email_sequence: {
    title: "Route to Email Sequence",
    instruction: "Multiple call attempts have not yielded connection. Route to automated email sequence with 3-touch cadence.",
  },
  escalate_to_decision_maker_role_request: {
    title: "Escalate to DM Role Request",
    instruction: "Gatekeeper wall detected. On next call, ask specifically for the person who handles [service area] by title/role rather than by name.",
  },
};

interface PatchCandidate {
  patchType: string;
  triggerPattern: string;
  priority: "High" | "Medium" | "Low";
  source: "Rule Engine" | "Pattern Insight";
  appliesToBucket: string;
  appliesToIndustry: string;
}

async function fetchExistingPatches(clientId: string): Promise<Set<string>> {
  const table = encodeURIComponent("Script_Patches");
  const formula = encodeURIComponent(`AND({Client_ID}='${clientId}',{Active}=TRUE())`);
  const fields = ["Patch_Type", "Trigger_Pattern"];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const keys = new Set<string>();
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    for (const r of data.records || []) {
      keys.add(`${r.fields.Patch_Type}::${(r.fields.Trigger_Pattern || "").slice(0, 100)}`);
    }
    offset = data.offset;
  } while (offset);

  return keys;
}

async function fetchActiveLearning(clientId: string): Promise<any[]> {
  const table = encodeURIComponent("Call_Learning");
  const formula = encodeURIComponent(`AND({Client_ID}='${clientId}',{Severity_Score}>0)`);
  const fields = ["Failure_Modes", "Severity_Score", "Company_ID", "Patch_Types_Recommended"];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const all: any[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    all.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return all;
}

async function fetchActiveInsights(clientId: string): Promise<any[]> {
  const table = encodeURIComponent("Pattern_Insights");
  const formula = encodeURIComponent(`AND({Client_ID}='${clientId}',{Active}=TRUE())`);
  const fields = ["Insight_Type", "Segment_Key", "Recommended_Action", "Recommended_Script_Change",
    "Recommended_Targeting_Change", "Recommended_Sequence_Change", "Confidence_Score", "Pattern_Description"];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const all: any[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    all.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return all;
}

function candidatesFromLearning(learningRecords: any[]): PatchCandidate[] {
  const candidates: PatchCandidate[] = [];
  const patchCounts = new Map<string, number>();

  for (const rec of learningRecords) {
    try {
      const patches: string[] = JSON.parse(rec.fields.Patch_Types_Recommended || "[]");
      const failures: string[] = JSON.parse(rec.fields.Failure_Modes || "[]");
      const severity = rec.fields.Severity_Score || 0;

      for (const pt of patches) {
        patchCounts.set(pt, (patchCounts.get(pt) || 0) + 1);
      }
    } catch {}
  }

  for (const [patchType, count] of patchCounts) {
    if (count < 2) continue;

    const priority = count >= 5 ? "High" : count >= 3 ? "Medium" : "Low";
    candidates.push({
      patchType,
      triggerPattern: `Detected in ${count} calls across learning records.`,
      priority,
      source: "Rule Engine",
      appliesToBucket: "",
      appliesToIndustry: "",
    });
  }

  return candidates;
}

function candidatesFromInsights(insights: any[]): PatchCandidate[] {
  const candidates: PatchCandidate[] = [];

  for (const rec of insights) {
    const f = rec.fields;
    const type = f.Insight_Type;
    const confidence = f.Confidence_Score || 0;

    if (confidence < 40) continue;

    const priority = confidence >= 70 ? "High" : confidence >= 50 ? "Medium" : "Low";

    if (type === "gatekeeper_deflection_pattern") {
      candidates.push({
        patchType: "add_gatekeeper_redirect_line",
        triggerPattern: f.Pattern_Description || f.Segment_Key,
        priority,
        source: "Pattern Insight",
        appliesToBucket: "",
        appliesToIndustry: "",
      });
    }

    if (type === "objection_frequency") {
      candidates.push({
        patchType: "add_objection_handler",
        triggerPattern: f.Pattern_Description || f.Segment_Key,
        priority,
        source: "Pattern Insight",
        appliesToBucket: "",
        appliesToIndustry: "",
      });
    }

    if (type === "company_unreachable") {
      candidates.push({
        patchType: "route_to_email_sequence",
        triggerPattern: f.Pattern_Description || f.Segment_Key,
        priority,
        source: "Pattern Insight",
        appliesToBucket: "",
        appliesToIndustry: "",
      });
    }

    if (type === "gatekeeper_wall") {
      candidates.push({
        patchType: "escalate_to_decision_maker_role_request",
        triggerPattern: f.Pattern_Description || f.Segment_Key,
        priority,
        source: "Pattern Insight",
        appliesToBucket: "",
        appliesToIndustry: "",
      });
    }

    if (type === "failure_frequency") {
      const segKey = f.Segment_Key || "";
      if (segKey.includes("accepted_deflection")) {
        candidates.push({ patchType: "add_gatekeeper_redirect_line", triggerPattern: f.Pattern_Description, priority, source: "Pattern Insight", appliesToBucket: "", appliesToIndustry: "" });
      } else if (segKey.includes("missed_value_prop")) {
        candidates.push({ patchType: "strengthen_value_prop", triggerPattern: f.Pattern_Description, priority, source: "Pattern Insight", appliesToBucket: "", appliesToIndustry: "" });
      } else if (segKey.includes("talked_too_long")) {
        candidates.push({ patchType: "shorten_response_after_deflection", triggerPattern: f.Pattern_Description, priority, source: "Pattern Insight", appliesToBucket: "", appliesToIndustry: "" });
      } else if (segKey.includes("missed_question")) {
        candidates.push({ patchType: "add_qualifying_question", triggerPattern: f.Pattern_Description, priority, source: "Pattern Insight", appliesToBucket: "", appliesToIndustry: "" });
      }
    }
  }

  return candidates;
}

export async function generatePatches(clientId: string): Promise<{ created: number; skipped: number }> {
  log(`Generating patches for client ${clientId}...`);

  const [existingKeys, learningRecords, insights] = await Promise.all([
    fetchExistingPatches(clientId),
    fetchActiveLearning(clientId),
    fetchActiveInsights(clientId),
  ]);

  const fromLearning = candidatesFromLearning(learningRecords);
  const fromInsights = candidatesFromInsights(insights);
  const allCandidates = [...fromLearning, ...fromInsights];

  log(`Found ${allCandidates.length} patch candidates (${fromLearning.length} from learning, ${fromInsights.length} from insights)`);

  let created = 0;
  let skipped = 0;
  const table = encodeURIComponent("Script_Patches");

  for (const c of allCandidates) {
    const dedupKey = `${c.patchType}::${c.triggerPattern.slice(0, 100)}`;
    if (existingKeys.has(dedupKey)) {
      skipped++;
      continue;
    }

    const template = PATCH_TYPE_TEMPLATES[c.patchType];
    if (!template) {
      skipped++;
      continue;
    }

    const fields = {
      Client_ID: clientId,
      Patch_Type: c.patchType,
      Trigger_Pattern: c.triggerPattern,
      Patch_Title: template.title,
      Patch_Instruction: template.instruction,
      Patch_Priority: c.priority,
      Applies_To_Bucket: c.appliesToBucket || "",
      Applies_To_Industry: c.appliesToIndustry || "",
      Active: true,
      Source: c.source,
      Created_At: new Date().toISOString(),
    };

    await airtableRequest(table, {
      method: "POST",
      body: JSON.stringify({ records: [{ fields }] }),
    });

    existingKeys.add(dedupKey);
    created++;
  }

  log(`Patch generation complete: ${created} created, ${skipped} skipped (existing)`);
  return { created, skipped };
}
