# Setting up Claude Code for this build

This guide gets you from the tarball to Claude Code running productively in the
repo. Read all of it before you start — it'll take 15-30 minutes end to end.

## What Claude Code is and isn't

Claude Code is Anthropic's terminal-based coding agent. It runs in your shell,
reads your files, runs commands, and edits code based on your instructions. It
reads `CLAUDE.md` at the repo root on every session — that file is the primary
instruction surface and it's already populated for this project.

What this means in practice:

- **You don't paste documents into chats.** Claude Code reads files directly.
- **You don't re-explain context.** The CLAUDE.md and `docs/reference/` files
  carry the context across sessions.
- **You stay in the same repo for the whole build.** Sessions don't reset the
  filesystem the way claude.ai chats do.
- **The model can run pnpm, git, and any other commands** — with your
  permission for sensitive ones.

## Step 1: Install Claude Code

```bash
# Requires Node 18 or higher (the repo wants 20.11.0; that works fine)
npm install -g @anthropic-ai/claude-code

# Verify
claude --version
```

If you don't have a recent Node, install one first via nvm or fnm — see Step 2.

## Step 2: Set up the repo

```bash
# 1. Choose where the repo will live, e.g.:
cd ~/code

# 2. Extract the tarball
tar -xzf /path/to/voai-platform-claude-code-package.tar.gz
cd voai-platform/

# 3. Install Node 20.11.0 (one-time)
# Using nvm (macOS/Linux):
nvm install 20.11.0
nvm use   # reads .nvmrc

# Using fnm (cross-platform):
fnm install 20.11.0
fnm use

# 4. Install pnpm (one-time)
npm install -g pnpm@9.12.0

# 5. Install workspace dependencies
pnpm install --frozen-lockfile

# 6. Verify the skeleton is healthy
pnpm run build      # 20 tasks expected
pnpm run typecheck  # 37 tasks expected
pnpm run lint       # 20 tasks, 0 warnings expected
pnpm run test       # 37 tasks, ~50 assertions expected

# 7. Initialize git (one-time)
git init
git add .
git commit -m "Deliverable 1.1.1: monorepo skeleton (from Claude Code package)"

# Add your remote and push, e.g.:
# git remote add origin git@github.com:your-org/voai-platform.git
# git branch -M main
# git push -u origin main
```

If any step above fails, fix it before starting Claude Code. Claude Code can
help, but it's faster if the baseline is healthy first.

## Step 3: Add the reference documents

Claude Code needs the consolidated specs to make good decisions. The
`docs/reference/` directory is where they go.

**You need to do this manually** — these are your documents and I shouldn't
write them into the package.

```bash
# From the repo root, save each consolidated v2 doc as Markdown:
docs/reference/System_Architecture.md       # Architecture v2 (consolidated)
docs/reference/UX_Specification.md          # UX v2 (consolidated)
docs/reference/Sprint_Plan.md               # Sprint Plan
docs/reference/Session_Operating_Manual.md  # Session Operating Manual
docs/reference/Platform_Specification.md    # Platform Spec v2
docs/reference/Strategic_Vision.md          # Strategic Vision v4 (optional;
                                            # rarely needed for build decisions)
```

How to convert:

- **Word → Markdown**: use Pandoc (`pandoc input.docx -o output.md`) or save
  as Word's "Plain Text" with section headers preserved, then clean up.
- **PDF → Markdown**: Pandoc handles many PDFs; otherwise paste into a tool
  like Marker or do a one-time hand-clean.
- **If you only have the Word files**: keep the originals in
  `docs/reference/original/` and convert to markdown alongside. Claude Code
  can read .docx but Markdown is faster and easier to grep.

Once these are in place, `CLAUDE.md` already references them — no further
config needed.

## Step 4: Run the first Claude Code session

From the repo root:

```bash
claude
```

This opens the interactive Claude Code prompt. The first thing Claude Code
does is read `CLAUDE.md` — confirm in the output that it found it (you'll
see it acknowledged in the session start).

### Smoke test

