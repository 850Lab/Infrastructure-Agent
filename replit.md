# Texas Automation Systems — Lead Engine Command Center

## Overview
The "Lead Engine Command Center" is a multi-tenant B2B lead generation and call management system designed to automate lead processes, manage call operations, and provide real-time insights to optimize lead management and sales outreach. It features real-time data visualization, AI-powered lead enrichment, dynamic playbook generation, and comprehensive analytics. The system's vision is to become the central dashboard for industrial contractors to monitor and manage their lead generation and sales activities, with ambitions for broader industry expansion.

## User Preferences
I prefer iterative development with clear communication at each stage.
I value detailed explanations for complex features and architectural decisions.
Please ask before making any major changes or refactoring large parts of the codebase.
Ensure the codebase remains clean, well-documented, and follows best practices for maintainability and scalability.
I want the agent to prioritize high-impact features and focus on delivering tangible business value.
I prefer to use the web dashboard for daily operations and monitoring, with CLI tools primarily for setup and troubleshooting.

## System Architecture
The system employs a micro-frontend-like architecture, ensuring a clear separation between frontend and backend. It supports multi-tenancy, robust role-based access control, and strict client data isolation.

### UI/UX Decisions
The frontend is a modern React application utilizing Shadcn UI and Framer Motion. It features a clean design with a white background, dark text, and emerald green accents. The central "Command Center" dashboard integrates five key panels: Revenue Opportunities, Pipeline Snapshot, Activity Momentum, AI Recommendations, and Hot Leads. Additional panels include Automation Health and Quick Actions. Real-time updates are handled via Server-Sent Events (SSE). A public landing page/product tour is available at `/site`.

### Technical Implementations
The backend is built with Express and TypeScript, while the frontend is an 11-page React application optimized with virtualization and React Query caching. PostgreSQL is used for core system data such as webhook logs, user accounts, and client registries. Airtable serves as the primary data persistence layer for business logic, with JSON file fallbacks. Authentication is database-backed and token-based. Real-time communication relies on SSE with an in-memory EventBus. A daily orchestrator manages lead generation processes.

Key system features include:
-   **AI-Powered Engines**: Modules for lead generation, DM enrichment, playbook generation, call outcome analysis, briefing, closed-loop sales learning, DM decision authority learning, web scraping, and machine alerts.
-   **Outreach Management**: A unified hub for email and call execution, supporting a configurable 7-Touch Outreach Pipeline, per-client email sending/tracking, performance analytics, template customization, and AI-driven reply detection (HOT/NOT_INTERESTED/NEUTRAL). Supports both SMTP (Nodemailer) and Resend API for email delivery.
-   **Call Processing**: Includes call recording, transcription, and AI-powered analysis for follow-up date extraction, containment analysis, and lead quality scoring. Twilio Recording Sync pulls and processes recordings, matching them to companies. Deep analysis extracts contact info from Airtable call records using GPT-4o.
-   **Workflow & Productivity**: Features like Focus Mode for parallel outreach, an Outcome Explanation Layer providing AI decision details, and a Today Page (Action Dashboard) with a KPI Scoreboard. Airtable write-back functionality syncs flow attempt states.
-   **Data Quality & Learning**: Mechanisms for targeting accuracy, query generation performance tracking, time-decay weighting, authority trend tracking, cross-client learning, DM status classification, DM recovery, and information ceiling detection.
-   **Production Safety**: Implements React Error Boundaries, Process/Concurrency Guards, Rate Limit Handling, and Fetch Timeouts.
-   **Compliance**: Public `/privacy` and `/terms` pages are provided.
-   **Company Detail / Relationship Control Panel**: A comprehensive view for managing individual company interactions, including flow progress, timeline, notes, and next best actions.
-   **Queue Pages**: Dedicated pages for Call, Email, and LinkedIn action queues.
-   **Contacts/Lead Management**: Enhanced contacts page with lead addition, enrichment, search/filter, and detailed views.
-   **My Leads Page**: A dedicated page for manually added leads with tool access.
-   **Multi-Campaign Support**: Allows for multiple active campaigns with isolated data and configurable settings.
-   **LNG Relationship Intelligence Engine**: A client-specific feature generating "Operator Cards" with company intelligence and recommended actions through Outscraper and GPT-4o.
-   **Warm Leads Dashboard**: A dedicated workspace for managing interested leads, featuring priority stats, stage filtering, deal stage progression, one-click stage advancement, and a transcript intelligence panel with buying signals, objections, and next steps.
-   **Targeting Control Panel**: Provides operator-controlled lead targeting with filters, strictness controls, priority objectives, live target summaries, and an explanation layer for lead results. Includes transcript synchronization, AI-powered quality override, and lead intelligence aggregation. Inbound SMS webhook processes text messages, updates flow outcomes, and stores messages.

