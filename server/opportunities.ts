import type { Express, Request, Response } from "express";
import { authMiddleware } from "./dashboard-routes";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

const STAGES = ["Qualified", "SiteWalk", "QuoteSent", "DeploymentScheduled", "Won", "Lost"] as const;
type Stage = typeof STAGES[number];

const STAGE_NEXT_ACTIONS: Record<string, { action: string; dueDays: number }> = {
  Qualified: { action: "Confirm crew size + timeline, schedule deployment discussion", dueDays: 2 },
  SiteWalk: { action: "Confirm site walk details + stakeholders", dueDays: 3 },
  QuoteSent: { action: "Follow up on quote", dueDays: 2 },
  DeploymentScheduled: { action: "Confirm delivery logistics + invoicing", dueDays: 1 },
};

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

function logOpp(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [opportunities] ${message}`);
}

async function airtableRequest(path: string, options: RequestInit = {}): Promise<any> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) throw new Error("Airtable credentials not configured");
  const url = `https://api.airtable.com/v0/${base}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
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

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function findActiveOpportunity(companyName: string): Promise<AirtableRecord | null> {
  if (!companyName) return null;
  const table = encodeURIComponent("Opportunities");
  const escaped = companyName.replace(/'/g, "\\'");
  const formula = encodeURIComponent(
    `AND(LOWER({Company})=LOWER('${escaped}'),{Stage}!='Won',{Stage}!='Lost')`
  );
  try {
    const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=1`);
    return data.records?.[0] || null;
  } catch {
    return null;
  }
}

async function createOpportunity(fields: Record<string, any>): Promise<AirtableRecord | null> {
  const table = encodeURIComponent("Opportunities");
  try {
    const res = await airtableRequest(table, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    logOpp(`Created opportunity for ${fields.Company} → ${fields.Stage}`);
    return res;
  } catch (e: any) {
    logOpp(`Failed to create opportunity: ${e.message}`);
    return null;
  }
}

async function updateOpportunity(recordId: string, fields: Record<string, any>): Promise<AirtableRecord | null> {
  const table = encodeURIComponent("Opportunities");
  try {
    const res = await airtableRequest(`${table}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
    logOpp(`Updated opportunity ${recordId} → ${JSON.stringify(fields)}`);
    return res;
  } catch (e: any) {
    logOpp(`Failed to update opportunity ${recordId}: ${e.message}`);
    return null;
  }
}

export async function handleCallOutcome(
  companyName: string,
  outcome: string,
  notes?: string
): Promise<{ action: string; opportunityId?: string } | null> {
  const shouldCreate = ["Qualified", "Callback", "Won", "Not Interested"].includes(outcome);
  if (!shouldCreate) return null;

  try {
    const existing = await findActiveOpportunity(companyName);

    if (outcome === "Won") {
      if (existing) {
        await updateOpportunity(existing.id, {
          Stage: "Won",
          Last_Updated: new Date().toISOString(),
          Notes: existing.fields.Notes
            ? `${existing.fields.Notes}\n${new Date().toISOString().slice(0, 10)}: Won`
            : `${new Date().toISOString().slice(0, 10)}: Won`,
        });
        return { action: "updated_to_won", opportunityId: existing.id };
      } else {
        const rec = await createOpportunity({
          Company: companyName,
          Stage: "Won",
          Source: "Call Engine",
          Last_Updated: new Date().toISOString(),
          Notes: notes || "",
        });
        return { action: "created_won", opportunityId: rec?.id };
      }
    }

    if (outcome === "Not Interested") {
      if (existing) {
        await updateOpportunity(existing.id, {
          Stage: "Lost",
          Last_Updated: new Date().toISOString(),
          Notes: existing.fields.Notes
            ? `${existing.fields.Notes}\n${new Date().toISOString().slice(0, 10)}: Not Interested`
            : `${new Date().toISOString().slice(0, 10)}: Not Interested`,
        });
        return { action: "updated_to_lost", opportunityId: existing.id };
      }
      return null;
    }

    if (outcome === "Qualified" || outcome === "Callback") {
      const stage = "Qualified";
      const autoAction = outcome === "Callback"
        ? { action: "Call back", dueDays: 1 }
        : STAGE_NEXT_ACTIONS[stage];

      if (existing) {
        const updates: Record<string, any> = {
          Last_Updated: new Date().toISOString(),
        };
        if (autoAction) {
          updates.Next_Action = autoAction.action;
          updates.Next_Action_Due = addDays(autoAction.dueDays);
        }
        if (notes) {
          updates.Notes = existing.fields.Notes
            ? `${existing.fields.Notes}\n${new Date().toISOString().slice(0, 10)}: ${notes}`
            : notes;
        }
        await updateOpportunity(existing.id, updates);
        return { action: "updated_qualified", opportunityId: existing.id };
      } else {
        const fields: Record<string, any> = {
          Company: companyName,
          Stage: stage,
          Source: "Call Engine",
          Last_Updated: new Date().toISOString(),
          Owner: "Jaylan",
        };
        if (autoAction) {
          fields.Next_Action = autoAction.action;
          fields.Next_Action_Due = addDays(autoAction.dueDays);
        }
        if (notes) fields.Notes = notes;
        const rec = await createOpportunity(fields);
        return { action: "created_qualified", opportunityId: rec?.id };
      }
    }

    return null;
  } catch (e: any) {
    logOpp(`handleCallOutcome error for ${companyName}/${outcome}: ${e.message}`);
    return null;
  }
}

export function registerOpportunityRoutes(app: Express) {
  app.get("/api/opportunities", authMiddleware, async (req: Request, res: Response) => {
    try {
      const stageFilter = req.query.stage as string | undefined;
      const table = encodeURIComponent("Opportunities");
      let formula = "";
      if (stageFilter && STAGES.includes(stageFilter as Stage)) {
        formula = `filterByFormula=${encodeURIComponent(`{Stage}='${stageFilter}'`)}`;
      }

      const fields = [
        "Company", "Stage", "Next_Action", "Next_Action_Due", "Owner",
        "Value_Estimate", "Source", "Last_Updated", "Notes",
      ];
      const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
      const url = `${table}?pageSize=100&${fieldParams}${formula ? `&${formula}` : ""}`;

      const records: any[] = [];
      let offset: string | undefined;

      do {
        const data = await airtableRequest(`${url}${offset ? `&offset=${offset}` : ""}`);
        records.push(...(data.records || []));
        offset = data.offset;
      } while (offset);

      const opportunities = records.map((rec: AirtableRecord) => ({
        id: rec.id,
        company: String(rec.fields.Company || ""),
        stage: String(rec.fields.Stage || ""),
        next_action: String(rec.fields.Next_Action || ""),
        next_action_due: String(rec.fields.Next_Action_Due || ""),
        owner: String(rec.fields.Owner || ""),
        value_estimate: rec.fields.Value_Estimate ?? null,
        source: String(rec.fields.Source || ""),
        last_updated: String(rec.fields.Last_Updated || ""),
        notes: String(rec.fields.Notes || ""),
      }));

      res.json({ opportunities, count: opportunities.length });
    } catch (err: any) {
      logOpp(`GET /api/opportunities error: ${err.message}`);
      res.status(500).json({ error: "Failed to fetch opportunities" });
    }
  });

  app.post("/api/opportunities/:id/update", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { stage, next_action, next_action_due, notes, value_estimate, owner } = req.body;

      const updates: Record<string, any> = {
        Last_Updated: new Date().toISOString(),
      };

      if (stage && STAGES.includes(stage as Stage)) {
        updates.Stage = stage;
        const autoAction = STAGE_NEXT_ACTIONS[stage];
        if (autoAction && !next_action) {
          updates.Next_Action = autoAction.action;
          updates.Next_Action_Due = addDays(autoAction.dueDays);
        }
      }
      if (next_action !== undefined) updates.Next_Action = next_action;
      if (next_action_due !== undefined) updates.Next_Action_Due = next_action_due;
      if (notes !== undefined) updates.Notes = notes;
      if (value_estimate !== undefined) updates.Value_Estimate = value_estimate;
      if (owner !== undefined) updates.Owner = owner;

      const rec = await updateOpportunity(id, updates);
      if (!rec) {
        return res.status(500).json({ error: "Failed to update opportunity" });
      }

      res.json({
        id: rec.id,
        company: String(rec.fields.Company || ""),
        stage: String(rec.fields.Stage || ""),
        next_action: String(rec.fields.Next_Action || ""),
        next_action_due: String(rec.fields.Next_Action_Due || ""),
        owner: String(rec.fields.Owner || ""),
        value_estimate: rec.fields.Value_Estimate ?? null,
        last_updated: String(rec.fields.Last_Updated || ""),
        notes: String(rec.fields.Notes || ""),
      });
    } catch (err: any) {
      logOpp(`POST /api/opportunities/:id/update error: ${err.message}`);
      res.status(500).json({ error: "Failed to update opportunity" });
    }
  });

  app.get("/api/opportunities/summary", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const table = encodeURIComponent("Opportunities");
      const fields = ["Stage", "Value_Estimate"];
      const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");

      const records: any[] = [];
      let offset: string | undefined;

      do {
        const data = await airtableRequest(
          `${table}?pageSize=100&${fieldParams}${offset ? `&offset=${offset}` : ""}`
        );
        records.push(...(data.records || []));
        offset = data.offset;
      } while (offset);

      const summary: Record<string, { count: number; value: number }> = {};
      for (const s of STAGES) {
        summary[s] = { count: 0, value: 0 };
      }

      for (const rec of records) {
        const stage = String(rec.fields.Stage || "");
        if (summary[stage]) {
          summary[stage].count++;
          summary[stage].value += Number(rec.fields.Value_Estimate || 0);
        }
      }

      const activeCount = (summary.Qualified?.count || 0)
        + (summary.SiteWalk?.count || 0)
        + (summary.QuoteSent?.count || 0)
        + (summary.DeploymentScheduled?.count || 0);

      res.json({
        stages: summary,
        total_active: activeCount,
        total_won: summary.Won?.count || 0,
        total_lost: summary.Lost?.count || 0,
        total_value: Object.values(summary).reduce((s, v) => s + v.value, 0),
      });
    } catch (err: any) {
      logOpp(`GET /api/opportunities/summary error: ${err.message}`);
      res.status(500).json({ error: "Failed to fetch opportunity summary" });
    }
  });
}
