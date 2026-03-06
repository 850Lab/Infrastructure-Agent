import { scopedFormula } from "../airtable-scoped";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:recommendations] ${msg}`);
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

interface PatchRecord {
  id: string;
  Patch_Type: string;
  Trigger_Pattern: string;
  Patch_Title: string;
  Patch_Instruction: string;
  Patch_Priority: string;
  Applies_To_Bucket: string;
  Applies_To_Industry: string;
  Active: boolean;
  Source: string;
}

interface InsightRecord {
  id: string;
  Insight_Type: string;
  Segment_Key: string;
  Pattern_Description: string;
  Confidence_Score: number;
  Recommended_Action: string;
  Recommended_Script_Change: string;
  Recommended_Targeting_Change: string;
  Recommended_Sequence_Change: string;
  Active: boolean;
}

export interface ScriptRecommendation {
  category: string;
  title: string;
  recommendation: string;
  source: string;
  priority: string;
  confidence: number;
}

export interface RecommendationsResult {
  company_id?: string;
  bucket?: string;
  recommended_opener: ScriptRecommendation | null;
  recommended_first_redirect: ScriptRecommendation | null;
  recommended_qualifying_question: ScriptRecommendation | null;
  recommended_objection_response: ScriptRecommendation | null;
  recommended_followup_sequence: ScriptRecommendation | null;
  all_recommendations: ScriptRecommendation[];
  patches_analyzed: number;
  insights_analyzed: number;
}

const PRIORITY_WEIGHT: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

const PATCH_TO_CATEGORY: Record<string, string> = {
  simplify_opener: "opener",
  add_gatekeeper_redirect_line: "first_redirect",
  reposition_authority_redirect: "first_redirect",
  escalate_to_decision_maker_role_request: "first_redirect",
  add_qualifying_question: "qualifying_question",
  strengthen_value_prop: "opener",
  add_objection_handler: "objection_response",
  shorten_response_after_deflection: "objection_response",
  add_followup_email_angle: "followup_sequence",
  route_to_email_sequence: "followup_sequence",
  increase_targeting_weight: "followup_sequence",
  decrease_targeting_weight: "followup_sequence",
};

async function fetchActivePatches(clientId: string, companyId?: string, bucket?: string): Promise<PatchRecord[]> {
  const table = encodeURIComponent("Script_Patches");
  const fields = [
    "Patch_Type", "Trigger_Pattern", "Patch_Title", "Patch_Instruction",
    "Patch_Priority", "Applies_To_Bucket", "Applies_To_Industry", "Active", "Source",
  ];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const formula = encodeURIComponent(scopedFormula(clientId, `{Active}=TRUE()`));
  const all: PatchRecord[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    for (const r of data.records || []) {
      all.push({ id: r.id, ...r.fields });
    }
    offset = data.offset;
  } while (offset);

  return all.filter(p => {
    if (bucket && p.Applies_To_Bucket && p.Applies_To_Bucket !== bucket) return false;
    return true;
  });
}

async function fetchActiveInsights(clientId: string): Promise<InsightRecord[]> {
  const table = encodeURIComponent("Pattern_Insights");
  const fields = [
    "Insight_Type", "Segment_Key", "Pattern_Description", "Confidence_Score",
    "Recommended_Action", "Recommended_Script_Change", "Recommended_Targeting_Change",
    "Recommended_Sequence_Change", "Active",
  ];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const formula = encodeURIComponent(scopedFormula(clientId, `{Active}=TRUE()`));
  const all: InsightRecord[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    for (const r of data.records || []) {
      all.push({ id: r.id, ...r.fields });
    }
    offset = data.offset;
  } while (offset);

  return all;
}

function buildRecommendationsFromPatches(patches: PatchRecord[]): ScriptRecommendation[] {
  const recs: ScriptRecommendation[] = [];

  for (const p of patches) {
    const category = PATCH_TO_CATEGORY[p.Patch_Type] || "general";
    const weight = PRIORITY_WEIGHT[p.Patch_Priority] || 1;

    recs.push({
      category,
      title: p.Patch_Title || p.Patch_Type.replace(/_/g, " "),
      recommendation: p.Patch_Instruction,
      source: `Patch: ${p.Source || "Rule Engine"}`,
      priority: p.Patch_Priority || "Medium",
      confidence: weight * 30,
    });
  }

  return recs;
}

function buildRecommendationsFromInsights(insights: InsightRecord[]): ScriptRecommendation[] {
  const recs: ScriptRecommendation[] = [];

  for (const ins of insights) {
    const confidence = ins.Confidence_Score || 0;
    if (confidence < 30) continue;

    const priority = confidence >= 70 ? "High" : confidence >= 50 ? "Medium" : "Low";

    if (ins.Recommended_Script_Change) {
      let category = "general";
      const type = ins.Insight_Type || "";
      if (type.includes("gatekeeper")) category = "first_redirect";
      else if (type.includes("objection")) category = "objection_response";
      else if (type.includes("opener") || type.includes("value_prop")) category = "opener";
      else if (type.includes("qualifying") || type.includes("question")) category = "qualifying_question";

      recs.push({
        category,
        title: `Insight: ${type.replace(/_/g, " ")}`,
        recommendation: ins.Recommended_Script_Change,
        source: "Pattern Insight",
        priority,
        confidence,
      });
    }

    if (ins.Recommended_Sequence_Change) {
      recs.push({
        category: "followup_sequence",
        title: `Sequence: ${(ins.Insight_Type || "").replace(/_/g, " ")}`,
        recommendation: ins.Recommended_Sequence_Change,
        source: "Pattern Insight",
        priority,
        confidence,
      });
    }

    if (ins.Recommended_Action && !ins.Recommended_Script_Change && !ins.Recommended_Sequence_Change) {
      recs.push({
        category: "general",
        title: `Action: ${(ins.Insight_Type || "").replace(/_/g, " ")}`,
        recommendation: ins.Recommended_Action,
        source: "Pattern Insight",
        priority,
        confidence,
      });
    }
  }

  return recs;
}

function pickBest(recs: ScriptRecommendation[], category: string): ScriptRecommendation | null {
  const filtered = recs.filter(r => r.category === category);
  if (filtered.length === 0) return null;

  filtered.sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority] || 1;
    const pb = PRIORITY_WEIGHT[b.priority] || 1;
    if (pb !== pa) return pb - pa;
    return b.confidence - a.confidence;
  });

  return filtered[0];
}

export async function getScriptRecommendations(
  clientId: string,
  options: { companyId?: string; bucket?: string } = {}
): Promise<RecommendationsResult> {
  log(`Building recommendations for client=${clientId} company=${options.companyId || "all"} bucket=${options.bucket || "all"}`);

  const [patches, insights] = await Promise.all([
    fetchActivePatches(clientId, options.companyId, options.bucket),
    fetchActiveInsights(clientId),
  ]);

  const patchRecs = buildRecommendationsFromPatches(patches);
  const insightRecs = buildRecommendationsFromInsights(insights);
  const allRecs = [...patchRecs, ...insightRecs];

  allRecs.sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority] || 1;
    const pb = PRIORITY_WEIGHT[b.priority] || 1;
    if (pb !== pa) return pb - pa;
    return b.confidence - a.confidence;
  });

  const result: RecommendationsResult = {
    company_id: options.companyId,
    bucket: options.bucket,
    recommended_opener: pickBest(allRecs, "opener"),
    recommended_first_redirect: pickBest(allRecs, "first_redirect"),
    recommended_qualifying_question: pickBest(allRecs, "qualifying_question"),
    recommended_objection_response: pickBest(allRecs, "objection_response"),
    recommended_followup_sequence: pickBest(allRecs, "followup_sequence"),
    all_recommendations: allRecs,
    patches_analyzed: patches.length,
    insights_analyzed: insights.length,
  };

  log(`Recommendations built: ${allRecs.length} total, opener=${!!result.recommended_opener}, redirect=${!!result.recommended_first_redirect}, qualifying=${!!result.recommended_qualifying_question}, objection=${!!result.recommended_objection_response}, followup=${!!result.recommended_followup_sequence}`);

  return result;
}
