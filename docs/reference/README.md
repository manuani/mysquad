# Reference documents

This is where the canonical specs live. Claude Code reads them on demand
through `CLAUDE.md` references and explicit prompts.

## What is here

| Markdown                         | Source `.docx`                              | Content                                                                |
| -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `System_Architecture.md`         | `VirtualOfficeAI_04_SystemArchitecture_v2`  | The eleven components, data layer, isolation rules                     |
| `UX_Specification.md`            | `VirtualOfficeAI_05_UXSpecification_v2`     | Product surfaces and flows                                             |
| `Sprint_Plan.md`                 | `VirtualOfficeAI_07_SprintPlan`             | The deliverable breakdown driving the build                            |
| `Session_Operating_Manual.md`    | `VirtualOfficeAI_08_SessionOperatingManual` | How each work session should run                                       |
| `Platform_Specification.md`      | `VirtualOfficeAI_03_PlatformSpecification_v2` | Product capabilities and constraints                                 |
| `Strategic_Vision.md`            | `VirtualOfficeAI_02_StrategicVision_v4`     | The why; rarely needed for build decisions                             |
| `Admin_Console_Specification.md` | `VirtualOfficeAI_06_AdminConsoleSpecification` | Admin console capabilities (Phase 7 reference)                      |
| `Versioning_Ledger.md`           | `VirtualOfficeAI_01_VersioningLedger`       | Document version history                                               |
| `GTM_Strategy.md`                | `VirtualOfficeAI_09_GTMStrategy`            | Go-to-market; not a build input                                        |

## Why Markdown

Claude Code reads any text format, but Markdown is easiest to grep, edit, and
diff in version control — `CLAUDE.md` points sessions at these files by name.

The `.docx` files above are the authored originals and remain the editable
source. The Markdown is generated from them and should not be hand-edited: any
correction made here is lost on the next conversion.

**The generated `.md` files are gitignored and must be produced locally.** This
repository is public, and these specs carry internal strategy — hiring plans,
design partners, positioning. The `.docx` originals are already committed, but
Markdown is indexed by GitHub code search and by search engines in a way binary
attachments are not, so checking in the rendered text would meaningfully widen
who finds it. Generate them after cloning:

```bash
pip install python-docx
python3 scripts/convert-reference-docs.py
```

## Regenerating after a spec changes

When a new version of a doc lands, replace the `.docx` and regenerate:

```bash
python3 scripts/convert-reference-docs.py
```

Then run a session: "Read the updated `docs/reference/System_Architecture.md`
and compare against the current implementation. List any new gaps." Record
findings in `docs/handoff/VERIFICATION_BACKLOG.md` and address them in a
corrective session.

Where the build knowingly diverges from a spec, the divergence belongs in an
ADR rather than an edit to the spec — see `docs/adr/013-*` for the voice
pipeline, which departs from Architecture §5.4–5.6 deliberately.

