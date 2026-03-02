import { log } from "./index";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = "Calls";

interface AirtableAttachment {
  id: string;
  url: string;
  filename: string;
  size: number;
  type: string;
}

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

export async function fetchAirtableRecord(recordId: string): Promise<AirtableRecord> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured");
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}/${recordId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable API error (${res.status}): ${text}`);
  }

  return res.json();
}

export function extractAudioAttachment(record: AirtableRecord): AirtableAttachment | null {
  const fields = record.fields;

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item?.url && item?.type && (
          item.type.startsWith("audio/") ||
          item.type === "video/mp4" ||
          item.filename?.match(/\.(mp3|wav|m4a|ogg|webm|mp4|mpeg|mpga)$/i)
        )) {
          return item as AirtableAttachment;
        }
      }
    }
  }

  return null;
}

export async function downloadAudio(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download audio: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function updateAirtableRecord(
  recordId: string,
  fields: Record<string, any>
): Promise<void> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable credentials not configured");
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable update error (${res.status}): ${text}`);
  }

  log(`Updated Airtable record ${recordId}`, "airtable");
}
