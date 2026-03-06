# Texas Automation Systems — Lead Engine Command Center

## Overview
This project is a B2B lead generation and call management system designed for Gulf Coast industrial contractors, with potential for expansion into other industries. Its core purpose is to automate and streamline the lead generation process, manage call operations, and provide real-time insights through a "Command Center" dashboard. Key capabilities include real-time data visualization, AI-powered lead enrichment, playbook generation, and comprehensive analytics, aiming to significantly enhance sales efficiency and market penetration for its users.

## User Preferences
I prefer iterative development with clear communication at each stage.
I value detailed explanations for complex features and architectural decisions.
Please ask before making any major changes or refactoring large parts of the codebase.
Ensure the codebase remains clean, well-documented, and follows best practices for maintainability and scalability.
I want the agent to prioritize high-impact features and focus on delivering tangible business value.
I prefer to use the web dashboard for daily operations and monitoring, with CLI tools primarily for setup and troubleshooting.

## System Architecture
The system employs a micro-frontend-like structure with a clear separation between frontend and backend concerns.

### UI/UX Decisions
The frontend utilizes React with Shadcn UI and Framer Motion, ensuring a modern, responsive, and animated user experience.
The primary color scheme is white (`#FFFFFF`) background with dark text (`#0F172A`) and an emerald green (`#10B981`) accent for highlights and active elements. This provides a clean and professional aesthetic.
The dashboard features a three-column layout with a bottom timeline, incorporating an 8-node SVG "Neural Network" visualization (Pulse Reactor) that dynamically reflects system activity, node spikes, and edge pulses. This interactive element provides a visual metaphor for the lead engine's operation.
SSE (Server-Sent Events) are used extensively for real-time updates across the dashboard, ensuring the "Command Center" always displays live data.

