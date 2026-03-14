# System Dependencies

## Environment Variables

### Required — App Will Not Start Without These

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (Replit-managed) |
| `SESSION_SECRET` | Express session signing key |
| `ADMIN_EMAIL` | Platform admin login email |
| `ADMIN_PASSWORD` | Platform admin login password |

### Required — Core Features

| Variable | Purpose |
|----------|---------|
| `AIRTABLE_API_KEY` | Airtable Personal Access Token — primary data layer |
| `AIRTABLE_BASE_ID` | Airtable Base ID containing Companies, Calls, Decision_Makers, etc. |
| `OPENAI_API_KEY` | OpenAI API key for transcription (Whisper), analysis (GPT-4o), lead scoring |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Alternative OpenAI key (used by some AI routes) |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Alternative OpenAI base URL |

### Required — Twilio (Calling & SMS)

Twilio credentials are managed via the Replit Integrations connector (not env vars).
The app calls `REPLIT_CONNECTORS_HOSTNAME` to fetch `account_sid`, `api_key`, `api_key_secret`, `phone_number` at runtime.

| Variable | Purpose |
|----------|---------|
| `AGENT_PHONE` | Agent's personal phone number for call forwarding (default: `+14093387109`) |

### Optional — Extended Features

| Variable | Purpose |
|----------|---------|
| `APOLLO_API_KEY` | Apollo.io API for DM enrichment |
| `OUTSCRAPER_API_KEY` | Outscraper API for Google Maps data |
| `CALLCENTER_BASE_URL` | External call center app URL (CoolingTrailerScript) |
| `MAKE_API_TOKEN` | Make.com API token for automation audit |
| `HUBSPOT_CLIENT_ID` | HubSpot OAuth client ID |
| `HUBSPOT_CLIENT_SECRET` | HubSpot OAuth client secret |
| `INTERNAL_API_KEY` | Internal API key for webhook authentication |

## External Systems

### Primary Dependencies (App Core)

| System | Purpose | Integration Point |
|--------|---------|-------------------|
| **PostgreSQL** | User accounts, clients, flows, recordings, messages, pipeline | Drizzle ORM via `DATABASE_URL` |
| **Airtable** | Companies, Decision Makers, Calls, Queries, Today Call List, Run History | REST API via `server/airtable.ts`, `server/airtable-scoped.ts` |
| **OpenAI** | Audio transcription (Whisper), call analysis (GPT-4o), lead quality scoring, contact extraction | `server/openai.ts` |
| **Twilio** | Outbound/inbound calls, SMS, call recording, voicemail detection | `server/twilio-service.ts`, `server/twilio-routes.ts` |

### Secondary Dependencies (Extended Features)

| System | Purpose | Integration Point |
|--------|---------|-------------------|
| **Apollo.io** | Decision maker enrichment (name, title, email, LinkedIn) | `server/apollo.ts` |
| **Outscraper** | Google Maps company data scraping | `server/outscraper.ts` |
| **Make.com** | Automation orchestration audit | `server/make.ts`, `server/make-routes.ts` |
| **HubSpot** | CRM sync (contacts, deals) | `server/hubspot.ts`, `server/hubspot-sync.ts` |
| **CoolingTrailerScript** | External call center app (separate Replit) | `server/foreman.ts` via `CALLCENTER_BASE_URL` |

## Deployment Dependencies

| Dependency | Notes |
|------------|-------|
| **Node.js 20+** | Runtime |
| **PostgreSQL 16** | Replit-managed database |
| **npm** | Package manager |
| **Vite** | Frontend dev server + production build |
| **esbuild** | Backend production build |
| **Replit Deployment** | Hosts the app, manages TLS, health checks |

## Airtable Tables Used

| Table | Purpose |
|-------|---------|
| `Companies` | Master company list with enrichment data |
| `Decision_Makers` | Contact names, titles, emails, LinkedIn |
| `Calls` | Call log with outcomes, notes, transcriptions |
| `Today_Call_List` | Daily prioritized call queue (view) |
| `Queries` | Search queries for lead generation |
| `Run_History` | Daily pipeline run logs |
