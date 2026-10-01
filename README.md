# TENSORRA v0.5

TENSORRA is a web-first AI product with variable-depth reasoning, long-term memory, private-document RAG, browser search, code execution and a mobile-app path.

## What is working in v0.5

- Public product website at `/`
- Authenticated AI workspace at `/app`
- Supabase Auth + RLS
- Chats and persistent message history
- Thinking modes: Auto / Fast / Balanced / Deep / Max
- Auto mode routes requests by complexity
- GPT-OSS model routing through an OpenAI-compatible provider (Groq by default)
- Long-term memory extraction
- Optional Qdrant semantic memory
- PDF/TXT/MD/JSON uploads (15 MB max)
- Private Supabase Storage bucket
- Document chunking and private RAG
- Qdrant semantic document retrieval with Postgres full-text fallback
- Groq built-in browser search
- Groq built-in Python code execution
- Feedback + explicit opt-in dataset collection for future TENSORRA fine-tuning
- Usage and tool-run telemetry
- PWA manifest, offline shell, install flow and app icons
- Capacitor v8 mobile wrapper starter for iOS/Android

## Architecture

```text
Web / PWA / iOS / Android
          |
      TENSORRA UI
          |
      TENSORRA Core
      /    |      \
 Reasoning Memory   Tools
    |       |       |--- Browser Search
 GPT-OSS  Supabase  |--- Python Code
 20B/120B  Qdrant   |--- Private RAG
              \
             Documents
```

## Setup

1. Copy `.env.example` to `.env.local`.
2. Create a Groq API key and set `GROQ_API_KEY`.
3. Optional: create a Qdrant Cloud cluster and set `QDRANT_URL` and `QDRANT_API_KEY`.
4. Install and run:

```bash
npm install
npm run dev
```

The connected TENSORRA Supabase project already contains the v0.2-v0.5 migrations. If you create another Supabase project, apply the SQL files in `supabase/migrations/` in order.

## Mobile app

The web app is already installable as a PWA. For App Store / Google Play packaging, see `mobile/README.md`. Capacitor keeps one codebase while allowing native iOS/Android APIs later.

## Important model distinction

TENSORRA Core is our software: routing, memory, retrieval, tools, UI, data model, telemetry and training-data pipeline. The first inference weights are GPT-OSS. A future `TENSORRA-20B-v1` can be produced by fine-tuning open weights on high-quality opt-in TENSORRA data, then self-hosted without changing the product architecture.

## Security

- No service-role key is exposed to the browser.
- User data is protected by RLS.
- Uploaded files live in a private bucket under the authenticated user ID.
- Training participation is opt-in and off by default.
- Plan fields cannot be self-upgraded by clients.

## Next engineering milestones

- Native share-sheet/file import and camera input
- Image/vision model path
- Voice input/output
- MCP connector layer
- Search citations UI
- Dataset curation dashboard
- TENSORRA-20B LoRA/SFT training workflow (`model-lab/`)
- Billing and product limits
- Production deployment + custom domain

## v0.5 additions

- Research mode: forces Max reasoning, web search, verification and research-specific prompting.
- Voice input using browser SpeechRecognition when available.
- Read-aloud for assistant answers using browser speech synthesis.
- `/api/health` production readiness endpoint.
- GitHub Actions CI for typecheck + production build.
- GitHub Pages static TENSORRA landing page.
- Vercel deployment metadata and `DEPLOYMENT.md`.

The full AI app must be hosted on a server-capable platform such as Vercel. GitHub Pages is intentionally limited to the static brand landing.
