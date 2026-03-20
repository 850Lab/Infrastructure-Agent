# AI Call Bot — Supervisor runbook (supervised rollout)

Internal reference for humans monitoring **live** AI Call Bot calls. Aligns with the **No Drift Checklist**: no sales pressure, short calls, explicit agreement before transfer, single FSM write path (`transfer-controller`).

**Primary APIs**

| Use | Endpoint |
|-----|----------|
| Live list + process drift summary | `GET /api/ai-call-bot/supervised/sessions/active` |
| One session snapshot + guidance | `GET /api/ai-call-bot/supervised/sessions/:id/live` |
| Human takeover | `POST /api/ai-call-bot/supervised/sessions/:id/intercept` |
| Do not auto-bridge | `POST .../pause-auto-transfer` `{ "reason": "..." }` |
| Re-enable bridge attempts | `POST .../clear-pause-auto-transfer` |
| Contract verify | `GET /api/ai-call-bot/sessions/:id/verify-report` |

---

## 1. What the supervisor is watching for

- **FSM state** vs expected progression (dialing → human → classify → transfer or capture → terminal).
- **`operatorGuidance`** on the live payload (deterministic; see §6).
- **`driftFlags`** — especially `replyOverContract`, `transferAttemptedWithoutAgreement`, `repeatedFallbackInSession`, `missingTransferTargetTransferEligible`, `longCallExceedsThreshold`, `processWideFallbackHighRate`.
- **`supervisor_attention_reasons`** on the DB row (persistent escalation markers).
- **`rejectedTransitionCount` / `lastRejectedTransitionReason`** — invalid edges, pause blocks, or guardrails firing.
- **Duration** vs `AI_CALL_BOT_LONG_CALL_THRESHOLD_SEC` (default 120s).
- **Transfer env** — if rules allow transfer but TwiML is unavailable, target env is misconfigured.

---

## 2. When to let the bot continue

- Callee is **relevant**, **not blocked** by checklist (no voicemail/disinterest/wrong-person-without-path, etc.).
- **Agreement to connect** is clear **or** the path is **information/callback capture** only.
- **No** tier-5 drift flags, **no** missing transfer target while eligible, duration **under** long-call threshold.
- **`operatorGuidance.level` === `monitor_only`** (or you have consciously chosen to observe through `prepare_intercept`).

---

## 3. When to intercept

- Callee confusion, **gatekeeper** risk, or **sensitive** topic requiring a human voice **now**.
- **Checklist drift** visible in conversation (verbosity, selling tone, looping) even before automated `replyOverContract` fires.
- **Legal/safety** or **brand** risk.
- **Before** any transfer if you are **not confident** agreement was explicit.

**Action:** `POST .../intercept` — stops AI from receiving/sending audio on the coaching stream; FSM updated via existing controller path.

---

## 4. When to pause auto-transfer

- **Ambiguous** consent (“yeah maybe”, gatekeeper hedging).
- **Rejected FSM transition** on the transfer path (`rejectedTransitionCount > 0` while state is `transfer_eligible` / `transfer_offered` / `transfer_agreed` / `transfer_initiated`).
- **Evaluate-transfer** shows rules would allow transfer but **you** are not ready for a bridge.
- **Target env** missing — pause **until** env is fixed (do not “force” bridge).

**Action:** `POST .../pause-auto-transfer` with a short `reason`. **`initiate_transfer` is blocked** while pause is on.

---

## 5. When to allow transfer

- **Explicit** agreement to speak with the right person **now**.
- **`transfer_agreed`** path satisfied; **no** supervisor pause; **no** missing transfer target.
- **No** tier-5 attention reasons unresolved (use judgment — document in notes if you override).

---

## 6. When to force callback / info capture

- **Hesitation**, callback request, or **neutral** openness without agreement → use signals + FSM **`fallback_capture`** path per product rules (no new rails here).
- **Transfer blocked** by rules → **capture** callback or minimal info, then **finalize** with the correct terminal outcome.
- **Agent no answer / bridge fail** → follow **fallback** TwiML / finalize per existing flow.

---

## 7. Hesitation

- Treat as **higher risk** for silent drift: prefer **callback capture** over pushing transfer.
- If hesitation **plus** eligibility noise, consider **pause auto-transfer** until one clear next step is chosen.

---

## 8. Repeated fallback

- **Session:** `sessionFallbackFsmCount` and `repeatedFallbackInSession` — if true, **needs supervisor attention** tier; review signals and callee type.
- **Process:** `processDriftSummary.fallbackInWindow` vs threshold — cohort/config issue; not per-call only.

---

## 9. Drift flags (how to treat)

| Flag | Treatment |
|------|-----------|
| `persistentSupervisorAttentionRequired` | **Investigate** immediately; read `persistentAttentionReasons`. |
| `replyOverContract` | **Verify** Realtime prompt still applied; consider **intercept** if call ongoing. |
| `transferAttemptedWithoutAgreement` | **Do not** bypass rails; confirm agreement before any retry. |
| `fsmRejectedTransition` | Read `lastRejectedTransitionReason`; **pause** if on transfer path. |
| `missingTransferTargetTransferEligible` | **Fix env** before transfer; **manual follow-up** if call ended. |
| `repeatedFallbackInSession` | **Escalate** — path or signals wrong. |
| `processWideFallbackHighRate` | **Escalate** — systemic; review staging matrix. |
| `terminalContractGaps` | **Fix** before relying on analytics (finalize / terminal contract). |

---

## 10. Transfer target env failures

