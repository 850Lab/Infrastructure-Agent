import { log } from "./logger";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

const KNOWN_COMPANIES_FIELDS = new Set<string>();
let fieldsCachePopulated = false;

async function populateFieldCache(): Promise<void> {
  if (fieldsCachePopulated) return;
  const apiKey = AIRTABLE_API_KEY();
  const baseId = AIRTABLE_BASE_ID();
  if (!apiKey || !baseId) return;
  try {
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent("Companies")}?pageSize=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return;
    const data = await res.json();
    const records = data.records || [];
    if (records.length > 0) {
      for (const key of Object.keys(records[0].fields)) {
        KNOWN_COMPANIES_FIELDS.add(key);
      }
    }
    fieldsCachePopulated = true;
    log(`Airtable field cache populated: ${KNOWN_COMPANIES_FIELDS.size} fields`, "airtable-writeback");
  } catch {}
}

function isFieldKnown(fieldName: string): boolean {
  if (!fieldsCachePopulated) return true;
  return KNOWN_COMPANIES_FIELDS.has(fieldName);
}

const CHANNEL_LABELS: Record<string, string> = {
  gatekeeper_call: "Gatekeeper Call",
  dm_call: "DM Direct Call",
  send_email: "Email",
  linkedin_action: "LinkedIn",
  nurture_check: "Nurture",
  gatekeeper: "Gatekeeper Call",
  dm_call_channel: "DM Direct Call",
  email: "Email",
  linkedin: "LinkedIn",
  nurture: "Nurture",
  phone: "Phone",
  call: "Phone",
};

function mapOutcomeToLeadStatus(flowType: string, outcome: string, currentStatus: string): string | null {
  if (outcome === "not_a_fit") return "Disqualified";
  if (outcome === "interested" || outcome === "meeting_requested") return "Interested";
  if (outcome === "responded" && flowType === "nurture") return "Re-engaged";
  if (outcome === "reactivated") return "Re-engaged";
  if (outcome === "not_relevant" || outcome === "closed_lost") return "Lost";
  if (outcome === "replied" && flowType === "email") return "Engaged";
  if (outcome === "live_answer" && flowType === "dm_call") return "Engaged";
  if (outcome === "connected" && flowType === "linkedin") return "Engaged";
  if (currentStatus === "Lost") return null;
  if (outcome === "gave_dm_name" || outcome === "gave_direct_extension" || outcome === "gave_email" || outcome === "transferred") return "Working";
  if (currentStatus === "" || currentStatus === "New" || currentStatus === "Untouched") return "Contacted";
  return null;
}

function mapDmStatus(flowType: string, outcome: string, currentDmStatus: string): string | null {
  if (flowType === "gatekeeper") {
    if (outcome === "gave_dm_name" || outcome === "gave_direct_extension") return "IDENTIFIED";
    if (outcome === "gave_email") return "EMAIL_ONLY";
    if (outcome === "transferred") return "IDENTIFIED";
  }
  if (flowType === "dm_call") {
    if (outcome === "live_answer" || outcome === "interested" || outcome === "meeting_requested" || outcome === "followup_scheduled") return "CONTACTED";
    if (outcome === "voicemail_left") return currentDmStatus === "CONTACTED" ? currentDmStatus : "IDENTIFIED";
    if (outcome === "wrong_person") return "WRONG_CONTACT";
    if (outcome === "not_relevant") return "NOT_RELEVANT";
  }
  return null;
}

function computeEngagementDelta(outcome: string): number {
  const high = ["interested", "meeting_requested", "replied", "responded", "reactivated", "live_answer"];
  const medium = ["connected", "clicked", "opened", "gave_dm_name", "gave_direct_extension", "gave_email", "transferred", "followup_scheduled", "asked_to_call_later"];
  const low = ["voicemail_left", "message_taken", "receptionist_answered", "connection_requested", "message_sent", "sent", "check_in_sent", "followup_sent", "viewed", "profile_found"];
  const negative = ["refused", "not_relevant", "bounced", "closed_lost"];

  if (high.includes(outcome)) return 15;
  if (medium.includes(outcome)) return 8;
  if (low.includes(outcome)) return 3;
  if (negative.includes(outcome)) return -5;
  return 1;
}

