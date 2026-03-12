# Texas Automation Systems — Lead Engine Command Center

## Overview
The "Lead Engine Command Center" is a multi-tenant B2B lead generation and call management system. Its purpose is to automate lead processes, manage call operations, and deliver real-time insights to optimize lead management and sales outreach. Key capabilities include real-time data visualization, AI-powered lead enrichment, dynamic playbook generation, and comprehensive analytics. The system targets industrial contractors with plans for broader industry expansion, providing a central dashboard for monitoring and managing lead generation and sales activities.

## User Preferences
I prefer iterative development with clear communication at each stage.
I value detailed explanations for complex features and architectural decisions.
Please ask before making any major changes or refactoring large parts of the codebase.
Ensure the codebase remains clean, well-documented, and follows best practices for maintainability and scalability.
I want the agent to prioritize high-impact features and focus on delivering tangible business value.
I prefer to use the web dashboard for daily operations and monitoring, with CLI tools primarily for setup and troubleshooting.

## System Architecture
The system utilizes a micro-frontend-like architecture with a clear separation between frontend and backend, supporting multi-tenancy, role-based access control, and client data isolation.

### UI/UX Decisions
The frontend is a React application built with Shadcn UI and Framer Motion, featuring a modern design with a white background, dark text, and emerald green accents. It includes a three-column dashboard layout, a dynamic 8-node SVG "Neural Network" visualization (Pulse Reactor), and uses Server-Sent Events (SSE) for real-time data updates. A public landing page/product tour is available at `/site`.

### Technical Implementations
The **backend** is implemented with Express and TypeScript, while the **frontend** is an 11-page React application optimized with virtualization and React Query caching. **PostgreSQL** handles various data, including webhook logs, user accounts, client registry, and system-specific tables. **Airtable** serves as the primary data persistence layer for business logic, with JSON file fallbacks. **Authentication** is database-backed and token-based. **Real-time communication** leverages SSE with an in-memory EventBus. A daily orchestrator manages lead generation processes.

Key features include:
-   **AI-Powered Engines**: Lead Engine, DM Enrichment, Playbook Generator, Call Outcome Engine, Briefing Engine, Closed-Loop Sales Learning System, DM Decision Authority Learning Loop, Web Intel Scraper, and Machine Alerts.
-   **Outreach Management**: Unified Outreach Hub for email and call execution, configurable 6-Touch Outreach Pipeline, Per-Client Email Sending & Tracking, Email Performance Analytics, Template Customization, and Reply Detection.
-   **Call Processing**: Call Recording + Transcription Pipeline with automatic follow-up date extraction.
-   **Workflow & Productivity**: Features like Run Diff, Revert Last Run, Opportunities Pipeline, Machine Feedback, Rank Explainability Layer, Machine Identity & Settings, First-Run Cinematic, Onboarding Wizard, Admin Platform. **Focus Mode** (`/machine/focus`) provides an execution cockpit for parallel outreach flows with an **Outcome Explanation Layer** that shows machine decision details (system action, why chosen, state changes, next action) after each outcome is logged. **Today Page** (`/machine/today`) is an execution-first Action Dashboard with a collapsible **KPI Scoreboard** showing 5-day funnel, 7-day conversion rates, and 30-day pipeline metrics with AI interpretation. **Airtable Write-Back** (`server/airtable-writeback.ts`) syncs flow attempt states to Airtable.
-   **Data Quality & Learning**: Targeting Accuracy, Query Generation Performance Tracking, Time-Decay Weighting, Authority Trend Tracking, Cross-Client Learning, DM Status Classification, DM Recovery Queue, and Information Ceiling Detection.
-   **Production Safety**: Includes React Error Boundaries, Process Guards, Concurrency Guards, Rate Limit Handling, and Fetch Timeouts.
-   **Compliance Pages**: Public `/privacy` and `/terms` pages.
-   **Company Detail / Relationship Control Panel** (`/machine/company/:id`): Provides full account mission control with sections for Company Summary, Target Roles, Contacts/Decision Makers, Flow Progress, Timeline, Notes & Intel, Next Best Action, and Quick Actions.
-   **Queue Pages**: Call Queue (`/machine/call-queue`), Email Queue (`/machine/email-queue`), LinkedIn Queue (`/machine/linkedin-queue`) display action queue data.
-   **Contacts/Lead Management**: Includes a redesigned contacts page with an Add Lead form, per-company Enrich button, search/filter, and expandable detail rows.
-   **My Leads Page** (`/machine/my-leads`): Dedicated page for manually added leads with tool access for call logging, playbooks, enrichment, and proposal creation.
-   **Multi-Campaign Support**: Allows for multiple active campaigns with isolated data and configurable settings.
-   **LNG Relationship Intelligence Engine**: A client-specific feature at `/machine/lng-projects` that generates "Operator Cards" with company intelligence, priority people, and recommended actions, utilizing 6 search angles via Outscraper + GPT-4o analysis.