- Symptom: `transferAllowed` true in API sense but **no** TwiML / `missing_transfer_target_transfer_eligible`.
- **Action:** Set **`AI_CALL_BOT_TRANSFER_TARGET_E164`** or **`AGENT_PHONE`** in deployment; re-run **evaluate-transfer** after fix.
- **Do not** add hardcoded numbers in app code.

---

## 11. What to log after unusual calls

- **CallSid**, **session id**, **final FSM state**, **terminal outcome**, **`supervisor_attention_reasons`** (if any).
- **Operator actions:** intercept, pause, clear pause, timestamps.
- **Drift:** note `lastRejectedTransitionReason` and any **verify-report** `terminalFieldGaps`.
- **CRM / pipeline:** one line tying outcome to next human task (callback, DM hunt, closed-lost, etc.).

---

## 12. Decision tables

### 12.1 Continue vs intercept

| Condition | Continue | Intercept |
|-----------|----------|-----------|
| Callee relevant, clear path, no drift tier 5 | ✓ | |
| Confusion / gatekeeper / brand risk | | ✓ |
| `replyOverContract` or tier-5 attention | | ✓ (strongly) |
| Agreement unclear before transfer | | ✓ |
| `human_takeover_active` / already intercepted | N/A (human led) | Already done |

### 12.2 Pause auto-transfer vs leave enabled

| Condition | Pause | Leave enabled |
|-----------|-------|----------------|
| `rejectedTransitionCount > 0` on transfer path | ✓ | |
| Ambiguous consent | ✓ | |
| Rules allow transfer but you disagree | ✓ | |
| Clean `transfer_agreed` + no drift + env OK | | ✓ |
| Missing transfer target | ✓ (until env fixed) | |

### 12.3 Allow transfer vs capture callback

| Condition | Transfer | Callback / capture |
|-----------|----------|---------------------|
| Explicit agreement + env OK + no pause | ✓ | |
| Hesitation / callback ask | | ✓ |
| Transfer blocked by rules | | ✓ |
| Wrong person no referral | | ✓ (then finalize) |

### 12.4 Monitor only vs mark needs attention

| Condition | Monitor only | Needs attention |
|-----------|--------------|-----------------|
| `operatorGuidance.level === monitor_only` | ✓ | |
| Persistent attention flag or tier-5 drift | | ✓ |
| `verify-report` terminal gaps on live terminal row | | ✓ |

### 12.5 Escalate to manual follow-up

| Condition | Escalate |
|-----------|----------|
| `missingTransferTargetTransferEligible` | ✓ |
| `longCallExceedsThreshold` | ✓ |
| Bridge / agent failures post-call | ✓ |
| `other` outcome | ✓ (notes mandatory) |

---

## 13. Outcome handling guide (operator actions after finalize)

| Outcome | Operator focus |
|---------|----------------|
| **right_person_transfer** | Confirm handoff completed; agent owns next step; close the loop in CRM. |
| **right_person_callback** | Schedule/assign callback; ensure **follow-up date** captured if available. |
| **wrong_person_with_referral** | Log referral **who/where**; next task = reach correct contact. |
| **wrong_person_no_referral** | **Do not** chase aggressively; note for list hygiene / alternate sourcing. |
| **not_interested** | Respect **no**; mark closed / nurture off per policy. |
| **voicemail** | Single concise VM policy if redial; otherwise task = alternate channel. |
| **no_answer** | Retry policy per cadence; note attempt count. |
| **bad_number** | Data fix task; remove/flag number in source system. |
| **other** | **`other_notes` required** — document anomaly; assign human owner. |

---

## 14. API guidance mapping (deterministic)

Implemented by `buildOperatorGuidanceFromLiveView` in `server/ai-call-bot/supervisor-operator-guidance.ts`. **First matching tier wins** (most severe first).

| Priority | `level` | `headline` | Triggers (any of) |
|----------|---------|------------|-------------------|
| 5 | `needs_supervisor_attention_now` | Needs supervisor attention now | `persistentSupervisorAttentionRequired`, `terminalContractGaps`, `processWideFallbackHighRate`, `repeatedFallbackInSession`, `replyOverContract`, `transferAttemptedWithoutAgreement` |
| 4 | `manual_follow_up_recommended` | Manual follow-up recommended | `missingTransferTargetTransferEligible`, `longCallExceedsThreshold` |
| 3 | `pause_auto_transfer_recommended` | Pause auto-transfer recommended | Not paused + `transferEligibility === eligible` + `rejectedTransitionCount > 0` + FSM in transfer path states |
| 2 | `prepare_intercept` | Prepare to intercept | Not intercepted + not terminal + duration ≥ `AI_CALL_BOT_PREPARE_INTERCEPT_MIN_SEC` (default 45) |
| 1 | `monitor_only` | Monitor only | Default |

Payload shape on each live session:

```json
{
  "operatorGuidance": {
    "level": "monitor_only",
    "headline": "Monitor only",
    "detailLines": ["..."],
    "matchedSignals": ["..."]
  }
}
```

---

## 15. How to use during live rollout

1. Open **`GET .../supervised/sessions/active`** on a dashboard or script; sort by `operatorGuidance.level` (map severity order in UI).
2. Drill into **`GET .../supervised/sessions/:id/live`** for `driftFlags`, `processDriftSummary`, and **`operatorGuidance.detailLines`**.
3. Apply **decision tables** above when automation is ambiguous.
4. After the call, **`verify-report`** + internal notes per §11.

---

## Revision

Keep this document updated when checklist or FSM contracts change. Code truth for guidance tiers: **`supervisor-operator-guidance.ts`**.
