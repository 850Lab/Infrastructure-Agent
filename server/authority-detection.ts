import { log } from "./logger";

function logAuth(message: string) {
  log(message, "authority-detect");
}

export interface AuthorityDetectionResult {
  detected: boolean;
  reason: string;
  suggestedRole: string | null;
  matchedPhrases: string[];
}

const NO_AUTHORITY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:that'?s?\s+)?not\s+my\s+(?:department|area|responsibility|job)/i, label: "not my department" },
  { pattern: /i\s+don'?t\s+(?:handle|deal\s+with|manage|do)\s+that/i, label: "I don't handle that" },
  { pattern: /(?:you(?:'d|'ll)?\s+)?(?:need|have)\s+to\s+(?:talk|speak|reach\s+out)\s+(?:to|with)/i, label: "redirect to another person" },
  { pattern: /(?:you\s+)?(?:want|should)\s+(?:talk|speak)\s+(?:to|with)/i, label: "redirect to another person" },
  { pattern: /(?:let\s+me\s+)?(?:transfer|connect|put)\s+you\s+(?:to|with|through)/i, label: "transfer offer" },
  { pattern: /i(?:'m|\s+am)\s+(?:not|just)\s+(?:the\s+)?(?:right|correct|person|one)\s+(?:for|to)/i, label: "not the right person" },
  { pattern: /(?:that|this)\s+(?:would\s+)?(?:go|goes|fall)\s+(?:through|under|to)\s+(?:our|the)/i, label: "routes to another department" },
  { pattern: /i\s+(?:can'?t|cannot)\s+(?:make|authorize|approve|sign\s+off)/i, label: "cannot authorize" },
  { pattern: /(?:that'?s?|it'?s?)\s+(?:above|beyond|outside)\s+my\s+(?:pay\s*grade|authority|scope)/i, label: "above my authority" },
  { pattern: /(?:you'?d?\s+)?(?:better|best)\s+(?:off\s+)?(?:talking|speaking)\s+(?:to|with)/i, label: "better off talking to someone else" },
  { pattern: /i'?m?\s+(?:not|just)\s+(?:the\s+)?(?:decision\s*maker|person\s+who\s+decides)/i, label: "not the decision maker" },
  { pattern: /(?:someone|somebody)\s+else\s+(?:handles?|takes?\s+care\s+of|deals?\s+with)/i, label: "someone else handles" },
];

const ROLE_EXTRACTION_PATTERNS: Array<{ pattern: RegExp; roleGroup: number }> = [
  { pattern: /(?:talk|speak|reach\s+out)\s+(?:to|with)\s+(?:our|the|a)\s+(.+?)(?:\.|,|$|\s+(?:about|regarding|for|he|she|they))/i, roleGroup: 1 },
  { pattern: /(?:transfer|connect|put)\s+you\s+(?:to|with|through\s+to)\s+(?:our|the|a)\s+(.+?)(?:\.|,|$|\s+(?:about|regarding|for|he|she|they))/i, roleGroup: 1 },
  { pattern: /(?:want|should|better|best)\s+(?:off\s+)?(?:talk|speak)(?:ing)?\s+(?:to|with)\s+(?:our|the|a)\s+(.+?)(?:\.|,|$|\s+(?:about|regarding|for|he|she|they))/i, roleGroup: 1 },
  { pattern: /(?:that|this)\s+(?:would\s+)?(?:go|goes|fall)\s+(?:through|under|to)\s+(?:our|the)\s+(.+?)(?:\.|,|$|\s+(?:about|regarding|for|he|she|they))/i, roleGroup: 1 },
  { pattern: /(?:someone|somebody)\s+else\s+(?:handles?|takes?\s+care\s+of|deals?\s+with)\s+(?:that|those|this).+?(?:our|the)\s+(.+?)(?:\.|,|$)/i, roleGroup: 1 },
];

const KNOWN_ROLES = [
  "safety manager", "safety director", "hse manager", "ehs manager",
  "turnaround manager", "turnaround coordinator", "turnaround director",
  "operations manager", "operations director", "plant manager",
  "maintenance manager", "maintenance director", "maintenance supervisor",
  "superintendent", "site manager", "field supervisor",
  "project manager", "project director",
  "procurement manager", "purchasing manager",
  "vp of operations", "vp operations", "vp of safety",
  "general manager", "gm",
  "facilities manager", "facilities director",
  "hr manager", "hr director",
];

function cleanExtractedRole(raw: string): string | null {
  const cleaned = raw.trim()
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

  if (cleaned.length < 3 || cleaned.length > 60) return null;

  const stopWords = ["them", "him", "her", "someone", "somebody", "guy", "person", "people", "whoever"];
  if (stopWords.includes(cleaned)) return null;

  for (const known of KNOWN_ROLES) {
    if (cleaned.includes(known)) {
      return known.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  if (/manager|director|supervisor|coordinator|vp|chief|head|lead|superintendent/i.test(cleaned)) {
    return cleaned.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  return null;
}

export function detectNoAuthority(transcript: string): AuthorityDetectionResult {
  if (!transcript || transcript.trim().length < 20) {
    return { detected: false, reason: "", suggestedRole: null, matchedPhrases: [] };
  }

  const matchedPhrases: string[] = [];
  const matchedLabels: string[] = [];

  for (const { pattern, label } of NO_AUTHORITY_PATTERNS) {
    const match = transcript.match(pattern);
    if (match) {
      matchedPhrases.push(match[0]);
      if (!matchedLabels.includes(label)) {
        matchedLabels.push(label);
      }
    }
  }

  if (matchedPhrases.length === 0) {
    return { detected: false, reason: "", suggestedRole: null, matchedPhrases: [] };
  }

  let suggestedRole: string | null = null;
  for (const { pattern, roleGroup } of ROLE_EXTRACTION_PATTERNS) {
    const match = transcript.match(pattern);
    if (match && match[roleGroup]) {
      suggestedRole = cleanExtractedRole(match[roleGroup]);
      if (suggestedRole) break;
    }
  }

  const reason = `No authority detected: ${matchedLabels.join("; ")}${suggestedRole ? `. Suggested role: ${suggestedRole}` : ""}`;

  logAuth(`Detected no-authority in transcript: ${matchedLabels.join(", ")}${suggestedRole ? ` → suggested: ${suggestedRole}` : ""}`);

  return {
    detected: true,
    reason,
    suggestedRole,
    matchedPhrases,
  };
}

export function detectNoAuthorityFromAnalysis(analysisText: string): AuthorityDetectionResult {
  if (!analysisText || analysisText.trim().length < 10) {
    return { detected: false, reason: "", suggestedRole: null, matchedPhrases: [] };
  }

  const analysisPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(?:wrong|incorrect)\s+(?:person|contact|decision\s*maker)/i, label: "wrong contact identified" },
    { pattern: /(?:no|lacks?|without)\s+(?:authority|decision.making\s+power)/i, label: "no decision-making authority" },
    { pattern: /(?:redirect|referr?ed|pointed)\s+(?:to|toward)\s+(?:another|different|the\s+correct)/i, label: "redirected to correct person" },
    { pattern: /(?:not\s+the\s+)?(?:decision\s*maker|authority\s+figure|buyer)/i, label: "not the decision maker" },
    { pattern: /authority\s+(?:redirect|mismatch|miss)/i, label: "authority mismatch" },
  ];

  const matchedPhrases: string[] = [];
  const matchedLabels: string[] = [];

  for (const { pattern, label } of analysisPatterns) {
    const match = analysisText.match(pattern);
    if (match) {
      matchedPhrases.push(match[0]);
      matchedLabels.push(label);
    }
  }

  if (matchedPhrases.length === 0) {
    return { detected: false, reason: "", suggestedRole: null, matchedPhrases: [] };
  }

  let suggestedRole: string | null = null;
  for (const { pattern, roleGroup } of ROLE_EXTRACTION_PATTERNS) {
    const match = analysisText.match(pattern);
    if (match && match[roleGroup]) {
      suggestedRole = cleanExtractedRole(match[roleGroup]);
      if (suggestedRole) break;
    }
  }

  return {
    detected: true,
    reason: `Analysis detected: ${matchedLabels.join("; ")}${suggestedRole ? `. Suggested role: ${suggestedRole}` : ""}`,
    suggestedRole,
    matchedPhrases,
  };
}
