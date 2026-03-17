# Deep Codebase Flow Inspection Report

---

## 1. FILES INSPECTED

| File | Relevance |
|------|-----------|
| `server/scheduler.ts` | Top-level scheduler that starts the 6-hour loop and dispatches `startDailyRun` per client |
| `server/run-daily-web.ts` | Orchestrator that sequences all engine steps in order (recovery → outreach → opportunity → DM coverage → DM fit → DM status → playbooks → web intel → call engine → sales learning → query intel → alerts) |
| `server/opportunity-engine.ts` | Fetches all companies from Airtable, scores them, assigns to Hot/Working/Fresh buckets, writes `Today_Call_List=TRUE` back to Airtable |
| `server/dm-coverage.ts` | Enriches DM data for Today_Call_List companies via Apollo/Outscraper, writes results to Airtable `Decision_Makers` table, resolves primary DM |
| `server/dm-fit.ts` | Scores each DM candidate on title/email/phone relevance, selects best `Offer_DM_*` fields, writes to Airtable Companies table |
| `server/dm-status.ts` | Classifies each company into one of 10 `DM_Status` values (DM_READY, READY_FOR_OUTREACH, NO_DM, etc.), writes back to Airtable Companies table |
| `server/outreach-engine.ts` | Reads Airtable companies with `DM_Status=DM_READY` or `READY_FOR_OUTREACH`, creates `outreach_pipeline` rows in Postgres, generates AI emails and call scripts, advances due items |
| `server/auto-sender.ts` | Runs every 15 minutes, finds `outreach_pipeline` rows where `nextTouchDate <= now` and `pipelineStatus=ACTIVE`, sends email touches via `sendOutreachEmail` |
| `server/email-service.ts` | SMTP send logic with daily limit enforcement, tracking pixel/link injection, duplicate-send guard, deferred record creation |
| `server/reply-checker.ts` | Runs every 15 minutes, connects to IMAP inbox, matches incoming emails to `email_sends` records via In-Reply-To/References/sender-fallback, inserts `email_replies`, sets pipeline status to `RESPONDED` |
| `server/flow-engine.ts` | 5-channel flow system (gatekeeper, dm_call, email, linkedin, nurture), computes next action/timing/priority from outcome, manages `company_flows` and `action_queue` tables |
| `server/twilio-service.ts` | Twilio integration: `sendSms()` at line 98, `initiateCall()` at line 127, `AGENT_PHONE` fallback at line 125 |
| `server/twilio-routes.ts` | Express routes for Twilio operations (send SMS, initiate calls, sync recordings, recording callbacks) |
| `server/dashboard-routes.ts` | Contains `/api/warm-leads` GET (line 2276), PATCH stage (line 2368), GET timeline (line 2407), POST notes (line 2513), POST deep-analysis (line 2531) |
| `server/storage.ts` | `IStorage` interface and `DatabaseStorage` class with `createOutreachPipeline`, `getOutreachPipelines`, `getOutreachPipelineByCompany`, `updateOutreachPipeline`, `getOutreachPipelinesDue` |
| `shared/schema.ts` | All Drizzle table definitions: `outreach_pipeline` (line 165), `client_email_settings` (line 209), `email_sends` (line 241), `email_replies` (line 286), `company_flows` (line 466), `flow_attempts` (line 498), `action_queue` (line 521), `lng_projects` (line 348) |
| `client/src/pages/warm-leads.tsx` | Warm leads UI: stage progression bar, urgency badges, timeline display, stage advancement, notes, deep analysis trigger |

---

## 2. CURRENT FLOW MAP

### Flow 1: Company Selection

1. **File**: `server/scheduler.ts`, function `runAllActiveClients()` (line 14)
   - Fetches all clients via `storage.getAllClients()`
   - Filters to `status === "active"`
   - Calls `startDailyRun({ clientId: client.id, top: 25 })` sequentially per client
   - **Reads**: `clients` table (Postgres)

2. **File**: `server/run-daily-web.ts`, function `executeRun()` (line 94)
   - Calls `runOpportunityEngine({ top: 25, pctHot: 0.4, pctWorking: 0.35, pctFresh: 0.25 }, clientId)` at line 185
   - **Reads/Writes**: nothing directly, delegates to opportunity-engine

3. **File**: `server/opportunity-engine.ts`, function `runOpportunityEngine()` (line 440)
   - Calls `fetchAllCompanies(clientId)` — fetches all records from Airtable `Companies` table with optional `Client_ID` scope filter
   - Calls `fetchAllCalls(clientId)` — fetches all records from Airtable `Calls` table
   - For each company: `deriveEngagementFacts()` (line 236) cross-references calls by `company` name (case-insensitive)
   - `computeFinalPriority()` (line 271) scores each company using priority_score × weight + engagement × recency + opportunity × recency + activeWork/3 + phone bonus + tier bonus
   - `assignBucket()` (line 284) classifies: Hot Follow-up (followup_due ≤ 2 days), Working (active status + signal + stale), Fresh (new + never called)
   - Selects top N companies by bucket quotas (40% hot, 35% working, 25% fresh)
   - Writes back to Airtable: `Today_Call_List=TRUE/FALSE`, `Bucket`, `Final_Priority`, `Times_Called`, `Last_Outcome`, `Followup_Due`, `Rank_Reason`, `Rank_Evidence`
   - **Reads**: Airtable `Companies`, Airtable `Calls`
   - **Writes**: Airtable `Companies` (batch PATCH)

