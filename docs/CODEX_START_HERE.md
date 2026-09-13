# Codex: Start Here

Read `CODEX_TASK.md` first. It is the authoritative handoff specification for the Supabase + Google Drive + account/admin/upload work.

## Immediate task

Implement Phase 1 first, then Phase 2 if time permits:

1. Inspect the current GitHub Pages site and preserve existing behavior.
2. Add `/login/`, `/account/`, `/upload/`, `/admin/` frontend shells.
3. Add Supabase migrations/schema and Edge Function/server-side scaffolding.
4. Implement custom username/password user login with no email requirement.
5. Implement separate admin login.
6. Implement secure initial super-admin bootstrap from server-side environment variables.
7. Implement sessions, logout, KICK, BAN/unban primitives.
8. Implement multiple password hashes per user: one user-managed password plus admin-added alternate passwords.
9. Do not start Google Drive upload integration until authentication/authorization foundations are sound, but prepare the interfaces/configuration for it.

## Credentials

Real credentials are intentionally not committed. Use `.env.example` only as a key-name reference. Ask the repository owner for runtime secrets only when required by the deployment environment. Never place them in frontend JS, HTML, logs, issues, commits, or README examples.

## Working style

- Prefer small reviewable commits.
- Keep the current public portal deployable throughout the work.
- Add migration and setup documentation as code evolves.
- Do not silently weaken security to simplify implementation.
- When a required external console step cannot be automated (Supabase project settings, Google OAuth consent/client creation, etc.), document the exact owner action and continue with everything that can be implemented in-repo.