### Technical Implementations
**Backend**: Developed with Express and TypeScript, providing a robust and scalable API layer.
**Frontend**: An 11-page React application for various operational views (Dashboard, Today's Call List, Follow-ups, Lead Engine, Contacts, Analytics, Pipeline, Call Mode, Machine Settings, Cinematic). Performance-optimized with react-window v2 virtualization on Today list (>30 companies) and Contacts list (>50 contacts), React Query caching with `placeholderData` for instant navigation (no spinners on revisit), and optimistic updates for call logging (local state + cache cancellation with rollback on error) and opportunity stage changes (cache-level snapshot/rollback across all opportunity queries).
**Database**: PostgreSQL is utilized for storing webhook processing logs.
**Authentication**: Token-based authentication with UUID tokens, 24-hour expiry, and automatic token management. Cross-tab synchronization ensures consistent login states.
**Real-time Communication**: Server-Sent Events (SSE) provide live updates for dashboard components, including run status, step progress, and event logs. An in-memory EventBus manages SSE pub/sub. Hardened with: per-connection heartbeats every 15s, sequence numbers on all events, `since_seq` backfill on reconnect from 200-event ring buffer, client-side heartbeat monitoring (2 missed = reconnecting), exponential backoff (1s→30s max), event dedup via seq tracking, server seq rollback detection, tri-state connection indicator (Connected/Reconnecting/Offline) on dashboard. Single connection controller prevents race conditions and duplicate connections.
**Orchestration**: A daily orchestrator (`run-daily-web.ts`) manages the sequence of lead generation steps, preventing concurrent runs.
**Data Persistence**: Run history and user configurations are stored persistently, with Airtable as the primary source and JSON files as fallbacks.
**KPI Tracking**: Lifetime counters and daily/weekly KPIs are computed and cached to monitor system performance and business outcomes, including a "Targeting Accuracy" score.
**Briefing Engine**: Generates daily briefings, including new leads, DMs found, follow-ups due, and recommended actions.
**Industry Configuration**: The system supports configurable industry-specific settings via environment variables, allowing for multi-industry adaptation.

### Feature Specifications
**Command Center Dashboard**: Displays system status, Pulse Reactor visualization, run history, event logs, and a step timeline.
**Lead Engine**: Manages query generation, lead feeding via Outscraper, scoring, enrichment, and deduplication.
**DM Enrichment**: Utilizes Apollo.io and GPT for decision-maker information gathering and enrichment.
**Playbook Generator**: GPT-4o generates dynamic outreach scripts (call openers, gatekeeper scripts, emails, SMS).
**Run Diff**: Each daily run takes before/after Airtable snapshots (companies, DMs, call list, offer DMs, playbooks, queries) and computes deltas saved to `summary_json.diff`. API: GET /api/run-latest-diff returns latest diff. Dashboard shows "Last Run Changes" panel and per-run diff in Run History expandable rows. Implementation: `server/run-diff.ts` (snapshot/diff logic), wired in `server/run-daily-web.ts`.
**Revert Last Run**: During each daily run, a changeset of before/after field values is captured for rank, offer_dm, and playbook categories (`server/run-changeset.ts`). Stored in `summary_json.changeset`. API: POST /api/run-history/:run_id/revert with `{ categories: ["rank","offer_dm","playbooks"] }` writes `fields_before` back to Airtable. Supports partial revert (revert some categories, leave others available). UI in dashboard Run History expansion shows category toggles and revert button; already-reverted categories shown as grey label.
**Call Outcome Engine**: Processes call logs, updates lead statuses, schedules follow-ups, and adjusts engagement scores. Automatically creates/updates Opportunities in Airtable for Qualified, Callback, Won, and Not Interested outcomes.
**Opportunities Pipeline**: Tracks deals through stages (Qualified → SiteWalk → QuoteSent → DeploymentScheduled → Won/Lost) with auto-generated next actions and due dates. One active opportunity per company (idempotent). API: GET /api/opportunities, GET /api/opportunities/summary, POST /api/opportunities/:id/update. Pipeline page at /pipeline with funnel cards and stage filtering. DealCard component (`client/src/components/deal-card.tsx`) renders inline on Today and Follow-ups pages when a company has an active opportunity, showing stage badge, advance button with optimistic UI, stage-jump dropdown, and Mark Lost/Won actions.
**Call Mode**: Full-screen operator cockpit at `/call-mode` for rapid call sessions. Dark-themed deck-style UI showing one company at a time with all contact info, rank intel, and call scripts. Six outcome buttons (DM, Gatekeeper, No Answer, Qualified, Callback, Not Interested) with keyboard shortcuts (1-6). Gatekeeper prompts for name if not on file, Qualified prompts for notes, Callback prompts for date. Auto-advances to next company on log. Progress bar and completed/remaining counts. Accessible from Today page "Call Mode" button.
**Opportunity Engine**: Generates bucket-based call lists (Hot, Working, Fresh).
**Query Intelligence Engine**: Evolves search queries based on outcomes and discovery.
**DM Coverage Engine**: Identifies and fills gaps in decision-maker coverage for call lists.
**Machine Feedback (Narrative Micro-interactions)**: All system labels use narrative language. Neural network nodes: Market Discovery, Lead Expansion, Market Scanner, Decision Maker Mapping, Buyer Selection, Script Generator, Signal Processing, Learning Engine. Dashboard STEP_LABELS, analytics STEP_DISPLAY, page subtitles on contacts ("Decision Maker Mapping / Buyer Selection") and lead-engine ("Lead Expansion / Learning Engine") all match. Toast notifications fire on: call log outcomes (today.tsx, call-mode.tsx) with per-outcome feedback, pipeline run start (today.tsx), SSE step completions (dashboard.tsx), and deal stage changes (deal-card.tsx). All toasts use narrative copy ("Signal captured", "Machine evolved", etc.).
**Rank Explainability Layer**: Provides transparency on lead ranking decisions.
**Machine Identity & Settings**: Dashboard shows machine name plaque with config line ("Configured for: X | Target: Y | Territory: Z") loaded from /api/me. Edit page at /machine-settings allows changing machine name, geo, DM focus, opportunity (safe edits) and market/industry config (requires confirmation modal). API: PATCH /api/machine-settings updates User_Config in Airtable + local JSON. Config stored in `server/user-config.ts` MachineConfig interface.
**First-Run Cinematic**: 6-10 second startup sequence at `/cinematic` shown once after onboarding build completes. Three nodes (Discovery → DM Mapping → Learning) light up in sequence with glow/pulse SVG animations and connector lines. Transitions to "[machine_name] is online" message with config summary, then auto-redirects to `/briefing`. Skippable via Skip button. `cinematic_seen` flag stored in localStorage prevents repeat showing. Onboarding redirects to `/cinematic` if flag not set, `/briefing` if already seen. Gracefully degrades if SSE/APIs unavailable.
**Onboarding Wizard**: A multi-step process for first-time users to configure market, opportunity, geography, and DM focus.

### Production Safety
**Error Boundary**: React ErrorBoundary wraps entire app (`client/src/components/error-boundary.tsx`). Catches render errors, shows "Something went wrong" with reload button instead of white screen.
**Process Guards**: `server/index.ts` has `unhandledRejection` and `uncaughtException` handlers that log with `[FATAL]` prefix instead of silently crashing.
**Concurrency Guard**: Pipeline runs protected by `RunAlreadyActiveError` — returns HTTP 409 if run already in progress. Frontend disables buttons via `isPending` to prevent double-clicks.
**Rate Limit Handling**: Outscraper retries capped at 3 with exponential backoff (10s→20s→40s). Apollo retries 3x with backoff. OpenAI calls wrapped in try-catch.
**Fetch Timeouts**: Outscraper requests have 120s AbortController timeout.
**Source Attribution**: New companies created by lead-feed now include `Source_Query` field for exact query attribution.

## External Dependencies
- **Airtable**: Used for storing webhook processing logs, run history, user configurations, machine metrics, and as a source for various data points. The REST API is heavily integrated.
- **OpenAI**: Utilized for:
    - **Whisper**: For audio transcription (likely for voice memo analysis, though not explicitly detailed in the compressed section).
    - **GPT (GPT-4o)**: For containment analysis, website crawling fallback, offer-aware DM fit scoring, and generating outreach playbooks.
- **Make.com**: Integrated for scenario auditing and blueprint management via its API.
- **Apollo.io**: Used for decision-maker enrichment and data acquisition.
- **Outscraper**: Utilized for Google Maps searches and website lookup services to feed the lead engine.
- **PostgreSQL**: The built-in Replit database is used for storing webhook processing logs.