import { scopedFormula } from "../airtable-scoped";
import crypto from "crypto";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:versioning] ${msg}`);
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

function contentHash(obj: any): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash("md5").update(str).digest("hex").slice(0, 12);
}

async function getLatestVersion(clientId: string, companyName: string): Promise<any | null> {
  const table = encodeURIComponent("Script_Versions");
  const formula = encodeURIComponent(
    scopedFormula(clientId, `{Company_Name}='${companyName.replace(/'/g, "\\'")}'`)
  );
  const fields = ["Script_Snapshot_JSON", "Version_Label", "Created_At"];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const url = `${table}?pageSize=1&filterByFormula=${formula}&${fieldParams}&sort%5B0%5D%5Bfield%5D=Created_At&sort%5B0%5D%5Bdirection%5D=desc`;

  const data = await airtableRequest(url);
  const records = data.records || [];
  return records.length > 0 ? records[0] : null;
}

function generateVersionLabel(existingLabel?: string): string {
  if (!existingLabel) return "v1.0";
  const match = existingLabel.match(/^v(\d+)\.(\d+)$/);
  if (!match) return "v1.0";
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return `v${major}.${minor + 1}`;
}

export async function saveScriptVersion(
  clientId: string,
  companyName: string,
  bucket: string,
  playbook: Record<string, any>,
  appliedPatches: Array<{ patchType: string; title: string; priority?: string }>,
  sourceInsightIds: string[],
  confidence: number,
  companyId?: string
): Promise<{ saved: boolean; versionLabel: string }> {
  try {
    const snapshotHash = contentHash(playbook);

    const latest = await getLatestVersion(clientId, companyName);
    if (latest) {
      try {
        const existingSnapshot = JSON.parse(latest.fields.Script_Snapshot_JSON || "{}");
        const existingHash = contentHash(existingSnapshot);
        if (existingHash === snapshotHash) {
          log(`No material change for ${companyName} — skipping version save`);
          return { saved: false, versionLabel: latest.fields.Version_Label || "v1.0" };
        }
      } catch {}
    }

    const versionLabel = generateVersionLabel(latest?.fields?.Version_Label);

    const table = encodeURIComponent("Script_Versions");
    const fields: Record<string, any> = {
      Client_ID: clientId,
      Company_Name: companyName,
      Bucket: bucket,
      Version_Label: versionLabel,
      Applied_Patches: JSON.stringify(appliedPatches),
      Source_Insight_IDs: JSON.stringify(sourceInsightIds),
      Script_Snapshot_JSON: JSON.stringify(playbook),
      Confidence: confidence,
      Created_At: new Date().toISOString(),
    };

    if (companyId) {
      fields.Company_ID = companyId;
    }

    await airtableRequest(table, {
      method: "POST",
      body: JSON.stringify({ records: [{ fields }] }),
    });

    log(`Saved script version ${versionLabel} for ${companyName} (confidence: ${confidence}, patches: ${appliedPatches.length})`);
    return { saved: true, versionLabel };
  } catch (err: any) {
    log(`Error saving script version for ${companyName}: ${err.message}`);
    throw err;
  }
}

export async function getVersionHistory(
  clientId: string,
  companyName?: string
): Promise<Array<{
  id: string;
  companyName: string;
  companyId?: string;
  bucket: string;
  versionLabel: string;
  appliedPatches: any[];
  sourceInsightIds: string[];
  confidence: number;
  createdAt: string;
}>> {
  const table = encodeURIComponent("Script_Versions");
  let filterFormula: string;

  if (companyName) {
    filterFormula = scopedFormula(clientId, `{Company_Name}='${companyName.replace(/'/g, "\\'")}'`);
  } else {
    filterFormula = scopedFormula(clientId);
  }

  const formula = encodeURIComponent(filterFormula);
  const fields = [
    "Client_ID", "Company_ID", "Company_Name", "Bucket",
    "Version_Label", "Applied_Patches", "Source_Insight_IDs",
    "Confidence", "Created_At",
  ];
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

  const all: any[] = [];
  let offset: string | undefined;

  do {
    let url = `${table}?pageSize=100&filterByFormula=${formula}&${fieldParams}&sort%5B0%5D%5Bfield%5D=Created_At&sort%5B0%5D%5Bdirection%5D=desc`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    all.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return all.map((r: any) => {
    let appliedPatches: any[] = [];
    let sourceInsightIds: string[] = [];
    try { appliedPatches = JSON.parse(r.fields.Applied_Patches || "[]"); } catch {}
    try { sourceInsightIds = JSON.parse(r.fields.Source_Insight_IDs || "[]"); } catch {}

    return {
      id: r.id,
      companyName: r.fields.Company_Name || "",
      companyId: r.fields.Company_ID || undefined,
      bucket: r.fields.Bucket || "",
      versionLabel: r.fields.Version_Label || "",
      appliedPatches,
      sourceInsightIds,
      confidence: r.fields.Confidence || 0,
      createdAt: r.fields.Created_At || "",
    };
  });
}
