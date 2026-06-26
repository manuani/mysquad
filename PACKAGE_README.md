# VirtualOffice AI — Claude Code build package

This package contains everything you need to continue the VirtualOffice AI
build in Claude Code instead of claude.ai chats.

## What's in the package

```
voai-platform/
├── README.md                          # Repo's own README (project overview)
├── CLAUDE.md                          # Operating instructions for Claude Code
├── docs/
│   ├── adr/                           # 6 Architecture Decision Records (ADRs 001-006)
│   ├── handoff/
│   │   ├── CLAUDE_CODE_SETUP.md       # ★ START HERE — setup guide
│   │   ├── FIRST_SESSIONS.md          # ★ Ready-to-paste prompts for the first sessions
│   │   └── VERIFICATION_BACKLOG.md    # 6 known gaps vs consolidated architecture
│   └── reference/                     # ← You add the consolidated v2 docs here
├── apps/                              # Application entrypoints
├── services/                          # 12 service modules (modular monolith)
├── packages/                          # 7 shared packages
├── infra/                             # Infra placeholders (Sprint 1.1.3)
├── evals/                             # Eval workspace placeholder (Sprint 5.3)
└── ...config files
```

## Recommended reading order

1. **`docs/handoff/CLAUDE_CODE_SETUP.md`** — get Claude Code installed and
   the repo healthy. 15-30 min.
2. **`docs/handoff/VERIFICATION_BACKLOG.md`** — understand the six known
   gaps you'll fix first. 10 min read.
3. **`docs/handoff/FIRST_SESSIONS.md`** — pick up the first Claude Code
   prompt. 5 min, then start working.
4. `CLAUDE.md` — the operating rules. Worth a read so you understand what
   Claude Code is operating against.
5. `README.md` — the repo's own README for context if needed.

## What's pre-verified

- `pnpm install --frozen-lockfile` works
- `pnpm run build` — 20 tasks succeed
- `pnpm run typecheck` — 37 tasks succeed
- `pnpm run lint` — 20 tasks, 0 warnings
- `pnpm run test` — 37 tasks succeed, ~50 individual assertions

If any of these fail on first run after extracting, that's a setup issue
(usually wrong Node or pnpm version) — see `CLAUDE_CODE_SETUP.md`
troubleshooting.

## What you need to add

Three things, in order:

1. **The consolidated reference docs** in `docs/reference/`. Six markdown
   files corresponding to the v2 architecture, UX spec, sprint plan,
   session operating manual, platform spec, and (optional) strategic
   vision. Conversion guidance is in `docs/reference/README.md`.
2. **Your git remote**. `git init && git add . && git commit && git
   remote add origin <url> && git push -u origin main`.
3. **Your Anthropic API key for Claude Code** — set up during the Claude
   Code install (one-time).

## Quick-start (the impatient version)

```bash
tar -xzf voai-platform-claude-code-package.tar.gz
cd voai-platform
nvm use && npm i -g pnpm@9.12.0
pnpm install --frozen-lockfile
pnpm run build && pnpm run test    # confirm green

# Add the consolidated docs to docs/reference/ (see docs/reference/README.md)

git init && git add . && git commit -m "Deliverable 1.1.1 baseline"
# git remote add origin <your-url> && git push -u origin main

npm install -g @anthropic-ai/claude-code
claude
# Paste the first prompt from docs/handoff/FIRST_SESSIONS.md (Session A)
```

## When to come back to claude.ai

This package is for the build phase. Strategic conversations
(vision evolution, GTM, sprint-level planning across phases) remain in
claude.ai where the project knowledge and memory live. Concrete code
work moves to Claude Code.

Rule of thumb: if the question is "what should we build?", claude.ai. If
the question is "how do we build it?", Claude Code.

## Status

- Deliverable 1.1.1 (monorepo skeleton): **partially complete**
  - Built, tested, all CI green
  - Six sync gaps vs consolidated architecture documented in
    `VERIFICATION_BACKLOG.md` — Session B fixes them
- Next deliverable: 1.1.2 (local development environment with Docker
  Compose) — Session C