## External Dependencies
-   **Airtable**: Primary data store for business logic.
-   **OpenAI**: Utilized for Whisper (audio transcription), GPT (GPT-4o) for various AI analyses including containment, web crawling, DM fit scoring, and playbook generation.
-   **Make.com**: Integrated for scenario auditing and blueprint management.
-   **Apollo.io**: Used for decision-maker enrichment and data acquisition.
-   **Outscraper**: Leveraged for Google Maps searches and website lookup services.
-   **HubSpot**: Provides per-client OAuth integration for syncing call outcomes, DMs, qualified deals, and companies.
-   **Twilio**: Supplies click-to-call, SMS, automatic call recording with an AI intelligence pipeline, and real-time call coaching capabilities.
-   **PostgreSQL**: Stores webhook logs, user accounts, client registry, and various system-specific data tables.

## Airtable Data Sync
The `populateOutreachPipeline()` function (in `outreach-engine.ts`) now pulls **website, phone, city, and state** from Airtable's Companies table for every pipeline company on each run via `fetchAirtableCompanyData()`. The `ensureOutreachPipelineRow()` helper (in `outreach-pipeline-helper.ts`) backfills any of these fields that are missing on existing pipeline rows without overwriting existing values.

Airtable field names are **lowercase** in the actual base (`company_name`, `phone`, `city`, `state`, `website`), not CamelCase — the fetch function checks both casing variants.

## Contact Name Validation
Both `research-engine.ts` and `deep-research-engine.ts` use an `isPlausiblePersonName()` filter with a `NOT_PERSON_NAMES`/`NOT_PERSON_WORDS` blocklist. This prevents website text fragments like "Safety Financial", "Guards Home", "Pipe Fabrication" from being treated as human contact names. Only strings with 2-4 capitalized words where none match common English/industry words pass the filter.

## Lead Intelligence Layer
The platform includes a multi-signal lead intelligence scoring engine (`server/lead-intelligence.ts`) that evaluates every company flow across four dimensions:
-   **Revenue Potential** (30% weight): Company size, industry keywords, outdoor crew indicators
-   **Heat Relevance** (30% weight): Gulf Coast geography, industrial/heat-related industry match
-   **Reachability** (25% weight): Direct email, phone, website, DM status availability
-   **Contact Confidence** (15% weight): Named DMs, verified emails, title authority

Scores produce a **composite score** (0-100) and **channel routing** decision (email/call/research_more/discard) with auditable reasoning stored as JSON in `scoring_signals`. An `inferred_contacts` table stores email pattern intelligence (first.last@domain, flast@domain, etc.) with confidence labels.

The scoring runs automatically during the daily orchestrator pipeline and can be triggered manually via `POST /api/lead-intelligence/score-all`. The dedicated **Lead Intelligence** page (`/machine/lead-intelligence`) provides a full scoring dashboard with channel filters, score breakdowns, and routing explanations. Warm Leads cards also display composite scores and channel badges inline.