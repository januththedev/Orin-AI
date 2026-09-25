# Orin Chat / Orin Core

English, Sinhala, and Tamil conversational assistant built by **Januth Nimnal**.

## Platform v2 architecture

- `orin-platform` is pinned as `vendor/orin-platform` at tag `platform-v1.0.0`.
- Neon Auth is the human identity authority.
- Browser sessions use server-side revocable HttpOnly cookies and CSRF protection; bearer credentials are not stored in local storage.
- Chat v2 routes text and image generation through `orin-router-service/v1`.
- Freshness queries use private no-store `orin-tools/api/search` POST requests.
- Retrieved search text is untrusted evidence, never an instruction.
- Conversation content is product-private. Shared events contain metadata, usage, and correlation IDs, not prompt or response text.
- Public code execution is not part of this release.

## Local verification

```bash
npm ci
npm run platform:build
npm run check
npm run build
```

Tests use fake providers and must not call live model, Tools, Neon, Redis, Blob, or Vercel production services.

## Required production configuration

See `.env.example`. Important v2 values include:

```text
DATABASE_URL
TOKEN_ENCRYPTION_KEY
ORIN_SESSION_HASH_KEY
NEON_AUTH_JWKS_URL
ORIN_ROUTER_BASE_URL
ORIN_ROUTER_SERVICE_SIGNING_KEY
ORIN_TOOLS_BASE_URL
ORIN_TOOLS_ASSERTION_SECRET
BLOB_READ_WRITE_TOKEN
ORIN_CHAT_V2
ORIN_PROVIDER_MODE
```

Keep `ORIN_CHAT_V2=off` until migrations, preview tests, and canary checks pass.

## Vercel functions

Legacy auth entry files are excluded with `.vercelignore`; `/api/auth/[...path]` dispatches password, Neon, device, session rotation, logout, and account-session routes. This keeps the deployment below the Hobby function limit.
