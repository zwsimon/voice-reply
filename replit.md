# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains the VoiceReply project — a native iOS keyboard extension that lets users speak their reply intent in any app (iMessage, WhatsApp, etc.) and receive an AI-polished reply to insert. Built with EAS Build (not Expo Go).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Mobile**: Expo (SDK 54), Expo Router v6
- **AI**: Replit AI Integrations (OpenAI) via `@workspace/integrations-openai-ai-server`

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (VoiceReply endpoints)
│   └── voice-reply/        # Expo mobile app
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   └── integrations-openai-ai-server/  # OpenAI AI integration server-side
├── scripts/
└── ...
```

## VoiceReply App

**What it does:** Users tap a mic button, speak their reply, and AI converts their voice to a polished message.

**Flow:**
1. (Optional) Paste the original message for context
2. Choose a tone: Friendly / Formal / Casual
3. Tap mic button and speak
4. AI transcribes and rewrites the reply
5. Copy the generated reply to paste into any messaging app

**Key Files:**
- `artifacts/voice-reply/app/index.tsx` — Main screen
- `artifacts/voice-reply/contexts/VoiceReplyContext.tsx` — Recording state + API calls
- `artifacts/voice-reply/components/RecordButton.tsx` — Animated record button
- `artifacts/voice-reply/components/WaveformAnimation.tsx` — Voice waveform bars
- `artifacts/voice-reply/components/ReplyCard.tsx` — Generated reply display + copy
- `artifacts/voice-reply/components/ToneSelector.tsx` — Tone picker
- `artifacts/voice-reply/components/HistoryDrawer.tsx` — Past replies modal
- `artifacts/api-server/src/routes/voicereply.ts` — API routes

**API Endpoints:**
- `POST /api/voicereply/transcribe` — Speech-to-text via OpenAI gpt-4o-mini-transcribe
- `POST /api/voicereply/generate-reply` — AI reply rewriting via gpt-5.2

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Environment Variables

- `AI_INTEGRATIONS_OPENAI_BASE_URL` — auto-set by Replit AI integration
- `AI_INTEGRATIONS_OPENAI_API_KEY` — auto-set by Replit AI integration
- `DATABASE_URL` — auto-set by Replit database