### Flow 2: DM Coverage / DM Fit / DM Status

4. **File**: `server/dm-coverage.ts`, function `runDMCoverage()` (line 167)
   - `fetchCallListCompanies()` (line 52) — fetches Airtable Companies where `Today_Call_List=TRUE()`, sorts by `Final_Priority`
   - `needsEnrichment()` (line 103) — true if never enriched, or enriched >14 days ago, or enriched >1 day ago with 0 DMs
   - For each needing enrichment: calls `enrichCompany()` → Apollo/Outscraper lookup, then `writeDMsToAirtable()` → inserts into Airtable `Decision_Makers`
   - Then calls `resolveAndWriteDMs()` — selects best primary DM per company, writes `Primary_DM_Name`, `Primary_DM_Title`, `Primary_DM_Email`, `Primary_DM_Phone`, `Primary_DM_Confidence` to Airtable Companies
   - **Reads**: Airtable `Companies`, Airtable `Decision_Makers`
   - **Writes**: Airtable `Companies` (DM_Coverage_Status, DM_Count, DM_Last_Enriched, Primary_DM_*), Airtable `Decision_Makers`

5. **File**: `server/dm-fit.ts`, function `runDMFit()` (line 296)
   - `fetchTodayListForFit()` (line 230) — fetches Today_Call_List companies with existing Offer_DM fields
   - `fetchAllDecisionMakers()` — gets all DMs from Airtable
   - For each company: `selectOfferDM()` (line 161) → calls `scoreDMFit()` (line 72) on each DM candidate
   - `scoreDMFit()` scores by title regex matching: safety-related +45, site/field ops +35, project/turnaround +30, owner/president +30, generic manager +20; plus department bonus/penalty, email +8, phone +6, recency +6, authority learning adjustments, platform boost
   - `FIT_THRESHOLD = 25` (line 6) — candidates below this are rejected
   - Fit tiers: strong ≥60, moderate ≥45, weak >0, none =0
   - Writes `Offer_DM_Name`, `Offer_DM_Title`, `Offer_DM_Email`, `Offer_DM_Phone`, `Offer_DM_FitScore`, `Offer_DM_Reason`, `Offer_DM_Source` to Airtable Companies
   - **Reads**: Airtable `Companies`, Airtable `Decision_Makers`
   - **Writes**: Airtable `Companies` (Offer_DM_* fields)

6. **File**: `server/dm-status.ts`, function `updateDMStatus()` (line 122)
   - Fetches all companies from Airtable (not just Today_Call_List)
   - `evaluateDMStatus()` (line 73) classifies each company:
     - `AUTHORITY_MISMATCH` if outcome=no_authority/wrong_person or Authority_Miss_Count ≥ 2
     - `RECOVERY_IN_PROGRESS` if above + has name+contact info
     - `NO_WEBSITE` if no website
     - `NO_DM` if no DM name
     - `GENERIC_CONTACT` if email starts with info@/admin@/etc
     - `NO_EMAIL` if no email
     - `NO_PHONE` if no phone
     - `DM_WEAK` if scoreDMFit returns weak/none tier
     - `READY_FOR_OUTREACH` if scoreDMFit returns strong/moderate tier
     - `DM_READY` fallthrough default
   - Writes `DM_Status` and `DM_Last_Checked` to Airtable
   - **Reads**: Airtable `Companies`
   - **Writes**: Airtable `Companies` (DM_Status, DM_Last_Checked)

### Flow 3: Outreach Candidate Creation

7. **File**: `server/outreach-engine.ts`, function `populateOutreachPipeline()` (line 124)
   - Fetches Airtable Companies where `DM_Status = "DM_READY" OR DM_Status = "READY_FOR_OUTREACH"` (line 131)
   - For each eligible company:
     - Checks `storage.getOutreachPipelineByCompany(companyId, clientId)` — skips if already has ACTIVE pipeline row
     - Generates 3 call scripts via `generateCallScript()` (touches 1, 3, 5)
     - Generates 3 AI emails via `generateOutreachEmails()` (touches 2, 4, 6)
   - Creates `outreach_pipeline` row via `storage.createOutreachPipeline()`:
     - `touch1Email` ← call script for touch 1 (INVERTED NAMING)
     - `touch2Call` ← email content for touch 2 (INVERTED NAMING)
     - `touch3Email` ← call script for touch 3 (INVERTED NAMING)
     - `touch4Call` ← email content for touch 4 (INVERTED NAMING)
     - `touch5Email` ← call script for touch 5 (INVERTED NAMING)
     - `touch6Call` ← email content for touch 6 (INVERTED NAMING)
     - `pipelineStatus = "ACTIVE"`, `nextTouchDate = createdAt + 1 day`, `touchesCompleted = 0`
   - **Reads**: Airtable `Companies`, Postgres `outreach_pipeline`
   - **Writes**: Postgres `outreach_pipeline`

### Flow 4: First-Touch Email Selection

8. **File**: `server/email-service.ts`, function `sendOutreachEmail()` (line 150)
   - Lines 218-226: Maps touch number → pipeline column:
     ```
     touchField = { 2: pipeline.touch2Call, 4: pipeline.touch4Call, 6: pipeline.touch6Call }
     ```
   - Only touch numbers 2, 4, 6 have email content (matches the inverted naming)
   - `parseEmailContent()` (line 29) extracts subject line from `"Subject: ...\n\n..."` format
   - There is NO first-touch email. Touch 1 is always a call script. The first email is touch 2 (day 3).
   - **Reads**: Postgres `outreach_pipeline`, Postgres `client_email_settings`
   - **Writes**: Postgres `email_sends`

