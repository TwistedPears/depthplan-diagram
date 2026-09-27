# Issue #19 — integrated acceptance

Complete the core integration gate using disposable projects and existing native
journeys. Add a fixed 100-board release-mode scenario (three cold starts, five
opened boards, 60 switches) against the existing 250 ms interaction / 1,000 ms
warm-open budgets, a 2,000 ms cold-project budget, and existing 350 MiB host /
1,536 MiB WebKit RSS ceilings. Keep one canvas mounted and unopened content lazy.

CI must install ordinary artifacts and exercise native file association launches
on macOS, Windows and Linux. Retain artifact hashes, OS details, workspace state
and screenshots. Isolate association changes to disposable CI hosts; do not alter
the user's production registrations. Distinguish this automated-host evidence
from broader release certification (signing, physical input, supported clients).

Update user/technical project documentation and reconcile the integrated failure,
portability, recovery and compact-layout evidence. No production release or public
repository change is part of this task. Hosted evidence remains pending until the
final epic workflow actually passes.

## Delivered

Project opening now inspects membership paths without parsing unopened boards.
Content is validated on demand. Existing atomic writes now honor read-only files,
including a permission change during a write. Empty projects retain the existing
MCP controls and access discovery, disable Save All without a board, and keep
empty-state instructions clear of the drawer at compact widths.

The installed acceptance harness packages and installs ordinary DMG, NSIS and DEB
artifacts on disposable CI hosts. It checks both file registrations, distinct
project icons, cold/warm opens, single-instance reuse, native close, unchanged
fixtures, and the bundled MCP adapter without global Node. It retains binary and
installer hashes, platform metadata, workspace acknowledgements and screenshots.
This harness has not yet run on hosted CI; no installed-platform pass is claimed.

## Local evidence

- 506 Jest tests in 63 suites; all 32 native tests; type check, ESLint, Prettier,
  Rust formatting and strict application Clippy passed.
- Complete rebuilt native smoke passed, including the three-board working day,
  independent cameras/tabs, copy/move/missing-member recovery, autosave/conflicts,
  native opens, 28-tool MCP routing and standalone regression journeys.
  Evidence: `/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-hKdeBg`.
- Six empty-project menu/details captures inspected at 1440×1000, 1024×728 and
  900×640 in that evidence directory. Existing dialog body scrolling retains the
  footer and close controls. Fresh finish review is recorded below.
- Fixed 100-board release scenario passed three cold starts, five open owners and
  60 switches per launch: cold max 986 ms, open max 223 ms, switch p95 39 ms,
  host peak 117 MiB, attributed WebKit peak 373 MiB. One canvas, only four
  additional explicit board reads per launch, no reads during switches, and
  unchanged source hashes were asserted. Raw report:
  `out/project-capacity/run-3YI2pM/report.json`. The final epic candidate will rerun
  this scenario and the full existing editor capacity gate.

Correctness review traced the shared atomic-write callers, permission-change
boundary, lazy member diagnostics, global MCP routing without an active owner,
and installed-host isolation. The permission regression proves old bytes survive.
The documenter found no durable design-system changes. The requested
ponytail-review found no further cuts: **Lean already. Ship.** Existing controls,
modal layout, platform tools and sequential probes cover the scope without new
runtime dependencies or a search/index service.

Full local readiness, hosted nine-job CI and visual review of the installed
artifacts remain final epic gates, including explicit reports for any unavailable
platform or broader release certification checks.

Fresh Impeccable review initially returned `fix` for modal return focus. The empty
project menu now focuses its summary before opening MCP Details. A rebuilt native
probe asserts focus returns to `Project menu` after Close; all six recaptures in
`/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-R9SeKy`
were reviewed. Final verdict: `ship`; no new design-system decisions.

## First hosted run and Linux harness correction

Run `36282974909` at `9782070` passed all three source-check jobs, Linux native
integration and macOS ordinary installed acceptance while other jobs continued.
The Linux installed phase stalled. Review found two Linux-specific assumptions:
`ps comm` returns the executable basename, and generic `xdg-open` may wait for the
application to exit. The probe now checks `/proc/<pid>/exe` for the exact installed
binary and observes an independently spawned opener with ignored stdio. The
installed workflow phase has a five-minute bound. No application behavior or
performance budgets change; Linux installed success still requires the next run.

Correctness review checked spawn errors, bounded process detection, exact binary
identity and unchanged macOS/Windows paths. Ponytail review: **Lean already. Ship.**
Readiness lesson: test OS-specific installer helpers against native process and
launcher semantics, and bound the installed phase rather than only the whole job.
