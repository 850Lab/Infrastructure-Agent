# COMPLETE SYSTEM ARCHITECTURE & UX AUDIT
## Texas Cooldown Trailers — Gulf Coast Industrial Outbound Sales Machine
**Audit Date:** March 11, 2026
**Prepared For:** External architect handoff and redesign planning

---

## SECTION 1 — CURRENT PRODUCT STRUCTURE

### Pages & Modules (All frontend routes, what they do, and alignment assessment)

| # | Page / Route | File | What It Does | User Action It Supports | Alignment to 1-1-1 Model |
|---|---|---|---|---|---|
| 1 | **Dashboard** `/machine/dashboard` | `dashboard.tsx` | Neural OS control center. Shows system status (Running/Standby/Error), memory counts (companies, DMs, calls, wins), targeting accuracy, intelligence cards (DM authority rankings, top queries, win patterns, authority miss rate, signal recency), run timeline, and neural network visualization. | View system state, trigger manual runs, revert runs, navigate to sub-pages | **Distracting** — built for a "machine operator" watching AI, not a salesperson executing calls. Heavy on analytics, light on action. |
| 2 | **Today / Mission Control** `/machine/today` | `today.tsx` | Daily prioritized call list (top 25). Shows company cards with phone numbers, DM info, bucket labels (Hot/Working/Fresh), AI playbooks (opener, gatekeeper, voicemail, follow-up scripts). | Copy phone, log call outcomes, view scripts, run pipeline | **Operationally necessary** — this is the closest thing to the daily action hub. |
| 3 | **Focus Mode** `/machine/focus` | `focus-mode.tsx` | Single-card-at-a-time execution mode. Shows one company with full context (scripts, intel, contact info), touch sequence badge (Call/Email), outcome logging buttons, session progress bar. Twilio call + live coaching panel. | Execute calls one-by-one, log outcomes, send emails, advance through list | **Operationally necessary** — the best execution interface, but needs redesign to support multi-flow logic (currently forces linear touch sequence). |
| 4 | **My Leads** `/machine/my-leads` | `my-leads.tsx` | Manual lead management. Add companies manually, view enrichment status, log outcomes, Twilio calling with live coaching, generate proposals/invoices. Quick Dial feature. | Add leads, call, log outcomes, enrich, create proposals | **Supportive** — useful for leads added outside the machine, but duplicates much of Today/Focus. |
| 5 | **Active Outreach** `/machine/outreach` | `active-outreach.tsx` | 6-touch sequence pipeline view. Shows touch timeline (3 calls + 3 emails over 14 days), email editor, tracking badges (Sent/Opened/Clicked/Replied), outcome logging. | Monitor sequences, edit emails, track engagement | **Supportive** — useful for email sequence management but the 6-touch model is too rigid for the 5-flow reality. |
| 6 | **Follow-ups** `/machine/followups` | `followups.tsx` | Queue of scheduled follow-ups. Segments Overdue vs. Upcoming (Today/Tomorrow). Shows last outcome, bucket, direct call links. | Execute scheduled callbacks | **Operationally necessary** — but should be integrated into the primary action view, not a separate page. |
| 7 | **Lead Engine** `/machine/lead-engine` | `lead-engine.tsx` | Query Intelligence interface. Shows search queries, their performance, win patterns, and lead generation stats. | View/manage search queries, trigger lead feed runs | **Supportive** — admin/review function, not daily execution. |
| 8 | **Contacts** `/machine/contacts` | `contacts.tsx` | Searchable database of all decision makers across companies. | Search contacts, view DM details | **Redundant** — data already visible on company cards in Today/Focus. Could be demoted to search. |
| 9 | **Pipeline** `/machine/pipeline` | `pipeline.tsx` | Sales pipeline/deal tracking view (Kanban or list). | Track deals through stages | **Supportive** — but currently disconnected from the daily call flow. |
| 10 | **Analytics** `/machine/analytics` | `analytics.tsx` | Performance metrics, accuracy reports, conversion analytics. | Review historical performance | **Distracting for daily use** — weekly/monthly review tool at best. |
| 11 | **Briefing** `/machine/briefing` | `briefing.tsx` | Daily highlights and recommended "Next Best Action." | Get daily summary | **Supportive** — good concept but currently a standalone page rather than integrated into the main flow. |
| 12 | **Machine Settings** `/machine/settings` | `machine-settings.tsx` | Core configuration: industry, territory, targeting rules. | Configure system | **Necessary but infrequent** — settings page, fine as-is. |
| 13 | **Email Settings** `/machine/email-settings` | `email-settings.tsx` | SMTP/IMAP config, templates, send limits. | Configure email outreach | **Necessary but infrequent** — same as above. |
| 14 | **LNG Projects** `/machine/lng-projects` | `lng-projects.tsx` | Specialized LNG industry tracker. TCDT-exclusive. | Track LNG projects, operators, contacts | **Niche** — valuable for TCDT specifically but not part of core 1-1-1 flow. |
| 15 | **Cinematic** `/machine/cinematic` | `cinematic.tsx` | Visual "Neural OS" presentation/demo mode. | Impress stakeholders | **Distracting** — demo tool, not operator tool. |
| 16 | **Onboarding** `/machine/onboarding` | `onboarding.tsx` | New client setup wizard. | Initial configuration | **Necessary** — one-time use. |
| 17 | **Landing** `/site` | `landing.tsx` | Public-facing marketing page. | Attract prospects | N/A to operator flow. |
| 18 | **Make Auditor** (no route) | `make-auditor.tsx` | Make.com audit log viewer. | Debug Make.com integrations | **Redundant** — legacy debugging tool. |
| 19 | **Admin Dashboard** `/admin/dashboard` | `admin/dashboard.tsx` | Platform-wide stats for admin. | Monitor all clients | Admin-only, not operator-facing. |
| 20 | **Admin Clients** `/admin/clients` | `admin/clients.tsx` | Client management. | Manage tenants | Admin-only. |
| 21 | **Admin Provision** `/admin/provision` | `admin/provision.tsx` | New client setup. | Create tenants | Admin-only. |
| 22 | **Admin Runs** `/admin/runs` | `admin/runs.tsx` | Global run history. | Monitor all pipeline runs | Admin-only. |
| 23 | **Admin Support** `/admin/support` | `admin/support.tsx` | System diagnostics. | Debug platform issues | Admin-only. |