### Flow 5: Scheduling / Sending of Outreach

9. **File**: `server/auto-sender.ts`, function `runAutoSender()` (line 165)
   - Runs every 15 minutes (`AUTO_SEND_INTERVAL = 15 * 60 * 1000`, line 7)
   - Startup delay: 90 seconds (line 8)
   - `getAutoSendClients()` (line 30) — queries `client_email_settings` where `enabled=true AND autoSendEnabled=true`
   - `processClientAutoSends()` (line 71):
     - `storage.getOutreachPipelinesDue(clientId, 20)` — fetches up to 20 rows where `pipelineStatus=ACTIVE AND nextTouchDate <= now` ordered by `nextTouchDate`
     - For each due item:
       - Skips if `pipelineStatus !== "ACTIVE"` (line 85)
       - Skips if `nextTouch > 6` (line 91)
       - Skips if touch type is `"call"` not `"email"` per TOUCH_SCHEDULE (line 97)
       - Skips if no `contactEmail` (line 102)
       - Calls `hasSentForTouch()` (line 51) — checks `email_sends` for existing sent/sending record
       - Calls `sendOutreachEmail()` from email-service
       - On success: updates `touchesCompleted`, `nextTouchDate` (calculates from `createdAt + schedule.day`), sets `COMPLETED` if touch ≥ 6
       - On deferred (daily limit): breaks loop for this client
   - **Reads**: Postgres `client_email_settings`, Postgres `outreach_pipeline`, Postgres `email_sends`
   - **Writes**: Postgres `outreach_pipeline` (touchesCompleted, nextTouchDate, pipelineStatus), Postgres `email_sends`

10. **File**: `server/outreach-engine.ts`, function `advanceOutreachPipeline()` (line 243)
    - Called in `runOutreachEngine()` AFTER `populateOutreachPipeline()`
    - `storage.getOutreachPipelinesDue(clientId)` — same query as auto-sender (limit defaults to 50 here)
    - Advances `touchesCompleted` and sets `nextTouchDate` for each due item
    - Sets `pipelineStatus = "COMPLETED"` when nextTouch > 6
    - **IMPORTANT**: This advances ALL due touches including call touches, not just emails. The auto-sender only handles email touches.
    - **Reads**: Postgres `outreach_pipeline`
    - **Writes**: Postgres `outreach_pipeline`

### Flow 6: Reply Detection

11. **File**: `server/reply-checker.ts`, function `runReplyCheck()` (line 260)
    - Runs every 15 minutes (`REPLY_CHECK_INTERVAL = 15 * 60 * 1000`, line 8)
    - Initial check after 60 seconds (line 321)
    - Queries `client_email_settings` where `enabled=true AND replyCheckEnabled=true`
    - Per client: `checkRepliesForClient()` (line 23)

12. **File**: `server/reply-checker.ts`, function `checkRepliesForClient()` (line 23)
    - Derives IMAP host from SMTP host via `deriveImapHost()` (line 12): smtp.gmail.com → imap.gmail.com, etc.
    - Fetches all `email_sends` where `status="sent" AND messageId IS NOT NULL AND replyDetectedAt IS NULL` (lines 47-58)
    - Connects to IMAP, opens INBOX, searches emails from last 3 days
    - Fetches in batches of 50 (line 118)
    - Three matching strategies (see Flow 7 below)
    - On match: inserts `email_replies` row (line 187), marks `email_sends.replyDetectedAt` (line 202)
    - If pipeline is ACTIVE: sets `pipelineStatus = "RESPONDED"`, `respondedAt = now`, `respondedVia = "reply_detected"` (lines 214-220)
    - Updates `client_email_settings.lastReplyCheck` timestamp (line 252)
    - **Reads**: Postgres `client_email_settings`, Postgres `email_sends`, Postgres `outreach_pipeline`, IMAP inbox
    - **Writes**: Postgres `email_replies`, Postgres `email_sends` (replyDetectedAt), Postgres `outreach_pipeline` (pipelineStatus, respondedAt, respondedVia), Postgres `client_email_settings` (lastReplyCheck)

### Flow 7: Reply-to-Company Matching

13. **File**: `server/reply-checker.ts`, inside `checkRepliesForClient()`, lines 137-168
    - **Strategy 1** (line 140): Match `In-Reply-To` header against stored `messageId` in `email_sends`. Strips angle brackets for comparison.
    - **Strategy 2** (line 146): Match `References` header (space-separated chain of message IDs) against stored `messageId`. Iterates all refs.
    - **Strategy 3** (line 156): Fallback — match by sender email address against `contactEmail` in `email_sends`. Only matches if incoming email date is after the sent date. Takes the most recent matching send.
    - Skips replies from own email address (line 184)
    - Skips if `email_replies` already has a record for this emailSendId + imapMessageId combination (line 172)

### Flow 8: Suppression / Stop Logic

14. **File**: `server/outreach-engine.ts`, line 25
    - `PIPELINE_STATUSES = ["ACTIVE", "COMPLETED", "RESPONDED", "NOT_INTERESTED"]`
    - `NOT_INTERESTED` exists as a valid status in the enum

15. **File**: `server/outreach-engine.ts`, function `updateOutreachStatus()` (line 290)
    - Manual status update endpoint — validates against PIPELINE_STATUSES, calls `storage.updateOutreachPipeline(id, { pipelineStatus: status })`
    - This is the ONLY code path that can set `NOT_INTERESTED`. It requires manual API call.

