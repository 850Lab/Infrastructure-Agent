# Potential Cleanup Report

## Confirmed Dead Code — Safe to Remove

### `/src/mastra/` (entire directory)
- **Files**: `index.ts`, `agents/agent.ts`, `inngest/client.ts`, `inngest/index.ts`, `storage/index.ts`, `tools/exampleTool.ts`, `workflows/workflow.ts`
- **Reason**: Mastra framework scaffolding from initial Replit template. Zero imports from any server or client file.
- **Risk**: None — completely isolated from the app.

### `/src/triggers/` (entire directory)
- **Files**: `cronTriggers.ts`, `exampleConnectorTrigger.ts`, `slackTriggers.ts`, `telegramTriggers.ts`
- **Reason**: Template trigger files. No imports from any server or client file.
- **Risk**: None.

### `/src/global.d.ts`
- **Reason**: Type declarations for the Mastra framework. Not used by the app.
- **Risk**: None.

### `/tests/` (entire directory)
- **Files**: `testCronAutomation.ts`, `testWebhookAutomation.ts`
- **Reason**: Test files for the Mastra framework, not the actual app. No test runner configured.
- **Risk**: None.

### `client/src/components/neural-network.tsx`
- **Reason**: Animated neural network background component. Not imported by any page or component.
- **Risk**: None.

## Likely Dead Code — Verify Before Removing

### `server/bootstrap.ts`
- **Purpose**: Standalone Airtable schema verification script.
- **Usage**: Not imported by any file. Appears to be a CLI utility (`ts-node server/bootstrap.ts`).
- **Recommendation**: Keep if used for manual Airtable setup; move to `/scripts/` if kept.

### `server/run-call-engine.ts`
- **Purpose**: Standalone CLI runner for the call engine.
- **Usage**: Not imported. Appears to be a manual CLI tool.
- **Recommendation**: Keep in `/scripts/` or remove if call engine runs via scheduler.

### `server/run-daily.ts`
- **Purpose**: Original daily pipeline orchestrator (non-web version).
- **Usage**: Referenced by `setup-client.ts` and `narrative.ts`, but `run-daily-web.ts` is the active orchestrator used by the scheduler.
- **Recommendation**: Verify if `run-daily.ts` is still needed as a fallback. May be superseded by `run-daily-web.ts`.

### `server/setup-client.ts`
- **Purpose**: Client provisioning utility.
- **Usage**: Referenced by `admin-routes.ts`. Likely used via admin panel.
- **Recommendation**: Keep — still active.

### `server/migrate-client-data.ts`
- **Purpose**: One-time data migration script.
- **Usage**: Not imported by any file.
- **Recommendation**: Move to `/scripts/` or remove if migration is complete.

### `client/src/pages/active-work.tsx`
- **Reason**: Page component not registered in `App.tsx` router.
- **Usage**: Dead — no route points to it.
- **Recommendation**: Remove or register the route.

### `client/src/pages/make-auditor.tsx`
- **Reason**: Page component not registered in `App.tsx` router.
- **Usage**: Dead — no route points to it.
- **Recommendation**: Remove or register the route.

## Duplicate / Overlapping Functionality

### Airtable access patterns
- `server/airtable.ts` — Raw Airtable CRUD (fetch, update, download audio)
- `server/airtable-scoped.ts` — Client-scoped Airtable queries
- `server/make-airtable.ts` — Airtable operations via Make.com
- **Note**: Three different patterns for Airtable access. Consider consolidating.

### Daily orchestrators
- `server/run-daily.ts` — Original CLI orchestrator
- `server/run-daily-web.ts` — Current web-integrated orchestrator (used by scheduler)
- **Note**: `run-daily.ts` may be obsolete.

### Pipeline runners (standalone CLI files)
These are standalone `ts-node` scripts that duplicate logic already in the scheduler:
- `server/run-dm-coverage.ts`
- `server/run-opportunity-engine.ts`
- `server/run-playbooks.ts`
- `server/run-query-intel.ts`
- `server/run-web-intel.ts`
- **Note**: These are useful for manual debugging but duplicate the scheduler flow.

## Unused Shadcn UI Components

The following Shadcn components are installed but may not be actively used. Verify before removing:
- `aspect-ratio`, `carousel`, `command`, `context-menu`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `pagination`, `resizable`, `slider`, `toggle-group`

## Recommendations

1. **Immediate safe deletions**: `/src/mastra/`, `/src/triggers/`, `/src/global.d.ts`, `/tests/`, `neural-network.tsx`
2. **Move to `/scripts/`**: `bootstrap.ts`, `run-call-engine.ts`, `migrate-client-data.ts`
3. **Remove or register**: `active-work.tsx`, `make-auditor.tsx`
4. **Consolidate later**: Airtable access patterns, daily orchestrator duplication
