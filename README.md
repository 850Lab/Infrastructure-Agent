# Pivotal Growth Command System

B2B lead generation and call management platform for Gulf Coast industrial contractors. Multi-tenant SaaS serving TCDT, TAS, and 850 Lab with AI-powered outreach automation, Twilio call management, and transcript intelligence.

## What It Does

- **5 Parallel Outreach Flows** — Cold, warm, re-engage, referral, and strategic outreach per company
- **AI-Powered Call Analysis** — Records calls via Twilio, transcribes with OpenAI Whisper, scores lead quality with GPT-4o
- **Daily Pipeline Engine** — Automated 6-hour pipeline runs: company ranking, DM enrichment, playbook generation, web intel
- **Warm Lead Management** — 7-stage progression from initial interest to closed-won with deep analysis
- **Decision Maker Coverage** — Apollo.io enrichment, authority detection, contact extraction from transcripts
- **Multi-Tenant** — Platform admin manages multiple client organizations with scoped Airtable data

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Express.js + TypeScript |
| Database | PostgreSQL (Drizzle ORM) |
| External Data | Airtable (primary business data layer) |
| Voice/SMS | Twilio (via Replit Integration) |
| AI | OpenAI GPT-4o + Whisper |
| Enrichment | Apollo.io, Outscraper |
| Automation | Make.com |
| CRM | HubSpot (optional) |
| UI | Tailwind CSS + Shadcn/ui |

## Project Structure

```
├── client/                      # React frontend (Vite)
│   └── src/
│       ├── pages/               # Route pages (dashboard, warm-leads, pipeline, etc.)
│       ├── components/          # Shared components + Shadcn UI
│       ├── hooks/               # Custom hooks
│       └── lib/                 # Auth, query client, utilities
│
├── server/                      # Express backend
│   ├── index.ts                 # App entry point
│   ├── routes.ts                # Route registration hub
│   ├── storage.ts               # Database access layer (IStorage)
│   ├── db.ts                    # Drizzle + PostgreSQL connection
│   ├── auth.ts                  # Session auth middleware
│   ├── scheduler.ts             # Background job scheduler
│   │
│   ├── airtable.ts              # Airtable CRUD
│   ├── airtable-scoped.ts       # Client-scoped Airtable queries
│   ├── twilio-service.ts        # Twilio SDK wrapper
│   ├── twilio-routes.ts         # Call/SMS/recording endpoints + webhooks
│   ├── openai.ts                # Transcription + AI analysis
│   ├── apollo.ts                # DM enrichment
│   ├── outscraper.ts            # Google Maps data
│   │
│   ├── opportunity-engine.ts    # Company ranking engine
│   ├── flow-engine.ts           # Multi-flow state machine
│   ├── outreach-engine.ts       # 6-touch outreach sequence
│   ├── call-engine.ts           # Call outcome processing
│   ├── recovery-engine.ts       # DM recovery queue
│   │
│   ├── sales-learning/          # Sales pattern analysis (6 modules)
│   ├── *-routes.ts              # Feature-specific route modules
│   └── run-*.ts                 # Standalone pipeline runners (CLI)
│
├── shared/
│   └── schema.ts                # Drizzle schema + Zod validation
│
├── docs/                        # Project documentation
│   ├── system-architecture.md   # Architecture diagrams + data flows
│   ├── system-dependencies.md   # Env vars + external systems
│   └── potential-cleanup.md     # Dead code report
│
└── drizzle.config.ts            # Drizzle Kit configuration
```

## How to Run Locally

### Prerequisites
- Node.js 20+
- PostgreSQL database
- Airtable account with configured base
- Twilio account
- OpenAI API key

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables (see [Required Environment Variables](#required-environment-variables) below)
4. Push database schema:
   ```bash
   npm run db:push
   ```
5. Start the dev server:
   ```bash
   npm run dev
   ```

The app serves both frontend and backend on port 5000.

## Required Environment Variables

### Core (App will not start without these)
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing key |
| `ADMIN_EMAIL` | Platform admin login email |
| `ADMIN_PASSWORD` | Platform admin login password |
| `AIRTABLE_API_KEY` | Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | Airtable Base ID |
| `OPENAI_API_KEY` | OpenAI API key (Whisper + GPT-4o) |

### Twilio
Managed via Replit Integration connector. On non-Replit environments, set:
| Variable | Purpose |
|----------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_API_KEY` | Twilio API Key |
| `TWILIO_API_KEY_SECRET` | Twilio API Key Secret |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |

### Optional
| Variable | Purpose |
|----------|---------|
| `APOLLO_API_KEY` | Apollo.io DM enrichment |
| `OUTSCRAPER_API_KEY` | Outscraper Google Maps scraping |
| `CALLCENTER_BASE_URL` | External call center URL |
| `MAKE_API_TOKEN` | Make.com automation audit |
| `HUBSPOT_CLIENT_ID` | HubSpot OAuth |
| `HUBSPOT_CLIENT_SECRET` | HubSpot OAuth |
| `INTERNAL_API_KEY` | Webhook authentication |

## Deployment

Currently deployed on Replit. To deploy:

1. Ensure all environment variables are set
2. Replit handles build (`npm run build`), hosting, TLS, and health checks
3. Production build: Vite bundles the frontend, esbuild bundles the backend
4. The app runs on the `PORT` environment variable (default: 5000)

## Key API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/twilio/call` | Initiate outbound call |
| POST | `/api/twilio/sync-recordings` | Sync all Twilio recordings |
| POST | `/api/twilio/webhook/recording` | Recording completion webhook |
| POST | `/api/warm-leads/deep-analysis` | AI deep analysis of warm leads |
| GET | `/api/command-center` | Main dashboard data |
| GET | `/api/warm-leads` | Warm leads list |
| POST | `/api/flows/start` | Start outreach flow for a company |
| GET | `/api/today/companies` | Today's prioritized call list |

## Background Workers

| Worker | Interval | Purpose |
|--------|----------|---------|
| Scheduler | 6 hours | Full daily pipeline run |
| Reply Checker | 15 min | Detect email replies |
| Auto Sender | 15 min | Send due outreach emails |
