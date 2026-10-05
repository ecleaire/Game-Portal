# Game Portal development

Read `CODEX_TASK.md`, `docs/CODEX_START_HERE.md`, and `.env.example` before changing code. `CODEX_TASK.md` is the authoritative base specification; explicit current user requirements take precedence.

## Architecture and safeguards

- Preserve the static GitHub Pages frontend and existing playable games. No framework migration is needed.
- Supabase hosts custom username/password authentication, authorization, metadata, and private Storage. User and administrator sessions are separate. Only administrators create accounts; email is not required.
- Google Drive is private package storage/archive, never public game hosting. Keep backend credentials and password/session hashes out of frontend artifacts and logs.
- Never commit real `.env` files, OAuth credentials, service-role keys, bootstrap passwords, or tokens. `.env.example` contains placeholders only.
- Enforce permissions on the server, not only in the UI. Preserve review, sharing, BAN/session revocation, ownership, and ZIP validation safeguards.
- Keep migrations ordered and append new migrations rather than rewriting deployed ones. Document external owner setup and continue implementation when console access is unavailable.

## Setup and verification

Use Node.js 22 or newer. Cloud setup and owner instructions are in `docs/CODEX_CLOUD.md`.

```sh
bash scripts/setup-codex-cloud.sh
npm test
npm run build
npm run test:browser
```

`npm test` uses PGlite and mock services. Browser tests launch local servers on ports 4173 and 54321, with test-only accounts and mocked Drive/Storage. No production credentials, Supabase CLI, Docker, or real Google account are required. The tests are the source for disposable test account credentials; do not reuse them in production.

`npm run build` requires an empty `dist/`. If rebuilding, remove only the generated `dist/` directory after checking its resolved path belongs to this checkout. `npm run dev` serves the built frontend. Browser tests require a build and installed Playwright Chromium.

Run checks appropriate to the change; authentication, SQL, and upload changes need unit tests, and frontend flow changes need browser tests. Report checks and remaining limitations. Keep changes small and reviewable.

## Publication

See `docs/SETUP.md` and `docs/PUBLISHING.md`. A push to `main` deploys Pages. Backend migrations and Edge Functions require separate deployment; Pages alone does not deploy them. Keep schema/backend/frontend versions compatible. Use the current user's publication instructions; Cloud repository access alone is not authorization to use production secrets or modify production accounts/data.
