# Voice Memo Analyzer + Make Scenario Auditor

## Overview
A webhook-based voice memo processing system that receives Airtable record IDs, downloads audio attachments, transcribes them using OpenAI Whisper, analyzes for containment language using GPT, and writes results back to Airtable. Also includes a read-only Make.com Scenario Auditor that inventories scenarios, modules, run history, and generates audit findings.

## Architecture
- **Backend**: Express + TypeScript server on port 5000
- **Frontend**: React + Shadcn UI monitoring dashboard with multi-page routing
- **Database**: PostgreSQL (Replit built-in) for webhook processing logs
- **External Services**: Airtable REST API, OpenAI (Whisper + GPT), Make.com API

## Key Files

### Voice Memo Analyzer
- `shared/schema.ts` - Data models (webhookLogs table, validation schemas)
- `server/routes.ts` - API endpoints (webhook, logs, health)
- `server/airtable.ts` - Airtable API integration (fetch records, download audio, update records)
- `server/openai.ts` - OpenAI integration (Whisper transcription via direct API, GPT containment analysis via proxy)
- `server/storage.ts` - Database storage layer using Drizzle ORM

### Make Scenario Auditor
- `server/make.ts` - Make.com API client (region discovery, scenarios, blueprints, runs, blueprint JSON import)
- `server/make-routes.ts` - Make API endpoints (health, sync, blueprint import)
- `server/make-audit.ts` - Audit rules engine (findings generation, scenario ranking)
- `server/make-airtable.ts` - Airtable write functions for Make tables

### Foreman (Call Pack Generator)
- `server/foreman.ts` - Candidate fetching, deterministic scoring (+30 refinery, +20 phone, +15 geo, +20 website signals, +15 has DM, +5 DM email, +5 DM phone, +10 DM prob, +10 never contacted, +5 website), ranking, CallCenter push, Airtable tagging; DM names/titles included in call pack openers
- `server/foreman-routes.ts` - API endpoints (preview, generate, generate-and-tag)

### Decision Maker Enrichment
- `server/apollo.ts` - Apollo.io API client: org enrichment (employees, industry, description), People Search by domain (searchPeopleByDomain, enrichPerson), exponential backoff on 429s
- `server/dm-enrichment.ts` - DM pipeline: Apollo People Search (primary) → website crawl + GPT-4o extraction (fallback) → dedup by name → Airtable Decision_Makers write; supplemental website DMs merged when Apollo returns results; email generation for DMs without emails
- `server/dm-routes.ts` - API endpoints (stats, preview, enrich-one, enrich-batch, backfill-contacts)

### Outscraper (Website Lookup)
- `server/outscraper.ts` - Google Maps search via Outscraper API to find missing company websites
- `server/outscraper-routes.ts` - API endpoints (status, lookup-one, lookup-batch, lookup-then-enrich)

### Lead Feed Loop (Automated Lead Pipeline)
- `server/lead-feed.ts` - Full pipeline: OpenAI query generation → Outscraper lead pull → Airtable upsert + dedupe → Priority scoring → Website enrichment (emails, LinkedIn, service notes)
- `server/lead-feed-routes.ts` - API endpoints (stats, generate-queries, run-outscraper, enrich, run-all)
- Airtable tables: "Search Queries" (query_text, market, category, status, last_run, results_count, notes), "Companies" (+ Normalized_Name, Normalized_Domain, Dedupe_Key, Priority_Score, Lead_Status)
- Deduplication: Dedupe_Key priority: Normalized_Domain > phone digits > normalized_name|city|state; fallback lookup by LOWER(company_name)
- Priority scoring: +20 high-value category, +10 industrial keywords, +15 website, +10 phone, -10/-20 residential keywords; score 0-100

### Airtable Schema Bootstrap
- `server/airtable-schema.ts` - Meta API functions (getBaseSchema, ensureTable, ensureField, ensureSchema); idempotent table/field creation for Search_Queries, Companies, Calls, Decision_Makers
- `server/bootstrap.ts` - CLI runner: `npx tsx server/bootstrap.ts` to bootstrap all Airtable tables/fields

