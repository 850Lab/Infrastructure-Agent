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