16. **File**: `server/auto-sender.ts`, line 85
    - `if (item.pipelineStatus !== "ACTIVE")` → skips. This means RESPONDED, COMPLETED, and NOT_INTERESTED all stop further sends.

17. **File**: `server/reply-checker.ts`, lines 211-220
    - On reply detection: sets `pipelineStatus = "RESPONDED"` — this stops auto-sender from sending more emails
    - Does NOT set `NOT_INTERESTED`. Does NOT set any HOT classification. Does NOT create warm lead entries.
    - There is NO code path that auto-detects NOT_INTERESTED from reply content.

18. **File**: `server/flow-engine.ts`, lines 155-163
    - `not_a_fit` outcome: sets flow status to COMPLETED, kills all other flows for that company (line 602-617), completes all pending action_queue items (line 618-625)
    - This is the flow-engine suppression. It does NOT interact with outreach_pipeline.

**GAP: No auto-suppression path for NOT_INTERESTED. No link between flow-engine's not_a_fit and outreach-engine's NOT_INTERESTED status. These are two independent systems.**

### Flow 9: Action Queue Usage

19. **File**: `server/flow-engine.ts`, function `logFlowAttempt()` (line 487)
    - After logging an attempt: completes all existing pending `action_queue` items for that flowId (lines 543-551)
    - If flow status is ACTIVE or PAUSED: inserts new `action_queue` item with next due date, priority, recommendation text (lines 553-572)
    - `action_queue` table fields: clientId, companyId, companyName, contactId, contactName, flowId, flowType, taskType, dueAt, priority, status, recommendationText, lastOutcome, attemptNumber, companyPhone, contactPhone, contactEmail, companyCity, companyCategory, bucket
    - taskType mapping: gatekeeper → "gatekeeper_call", dm_call → "dm_call", email → "send_email", linkedin → "linkedin_action", nurture → "nurture_check"
    - **Reads**: Postgres `company_flows`, Postgres `action_queue`
    - **Writes**: Postgres `company_flows`, Postgres `flow_attempts`, Postgres `action_queue`

### Flow 10: Warm Lead Display in UI

20. **File**: `server/dashboard-routes.ts`, GET `/api/warm-leads` (line 2276)
    - Queries `company_flows` where `lastOutcome IN ('interested','meeting_requested','followup_scheduled','replied','live_answer','callback') OR warmStage IS NOT NULL`
    - Scoped by `clientId` from auth token (line 2278-2282)
    - Joins with `outreach_pipeline` rows by `companyId` to get contact info (lines 2293-2296)
    - Computes urgency: critical (overdue + >3 days inactive), high (overdue), normal, low (closed)
    - Parses `qualitySignals` JSON for buying signals, objections, nextStepReason
    - Sorts by urgency order: critical → high → normal → low (lines 2348-2351)
    - **Reads**: Postgres `company_flows`, Postgres `outreach_pipeline`
    - **Writes**: nothing

21. **File**: `client/src/pages/warm-leads.tsx`
    - `WARM_STAGES` constant (line 24): initial_interest, proposal_sent, meeting_scheduled, negotiating, verbal_commit, closed_won, closed_lost
    - Each lead card shows: company name, urgency badge (OVERDUE/FOLLOW UP/ON TRACK/CLOSED), stage pill, quality score circle, contact info, stage progress bar
    - No HOT classification badge exists in current UI
    - No NOT_INTERESTED badge exists in current UI
    - No estimated_value display exists
    - Sorting is urgency-only (line 2348 in dashboard-routes.ts), no sort by stage or classification

---

## 3. EXACT INSERTION POINTS

### 3a. dailyOutreachCap after qualification / DM readiness

**Where**: `server/outreach-engine.ts`, function `populateOutreachPipeline()`, line 153, inside the `for (const rec of eligibleRecords)` loop, AFTER the `existing` check (line 162) and BEFORE generating content (line 189).

Insert a counter check here:
```
if (addedThisCycle >= dailyCap) break;
```

**Why this location**: This is the only place that creates new outreach_pipeline rows. The cap must be checked before spending API credits on AI email generation. Placing it after the existing-pipeline-skip ensures companies already in pipeline don't count against the cap.

**Depends on**: The `clientEmailSettings.dailyLimit` or a new field on `clients` or `clientConfig` table to define the cap. The `added` counter already exists (line 153).

**Risk if wrong location**: If placed inside `advanceOutreachPipeline()` instead, it would cap advancement of existing sequences (wrong behavior). If placed in the scheduler, it would cap the entire run rather than per-client pipeline population.

### 3b. Fallback first-touch email replacement

**Where**: `server/email-service.ts`, function `sendOutreachEmail()`, lines 218-226.

Currently:
```ts
const touchField: Record<number, string | null> = {
  2: pipeline.touch2Call,
  4: pipeline.touch4Call,
  6: pipeline.touch6Call,
};
const touchContent = touchField[params.touchNumber];
if (!touchContent) {
  return { success: false, error: `No email content for touch ${params.touchNumber}` };
}
```

Insert fallback logic between line 223 and 224: if `touchContent` is null or contains `"[Email generation pending]"`, call `generateOutreachEmails()` to regenerate, then update the pipeline row.

