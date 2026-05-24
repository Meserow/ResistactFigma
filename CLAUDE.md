# ResistAct — Claude Guidelines

## Git policy (meserow.com)

- **Never push to git** — not to `develop`, not to `main`, not to any branch. No exceptions.
- **Pull requests are allowed** — use `gh pr create` to open a PR from `develop` to `main` when asked. Never push as part of this; the user pushes develop first.
- **Commits to `develop` are allowed** — do these when a logical chunk of work is done, but ask if it's not obvious that the user wants a commit.
- **Read operations** — fine to perform anytime without asking.
- **Write operations** (editing files, deploying edge functions, running KV migrations, any action that changes persistent state) — ask for approval before proceeding.

## Project overview

ResistAct (resistact.org) is an anti-Trump / MAGA-resistance action-matching platform. Users are matched with civic actions based on their time, energy, tone preferences, and location.

- **Frontend:** React + Vite + Tailwind, lives in `src/app/`
- **Backend:** Supabase Edge Function at `supabase/functions/make-server-9eb1ae04/index.ts`
- **Data store:** Supabase KV (accessed via `kv_store.ts`)
- **Deployment:** Edge function is deployed via `npx supabase functions deploy` with the project ref `zkihnylrvdofdbnhmmoq`

## Version & changelog (always do this)

After any meaningful batch of user-facing changes (same trigger as a commit — not after every single edit, but after a feature, fix, or group of related changes is complete):
1. Bump `"version"` in `package.json` (patch increment: 1.1.24 → 1.1.25).
2. Add a new entry at the top of `CHANGELOG` in `src/app/data/changelog.ts` — today's date, a short title, and plain-language bullets grouped by section. Write for users, not developers.
3. Do this without being asked. Never leave a session with uncommitted version/changelog work. Always tell the user when you've done it.

## Key conventions

- Seed cards (org-curated) live in `SEED_CARDS` in `index.ts` and are stored under `action:*` keys with IDs ≥ 1000.
- User-submitted cards are stored under `user-action:*` keys with IDs tracked in `user-action:ids`.
- One-time KV migrations are gated by a version key (e.g. `migration:foo:v1`) so they only run once.
- `adminApproved: false` hides a card from the public feed; admins review via the admin panel.
- `notOnTopic: true` flags a card as potentially off-topic (auto-set on submission by a keyword heuristic).
- Location canonical values: Remote, At Home, National, Multi-State, then US state names.
- Never commit `.env` files or service role keys.

## Inbox imports (Cowork harvest)

A Cowork scheduled task drops weekly multi-platform harvest batches of grassroots resistance Acts into `data/inbox/` every Monday morning. The full workflow lives in `docs/INBOX_IMPORT.md` — read that doc before processing any inbox batch.

Slash commands:
- `/process-inbox` — import the newest dated batch into KV under `action:*` (IDs ≥ 1000, `adminApproved: false`), archive consumed files, bump version + CHANGELOG, open a PR from `develop` to `main` via `gh`. Never auto-merge.
- `/audit-acts` — read-only health check on live Acts (dormant accounts, stale events, broken source links, validation drift, boost-only creep). Writes to `reports/`.

Key rules from `docs/INBOX_IMPORT.md` that apply across the codebase:

- Every Act is a verb-led thing a user does themselves — not an account to follow.
- `boost_only: true` content is capped at 10% of any import batch and 10% of live Acts.
- Harvested Acts always land with `adminApproved: false`. Approval happens through the admin panel, never automatically.
- Validation is mandatory before insert. Never insert unvalidated harvest content into KV.
- Inserts go through the Edge Function (`supabase/functions/make-server-9eb1ae04/index.ts`), not raw Supabase.
