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

  const tableSpecs: Array<{ name: string; fields: FieldSpec[]; description?: string }> = [
    { name: "Search_Queries", fields: SEARCH_QUERIES_FIELDS, description: "Search queries for Outscraper lead generation" },
    { name: "Companies", fields: COMPANIES_FIELDS, description: "Companies/leads database" },
    { name: "Calls", fields: CALLS_FIELDS, description: "Call records and outcomes" },
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