Try a low-risk command to verify everything works:

> "Read CLAUDE.md and confirm the rules you'll apply. Then read
> `docs/handoff/VERIFICATION_BACKLOG.md` and summarize the six open issues
> in priority order."

If Claude Code does that cleanly, you're set up.

### The recommended first real session

The skeleton has six known gaps vs the consolidated architecture (see
`docs/handoff/VERIFICATION_BACKLOG.md`). The right first session is to fix
them, in this order, in one PR:

> "Apply all six sync corrections from `docs/handoff/VERIFICATION_BACKLOG.md`
> to bring Deliverable 1.1.1 into alignment with System Architecture v2.
> Start with Issue 5 (highest priority — ADR 006 violates §8.1.1). For each
> issue, make the code change, update or supersede the relevant ADR, and
> run lint/typecheck/test before moving to the next. At the end, give me a
> single commit message summarizing what changed."

This is one session, one PR, one verified delivery. After it lands,
Deliverable 1.1.2 (Docker Compose for the data layer) starts in a fresh
session.

## Step 5: Working with Claude Code productively

A few patterns that work well for this project:

### One deliverable per session

The Session Operating Manual in `docs/reference/` describes this. Each
session has a scope (a Sprint Plan deliverable) and an output (code that
builds + passes tests + a clear handoff note). Don't let sessions bleed.

### Let Claude Code run the verification commands

After Claude Code makes a change, ask it to run `pnpm run build && pnpm
run typecheck && pnpm run lint && pnpm run test`. Don't trust "the code
should work" — get the green CI output.

### Commit often, in topical chunks

Claude Code can stage and commit on your behalf. Ask for one commit per
logical change. Smaller commits make review and rollback easier.

### Use the reference docs by section, not by document

"Read §8.1.1 of System_Architecture.md and check whether
`packages/db/src/index.ts` matches" is much more efficient than "read the
whole architecture doc." Claude Code is good at section-scoped reading.

### When you disagree with Claude Code

You're the founder; final calls are yours. If Claude Code proposes
something you don't want, say so directly: "Don't do that. Here's why."
The model doesn't push back unreasonably and learning your preferences
mid-session is fine.

### When Claude Code is wrong

It happens. Common failure modes on this project specifically:

- **Re-introducing AsyncLocalStorage** because it's the "Node-idiomatic"
  pattern. Cite §8.1.1 and the Verification Backlog Issue 5.
- **Treating Identity and Tenancy as two services** because the skeleton
  currently has them split. Cite Issue 1.
- **Adding business logic to `apps/api-gateway`** instead of the relevant
  service module. The gateway just boots and registers; logic lives in
  `services/*`.

## Step 6: When this chat-based work session ends

This package replaces the claude.ai chat workflow for the build phase.
Strategic conversations (vision, GTM, sprint planning at the macro level)
can continue in claude.ai; concrete code work happens in Claude Code.

The handoff is clean: Claude Code reads `CLAUDE.md`, `docs/reference/`,
`docs/adr/`, and `docs/handoff/` — everything it needs is in the repo.

## Troubleshooting

**`pnpm install` fails with "ERR_PNPM_PEER_DEP_ISSUES"** — Run with
`pnpm install --frozen-lockfile` exactly. If that still fails, your
pnpm version is wrong; check `pnpm --version` shows 9.12.0+.

**`pnpm run build` fails on a workspace** — Check that workspace's
`tsconfig.json` references the right dependencies. The pattern is in any
existing `services/*/tsconfig.json`.

**Tests fail with "Cannot find module"** — Run `pnpm run build` first.
Vitest in this monorepo depends on the compiled output of upstream packages
for some tests.

**Claude Code says it can't find a reference doc** — Did you complete Step
3? Confirm with `ls docs/reference/`. If files exist but Claude Code can't
find them, give it the explicit path: "Read `docs/reference/System_Architecture.md`."

**Claude Code wants to make many edits at once** — Stop it, ask for a
plan first, approve the plan, then let it execute. The model is faster
when scoped.
