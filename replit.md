# Texas Automation Systems — Lead Engine Command Center

## Overview
A B2B lead generation and call management system targeting Gulf Coast industrial contractors with multi-industry extensibility. Features a real-time "Command Center" dashboard with SSE event streaming, Pulse Reactor visualization, white + emerald theme, and a 7-page React frontend. All sub-pages fetch live data from the latest engine run via `/api/run-history`.

## Architecture
- **Backend**: Express + TypeScript server on port 5000
- **Frontend**: React + Shadcn UI + Framer Motion, white theme (#FFFFFF bg, #0F172A text) with emerald (#10B981) accent
- **Database**: PostgreSQL (Replit built-in) for webhook processing logs
- **External Services**: Airtable REST API, OpenAI (Whisper + GPT), Make.com API, Apollo.io, Outscraper
- **Real-time**: Server-Sent Events (SSE) for live dashboard updates

## Frontend Pages (7 routes)
- `/login` — Auth page (validates against ADMIN_EMAIL + ADMIN_PASSWORD)
- `/dashboard` — Command Center (System Status card, Pulse Reactor, Run History, Event Log, Step Timeline)
- `/today` — Today's Call List — shows companies, DMs, priority, playbook status from opportunity_engine + dm_coverage + playbooks steps
- `/followups` — Follow-ups — shows call engine stats + generated playbooks with call openers and gatekeeper scripts
- `/lead-engine` — Lead Engine — shows fresh pool size, query intel metrics from query_intel + opportunity_engine steps
- `/contacts` — Contacts — shows decision makers with names, titles, emails, phones from dm_coverage + dm_fit steps
- `/analytics` — Analytics — shows run history, step breakdown with durations and key stats

### Dashboard Layout
Three-column layout + bottom timeline:
- **Left column**: System Status card (STANDBY/RUNNING/ERROR + KPIs) + Run Now button
- **Center column**: Pulse Reactor (animated concentric rings — breathing standby, rotating sweep running, red flicker error, shockwave on STEP_STARTED, burst on TRIGGER_FIRED)
- **Right column**: Run History (expandable, last 10 runs) + Event Log (latest 30 SSE events)
- **Bottom row**: Step Timeline chips (bootstrap → opportunity_engine → dm_coverage → dm_fit → playbooks → call_engine → query_intel → lead_feed)
- **Section nav**: 5 pill buttons (Today, Follow-ups, Lead Engine, Contacts, Analytics) that glow when their related steps are active

### Color Palette
- Background: #FFFFFF (white)
- Foreground / bold text: #0F172A (near black)
- Primary accent: #10B981 (emerald green)
- Active/running accent: #059669 (darker emerald)
- Error: #EF4444 (red)
- Muted text: #94A3B8 (slate-400)
- Secondary text: #64748B (slate-500)
- Card backgrounds: #FFFFFF with #E2E8F0 borders
- Subtle backgrounds: #F8FAFC
- Buttons: bold black (#0F172A) primary, emerald for accents

### SSE State Mapping
- RUN_STARTED → runStatus=running, set lastRunId
- RUN_DONE → runStatus=standby (unless errors)
- STEP_STARTED → mark step active, trigger reactor shockwave
- STEP_DONE → mark step done, calm reactor
- TRIGGER_FIRED → reactor burst + bump eventRate
- ERROR → runStatus=error, reactor flickers red

### Auth Flow
- POST /api/auth/login → returns UUID token with 24h expiry (email comparison is case-insensitive)
- Token stored in localStorage (`auth_token` + `auth_expires_at`)
- All API calls include `Authorization: Bearer <token>` header automatically via queryClient
- Global 401 handler: any API returning 401 triggers logout + toast notification + redirect to /login
- Session expiry warning toast shown 5 minutes before token expires
- Cross-tab sync via `storage` event listener (logout in one tab logs out all tabs)
- SSE endpoint accepts `?token=` query param (EventSource can't set headers)
- Protected routes redirect to /login if not authenticated
- Query cache: staleTime 5 min, gcTime 10 min

### SSE Event Types
- `RUN_STARTED` / `RUN_DONE` — run lifecycle
- `STEP_STARTED` / `STEP_DONE` — per-step progress with timing/stats
- `TRIGGER_FIRED` — per-company work (DM enrichment, playbook gen)
- `ERROR` — step failures
- `HEARTBEAT` — keepalive every 15s

## Key Files

### Dashboard + SSE
- `server/events.ts` — EventBus: in-memory SSE pub/sub with 200-event ring buffer
- `server/run-history.ts` — Persistent run history with dual-storage (Airtable Run_History + data/run_history.json fallback), max 200 runs
- `server/machine-metrics.ts` — Lifetime counters (companies, DMs, calls, wins, opportunities) from Airtable with 5-min cache
- `server/run-daily-web.ts` — Instrumented daily orchestrator for web (publishes SSE events, prevents concurrent runs)
- `server/dashboard-routes.ts` — API routes: /api/events (SSE), /api/auth/login, /api/run-daily, /api/run-history, /api/run-status, /api/machine-metrics, /api/dashboard/stats
- `client/src/lib/auth.ts` — AuthContext + AuthProvider + ProtectedRoute
- `client/src/lib/use-sse.ts` — SSE subscription hook with auto-reconnect
- `client/src/components/app-layout.tsx` — Header (Texas Automation Systems + StatusPill + Logout) + Framer Motion page transitions
- `client/src/pages/dashboard.tsx` — Command Center: Pulse Reactor + System Status + Run History + Event Log + Step Timeline

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
- `server/apollo.ts` - Apollo.io API client
- `server/dm-enrichment.ts` - DM pipeline: Apollo → website crawl + GPT fallback → Airtable write
- `server/dm-routes.ts` - API endpoints (stats, preview, enrich-one, enrich-batch, backfill-contacts)

### Outscraper (Website Lookup)
- `server/outscraper.ts` - Google Maps search via Outscraper API
- `server/outscraper-routes.ts` - API endpoints (status, lookup-one, lookup-batch, lookup-then-enrich)

### Lead Feed Loop
- `server/lead-feed.ts` - Full pipeline: query gen → Outscraper → upsert + dedupe → scoring → enrichment
- `server/lead-feed-routes.ts` - API endpoints (stats, generate-queries, run-outscraper, enrich, run-all)

### Airtable Schema Bootstrap
- `server/airtable-schema.ts` - Meta API functions; idempotent table/field creation
- `server/bootstrap.ts` - CLI runner: `npx tsx server/bootstrap.ts`

### Call Outcome Engine
- `server/call-engine.ts` - Processes logged calls: updates Lead_Status, schedules follow-ups, updates Engagement_Score
- `server/run-call-engine.ts` - CLI runner: `npx tsx server/run-call-engine.ts`

### Opportunity Engine + Call List
- `server/opportunity-engine.ts` - Bucket-based call list generator (Hot/Working/Fresh)
- `server/run-opportunity-engine.ts` - CLI runner

### Primary DM Resolver
- `server/dm-resolver.ts` - Resolves best DM per company from Decision_Makers table

### Query Intelligence Engine
- `server/query-intel.ts` - Evolves Search_Queries using outcomes + discovery
- `server/run-query-intel.ts` - CLI runner

### DM Coverage Engine
- `server/dm-coverage.ts` - Detects and fills DM coverage gaps on Today_Call_List

### Rank Explainability Layer
- Written by Opportunity Engine: Rank_Reason, Rank_Evidence, Rank_Inputs_JSON, Rank_Version

### Offer-Aware DM Fit
- `server/dm-fit.ts` - Scores DMs for offer-specific fit (Safety/HSE/Site ops priorities)

### Outreach Playbooks
- `server/playbooks.ts` - GPT-4o generated outreach scripts (call opener, gatekeeper, voicemail, email, SMS)
- `server/run-playbooks.ts` - CLI runner

### Industry Configuration
- `config/types.ts` - IndustryConfig type definition
- `config/industry-*.ts` - Per-industry configs (industrial, saas, real-estate, agency)
- `server/config.ts` - Config loader via INDUSTRY_CONFIG env var

### Active Work Finder
- `server/active-work.ts` - Query generation, website scoring via GPT-4o
- `server/active-work-routes.ts` - API endpoints

## API Endpoints

### Dashboard + Auth
- `POST /api/auth/login` — Login (public); returns `{token, expires_in}`
- `GET /api/events` — SSE stream; accepts `?token=` query param
- `POST /api/run-daily` — Start daily orchestrator (protected); returns `{run_id}` or 409
- `GET /api/run-history` — Latest 20 runs (protected)
- `GET /api/run-history/:run_id` — Run detail (protected)
- `GET /api/dashboard/stats` — Dashboard summary stats from Airtable (protected)

### Voice Memo
- `POST /api/airtable-webhook` — Webhook endpoint
- `GET /api/webhook-logs` — List processing logs
- `GET /api/webhook-logs/:id` — Get specific log
- `POST /api/test-webhook` — Test trigger
- `GET /api/health` — Health check

### Make Auditor
- `GET /api/make/health`, `POST /api/make/scenarios/sync`, `GET /api/make/sync-result`, `POST /api/make/blueprint/import`

### Foreman (Call Pack)
- `GET /api/foreman/call-pack/preview`, `POST /api/foreman/call-pack/generate`, `POST /api/foreman/call-pack/generate-and-tag`

### DM Enrichment
- `GET /api/enrichment/stats`, `GET /api/enrichment/preview`, `POST /api/enrichment/enrich-one`, `POST /api/enrichment/enrich-batch`, `POST /api/enrichment/backfill-contacts`

### Outscraper
- `GET /api/outscraper/status`, `POST /api/outscraper/lookup-one`, `POST /api/outscraper/lookup-batch`, `POST /api/outscraper/lookup-then-enrich`

### Lead Feed
- `GET /api/lead-feed/stats`, `POST /api/lead-feed/generate-queries`, `POST /api/lead-feed/run-outscraper`, `POST /api/lead-feed/enrich`, `POST /api/lead-feed/run-all`

### Active Work
- `GET /api/active-work/config`, `POST /api/active-work/generate-queries`, `POST /api/active-work/score-company`, `POST /api/active-work/score-batch`, `GET /api/active-work/high-score`, `POST /api/active-work/rotate-queries`

## Environment Secrets
- `ADMIN_EMAIL` — Dashboard login email
- `ADMIN_PASSWORD` — Dashboard login password
- `AIRTABLE_API_KEY` — Airtable Personal Access Token
- `AIRTABLE_BASE_ID` — Airtable Base ID
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key (via Replit AI Integrations)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI base URL (via Replit AI Integrations)
- `OPENAI_API_KEY` — Direct OpenAI API key (for Whisper)
- `MAKE_API_TOKEN` — Make.com API token
- `CALLCENTER_BASE_URL` — CallCenter app URL
- `INTERNAL_API_KEY` — Shared secret for internal API auth
- `OUTSCRAPER_API_KEY` — Outscraper API key
- `APOLLO_API_KEY` — Apollo.io API key
- `SESSION_SECRET` — Session secret
- `DATABASE_URL` — PostgreSQL connection string

## Daily Operations

### One Command Daily
```
npx tsx server/run-daily.ts --top=25
```

### Web Dashboard Run
Click "Run Now" on the Command Center dashboard, or:
```
curl -X POST http://localhost:5000/api/run-daily -H "Authorization: Bearer <token>"
```

### First-Time Setup
```
npx tsx server/setup-client.ts --seed=true --smoke=true --top=10
```

### Switching Industries
```
INDUSTRY_CONFIG=saas npx tsx server/run-daily.ts --top=20
```
Available: `default`, `industrial`, `saas`, `real-estate`, `agency`

## Troubleshooting
- **SSE not connecting**: Check that token is valid (24h expiry); try logging in again
- **SSE reconnect**: Hook auto-reconnects with exponential backoff (1s → 30s max)
- **Auth issues**: ADMIN_EMAIL and ADMIN_PASSWORD must be set in Replit Secrets
- **Run Now disabled**: A run is already active; wait for completion or check event log for errors
- **CLI still works**: `npx tsx server/run-daily.ts` runs independently of the web dashboard
