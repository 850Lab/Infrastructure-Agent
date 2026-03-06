import type { CallObservation } from "./observation-engine";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:interpretation] ${msg}`);
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

type GatekeeperInteraction = "brush_off" | "information_capture" | "authority_redirect" | "call_transfer" | "hard_block";
type FailureMode = "accepted_deflection" | "talked_too_long" | "missed_question" | "missed_value_prop" | "weak_close_attempt" | "off_script";
type StrengthMode = "followed_script" | "strong_redirect" | "concise_and_controlled" | "good_qualifying" | "value_prop_delivered";
type OpportunitySignal = "crew_size_mentioned" | "timeline_mentioned" | "active_project_mentioned" | "turnaround_signal" | "plant_work_confirmed" | "no_fit_signal";

const OPPORTUNITY_KEYWORDS: Record<OpportunitySignal, string[]> = {
  crew_size_mentioned: ["crew", "guys on site", "workers", "man crew", "people out there", "team of"],
  timeline_mentioned: ["next week", "next month", "starting in", "begins", "kicking off", "scheduled for", "planning for"],
  active_project_mentioned: ["project", "job coming up", "new job", "got a job", "working on", "contract"],
  turnaround_signal: ["turnaround", "shutdown", "outage", "maintenance window", "planned outage"],
  plant_work_confirmed: ["plant", "refinery", "petrochemical", "chemical plant", "facility", "processing"],
  no_fit_signal: ["don't do that", "not our thing", "we don't", "not applicable", "wrong industry", "residential only"],
};

const TRANSFER_INDICATORS = [
  "let me transfer", "i'll connect you", "i'll put you through",
  "let me get him", "let me get her", "hold on let me",
  "one moment", "transferring you",
];

const HARD_BLOCK_INDICATORS = [
  "don't call back", "stop calling", "do not call",
  "we're not interested at all", "take us off", "remove us",
  "never call", "blocked",
];

function classifyGatekeeperInteraction(obs: CallObservation, transcript: string): GatekeeperInteraction | null {
  if (obs.Outcome !== "Gatekeeper") return null;
  const lower = transcript.toLowerCase();

  if (HARD_BLOCK_INDICATORS.some(p => lower.includes(p))) return "hard_block";
  if (TRANSFER_INDICATORS.some(p => lower.includes(p))) return "call_transfer";
  if (obs.Authority_Redirect_Attempted && obs.Authority_Redirect_Success) return "authority_redirect";
  if (obs.Deflection_Phrase) return "brush_off";
  return "information_capture";
}

function detectFailureModes(obs: CallObservation, transcript: string): FailureMode[] {
  const modes: FailureMode[] = [];

  if (obs.Deflection_Phrase && !obs.Authority_Redirect_Attempted) {
    modes.push("accepted_deflection");
  }

  if (obs.Talk_Ratio_Operator > 70) {
    modes.push("talked_too_long");
  }

  if (obs.Qualifying_Questions_Asked === 0 && obs.Outcome !== "No Answer") {
    modes.push("missed_question");
  }

  if (!obs.Value_Prop_Used && obs.Outcome !== "No Answer" && transcript.length > 100) {
    modes.push("missed_value_prop");
  }

  if (obs.Prospect_Engagement === "Curious" || obs.Prospect_Engagement === "Interested") {
    if (obs.Outcome !== "Qualified" && obs.Outcome !== "Decision Maker") {
      modes.push("weak_close_attempt");
    }
  }

  return modes;
}

function detectStrengthModes(obs: CallObservation): StrengthMode[] {
  const modes: StrengthMode[] = [];

  if (obs.Authority_Redirect_Attempted && obs.Authority_Redirect_Success) {
    modes.push("strong_redirect");
  }

  if (obs.Talk_Ratio_Operator <= 50 && obs.Talk_Ratio_Operator > 0) {
    modes.push("concise_and_controlled");
  }

  if (obs.Qualifying_Questions_Asked >= 2) {
    modes.push("good_qualifying");
  }

  if (obs.Value_Prop_Used) {
    modes.push("value_prop_delivered");
  }

  if (obs.Opener_Used && obs.Value_Prop_Used && obs.Qualifying_Questions_Asked >= 1) {
    modes.push("followed_script");
  }

  return modes;
}

function detectOpportunitySignals(transcript: string): OpportunitySignal[] {
  const lower = transcript.toLowerCase();
  const signals: OpportunitySignal[] = [];

  for (const [signal, keywords] of Object.entries(OPPORTUNITY_KEYWORDS) as [OpportunitySignal, string[]][]) {
    if (keywords.some(kw => lower.includes(kw))) {
      signals.push(signal);
    }
  }

  return signals;
}

const FAILURE_WEIGHTS: Record<FailureMode, number> = {
  accepted_deflection: 25,
  talked_too_long: 15,
  missed_question: 10,
  missed_value_prop: 20,
  weak_close_attempt: 20,
  off_script: 10,
};

function computeSeverityScore(failures: FailureMode[], strengths: StrengthMode[]): number {
  let score = failures.reduce((s, f) => s + (FAILURE_WEIGHTS[f] || 10), 0);
  score -= strengths.length * 5;
  return Math.max(0, Math.min(100, score));
}

const FAILURE_COACHING: Record<FailureMode, string> = {
  accepted_deflection: "Practice authority redirect: when told 'just send info', respond with 'I understand — before I do, who typically handles [service area] decisions?'",
  talked_too_long: "Shorten initial pitch. After value prop, pause and ask a qualifying question instead of continuing.",
  missed_question: "Add at least one qualifying question early in the call: crew size, project timeline, or current solution.",
  missed_value_prop: "Lead with the value proposition within the first 30 seconds. State the specific problem you solve.",
  weak_close_attempt: "When prospect shows interest, move to a specific next step: 'Can I schedule a 15-minute call with your [title]?'",
  off_script: "Review the playbook before the next call session. Key elements: opener, value prop, qualifying question, close.",
};

const FAILURE_TO_PATCH: Record<FailureMode, string> = {
  accepted_deflection: "add_gatekeeper_redirect_line",
  talked_too_long: "shorten_response_after_deflection",
  missed_question: "add_qualifying_question",
  missed_value_prop: "strengthen_value_prop",
  weak_close_attempt: "add_objection_handler",
  off_script: "simplify_opener",
};

function buildLearningSummary(
  obs: CallObservation,
  failures: FailureMode[],
  strengths: StrengthMode[],
  gkInteraction: GatekeeperInteraction | null,
  oppSignals: OpportunitySignal[],
): string {
  const parts: string[] = [];

  parts.push(`Call to ${obs.Company_Name} resulted in ${obs.Outcome}.`);
  parts.push(`Prospect engagement: ${obs.Prospect_Engagement}. Operator performance: ${obs.Operator_Performance}.`);

  if (gkInteraction) {
    parts.push(`Gatekeeper interaction classified as: ${gkInteraction.replace(/_/g, " ")}.`);
  }

  if (failures.length > 0) {
    parts.push(`Failure modes detected (${failures.length}): ${failures.map(f => f.replace(/_/g, " ")).join(", ")}.`);
  } else {
    parts.push("No failure modes detected.");
  }

  if (strengths.length > 0) {
    parts.push(`Strengths observed (${strengths.length}): ${strengths.map(s => s.replace(/_/g, " ")).join(", ")}.`);
  }

  if (oppSignals.length > 0) {
    parts.push(`Opportunity signals: ${oppSignals.map(s => s.replace(/_/g, " ")).join(", ")}.`);
  }

  return parts.join(" ");
}

function buildCoachingRecommendation(failures: FailureMode[]): string {
  if (failures.length === 0) return "No coaching needed — call execution was solid.";
  return failures.map(f => FAILURE_COACHING[f]).join("\n");
}

function computeScriptImpact(severity: number, failures: FailureMode[]): "Low" | "Medium" | "High" {
  if (severity >= 50 || failures.includes("accepted_deflection") || failures.includes("missed_value_prop")) return "High";
  if (severity >= 25) return "Medium";
  return "Low";
}

function computeStrategyImpact(oppSignals: OpportunitySignal[], engagement: string): "Low" | "Medium" | "High" {
  if (oppSignals.includes("no_fit_signal")) return "High";
  if (oppSignals.length >= 2) return "Medium";
  if (engagement === "Qualified" || engagement === "Interested") return "Medium";
  return "Low";
}

export interface CallLearning {
  Client_ID: string;
  Call_ID: string;
  Company_ID: string;
  Pattern_Types: string;
  Failure_Modes: string;
  Strength_Modes: string;
  Severity_Score: number;
  Learning_Summary: string;
  Coaching_Recommendation: string;
  Patch_Types_Recommended: string;
  Script_Impact_Level: "Low" | "Medium" | "High";
  Strategy_Impact_Level: "Low" | "Medium" | "High";
  Created_At: string;
}

export function buildLearning(obs: CallObservation, transcript: string): CallLearning {
  const gkInteraction = classifyGatekeeperInteraction(obs, transcript);
  const failures = detectFailureModes(obs, transcript);
  const strengths = detectStrengthModes(obs);
  const oppSignals = detectOpportunitySignals(transcript);
  const severity = computeSeverityScore(failures, strengths);

  const patternTypes: string[] = [];
  if (gkInteraction) patternTypes.push(`gatekeeper:${gkInteraction}`);
  for (const s of oppSignals) patternTypes.push(`opportunity:${s}`);
  if (obs.Objection_Type !== "none_detected") patternTypes.push(`objection:${obs.Objection_Type}`);

  const patchTypes = failures.map(f => FAILURE_TO_PATCH[f]).filter(Boolean);

  return {
    Client_ID: obs.Client_ID,
    Call_ID: obs.Call_ID,
    Company_ID: obs.Company_ID,
    Pattern_Types: JSON.stringify(patternTypes),
    Failure_Modes: JSON.stringify(failures),
    Strength_Modes: JSON.stringify(strengths),
    Severity_Score: severity,
    Learning_Summary: buildLearningSummary(obs, failures, strengths, gkInteraction, oppSignals),
    Coaching_Recommendation: buildCoachingRecommendation(failures),
    Patch_Types_Recommended: JSON.stringify(patchTypes),
    Script_Impact_Level: computeScriptImpact(severity, failures),
    Strategy_Impact_Level: computeStrategyImpact(oppSignals, obs.Prospect_Engagement),
    Created_At: new Date().toISOString(),
  };
}

export async function writeLearning(learning: CallLearning): Promise<string> {
  const table = encodeURIComponent("Call_Learning");
  const data = await airtableRequest(table, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields: { ...learning } }] }),
  });
  const id = data.records?.[0]?.id;
  log(`Wrote learning for call ${learning.Call_ID} → ${id} (severity: ${learning.Severity_Score})`);
  return id;
}
