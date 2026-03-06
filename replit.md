# Texas Automation Systems — Lead Engine Command Center

## Overview
This project is a multi-tenant B2B lead generation and call management system, "Lead Engine Command Center." It automates and streamlines lead processes, manages call operations, and provides real-time insights via a central dashboard. Key capabilities include real-time data visualization, AI-powered lead enrichment, dynamic playbook generation, and comprehensive analytics. The system aims to optimize lead management and sales outreach, initially targeting Gulf Coast industrial contractors with plans for broader industry expansion.

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
The frontend is a React application utilizing Shadcn UI and Framer Motion. It features a modern design with a white background, dark text, and emerald green accents. The dashboard incorporates a three-column layout, a dynamic 8-node SVG "Neural Network" visualization (Pulse Reactor), and uses Server-Sent Events (SSE) for real-time data updates.

### Technical Implementations
The **backend** is built with Express and TypeScript, while the **frontend** is an 11-page React application optimized with virtualization and React Query caching. **PostgreSQL** is used for webhook logs, user accounts, client registry, `recovery_queue`, `outreach_pipeline`, `client_email_settings`, `email_sends`, `email_tracking_events`, `email_replies`, `authority_trends`, `platform_insights`, and `machine_alerts`. **Authentication** is database-backed and token-based. **Real-time communication** uses SSE with an in-memory EventBus. A daily **orchestrator** manages lead generation. **Data persistence** primarily uses Airtable, with JSON file fallbacks. **KPI tracking** computes and caches performance metrics.

Key features include a **Command Center Dashboard**, **Lead Engine**, **DM Enrichment**, **Playbook Generator**, **Run Diff**, **Revert Last Run**, **Call Outcome Engine**, **Opportunities Pipeline**, **Call Mode**, **Machine Feedback**, **Rank Explainability Layer**, **Machine Identity & Settings**, **First-Run Cinematic**, **Onboarding Wizard**, and an **Admin Platform**. **Targeting Accuracy** is measured based on data completeness. The system includes **Auth & Client Context** management and **Production Safety** measures (React Error Boundaries, Process Guards, Concurrency Guards, Rate Limit Handling, Fetch Timeouts).

Specific engines and loops include:
-   **Call Recording + Transcription Pipeline**: Processes audio, transcribes with Whisper, performs containment analysis via deterministic rules and GPT-4o.
-   **Playbook Feedback Loop**: Refines outreach playbooks based on analyzed call data.
-   **Briefing Engine**: Generates daily summaries and recommended actions.
-   **Closed-Loop Sales Learning System**: Comprises an **Observation Engine**, **Interpretation Engine**, **Pattern Engine**, and **Optimization Engine** to generate `Script_Patches` for a **Script Evolution Layer**.
-   **DM Decision Authority Learning Loop**: Learns effective DM titles, evolving targeting and query generation. Includes **Win Tiers**, **DM Outcome Tracking**, **DM Authority Learning Engine**, **Adaptive DM Fit**, and **No Authority Detection**.
-   **Query Generation Performance Tracking**: Compares lead quality across ColdStart, QueryIntel, and WinPattern modes.
-   **Time-Decay Weighting**: Prioritizes recent signals in learning systems.
-   **Authority Trend Tracking**: Stores historical DM title effectiveness in PostgreSQL.
-   **Cross-Client Learning**: Aggregates anonymized title performance data across clients to inform DM fit scoring.
-   **DM Status Classification**: Evaluates company DM data quality, assigning statuses like `DM_READY`, `NO_DM`, etc., and updates Airtable.
-   **DM Recovery Queue**: Reprocesses companies without usable DMs using a persistent PostgreSQL queue with backoff scheduling.
-   **Information Ceiling Detection**: Identifies when automated recovery options are exhausted for a company.
-   **6-Touch Outreach Pipeline**: Generates and manages structured outreach sequences (emails and calls) for eligible companies, tracking status and progress.
-   **Per-Client Email Sending & Tracking**: Allows clients to configure their own SMTP, send emails directly from the Active Outreach page, and track opens and clicks via transparent pixels and wrapped links.
-   **Reply Detection**: Monitors client IMAP inboxes for replies to outreach emails, using `In-Reply-To` and `References` headers, and automatically pauses pipelines upon detection.
-   **Provider-Aware Sending Limits**: Auto-detects email provider from SMTP host (Gmail, Outlook, Yahoo, SendGrid, HubSpot, Zoho, Custom), enforces provider-specific daily limits and send pacing. Includes quota status display on Email Settings and Active Outreach pages, deferred sends tracking when daily limits are reached, and configurable throttle intervals. Backend uses `enforceThrottle()` with in-memory timestamp tracking, `getSendQuotaStatus()` for real-time quota data, and returns 429 for deferred sends.
-   **Machine Alerts**: Proactive anomaly detection system checking for `title_performance_change`, `title_decline`, `authority_mismatch_spike`, and `query_performance_shift`, storing alerts in PostgreSQL and displaying them on the dashboard.

## External Dependencies
-   **Airtable**: Primary data store.
-   **OpenAI**: Used for Whisper (audio transcription), GPT (GPT-4o) for containment analysis, website crawling, DM fit scoring, and playbook generation.
-   **Make.com**: Integrated for scenario auditing and blueprint management.
-   **Apollo.io**: Used for decision-maker enrichment and data acquisition.
-   **Outscraper**: Utilized for Google Maps searches and website lookup services.
-   **PostgreSQL**: Stores webhook logs, user accounts, client registry, and various system-specific data tables.