### Call Outcome Engine
- `server/call-engine.ts` - Processes logged calls: updates Company Lead_Status (Decision Maker/Qualified→Working, Won→Won, Not Interested→Lost), schedules follow-ups (No Answer +2d, Gatekeeper +7d, DM +5d, Qualified +3d, Callback +1d, Not Interested +90d), updates Engagement_Score (+10 DM, +20 Qualified, +40 Won, -10 Not Interested, +2 Gatekeeper), marks Processed=true
- Gatekeeper Memory: when Outcome=Gatekeeper and Calls.Gatekeeper_Name is set, writes Gatekeeper_Name/Gatekeeper_Last_Spoken to Companies; won't overwrite existing name unless new name differs (appends to Gatekeeper_Notes as "Possible alternate gatekeeper")
- Companies gatekeeper fields: Gatekeeper_Name, Gatekeeper_Phone, Gatekeeper_Email, Gatekeeper_Last_Spoken, Gatekeeper_Notes
- Calls gatekeeper field: Gatekeeper_Name
- `server/run-call-engine.ts` - CLI runner: `npx tsx server/run-call-engine.ts`

### Opportunity Engine + Call List Auditor
- `server/opportunity-engine.ts` - Bucket-based call list generator: derives engagement facts per company (Times_Called, Last_Outcome, Followup_Due from Calls), assigns 3 buckets (Hot Follow-up: overdue/due in 0-2d; Working: status Working/Called/Enriched with signals, last called >3d; Fresh: New/never called, first seen within 14d), fills Today_Call_List by quota (40% hot, 35% working, 25% fresh) with leftover rollover and score-fill, writes back Final_Priority/Bucket/Today_Call_List to Companies; after list is built, runs DM resolver for all selected companies
- `server/run-opportunity-engine.ts` - CLI runner: `npx tsx server/run-opportunity-engine.ts --top=25 --pctHot=0.4 --pctWorking=0.35 --pctFresh=0.25`
- Alerts: FRESHNESS_ALERT (not enough fresh leads), SLIP_ALERT (overdue followups force-included)
- Companies fields: First_Seen, Times_Called, Last_Outcome, Followup_Due, Bucket, Final_Priority, Today_Call_List

### Primary DM Resolver
- `server/dm-resolver.ts` - Resolves the best decision maker per company from Decision_Makers table; writes Primary_DM_Name/Title/Email/Phone/Seniority/Source/Confidence to Companies
- Title priority: (1) Safety Director/Manager/HSE/EHS, (2) Project/Turnaround/Shutdown Manager, (3) Operations/Plant/Maintenance Manager, (4) Superintendent/GM/VP Ops, (5) Other
- Contactability bonus: +30 email, +20 phone, +10 both; Seniority bonus: +15 Director/VP/C-level, +10 Manager; Recency: +10 if updated within 30d
- Confidence score 0-100; writeback only if empty, higher confidence, or new contact info fills gaps
- Integrated into opportunity engine — runs automatically after Today_Call_List is computed
- Companies fields: Primary_DM_Name, Primary_DM_Title, Primary_DM_Email, Primary_DM_Phone, Primary_DM_Seniority, Primary_DM_Source, Primary_DM_Confidence

### Query Intelligence Engine
- `server/query-intel.ts` - Evolves Search_Queries using outcomes + discovery: Win_Flag computation, attribution (exact Source_Query or approx by First_Seen timing), Performance_Score scoring, pattern learning from top winners via GPT-4o, cold-start templates, duplicate detection, low-performer retirement
- `server/run-query-intel.ts` - CLI runner: `npx tsx server/run-query-intel.ts --generate=20 --targetFresh=100 --market="Gulf Coast"`
- Win definition: has DM email/phone, OR Engagement_Score >= 10, OR last outcome in (Decision Maker, Qualified, Callback)
- Performance_Score = (Wins×10) + (QualifiedCalls×20) - (NotInterestedCalls×10) + (DMFound×5)
- Retirement: Runs >= 3 AND Wins == 0 AND Results_Count <= 2 → Retired=true
- Search_Queries new fields: Performance_Score, Runs, Wins, Last_Generated_By, Retired
- Companies new fields: Source_Query, Win_Flag

