# Reference documents

This is where the canonical specs live. Claude Code reads them on demand
through `CLAUDE.md` references and explicit prompts.

## What to put here

| Filename                         | Content                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `System_Architecture.md`         | Consolidated System Architecture v2 (the eleven components, data layer, isolation rules) |
| `UX_Specification.md`            | Consolidated UX Specification v2                                                         |
| `Sprint_Plan.md`                 | The sprint plan driving the build                                                        |
| `Session_Operating_Manual.md`    | How each work session should run                                                         |
| `Platform_Specification.md`      | Product capabilities and constraints (v2)                                                |
| `Strategic_Vision.md`            | The why (v4, optional for build sessions)                                                |
| `Admin_Console_Specification.md` | Admin console capabilities (Phase 7 reference)                                           |

## Why Markdown

Claude Code reads any text format, but Markdown is easiest to grep, edit,
and diff in version control. Convert your `.docx` originals to Markdown
once, keep the Markdown as the source of truth here.

Recommended conversion: Pandoc (`pandoc input.docx -o output.md`). Review
the output — Pandoc usually preserves structure but occasionally needs
header level adjustments.

## Keep the originals

If you want, also stash the .docx originals in `docs/reference/original/`
as a safety net. Git handles binary files for low-frequency changes fine.

## When the references change

When a new version of an architecture or spec doc lands:

1. Replace the corresponding `.md` file here.
2. Run a Claude Code session: "Read the new `docs/reference/System_Architecture.md`
   and compare against the current implementation. List any new gaps."
3. Update `docs/handoff/VERIFICATION_BACKLOG.md` with the findings.
4. Address gaps in the next corrective session.

This keeps the implementation honest against the spec without drifting.
