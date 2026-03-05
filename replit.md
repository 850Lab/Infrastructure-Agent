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
- `server/airtable-schema.ts` - Meta API functions (getBaseSchema, ensureTable, ensureField, ensureSchema); idempotent table/field creation for Search_Queries, Companies, Calls
- `server/bootstrap.ts` - CLI runner: `npx tsx server/bootstrap.ts` to bootstrap all Airtable tables/fields

### Call Outcome Engine
- `server/call-engine.ts` - Processes logged calls: updates Company Lead_Status (Decision Maker/Qualified→Working, Won→Won, Not Interested→Lost), schedules follow-ups (No Answer +2d, Gatekeeper +7d, DM +5d, Qualified +3d, Callback +1d, Not Interested +90d), updates Engagement_Score (+10 DM, +20 Qualified, +40 Won, -10 Not Interested), marks Processed=true
- `server/run-call-engine.ts` - CLI runner: `npx tsx server/run-call-engine.ts`

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

## Dependencies
- @neondatabase/serverless, drizzle-orm - Database
- openai - AI transcription and analysis
- express - HTTP server
- React, wouter, @tanstack/react-query, shadcn/ui - Frontend
