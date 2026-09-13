# Codex Handoff: Game Portal Backend / Admin / Upload System

Repository: `ecleaire/Game-Portal`
Production site: `https://ecleaire.github.io/Game-Portal/`

## Goal

Extend the current static GitHub Pages game portal into a small, fully managed game publishing platform.

Keep GitHub Pages as the public frontend. Use Supabase for backend/database/server-side logic. Use Google Drive as the main storage location for uploaded game packages pending review / archival. Published web games may continue to be served from GitHub Pages after approval.

Do not break the current game list/play functionality while adding the new system.

---

## Required account model

### No public signup and no email addresses

Users must NOT register themselves and must NOT need an email address.

Only an administrator can create an account from the admin panel.

A normal user account has:

- username
- user password
- role
- status
- creation/update timestamps

A user logs in with only:

- username
- password

The user can later change their own username and their own password from `/account/`.

### Multiple passwords per user

Each user has one user-managed password plus zero or more administrator-added alternate passwords.

Example:

- user password: changed by the user
- admin-added password A
- admin-added password B

Any active password for that account may be used to log in.

Requirements:

- Users must NOT see administrator-added passwords.
- Administrators may add or delete administrator-added passwords.
- Administrators must NOT be able to read existing password plaintext.
- Store only strong salted password hashes. Never store plaintext passwords.
- Deleting an admin-added password must immediately stop it from being accepted.
- Changing the user's own password must not delete administrator-added passwords.

Suggested table concept:

`users`
- id
- username (unique)
- role
- status
- banned_until nullable
- ban_reason nullable
- created_at
- updated_at

`user_passwords`
- id
- user_id
- password_hash
- type: `user` or `admin_added`
- label nullable (admin-visible descriptive label, NOT plaintext password)
- created_at
- revoked_at nullable

There should normally be exactly one active password row of type `user` per user.

---

## Administrator authentication

Admin login must be separate from user login.

Route:

`/admin/`

Admin login fields:

- administrator username
- administrator password

Use a separate `admin_users` table or otherwise clearly separate administrator authentication from normal user accounts.

The initial super administrator credentials have been supplied separately by the owner. DO NOT commit those credentials to this public repository and DO NOT hardcode them into frontend JavaScript/HTML.

Provide a secure setup/seed mechanism using environment variables / Supabase secrets / one-time setup tooling. The setup documentation should explain exactly how the owner creates the initial super admin without exposing the password in git history.

Admin roles should support at least:

- `super_admin`
- `admin` (optional initially, but schema should allow expansion)

---

## Admin user management

Admin panel must support:

- create user
- edit username
- change user role
- add an administrator-added password
- delete/revoke an administrator-added password
- KICK user
- temporary BAN
- permanent BAN
- unban
- disable account
- re-enable account
- optionally delete account (destructive action must require explicit confirmation)

### KICK

KICK means force logout / revoke all active sessions, without preventing future login.

### BAN

BAN prevents login and protected actions.

Support:

- temporary ban with expiration
- permanent ban
- ban reason
- unban

When banning a user, also invalidate/revoke all active sessions.

A banned user must not regain access simply by using an administrator-added alternate password.

---

## Audit log

Create an append-only admin audit log.

Track at minimum:

- admin identifier
- action
- target user/game identifier
- timestamp
- relevant metadata / reason

Examples:

- user created
- user kicked
- user banned
- user unbanned
- admin password added/revoked for a user
- game approved
- game rejected
- game unpublished

Do not put password plaintext or password hashes into audit logs.

---

## User-facing pages

Add pages/routes while keeping the existing static-site style simple and responsive:

- `/login/` user login
- `/account/` account settings
- `/upload/` game submission
- `/admin/` admin login/dashboard

Unauthenticated visitors may still browse and play published games unless changed later.

### `/account/`

Allow logged-in users to:

- view current username
- change username
- change their own password
- view account status
- view their submitted games and review status
- logout

Do NOT show administrator-added passwords.

---

## Game submission / review flow

Only authenticated, active, non-banned users with upload permission may submit games.

Submission fields should support at least:

- title
- engine (`godot`, `scratch`, `other`)
- description
- version
- controls/instructions
- thumbnail
- game package ZIP

Expected package forms:

- Godot: Web Export files packaged as ZIP, with an entry HTML file (prefer `index.html`)
- Scratch: TurboWarp Packager HTML output packaged as ZIP

Flow:

1. user submits game
2. metadata stored in Supabase
3. ZIP stored in Google Drive pending-review storage
4. submission status = `pending`
5. admin can inspect metadata and download/preview safely
6. admin approves or rejects
7. approved games become `published`
8. rejected games become `rejected` with optional admin reason

