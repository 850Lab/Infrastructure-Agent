function log(message: string, source = "schema") {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [${source}] ${message}`);
}

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

interface AirtableField {
  id: string;
  name: string;
  type: string;
  options?: any;
}

interface AirtableTable {
  id: string;
  name: string;
  fields: AirtableField[];
}

interface SchemaReport {
  tables_created: string[];
  fields_created: Array<{ table: string; field: string }>;
  fields_existing_count: number;
  type_mismatches: Array<{ table: string; field: string; expected: string; actual: string }>;
  link_deferred: boolean;
}

async function metaRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) throw new Error("AIRTABLE_API_KEY / AIRTABLE_BASE_ID not configured");
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable Meta API (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function getBaseSchema(): Promise<AirtableTable[]> {
  const data = await metaRequest("/tables");
  return (data.tables || []).map((t: any) => ({
    id: t.id,
    name: t.name,
    fields: (t.fields || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
    })),
  }));
}

export async function ensureTable(
  tables: AirtableTable[],
  tableName: string,
  description?: string
): Promise<{ table: AirtableTable; created: boolean }> {
  const existing = tables.find(t => t.name === tableName);
  if (existing) {
    return { table: existing, created: false };
  }

  log(`Creating table: ${tableName}`, "schema");
  const body: any = {
    name: tableName,
    fields: [{ name: "Name", type: "singleLineText" }],
  };
  if (description) body.description = description;

  const created = await metaRequest("/tables", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const newTable: AirtableTable = {
    id: created.id,
    name: created.name,
    fields: (created.fields || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
    })),
  };

  return { table: newTable, created: true };
}

export async function ensureField(
  table: AirtableTable,
  fieldName: string,
  fieldType: string,
  options?: any,
  report?: SchemaReport
): Promise<{ created: boolean; mismatch: boolean }> {
  const existing = table.fields.find(f => f.name === fieldName);

  if (existing) {
    if (existing.type !== fieldType) {
      log(`TYPE_MISMATCH: ${table.name}.${fieldName} expected=${fieldType} actual=${existing.type}`, "schema");
      if (report) {
        report.type_mismatches.push({
          table: table.name,
          field: fieldName,
          expected: fieldType,
          actual: existing.type,
        });
      }
      return { created: false, mismatch: true };
    }
    return { created: false, mismatch: false };
  }

  log(`Creating field: ${table.name}.${fieldName} (${fieldType})`, "schema");

  const body: any = { name: fieldName, type: fieldType };
  if (options) body.options = options;

  try {
    const created = await metaRequest(`/tables/${table.id}/fields`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    table.fields.push({
      id: created.id,
      name: created.name,
      type: created.type,
      options: created.options,
    });

    return { created: true, mismatch: false };
  } catch (e: any) {
    log(`Failed to create field ${table.name}.${fieldName}: ${e.message}`, "schema");
    return { created: false, mismatch: false };
  }
}

const CATEGORY_OPTIONS = {
  choices: [
    { name: "Scaffolding", color: "blueLight2" },
    { name: "Insulation", color: "cyanLight2" },
    { name: "Industrial Maintenance", color: "tealLight2" },
    { name: "Turnaround", color: "greenLight2" },
    { name: "Tank Cleaning", color: "yellowLight2" },
    { name: "Coatings", color: "orangeLight2" },
    { name: "Mechanical", color: "redLight2" },
    { name: "Construction", color: "pinkLight2" },
    { name: "Other", color: "grayLight2" },
  ],
};

interface FieldSpec {
  name: string;
  type: string;
  options?: any;
}

const SEARCH_QUERIES_FIELDS: FieldSpec[] = [
  { name: "Query", type: "singleLineText" },
  {
    name: "Market",
    type: "singleSelect",
    options: { choices: [{ name: "Gulf Coast", color: "blueLight2" }] },
  },
  { name: "Category", type: "singleSelect", options: CATEGORY_OPTIONS },
  {
    name: "Status",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Queued", color: "blueLight2" },
        { name: "Running", color: "yellowLight2" },
        { name: "Done", color: "greenLight2" },
        { name: "Error", color: "redLight2" },
      ],
    },
  },
  {
    name: "Last_Run",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Results_Count", type: "number", options: { precision: 0 } },
  { name: "Notes", type: "multilineText" },
  { name: "Performance_Score", type: "number", options: { precision: 0 } },
  { name: "Runs", type: "number", options: { precision: 0 } },
  { name: "Wins", type: "number", options: { precision: 0 } },
  { name: "Last_Generated_By", type: "singleLineText" },
  {
    name: "Generation_Mode",
    type: "singleSelect",
    options: {
      choices: [
        { name: "ColdStart", color: "blueLight2" },
        { name: "QueryIntel", color: "cyanLight2" },
        { name: "WinPattern", color: "greenLight2" },
      ],
    },
  },
  { name: "Leads_Produced", type: "number", options: { precision: 0 } },
  { name: "DM_Found_Count", type: "number", options: { precision: 0 } },
  { name: "Positive_Call_Count", type: "number", options: { precision: 0 } },
  { name: "Opportunity_Count", type: "number", options: { precision: 0 } },
  { name: "Retired", type: "checkbox", options: { color: "greenBright", icon: "check" } },
];

const COMPANIES_FIELDS: FieldSpec[] = [
  { name: "Company_Name", type: "singleLineText" },
  { name: "Normalized_Name", type: "singleLineText" },
  { name: "Website", type: "url" },
  { name: "Normalized_Domain", type: "singleLineText" },
  { name: "Phone", type: "singleLineText" },
  { name: "City", type: "singleLineText" },
  { name: "State", type: "singleLineText" },
  { name: "Category", type: "singleSelect", options: CATEGORY_OPTIONS },
  { name: "Outscraper_Place_ID", type: "singleLineText" },
  { name: "Dedupe_Key", type: "singleLineText" },
  { name: "Priority_Score", type: "number", options: { precision: 0 } },
  {
    name: "Priority_Tier",
    type: "singleSelect",
    options: {
      choices: [
        { name: "A", color: "greenLight2" },
        { name: "B", color: "yellowLight2" },
        { name: "C", color: "redLight2" },
      ],
    },
  },
  {
    name: "Lead_Status",
    type: "singleSelect",
    options: {
      choices: [
        { name: "New", color: "blueLight2" },
        { name: "Enriched", color: "cyanLight2" },
        { name: "Called", color: "yellowLight2" },
        { name: "Working", color: "orangeLight2" },
        { name: "Won", color: "greenLight2" },
        { name: "Lost", color: "redLight2" },
      ],
    },
  },
  { name: "Source", type: "singleLineText" },
  { name: "Emails", type: "multilineText" },
  { name: "Notes", type: "multilineText" },
  {
    name: "Last_Enriched",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Opportunity_Signal", type: "singleLineText" },
  {
    name: "Opportunity_Type",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Turnaround", color: "blueLight2" },
        { name: "Maintenance", color: "cyanLight2" },
        { name: "Industrial Contractor", color: "tealLight2" },
        { name: "Plant Services", color: "greenLight2" },
        { name: "Unknown", color: "grayLight2" },
      ],
    },
  },
  { name: "Engagement_Score", type: "number", options: { precision: 0 } },
  { name: "Opportunity_Score", type: "number", options: { precision: 0 } },
  { name: "Opportunity_Notes", type: "multilineText" },
  {
    name: "Opportunity_Last_Checked",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  {
    name: "First_Seen",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Times_Called", type: "number", options: { precision: 0 } },
  { name: "Last_Outcome", type: "singleLineText" },
  {
    name: "Followup_Due",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  {
    name: "Bucket",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Hot Follow-up", color: "redLight2" },
        { name: "Working", color: "orangeLight2" },
        { name: "Fresh", color: "blueLight2" },
        { name: "Hold", color: "grayLight2" },
      ],
    },
  },
  { name: "Final_Priority", type: "number", options: { precision: 0 } },
  { name: "Today_Call_List", type: "checkbox", options: { color: "greenBright", icon: "check" } },
  { name: "Primary_DM_Name", type: "singleLineText" },
  { name: "Primary_DM_Title", type: "singleLineText" },
  { name: "Primary_DM_Email", type: "singleLineText" },
  { name: "Primary_DM_Phone", type: "singleLineText" },
  { name: "Primary_DM_Seniority", type: "singleLineText" },
  { name: "Primary_DM_Source", type: "singleLineText" },
  { name: "Primary_DM_Confidence", type: "number", options: { precision: 0 } },
  {
    name: "DM_Coverage_Status",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Missing", color: "redLight2" },
        { name: "Queued", color: "yellowLight2" },
        { name: "Enriching", color: "blueLight2" },
        { name: "Ready", color: "greenLight2" },
        { name: "Error", color: "redDark1" },
      ],
    },
  },
  {
    name: "DM_Last_Enriched",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "DM_Count", type: "number", options: { precision: 0 } },
  { name: "Source_Query", type: "singleLineText" },
  { name: "Source_Query_Mode", type: "singleLineText" },
  { name: "Win_Flag", type: "checkbox", options: { color: "greenBright", icon: "check" } },
  { name: "Gatekeeper_Name", type: "singleLineText" },
  { name: "Gatekeeper_Phone", type: "singleLineText" },
  { name: "Gatekeeper_Email", type: "singleLineText" },
  {
    name: "Gatekeeper_Last_Spoken",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Gatekeeper_Notes", type: "multilineText" },
  { name: "Social_Media", type: "singleLineText" },
  { name: "Rank_Reason", type: "multilineText" },
  { name: "Rank_Evidence", type: "multilineText" },
  { name: "Rank_Inputs_JSON", type: "multilineText" },
  { name: "Rank_Version", type: "singleLineText" },
  { name: "Offer_DM_Name", type: "singleLineText" },
  { name: "Offer_DM_Title", type: "singleLineText" },
  { name: "Offer_DM_Email", type: "singleLineText" },
  { name: "Offer_DM_Phone", type: "singleLineText" },
  { name: "Offer_DM_FitScore", type: "number", options: { precision: 0 } },
  { name: "Offer_DM_Reason", type: "multilineText" },
  { name: "Offer_DM_Source", type: "singleLineText" },
  {
    name: "Offer_DM_Last_Selected",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Playbook_Call_Opener", type: "multilineText" },
  { name: "Playbook_Gatekeeper_Ask", type: "multilineText" },
  { name: "Playbook_Voicemail", type: "multilineText" },
  { name: "Playbook_Email_Subject", type: "singleLineText" },
  { name: "Playbook_Email_Body", type: "multilineText" },
  { name: "Playbook_Followup_Text", type: "multilineText" },
  { name: "Playbook_Version", type: "singleLineText" },
  {
    name: "Playbook_Last_Generated",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Playbook_Strategy_Notes", type: "multilineText" },
  { name: "Playbook_Learning_Version", type: "singleLineText" },
  { name: "Playbook_Applied_Patches", type: "multilineText" },
  { name: "Playbook_Confidence", type: "number", options: { precision: 0 } },
  {
    name: "Offer_DM_Outcome",
    type: "singleSelect",
    options: {
      choices: [
        { name: "reached_dm", color: "cyanLight2" },
        { name: "wrong_person", color: "yellowLight2" },
        { name: "no_authority", color: "orangeLight2" },
        { name: "converted", color: "greenLight2" },
        { name: "rejected", color: "redLight2" },
      ],
    },
  },
  { name: "Offer_DM_Title_At_Contact", type: "singleLineText" },
  { name: "Authority_Miss_Count", type: "number", options: { precision: 0 } },
  {
    name: "DM_Status",
    type: "singleSelect",
    options: {
      choices: [
        { name: "DM_READY", color: "greenLight2" },
        { name: "DM_WEAK", color: "yellowLight2" },
        { name: "NO_DM", color: "redLight2" },
        { name: "NO_EMAIL", color: "orangeLight2" },
        { name: "NO_PHONE", color: "orangeLight2" },
        { name: "GENERIC_CONTACT", color: "yellowLight2" },
        { name: "NO_WEBSITE", color: "redLight2" },
        { name: "AUTHORITY_MISMATCH", color: "redLight2" },
        { name: "RECOVERY_IN_PROGRESS", color: "cyanLight2" },
        { name: "READY_FOR_OUTREACH", color: "greenLight2" },
      ],
    },
  },
  {
    name: "DM_Last_Checked",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Recovery_Plan", type: "multilineText" },
  { name: "Recovery_Attempts", type: "number", options: { precision: 0 } },
  {
    name: "Recovery_Last_Run",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
];

const CALLS_FIELDS: FieldSpec[] = [
  { name: "Company", type: "singleLineText" },
  {
    name: "Call_Time",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  {
    name: "Outcome",
    type: "singleSelect",
    options: {
      choices: [
        { name: "No Answer", color: "grayLight2" },
        { name: "Gatekeeper", color: "blueLight2" },
        { name: "Decision Maker", color: "cyanLight2" },
        { name: "Qualified", color: "greenLight2" },
        { name: "Not Interested", color: "redLight2" },
        { name: "Callback", color: "yellowLight2" },
        { name: "Won", color: "greenLight2" },
        { name: "Lost", color: "redLight2" },
        { name: "NoAuthority", color: "orangeLight2" },
      ],
    },
  },
  { name: "Notes", type: "multilineText" },
  { name: "VoiceMemo_URL", type: "url" },
  { name: "Transcription", type: "multilineText" },
  { name: "Analysis", type: "multilineText" },
  {
    name: "Next_Followup",
    type: "dateTime",
    options: {
      dateFormat: { name: "iso" },
      timeFormat: { name: "24hour" },
      timeZone: "America/Chicago",
    },
  },
  { name: "Processed", type: "checkbox", options: { color: "greenBright", icon: "check" } },
  { name: "Gatekeeper_Name", type: "singleLineText" },
  { name: "Sales_Learning_Processed", type: "checkbox", options: { color: "greenBright", icon: "check" } },
  { name: "No_Authority", type: "checkbox", options: { color: "orangeBright", icon: "check" } },
  { name: "Authority_Reason", type: "multilineText" },
];

export async function ensureSchema(): Promise<SchemaReport> {
  const report: SchemaReport = {
    tables_created: [],
    fields_created: [],
    fields_existing_count: 0,
    type_mismatches: [],
    link_deferred: false,
  };

  log("=== Bootstrap Schema: fetching current schema ===", "schema");
  let tables = await getBaseSchema();
  log(`Found ${tables.length} existing tables`, "schema");

  const DM_FIELDS: FieldSpec[] = [
    { name: "company_name_text", type: "singleLineText" },
    { name: "full_name", type: "singleLineText" },
    { name: "title", type: "singleLineText" },
    { name: "email", type: "singleLineText" },
    { name: "phone", type: "singleLineText" },
    { name: "linkedin_url", type: "singleLineText" },
    { name: "seniority", type: "singleLineText" },
    { name: "department", type: "singleLineText" },
    { name: "source", type: "singleLineText" },
    {
      name: "enriched_at",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
  ];

  const RUN_HISTORY_FIELDS: FieldSpec[] = [
    { name: "run_id", type: "singleLineText" },
    {
      name: "started_at",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
    {
      name: "finished_at",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
    {
      name: "status",
      type: "singleSelect",
      options: {
        choices: [
          { name: "running", color: "yellowBright" },
          { name: "success", color: "greenBright" },
          { name: "error", color: "redBright" },
        ],
      },
    },
    { name: "steps_json", type: "multilineText" },
    { name: "summary_json", type: "multilineText" },
    { name: "errors_json", type: "multilineText" },
    { name: "duration_ms", type: "number", options: { precision: 0 } },
  ];

  const OPPORTUNITIES_FIELDS: FieldSpec[] = [
    { name: "Company", type: "singleLineText" },
    {
      name: "Stage",
      type: "singleSelect",
      options: {
        choices: [
          { name: "Qualified", color: "blueLight2" },
          { name: "SiteWalk", color: "cyanLight2" },
          { name: "QuoteSent", color: "yellowLight2" },
          { name: "DeploymentScheduled", color: "orangeLight2" },
          { name: "Won", color: "greenLight2" },
          { name: "Lost", color: "redLight2" },
        ],
      },
    },
    { name: "Next_Action", type: "multilineText" },
    {
      name: "Next_Action_Due",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
    { name: "Owner", type: "singleLineText" },
    { name: "Value_Estimate", type: "number", options: { precision: 0 } },
    { name: "Source", type: "singleLineText" },
    {
      name: "Last_Updated",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
    { name: "Notes", type: "multilineText" },
  ];

  const CALL_OBSERVATIONS_FIELDS: FieldSpec[] = [
    { name: "Client_ID", type: "singleLineText" },
    { name: "Call_ID", type: "singleLineText" },
    { name: "Company_ID", type: "singleLineText" },
    { name: "Company_Name", type: "singleLineText" },
    {
      name: "Detected_Speaker_Mode",
      type: "singleSelect",
      options: { choices: [
        { name: "Flat", color: "grayLight2" },
        { name: "Partial", color: "blueLight2" },
        { name: "Diarized", color: "greenLight2" },
      ]},
    },
    { name: "Gatekeeper_Name", type: "singleLineText" },
    { name: "Opener_Used", type: "multilineText" },
    { name: "Value_Prop_Used", type: "multilineText" },
    { name: "Qualifying_Questions_Asked", type: "number", options: { precision: 0 } },
    { name: "Authority_Redirect_Attempted", type: "checkbox", options: { color: "greenBright", icon: "check" } },
    { name: "Authority_Redirect_Success", type: "checkbox", options: { color: "greenBright", icon: "check" } },
    { name: "Deflection_Phrase", type: "singleLineText" },
    {
      name: "Objection_Type",
      type: "singleSelect",
      options: { choices: [
        { name: "already_have", color: "blueLight2" },
        { name: "not_interested", color: "redLight2" },
        { name: "bad_timing", color: "yellowLight2" },
        { name: "no_budget", color: "orangeLight2" },
        { name: "wrong_person", color: "grayLight2" },
        { name: "none_detected", color: "greenLight2" },
      ]},
    },
    {
      name: "Prospect_Engagement",
      type: "singleSelect",
      options: { choices: [
        { name: "Dismissive", color: "redLight2" },
        { name: "Neutral", color: "grayLight2" },
        { name: "Curious", color: "blueLight2" },
        { name: "Interested", color: "cyanLight2" },
        { name: "Qualified", color: "greenLight2" },
      ]},
    },
    {
      name: "Operator_Performance",
      type: "singleSelect",
      options: { choices: [
        { name: "Strong", color: "greenLight2" },
        { name: "Mixed", color: "yellowLight2" },
        { name: "Weak", color: "redLight2" },
      ]},
    },
    { name: "Talk_Ratio_Operator", type: "number", options: { precision: 0 } },
    { name: "Talk_Ratio_Prospect", type: "number", options: { precision: 0 } },
    { name: "Outcome", type: "singleLineText" },
    { name: "Call_Duration", type: "singleLineText" },
    { name: "Evidence_JSON", type: "multilineText" },
    {
      name: "Created_At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
  ];

  const CALL_LEARNING_FIELDS: FieldSpec[] = [
    { name: "Client_ID", type: "singleLineText" },
    { name: "Call_ID", type: "singleLineText" },
    { name: "Company_ID", type: "singleLineText" },
    { name: "Pattern_Types", type: "multilineText" },
    { name: "Failure_Modes", type: "multilineText" },
    { name: "Strength_Modes", type: "multilineText" },
    { name: "Severity_Score", type: "number", options: { precision: 0 } },
    { name: "Learning_Summary", type: "multilineText" },
    { name: "Coaching_Recommendation", type: "multilineText" },
    { name: "Patch_Types_Recommended", type: "multilineText" },
    {
      name: "Script_Impact_Level",
      type: "singleSelect",
      options: { choices: [
        { name: "Low", color: "grayLight2" },
        { name: "Medium", color: "yellowLight2" },
        { name: "High", color: "redLight2" },
      ]},
    },
    {
      name: "Strategy_Impact_Level",
      type: "singleSelect",
      options: { choices: [
        { name: "Low", color: "grayLight2" },
        { name: "Medium", color: "yellowLight2" },
        { name: "High", color: "redLight2" },
      ]},
    },
    {
      name: "Created_At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
  ];

  const PATTERN_INSIGHTS_FIELDS: FieldSpec[] = [
    { name: "Client_ID", type: "singleLineText" },
    { name: "Insight_Type", type: "singleLineText" },
    { name: "Segment_Key", type: "singleLineText" },
    { name: "Pattern_Description", type: "multilineText" },
    { name: "Sample_Size", type: "number", options: { precision: 0 } },
    { name: "Confidence_Score", type: "number", options: { precision: 0 } },
    { name: "Recommended_Action", type: "multilineText" },
    { name: "Recommended_Targeting_Change", type: "multilineText" },
    { name: "Recommended_Script_Change", type: "multilineText" },
    { name: "Recommended_Sequence_Change", type: "multilineText" },
    { name: "Active", type: "checkbox", options: { color: "greenBright", icon: "check" } },
    {
      name: "Created_At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
    {
      name: "Updated_At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
  ];

  const SCRIPT_PATCHES_FIELDS: FieldSpec[] = [
    { name: "Client_ID", type: "singleLineText" },
    { name: "Patch_Type", type: "singleLineText" },
    { name: "Trigger_Pattern", type: "multilineText" },
    { name: "Patch_Title", type: "singleLineText" },
    { name: "Patch_Instruction", type: "multilineText" },
    {
      name: "Patch_Priority",
      type: "singleSelect",
      options: { choices: [
        { name: "High", color: "redLight2" },
        { name: "Medium", color: "yellowLight2" },
        { name: "Low", color: "grayLight2" },
      ]},
    },
    { name: "Applies_To_Bucket", type: "singleLineText" },
    { name: "Applies_To_Industry", type: "singleLineText" },
    { name: "Active", type: "checkbox", options: { color: "greenBright", icon: "check" } },
    {
      name: "Source",
      type: "singleSelect",
      options: { choices: [
        { name: "Rule Engine", color: "blueLight2" },
        { name: "Pattern Insight", color: "cyanLight2" },
        { name: "Manual", color: "grayLight2" },
      ]},
    },
    {
      name: "Created_At",
      type: "dateTime",
      options: {
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
        timeZone: "America/Chicago",
      },
    },
  ];

  const tableSpecs: Array<{ name: string; fields: FieldSpec[]; description?: string }> = [
    { name: "Search_Queries", fields: SEARCH_QUERIES_FIELDS, description: "Search queries for Outscraper lead generation" },
    { name: "Companies", fields: COMPANIES_FIELDS, description: "Companies/leads database" },
    { name: "Calls", fields: CALLS_FIELDS, description: "Call records and outcomes" },
    { name: "Decision_Makers", fields: DM_FIELDS, description: "Decision maker contacts for companies" },
    { name: "Run_History", fields: RUN_HISTORY_FIELDS, description: "Persistent run history for the daily orchestrator" },
    { name: "Opportunities", fields: OPPORTUNITIES_FIELDS, description: "Pipeline opportunities from call outcomes" },
    {
      name: "User_Config",
      fields: [
        { name: "email", type: "singleLineText" },
        { name: "machine_name", type: "singleLineText" },
        { name: "market", type: "singleLineText" },
        { name: "opportunity", type: "singleLineText" },
        { name: "decision_maker_focus", type: "singleLineText" },
        { name: "geo", type: "singleLineText" },
        { name: "industry_config_selected", type: "singleLineText" },
        {
          name: "created_at",
          type: "dateTime",
          options: {
            dateFormat: { name: "iso" },
            timeFormat: { name: "24hour" },
            timeZone: "America/Chicago",
          },
        },
      ],
      description: "Per-user machine configuration from onboarding",
    },
    { name: "Call_Observations", fields: CALL_OBSERVATIONS_FIELDS, description: "Structured event capture from each analyzed call" },
    { name: "Call_Learning", fields: CALL_LEARNING_FIELDS, description: "Interpreted analysis and learning signals per call" },
    { name: "Pattern_Insights", fields: PATTERN_INSIGHTS_FIELDS, description: "Aggregated patterns across multiple calls" },
    { name: "Script_Patches", fields: SCRIPT_PATCHES_FIELDS, description: "Structured script modification recommendations" },
    {
      name: "Script_Versions",
      fields: [
        { name: "Client_ID", type: "singleLineText" },
        { name: "Company_ID", type: "singleLineText" },
        { name: "Company_Name", type: "singleLineText" },
        { name: "Bucket", type: "singleLineText" },
        { name: "Version_Label", type: "singleLineText" },
        { name: "Applied_Patches", type: "multilineText" },
        { name: "Source_Insight_IDs", type: "multilineText" },
        { name: "Script_Snapshot_JSON", type: "multilineText" },
        { name: "Confidence", type: "number", options: { precision: 0 } },
        {
          name: "Created_At",
          type: "dateTime",
          options: {
            dateFormat: { name: "iso" },
            timeFormat: { name: "24hour" },
            timeZone: "America/Chicago",
          },
        },
      ],
      description: "Versioned script snapshots with applied patches and confidence",
    },
  ];

  for (const spec of tableSpecs) {
    const { table, created } = await ensureTable(tables, spec.name, spec.description);
    if (created) {
      report.tables_created.push(spec.name);
      tables.push(table);
    }

    for (const fieldSpec of spec.fields) {
      const { created: fieldCreated, mismatch } = await ensureField(
        table,
        fieldSpec.name,
        fieldSpec.type,
        fieldSpec.options,
        report
      );

      if (fieldCreated) {
        report.fields_created.push({ table: spec.name, field: fieldSpec.name });
      } else if (!mismatch) {
        report.fields_existing_count++;
      }
    }
  }

  const callsTable = tables.find(t => t.name === "Calls");
  if (callsTable) {
    const companyField = callsTable.fields.find(f => f.name === "Company");
    if (companyField && companyField.type === "singleLineText") {
      log("LINK_DEFERRED: Calls.Company created as singleLineText — manual conversion to link required", "schema");
      report.link_deferred = true;
    }
  }

  log("=== Bootstrap Schema Complete ===", "schema");
  return report;
}

export function formatReport(report: SchemaReport): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════╗");
  lines.push("║       SCHEMA BOOTSTRAP REPORT        ║");
  lines.push("╚══════════════════════════════════════╝");
  lines.push("");

  lines.push(`Tables created: ${report.tables_created.length}`);
  if (report.tables_created.length > 0) {
    for (const t of report.tables_created) lines.push(`  + ${t}`);
  }
  lines.push("");

  lines.push(`Fields created: ${report.fields_created.length}`);
  if (report.fields_created.length > 0) {
    for (const f of report.fields_created) lines.push(`  + ${f.table}.${f.field}`);
  }
  lines.push("");

  lines.push(`Fields already existing: ${report.fields_existing_count}`);
  lines.push("");

  lines.push(`Type mismatches: ${report.type_mismatches.length}`);
  if (report.type_mismatches.length > 0) {
    for (const m of report.type_mismatches) {
      lines.push(`  ⚠ ${m.table}.${m.field}: expected=${m.expected}, actual=${m.actual}`);
    }
  }
  lines.push("");

  lines.push(`Link deferred: ${report.link_deferred}`);
  lines.push("");

  if (report.tables_created.length === 0 && report.fields_created.length === 0) {
    lines.push("✓ Schema is fully up to date — nothing to create.");
  } else {
    lines.push(`✓ Done. Created ${report.tables_created.length} tables and ${report.fields_created.length} fields.`);
  }

  return lines.join("\n");
}
