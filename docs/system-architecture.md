# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    REPLIT APP (Express + React)                  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  React SPA   │  │  Express API │  │  Background Workers   │ │
│  │  (Vite)      │◄─┤  (REST)      │  │  - Scheduler (6h)     │ │
│  │  Port 5000   │  │  Port 5000   │  │  - Reply Checker(15m) │ │
│  │              │  │              │  │  - Auto Sender (15m)  │ │
│  └──────────────┘  └──────┬───────┘  └───────────┬───────────┘ │
│                           │                      │              │
│                    ┌──────┴──────────────────────┴──────┐       │
│                    │          PostgreSQL DB              │       │
│                    │  Users, Clients, Flows, Recordings  │       │
│                    │  Pipeline, Messages, Templates      │       │
│                    └────────────────────────────────────┘       │
└───────────┬──────────────┬──────────────┬──────────────┬────────┘
            │              │              │              │
            ▼              ▼              ▼              ▼
     ┌──────────┐   ┌──────────┐   ┌──────────┐  ┌──────────────┐
     │ Airtable │   │  Twilio  │   │  OpenAI  │  │  Apollo.io   │
     │          │   │          │   │          │  │  Outscraper  │
     │ Primary  │   │ Calls    │   │ Whisper  │  │  HubSpot     │
     │ Data     │   │ SMS      │   │ GPT-4o   │  │  Make.com    │
     │ Layer    │   │ Record   │   │ Analysis │  │              │
     └──────────┘   └──────────┘   └──────────┘  └──────────────┘
```

## Data Flow

### 1. Daily Pipeline Run (Scheduler → Airtable → AI)

```
Scheduler (every 6 hours)
  └─► run-daily-web.ts (orchestrator)
       ├─► Opportunity Engine: rank companies, select top 25
       ├─► DM Coverage: check decision maker gaps
       ├─► DM Fit: match best DM per company
       ├─► DM Status: classify DM readiness
       ├─► Playbooks: generate call scripts (GPT-4o)
       ├─► Web Intel: scrape company websites
       ├─► Query Intel: generate/retire search queries
       ├─► Sales Learning: analyze call patterns
       ├─► Machine Alerts: detect anomalies
       └─► Run Diff: compute before/after changeset
```

### 2. Call Flow (User → Twilio → Recording → AI)

```
User clicks "Call" in Focus Mode
  └─► POST /api/twilio/call
       └─► Twilio creates call (agent phone → lead)
            ├─► Recording starts automatically
            ├─► Real-time coaching via WebSocket (optional)
            └─► When call ends:
                 └─► Twilio POST /api/twilio/webhook/recording
                      ├─► Download recording (.mp3)
                      ├─► Transcribe (OpenAI Whisper)
                      ├─► Containment analysis (deterministic + GPT)
                      ├─► Lead quality scoring (GPT-4o)
                      ├─► Authority detection
                      ├─► Follow-up date extraction
                      ├─► Update twilio_recordings table
                      ├─► Update company_flows (quality, next action)
                      └─► Writeback to Airtable Calls table
```

### 3. Twilio Recording Sync (Backfill from External Call Center)

```
User clicks "Sync Recordings" on Warm Leads page
  └─► POST /api/twilio/sync-recordings
       ├─► List all recordings from Twilio API (last N days)
       ├─► Filter out already-synced recordings
       ├─► Build phone→company map from Airtable + Pipeline
       ├─► For each new recording:
       │    ├─► Fetch call details + child call legs
       │    ├─► Match lead phone to company
       │    ├─► Download + transcribe + analyze
       │    └─► Update flows with quality scores
       └─► Return summary to UI
```

### 4. Outreach Pipeline (Email + Call Sequences)

```
Company enters pipeline (via Flow Engine)
  └─► 6-Touch Sequence:
       1. Email (intro)
       2. Call attempt
       3. Email (follow-up)
       4. LinkedIn message
       5. Call attempt
       6. Final email
  
  Each touch:
    └─► Auto-sender checks every 15 minutes
         ├─► Send due emails via configured provider
         ├─► Track opens/clicks (via webhooks)
         └─► Reply checker detects responses (every 15 min)
```

### 5. Warm Lead Management

```
Outcome logged as warm (interested/meeting/followup)
  └─► company_flows.warm_stage = "initial_interest"
       └─► 7-stage progression:
            initial_interest → proposal_sent → meeting_scheduled
            → negotiating → verbal_commit → closed_won/closed_lost
  
  Deep Analysis:
    └─► POST /api/warm-leads/deep-analysis
         ├─► Pull all Airtable Calls records
         ├─► Extract contacts via GPT-4o (name, email, phone, title)
         ├─► Update outreach_pipeline records
         └─► Update company_flows with extracted data