Statuses should support at least:

- draft (optional)
- pending
- approved/published
- rejected
- unpublished

Do not immediately execute arbitrary uploaded HTML/JS inside the privileged admin origin.

---

## Google Drive storage

Google Drive is a storage/archive backend, NOT the public HTML hosting layer.

Suggested Drive layout:

- `Game-Portal/pending/`
- `Game-Portal/approved/`
- `Game-Portal/rejected/`
- optional `Game-Portal/thumbnails/`

Supabase database should store Drive file/folder IDs and metadata rather than relying on filenames as identifiers.

### Security requirements

- Never expose Google OAuth refresh tokens, service credentials, client secrets, or privileged API tokens to the browser.
- Browser uploads must go through a secure backend path / Edge Function or another server-side mechanism.
- Secrets belong in Supabase secrets/environment configuration.
- Use least-privilege Google Drive OAuth scopes where practical.

If the chosen Google Drive authentication approach cannot be safely completed without interactive owner setup, implement the code/configuration scaffolding and document the exact manual steps required.

---

## Supabase

Target Supabase Free initially.

Use Supabase for:

- PostgreSQL database
- server-side API / Edge Functions
- account/session logic
- permissions
- moderation state
- game metadata
- audit logs

This project intentionally does NOT require email-based Supabase Auth for end users.

A custom username/password authentication layer is acceptable/expected if needed, but authentication and password verification must happen server-side, not in GitHub Pages frontend code.

### Security requirements

- Never expose Supabase service-role key to frontend code.
- Never commit secrets.
- Hash passwords using a well-reviewed salted password-hashing algorithm suitable for passwords.
- Use cryptographically secure session tokens.
- Store only hashed session tokens server-side if practical.
- Implement expiration and revocation.
- Validate authorization on every protected server-side operation; do not trust role/status values supplied by the client.
- Add rate limiting or sensible brute-force protection for login endpoints where practical.
- User/admin usernames should have normalization and uniqueness rules.
- Use parameterized/database-safe queries.

Provide SQL migrations/schema files in the repo, not only dashboard instructions.

---

## Published game hosting

Current site is GitHub Pages. Keep existing published games working.

Preferred long-term flow:

1. user uploads ZIP -> Drive pending
2. admin approves
3. publish workflow obtains approved package
4. validate/extract to an isolated game directory
5. update game metadata
6. deploy via GitHub Pages

For the first implementation, it is acceptable for approval to stop at `approved` plus a documented manual publishing step, as long as the architecture cleanly supports automating GitHub publication later.

Do NOT auto-extract arbitrary paths from ZIP without zip-slip/path traversal protection.

Set reasonable upload size/type limits and validate archive structure.

---

## Current repository behavior to preserve

The repository currently contains:

- `index.html` game listing
- `game.html` shared player page using an iframe
- `games.json`
- `assets/` frontend JS/CSS
- `games/` sample game directories
- GitHub Pages deployment workflow under `.github/workflows/`

Preserve the public site and progressively migrate data away from `games.json` only if necessary.

Avoid unnecessary frameworks unless they clearly improve maintainability. A static frontend plus modular JavaScript is acceptable.

---

## Suggested implementation phases

### Phase 1 — Foundation

- add frontend routes/pages
- add configuration loading approach
- create Supabase SQL migrations
- implement server-side user/admin auth
- implement session handling
- implement secure initial super-admin setup

### Phase 2 — Account/admin management

- `/login/`
- `/account/`
- `/admin/`
- user creation
- alternate password management
- KICK/BAN/unban
- audit log

### Phase 3 — Upload/review

- `/upload/`
- game submissions table
- Google Drive integration
- pending review UI
- approve/reject UI

### Phase 4 — Publishing automation

- safe archive validation/extraction
- approved game publication to GitHub Pages
- update public listing from backend or generated metadata

---

## Deliverables

Codex should leave the repository in a state where the owner can follow a README/setup document and deploy the backend without guessing.

Required deliverables:

1. implementation code
2. SQL migrations/schema
3. environment variable example file containing placeholders only
4. setup documentation for Supabase
5. setup documentation for Google Drive API/OAuth
6. secure initial admin creation instructions
7. local/development instructions
8. deployment instructions
9. security notes / known limitations
10. tests for critical authentication/authorization logic where feasible

Do not commit real credentials, access tokens, passwords, service-role keys, or Google secrets.

Before making destructive architectural changes, inspect the current repository and preserve current GitHub Pages behavior.
