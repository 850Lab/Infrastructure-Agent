import { log } from "./logger";
import { getHistory } from "./run-history";
import { scopedFormula } from "./airtable-scoped";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID || "";

export interface BriefingAction {
  type: "CALL" | "ENRICH_DM" | "FOLLOWUP" | "RUN_PIPELINE";
  company_id?: string;
  company_name?: string;
  title: string;
  reason: string;
}

export interface DailyBriefing {
  new_companies_24h: number;
  dms_found_24h: number;
  hot_followups_due_today: number;
  fresh_pool_count: number;
  today_list_count: number;
  recommended_actions: BriefingAction[];
  estimated_work_minutes: number;
  pipeline_ran_today: boolean;
  computed_at: number;
}

function hasAirtable(): boolean {
  return !!(AIRTABLE_API_KEY() && AIRTABLE_BASE_ID());
}

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

async function airtableFetch(
  table: string,
  formula: string,
  fields: string[],
  maxRecords?: number,
): Promise<AirtableRecord[]> {
  const key = AIRTABLE_API_KEY();
  const base = AIRTABLE_BASE_ID();
  if (!key || !base) return [];

  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  try {
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (formula) params.set("filterByFormula", formula);
      for (const f of fields) params.append("fields[]", f);
      if (offset) params.set("offset", offset);

      const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) return records;

      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset;

      if (maxRecords && records.length >= maxRecords) break;
    } while (offset);
  } catch (e: any) {
    log(`Briefing airtable fetch error (${table}): ${e.message}`, "briefing");
  }

  return maxRecords ? records.slice(0, maxRecords) : records;
}

async function countRecords(table: string, formula: string): Promise<number> {
  const records = await airtableFetch(table, formula, ["Company_Name"]);
  return records.length;
}

function pipelineRanToday(): boolean {
  const history = getHistory();
  if (history.length === 0) return false;

  const latest = history[0];
  const now = new Date();
  const runDate = new Date(latest.started_at);

  return (
    runDate.getFullYear() === now.getFullYear() &&
    runDate.getMonth() === now.getMonth() &&
    runDate.getDate() === now.getDate() &&
    (latest.status === "completed" || latest.status === "running")
  );
}

