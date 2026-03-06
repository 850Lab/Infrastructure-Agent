import { scopedFormula } from "../airtable-scoped";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:script-evolution] ${msg}`);
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

const PATCH_CATEGORIES = [
  "opener",
  "gatekeeper",
  "value_prop",
  "qualifying_question",
  "objection_handler",
  "follow_up_email",
  "voicemail",
  "escalation_role_request",
  "shorten_response",
] as const;

type PatchCategory = typeof PATCH_CATEGORIES[number];

const PATCH_TYPE_TO_CATEGORY: Record<string, PatchCategory> = {
  simplify_opener: "opener",
  add_gatekeeper_redirect_line: "gatekeeper",
  strengthen_value_prop: "value_prop",
  add_qualifying_question: "qualifying_question",
  add_objection_handler: "objection_handler",
  add_followup_email_angle: "follow_up_email",
  shorten_response_after_deflection: "shorten_response",
  escalate_to_decision_maker_role_request: "escalation_role_request",
  reposition_authority_redirect: "gatekeeper",
};

interface ScriptPatch {
  id: string;
  patchType: string;
  triggerPattern: string;
  patchTitle: string;
  patchInstruction: string;
  priority: "High" | "Medium" | "Low";
  appliesToBucket: string;
  appliesToIndustry: string;
  active: boolean;
  source: string;
  category: PatchCategory;
}

interface PatternInsight {
  id: string;
  insightType: string;
  segmentKey: string;
  patternDescription: string;
  confidenceScore: number;
  recommendedAction: string;
  recommendedScriptChange: string;
  active: boolean;
}

interface AppliedPatch {
  id: string;
  patchType: string;
  patchTitle: string;
  category: PatchCategory;
  priority: "High" | "Medium" | "Low";
  source: string;
  instruction: string;
}

export interface ScriptEvolutionContext {
  promptInjection: string;
  appliedPatches: AppliedPatch[];
  confidence: number;
  strategyNotes: string;
  learningVersion: string;
}

const PRIORITY_WEIGHT: Record<string, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

async function fetchActivePatches(clientId: string): Promise<ScriptPatch[]> {
  const table = encodeURIComponent("Script_Patches");
  const formula = encodeURIComponent(scopedFormula(clientId, `{Active}=TRUE()`));
  const fields = [
    "Patch_Type", "Trigger_Pattern", "Patch_Title", "Patch_Instruction",
    "Patch_Priority", "Applies_To_Bucket", "Applies_To_Industry",
    "Active", "Source",
  ];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const all: ScriptPatch[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    for (const r of data.records || []) {
      const f = r.fields;
      const patchType = String(f.Patch_Type || "");
      all.push({
        id: r.id,
        patchType,
        triggerPattern: String(f.Trigger_Pattern || ""),
        patchTitle: String(f.Patch_Title || ""),
        patchInstruction: String(f.Patch_Instruction || ""),
        priority: (f.Patch_Priority as "High" | "Medium" | "Low") || "Low",
        appliesToBucket: String(f.Applies_To_Bucket || ""),
        appliesToIndustry: String(f.Applies_To_Industry || ""),
        active: true,
        source: String(f.Source || ""),
        category: PATCH_TYPE_TO_CATEGORY[patchType] || "opener",
      });
    }
    offset = data.offset;
  } while (offset);

  return all;
}

async function fetchActiveInsights(clientId: string): Promise<PatternInsight[]> {
  const table = encodeURIComponent("Pattern_Insights");
  const formula = encodeURIComponent(scopedFormula(clientId, `{Active}=TRUE()`));
  const fields = [
    "Insight_Type", "Segment_Key", "Pattern_Description",
    "Confidence_Score", "Recommended_Action", "Recommended_Script_Change", "Active",
  ];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const all: PatternInsight[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    for (const r of data.records || []) {
      const f = r.fields;
      all.push({
        id: r.id,
        insightType: String(f.Insight_Type || ""),
        segmentKey: String(f.Segment_Key || ""),
        patternDescription: String(f.Pattern_Description || ""),
        confidenceScore: Number(f.Confidence_Score || 0),
        recommendedAction: String(f.Recommended_Action || ""),
        recommendedScriptChange: String(f.Recommended_Script_Change || ""),
        active: true,
      });
    }
    offset = data.offset;
  } while (offset);

  return all;
}

export function getApplicablePatches(
  patches: ScriptPatch[],
  companyName: string,
  bucket: string,
  industry: string
): ScriptPatch[] {
  return patches.filter(p => {
    if (p.appliesToBucket && p.appliesToBucket !== "" && p.appliesToBucket.toLowerCase() !== bucket.toLowerCase()) {
      return false;
    }
    if (p.appliesToIndustry && p.appliesToIndustry !== "" && p.appliesToIndustry.toLowerCase() !== industry.toLowerCase()) {
      return false;
    }
    return true;
  });
}

export function rankPatchesByPriority(patches: ScriptPatch[]): ScriptPatch[] {
  return [...patches].sort((a, b) => {
    const weightDiff = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
    if (weightDiff !== 0) return weightDiff;
    return a.patchType.localeCompare(b.patchType);
  });
}

export function applyPatchesToPrompt(patches: ScriptPatch[], insights: PatternInsight[]): string {
  if (patches.length === 0 && insights.length === 0) return "";

  const lines: string[] = [];
  lines.push("\n--- MACHINE LEARNING SCRIPT EVOLUTION INSTRUCTIONS ---");
  lines.push("The following script modifications are based on automated analysis of call patterns and outcomes.");
  lines.push("Apply these modifications to the generated scripts:\n");

  const byCategory = new Map<PatchCategory, ScriptPatch[]>();
  for (const p of patches) {
    const existing = byCategory.get(p.category) || [];
    existing.push(p);
    byCategory.set(p.category, existing);
  }

  for (const category of PATCH_CATEGORIES) {
    const categoryPatches = byCategory.get(category);
    if (!categoryPatches || categoryPatches.length === 0) continue;

    const categoryLabel = category.replace(/_/g, " ").toUpperCase();
    lines.push(`[${categoryLabel}]`);
    for (const p of categoryPatches) {
      lines.push(`- ${p.patchTitle} (${p.priority} priority): ${p.patchInstruction}`);
      if (p.triggerPattern) {
        lines.push(`  Context: ${p.triggerPattern}`);
      }
    }
    lines.push("");
  }

  const scriptInsights = insights.filter(i => i.recommendedScriptChange);
  if (scriptInsights.length > 0) {
    lines.push("[PATTERN-BASED INSIGHTS]");
    for (const i of scriptInsights.slice(0, 5)) {
      lines.push(`- ${i.insightType}: ${i.recommendedScriptChange} (confidence: ${i.confidenceScore}%)`);
      if (i.patternDescription) {
        lines.push(`  Pattern: ${i.patternDescription}`);
      }
    }
    lines.push("");
  }

  lines.push("--- END SCRIPT EVOLUTION INSTRUCTIONS ---\n");

  return lines.join("\n");
}

function computeConfidence(patches: ScriptPatch[], insights: PatternInsight[]): number {
  if (patches.length === 0 && insights.length === 0) return 0;

  let totalWeight = 0;
  let count = 0;

  for (const p of patches) {
    totalWeight += (PRIORITY_WEIGHT[p.priority] || 1) * 30;
    count++;
  }

  for (const i of insights) {
    totalWeight += i.confidenceScore;
    count++;
  }

  if (count === 0) return 0;
  const avg = totalWeight / count;
  return Math.min(100, Math.round(avg));
}

function buildStrategyNotes(patches: ScriptPatch[], insights: PatternInsight[]): string {
  const notes: string[] = [];

  const highPriority = patches.filter(p => p.priority === "High");
  if (highPriority.length > 0) {
    notes.push(`${highPriority.length} high-priority script patches applied: ${highPriority.map(p => p.patchTitle).join(", ")}.`);
  }

  const categorySet = new Set(patches.map(p => p.category));
  if (categorySet.size > 0) {
    notes.push(`Modifications span ${categorySet.size} script categories: ${Array.from(categorySet).map(c => c.replace(/_/g, " ")).join(", ")}.`);
  }

  const scriptInsights = insights.filter(i => i.recommendedScriptChange);
  if (scriptInsights.length > 0) {
    notes.push(`${scriptInsights.length} pattern insights inform script changes.`);
  }

  if (notes.length === 0) {
    notes.push("No learning-based modifications applied. Using base script generation.");
  }

  return notes.join(" ");
}

export async function buildScriptEvolutionContext(
  clientId: string,
  companyName?: string,
  bucket?: string,
  industry?: string
): Promise<ScriptEvolutionContext> {
  log(`Building script evolution context for client ${clientId}${companyName ? `, company: ${companyName}` : ""}...`);

  const [allPatches, allInsights] = await Promise.all([
    fetchActivePatches(clientId),
    fetchActiveInsights(clientId),
  ]);

  log(`Fetched ${allPatches.length} active patches, ${allInsights.length} active insights`);

  const applicable = getApplicablePatches(allPatches, companyName || "", bucket || "", industry || "");
  const ranked = rankPatchesByPriority(applicable);

  const promptInjection = applyPatchesToPrompt(ranked, allInsights);
  const confidence = computeConfidence(ranked, allInsights);
  const strategyNotes = buildStrategyNotes(ranked, allInsights);

  const appliedPatches: AppliedPatch[] = ranked.map(p => ({
    id: p.id,
    patchType: p.patchType,
    patchTitle: p.patchTitle,
    category: p.category,
    priority: p.priority,
    source: p.source,
    instruction: p.patchInstruction,
  }));

  const learningVersion = `evo-${new Date().toISOString().split("T")[0]}-${appliedPatches.length}p`;

  log(`Script evolution context built: ${appliedPatches.length} patches applied, confidence ${confidence}%, version ${learningVersion}`);

  return {
    promptInjection,
    appliedPatches,
    confidence,
    strategyNotes,
    learningVersion,
  };
}