### DM Coverage Engine
- `server/dm-coverage.ts` - Detects DM coverage gaps on Today_Call_List, enriches missing DMs via existing pipeline (Apollo → website fallback), re-runs resolver after enrichment
- `server/run-dm-coverage.ts` - CLI runner: `npx tsx server/run-dm-coverage.ts --top=25 --limit=25 [--runOpportunity=true]`
- Schema fields: DM_Coverage_Status (Missing/Queued/Enriching/Ready/Error), DM_Last_Enriched (dateTime), DM_Count (number)
- Idempotent: skips companies enriched within last 14 days
- `server/logger.ts` - Shared log utility (extracted from index.ts to avoid Express side-effects in CLI scripts)

### Active Work Finder
- `server/active-work.ts` - Query generation, website scoring via GPT-4o, Airtable sync
- `server/active-work-routes.ts` - API endpoints (config, generate-queries, score, batch, high-score, rotate)

### Frontend
- `client/src/App.tsx` - App router (/, /make, /active-work)
- `client/src/pages/dashboard.tsx` - Voice Memo monitoring dashboard
- `client/src/pages/make-auditor.tsx` - Make Scenario Auditor dashboard
- `client/src/pages/active-work.tsx` - Active Work Finder dashboard

## API Endpoints

### Voice Memo
- `POST /api/airtable-webhook` and `POST /airtable-webhook` - Webhook endpoint (accepts `{ recordId }`)
- `GET /api/webhook-logs` - List all processing logs
- `GET /api/webhook-logs/:id` - Get specific log entry
- `POST /api/test-webhook` - Test trigger
- `GET /api/health` and `GET /health` - Health check with service status

### Make Auditor
- `GET /api/make/health` - Make.com API connection status
- `POST /api/make/scenarios/sync` - Sync scenarios (supports `?dryRun=true`)
- `GET /api/make/sync-result` - Get cached sync result
- `POST /api/make/blueprint/import` - Import and analyze a pasted JSON blueprint

### Foreman (Call Pack)
- `GET /api/foreman/call-pack/preview?count=20` - Preview ranked call pack (no push)
- `POST /api/foreman/call-pack/generate` - Generate and push call pack to CallCenter
- `POST /api/foreman/call-pack/generate-and-tag` - Generate, push, and tag Airtable records

### DM Enrichment
- `GET /api/enrichment/stats` - Enrichment coverage stats
- `GET /api/enrichment/preview?limit=10` - Preview next companies to enrich
- `POST /api/enrichment/enrich-one` - Enrich a single company (auth required)
- `POST /api/enrichment/enrich-batch` - Batch enrich N companies (auth required)
- `POST /api/enrichment/backfill-contacts` - Generate emails for existing DMs without them (auth required)

### Outscraper
- `GET /api/outscraper/status` - List companies without websites
- `POST /api/outscraper/lookup-one` - Look up a single company on Google Maps (auth required)
- `POST /api/outscraper/lookup-batch` - Batch lookup up to N companies (auth required)
- `POST /api/outscraper/lookup-then-enrich` - Find websites then run DM enrichment (auth required)

### Lead Feed
- `GET /api/lead-feed/stats` - Pipeline stats (queries, companies, tiers, lead statuses)
- `POST /api/lead-feed/generate-queries` - Generate search queries via OpenAI (auth required)
- `POST /api/lead-feed/run-outscraper` - Run queued queries through Outscraper, upsert results (auth required)
- `POST /api/lead-feed/enrich` - Enrich companies with emails, LinkedIn, service notes (auth required)
- `POST /api/lead-feed/run-all` - Run full pipeline: generate → outscraper → enrich (auth required)

### Active Work
- `GET /api/active-work/config` - Get geos, keywords, query count
- `POST /api/active-work/generate-queries` - Generate search queries (supports `?dryRun=true`)
- `POST /api/active-work/score-company` - Score a single company website
- `POST /api/active-work/score-batch` - Batch score unscored companies
- `GET /api/active-work/high-score` - List companies with Active_Work_Score > 70
- `POST /api/active-work/rotate-queries` - Daily query rotation