### Summary Count
- **21 operator-facing pages/modules** (excluding admin, login, legal)
- **3 operationally necessary**: Today, Focus Mode, Follow-ups
- **5 supportive**: My Leads, Active Outreach, Pipeline, Lead Engine, Briefing
- **3 distracting/redundant**: Dashboard (as primary landing), Analytics, Cinematic, Contacts, Make Auditor
- **3 settings/config**: Machine Settings, Email Settings, Onboarding
- **1 niche**: LNG Projects

---

## SECTION 2 — CURRENT DATA MODEL

### Primary Data Store: Airtable (System of Record)

#### Companies Table (~445 records for TCDT)
**Purpose:** Central lead/account record. Every company the system has discovered or been given.
**Key Fields:**
- **Identity:** `Company_Name`, `Website`, `Normalized_Domain`, `Phone`, `City`, `State`, `Category`, `Dedupe_Key`
- **Scoring/Priority:** `Priority_Score`, `Priority_Tier`, `Final_Priority`, `Bucket` (Hot/Working/Fresh), `Engagement_Score`, `Opportunity_Score`
- **Status:** `Lead_Status`, `Today_Call_List` (boolean), `DM_Status` (NO_DM, DM_READY, DM_WEAK, NO_WEBSITE, RECOVERY_IN_PROGRESS, READY_FOR_OUTREACH), `enrichment_status`
- **Decision Maker (Primary):** `Primary_DM_Name/Title/Email/Phone/Seniority/Source/Confidence`
- **Decision Maker (Offer-Specific):** `Offer_DM_Name/Title/Email/Phone/FitScore/Reason/Source/Last_Selected`
- **Offer DM Outcome:** `Offer_DM_Outcome`, `Offer_DM_Title_At_Contact` (tracks what happened when we called this DM)
- **Gatekeeper:** `Gatekeeper_Name`, `Gatekeeper_Phone`, `Gatekeeper_Email`, `Gatekeeper_Last_Spoken`, `Gatekeeper_Notes`
- **Call History:** `Times_Called`, `Last_Outcome`, `Followup_Due`
- **Playbook:** `Playbook_Call_Opener`, `Playbook_Gatekeeper_Ask`, `Playbook_Voicemail`, `Playbook_Email_Subject/Body`, `Playbook_Followup_Text`, `Playbook_Version/Last_Generated/Strategy_Notes/Learning_Version/Applied_Patches/Confidence`
- **Web Intel:** `Rank_Reason`, `Rank_Evidence`, `Rank_Inputs_JSON`, `Rank_Version`
- **Recovery:** `Recovery_Plan`, `Recovery_Attempts`, `Recovery_Last_Run`, `Info_Ceiling_Reached/Date`
- **Authority:** `Authority_Miss_Count`
- **Source:** `Source`, `Source_Query`, `Source_Query_Mode`, `Win_Flag`
- **Social:** `Social_Media`, `linkedin_url`, `company_summary`
- **Multi-tenant:** `Client_ID` (field name mismatch — system can't find it, currently all queries skip scope filter)

**How records move:** Outscraper/lead feed → Companies table → scored by Opportunity Engine → `Today_Call_List=TRUE` for top 25 → DM enrichment → Playbook generation → Operator calls → Outcome logged → Follow-up scheduled → Recycled or Won.

#### Decision_Makers Table (~644 records for TCDT)
**Purpose:** Individual contact profiles linked to companies.
**Key Fields:** `company_name_text`, `full_name`, `title`, `email`, `phone`, `linkedin_url`, `seniority`, `department`, `source`, `enriched_at`
**How records are created:** Apollo enrichment, website crawling, or manual entry. DM Resolver picks the "Primary DM" and DM Fit picks the "Offer DM" from this pool.

#### Calls Table
**Purpose:** Call log and AI analysis.
**Key Fields:** `Company` (linked), `Call_Time`, `Outcome` (DM/GK/No Answer/Qualified/Callback/Not Interested), `Notes`, `VoiceMemo_URL`, `Transcription`, `Analysis`, `Next_Followup`, `Processed` (boolean), `Gatekeeper_Name`, `Sales_Learning_Processed`, `No_Authority`, `Authority_Reason`
**Triggers updates to:** `Times_Called`, `Last_Outcome`, `Followup_Due`, `Engagement_Score` on Companies.

#### Search_Queries Table
**Purpose:** AI-generated search queries for finding new leads.
**Key Fields:** Query text, performance score, category, city, win attribution.

#### Opportunities Table
**Purpose:** Deal/pipeline tracking.
**Key Fields:** Stage, value, company link.

#### Run_History Table
**Purpose:** Audit log of automated pipeline runs.

### Secondary Data Store: PostgreSQL (Local DB)

| Table | Purpose | Key Status/Flow |
|---|---|---|
| `clients` | Multi-tenant config | `status`: active/inactive |
| `users` | Auth & roles | `role`: operator/platform_admin |
| `client_config` | Run limits/quotas | Static config |
| `outreach_pipeline` | 6-touch email/call sequences | `pipelineStatus`: ACTIVE/PAUSED/STOPPED/RESPONDED |
| `recovery_queue` | Self-healing lead fixes | `priority`: high/medium/low, `active`: boolean |
| `client_email_settings` | SMTP/IMAP config | `providerType`, `autoSendEnabled` |
| `email_sends` | Individual email tracking | `status`: sent/failed |
| `email_tracking_events` | Open/click pixel tracking | `eventType`: open/click |
| `email_replies` | IMAP reply detection | Links to pipeline |
| `email_templates` | Reusable email content | Per-client, per-touch |
| `twilio_recordings` | Call recordings + AI analysis | `status`: pending/analyzed_live |
| `usage_logs` | Internal metrics | Step-level logging |
| `webhook_logs` | Airtable processing logs | `status`: pending/processed |
| `machine_alerts` | System anomaly alerts | `severity`: info/warning/error |
| `authority_trends` | DM authority snapshots | Time-series data |
| `platform_insights` | Cross-client benchmarks | Industry-wide |
| `hubspot_tokens` | HubSpot OAuth | Token storage |
| `lng_projects/contacts/intel/operator_cards` | LNG-specific | TCDT-exclusive |

### What's Missing for the 5 Flows

1. **No dedicated Contact Attempt Log** — The system logs calls at the company level, not per-contact. If you call the gatekeeper 3 times and then the DM twice, it's all just "5 calls to Company X." No per-person attempt history.
2. **No Flow State Machine** — There's no entity that tracks "this company is in Gatekeeper Discovery Flow, step 3." The `outreach_pipeline` tracks a rigid 6-touch sequence but doesn't model parallel flows.
3. **No LinkedIn Activity Tracking** — Zero schema support. No table, no fields, no status tracking.
4. **No Gatekeeper Result Taxonomy** — `Gatekeeper_Name` and `Gatekeeper_Notes` exist but there's no structured "gave DM name / gave extension / transferred / refused / voicemail" classification.
5. **No Nurture/Recycle Queue** — `recovery_queue` handles data gaps, not sales nurture. No seasonal/project-based re-engagement logic.
6. **No Per-DM Email Sequence State** — Emails are tracked per pipeline entry, not per decision maker. Can't run separate email cadences for different contacts at the same company.
7. **No Direct Line / Extension Field** — DM phone exists but there's no distinction between "main company line" and "direct extension."

---

## SECTION 3 — CURRENT USER FLOW

### What Happens When You Log In
1. POST `/api/auth/login` with email/password → receive bearer token
2. Redirect to `/machine/dashboard` (the Neural OS control center)
3. Dashboard loads: system status pill, memory counts, intelligence cards, neural network visualization, run timeline
4. User sees a "Focus Mode" button and section navigation buttons (Today, Pipeline, Follow-ups, Lead Engine, Contacts, Analytics, Outreach, My Leads)

### Intended Operator Journey
1. Dashboard → check system status → click "Today" or "Focus Mode"
2. Today/Focus → work through 25 prioritized companies
3. For each: read script → call → log outcome → next
4. Follow-ups → handle scheduled callbacks
5. Periodically: check Analytics, review Pipeline, adjust Settings

### Real Journey the UI Currently Pushes
1. **Landing on Dashboard** → user sees a "Neural OS" brain visualization, intelligence cards about authority miss rates, signal recency, win patterns → **none of this helps make the next call**
2. User must navigate away from Dashboard to find actionable work
3. **Today page** shows call list but requires expanding each card to see scripts → extra clicks
4. **Focus Mode** is the best interface but it's accessed via a button on Dashboard, not the default landing
5. **7 navigation options** compete for attention (Today, Pipeline, Follow-ups, Lead Engine, Contacts, Analytics, Outreach, My Leads) → operator doesn't know where to go
6. **No clear "start your day here" flow** — the app assumes the operator will figure out the right page

### Where UX Is Data/Analytics Instead of Action
- **Dashboard:** 80% analytics (intelligence cards, neural network viz, run timeline), 20% action (one "Run Daily" button)
- **Lead Engine:** Shows query performance statistics — interesting but not actionable during daily calling
- **Analytics page:** Pure reporting, zero action buttons
- **Contacts page:** Database browser, not an action queue
- **Cinematic page:** Pure visualization, zero utility

### Friction, Confusion, Dead Ends
- **Too many pages that look similar:** Today, Focus Mode, My Leads, and Active Outreach all show company cards with call buttons — operator doesn't know which to use
- **Outcome logging lives on 3+ different pages** with slightly different UI patterns
- **No visual distinction between "I need to call" vs "I need to email" vs "I need to follow up"** — everything looks like a call card
- **Follow-ups are a separate page** instead of being surfaced at the top of the daily flow
- **Proposal/invoice generator** buried inside My Leads — doesn't fit the calling workflow
- **Live coaching panel** appears differently on My Leads (full panel with scrolling transcript) vs Focus Mode (compact bottom bar) — inconsistent experience

---

## SECTION 4 — CURRENT SALES LOGIC

### How the App Currently Thinks About Each Entity

**Companies:**
- Central entity. Everything revolves around the company record.
- Scored on a multi-factor priority algorithm (recency, engagement, opportunity signals).
- Bucketed: Hot Follow-up (has engagement), Working (in progress), Fresh (new).
- Top 25 selected daily for `Today_Call_List`.

**Contacts / Decision Makers:**
- Stored separately in `Decision_Makers` table, linked by company name.
- Two-tier system: "Primary DM" (highest seniority contact found) and "Offer DM" (best fit for the specific product offer).
- DM selection is **automated** by DM Fit engine based on title matching and authority learning.
- **Gap:** No concept of "all contacts I've spoken to at this company" — just the algorithmically selected best one.

**Outreach:**
- Rigid 6-touch sequence: Call → Email → Call → Email → Call → Email (over ~14 days).
- Managed by `outreach_pipeline` table.
- Touches advance on a time schedule, not based on conversation outcomes.
- **Gap:** No concept of parallel flows. Can't do "calling the gatekeeper AND emailing the DM AND connecting on LinkedIn" simultaneously.

**Follow-ups:**
- Automatically generated when a call is logged with certain outcomes.
- "No Answer" → 2 days, "Gatekeeper" → 7 days, "Callback" → 1 day, "Qualified" → 1 day.
- Stored as `Followup_Due` date on the company record.
- **Gap:** Follow-up is company-level, not contact-level. No distinction between "follow up with the gatekeeper" vs "follow up with the DM."

**Pipeline Progression:**
- Companies move through: Fresh → on Today_Call_List → called → outcome logged → follow-up scheduled → recycled back into pool or advanced to Opportunity.
- `Lead_Status` field tracks overall state but has no formal state machine.

### What the System Understands vs. Doesn't

| Capability | Current State |
|---|---|
| Multiple contact paths per company | **No** — one Offer DM selected, that's it |
| Gatekeeper attempts | **Partial** — outcome "GK" logged, gatekeeper name captured, but no structured result taxonomy |
| Direct line attempts | **No** — no distinction between company line and direct extension |
| Email sequences | **Yes** — 6-touch pipeline with auto-send, tracking, reply detection |
| LinkedIn progression | **No** — zero support |
| Nurture/recycle logic | **No** — recovery engine handles data gaps, not sales nurture |
| Multiple parallel flows per company | **No** — one linear sequence per company |
| Post-contact flow (after reaching DM) | **No** — "Qualified" outcome exists but no structured next steps |
| Gatekeeper producing DM name/extension/email | **Partial** — can capture name in `Gatekeeper_Name`, but no structured "they gave me the extension" or "they transferred me" workflow |

### Gap Between Current Logic and Desired Logic

The current system treats each company as one linear path: **discover → score → call → outcome → follow-up → recycle**. The desired model needs:

1. **Company as container** with multiple active flows running simultaneously
2. **Gatekeeper Discovery** as its own tracked flow with structured results (name given, extension given, transferred, refused, VM)
3. **DM Direct Call** as a separate tracked flow once DM info is obtained
4. **Email** as a parallel flow with its own cadence per contact
5. **LinkedIn** as a parallel flow with its own progression
6. **Nurture** as a holding queue for non-responsive leads with seasonal/project triggers
7. **Next Action** as the primary UI concept — "what do I do right now?" should surface across all flows

---

## SECTION 5 — CURRENT AUTOMATIONS

### Scheduled / Background Jobs

| # | Automation | File | Runs | Reads | Writes | Helps Execution? | Recommendation |
|---|---|---|---|---|---|---|---|
| 1 | **Scheduler** | `server/scheduler.ts` | Every 6h (5min startup delay) | `clients` table | Triggers pipeline | Infrastructure | **Keep** |
| 2 | **Daily Web Run** | `server/run-daily-web.ts` | Triggered by scheduler | Orchestrates all engines | Orchestrates all engines | Infrastructure | **Keep** (but pipeline steps need reordering) |
| 3 | **Opportunity Engine** | `server/opportunity-engine.ts` | Per pipeline run | Companies + Calls from Airtable | `Today_Call_List`, `Bucket`, `Final_Priority`, `Rank_Reason` | **Yes** — selects daily call list | **Keep** |
| 4 | **DM Resolver** | `server/dm-resolver.ts` | Per pipeline run | `Decision_Makers` table | `Primary_DM_*` fields on Companies | **Yes** — provides contact info | **Keep** |
| 5 | **DM Coverage** | `server/dm-coverage.ts` | Per pipeline run | Call list companies | Triggers enrichment for gaps | **Yes** — ensures contacts exist | **Keep** |
| 6 | **DM Fit** | `server/dm-fit.ts` | Per pipeline run | Companies + DMs + authority learning | `Offer_DM_*` fields | **Yes** — picks best contact for the offer | **Keep** (but needs multi-contact support) |
| 7 | **DM Status** | `server/dm-status.ts` | Per pipeline run | All companies | `DM_Status` classification | **Supportive** — useful for data hygiene | **Keep** |
| 8 | **Recovery Engine** | `server/recovery-engine.ts` | Per pipeline run | `recovery_queue` | Re-enrichment attempts, `Recovery_Plan` | **Supportive** — self-healing data | **Keep** |
| 9 | **Outreach Engine** | `server/outreach-engine.ts` | Per pipeline run | Companies (DM_READY/READY_FOR_OUTREACH) | `outreach_pipeline` records | **Partially** — manages email sequences | **Modify** — needs to support 5 flows, not just 6-touch |
| 10 | **Playbooks** | `server/playbooks.ts` | Per pipeline run | Companies + web intel + calls + sales learning | `Playbook_*` fields | **Yes** — generates call scripts | **Keep** |
| 11 | **Web Intel** | `server/web-intel.ts` | Per pipeline run | Google/Outscraper + company websites | `Rank_Reason`, `Rank_Evidence` | **Yes** — provides talking points | **Keep** |
| 12 | **Call Engine** | `server/call-engine.ts` | Per pipeline run | Unprocessed calls from Airtable | Company engagement scores, follow-up dates, gatekeeper names | **Yes** — processes call outcomes | **Keep** (but needs per-contact tracking) |
| 13 | **Sales Learning** | `server/sales-learning/` (6 sub-modules) | Per pipeline run | Call transcripts | Script patches, observations, patterns | **Supportive** — improves scripts over time | **Keep** (but low priority — needs call volume first) |
| 14 | **Query Intel** | `server/query-intel.ts` | Per pipeline run | Win patterns, companies | New search queries | **Supportive** — generates lead feed | **Keep** |
| 15 | **Machine Alerts** | `server/machine-alerts.ts` | Per pipeline run | Authority trends, stats | `machine_alerts` table | **Low value currently** — not enough data | **Keep but deprioritize** |
| 16 | **DM Authority Learning** | `server/dm-authority-learning.ts` | Per pipeline run | Companies with DM outcomes | Authority trends | **Supportive** — needs more data to be useful | **Keep** |
| 17 | **Auto-Sender** | `server/auto-sender.ts` | Every 15 min | `outreach_pipeline` (pending emails) | `email_sends`, pipeline updates | **Yes** — sends emails automatically | **Keep** |
| 18 | **Reply Checker** | `server/reply-checker.ts` | Every 15 min | IMAP inbox | `email_replies`, pipeline status → RESPONDED | **Yes** — detects replies | **Keep** |
| 19 | **Changeset** | `server/run-changeset.ts` | Per pipeline run | Before/after snapshots | Audit trail | **Supportive** — rollback protection | **Keep** |
| 20 | **Run Diff** | `server/run-diff.ts` | Per pipeline run | Before/after counts | Diff stats | **Low value** — nice-to-have analytics | **Keep but deprioritize** |
| 21 | **Realtime Coaching** | `server/realtime-coaching.ts` | During active calls | Twilio audio stream via OpenAI | SSE to frontend | **Yes** — live call coaching | **Keep and improve** |

### Scoring Rules & ML Behaviors
- **Opportunity Engine scoring:** Multi-weight algorithm (recency, engagement, priority tier, opportunity signals, follow-up urgency). Outputs `Final_Priority` score.
- **DM Fit scoring:** Title matching + authority learning adjustments + platform boosts. Threshold currently at 25 (lowered from 45).
- **Sales Learning closed loop:** Call transcripts → observation engine → pattern engine → script patches → injected into next playbook generation. Currently has minimal data (few processed calls).
- **Win Patterns:** Extracts top categories, cities, keywords from won deals. Currently in COLD_START_MODE (needs 3+ wins).

---

## SECTION 6 — UI/UX INVENTORY

### Layout Structure
- **Top Nav (AppLayout):** Logo/client name | machine name | status pill (Running/Standby/Error) | admin switch (if admin) | settings icon | logout
- **No persistent side nav** — navigation is via buttons within Dashboard and page headers
- **Dashboard sections:** System Status card, Machine Memory card, Targeting Accuracy card, Intelligence grid (DM Authority, Top Queries, Authority Miss Rate, Signal Recency, Win Patterns), Run Timeline, Neural Network visualization
- **Page-level navigation:** Horizontal button row on Dashboard linking to: Today, Pipeline, Follow-ups, Lead Engine, Contacts, Analytics, Outreach, My Leads

### Major UI Areas Assessment

| UI Area | What Behavior It Encourages | Helps Daily Execution? | Importance in Current Design | Assessment |
|---|---|---|---|---|
| **Neural Network Viz** | Watching the "brain" animate | No | High (visual centerpiece) | **Visually strong, strategically misaligned** — impressive demo, zero operator value |
| **System Status Card** | Checking if machine is running | Minimally | Medium | **Keep but shrink** — useful as a small indicator, not a primary card |
| **Machine Memory Counts** | Awareness of data volume | No | Medium | **Demote** — vanity metrics for daily calling |
| **Intelligence Cards** | Reviewing ML learning progress | No (weekly review at best) | High (fills dashboard) | **Demote** — valuable for system tuning, not daily work |
| **Run Timeline** | Understanding pipeline steps | No | Medium | **Demote** — admin/debug tool |
| **Today Call List** | Making calls | **Yes** | High | **Elevate** — should be primary interface |
| **Focus Mode Cards** | Executing calls efficiently | **Yes** | Medium (hidden behind button) | **Elevate** — should be the default landing experience |
| **Outcome Buttons** | Logging call results | **Yes** | Medium | **Elevate** — critical for flow progression |
| **Playbook Scripts** | Preparing for calls | **Yes** | Medium (requires expanding card) | **Elevate** — should be immediately visible |
| **Follow-up Queue** | Handling callbacks | **Yes** | Low (separate page) | **Elevate** — should be surfaced in main flow |
| **Live Coaching Panel** | Real-time call support | **Yes** | Medium | **Keep and improve** — high value when calling |
| **Proposal Generator** | Creating quotes | Occasionally | Low (buried in My Leads) | **Keep but separate** — post-call workflow, not daily calling |
| **Analytics Page** | Performance review | No (periodic) | Medium | **Demote** — move to weekly review section |
| **Cinematic Mode** | Demo/showcase | No | Low | **Remove from operator nav** |

### What Should Become Primary vs Secondary

**Primary (visible immediately on login):**
1. Today's action queue — what do I do right now?
2. Next company to call with full context
3. Overdue follow-ups surfaced at top
4. Outcome logging (one click)
5. Live coaching during calls

**Secondary (one click away):**
1. Pipeline/deals view
2. Email sequence status
3. Lead Engine / search queries
4. Proposal generator

**Hidden (admin/settings menu):**
1. Analytics
2. Intelligence cards / ML learning
3. Neural network visualization
4. Run history / changeset
5. Cinematic mode
6. Machine alerts

---

## SECTION 7 — WHAT THE SYSTEM WOULD NEED TO SUPPORT THE 5 FLOWS

### FLOW 1 — Gatekeeper Discovery

**What exists:** `Gatekeeper_Name`, `Gatekeeper_Phone`, `Gatekeeper_Email`, `Gatekeeper_Last_Spoken`, `Gatekeeper_Notes` fields on Companies. Outcome "GK" can be logged. Playbook has `Playbook_Gatekeeper_Ask` script.

**What's missing:**
- **Structured gatekeeper result tracking** — need a per-attempt log: `{attempt_date, result: "gave_dm_name" | "gave_extension" | "gave_email" | "transferred" | "voicemail" | "refused" | "no_answer", captured_info: string, next_action: string}`
- **Gatekeeper attempt counter** — currently only `Times_Called` at company level, not gatekeeper-specific
- **Next-action logic per result** — e.g., "gave DM name" → create DM record → enter Flow 2; "transferred" → log as DM attempt; "refused" → wait 14 days, try different approach
- **Gatekeeper quality scoring** — some gatekeepers are more helpful; track which approaches work
- **UI for gatekeeper outcome logging** — currently just a "GK" button with optional name capture; needs structured result modal

### FLOW 2 — Decision Maker Direct Call

**What exists:** `Offer_DM_Name/Phone/Email`, call logging with outcomes, follow-up scheduling, playbook scripts.

**What's missing:**
- **Per-DM attempt tracking** — need to know "I called John Smith 3 times, left 2 voicemails, had 1 conversation" not just "called company 6 times"
- **Voicemail vs. conversation distinction** — currently just "DM" outcome; need "DM_Voicemail" vs "DM_Live" vs "DM_Conversation"
- **Direct line / extension field** — no way to store "ext. 4523" separately from main number
- **DM-specific retry cadence** — system schedules follow-ups at company level; need per-DM cadence
- **Conversation outcome detail** — "interested but needs quote" vs "interested but wrong timing" vs "not interested" with next-action recommendations
- **Multiple DM tracking** — if gatekeeper says "talk to both the Safety Manager and the Operations VP," system should track attempts on both

### FLOW 3 — Email Flow

**What exists:** `outreach_pipeline` with touch sequence, `auto-sender` for SMTP delivery, `reply-checker` for IMAP monitoring, `email_sends` tracking (opens/clicks), `email_templates`, AI-generated email content in Playbook fields.

**What's missing:**
- **Per-DM email sequences** — currently one sequence per company; need ability to email the Safety Manager AND the Operations VP with different content
- **Email flow state independent of call flow** — currently email is touch 2/4/6 in a rigid sequence; need email as a parallel independent flow
- **Pause/resume with reason** — can set `pipelineStatus=PAUSED` but no structured reason or auto-resume logic
- **Response classification** — `reply-checker` detects replies but doesn't classify them (positive/negative/OOO/auto-reply)
- **Email flow tied to specific contact** — currently tied to company; if DM changes, email flow doesn't adapt

### FLOW 4 — LinkedIn Flow

**What exists:** `linkedin_url` field on Companies and Decision_Makers tables. That's it.

**What's needed (entirely new):**
- **LinkedIn activity entity:** `{dm_id, company_id, profile_found: boolean, profile_viewed: date, request_sent: date, request_accepted: date, message_sent: date, response_received: date, follow_up_due: date, status: "not_started" | "profile_found" | "requested" | "connected" | "messaged" | "responded" | "no_response"}`
- **LinkedIn flow cadence** — timing rules between steps (view → wait 1 day → request → wait 3 days → message)
- **UI for logging LinkedIn actions** — checkboxes or step tracker per DM
- **Integration with company timeline** — "I connected with their VP on LinkedIn" should appear in company history

### FLOW 5 — Nurture Flow

**What exists:** `recovery_queue` for data-gap recovery (not sales nurture). `Followup_Due` for scheduled callbacks.

**What's needed (mostly new):**
- **Nurture queue entity:** `{company_id, reason_entered: string, recycle_date: date, nurture_type: "seasonal" | "project_based" | "budget_cycle" | "relationship", check_in_interval: number, times_nurtured: number, last_nurture_date: date, reactivation_trigger: string}`
- **Recycle rules** — after X failed attempts with no interest, auto-move to nurture instead of keep calling
- **Seasonal/project triggers** — "Texas hurricane season starts June 1" → reactivate cooling trailer leads in May
- **Reactivation conditions** — company gets new DM, company appears in new project news, seasonal trigger fires
- **Low-effort touchpoints** — quarterly "checking in" emails, holiday greetings, industry news sharing
- **Nurture → Active conversion** — when a trigger fires, company re-enters Gatekeeper Discovery or DM Direct Call flow

---

## SECTION 8 — RECOMMENDED SYSTEM REFRAME

### Hierarchy Should Be:
1. **Companies first** — the container for all activity
2. **Contacts second** — multiple people per company, each with their own flow state
3. **Flows third** — Gatekeeper Discovery, DM Direct Call, Email, LinkedIn, Nurture — tracked per contact or per company
4. **Next Actions above all else** — the operator should always see "here's what to do right now" regardless of which flow it comes from

### Ideal Primary Dashboard (What the Operator Sees on Login)

**Instead of Neural OS brain visualization, the operator should see:**

1. **"Your Next Actions" queue** — a merged, prioritized list pulling from ALL flows:
   - "Call Calcasieu Mechanical — Gatekeeper attempt #3 (last: voicemail, try asking for Safety Dept)"
   - "Call back Turner Industries — John Smith (DM) said call Thursday AM"
   - "Send follow-up email to Performance Insulation — DM opened last email 2x"
   - "Check LinkedIn — General Insulation VP accepted your request, send message"
2. **Session stats** — calls made today, outcomes logged, emails sent (simple counters, not intelligence cards)
3. **Overdue items** — follow-ups past due, highlighted in red
4. **"Start Calling" button** → enters Focus Mode

### What Focus Mode Should Become

**Currently:** Single-card-at-a-time with rigid touch sequence (Call 1 → Email 1 → Call 2...).

**Should become:** Single-card-at-a-time but flow-aware:
- Card shows WHICH FLOW this action is for (Gatekeeper Discovery? DM Direct Call? Follow-up?)
- Outcome buttons are FLOW-SPECIFIC (Gatekeeper outcomes are different from DM outcomes)
- After logging outcome, system auto-recommends the next action for THIS company AND advances to next company
- Email actions inline (if next touch is email, show the email right there)
- LinkedIn actions inline (if next touch is LinkedIn, show the profile link and what to do)

### New Main Navigation

**Should be 4 items max:**
1. **Action Queue** (merged next-actions from all flows) — the primary landing
2. **Companies** (full company database with flow status per company)
3. **Pipeline** (deals in progress, proposals, won/lost)
4. **Settings** (machine config, email config, admin)

**Everything else should be accessible from within these views, not as top-level navigation.**

### What Should Be Hidden, Demoted, or Removed

| Action | Items |
|---|---|
| **Remove from main nav** | Cinematic, Make Auditor, Active Work |
| **Demote to admin/settings** | Analytics, Lead Engine, Machine Alerts, Neural Network, Intelligence Cards, Run History, Changeset |
| **Merge into Action Queue** | Today, Follow-ups, Focus Mode → all become one unified "Action Queue + Focus Mode" |
| **Merge into Companies** | Contacts, My Leads → all contacts visible within company view |
| **Keep as secondary tab** | Active Outreach (email sequences), Pipeline |
| **Keep as separate module** | LNG Projects (TCDT-specific) |

---

## SECTION 9 — TECHNICAL CONSTRAINTS

### UI-Only Changes (Fast — days)
- Reorder navigation items
- Change default landing page from Dashboard to a new Action Queue
- Redesign Focus Mode card layout
- Add flow-specific outcome buttons
- Hide/show sections based on user role
- Color-code flows in the UI

### Workflow Logic Changes (Medium — 1-2 weeks)
- Modify call logging to capture per-contact attempts and flow context
- Add gatekeeper result taxonomy to outcome logging
- Make follow-up scheduling contact-specific instead of company-specific
- Add flow state to Focus Mode card rendering
- Modify Outreach Engine to support parallel flows instead of linear 6-touch
- Add LinkedIn action logging

### Schema Changes (Medium — 1-2 weeks)
- **New table:** `contact_attempts` — per-contact, per-flow attempt log
- **New table:** `company_flows` — tracks which flows are active per company
- **New table:** `linkedin_activities` — LinkedIn progression per contact
- **New table:** `nurture_queue` — nurture/recycle management
- **New fields on Decision_Makers:** `direct_extension`, `last_attempt_date`, `attempt_count`, `flow_status`
- **New fields on Companies:** `active_flows` (JSON array), `nurture_status`
- Fix `Client_ID` field name mismatch in Airtable scoping

### Automation Changes (Medium — 1-2 weeks)
- Modify Opportunity Engine to score based on flow state, not just engagement
- Modify Call Engine to write per-contact attempt records
- Modify Outreach Engine to manage parallel flows
- Add nurture queue processor to scheduler
- Add LinkedIn reminder generator

### Major Architecture Changes (If needed — 3-4 weeks)
- **Airtable as source of truth vs PostgreSQL** — currently split between both. For 5-flow tracking, PostgreSQL should become primary for flow state management, with Airtable syncing for reporting.
- **Event-driven flow transitions** — outcome logging should trigger automatic flow state changes via EventBus (partially exists but not flow-aware)
- **Contact-centric model shift** — the current architecture is company-centric with DM as an attribute. The 5-flow model needs contacts as first-class entities with their own flow state.

---

## SECTION 10 — HANDOFF FORMAT

### A. Current System Summary in Plain English
A multi-tenant lead generation machine that discovers Gulf Coast industrial contractors (via Outscraper/Google Maps), enriches them with decision maker contacts (via Apollo), scores and prioritizes them daily (via AI scoring engine), generates personalized call scripts and emails (via GPT-4), and presents them to an operator in a daily call list. The operator calls from the list, logs outcomes, and the system schedules follow-ups and learns from call transcripts to improve scripts over time. It also has a 6-touch email sequence engine, Twilio VoIP with real-time AI coaching, and HubSpot/LNG integrations.

### B. Biggest UX Misalignment
The app lands on a "Neural OS" dashboard designed to impress with AI visualizations, not to help an operator make their next call. The operator has to navigate through 7+ competing page options to find their actual work. The system is built to be watched, not operated.

### C. Biggest Workflow Gap
**No concept of parallel contact flows per company.** The system treats each company as one linear path. In reality, you might be simultaneously: calling the gatekeeper to get a DM name, emailing the VP you found on LinkedIn, and waiting for a callback from the Operations Manager. The system can't track or guide any of this.

### D. Existing Strengths Worth Preserving
1. **Opportunity Engine scoring** — the daily prioritization algorithm is sophisticated and well-tuned
2. **Playbook generation** — AI-generated scripts with web intel, gatekeeper strategies, and learning patches are genuinely useful
3. **DM Fit engine** — industry-specific contact selection with authority learning is valuable
4. **Twilio integration with live coaching** — real-time transcription and alert detection during calls is production-quality
5. **Sales Learning closed loop** — call transcript → observation → pattern → script patch pipeline is architecturally sound (needs more data)
6. **Auto-sender + Reply checker** — email automation with tracking and reply detection works
7. **Recovery Engine** — self-healing data quality is smart infrastructure
8. **Focus Mode concept** — single-card execution interface is the right UX pattern, just needs flow awareness

### E. Features/Modules to Remove or Demote
- **Remove:** Cinematic mode, Make Auditor, Active Work page
- **Demote to admin:** Neural Network visualization, Intelligence Cards (DM Authority, Win Patterns, Signal Recency, Authority Miss Rate), Analytics page, Run Timeline, Changeset viewer, Lead Engine page
- **Merge/consolidate:** Today + Follow-ups + Focus Mode → unified Action Queue

### F. Features/Modules to Elevate
- **Focus Mode** → make it the default landing experience
- **Follow-ups** → surface overdue items at the top of every view
- **Outcome logging** → make it flow-specific with structured results
- **Playbook scripts** → show immediately without expanding, flow-context-aware
- **Live coaching** → consistent experience across all calling surfaces
- **Company timeline** → show all attempts across all contacts and flows in one chronological view

### G. Missing Entities or Statuses Needed
1. `contact_attempts` table — per-contact, per-flow attempt history
2. `company_flows` table — active flow tracking per company (which flows are running, current step, next action)
3. `linkedin_activities` table — LinkedIn flow progression per contact
4. `nurture_queue` table — recycle/seasonal/project-based re-engagement
5. Gatekeeper result taxonomy: `gave_dm_name | gave_extension | gave_email | transferred | voicemail | refused | no_answer`
6. DM call result taxonomy: `dm_voicemail | dm_live_interested | dm_live_not_now | dm_live_not_interested | dm_live_qualified`
7. `direct_extension` field on contacts
8. `active_flows` JSON field on companies
9. Flow state machine: `not_started | active | paused | completed | recycled_to_nurture`

### H. Recommended Redesign Priority Order
1. **Schema: Add contact_attempts and company_flows tables** — foundational for everything else
2. **UI: Redesign Focus Mode as flow-aware action executor** — biggest operator impact
3. **UI: Replace Dashboard landing with Action Queue** — immediate UX improvement
4. **Logic: Modify outcome logging to be per-contact, per-flow** — enables tracking
5. **UI: Consolidate navigation to 4 items** — reduces confusion
6. **Schema: Add LinkedIn activities table** — enables Flow 4
7. **Logic: Add nurture queue and recycle rules** — enables Flow 5
8. **Logic: Modify Outreach Engine for parallel flows** — enables multi-flow execution
9. **UI: Add company timeline view** — enables relationship visibility
10. **Logic: Add gatekeeper result taxonomy and next-action engine** — completes Flow 1

### I. Fastest Path to Turn This Into a True Operator-Guided Relationship Machine
1. **Week 1:** Schema changes (contact_attempts, company_flows) + swap landing page from Dashboard to Focus Mode with overdue follow-ups at top
2. **Week 2:** Flow-specific outcome logging UI + per-contact attempt tracking in Call Engine + gatekeeper result modal
3. **Week 3:** Action Queue that merges all pending actions across flows + navigation consolidation to 4 items
4. **Week 4:** LinkedIn activity tracking + nurture queue + parallel flow support in Outreach Engine

---

## MINIMUM INFORMATION AN EXTERNAL ARCHITECT WOULD NEED NEXT

1. **Airtable base access or schema export** — the `Client_ID` field name mismatch needs to be resolved by inspecting the actual Airtable base; the system currently can't scope queries by client
2. **Actual Airtable field name for client scoping** — `server/airtable-scoped.ts` probes for `Client_ID` and fails; need the real field name from Airtable
3. **Call volume data** — how many calls per day are actually being made? The Sales Learning system needs call volume to function; current data shows ~35 total calls across all time
4. **Desired flow cadences** — exact timing rules for each of the 5 flows (e.g., "try gatekeeper every 3 business days up to 5 attempts")
5. **LinkedIn execution model** — will this be manual logging (operator says "I sent a request") or integrated via LinkedIn API/extension?
6. **Nurture trigger definitions** — what seasonal/project events should trigger reactivation for cooldown trailers specifically?
7. **Multi-user vs single-operator** — is TCDT one person making all calls, or will there be multiple operators needing lead assignment?
8. **HubSpot role** — the OAuth integration exists but its role relative to the 5 flows is undefined. Is it the CRM of record or just a sync target?
9. **Email provider status** — is SMTP/IMAP configured and working for TCDT? The auto-sender runs every 15 min but it's unclear if TCDT has email enabled
10. **Proposal/invoice workflow** — where does this fit in the 5 flows? Currently buried in My Leads; needs a defined trigger point (after DM says "send me a quote")
11. **Mobile usage** — does the operator use this on a phone while in the field, or desktop only? This affects Focus Mode redesign significantly
12. **Budget/timeline constraints** — which of the 4-week path items are must-have for launch vs. can-be-iterated?

### Key Files an Architect Should Review
- `shared/schema.ts` — complete PostgreSQL schema
- `server/airtable-schema.ts` — Airtable table/field definitions
- `server/opportunity-engine.ts` — scoring algorithm
- `server/dm-fit.ts` — DM selection logic
- `server/playbooks.ts` — script generation
- `server/call-engine.ts` — outcome processing
- `server/outreach-engine.ts` — 6-touch sequence logic
- `server/recovery-engine.ts` — data self-healing
- `server/realtime-coaching.ts` — live call coaching
- `server/run-daily-web.ts` — pipeline orchestration
- `client/src/pages/focus-mode.tsx` — primary execution UI
- `client/src/pages/today.tsx` — daily call list UI
- `client/src/pages/my-leads.tsx` — manual leads + proposals
- `client/src/App.tsx` — all routes and navigation
