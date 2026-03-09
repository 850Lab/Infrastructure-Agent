import OpenAI from "openai";
import { log } from "./index";

const proxyClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const directClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<string> {
  log(`Transcribing audio file: ${filename} (${audioBuffer.length} bytes)`, "openai");

  try {
    const file = new File([audioBuffer], filename, { type: getMimeType(filename) });

    const response = await directClient.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });

    const transcription = response.text || "[No speech detected]";
    log(`Transcription complete: ${transcription.length} chars`, "openai");
    return transcription;
  } catch (err: any) {
    log(`Transcription failed: ${err.message}`, "openai");
    throw new Error(`Audio transcription failed: ${err.message}`);
  }
}

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const mimeTypes: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/m4a",
    ogg: "audio/ogg",
    webm: "audio/webm",
    mp4: "video/mp4",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
  };
  return mimeTypes[ext || ""] || "audio/mpeg";
}

export interface DeterministicAnalysis {
  containment_hit: string | null;
  containment_line_index: number | null;
  next_lines: string[];
  redirect_found: boolean;
  problem_detected: string | null;
  proposed_patch_type: string | null;
  confidence: string | null;
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

export function analyzeContainmentDeterministic(transcription: string): DeterministicAnalysis {
  const lines = transcription.includes("\n")
    ? transcription.split("\n").map(l => l.trim()).filter(Boolean)
    : transcription.split(/[.!?]+/).map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    const hitPhrase = CONTAINMENT_PHRASES.find(p => lower.includes(p));
    if (!hitPhrase) continue;

    const nextLines = lines.slice(i + 1, i + 3);
    const nextText = nextLines.join(" ").toLowerCase();
    const redirectFound = AUTHORITY_REDIRECT_PHRASES.some(p => nextText.includes(p));

    return {
      containment_hit: lines[i],
      containment_line_index: i,
      next_lines: nextLines,
      redirect_found: redirectFound,
      problem_detected: redirectFound ? null : "Authority containment accepted",
      proposed_patch_type: redirectFound ? null : "add_gatekeeper_redirect_line",
      confidence: redirectFound ? null : "high",
    };
  }

  return {
    containment_hit: null,
    containment_line_index: null,
    next_lines: [],
    redirect_found: false,
    problem_detected: null,
    proposed_patch_type: null,
    confidence: null,
  };
}

export interface FollowupDateExtraction {
  detected: boolean;
  rawPhrase: string | null;
  isoDate: string | null;
  confidence: "high" | "medium" | "low";
  source: "explicit_date" | "relative_time" | "day_of_week" | "none";
}

export function extractFollowupDate(transcription: string, referenceDate?: Date): FollowupDateExtraction {
  const ref = referenceDate || new Date();
  const lower = transcription.toLowerCase();
  const noResult: FollowupDateExtraction = { detected: false, rawPhrase: null, isoDate: null, confidence: "low", source: "none" };

  const callbackPhrases = [
    /call\s*(?:me\s*)?back\s+(.+?)(?:[.!?,]|$)/gi,
    /reach\s*(?:back\s*)?out\s+(.+?)(?:[.!?,]|$)/gi,
    /follow\s*up\s+(.+?)(?:[.!?,]|$)/gi,
    /try\s*(?:me\s*)?(?:back\s*)?(?:again\s+)?(.+?)(?:[.!?,]|$)/gi,
    /check\s*back\s+(.+?)(?:[.!?,]|$)/gi,
    /(?:call|contact|reach)\s+(?:us|me)\s+(.+?)(?:[.!?,]|$)/gi,
    /(?:i'll|i\s*will)\s+be\s+(?:available|free|here|around)\s+(.+?)(?:[.!?,]|$)/gi,
    /(?:busy|tied up|unavailable)\s+(?:until|till)\s+(.+?)(?:[.!?,]|$)/gi,
    /(?:let's|let\s*us)\s+(?:talk|connect|touch base)\s+(.+?)(?:[.!?,]|$)/gi,
  ];

  let bestMatch: { phrase: string; date: Date; confidence: "high" | "medium"; source: FollowupDateExtraction["source"] } | null = null;

  for (const pattern of callbackPhrases) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const timePhrase = match[1].trim();
      const parsed = parseTimePhrase(timePhrase, ref);
      if (parsed) {
        if (!bestMatch || parsed.confidence === "high") {
          bestMatch = { phrase: match[0].trim(), ...parsed };
        }
      }
    }
  }

  const explicitPatterns = [
    /(?:on|after|around)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+)?(?:\s+(january|february|march|april|may|june|july|august|september|october|november|december))?/gi,
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/gi,
    /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/g,
  ];

  for (const pattern of explicitPatterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const context = lower.slice(Math.max(0, match.index - 60), match.index + match[0].length + 20);
      const hasCallbackContext = /call\s*(?:me\s*)?back|reach\s*(?:back\s*)?out|follow\s*up|check\s*back|contact\s+(?:us|me)|available|free\s+(?:on|after|around)|try\s*(?:me\s*)?(?:back|again)|talk|connect|touch\s*base|busy\s+until|unavailable\s+until/i.test(context);
      if (!hasCallbackContext) continue;

      const parsed = parseExplicitDate(match, ref);
      if (parsed && (!bestMatch || parsed.confidence === "high")) {
        bestMatch = { phrase: match[0].trim(), ...parsed };
      }
    }
  }

  if (!bestMatch) return noResult;

  return {
    detected: true,
    rawPhrase: bestMatch.phrase,
    isoDate: bestMatch.date.toISOString(),
    confidence: bestMatch.confidence,
    source: bestMatch.source,
  };
}

