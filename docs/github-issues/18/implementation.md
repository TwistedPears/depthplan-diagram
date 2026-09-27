# Issue #18 — explicit MCP board sessions

The workspace owns one automation listener. Explicit document handles route to
the existing owner registry; optional read handles resolve the active owner at
acceptance. `depthplan_get_project` pages project/member metadata, while
`depthplan_open_board` opens or activates an existing member with native reads and
folder grants. Both tools are exposed by the generated, bundled native MCP server.

File operations and decisions retain their captured owner across tab changes.
Receipts include that original target. Bounded workspace caches preserve accepted
request replay and the latest 64 workflow readers across owner closure; new
commands against a closed/replaced handle fail. Persistent project/member IDs
remain separate from app, project-session and document-session handles.

Project source save/reload uses the existing native project writer plus MCP leases
and approved folders, with grant checks repeated before publication. Save As and
conflict copies get a new identity without adopting their path or clearing source
dirty state. Standalone New/Open and recovery Restore require leaving project
mode. Canvas export requires the board to be active; JSON export can read a hidden
owner. Native project locks retain their existing protection of the entire folder,
so independent copy/export destinations must be outside an open project folder.

The full regression also exposed an OS-open queue race: a rerender could try to
reuse a request just released natively. The queue now claims its next ID from an
authoritative ref before awaiting I/O. A regression forces that release/rerender
interleaving. Older smoke assertions were updated for #17's canonical-project
reuse and now verify opened source identity through MCP instead of transient text.

Validation:

- Typecheck, ESLint and strict native Clippy passed.
- 31 native tests passed, including a denied final write permission that leaves
  prior board bytes intact.
- Targeted React tests prove same-name routing, inactive edits, delayed decisions,
  source save, copy identity/dirty state, project reload, receipt replay after
  closure, stale reopened handles and the OS-open race.
- The actual bundled MCP journey passed in
  `/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-X9ZFu9`.
  It checks both files on disk, refused ungranted reads, explicit inactive edits,
  tab switching during overwrite consent, JSON export, inactive image rejection,
  revocation, stale handles and receipts. It is part of `npm run smoke`.
- Complete Jest: 505 tests across 63 suites passed.
- Complete native smoke passed at
  `/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-Zc45Nv`,
  including legacy authoring, files, image export, project navigation/settings,
  persistence/crash recovery, workspace restore and all 28 tool schemas.
- Final registry guards consult the workflow's live ref, so an immediate tab/close
  action cannot race React's render of a newly started export; covered in the
  multi-board React regression.

Correctness review traced all file write callers, handle/session replacement,
async opening, grant revocation, close guards and receipt expiration. Opening an
already loaded board rechecks its MCP lease after local workspace persistence.
No new persistence implementation or runtime dependency was added.

Ponytail review: removed the obsolete per-board listener activation option and
redundant copy-ID generation. One workspace router reuses existing owner handlers
and workflow receipts. The bounded receipt-reader retention is marked with its
memory ceiling and upgrade condition. Remaining diff: Lean already. Ship.
