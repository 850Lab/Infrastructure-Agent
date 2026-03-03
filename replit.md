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

### Frontend
- `client/src/App.tsx` - App router (/, /make)
- `client/src/pages/dashboard.tsx` - Voice Memo monitoring dashboard
- `client/src/pages/make-auditor.tsx` - Make Scenario Auditor dashboard

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

## Environment Secrets
- `AIRTABLE_API_KEY` - Airtable Personal Access Token
- `AIRTABLE_BASE_ID` - Airtable Base ID
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key (via Replit AI Integrations, used for GPT analysis)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - OpenAI base URL (via Replit AI Integrations)
- `OPENAI_API_KEY` - Direct OpenAI API key (used for Whisper transcription)
- `MAKE_API_TOKEN` - Make.com API token
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