function parseTimePhrase(phrase: string, ref: Date): { date: Date; confidence: "high" | "medium"; source: FollowupDateExtraction["source"] } | null {
  const lower = phrase.toLowerCase().trim();

  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };
  for (const [dayName, dayNum] of Object.entries(dayMap)) {
    if (lower.includes(dayName)) {
      const d = new Date(ref);
      const currentDay = d.getDay();
      let daysAhead = dayNum - currentDay;
      if (daysAhead <= 0) daysAhead += 7;
      d.setDate(d.getDate() + daysAhead);
      d.setHours(9, 0, 0, 0);
      return { date: d, confidence: "high", source: "day_of_week" };
    }
  }

  if (/tomorrow/i.test(lower)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return { date: d, confidence: "high", source: "relative_time" };
  }

  const relativeMatch = lower.match(/(?:in\s+)?(\d+|a|an|one|two|three|four|five|couple(?:\s+of)?)\s+(day|week|month|hour)s?/i);
  if (relativeMatch) {
    const numWord = relativeMatch[1].toLowerCase();
    const numMap: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
    let num = numMap[numWord] || parseInt(numWord) || 1;
    if (numWord.startsWith("couple")) num = 2;
    const unit = relativeMatch[2].toLowerCase();
    const d = new Date(ref);
    if (unit === "hour") {
      d.setHours(d.getHours() + num);
      return { date: d, confidence: "high", source: "relative_time" };
    }
    if (unit === "day") d.setDate(d.getDate() + num);
    else if (unit === "week") d.setDate(d.getDate() + num * 7);
    else if (unit === "month") d.setMonth(d.getMonth() + num);
    d.setHours(9, 0, 0, 0);
    return { date: d, confidence: "high", source: "relative_time" };
  }

  if (/next\s+week/i.test(lower)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return { date: d, confidence: "medium", source: "relative_time" };
  }

  if (/next\s+month/i.test(lower)) {
    const d = new Date(ref);
    d.setMonth(d.getMonth() + 1);
    d.setHours(9, 0, 0, 0);
    return { date: d, confidence: "medium", source: "relative_time" };
  }

  if (/end\s+of\s+(the\s+)?week/i.test(lower)) {
    const d = new Date(ref);
    const daysToFri = 5 - d.getDay();
    d.setDate(d.getDate() + (daysToFri <= 0 ? daysToFri + 7 : daysToFri));
    d.setHours(9, 0, 0, 0);
    return { date: d, confidence: "medium", source: "relative_time" };
  }

  if (/end\s+of\s+(the\s+)?month/i.test(lower)) {
    const d = new Date(ref);
    d.setMonth(d.getMonth() + 1, 0);
    d.setHours(9, 0, 0, 0);
    return { date: d, confidence: "medium", source: "relative_time" };
  }

  if (/after\s+(the\s+)?holidays?/i.test(lower) || /after\s+(the\s+)?new\s+year/i.test(lower)) {
    const d = new Date(ref);
    d.setMonth(0, 6);
    if (d <= ref) d.setFullYear(d.getFullYear() + 1);
    d.setHours(9, 0, 0, 0);
    return { date: d, confidence: "medium", source: "relative_time" };
  }

  const monthMap: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  for (const [monthName, monthNum] of Object.entries(monthMap)) {
    if (lower.includes(monthName)) {
      const dayMatch = lower.match(/(\d{1,2})/);
      const d = new Date(ref);
      d.setMonth(monthNum, dayMatch ? parseInt(dayMatch[1]) : 1);
      if (d <= ref) d.setFullYear(d.getFullYear() + 1);
      d.setHours(9, 0, 0, 0);
      return { date: d, confidence: "high", source: "explicit_date" };
    }
  }

  return null;
}

