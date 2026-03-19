import OpenAI from "openai";
import { log } from "../index";

const proxyClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const PRIMARY_OUTCOMES = ["no_answer", "gatekeeper", "decision_maker", "not_interested", "interested", "call_back", "wrong_fit", "unknown"] as const;
const HEAT_VALUES = ["yes", "no", "unknown"] as const;
const SOLUTION_VALUES = ["none", "fans", "tents", "trailers", "mixed", "unknown"] as const;
const URGENCY_VALUES = ["low", "medium", "high", "unknown"] as const;
const JOB_TYPE_VALUES = ["refinery", "construction", "industrial", "plant", "commercial", "unknown"] as const;
const TIMELINE_VALUES = ["immediate", "soon", "future", "unknown"] as const;
const NEXT_ACTION_VALUES = ["retry_call", "schedule_follow_up", "send_email", "research_more", "park", "escalate", "unknown"] as const;

export interface CallAnalysisInput {
  transcriptText: string;
  phoneNumber: string;
  companyName?: string;
  contactName?: string;
}

export interface CallAnalysisResult {
  primary_outcome: string;
  has_heat_exposure: string;
  current_solution: string;
  urgency_level: string;
  timeline: string;
  job_type: string;
  decision_maker_name: string | null;
  interest_score: number;
  buying_signals: string[];
  objections: string[];
  summary: string;
  next_action: string;
  suggested_follow_up_date: string | null;
}

function normalize<T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  const s = String(value || "").toLowerCase().trim();
  const found = allowed.find((a) => a === s);
  return (found ?? "unknown") as T[number];
}

function clampScore(n: unknown): number {
  const num = Number(n);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function safeParseArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((v) => String(v ?? "")).filter(Boolean).slice(0, 10);
  }
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, 10) : [];
    } catch {
      return val ? [val] : [];
    }
  }
  return [];
}

export async function analyzeTranscript(input: CallAnalysisInput): Promise<CallAnalysisResult> {
  const { transcriptText, phoneNumber, companyName, contactName } = input;
  log(`Analyzing transcript (${transcriptText.length} chars) for ${companyName || "unknown company"}`, "call-intelligence");

  try {
    const response = await proxyClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an industrial sales call analyst for Gulf Coast industrial services (insulation, heat stress solutions, trailers, mechanical contractors).
Analyze the call transcript and return strict JSON only. Do not guess when unsupported. Extract only what is clearly supported by the transcript.

Required JSON shape:
{
  "primary_outcome": "no_answer|gatekeeper|decision_maker|not_interested|interested|call_back|wrong_fit|unknown",
  "has_heat_exposure": "yes|no|unknown",
  "current_solution": "none|fans|tents|trailers|mixed|unknown",
  "urgency_level": "low|medium|high|unknown",
  "job_type": "refinery|construction|industrial|plant|commercial|unknown",
  "decision_maker_name": null or "Name" if mentioned,
  "timeline": "immediate|soon|future|unknown",
  "interest_score": 0-100 integer,
  "buying_signals": ["string"],
  "objections": ["string"],
  "summary": "concise factual summary",
  "next_action": "retry_call|schedule_follow_up|send_email|research_more|park|escalate|unknown",
  "suggested_follow_up_date": null or "YYYY-MM-DD" if mentioned
}

Rules:
- interest_score must be integer 0-100
- use only normalized values where applicable
- if unknown, use "unknown"
- buying_signals and objections must be arrays of strings
- summary should be concise and factual`,
        },
        {
          role: "user",
          content: `Analyze this call transcript${companyName ? ` (company: ${companyName})` : ""}${contactName ? ` (contact: ${contactName})` : ""}:\n\n${transcriptText}`,
        },
      ],
      max_tokens: 600,
    });

    const raw = response.choices[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      const repaired = cleaned.replace(/(\w+):/g, '"$1":').replace(/'/g, '"');
      try {
        parsed = JSON.parse(repaired);
      } catch {
        log(`Call analysis parse failed: ${(parseErr as Error).message}`, "call-intelligence");
        return {
          primary_outcome: "unknown",
          has_heat_exposure: "unknown",
          current_solution: "unknown",
          urgency_level: "unknown",
          timeline: "unknown",
          job_type: "unknown",
          decision_maker_name: null,
          interest_score: 0,
          buying_signals: [],
          objections: [],
          summary: "Failed to parse analysis — manual review needed",
          next_action: "unknown",
          suggested_follow_up_date: null,
        };
      }
    }

    log(`Call analysis: outcome=${parsed.primary_outcome} score=${parsed.interest_score}`, "call-intelligence");

    return {
      primary_outcome: normalize(parsed.primary_outcome, PRIMARY_OUTCOMES),
      has_heat_exposure: normalize(parsed.has_heat_exposure, HEAT_VALUES),
      current_solution: normalize(parsed.current_solution, SOLUTION_VALUES),
      urgency_level: normalize(parsed.urgency_level, URGENCY_VALUES),
      timeline: normalize(parsed.timeline, TIMELINE_VALUES),
      job_type: normalize(parsed.job_type, JOB_TYPE_VALUES),
      decision_maker_name: parsed.decision_maker_name ? String(parsed.decision_maker_name).trim() || null : null,
      interest_score: clampScore(parsed.interest_score),
      buying_signals: safeParseArray(parsed.buying_signals),
      objections: safeParseArray(parsed.objections),
      summary: String(parsed.summary || "").trim(),
      next_action: normalize(parsed.next_action, NEXT_ACTION_VALUES),
      suggested_follow_up_date: parsed.suggested_follow_up_date ? String(parsed.suggested_follow_up_date).trim() || null : null,
    };
  } catch (err: any) {
    log(`Call analysis failed: ${err.message}`, "call-intelligence");
    throw new Error(`Transcript analysis failed: ${err.message}`);
  }
}

// TODO Phase 2: Add processCallIntelligenceFromTranscript(transcript, callSid, clientId, companyId, ...)
// for Twilio webhook integration — reuse analyzeTranscript + insert + applyLeadUpdates.
