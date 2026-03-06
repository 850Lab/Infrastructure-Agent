# Texas Automation Systems — Lead Engine Command Center

## Overview
This project is a multi-tenant B2B lead generation and call management system designed to automate and streamline lead processes, manage call operations, and provide real-time insights via a "Command Center" dashboard. It offers real-time data visualization, AI-powered lead enrichment, dynamic playbook generation, and comprehensive analytics, catering initially to Gulf Coast industrial contractors with plans for broader industry expansion.

## User Preferences
I prefer iterative development with clear communication at each stage.
I value detailed explanations for complex features and architectural decisions.
Please ask before making any major changes or refactoring large parts of the codebase.
Ensure the codebase remains clean, well-documented, and follows best practices for maintainability and scalability.
I want the agent to prioritize high-impact features and focus on delivering tangible business value.
I prefer to use the web dashboard for daily operations and monitoring, with CLI tools primarily for setup and troubleshooting.

## System Architecture
The system utilizes a micro-frontend-like structure with distinct frontend and backend separation.

### Multi-Tenant Architecture
The platform supports multiple clients with role-based access control (`platform_admin`, `client_admin`, `operator`). Client data is isolated using scoped queries and an event bus. Usage limits are enforced, and all data operations are client-scoped to ensure data segregation.

### UI/UX Decisions
The frontend is built with React, Shadcn UI, and Framer Motion, featuring a modern design. The primary color scheme uses a white background with dark text and emerald green accents. The dashboard includes a three-column layout with a dynamic 8-node SVG "Neural Network" visualization (Pulse Reactor) and utilizes Server-Sent Events (SSE) for real-time data updates.

### Technical Implementations
The **backend** is developed with Express and TypeScript, while the **frontend** is an 11-page React application optimized for performance with virtualization and React Query caching. **PostgreSQL** stores webhook logs, user accounts, and client registry. **Authentication** is database-backed with token-based security and cross-tab synchronization. **Real-time communication** is handled by Server-Sent Events (SSE) with an in-memory EventBus, robust re-connection logic, and event de-duplication. A daily **orchestrator** manages lead generation steps, preventing concurrent runs. **Data persistence** uses Airtable as the primary source with JSON file fallbacks. **KPI tracking** computes and caches lifetime counters and daily/weekly performance metrics. A **Call Recording + Transcription Pipeline** processes uploaded audio, transcribes it using Whisper, and performs containment analysis via deterministic rules and GPT-4o, with real-time feedback on the UI. A **Playbook Feedback Loop** leverages analyzed call data to regenerate and refine outreach playbooks, specifically addressing identified problems. A **Briefing Engine** generates daily summaries and recommended actions. The system supports **industry-specific configurations** via environment variables.

### Feature Specifications
Key features include a **Command Center Dashboard** with real-time visualizations, a **Lead Engine** for lead generation and enrichment, **DM Enrichment** using external services, and a **Playbook Generator** for dynamic outreach scripts. A **Run Diff** feature tracks changes between daily runs, while a **Revert Last Run** capability allows rolling back specific categories of changes. The **Call Outcome Engine** processes call logs, updates lead statuses, and manages follow-ups, automatically creating opportunities. An **Opportunities Pipeline** tracks deals through various stages with auto-generated actions. **Call Mode** provides a dedicated interface for rapid call sessions. **Machine Feedback** uses narrative micro-interactions for system labels and toast notifications. A **Rank Explainability Layer** offers transparency into lead ranking. **Machine Identity & Settings** allow configuration via the dashboard. The system also includes a **First-Run Cinematic** and an **Onboarding Wizard** for new users, alongside an **Admin Platform** for client and platform management.

### Production Safety
The application is wrapped in a React **Error Boundary**. The server includes **Process Guards** for unhandled rejections and exceptions. **Concurrency Guards** prevent duplicate pipeline runs. The system incorporates **Rate Limit Handling** and **Fetch Timeouts** for external API calls, and new companies include **Source Attribution** for traceability.

## External Dependencies
-   **Airtable**: Primary data store for run history, user configurations, machine metrics, and various data points.
-   **OpenAI**: Used for Whisper (audio transcription), GPT (GPT-4o) for containment analysis, website crawling fallback, DM fit scoring, and playbook generation.
-   **Make.com**: Integrated for scenario auditing and blueprint management.
-   **Apollo.io**: Used for decision-maker enrichment and data acquisition.
-   **Outscraper**: Utilized for Google Maps searches and website lookup services.
-   **PostgreSQL**: Stores webhook processing logs, user accounts, and client registry.