## External Dependencies
-   **Airtable**: Primary data store for business logic.
-   **OpenAI**: Used for Whisper (audio transcription), GPT (GPT-4o) for containment analysis, web crawling, DM fit scoring, and playbook generation.
-   **Make.com**: Integrated for scenario auditing and blueprint management.
-   **Apollo.io**: Used for decision-maker enrichment and data acquisition.
-   **Outscraper**: Utilized for Google Maps searches and website lookup services.
-   **HubSpot**: Per-client OAuth integration for syncing call outcomes, DMs, qualified deals, and companies. Optional sync for proposals.
-   **Twilio**: Provides click-to-call, SMS, automatic call recording with AI intelligence pipeline, and real-time call coaching.
-   **PostgreSQL**: Stores webhook logs, user accounts, client registry, and various system-specific data tables.

## Production Audit (Completed)
Audit performed across all 8 phases. Key fixes applied:
- **Focus Mode queue advancement**: Removed index-based advancement after outcome logging. Queue re-fetch naturally advances since completed actions are removed from DB. "Continue to Next" just clears explanation overlay. Removed broken "Stay Here" button.
- **Safe index clamping**: `safeIndex = Math.min(currentIndex, actions.length - 1)` prevents out-of-bounds access.
- **Explanation panel navigation**: `companyId` stored in `explanationData` so Company Detail button navigates to correct company even after queue re-fetches.
- **Session complete detection**: `isSessionComplete = totalActions === 0 && totalDone > 0` replaces index-based check. Empty queue check (`totalDone === 0`) renders first so session summary can display.
- **stateChanges accuracy**: "Next task queued" only shown for active/paused flows. Removed always-true "Airtable company status updated". Now shows "Attempt #N recorded" instead.
- **KPI accuracy**: `closedWon30` counts unique companies with `meeting_requested` outcomes (was hardcoded 0). `dmsIdentified` uses Set for unique companies (was counting events). `followupsScheduled` counts only explicit scheduling outcomes (was counting callbackAt-only). Email/LinkedIn KPI uses flowType OR channel for consistency.
- **Double-click protection**: Synchronous `submitLockRef` prevents duplicate outcome submissions.

## Not-a-Fit DQ Reason Tagging + Smart Query Retirement
"Not a Fit" outcome added to Gatekeeper and DM call flows. When selected, a DQ reason picker appears (Residential, Supplier/Distributor, Wrong Service, Too Small, Out of Area, Other). Submitting a reason:
- Sets the current flow to completed with `not_a_fit` outcome
- Terminates all other active flows for that company/client
- Cancels all pending action queue items for that company
- Writes `Lead_Status = "Disqualified"` to Airtable
- Tags the source query in Airtable's Search_Queries with `[DQ:reason]`
- Auto-retires queries where 3+ companies from the same source query are DQ'd

Key files: `focus-mode.tsx` (UI), `flow-engine.ts` (computeNextAction + handleDqQueryFeedback), `airtable-writeback.ts` (mapOutcomeToLeadStatus)

## Coaching Toggle
Per-client setting to enable/disable live AI coaching during calls. When disabled, calls still get recorded and transcribed post-call (cheaper). Toggle available in Machine Settings under "Call Settings" card.
- Schema: `clients.coaching_enabled` (boolean, default true)
- API: `GET/PATCH /api/coaching/status` with `{ enabled: boolean }`
- Backend: `twilio-routes.ts` checks client setting before attaching media stream; skips `registerCoachingSession` when off
- UI: Toggle switch in `machine-settings.tsx` with feature list showing what's always included vs coaching-only