export async function computeDailyBriefing(clientId?: string): Promise<DailyBriefing> {
  if (!hasAirtable()) {
    return emptyBriefing();
  }

  log("Computing daily briefing...", "briefing");

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const sf = (formula: string) => clientId ? scopedFormula(clientId, formula) : formula;

  const [
    newCompanies24h,
    freshPool,
    todayList,
    followupsDueToday,
    dmGaps,
    hotBucket,
  ] = await Promise.all([
    countRecords("Companies", sf(`IS_AFTER({First_Seen},'${yesterday}')`)),
    countRecords("Companies", sf("OR({Times_Called}=0,{Lead_Status}='New')")),
    airtableFetch(
      "Companies",
      sf("{Today_Call_List}=TRUE()"),
      ["Company_Name", "Offer_DM_Name", "Bucket", "Followup_Due", "Final_Priority", "Primary_DM_Name", "Lead_Status"],
    ),
    airtableFetch(
      "Companies",
      sf(`AND({Followup_Due}!='',IS_BEFORE({Followup_Due},DATEADD(TODAY(),1,'day')),{Lead_Status}!='Won',{Lead_Status}!='Lost')`),
      ["Company_Name", "Followup_Due", "Last_Outcome", "Primary_DM_Name"],
    ),
    airtableFetch(
      "Companies",
      sf("AND({Today_Call_List}=TRUE(),{Offer_DM_Name}='')"),
      ["Company_Name", "Primary_DM_Name"],
      10,
    ),
    airtableFetch(
      "Companies",
      sf("AND({Bucket}='Hot Follow-up',{Lead_Status}!='Won',{Lead_Status}!='Lost')"),
      ["Company_Name", "Final_Priority", "Primary_DM_Name", "Last_Outcome"],
      10,
    ),
  ]);

  const dmsFound24h = todayList.filter(
    (r) => r.fields.Offer_DM_Name && String(r.fields.Offer_DM_Name).trim(),
  ).length;

  const ranToday = pipelineRanToday();
  const actions: BriefingAction[] = [];

  if (!ranToday) {
    actions.push({
      type: "RUN_PIPELINE",
      title: "Run daily pipeline",
      reason: "Pipeline has not run today. Run it to refresh your call list and targeting.",
    });
  }

  for (const rec of followupsDueToday.slice(0, 5)) {
    if (actions.length >= 5) break;
    actions.push({
      type: "FOLLOWUP",
      company_id: rec.id,
      company_name: rec.fields.Company_Name || "",
      title: `Follow up with ${rec.fields.Company_Name || "company"}`,
      reason: rec.fields.Last_Outcome
        ? `Last outcome: ${rec.fields.Last_Outcome}. Follow-up is due today.`
        : "Scheduled follow-up is due today.",
    });
  }

  for (const rec of hotBucket) {
    if (actions.length >= 5) break;
    const alreadyListed = actions.some(
      (a) => a.company_id === rec.id,
    );
    if (alreadyListed) continue;
    actions.push({
      type: "CALL",
      company_id: rec.id,
      company_name: rec.fields.Company_Name || "",
      title: `Call ${rec.fields.Company_Name || "company"}`,
      reason: rec.fields.Primary_DM_Name
        ? `Hot lead. Ask for ${rec.fields.Primary_DM_Name}.`
        : "Hot lead in your pipeline.",
    });
  }

  for (const rec of dmGaps) {
    if (actions.length >= 5) break;
    actions.push({
      type: "ENRICH_DM",
      company_id: rec.id,
      company_name: rec.fields.Company_Name || "",
      title: `Find DM for ${rec.fields.Company_Name || "company"}`,
      reason: "On today's call list but missing a decision maker contact.",
    });
  }

  if (actions.length < 5 && ranToday) {
    const freshOnList = todayList
      .filter((r) => r.fields.Bucket === "Fresh")
      .sort((a, b) => (b.fields.Final_Priority || 0) - (a.fields.Final_Priority || 0));

    for (const rec of freshOnList) {
      if (actions.length >= 5) break;
      const alreadyListed = actions.some((a) => a.company_id === rec.id);
      if (alreadyListed) continue;
      actions.push({
        type: "CALL",
        company_id: rec.id,
        company_name: rec.fields.Company_Name || "",
        title: `Cold call ${rec.fields.Company_Name || "company"}`,
        reason: "Fresh lead on today's list, ready for first contact.",
      });
    }
  }

  const callCount = actions.filter((a) => a.type === "CALL" || a.type === "FOLLOWUP").length;
  const enrichCount = actions.filter((a) => a.type === "ENRICH_DM").length;
  const estimatedMinutes = callCount * 4 + enrichCount * 1 + (actions.some((a) => a.type === "RUN_PIPELINE") ? 2 : 0);

  const briefing: DailyBriefing = {
    new_companies_24h: newCompanies24h,
    dms_found_24h: dmsFound24h,
    hot_followups_due_today: followupsDueToday.length,
    fresh_pool_count: freshPool,
    today_list_count: todayList.length,
    recommended_actions: actions,
    estimated_work_minutes: estimatedMinutes,
    pipeline_ran_today: ranToday,
    computed_at: Date.now(),
  };

  log(`Briefing computed: ${actions.length} actions, ~${estimatedMinutes}min work`, "briefing");
  return briefing;
}

function emptyBriefing(): DailyBriefing {
  return {
    new_companies_24h: 0,
    dms_found_24h: 0,
    hot_followups_due_today: 0,
    fresh_pool_count: 0,
    today_list_count: 0,
    recommended_actions: [{
      type: "RUN_PIPELINE",
      title: "Run daily pipeline",
      reason: "No data available. Run the pipeline to populate your briefing.",
    }],
    estimated_work_minutes: 2,
    pipeline_ran_today: false,
    computed_at: Date.now(),
  };
}