function parseExplicitDate(match: RegExpExecArray, ref: Date): { date: Date; confidence: "high" | "medium"; source: FollowupDateExtraction["source"] } | null {
  const monthMap: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  const full = match[0].toLowerCase();

  if (full.includes("/")) {
    const parts = full.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/);
    if (parts) {
      const m = parseInt(parts[1]) - 1;
      const day = parseInt(parts[2]);
      let year = parts[3] ? parseInt(parts[3]) : ref.getFullYear();
      if (year < 100) year += 2000;
      const d = new Date(year, m, day, 9, 0, 0);
      if (d <= ref) d.setFullYear(d.getFullYear() + 1);
      return { date: d, confidence: "high", source: "explicit_date" };
    }
  }

  for (const [name, num] of Object.entries(monthMap)) {
    if (full.includes(name)) {
      const dayMatch = full.match(/(\d{1,2})/);
      const d = new Date(ref);
      d.setMonth(num, dayMatch ? parseInt(dayMatch[1]) : 1);
      if (d <= ref) d.setFullYear(d.getFullYear() + 1);
      d.setHours(9, 0, 0, 0);
      return { date: d, confidence: "high", source: "explicit_date" };
    }
  }

  const dayOnly = full.match(/(\d{1,2})/);
  if (dayOnly) {
    const day = parseInt(dayOnly[1]);
    if (day >= 1 && day <= 31) {
      const d = new Date(ref);
      d.setDate(day);
      if (d <= ref) d.setMonth(d.getMonth() + 1);
      d.setHours(9, 0, 0, 0);
      return { date: d, confidence: "medium", source: "explicit_date" };
    }
  }

  return null;
}

export async function analyzeContainment(transcription: string): Promise<string> {
  log("Analyzing containment language...", "openai");

  try {
    const response = await proxyClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert communication analyst specializing in containment language detection. Containment language refers to phrases and patterns used to deflect, minimize, dismiss, or control a conversation rather than genuinely address concerns.

Analyze the provided call transcription and produce a structured report with the following sections:

## Containment Language Findings

### Identified Phrases
List each problematic phrase found, with:
- The exact quote from the transcript
- The type of containment (deflection, minimization, dismissal, stonewalling, false reassurance, blame-shifting)
- A brief explanation of why it's problematic

### Severity Assessment
Rate overall containment language usage: Low / Medium / High / Critical

### Recommended Script Improvements
For each identified phrase, provide:
- The original problematic phrase
- A suggested replacement that is empathetic, transparent, and customer-focused

### Summary
A 2-3 sentence overall assessment of communication quality.

Be specific and actionable. If no containment language is found, say so clearly.`,
        },
        {
          role: "user",
          content: `Please analyze this call transcription for containment language:\n\n${transcription}`,
        },
      ],
      max_tokens: 2000,
    });

    const analysis = response.choices[0]?.message?.content || "No analysis generated";
    log(`Analysis complete: ${analysis.length} chars`, "openai");
    return analysis;
  } catch (err: any) {
    log(`Containment analysis failed: ${err.message}`, "openai");
    throw new Error(`Containment analysis failed: ${err.message}`);
  }
}

