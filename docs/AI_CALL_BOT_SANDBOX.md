# AI Call Bot — Test sandbox (isolation contract)

## Purpose

Trusted testers with **recorded consent** only. Uses **real** Twilio + Realtime + **same** `transfer-controller` FSM — **no second engine**.

## Isolation rules

| Rule | Implementation |
|------|------------------|
| No production pipeline rows | Sandbox never inserts/updates `outreach_pipeline`, `recovery_queue`, or `company_flows` for dials. |
| Distinct company id | `ai_call_bot_sessions.company_id` = `sandbox:{clientId}:{contactId}` (not a pipeline company id). |
| Session tagging | `is_sandbox_session=true`, `sandbox_contact_id` set. |
| Recording tagging | `twilio_recordings.is_sandbox_call=true`, `company_name` prefixed `[SANDBOX]`. |
| Supervisor default | `GET .../supervised/sessions/active` **excludes** sandbox unless `?includeSandbox=1`. |
| Reporting | Production analytics **should** filter `is_sandbox_call IS NOT TRUE` / `is_sandbox_session IS NOT TRUE` where cohorts matter. |

## Supervised dialing rails

Dial allowed only if `validateSandboxTestDial` passes:

- `consent_confirmed = true`
- `active = true`, not archived
- `supervised_mode_required = true` (cannot turn off in API)
- `sandbox_ready_call = true`
- Valid E.164 phone, `company_name` ≥ 2 chars, `outreach_reason` ≥ 3 chars
- `test_scenario_type` ∈ `SANDBOX_SCENARIO_TYPES` (see `server/ai-call-bot/sandbox-types.ts`)

Sessions are created with **`supervisedMode: true`** always for sandbox.

## Operator flow (API)

- `POST /api/ai-call-bot/sandbox/contacts` — create (consent must be true)
- `GET /api/ai-call-bot/sandbox/contacts` — list (`?includeArchived=1` for all)
- `GET /api/ai-call-bot/sandbox/contacts/:id`
- `PATCH /api/ai-call-bot/sandbox/contacts/:id`
- `POST /api/ai-call-bot/sandbox/contacts/:id/archive`
- `POST /api/ai-call-bot/sandbox/calls` `{ "sandboxContactId": N }`
- `GET /api/ai-call-bot/sandbox/runs`
- `PATCH /api/ai-call-bot/sandbox/runs/:id` — `operatorNotes`, `testPassed`, `issuesExposed`
- `POST /api/ai-call-bot/sandbox/import` — batch create (each item `consent_confirmed: true`)

## Seed / import

Use **`POST /import`** with a JSON body `{ "contacts": [ ... ] }`. Each contact must include **`consent_confirmed: true`** or the row is rejected.

## Scenario types

Planning labels only: `decision_maker_transfer`, `gatekeeper_referral`, `wrong_person_no_referral`, `hesitation_callback`, `not_interested`, `voicemail_expected`, `other_edge_case`.
