# Projects epic implementation

Delivered the remaining work in epic #9 on `feature/projects-epic`. The user
authorized the entire epic, both follow-ups, per-issue simplification review and
commits, and validation through passing CI. The three sample diagrams are
unchanged; `docs/sample/sample.depthproject` connects them after the feature work.

The approved behavior is in
[the UX specification](../../develop-feature/issue-11-project-ux/specification.md).
Use existing sessions, native project storage and form controls. No new runtime
dependencies or second document authority are needed.

| Issue   | Scope                                                 | Current evidence                                                                   |
| ------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| #10–#13 | Native documents, UX, project storage, board sessions | Closed on GitHub and included in base `c78bd1c`                                    |
| #14     | Drawer, tabs, board management                        | Local tests, native smoke and finish review passed                                 |
| #15     | Settings and home fallback                            | Local/native validation and finish review passed                                   |
| #16     | Autosave, conflicts, recovery                         | Local/native crash journey and finish review passed                                |
| #17     | Recent projects, native opening, local restoration    | Native three-board restore journey and finish review passed                        |
| #18     | Explicit MCP project/session targets                  | 505 Jest, native tests and complete bundled smoke passed                           |
| #19     | Integrated validation and documentation               | All nine hosted jobs, installed reports and visual review passed                   |
| #20     | Project-wide search                                   | 511 editor checks, native search, 100-board timing and finish review passed        |
| #21     | Stable board/bookmark links                           | 516 editor checks, 33 native tests, native link/back/copy and finish review passed |
| Samples | Connect all three unchanged diagrams                  | Manifest membership and native opening passed; diagrams unchanged                  |

Each issue received acceptance validation, a correctness pass, the requested
ponytail-review and a separate commit before the next issue. The full local gate
passed. The explicitly dispatched [feature Test workflow](https://github.com/TwistedPears/depthplan-diagram/actions/runs/36287387845)
passed all nine OS/suite jobs at `9697dc4`, including ordinary installed artifacts.
The sample manifest was added only after that result. Its focused tests and native
three-board opening check passed. Installed evidence retains its automated-host
scope; signing, notarization and physical input certification are outside this task.

Rollback is reverting the corresponding implementation commits. Project manifests
use version 1 alongside independent diagram version 2 files. No migration may
rewrite the curated diagram samples merely to connect them to a project.
