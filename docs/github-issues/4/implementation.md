# Issues 4 and 6: architecture skills

## Delivered scope

Three portable skills live in the top-level `skills/` directory:
`depthplan-audit`, `depthplan-map` and `depthplan-locate`. The README calls out each
skill and links installation, invocation and worked examples. Install the three
folders together; mapping and placement share the audit's source-reference format.
The skills do not change the MCP contract or dependencies. The requested CI
follow-up also fixes Windows subprocess setup and the native test harness below.

Auditing is a separate read-only phase with evidence/coverage and a mapping plan.
Mapping authors ordinary objects/content, explicit boundary chains and bookmarks
through MCP. Placement verifies source freshness and recommends existing or
explicitly proposed paths without modifying the repository or document/view.

Source evidence lives in ordinary JSON/rich content, including repository/revision
or explicit fixture identity, paths/symbols, file hashes, verified related terms,
relationship confidence and connection IDs. Refresh uses stable IDs and hashes of
previously published fields; user changes become preserved conflicts. No arbitrary
metadata API, custom database shape or persistent index is assumed.

## Acceptance evidence

| Requirement                           | Evidence                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installable skills and reviewed audit | Three validated `SKILL.md` entrypoints; `skills/README.md`; manually reviewed `map-plan.json` outputs and coverage table.                                                                                                                                                                                         |
| Nested architecture/schema            | Rails plan has 27 objects, three roots, request/domain/operations branches and a schema/table/column path. Six tables reconcile with the migration.                                                                                                                                                               |
| Framework conventions                 | Rails 8.0.0 static fixture covers resource/controller/view resolution without requires, Person/people, explicit `crm_members`, custom cactus/cacti, API acronym, Admin namespace, through/overridden associations, polymorphism, STI and unresolved constantize. Version-specific official references are linked. |
| No database                           | Three inspected pure-function modules; no persistence evidence and no schema objects. Hosting/deployment remain explicitly unknown.                                                                                                                                                                               |
| Traceability                          | Source files and hashes embedded in supported content; declared/convention-resolved/unresolved links stay distinct. No fabricated remote URLs or Git revisions for fixtures.                                                                                                                                      |
| Save/reopen and navigation            | Native MCP exercise applies and checks six Rails and two no-database bookmarks, target visibility and camera framing before and after save/reopen. Checks object content and bound connection endpoints/labels.                                                                                                   |
| Repeat run                            | Native exercise refreshes an unchanged generated name, preserves a user-edited managed name and all its other fields, retains an unrelated note/bookmark and stable object count, then saves/reopens again.                                                                                                       |
| Read-only placement                   | Native queries/search/chunks preserve an exact state snapshot, including revisions, camera, dirty state and selection. Hidden content and duplicate names are exercised.                                                                                                                                          |

## Validation and limits

Validation commands:

```sh
python /path/to/skill-creator/scripts/quick_validate.py skills/depthplan-audit
python /path/to/skill-creator/scripts/quick_validate.py skills/depthplan-map
python /path/to/skill-creator/scripts/quick_validate.py skills/depthplan-locate
node --test skills/examples/no-db/server.test.mjs
node scripts/skills-smoke.mjs
npm run check:local
```

The native exercise requires `npm run build:automation` first and uses only a
temporary application profile and folder grant. It prints saved example paths and
captures bookmark screenshots there; outputs are not checked into the repository.
Skill metadata validation needs Python/PyYAML. All 25 Ruby source files pass syntax
checking with Ruby 3.1.2; Rails is **not** booted. The reduced fixture omits Rails
boot/test scaffolding and is not a claim of application runtime compatibility.

The deterministic native exercise verifies reviewed worked plans and API behavior;
the source audit and placement answers were checked against the supplied source.
It does not certify behavior across every model/client. Stale/missing provenance,
moved/deleted paths, ambiguity and budget exhaustion are documented behavioral
exercises, not purported automated model-evaluation results.

The skills add no application startup/render/memory hot path. Retrieval has explicit
request/page/content budgets and reports partial coverage; the fixture exercise is
an optional developer validation command. Existing full local checks remain the
pre-submission gate; PR-triggered Test and CodeQL remain separate hosted evidence.
The CI follow-up addresses platform failures also present on the preceding MCP
search PR; no checks or security rules are relaxed.

## CI follow-up

Windows failed before native UI testing because a Rust process launched from
PowerShell 7 passed its `PSModulePath` to Windows PowerShell 5.1. `Get-Acl` then
failed to load `Microsoft.PowerShell.Security`. The helper now removes that
variable from its child environment, following Microsoft's
[intermediate-process guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.6#starting-windows-powershell-from-powershell-7).
An early Windows probe compiles the production Rust helper and tests both files
and directories, including rejection and repair of a foreign allow entry.
The subsequent Windows Clippy gate exposed an unused Unix socket helper; its
function and read-trait import now use the same Unix guard as its call site.
The standalone pipe helper starts within its existing deadline. In the app,
enabling it waited synchronously for an async task from an async command, blocking
the task that reports readiness. Enable/disable now runs on Tauri's blocking pool,
leaving the async runtime available. The early Windows probe covers pipe startup,
and the native UI test surfaces enable errors instead of a generic toggle timeout.

Ubuntu stalled before WebDriver started. CI now creates a D-Bus session after
Xvfb starts so activated desktop services inherit its display. This setup passes
the complete native smoke suite in an Ubuntu 24.04 container; hosted matrix
results provide the final runner-specific validation.

Native startup failures retain bounded subprocess output and report spawn errors,
exit codes and signals. Regression tests cover those diagnostics. UI actions wait
for React to render the current selection, and save-dependent clipboard tests wait
for file-operation cleanup as well as the saved revision. These changes preserve
the existing assertions and timeout limits.

Rollback removes the skill folders, README callout and optional validation script.
The CI follow-up can be reverted independently. No automatic installation, source
editing, continuous synchronization or production access is introduced by the skills.