## Environment Secrets
- `AIRTABLE_API_KEY` - Airtable Personal Access Token
- `AIRTABLE_BASE_ID` - Airtable Base ID
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key (via Replit AI Integrations, used for GPT analysis)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - OpenAI base URL (via Replit AI Integrations)
- `OPENAI_API_KEY` - Direct OpenAI API key (used for Whisper transcription)
- `MAKE_API_TOKEN` - Make.com API token
- `CALLCENTER_BASE_URL` - CallCenter app URL (for Foreman push)
- `INTERNAL_API_KEY` - Shared secret between HUB and CallCenter
- `OUTSCRAPER_API_KEY` - Outscraper API key (Google Maps website lookup)
- `APOLLO_API_KEY` - Apollo.io API key (org enrichment + People Search; free tier limits People Search to 403 → falls back to website crawl)
- `DATABASE_URL` - PostgreSQL connection string

## Airtable Configuration

### Voice Memo Table
- Table name: "Calls"
- Expected fields: Audio attachment field (any name), "Transcription" (text), "Analysis" (text)

### Make Auditor Tables (must be created manually)
- `Make_Scenarios`: make_scenario_id, name, is_active, schedule_summary, folder, last_run_status, last_run_at, updated_at
- `Make_Modules`: make_scenario_id, module_id, module_type, module_name, connections, key_mappings_summary
- `Make_Runs`: make_scenario_id, run_id, status, started_at, finished_at, error_summary
- `Make_Audit_Findings`: make_scenario_id, scenario_name, finding_type, severity, description

