# Voice Memo Analyzer

## Overview
A webhook-based voice memo processing system that receives Airtable record IDs, downloads audio attachments, transcribes them using OpenAI Whisper, analyzes for containment language using GPT, and writes results back to Airtable.

## Architecture
- **Backend**: Express + TypeScript server on port 5000
- **Frontend**: React + Shadcn UI monitoring dashboard
- **Database**: PostgreSQL (Replit built-in) for webhook processing logs
- **External Services**: Airtable REST API, OpenAI (Whisper + GPT via Replit AI Integrations)

## Key Files
- `shared/schema.ts` - Data models (webhookLogs table, validation schemas)
- `server/routes.ts` - API endpoints (webhook, logs, health)
- `server/airtable.ts` - Airtable API integration (fetch records, download audio, update records)
- `server/openai.ts` - OpenAI integration (Whisper transcription, GPT containment analysis)
- `server/storage.ts` - Database storage layer using Drizzle ORM
- `server/db.ts` - Database connection via @neondatabase/serverless
- `client/src/pages/dashboard.tsx` - Monitoring dashboard UI
- `client/src/App.tsx` - App router

## API Endpoints
- `POST /api/airtable-webhook` - Main webhook endpoint (accepts `{ recordId }`)
- `GET /api/webhook-logs` - List all processing logs
- `GET /api/webhook-logs/:id` - Get specific log entry
- `POST /api/test-webhook` - Test trigger (proxies to webhook endpoint)
- `GET /api/health` - Health check with service status

## Environment Secrets
- `AIRTABLE_API_KEY` - Airtable Personal Access Token
- `AIRTABLE_BASE_ID` - Airtable Base ID
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key (via Replit AI Integrations)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - OpenAI base URL (via Replit AI Integrations)
- `DATABASE_URL` - PostgreSQL connection string

## Airtable Configuration
- Table name: "Calls"
- Expected fields: Audio attachment field (any name), "Transcription" (text), "Analysis" (text)

## Dependencies
- @neondatabase/serverless, drizzle-orm - Database
- openai - AI transcription and analysis
- express - HTTP server
- React, @tanstack/react-query, shadcn/ui - Frontend