**Why this location**: This is the single exit point for "no email content." The fallback must be here because `auto-sender.ts` calls `sendOutreachEmail()` and hits this exact error path. Placing it in `auto-sender.ts` would mean manual sends from the UI would not get the fallback.

**Depends on**: `generateOutreachEmails()` from `outreach-engine.ts` (must import). Must also call `storage.updateOutreachPipeline()` to persist the regenerated content.

**Risk if wrong location**: If placed in `auto-sender.ts`, manual email sends would still fail. If placed in `populateOutreachPipeline()`, it would only help at creation time (retries/races could still produce blanks).

### 3c. HOT lead classification in reply handling

**Where**: `server/reply-checker.ts`, function `checkRepliesForClient()`, lines 205-226, specifically AFTER `pipelineStatus = "RESPONDED"` is set (line 215) and BEFORE `repliesFound++` (line 228).

Insert logic here to:
1. Check reply content/subject for positive signals
2. Look up the `company_flows` row for this companyId
3. If warm signals detected: set `warmStage` on the flow, optionally create a flow if none exists

**Why this location**: This is the only place where reply detection happens. The pipeline status is already being updated here. Adding classification at this point ensures every detected reply gets evaluated.

**Depends on**: The `company_flows` table must have a matching row for the company. If no flow exists, a new flow would need to be created via `createFlow()` from `flow-engine.ts`. The `warmStage` field already exists on `company_flows` (schema line 489).

**Risk if wrong location**: If placed in a separate cron, replies would be classified with a delay. If placed in the email-service, it would conflate sending with reply handling.

### 3d. NOT_INTERESTED suppression in reply handling

**Where**: `server/reply-checker.ts`, same block as 3c (lines 205-226).

After detecting a reply, if the reply content contains negative signals (e.g., "not interested", "unsubscribe", "remove me", "do not contact"):
1. Set `outreachPipeline.pipelineStatus = "NOT_INTERESTED"` instead of `"RESPONDED"`
2. Optionally update `company_flows.status = "completed"` and `lastOutcome = "not_relevant"`

**Why this location**: Same reasoning as 3c. This is the only automated reply detection point. The `RESPONDED` status already stops sends (auto-sender checks `pipelineStatus !== "ACTIVE"`), but `NOT_INTERESTED` is semantically distinct and should be tracked separately.

**Depends on**: `NOT_INTERESTED` is already a valid status in `PIPELINE_STATUSES` (outreach-engine.ts line 25). No schema change needed. Keyword matching logic would need to be robust enough to avoid false positives.

**Risk if wrong location**: If placed in a separate batch job, there would be a window where NOT_INTERESTED companies still show as RESPONDED and could receive manual follow-up.

### 3e. Early follow-up timing changes

**Where**: `server/outreach-engine.ts`, `TOUCH_SCHEDULE` constant (line 16) AND `server/auto-sender.ts`, `TOUCH_SCHEDULE` constant (line 10).

These are TWO SEPARATE copies of the same schedule:
```
outreach-engine.ts line 16: [day:1 call, day:3 email, day:5 call, day:7 email, day:10 call, day:14 email]
auto-sender.ts line 10:     [day:1 call, day:3 email, day:5 call, day:7 email, day:10 call, day:14 email]
```

Both must be changed together.

**Why this location**: `outreach-engine.ts` uses TOUCH_SCHEDULE in `populateOutreachPipeline()` (line 231) to set initial `nextTouchDate` and in `advanceOutreachPipeline()` (line 277-278) to compute next dates. `auto-sender.ts` uses its copy at line 96 to determine touch type (call vs email) and at line 141-143 to compute next date.

**Depends on**: Both schedules must remain identical. `nextTouchDate` is computed as `addDays(item.createdAt, schedule.day)` — this means all timing is relative to the pipeline row's `createdAt` timestamp, NOT the last touch date.

**Risk if wrong location**: If only one copy is changed, the two systems will disagree on when touches are due and what type they are. Auto-sender could try to send a call touch as email or skip valid email touches.

### 3f. estimated_value field wiring

**Where**: Schema addition needed.

`estimated_value` currently exists ONLY on `lng_projects` table (schema line 356). It does NOT exist on `outreach_pipeline` or `company_flows`.

To wire it:

1. **Schema**: Add `estimatedValue: text("estimated_value")` to `outreach_pipeline` table in `shared/schema.ts` (after line 199, before `createdAt`)
2. **Population**: In `server/outreach-engine.ts`, function `populateOutreachPipeline()`, line 218-233, add `estimatedValue` to the `createOutreachPipeline()` call. Source data would need to come from Airtable (requires a new field like `Estimated_Value` on Companies table) or from `lng_projects` table lookup.
3. **Display**: In `server/dashboard-routes.ts`, line 2315-2345, add `estimatedValue: pipeline?.estimatedValue || null` to the warm-leads response object. In `client/src/pages/warm-leads.tsx`, add display element.

**Why this location**: The outreach_pipeline is the bridge between Airtable companies and the warm-leads UI. The warm-leads API already joins with outreach_pipeline (line 2294), so any field added to outreach_pipeline is automatically available.

**Depends on**: Requires DB migration (`npm run db:push`). The source of the estimated_value data must be defined.

**Risk if wrong location**: If added only to `company_flows`, it would not be available in the outreach pipeline view. If added only to the API response without the schema field, it would always be null.

### 3g. HOT / WARM / NOT_INTERESTED UI badges and sorting

**Where**: `client/src/pages/warm-leads.tsx`, function `WarmLeadRow()` (line 205).

