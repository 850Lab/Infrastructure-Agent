# Texas Automation Systems — Lead Engine Command Center

## Overview
This project is a multi-tenant B2B lead generation and call management system designed to automate and streamline lead processes, manage call operations, and provide real-time insights via a "Command Center" dashboard. It offers real-time data visualization, AI-powered lead enrichment, dynamic playbook generation, and comprehensive analytics. The system aims to serve Gulf Coast industrial contractors initially, with future plans for broader industry expansion by automating and optimizing lead management and sales outreach.

## User Preferences
I prefer iterative development with clear communication at each stage.
I value detailed explanations for complex features and architectural decisions.
Please ask before making any major changes or refactoring large parts of the codebase.
Ensure the codebase remains clean, well-documented, and follows best practices for maintainability and scalability.
I want the agent to prioritize high-impact features and focus on delivering tangible business value.
I prefer to use the web dashboard for daily operations and monitoring, with CLI tools primarily for setup and troubleshooting.

## System Architecture
The system employs a micro-frontend-like structure with distinct frontend and backend separation, supporting a multi-tenant architecture with role-based access control and client data isolation.

### UI/UX Decisions
The frontend is a React application built with Shadcn UI and Framer Motion, featuring a modern design with a white background, dark text, and emerald green accents. The dashboard includes a three-column layout, a dynamic 8-node SVG "Neural Network" visualization (Pulse Reactor), and uses Server-Sent Events (SSE) for real-time data updates.

### Technical Implementations
The **backend** is developed with Express and TypeScript, while the **frontend** is an 11-page React application optimized for performance with virtualization and React Query caching. **PostgreSQL** stores webhook logs, user accounts, and client registry. **Authentication** is database-backed with token-based security. **Real-time communication** is handled by Server-Sent Events (SSE) with an in-memory EventBus. A daily **orchestrator** manages lead generation steps. **Data persistence** primarily uses Airtable with JSON file fallbacks. **KPI tracking** computes and caches performance metrics. A **Call Recording + Transcription Pipeline** processes audio, transcribes it using Whisper, and performs containment analysis via deterministic rules and GPT-4o. A **Playbook Feedback Loop** leverages analyzed call data to refine outreach playbooks. A **Briefing Engine** generates daily summaries and recommended actions.

The system incorporates a **Closed-Loop Sales Learning System** with four layers: an **Observation Engine** for structured call insights, an **Interpretation Engine** for classifying interactions and computing severity scores, a **Pattern Engine** for aggregating insights across calls, and an **Optimization Engine** for generating structured `Script_Patches`. This system feeds into a **Script Evolution Layer** which creates operator-facing recommendations and manages playbook versioning.

A **DM Decision Authority Learning Loop** learns which decision maker titles lead to successful deals, evolving DM targeting and query generation based on real outreach data. This includes **Win Tiers** for classifying deal progression, **DM Outcome Tracking**, a **DM Authority Learning Engine** for title effectiveness, and **Adaptive DM Fit** for adjusting DM scoring. **No Authority Detection** automatically identifies "wrong person" calls using rule-based and AI analysis.

Key features include a **Command Center Dashboard**, **Lead Engine**, **DM Enrichment**, **Playbook Generator**, **Run Diff**, **Revert Last Run**, **Call Outcome Engine**, **Opportunities Pipeline**, **Call Mode**, **Machine Feedback**, **Rank Explainability Layer**, **Machine Identity & Settings**, **First-Run Cinematic**, **Onboarding Wizard**, and an **Admin Platform**. **Targeting Accuracy** is measured as a score based on data completeness for critical fields. The system includes **Auth & Client Context** management for multi-tenant operations and **Production Safety** measures such as React Error Boundaries, server Process Guards, Concurrency Guards, Rate Limit Handling, and Fetch Timeouts.

## External Dependencies
-   **Airtable**: Primary data store.
-   **OpenAI**: Used for Whisper (audio transcription), GPT (GPT-4o) for containment analysis, website crawling, DM fit scoring, and playbook generation.
-   **Make.com**: Integrated for scenario auditing and blueprint management.
-   **Apollo.io**: Used for decision-maker enrichment and data acquisition.
-   **Outscraper**: Utilized for Google Maps searches and website lookup services.
-   **PostgreSQL**: Stores webhook processing logs, user accounts, and client registry.