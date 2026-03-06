import type { Express, Request, Response } from "express";
import { authMiddleware } from "../dashboard-routes";
import { scopedFormula } from "../airtable-scoped";

function log(msg: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [sales-learning:routes] ${msg}`);
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

async function fetchClientRecords(table: string, clientId: string, fields: string[], limit = 100, extraFormula?: string): Promise<any[]> {
  const encoded = encodeURIComponent(table);
  const baseFormula = extraFormula
    ? scopedFormula(clientId, extraFormula)
    : `{Client_ID}='${clientId}'`;
  const formula = encodeURIComponent(baseFormula);
  const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
  const all: any[] = [];
  let offset: string | undefined;

  do {
    let url = `${encoded}?pageSize=${Math.min(limit - all.length, 100)}&filterByFormula=${formula}&${fieldParams}`;
    if (offset) url += `&offset=${offset}`;
    const data = await airtableRequest(url);
    all.push(...(data.records || []));
    offset = data.offset;
    if (all.length >= limit) break;
  } while (offset);

  return all.slice(0, limit);
}

export function registerSalesLearningRoutes(app: Express) {
  app.get("/api/sales-learning/observations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(403).json({ error: "No client context" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const records = await fetchClientRecords("Call_Observations", clientId, [
        "Call_ID", "Company_Name", "Detected_Speaker_Mode", "Gatekeeper_Name",
        "Opener_Used", "Value_Prop_Used", "Qualifying_Questions_Asked",
        "Authority_Redirect_Attempted", "Authority_Redirect_Success",
        "Deflection_Phrase", "Objection_Type", "Prospect_Engagement",
        "Operator_Performance", "Talk_Ratio_Operator", "Talk_Ratio_Prospect",
        "Outcome", "Created_At",
      ], limit);

      res.json({
        count: records.length,
        observations: records.map(r => ({ id: r.id, ...r.fields })),
      });
    } catch (e: any) {
      log(`Error fetching observations: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/sales-learning/learning", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(403).json({ error: "No client context" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const records = await fetchClientRecords("Call_Learning", clientId, [
        "Call_ID", "Company_ID", "Pattern_Types", "Failure_Modes",
        "Strength_Modes", "Severity_Score", "Learning_Summary",
        "Coaching_Recommendation", "Patch_Types_Recommended",
        "Script_Impact_Level", "Strategy_Impact_Level", "Created_At",
      ], limit);

      res.json({
        count: records.length,
        learning: records.map(r => ({ id: r.id, ...r.fields })),
      });
    } catch (e: any) {
      log(`Error fetching learning: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/sales-learning/patterns", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(403).json({ error: "No client context" });

      const records = await fetchClientRecords("Pattern_Insights", clientId, [
        "Insight_Type", "Segment_Key", "Pattern_Description", "Sample_Size",
        "Confidence_Score", "Recommended_Action", "Recommended_Targeting_Change",
        "Recommended_Script_Change", "Recommended_Sequence_Change",
        "Active", "Created_At", "Updated_At",
      ], 100, `{Active}=TRUE()`);

      res.json({
        count: records.length,
        patterns: records.map(r => ({ id: r.id, ...r.fields })),
      });
    } catch (e: any) {
      log(`Error fetching patterns: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/sales-learning/patches", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(403).json({ error: "No client context" });

      const records = await fetchClientRecords("Script_Patches", clientId, [
        "Patch_Type", "Trigger_Pattern", "Patch_Title", "Patch_Instruction",
        "Patch_Priority", "Applies_To_Bucket", "Applies_To_Industry",
        "Active", "Source", "Created_At",
      ], 100, `{Active}=TRUE()`);

      res.json({
        count: records.length,
        patches: records.map(r => ({ id: r.id, ...r.fields })),
      });
    } catch (e: any) {
      log(`Error fetching patches: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/sales-learning/summary", authMiddleware, async (req: Request, res: Response) => {
    try {
      const clientId = (req as any).user?.clientId;
      if (!clientId) return res.status(403).json({ error: "No client context" });

      const [observations, learning, patterns, patches] = await Promise.all([
        fetchClientRecords("Call_Observations", clientId, ["Outcome"], 1000),
        fetchClientRecords("Call_Learning", clientId, ["Failure_Modes", "Strength_Modes", "Severity_Score"], 1000),
        fetchClientRecords("Pattern_Insights", clientId, ["Active", "Insight_Type"], 200, `{Active}=TRUE()`),
        fetchClientRecords("Script_Patches", clientId, ["Active", "Patch_Type", "Patch_Priority"], 200, `{Active}=TRUE()`),
      ]);

      const failureCounts = new Map<string, number>();
      const strengthCounts = new Map<string, number>();

      for (const rec of learning) {
        try {
          const failures: string[] = JSON.parse(rec.fields.Failure_Modes || "[]");
          for (const f of failures) failureCounts.set(f, (failureCounts.get(f) || 0) + 1);
          const strengths: string[] = JSON.parse(rec.fields.Strength_Modes || "[]");
          for (const s of strengths) strengthCounts.set(s, (strengthCounts.get(s) || 0) + 1);
        } catch {}
      }

      const topFailures = [...failureCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([mode, count]) => ({ mode: mode.replace(/_/g, " "), count }));

      const topStrengths = [...strengthCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([mode, count]) => ({ mode: mode.replace(/_/g, " "), count }));

      const avgSeverity = learning.length > 0
        ? Math.round(learning.reduce((s: number, r: any) => s + (r.fields.Severity_Score || 0), 0) / learning.length)
        : 0;

      res.json({
        observations_count: observations.length,
        learning_records_count: learning.length,
        active_insights_count: patterns.length,
        active_patches_count: patches.length,
        average_severity: avgSeverity,
        top_failure_modes: topFailures,
        top_strength_modes: topStrengths,
        top_recommended_actions: patterns.slice(0, 5).map((r: any) => ({
          type: r.fields.Insight_Type,
          description: (r.fields.Pattern_Description || "").slice(0, 200),
        })),
      });
    } catch (e: any) {
      log(`Error fetching summary: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}