```

## Server File Organization

### Entry Points
- `server/index.ts` — Express app setup, HTTP server, process guards
- `server/routes.ts` — Route registration hub (imports all route modules)
- `server/scheduler.ts` — Background job scheduler (6-hour daily pipeline)

### Route Modules
| File | Base Path | Purpose |
|------|-----------|---------|
| `dashboard-routes.ts` | `/api/command-center`, `/api/warm-leads`, `/api/targeting` | Main dashboard, warm leads, targeting |
| `twilio-routes.ts` | `/api/twilio/*` | Calls, SMS, recordings, webhooks, sync |
| `flow-routes.ts` | `/api/flows/*` | Company flow management |
| `email-routes.ts` | `/api/email/*` | Email sending, templates, tracking |
| `dm-routes.ts` | `/api/dm/*` | Decision maker management |
| `admin-routes.ts` | `/api/admin/*` | Platform admin operations |
| `today-routes.ts` | `/api/today/*` | Today page data |
| `make-routes.ts` | `/api/make/*` | Make.com integration |
| `outscraper-routes.ts` | `/api/outscraper/*` | Company data scraping |
| `lead-feed-routes.ts` | `/api/lead-feed/*` | Lead feed management |
| `foreman-routes.ts` | `/api/foreman/*` | External call center bridge |
| `hubspot.ts` | `/api/hubspot/*` | HubSpot CRM sync |
| `lng-projects.ts` | `/api/lng/*` | LNG project intelligence |
| `sales-learning/sales-learning-routes.ts` | `/api/sales-learning/*` | Sales pattern analysis |
| `opportunities.ts` | `/api/opportunities/*` | Pipeline opportunities |
| `active-work-routes.ts` | `/api/active-work/*` | Active work tracking |

### Services (Business Logic)
| File | Purpose |
|------|---------|
| `openai.ts` | Transcription, containment analysis, lead scoring, contact extraction |
| `twilio-service.ts` | Twilio SDK wrapper (calls, SMS, recordings) |
| `airtable.ts` | Airtable CRUD operations |
| `airtable-scoped.ts` | Client-scoped Airtable queries |
| `apollo.ts` | Apollo.io DM enrichment |
| `outscraper.ts` | Google Maps scraping |
| `email-service.ts` | Email delivery abstraction |
| `email-providers.ts` | Resend/SMTP provider implementations |

### Engines (Pipeline Logic)
| File | Purpose |
|------|---------|
| `opportunity-engine.ts` | Company ranking and selection |
| `flow-engine.ts` | Multi-flow state machine |
| `outreach-engine.ts` | 6-touch outreach sequence |
| `recovery-engine.ts` | DM recovery queue |
| `call-engine.ts` | Call outcome processing |
| `machine-alerts.ts` | Anomaly detection |
| `query-intel.ts` | Search query lifecycle |
| `web-intel.ts` | Company website intelligence |

### Background Workers
| File | Purpose | Interval |
|------|---------|----------|
| `scheduler.ts` | Orchestrates daily pipeline | Every 6 hours |
| `reply-checker.ts` | Detects email replies | Every 15 minutes |
| `auto-sender.ts` | Sends due outreach emails | Every 15 minutes |

## Database (PostgreSQL)

Key tables defined in `shared/schema.ts`:
- `users` — Admin/user accounts
- `clients` — Multi-tenant client orgs (TCDT, TAS, 850 Lab)
- `company_flows` — Per-company outreach state machines
- `flow_attempts` — Individual touch attempts per flow
- `outreach_pipeline` — Company enrichment pipeline
- `twilio_recordings` — Call recordings with transcriptions + analysis
- `inbound_messages` — Incoming SMS
- `email_templates` — Per-client email templates
- `email_sends` — Email delivery tracking
- `action_queue` — Scheduled follow-up tasks
- `machine_feedback` — User feedback on machine decisions

## Frontend (React + Vite)

11 main pages defined in `client/src/App.tsx`:
- `/` — Command Center dashboard
- `/machine/today` — Today's action dashboard
- `/machine/focus` — Focus mode (call execution cockpit)
- `/machine/targeting` — Targeting accuracy + transcript intelligence
- `/machine/warm-leads` — Warm lead management + deep analysis
- `/machine/pipeline` — Pipeline funnel view
- `/machine/followups` — Follow-up queue
- `/machine/analytics` — Performance analytics
- `/machine/settings` — Machine configuration
- `/admin/*` — Platform admin pages
- `/site` — Public landing page