export async function syncOutcomeToAirtable(params: {
  companyId: string;
  companyName: string;
  flowType: string;
  channel: string;
  outcome: string;
  contactName?: string;
  contactId?: string;
  capturedInfo?: string;
  nextAction?: string;
  nextDueAt?: Date;
  flowStatus?: string;
  isCallType?: boolean;
}): Promise<{ synced: boolean; fieldsWritten: string[]; errors: string[] }> {
  const apiKey = AIRTABLE_API_KEY();
  const baseId = AIRTABLE_BASE_ID();
  if (!apiKey || !baseId) {
    return { synced: false, fieldsWritten: [], errors: ["No Airtable credentials"] };
  }

  const fieldsWritten: string[] = [];
  const errors: string[] = [];

  try {
    const getUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent("Companies")}/${params.companyId}`;
    const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!getRes.ok) {
      errors.push(`Failed to fetch company ${params.companyId}: ${getRes.status}`);
      return { synced: false, fieldsWritten, errors };
    }
    const record = await getRes.json();
    const currentFields = record.fields || {};

    const updates: Record<string, any> = {};

    const currentLeadStatus = String(currentFields.Lead_Status || "");
    const newLeadStatus = mapOutcomeToLeadStatus(params.flowType, params.outcome, currentLeadStatus);
    if (newLeadStatus) {
      updates.Lead_Status = newLeadStatus;
      fieldsWritten.push("Lead_Status");
    }

    if (params.isCallType || params.channel === "phone" || params.channel === "call" ||
        params.flowType === "gatekeeper" || params.flowType === "dm_call") {
      const currentTimesCalled = parseInt(String(currentFields.Times_Called || "0"), 10) || 0;
      updates.Times_Called = currentTimesCalled + 1;
      fieldsWritten.push("Times_Called");
    }

    const currentDmStatus = String(currentFields.DM_Status || "");
    const newDmStatus = mapDmStatus(params.flowType, params.outcome, currentDmStatus);
    if (newDmStatus) {
      updates.DM_Status = newDmStatus;
      fieldsWritten.push("DM_Status");
    }

    const currentEngagement = parseInt(String(currentFields.Engagement_Score || "0"), 10) || 0;
    const delta = computeEngagementDelta(params.outcome);
    const newEngagement = Math.max(0, Math.min(100, currentEngagement + delta));
    if (newEngagement !== currentEngagement) {
      updates.Engagement_Score = newEngagement;
      fieldsWritten.push("Engagement_Score");
    }

    updates.Last_Touch_Date = new Date().toISOString().split("T")[0];
    fieldsWritten.push("Last_Touch_Date");

    updates.Last_Touch_Channel = CHANNEL_LABELS[params.flowType] || CHANNEL_LABELS[params.channel] || params.channel;
    fieldsWritten.push("Last_Touch_Channel");

    updates.Last_Touch_Outcome = params.outcome;
    fieldsWritten.push("Last_Touch_Outcome");

    if (params.nextAction) {
      updates.Next_Action = params.nextAction;
      fieldsWritten.push("Next_Action");
    }

    if (params.nextDueAt) {
      updates.Next_Action_Due = params.nextDueAt.toISOString().split("T")[0];
      fieldsWritten.push("Next_Action_Due");
    }

    const flowStatusField = getFlowStatusField(params.flowType);
    if (flowStatusField && params.flowStatus) {
      updates[flowStatusField] = params.flowStatus;
      fieldsWritten.push(flowStatusField);
    }

    if (params.capturedInfo) {
      if (params.flowType === "gatekeeper" &&
          (params.outcome === "gave_dm_name" || params.outcome === "gave_direct_extension" || params.outcome === "gave_email")) {
        updates.Gatekeeper_Name = extractGatekeeperName(params.capturedInfo) || currentFields.Gatekeeper_Name;
        fieldsWritten.push("Gatekeeper_Name");
      }
    }

    if (params.contactName && (params.outcome === "gave_dm_name" || params.outcome === "transferred" ||
        params.outcome === "interested" || params.outcome === "meeting_requested")) {
      if (!currentFields.Primary_DM_Name) {
        updates.Primary_DM_Name = params.contactName;
        fieldsWritten.push("Primary_DM_Name");
      }
    }

    await populateFieldCache();

    const safeUpdates: Record<string, any> = {};
    const skippedFields: string[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (isFieldKnown(key)) {
        safeUpdates[key] = val;
      } else {
        skippedFields.push(key);
      }
    }

    if (skippedFields.length > 0) {
      errors.push(`Fields not in Airtable schema (skipped safely): ${skippedFields.join(", ")}`);
    }

    if (Object.keys(safeUpdates).length === 0) {
      log(`Airtable write-back for ${params.companyName}: no writable fields (all skipped: ${skippedFields.join(", ")})`, "airtable-writeback");
      return { synced: false, fieldsWritten: [], errors };
    }

    const patchUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent("Companies")}/${params.companyId}`;
    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: safeUpdates }),
    });

    if (!patchRes.ok) {
      const errBody = await patchRes.text().catch(() => "");
      errors.push(`PATCH failed: ${patchRes.status} - ${errBody.substring(0, 200)}`);
      if (errBody.includes("UNKNOWN_FIELD_NAME")) {
        const coreFields: Record<string, any> = {};
        const coreOnly = ["Lead_Status", "Times_Called", "DM_Status", "Engagement_Score"];
        for (const k of coreOnly) {
          if (safeUpdates[k] !== undefined) coreFields[k] = safeUpdates[k];
        }
        if (Object.keys(coreFields).length > 0) {
          const retryRes = await fetch(patchUrl, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ fields: coreFields }),
          });
          if (retryRes.ok) {
            log(`Airtable write-back for ${params.companyName}: core-only fallback wrote ${Object.keys(coreFields).join(", ")}`, "airtable-writeback");
            return { synced: true, fieldsWritten: Object.keys(coreFields), errors };
          }
        }
      }
      return { synced: false, fieldsWritten: [], errors };
    }

    log(`Airtable write-back for ${params.companyName}: ${Object.keys(safeUpdates).join(", ")}`, "airtable-writeback");
    return { synced: true, fieldsWritten: Object.keys(safeUpdates), errors };

  } catch (e: any) {
    errors.push(`Exception: ${e.message}`);
    log(`Airtable write-back error for ${params.companyName}: ${e.message}`, "airtable-writeback");
    return { synced: false, fieldsWritten: [], errors };
  }
}

