# AI Call Bot — Staging test matrix (No Drift Checklist)

Use this matrix under **real Twilio + Realtime** conditions in staging. For each row: run the scenario, then call **`GET /api/ai-call-bot/sessions/:id/verify-report`** (authenticated) or **`GET /api/internal/ai-call-bot/sessions/:id/verify?clientId=...`** (staging secret) and **`GET /api/internal/ai-call-bot/drift-review`** to confirm no unexpected drift.

| # | Scenario | Primary signals / actions | Expected FSM / outcome | Drift / verify checks |
|---|----------|---------------------------|------------------------|------------------------|
| 1 | Human answer → relevant person → **transfer success** | Classify DM/relevant + positive; offer/agree/initiate; agent answers; Twilio child leg **completed** duration > 0 | `transfer_initiated` → `transfer_completed` → `terminal`; `callOutcome` **right_person_transfer** (after finalize) | `fsmRejectedTransitionCount` unchanged; no `transfer_without_agreement`; no `reply_over_contract` |
| 2 | Human answer → relevant person → **agent no answer** | Agree + initiate; agent leg **completed** duration 0 or no-answer | `transfer_no_agent_answer` (or path to fallback) | `agentAnswered` false; `transferFailureReason` may be **agent_no_answer**; drift buffer clean |
| 3 | Human answer → relevant person → **transfer bridge fail** | Twilio child **canceled** / bridge fail while in `transfer_initiated` | `bridge_failed` → `transfer_failed` | No silent state jump; rejected transitions only if invalid webhook ordering |
| 4 | Human answer → **hesitation** → **callback capture** | Signals: hesitation + callback; API `fallback_capture_started` if applicable | `fallback_capture` → `terminal`; outcome **right_person_callback** or contract-aligned | `recordFallbackTriggered` / drift `fallback_*` within threshold |
| 5 | Human answer → **wrong person with referral** | wrongPerson + referral signals; finalize | `terminal`; **wrong_person_with_referral** | `other_notes` N/A unless outcome **other** |
| 6 | Human answer → **wrong person without referral** | wrongPerson no direction | `terminal`; **wrong_person_no_referral** | Same as above |
| 7 | **Not interested** | disinterest signals; finalize | `terminal`; **not_interested** | Verify report: terminal fields consistent |
| 8 | **Voicemail / machine** | Twilio **AnsweredBy** machine/fax or short completed; or signal voicemail | `voicemail_detected` → `terminal`; **voicemail** | Status mapper fires **answered_voicemail** from **dialing** |
| 9 | **No answer** | Twilio **no-answer** / **completed** duration 0 from ringing | `no_answer` → `terminal`; **no_answer** | Mapper **no_answer_signal** from **dialing** |
| 10 | **Busy** | Twilio **busy** | `no_answer` or terminal path per FSM | **no_answer_signal** from **dialing** |
| 11 | **Canceled** | Twilio **canceled** on dial or transfer leg | Per mapper (dialing vs **transfer_initiated**) | **bridge_failed** on transfer cancel |
| 12 | **Human intercept** | POST **intercept**; Realtime takeover | `human_takeover_active` (or intercept edge) | Media not forwarded to OpenAI after takeover |
| 13 | **Other outcome with notes** | finalize **other** + **other_notes** | `terminal`; **other** | Verify: no `other_outcome_missing_notes` |
| 14 | **initiate_transfer without agreement** | POST transition **initiate_transfer** with no **transfer_agreed_at** | **400** / `ok: false`; state unchanged | `fsmRejectedTransitionCount` increments; drift **transfer_without_agreement**; unless `AI_CALL_BOT_ALLOW_UNSAFE_TRANSFER` |
| 15 | **Missing transfer target env** | Agree path; **evaluate-transfer** when allowed but no **AI_CALL_BOT_TRANSFER_TARGET_E164** / **AGENT_PHONE** | `transferTwimlAvailable: false` | Drift **missing_transfer_target_env**; TwiML builder logs |

## Post-run checklist

1. `verify-report` / internal verify: `terminalFieldGaps` empty when `currentState === terminal`.
2. `drift-review`: `fallbackInWindow` below alert threshold; scan `events` for unexpected kinds.
3. Logs: tag **`ai-call-bot-fsm`** should not show repeated **rejected** for the same valid webhook sequence.

## Environment (staging)

- Set **`AI_CALL_BOT_STAGING_SECRET`** (≥ 16 chars) to enable **`/api/internal/ai-call-bot/*`** drift review and verify-by-secret.
- Do **not** set **`AI_CALL_BOT_ALLOW_UNSAFE_TRANSFER`** except isolated guardrail tests.