Badges should be added at lines 266-268, inside the company name row, after the urgency badge:
```tsx
<span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0" style={{ background: `${urg.color}10`, color: urg.color, border: `1px solid ${urg.color}25` }}>{urg.label}</span>
```

Add a second badge here for classification (HOT/WARM/NOT_INTERESTED).

For sorting: `server/dashboard-routes.ts`, lines 2348-2351, currently sorts only by urgency. Add secondary sort by classification:
```ts
leads.sort((a, b) => {
  const urgencyOrder = { critical: 0, high: 1, normal: 2, low: 3 };
  // Add: const classOrder = { HOT: 0, WARM: 1, NEUTRAL: 2, NOT_INTERESTED: 3 };
  return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  // || classOrder[a.classification] - classOrder[b.classification];
});
```

**Why this location**: The urgency badge pattern already exists at this exact position. Adding a classification badge alongside it maintains visual consistency. The sort must be in the API (server-side) because the client does not re-sort.

**Depends on**: A new field on `company_flows` or computed at query time. The classification logic must be defined — either stored (requires migration) or computed from existing fields (warmStage, lastOutcome, pipelineStatus).

**Risk if wrong location**: If the badge is added without the sort, HOT leads could appear below WARM leads. If sorting is added client-side only, pagination or limit would break ordering.

---

## 4. EXISTING FIELDS / TABLES / STATUS PATHS

### Outreach Sequencing

- **Table**: `outreach_pipeline` (Postgres)
- **Key fields**: `id`, `clientId`, `companyId`, `companyName`, `contactName`, `contactEmail`, `touch1Email`..`touch6Call` (6 content fields), `pipelineStatus`, `nextTouchDate`, `touchesCompleted`, `respondedAt`, `respondedVia`, `contentSource`, `firstName`, `lastName`, `title`, `phone`, `website`, `linkedinUrl`, `city`, `state`, `industry`, `source`, `relevanceStatus`, `lastOutcome`, `callFollowupRequired`, `assignedOffer`, `notes`, `personalizationLine`, `emailTemplateVersion`, `createdAt`, `updatedAt`
- **Statuses**: `ACTIVE`, `COMPLETED`, `RESPONDED`, `NOT_INTERESTED` (defined in outreach-engine.ts line 25)
- **Touch schedule**: 6 touches over 14 days. Odd = call, even = email. Field naming is inverted (touch1Email stores call script, touch2Call stores email content).

### Reply Handling

- **Table**: `email_sends` (Postgres)
- **Key fields**: `id`, `clientId`, `outreachPipelineId`, `companyId`, `companyName`, `contactEmail`, `contactName`, `touchNumber`, `subject`, `bodyHtml`, `trackingId`, `status`, `messageId`, `sentAt`, `openCount`, `firstOpenedAt`, `clickCount`, `firstClickedAt`, `replyDetectedAt`, `sentVia`, `deferredAt`, `deferReason`, `errorMessage`
- **Statuses**: `sending`, `sent`, `failed`, `deferred`

- **Table**: `email_replies` (Postgres)
- **Key fields**: `id`, `clientId`, `emailSendId`, `outreachPipelineId`, `fromEmail`, `subject`, `snippet`, `imapMessageId`, `inReplyTo`, `receivedAt`, `detectedAt`

### Suppression

- Pipeline-level: `pipelineStatus = "NOT_INTERESTED"` exists as valid enum value. **No code currently auto-sets it.**
- Pipeline-level: `pipelineStatus = "RESPONDED"` is auto-set by reply-checker. This stops auto-sends.
- Pipeline-level: `pipelineStatus = "COMPLETED"` is set when touchesCompleted ≥ 6.
- Flow-level: `not_a_fit` outcome in flow-engine kills all flows and action_queue items for the company.
- **No link between flow-engine suppression and outreach-pipeline suppression.**

### Warm Lead Progression

- **Table**: `company_flows` (Postgres)
- **Key fields for warm**: `warmStage` (text, nullable), `warmStageUpdatedAt` (timestamp, nullable)
- **Valid warm stages** (defined in dashboard-routes.ts line 2274): `initial_interest`, `proposal_sent`, `meeting_scheduled`, `negotiating`, `verbal_commit`, `closed_won`, `closed_lost`
- **Entry criteria**: `lastOutcome IN ('interested','meeting_requested','followup_scheduled','replied','live_answer','callback') OR warmStage IS NOT NULL`
- Stage is advanced manually via PATCH `/api/warm-leads/:flowId/stage`
- **No automatic warm stage assignment from reply detection or flow outcomes.**

### Action Queue Creation

- **Table**: `action_queue` (Postgres)
- Created by `flow-engine.ts` `logFlowAttempt()` after each flow attempt
- Fields: see Flow 9 above
- **Statuses**: `pending`, `completed`, `skipped`
- Completed when: same flowId gets a new attempt (bulk-set at lines 543-551)
- `not_a_fit` outcome completes ALL pending queue items for that company (lines 618-625)

### Fields/Tables That Do NOT Exist Yet

- `estimated_value` on `outreach_pipeline` — **does not exist**
- `estimated_value` on `company_flows` — **does not exist**
- `classification` (HOT/WARM/NOT_INTERESTED) on `company_flows` — **does not exist**
- `classification` on `outreach_pipeline` — **does not exist**
- Auto-suppression path for NOT_INTERESTED — **does not exist**
- HOT badge in warm-leads UI — **does not exist**
- NOT_INTERESTED badge in warm-leads UI — **does not exist**

