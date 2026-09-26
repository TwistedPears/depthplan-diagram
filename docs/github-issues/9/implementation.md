# Projects epic implementation

Implement the remaining work in epic #9 on `feature/projects-epic`. The user
authorized the entire epic, both follow-ups, per-issue simplification review and
commits, and validation through passing CI. Preserve the three sample diagrams;
add a connecting `docs/sample/sample.depthproject` after the feature work.

The approved behavior is in
[the UX specification](../../develop-feature/issue-11-project-ux/specification.md).
Use existing sessions, native project storage and form controls. No new runtime
dependencies or second document authority are needed.

| Issue   | Scope                                                 | Current evidence                                            |
| ------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| #10–#13 | Native documents, UX, project storage, board sessions | Closed on GitHub and included in base `c78bd1c`             |
| #14     | Drawer, tabs, board management                        | Local tests, native smoke and finish review passed          |
| #15     | Settings and home fallback                            | Local/native validation and finish review passed            |
| #16     | Autosave, conflicts, recovery                         | Local/native crash journey and finish review passed         |
| #17     | Recent projects, native opening, local restoration    | Native three-board restore journey and finish review passed |
| #18     | Explicit MCP project/session targets                  | Pending                                                     |
| #19     | Integrated validation and documentation               | Pending                                                     |
| #20     | Project-wide search                                   | Pending after core implementation                           |
| #21     | Stable board/bookmark links                           | Pending after core implementation                           |
| Samples | Connect all three unchanged diagrams                  | Pending after feature implementation                        |

For each issue, validate its acceptance criteria, perform a correctness pass and
the requested ponytail-review, fix findings, and commit before starting the next.
Final gates include `npm run check:local` and the real, explicitly dispatched
Test workflow (all nine OS/suite jobs); private skipped checks are insufficient.
Installed-platform checks must retain their actual evidence scope.

Rollback is reverting the corresponding implementation commits. Project manifests
use version 1 alongside independent diagram version 2 files. No migration may
rewrite the curated diagram samples merely to connect them to a project.
