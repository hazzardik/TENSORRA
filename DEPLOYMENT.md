# TENSORRA deployment

## Architecture

- GitHub: source control + CI + public brand landing via GitHub Pages.
- Vercel: full Next.js application and server routes.
- Supabase: Auth, Postgres, pgvector, private file storage.
- Groq: development inference provider for GPT-OSS.
- Qdrant: optional semantic memory / document retrieval.

GitHub Pages cannot run the full application because TENSORRA uses server-side API routes and secret environment variables.

## GitHub repository

Create a repository named `TENSORRA` under the GitHub account `hazzardik`, then push this project to `main`.

The included workflows provide:

- `.github/workflows/ci.yml` — typecheck + production build.
- `.github/workflows/pages.yml` — deploys `github-pages/` to GitHub Pages.

After the first Pages workflow succeeds, the landing URL is expected to be:

`https://hazzardik.github.io/TENSORRA/`

## Vercel environment variables

Set these in the Vercel project settings:

```text
NEXT_PUBLIC_SUPABASE_URL=https://hlfjkfvlreqxvgjvyffp.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable Supabase key>
GROQ_API_KEY=<server-only key>
AI_BASE_URL=https://api.groq.com/openai/v1
TENSORRA_FAST_MODEL=openai/gpt-oss-20b
TENSORRA_DEEP_MODEL=openai/gpt-oss-120b
TENSORRA_BROWSER_SEARCH=true
TENSORRA_CODE_INTERPRETER=true
QDRANT_URL=<optional>
QDRANT_API_KEY=<optional>
QDRANT_MEMORY_COLLECTION=tensorra_memory
QDRANT_KNOWLEDGE_COLLECTION=tensorra_knowledge
```

Never expose `GROQ_API_KEY`, `QDRANT_API_KEY`, Supabase secret/service-role keys, or any other server secret as `NEXT_PUBLIC_*` variables.

## Supabase Auth URLs

Once the production Vercel URL is known, add it to Supabase Auth URL configuration as the Site URL / allowed redirect URL. Keep localhost only for local development.

## Health check

`GET /api/health` returns whether the deployment has the required public Supabase config and AI key.