function getFlowStatusField(flowType: string): string | null {
  const map: Record<string, string> = {
    gatekeeper: "GK_Flow_Status",
    dm_call: "DM_Flow_Status",
    email: "Email_Flow_Status",
    linkedin: "LinkedIn_Flow_Status",
    nurture: "Nurture_Flow_Status",
  };
  return map[flowType] || null;
}

function extractGatekeeperName(capturedInfo: string): string | null {
  const lines = capturedInfo.split("\n");
  for (const line of lines) {
    const match = line.match(/gatekeeper\s*(?:name)?[:\-]\s*(.+)/i);
    if (match) return match[1].trim();
    const nameMatch = line.match(/name[:\-]\s*(.+)/i);
    if (nameMatch) return nameMatch[1].trim();
  }
  if (capturedInfo.length < 50 && !capturedInfo.includes(":")) {
    return capturedInfo.trim();
  }
  return null;
}

export async function syncCallToAirtable(params: {
  companyName: string;
  phone: string;
  city?: string;
  state?: string;
  callDate: Date;
}): Promise<boolean> {
  const apiKey = AIRTABLE_API_KEY();
  const baseId = AIRTABLE_BASE_ID();
  if (!apiKey || !baseId) return false;

  try {
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent("Calls")}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          company_name: params.companyName,
          phone: params.phone,
          city: params.city || "",
          state: params.state || "",
          call_date: params.callDate.toISOString().split("T")[0],
        },
      }),
    });
    if (!res.ok) {
      log(`Calls table write failed: ${res.status}`, "airtable-writeback");
      return false;
    }
    return true;
  } catch (e: any) {
    log(`Calls table write error: ${e.message}`, "airtable-writeback");
    return false;
  }
}
