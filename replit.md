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
- `server/foreman.ts` - Candidate fetching, deterministic scoring, ranking, CallCenter push, Airtable tagging
- `server/foreman-routes.ts` - API endpoints (preview, generate, generate-and-tag)

### Decision Maker Enrichment
- `server/apollo.ts` - Apollo.io API client (org enrichment: employees, industry, description)
- `server/dm-enrichment.ts` - Website crawling, GPT-4o DM extraction, email generation, Airtable sync, batch enrichment, backfill
- `server/dm-routes.ts` - API endpoints (stats, preview, enrich-one, enrich-batch, backfill-contacts)

### Outscraper (Website Lookup)
- `server/outscraper.ts` - Google Maps search via Outscraper API to find missing company websites
- `server/outscraper-routes.ts` - API endpoints (status, lookup-one, lookup-batch, lookup-then-enrich)

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
- `APOLLO_API_KEY` - Apollo.io API key (org enrichment, free tier)
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
