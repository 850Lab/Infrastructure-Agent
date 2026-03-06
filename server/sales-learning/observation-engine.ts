import { scopedFormula } from "../airtable-scoped";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:observation] ${msg}`);
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

const CONTAINMENT_PHRASES = [
  "send it", "send info", "send me info", "pass it", "pass along",
  "email it", "shoot it over", "forward it", "send me something",
  "send that over", "just send", "drop me an email", "send a brochure",
  "send me your info", "send over some info", "mail me something",
  "leave your info", "drop off some info", "give me your card",
  "send your information", "put something in the mail",
];

const AUTHORITY_REDIRECT_PHRASES = [
  "who handles that", "who oversees", "who is responsible",
  "who do i speak with", "right desk", "handled by someone else",
  "best person", "point person", "who should i talk to",
  "who makes that decision", "who's in charge", "who would i speak with",
  "who manages", "who runs", "who's the decision maker",
  "who typically handles", "right person", "who do i need to talk to",
];

const OBJECTION_KEYWORDS: Record<string, string[]> = {
  already_have: ["already have", "already got", "already using", "we use", "we have one", "taken care of", "got that covered"],
  not_interested: ["not interested", "no thanks", "don't need", "no need", "we're good", "pass on that", "don't want"],
  bad_timing: ["bad time", "busy right now", "call back", "not a good time", "in a meeting", "call later", "try again"],
  no_budget: ["no budget", "can't afford", "too expensive", "not in the budget", "cost too much"],
  wrong_person: ["wrong person", "wrong number", "not my department", "don't handle that", "talk to someone else"],
};

const VALUE_PROP_PATTERNS = [
  "cooling", "heat", "temperature", "hydration", "safety",
  "OSHA", "compliance", "trailer", "portable", "mobile",
  "air conditioning", "ac unit", "misting", "evaporative",
  "worker safety", "heat stress", "heat illness", "cool down",
  "job site", "jobsite", "site", "turnaround", "shutdown",
  "plant", "refinery", "petrochemical", "industrial",
];

const QUALIFYING_PATTERNS = [
  "how many", "how big", "how long", "when do you",
  "what kind of", "what type", "do you currently",
  "are you planning", "upcoming", "next project",
  "crew size", "how many guys", "how many workers",
  "square footage", "shifts", "how often",
];

export interface EvidenceEntry {
  signal: string;
  source: string;
  transcript_snippet: string;
}

export interface CallObservation {
  Client_ID: string;
  Call_ID: string;
  Company_ID: string;
  Company_Name: string;
  Detected_Speaker_Mode: "Flat" | "Partial" | "Diarized";
  Gatekeeper_Name: string;
  Opener_Used: string | null;
  Value_Prop_Used: string | null;
  Qualifying_Questions_Asked: number;
  Authority_Redirect_Attempted: boolean;
  Authority_Redirect_Success: boolean;
  Deflection_Phrase: string | null;
  Objection_Type: string;
  Prospect_Engagement: "Dismissive" | "Neutral" | "Curious" | "Interested" | "Qualified";
  Operator_Performance: "Strong" | "Mixed" | "Weak";
  Talk_Ratio_Operator: number;
  Talk_Ratio_Prospect: number;
  Outcome: string;
  Call_Duration: string;
  Evidence_JSON: string;
  Created_At: string;
}

export function extractOpener(transcript: string): string | null {
  const lines = transcript.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const first3 = lines.slice(0, 3).join(" ").toLowerCase();
  if (first3.length < 10) return null;
  return lines[0].slice(0, 200);
}

export function extractValueProp(transcript: string): string | null {
  const lower = transcript.toLowerCase();
  const found: string[] = [];
  for (const pattern of VALUE_PROP_PATTERNS) {
    if (lower.includes(pattern)) {
      found.push(pattern);
    }
  }
  if (found.length === 0) return null;
  return found.join(", ");
}

export function countQualifyingQuestions(transcript: string): number {
  const lower = transcript.toLowerCase();
  let count = 0;
  for (const pattern of QUALIFYING_PATTERNS) {
    const regex = new RegExp(pattern, "gi");
    const matches = lower.match(regex);
    if (matches) count += matches.length;
  }
  const questionMarks = (transcript.match(/\?/g) || []).length;
  return Math.min(count, questionMarks > 0 ? questionMarks : count);
}

export function detectAuthorityRedirect(transcript: string): { attempted: boolean; success: boolean } {
  const lower = transcript.toLowerCase();
  const attempted = AUTHORITY_REDIRECT_PHRASES.some(p => lower.includes(p));
  if (!attempted) return { attempted: false, success: false };

  const successIndicators = [
    "let me transfer", "i'll connect you", "hold on", "let me get",
    "i'll put you through", "one moment", "speaking", "this is",
    "he's right here", "she's right here", "let me see if",
  ];
  const success = successIndicators.some(s => lower.includes(s));
  return { attempted, success };
}

export function detectDeflectionPhrase(transcript: string): string | null {
  const lower = transcript.toLowerCase();
  for (const phrase of CONTAINMENT_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

export function classifyObjectionType(transcript: string): string {
  const lower = transcript.toLowerCase();
  for (const [type, keywords] of Object.entries(OBJECTION_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return type;
    }
  }
  return "none_detected";
}

export function classifyProspectEngagement(transcript: string, outcome: string): "Dismissive" | "Neutral" | "Curious" | "Interested" | "Qualified" {
  if (outcome === "Qualified") return "Qualified";
  if (outcome === "Not Interested") return "Dismissive";

  const lower = transcript.toLowerCase();
  const lines = transcript.split("\n").filter(Boolean);

  const interestIndicators = [
    "tell me more", "how does that work", "what would that look like",
    "interesting", "sounds good", "how much", "what's the cost",
    "we might need", "we could use", "send me a quote",
  ];
  const curiosityIndicators = [
    "what do you", "what is", "how do you", "explain",
    "what exactly", "tell me about",
  ];
  const dismissiveIndicators = [
    "not interested", "no thanks", "don't call", "remove",
    "take me off", "stop calling", "we're good",
  ];

  const interestHits = interestIndicators.filter(i => lower.includes(i)).length;
  const curiosityHits = curiosityIndicators.filter(i => lower.includes(i)).length;
  const dismissiveHits = dismissiveIndicators.filter(i => lower.includes(i)).length;

  if (dismissiveHits > 0 && interestHits === 0) return "Dismissive";
  if (interestHits >= 2) return "Interested";
  if (interestHits >= 1 || curiosityHits >= 2) return "Curious";
  if (lines.length > 6) return "Neutral";
  return "Neutral";
}

export function estimateTalkRatio(transcript: string): { operator: number; prospect: number } {
  const lines = transcript.split("\n").filter(Boolean);
  if (lines.length < 2) return { operator: 50, prospect: 50 };
  const oddChars = lines.filter((_, i) => i % 2 === 0).reduce((s, l) => s + l.length, 0);
  const evenChars = lines.filter((_, i) => i % 2 === 1).reduce((s, l) => s + l.length, 0);
  const total = oddChars + evenChars;
  if (total === 0) return { operator: 50, prospect: 50 };
  return {
    operator: Math.round((oddChars / total) * 100),
    prospect: Math.round((evenChars / total) * 100),
  };
}

function classifyOperatorPerformance(obs: Partial<CallObservation>): "Strong" | "Mixed" | "Weak" {
  let score = 0;
  if (obs.Qualifying_Questions_Asked && obs.Qualifying_Questions_Asked >= 2) score += 2;
  if (obs.Authority_Redirect_Attempted) score += 1;
  if (obs.Authority_Redirect_Success) score += 2;
  if (obs.Value_Prop_Used) score += 1;
  if (obs.Opener_Used) score += 1;

  if (obs.Deflection_Phrase && !obs.Authority_Redirect_Attempted) score -= 2;
  if (obs.Talk_Ratio_Operator && obs.Talk_Ratio_Operator > 70) score -= 1;
  if (!obs.Value_Prop_Used && obs.Outcome !== "No Answer") score -= 1;

  if (score >= 4) return "Strong";
  if (score >= 1) return "Mixed";
  return "Weak";
}

export interface CallInput {
  callId: string;
  companyId: string;
  companyName: string;
  transcript: string;
  outcome: string;
  gatekeeperName: string;
  callTime: string;
  clientId: string;
}

function findSnippet(transcript: string, phrase: string): string {
  const lower = transcript.toLowerCase();
  const idx = lower.indexOf(phrase.toLowerCase());
  if (idx === -1) return "";
  const start = Math.max(0, idx - 40);
  const end = Math.min(transcript.length, idx + phrase.length + 40);
  return transcript.slice(start, end).replace(/\n/g, " ").trim();
}

export function buildObservation(input: CallInput): CallObservation {
  const { transcript, outcome, callId, companyId, companyName, gatekeeperName, clientId } = input;

  const opener = extractOpener(transcript);
  const valueProp = extractValueProp(transcript);
  const qualQuestions = countQualifyingQuestions(transcript);
  const redirect = detectAuthorityRedirect(transcript);
  const deflection = detectDeflectionPhrase(transcript);
  const objection = classifyObjectionType(transcript);
  const engagement = classifyProspectEngagement(transcript, outcome);
  const talkRatio = estimateTalkRatio(transcript);

  const evidence: EvidenceEntry[] = [];

  if (opener) {
    evidence.push({ signal: "opener_used", source: "line_1", transcript_snippet: opener.slice(0, 150) });
  }
  if (valueProp) {
    const firstProp = valueProp.split(",")[0].trim();
    evidence.push({ signal: "value_prop_used", source: "keyword_match", transcript_snippet: findSnippet(transcript, firstProp) });
  }
  if (deflection) {
    evidence.push({ signal: "deflection_phrase", source: "containment_phrase_match", transcript_snippet: findSnippet(transcript, deflection) });
  }
  if (redirect.attempted) {
    const phrase = AUTHORITY_REDIRECT_PHRASES.find(p => transcript.toLowerCase().includes(p));
    if (phrase) evidence.push({ signal: "authority_redirect_attempted", source: "redirect_phrase_match", transcript_snippet: findSnippet(transcript, phrase) });
  }
  if (objection !== "none_detected") {
    const keywords = OBJECTION_KEYWORDS[objection] || [];
    const hit = keywords.find(kw => transcript.toLowerCase().includes(kw));
    if (hit) evidence.push({ signal: `objection:${objection}`, source: "keyword_match", transcript_snippet: findSnippet(transcript, hit) });
  }

  const partial: Partial<CallObservation> = {
    Qualifying_Questions_Asked: qualQuestions,
    Authority_Redirect_Attempted: redirect.attempted,
    Authority_Redirect_Success: redirect.success,
    Deflection_Phrase: deflection,
    Value_Prop_Used: valueProp,
    Opener_Used: opener,
    Talk_Ratio_Operator: talkRatio.operator,
    Talk_Ratio_Prospect: talkRatio.prospect,
    Outcome: outcome,
  };

  const performance = classifyOperatorPerformance(partial);

  return {
    Client_ID: clientId,
    Call_ID: callId,
    Company_ID: companyId,
    Company_Name: companyName,
    Detected_Speaker_Mode: "Flat",
    Gatekeeper_Name: gatekeeperName || "",
    Opener_Used: opener,
    Value_Prop_Used: valueProp,
    Qualifying_Questions_Asked: qualQuestions,
    Authority_Redirect_Attempted: redirect.attempted,
    Authority_Redirect_Success: redirect.success,
    Deflection_Phrase: deflection,
    Objection_Type: objection,
    Prospect_Engagement: engagement,
    Operator_Performance: performance,
    Talk_Ratio_Operator: talkRatio.operator,
    Talk_Ratio_Prospect: talkRatio.prospect,
    Outcome: outcome,
    Call_Duration: "unknown",
    Evidence_JSON: JSON.stringify(evidence),
    Created_At: new Date().toISOString(),
  };
}

export async function writeObservation(obs: CallObservation): Promise<string> {
  const table = encodeURIComponent("Call_Observations");
  const fields: Record<string, any> = { ...obs };
  const data = await airtableRequest(table, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] }),
  });
  const id = data.records?.[0]?.id;
  log(`Wrote observation for call ${obs.Call_ID} → ${id}`);
  return id;
}