## OpenAI Configuration
- Whisper transcription uses direct OPENAI_API_KEY (Replit proxy doesn't support audio endpoints)
- GPT-4o analysis uses AI_INTEGRATIONS proxy (supports text chat completions)

### Daily Orchestrator
- `server/run-daily.ts` - One-command daily pipeline: opportunity engine → DM coverage → call engine → freshness guardrail + query intel
- CLI: `npx tsx server/run-daily.ts`
- Flags: `--top=25 --limit=25 --targetFresh=100 --generate=20 --market="Gulf Coast" --bootstrap=false`
- Steps: (0) Bootstrap if --bootstrap=true, (1) Build today's call list, (2) DM coverage enrichment, (3) Process call outcomes, (4) Check freshness → run query intel if below target
- Prints a DAILY HEALTH REPORT with: list counts, DM resolution stats, calls processed, fresh pool, query intel status, errors, step timing
- Continues past errors (collects them), exits 1 if any step failed

### Rank Explainability Layer
- When Opportunity Engine selects companies for Today_Call_List, it computes and writes 4 fields:
  - `Rank_Reason` (multilineText) — 1–2 line human-readable summary of why this company was ranked
  - `Rank_Evidence` (multilineText) — 3–6 bullet points with scoring inputs, bucket, DM info, engagement, call history
  - `Rank_Inputs_JSON` (multilineText) — full JSON of all inputs used for ranking (audit/debug)
  - `Rank_Version` (singleLineText) — version tag, currently "v1"
- Idempotent: if Rank_Version already matches, the fields are not rewritten on re-run
- Fields are cleared when a company is removed from Today_Call_List
- CLI output shows truncated Rank_Reason (90 chars) per company in the call list preview

### Outreach Playbooks
- `server/playbooks.ts` - Generates tailored outreach scripts per Today_Call_List company using OpenAI (GPT-4o)
- `server/run-playbooks.ts` - CLI runner: `npx tsx server/run-playbooks.ts --limit=25 --force=false`
- Per-company fields written to Companies table:
  - `Playbook_Call_Opener` — opening script when DM answers (≤45s spoken)
  - `Playbook_Gatekeeper_Ask` — gatekeeper bypass script (≤12s)
  - `Playbook_Voicemail` — voicemail script (≤25s)
  - `Playbook_Email_Subject` — email subject line
  - `Playbook_Email_Body` — follow-up email (≤130 words)
  - `Playbook_Followup_Text` — SMS/text follow-up (≤240 chars)
  - `Playbook_Version` — version tag "v1"
  - `Playbook_Last_Generated` — timestamp of last generation
- Tailored by: industry config, bucket (Hot/Working/Fresh), DM name/title, gatekeeper name, rank evidence, opportunity signals
- Idempotent: skips if Playbook_Version matches and generated within last 7 days (use --force=true to override)
- Integrated into Daily Orchestrator as Step 2b (after DM coverage, before call engine); controlled by --playbooks=true/false (default true)

### Industry Configuration
- `config/types.ts` - TypeScript type definition for IndustryConfig (categories, keywords, DM title tiers, scoring, call_list, geo, lead_feed, etc.)
- `config/industry-default.ts` - Default config (Industrial Contractors, Gulf Coast)
- `config/industry-industrial.ts` - Alias for default (Industrial Contractors)
- `config/industry-saas.ts` - B2B SaaS Companies config (US Tech Hubs; VP Sales/CRO/Head of Growth titles; hiring/series a/revops keywords)
- `config/industry-real-estate.ts` - Commercial Real Estate config (Major Metro; Managing Broker/Director of Leasing titles; brokerage/leasing/multifamily keywords)
- `config/industry-agency.ts` - Marketing Agencies config (US Metro; Founder/Owner/Director of Growth titles; ppc/seo/lead gen keywords)
- `server/config.ts` - Config loader: reads INDUSTRY_CONFIG env var, validates shape, exports `getIndustryConfig()` singleton

## One Command Daily Runbook
```
npx tsx server/run-daily.ts --top=25
```
This runs the full pipeline: builds call list → enriches DMs → generates playbooks → processes calls → checks freshness.

For first-time setup or after schema changes:
```
npx tsx server/run-daily.ts --top=25 --bootstrap=true
```

## Individual Runners (when needed)
- `npx tsx server/run-opportunity-engine.ts --top=25` — Build today's call list only
- `npx tsx server/run-dm-coverage.ts --top=25 --limit=25` — DM coverage only
- `npx tsx server/run-call-engine.ts` — Process call outcomes only
- `npx tsx server/run-playbooks.ts --limit=25 --force=false` — Generate outreach playbooks only
- `npx tsx server/run-query-intel.ts --generate=20 --targetFresh=100 --market="Gulf Coast"` — Query intelligence only
- `npx tsx server/bootstrap.ts` — Schema bootstrap only

## Weekly / As-Needed
- If freshness is low (< 100 fresh leads): `npx tsx server/run-query-intel.ts --generate=20 --targetFresh=100 --market="Gulf Coast"`
  - Generates new search queries from winning patterns, retires low performers
  - Then run lead-feed to pull leads from queued queries: `POST /api/lead-feed/run-all`

## Switching Industries
Set the `INDUSTRY_CONFIG` environment variable to switch the entire platform to a different industry:
```
INDUSTRY_CONFIG=industrial npx tsx server/run-daily.ts --top=25    # Industrial Contractors (default)
INDUSTRY_CONFIG=saas npx tsx server/run-daily.ts --top=20          # B2B SaaS Companies
INDUSTRY_CONFIG=real-estate npx tsx server/run-daily.ts --top=25   # Commercial Real Estate
INDUSTRY_CONFIG=agency npx tsx server/run-daily.ts --top=20        # Marketing Agencies
```
This changes: opportunity keywords, DM title tier priorities, search templates, cold-start queries, scoring weights, call list percentages, stale day windows, GPT prompt context, and geo targeting. No code changes needed.

Available configs: `default`, `industrial`, `saas`, `real-estate`, `agency`

To add a new industry: create `config/industry-{name}.ts` implementing the `IndustryConfig` type from `config/types.ts`, then add the import to `server/config.ts`.

## Dependencies
- @neondatabase/serverless, drizzle-orm - Database
- openai - AI transcription and analysis
- express - HTTP server
- React, wouter, @tanstack/react-query, shadcn/ui - Frontend
