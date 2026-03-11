# Texas Automation Systems — Lead Engine Command Center

## Overview
This project, "Lead Engine Command Center," is a multi-tenant B2B lead generation and call management system designed to automate and streamline lead processes, manage call operations, and provide real-time insights. Key capabilities include real-time data visualization, AI-powered lead enrichment, dynamic playbook generation, and comprehensive analytics. The system aims to optimize lead management and sales outreach, targeting industrial contractors with plans for broader industry expansion. It provides a central dashboard for monitoring and managing lead generation and sales activities.

## User Preferences
I prefer iterative development with clear communication at each stage.
I value detailed explanations for complex features and architectural decisions.
Please ask before making any major changes or refactoring large parts of the codebase.
Ensure the codebase remains clean, well-documented, and follows best practices for maintainability and scalability.
I want the agent to prioritize high-impact features and focus on delivering tangible business value.
I prefer to use the web dashboard for daily operations and monitoring, with CLI tools primarily for setup and troubleshooting.

## System Architecture
The system employs a micro-frontend-like architecture with distinct frontend and backend separation, supporting multi-tenancy with role-based access control and client data isolation.

### UI/UX Decisions
The frontend is a React application using Shadcn UI and Framer Motion, featuring a modern design with a white background, dark text, and emerald green accents. The dashboard includes a three-column layout, a dynamic 8-node SVG "Neural Network" visualization (Pulse Reactor), and uses Server-Sent Events (SSE) for real-time data updates. A public landing page/product tour is available at `/site` for an interactive guided demo.

### Technical Implementations
The **backend** is built with Express and TypeScript, while the **frontend** is an 11-page React application optimized with virtualization and React Query caching. **PostgreSQL** is used for various data, including webhook logs, user accounts, client registry, and system-specific tables. **Airtable** serves as the primary data persistence layer for business logic, with JSON file fallbacks. **Authentication** is database-backed and token-based. **Real-time communication** uses SSE with an in-memory EventBus. A daily orchestrator manages lead generation.

Key features include:
-   **Command Center Dashboard**: Central hub for operations.
-   **AI-Powered Engines**: Lead Engine, DM Enrichment, Playbook Generator, Call Outcome Engine, Briefing Engine, Closed-Loop Sales Learning System (Observation, Interpretation, Pattern, Optimization Engines), DM Decision Authority Learning Loop, Web Intel Scraper (for sales intel extraction), and Machine Alerts.
-   **Outreach Management**: Unified Outreach Hub for email and call execution, 6-Touch Outreach Pipeline (configurable for calls-first or email-first), Per-Client Email Sending & Tracking (with provider-aware limits and scheduled sending), Email Performance Analytics, Template Customization, and Reply Detection.
-   **Call Processing**: Call Recording + Transcription Pipeline with automatic follow-up date extraction.
-   **Workflow & Productivity**: Run Diff, Revert Last Run, Opportunities Pipeline, Machine Feedback, Rank Explainability Layer, Machine Identity & Settings, First-Run Cinematic, Onboarding Wizard, Admin Platform, and Focus Mode for guided daily work sessions.
-   **Data Quality & Learning**: Targeting Accuracy, Query Generation Performance Tracking, Time-Decay Weighting, Authority Trend Tracking, Cross-Client Learning, DM Status Classification, DM Recovery Queue, and Information Ceiling Detection.
-   **Production Safety**: Includes React Error Boundaries, Process Guards, Concurrency Guards, Rate Limit Handling, and Fetch Timeouts.
-   **Compliance Pages**: Public `/privacy` and `/terms` pages for Twilio A2P registration, with footer links from the landing page.
-   **Contacts/Lead Management**: Redesigned contacts page with Add Lead form (manual company creation in Airtable), per-company Enrich button (triggers DM enrichment + web intel), search/filter, expandable detail rows. API endpoints: `GET /api/companies`, `POST /api/companies/add`, `POST /api/companies/:id/enrich`.
-   **My Leads Page**: Dedicated page (`/machine/my-leads`) for manually added leads with full tool access — call logging, playbooks, enrich, and proposal creation. Manual lead tracking uses PostgreSQL `manual_leads` table to store Airtable record IDs, then batch-fetches company data from Airtable. Custom proposal modal with line items, tax, features/terms. Proposals are emailed directly to the client contact as a formatted HTML email via the operator's SMTP settings. HubSpot sync is optional (runs if connected). API endpoints: `GET /api/companies/manual`, `POST /api/proposals/create`.
-   **Multi-Campaign Support**: Allows for multiple active campaigns, each with isolated data and configurable settings.
-   **LNG Relationship Intelligence Engine**: Client-specific feature (TCDT only) at `/machine/lng-projects`. Upgraded from basic search to a full Relationship Intelligence Engine that produces Operator Cards per company: Company → Priority People → What They Care About → Professional Environments → Best Connectors → Best Next Room → Best Action → Talking Angle → Confidence Score. Uses 6 search angles via Outscraper + GPT-4o analysis. Ethical rules: only public professional data, never fabricates names, never collects private/personal details. Cards can be saved to PostgreSQL (`lng_operator_cards` table with JSON card_data) with notes. Legacy tables (`lng_projects`, `lng_contacts`, `lng_intel`) retained for saved data. Backend: `server/lng-projects.ts`. Frontend: `client/src/pages/lng-projects.tsx`.

## External Dependencies
-   **Airtable**: Primary data store.
-   **OpenAI**: Used for Whisper (audio transcription), GPT (GPT-4o) for containment analysis, web crawling, DM fit scoring, and playbook generation.
-   **Make.com**: Integrated for scenario auditing and blueprint management.
-   **Apollo.io**: Used for decision-maker enrichment and data acquisition.
-   **Outscraper**: Utilized for Google Maps searches and website lookup services.
-   **HubSpot**: Per-client OAuth integration. Auto-syncs call outcomes as notes/engagements, DMs as contacts, qualified deals as HubSpot deals, and companies. Won deals auto-generate invoices (sales proposals) as structured notes linked to deals/companies/contacts. HubSpot sync on proposals is optional — runs only if connected. Sync module: `server/hubspot-sync.ts`. OAuth routes: `server/hubspot.ts`. Token storage: `hubspot_tokens` DB table.
-   **Email Proposals**: Proposals from both My Leads and Pipeline pages are sent as formatted HTML emails to the client contact via the operator's SMTP settings (configured in Email Settings). Uses `sendProposalEmail` in `server/email-service.ts`. All user-supplied text is HTML-escaped to prevent injection.
-   **Twilio**: Connected via Replit integration (connector). Provides click-to-call and SMS sending directly from Call Mode. Service module: `server/twilio-service.ts`. Routes: `server/twilio-routes.ts`. API endpoints: `GET /api/twilio/status`, `POST /api/twilio/call`, `POST /api/twilio/sms`, `GET /api/twilio/calls`, `GET /api/twilio/messages`, `GET /api/twilio/call/:sid`. Buttons appear in Call Mode only when Twilio is connected. SMS modal pre-fills with playbook followup text. SMS consent page at `/sms-consent` for Twilio A2P verification.
-   **PostgreSQL**: Stores webhook logs, user accounts, client registry, and various system-specific data tables.