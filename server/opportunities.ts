import type { Express, Request, Response } from "express";
import { authMiddleware } from "./dashboard-routes";
import { syncDealToHubSpot, isHubSpotConnected, createInvoiceInHubSpot, type InvoiceData } from "./hubspot-sync";

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

async function findCompanyRecordId(companyName: string): Promise<string | null> {
  if (!companyName) return null;
  const table = encodeURIComponent("Companies");
  const escaped = companyName.replace(/'/g, "\\'");
  const formula = encodeURIComponent(`LOWER({Company_Name})=LOWER('${escaped}')`);
  try {
    const data = await airtableRequest(`${table}?filterByFormula=${formula}&pageSize=1&fields[]=Company_Name`);
    return data.records?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function findActiveOpportunity(companyName: string): Promise<AirtableRecord | null> {
  if (!companyName) return null;
  const table = encodeURIComponent("Opportunities");

  const companyRecordId = await findCompanyRecordId(companyName);
  if (!companyRecordId) {
    logOpp(`findActiveOpportunity: no Companies record for "${companyName}"`);
    return null;
  }

  const formula = encodeURIComponent(
    `AND(RECORD_ID()!='',{Stage}!='Won',{Stage}!='Lost')`
  );
  try {
    const records: AirtableRecord[] = [];
    let offset: string | undefined;
    do {
      const data = await airtableRequest(
        `${table}?filterByFormula=${formula}&pageSize=100&fields[]=Company&fields[]=Stage&fields[]=Notes&fields[]=Next_Action${offset ? `&offset=${offset}` : ""}`
      );
      records.push(...(data.records || []));
      offset = data.offset;
    } while (offset);

    for (const rec of records) {
      const companyField = rec.fields.Company;
      if (Array.isArray(companyField) && companyField.includes(companyRecordId)) {
        return rec;
      }
    }
    return null;
  } catch (e: any) {
    logOpp(`findActiveOpportunity error: ${e.message}`);
    return null;
  }
}

async function createOpportunity(fields: Record<string, any>): Promise<AirtableRecord | null> {
  const table = encodeURIComponent("Opportunities");

  if (fields.Company && typeof fields.Company === "string") {
    const companyRecordId = await findCompanyRecordId(fields.Company);
    if (companyRecordId) {
      fields.Company = [companyRecordId];
    } else {
      const companyName = fields.Company;
      delete fields.Company;
      logOpp(`Company record not found for "${companyName}", creating opportunity without link`);
    }
  }

  delete fields.Owner;

  try {
    const res = await airtableRequest(table, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    logOpp(`Created opportunity → ${fields.Stage}`);
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

function syncDealToHubSpotBackground(clientId: string, companyName: string, stage: string) {
  (async () => {
    try {
      const connected = await isHubSpotConnected(clientId);
      if (connected) {
        await syncDealToHubSpot(clientId, {
          companyName,
          dealName: `${companyName} - ${stage}`,
          stage,
        });
        logOpp(`HubSpot deal synced: ${companyName} (${stage})`);
      }
    } catch (e: any) {
      logOpp(`HubSpot deal sync error: ${e.message}`);
    }
  })();
}

function autoCreateInvoiceBackground(clientId: string, companyName: string, valueEstimate?: number) {
  (async () => {
    try {
      const connected = await isHubSpotConnected(clientId);
      if (!connected) return;

      const amount = valueEstimate || 28000;
      const result = await createInvoiceInHubSpot(clientId, {
        companyName,
        proposalTitle: "Sale of Cool Down Trailers",
        lineItems: [{ description: "Texas Cool Down Trailer", quantity: 1, unitPrice: amount }],
        taxRate: 8.25,
        features: [
          "Air-conditioned cooling station",
          "Designed for industrial job sites",
          "Workforce recovery / break area",
          "Heat stress prevention support",
          "Durable trailer construction",
          "Electrical connection compatible with generator or site power",
        ],
        terms: [
          "Trailers inspected prior to delivery",
          "Warranty and maintenance options available",
          "50% deposit",
          "Balance upon receipt",
        ],
      });
      if (result.synced) {
        logOpp(`Auto-invoice created for ${companyName}: $${result.total?.toLocaleString()}`);
      }
    } catch (e: any) {
      logOpp(`Auto-invoice error for ${companyName}: ${e.message}`);
    }
  })();
}

export async function handleCallOutcome(
  companyName: string,
  outcome: string,
  notes?: string,
  clientId?: string,
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
        if (clientId) {
          syncDealToHubSpotBackground(clientId, companyName, "Won");
          autoCreateInvoiceBackground(clientId, companyName, existing.fields.Value_Estimate);
        }
        return { action: "updated_to_won", opportunityId: existing.id };
      } else {
        const rec = await createOpportunity({
          Company: companyName,
          Stage: "Won",
          Source: "Call Engine",
          Last_Updated: new Date().toISOString(),
          Notes: notes || "",
        });
        if (clientId) {
          syncDealToHubSpotBackground(clientId, companyName, "Won");
          autoCreateInvoiceBackground(clientId, companyName);
        }
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
        if (clientId) {
          syncDealToHubSpotBackground(clientId, companyName, "Lost");
        }
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

        if (clientId) {
          syncDealToHubSpotBackground(clientId, companyName, stage);
        }

        return { action: "created_qualified", opportunityId: rec?.id };
      }
    }

    return null;
  } catch (e: any) {
    logOpp(`handleCallOutcome error for ${companyName}/${outcome}: ${e.message}`);
    return null;
  }
}

async function resolveCompanyNames(recordIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (recordIds.length === 0) return map;

  const unique = [...new Set(recordIds)];
  const table = encodeURIComponent("Companies");
  const chunks = [];
  for (let i = 0; i < unique.length; i += 10) {
    chunks.push(unique.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    const orParts = chunk.map(id => `RECORD_ID()='${id}'`).join(",");
    const formula = encodeURIComponent(`OR(${orParts})`);
    try {
      const data = await airtableRequest(`${table}?filterByFormula=${formula}&fields[]=Company_Name`);
      for (const rec of data.records || []) {
        map.set(rec.id, String(rec.fields.Company_Name || ""));
      }
    } catch (e: any) {
      logOpp(`resolveCompanyNames error: ${e.message}`);
    }
  }

  return map;
}

function extractCompanyName(companyField: any, nameMap: Map<string, string>): string {
  if (Array.isArray(companyField) && companyField.length > 0) {
    return nameMap.get(companyField[0]) || companyField[0];
  }
  if (typeof companyField === "string") return companyField;
  return "";
}

function extractOwner(ownerField: any): string {
  if (!ownerField) return "";
  if (typeof ownerField === "string") return ownerField;
  if (typeof ownerField === "object" && ownerField.name) return ownerField.name;
  if (typeof ownerField === "object" && ownerField.email) return ownerField.email;
  return "";
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

      const allCompanyIds: string[] = [];
      for (const rec of records) {
        if (Array.isArray(rec.fields.Company)) {
          allCompanyIds.push(...rec.fields.Company);
        }
      }
      const nameMap = await resolveCompanyNames(allCompanyIds);

      const opportunities = records.map((rec: AirtableRecord) => ({
        id: rec.id,
        company: extractCompanyName(rec.fields.Company, nameMap),
        stage: String(rec.fields.Stage || ""),
        next_action: String(rec.fields.Next_Action || ""),
        next_action_due: String(rec.fields.Next_Action_Due || ""),
        owner: extractOwner(rec.fields.Owner),
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
      const clientId = (req as any).user?.clientId;

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

      delete updates.Owner;

      const rec = await updateOpportunity(id, updates);
      if (!rec) {
        return res.status(500).json({ error: "Failed to update opportunity" });
      }

      let companyName = "";
      if (Array.isArray(rec.fields.Company) && rec.fields.Company.length > 0) {
        const nameMap = await resolveCompanyNames(rec.fields.Company);
        companyName = nameMap.get(rec.fields.Company[0]) || rec.fields.Company[0];
      } else {
        companyName = String(rec.fields.Company || "");
      }

      if (stage === "Won" && clientId && companyName) {
        syncDealToHubSpotBackground(clientId, companyName, "Won");
        autoCreateInvoiceBackground(clientId, companyName, rec.fields.Value_Estimate);
      }

      res.json({
        id: rec.id,
        company: companyName,
        stage: String(rec.fields.Stage || ""),
        next_action: String(rec.fields.Next_Action || ""),
        next_action_due: String(rec.fields.Next_Action_Due || ""),
        owner: extractOwner(rec.fields.Owner),
        value_estimate: rec.fields.Value_Estimate ?? null,
        last_updated: String(rec.fields.Last_Updated || ""),
        notes: String(rec.fields.Notes || ""),
      });
    } catch (err: any) {
      logOpp(`POST /api/opportunities/:id/update error: ${err.message}`);
      res.status(500).json({ error: "Failed to update opportunity" });
    }
  });

  app.post("/api/opportunities/:id/invoice", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const clientId = (req as any).user?.clientId;
      if (!clientId) {
        return res.status(400).json({ error: "No client context" });
      }

      const connected = await isHubSpotConnected(clientId);
      if (!connected) {
        return res.status(400).json({ error: "HubSpot not connected" });
      }

      const table = encodeURIComponent("Opportunities");
      const fields = ["Company", "Stage", "Value_Estimate", "Notes"];
      const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&");
      const oppData = await airtableRequest(`${table}/${id}?${fieldParams}`);

      let companyName = "";
      if (Array.isArray(oppData.fields.Company) && oppData.fields.Company.length > 0) {
        const nameMap = await resolveCompanyNames(oppData.fields.Company);
        companyName = nameMap.get(oppData.fields.Company[0]) || "";
      } else if (typeof oppData.fields.Company === "string") {
        companyName = oppData.fields.Company;
      }

      if (!companyName) {
        return res.status(400).json({ error: "Could not resolve company name" });
      }

      const invoiceData: InvoiceData = {
        companyName,
        contactName: req.body.contactName,
        contactTitle: req.body.contactTitle,
        contactEmail: req.body.contactEmail,
        officeAddress: req.body.officeAddress,
        proposalTitle: req.body.proposalTitle,
        lineItems: req.body.lineItems || [],
        taxRate: req.body.taxRate ?? 0,
        terms: req.body.terms || [],
        features: req.body.features || [],
        depositPercent: req.body.depositPercent,
      };

      if (!invoiceData.lineItems.length) {
        return res.status(400).json({ error: "At least one line item is required" });
      }

      const result = await createInvoiceInHubSpot(clientId, invoiceData);

      if (!result.synced) {
        return res.status(500).json({ error: "Failed to create invoice in HubSpot" });
      }

      res.json({
        success: true,
        noteId: result.noteId,
        dealId: result.dealId,
        total: result.total,
      });
    } catch (err: any) {
      logOpp(`POST /api/opportunities/:id/invoice error: ${err.message}`);
      res.status(500).json({ error: "Failed to create invoice" });
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