---

## 5. RISKS / MIGRATION NEEDS

### Changes Requiring DB Migration

1. Adding `estimatedValue` column to `outreach_pipeline` table → `npm run db:push`
2. Adding a `classification` column to `company_flows` (if chosen over computed) → `npm run db:push`
3. Adding a `dailyOutreachCap` column to `clients` or `client_config` table (if cap is per-client) → `npm run db:push`

### Changes That Can Be Done Without Migration

1. HOT/WARM/NOT_INTERESTED badge in UI — purely frontend, no schema change if classification is computed from existing `lastOutcome` + `warmStage` + `pipelineStatus`
2. NOT_INTERESTED suppression logic in reply-checker — uses existing `pipelineStatus` field (already supports `NOT_INTERESTED`)
3. HOT classification in reply-checker — can update existing `warmStage` field on `company_flows` (already exists)
4. Early follow-up timing — change TOUCH_SCHEDULE constants in outreach-engine.ts and auto-sender.ts (no DB change)
5. Fallback first-touch email — code change only in email-service.ts
6. dailyOutreachCap — can use existing `clientEmailSettings.dailyLimit` if acceptable (no new column needed)
7. Sort order in warm-leads API — code change in dashboard-routes.ts

### Duplicate Send Risk

- **Primary guard**: `email-service.ts` lines 167-179 — checks `email_sends` for existing sent/sending record with same `outreachPipelineId + touchNumber`
- **Secondary guard**: `auto-sender.ts` `hasSentForTouch()` (line 51) — same check
- **Race condition**: Both `advanceOutreachPipeline()` (outreach-engine.ts) and `processClientAutoSends()` (auto-sender.ts) call `getOutreachPipelinesDue()` on overlapping schedules. Both advance `touchesCompleted`. If auto-sender sends touch 2 and outreach-engine advances to touch 2 simultaneously, the touchesCompleted could be set to 2 by both. The email duplicate guard prevents double-send, but the touch counter could be advanced incorrectly.
- **Risk level**: Low. The duplicate email guard is robust (DB-level check on outreachPipelineId + touchNumber). The touch counter race is cosmetic.

### Duplicate Task Risk

- **In action_queue**: `logFlowAttempt()` completes ALL pending items for a flowId before creating a new one (lines 543-551 then 553-572). This prevents duplicates within a single flow.
- **Between flows**: Multiple flows for the same company can each have their own action_queue items. This is by design (gatekeeper + dm_call + email can coexist).
- **Risk level**: Low for same-flow duplicates. By-design for cross-flow items.

### Tenant Scoping Risks

- **Outreach pipeline**: All queries in `storage.ts` filter by `clientId`. `getOutreachPipelineByCompany()` filters by both `companyId` and `clientId` (line 278). Safe.
- **Auto-sender**: `getAutoSendClients()` returns per-client settings. `processClientAutoSends()` passes `clientId` to `getOutreachPipelinesDue()`. Safe.
- **Reply-checker**: Queries `email_sends` by `clientId` (line 52). Inserts `email_replies` with `clientId`. Updates pipeline without explicit clientId check (queries by pipeline.id only, line 209). **Minor risk**: If pipeline IDs are globally unique integers (they are, since PK), this is safe. But the query does not verify `pipeline.clientId === settings.clientId`.
- **Warm-leads API**: Filters by `clientId` from auth token (line 2282). If `clientId` is null (platform_admin), falls through to `sql\`1=1\`` — platform admin sees all clients. This is intentional.
- **Airtable engines**: Use `scopedFormula(clientId)` to filter by `Client_ID` field. Falls back to unscoped if field doesn't exist (legacy single-tenant mode). Tenant isolation depends on Airtable `Client_ID` field existing.

### Twilio Alerting Safe Failure

- `sendSms()` (twilio-service.ts line 98): returns `{ success: false, error: "..." }` on failure — does NOT throw
- `AGENT_PHONE` (line 125): hardcoded fallback `+14093387109` via `process.env.AGENT_PHONE`. If `AGENT_PHONE` env var is not set, uses hardcoded number. If the hardcoded number is disconnected, SMS fails silently (returns error object, no crash).
- No internal notification path currently uses `sendSms()`. The function exists but nothing in the auto-sender, reply-checker, or scheduler calls it for alerts.
- **Safe failure**: Twilio SMS errors are caught and returned as error objects. No crash risk. But notifications will silently not be delivered if the phone number is invalid.

---

## 6. SMALLEST SAFE IMPLEMENTATION ORDER

### Pass 1: Timing + TOUCH_SCHEDULE consolidation

**Files to edit**:
- `server/outreach-engine.ts` (line 16, TOUCH_SCHEDULE)
- `server/auto-sender.ts` (line 10, TOUCH_SCHEDULE)

**What to change**:
- Extract TOUCH_SCHEDULE to a shared location (e.g., `shared/constants.ts` or top of `outreach-engine.ts` with re-export)
- Import from shared location in `auto-sender.ts`
- Optionally adjust day intervals if early follow-up is desired

**What NOT to touch**: Do not change email-service.ts, reply-checker.ts, or any schema.

**Verify**: Run the app. Check auto-sender logs that it still correctly identifies email vs call touches. Check that `populateOutreachPipeline()` still sets correct `nextTouchDate`. No emails should send differently — this is a refactor only.

---

### Pass 2: NOT_INTERESTED suppression in reply-checker

