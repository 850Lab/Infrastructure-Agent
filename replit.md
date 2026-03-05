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
**Frontend**: A 7-page React application for various operational views (Dashboard, Today's Call List, Follow-ups, Lead Engine, Contacts, Analytics).
**Database**: PostgreSQL is utilized for storing webhook processing logs.
**Authentication**: Token-based authentication with UUID tokens, 24-hour expiry, and automatic token management. Cross-tab synchronization ensures consistent login states.
**Real-time Communication**: Server-Sent Events (SSE) provide live updates for dashboard components, including run status, step progress, and event logs. An in-memory EventBus manages SSE pub/sub.
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
**Call Outcome Engine**: Processes call logs, updates lead statuses, schedules follow-ups, and adjusts engagement scores.
**Opportunity Engine**: Generates bucket-based call lists (Hot, Working, Fresh).
**Query Intelligence Engine**: Evolves search queries based on outcomes and discovery.
**DM Coverage Engine**: Identifies and fills gaps in decision-maker coverage for call lists.
**Rank Explainability Layer**: Provides transparency on lead ranking decisions.
**Onboarding Wizard**: A multi-step process for first-time users to configure market, opportunity, geography, and DM focus.

## External Dependencies
- **Airtable**: Used for storing webhook processing logs, run history, user configurations, machine metrics, and as a source for various data points. The REST API is heavily integrated.
- **OpenAI**: Utilized for:
    - **Whisper**: For audio transcription (likely for voice memo analysis, though not explicitly detailed in the compressed section).
    - **GPT (GPT-4o)**: For containment analysis, website crawling fallback, offer-aware DM fit scoring, and generating outreach playbooks.
- **Make.com**: Integrated for scenario auditing and blueprint management via its API.
- **Apollo.io**: Used for decision-maker enrichment and data acquisition.
- **Outscraper**: Utilized for Google Maps searches and website lookup services to feed the lead engine.
- **PostgreSQL**: The built-in Replit database is used for storing webhook processing logs.