**Files to edit**:
- `server/reply-checker.ts` (inside `checkRepliesForClient()`, after line 210)

**What to change**:
- After detecting a reply and before setting `pipelineStatus = "RESPONDED"`, check the reply subject/snippet for negative keywords (`not interested`, `unsubscribe`, `remove me`, `stop contacting`, `do not contact`, `no thank you`, `please remove`)
- If negative: set `pipelineStatus = "NOT_INTERESTED"` instead of `"RESPONDED"`
- Log the suppression

**What NOT to touch**: Do not change the schema. Do not change auto-sender, email-service, or outreach-engine. Do not add UI changes yet.

**Verify**: Send a test reply with "not interested" in the subject. Wait for reply-checker cycle (15 min or trigger manually via API). Verify the outreach_pipeline row has `pipelineStatus = "NOT_INTERESTED"`. Verify auto-sender skips this company on next cycle.

---

### Pass 3: Fallback first-touch email regeneration

**Files to edit**:
- `server/email-service.ts` (lines 218-226)

**What to change**:
- After `touchContent` is retrieved, check if it's null or contains `"[Email generation pending]"` or `"[Auto-generated placeholder"`
- If so: import `generateOutreachEmails` from `outreach-engine.ts`, call it with pipeline data, format result as `"Subject: ...\n\n..."`, update the pipeline row, use the regenerated content

**What NOT to touch**: Do not change outreach-engine.ts population logic. Do not change auto-sender.ts. Do not change schema.

**Verify**: Find or create an outreach_pipeline row where `touch2Call` is `"[Email generation pending]"`. Trigger a manual email send for touch 2 via API. Verify the email generates, sends, and the pipeline row's `touch2Call` field is updated with real content.

---

### Pass 4: HOT classification + warm stage auto-assignment in reply-checker

**Files to edit**:
- `server/reply-checker.ts` (after line 220, inside the reply detection block)
- `server/dashboard-routes.ts` (warm-leads query, line 2300-2345, add classification computation)

**What to change**:
- In reply-checker: after setting RESPONDED, look up `company_flows` by companyId + clientId. If flow exists and `warmStage` is null, set `warmStage = "initial_interest"`, `warmStageUpdatedAt = now`.
- In dashboard-routes: compute classification from existing fields:
  - HOT: `lastOutcome` in `["meeting_requested", "interested"]` AND `warmStage` not closed
  - WARM: `lastOutcome` in `["followup_scheduled", "replied", "live_answer", "callback"]`
  - NOT_INTERESTED: `pipelineStatus === "NOT_INTERESTED"` (from pass 2)
  - Default: no classification badge

**What NOT to touch**: Do not add new schema columns. Do not change flow-engine.ts. Do not change warm-leads.tsx yet.

**Verify**: Trigger a reply detection cycle. Verify warm-leads API response includes computed classification. Check that replied-to companies with no prior flow get warmStage set.

---

### Pass 5: UI badges + sorting

**Files to edit**:
- `client/src/pages/warm-leads.tsx` (WarmLeadRow component, line 265-268 area)
- `server/dashboard-routes.ts` (sort logic, lines 2348-2351)

**What to change**:
- Add classification field to the WarmLead interface (line 36)
- Add classification badge after urgency badge at line 267
- Color scheme: HOT = red/orange (#EF4444), WARM = amber (#F59E0B), NOT_INTERESTED = gray (#94A3B8)
- Update sort: urgency first, then classification (HOT → WARM → unclassified → NOT_INTERESTED)

**What NOT to touch**: Do not change schema. Do not change reply-checker or auto-sender.

**Verify**: Load warm-leads page. Verify badges render correctly next to urgency badges. Verify HOT leads sort above WARM leads within the same urgency tier.

---

### Pass 6: estimated_value wiring (requires migration)

**Files to edit**:
- `shared/schema.ts` (add `estimatedValue` to `outreach_pipeline`, after line 199)
- `server/outreach-engine.ts` (add `estimatedValue` to `createOutreachPipeline()` call, line 218-233)
- `server/dashboard-routes.ts` (add `estimatedValue` to warm-leads response, line 2315-2345)
- `client/src/pages/warm-leads.tsx` (add `estimatedValue` to WarmLead interface and display)

**What to change**:
- Schema: `estimatedValue: text("estimated_value")`
- Run `npm run db:push`
- Outreach-engine: source the value from Airtable `Estimated_Value` field (if it exists) or leave null
- Dashboard-routes: `estimatedValue: pipeline?.estimatedValue || null`
- UI: display near company name or in expanded detail

**What NOT to touch**: Do not change `lng_projects` table. Do not change email-service or auto-sender.

**Verify**: Run migration. Create a new outreach pipeline entry. Verify the field is populated (or null if source unavailable). Verify it renders on the warm-leads page.

---

### Pass 7: Daily outreach cap

**Files to edit**:
- `server/outreach-engine.ts` (function `populateOutreachPipeline()`, inside the for-loop after line 162)

**What to change**:
- Add a cap parameter (e.g., from `clientConfig` or hardcoded initially)
- After the existing-pipeline skip check, compare `added` counter to cap
- If `added >= cap`: break the loop
- Log the cap enforcement

**What NOT to touch**: Do not change auto-sender daily email limit (that's a separate cap). Do not change the email-service dailyLimit logic.

**Verify**: Set a low cap (e.g., 3). Run outreach engine. Verify only 3 new pipeline rows are created even if 20 companies are eligible. Verify existing pipeline rows are not affected.
