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
repository change is part of this task. The final hosted outcome is recorded below.

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
Hosted execution and visual-review results are recorded below.

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
artifacts were required final epic gates. Broader release certification remains
outside this automated-host evidence.

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

## Installed Windows evidence review

The first Windows installed run passed file opening, but reviewing its registry
report found a literal `$` in the project-icon value and unquoted executable
paths. The NSIS post-install hook now writes exact quoted commands for both
extensions and the exact quoted project icon path. The installed probe compares
those complete values rather than accepting a substring. Quoting follows the
[NSIS string contract](https://nsis.sourceforge.io/Docs/Chapter4.html#4.1.1).

All four macOS installed screenshots showed the expected cold/warm project and
standalone state. The Windows screenshots showed the same states but exposed an
initial window extending below the desktop work area. The native builder now
uses Tauri's existing `prevent_overflow()` option. This changes initial fitting;
ordinary user resize remains native. Follow-up installed screenshots must prove
the taskbar no longer covers the bottom controls.

Correctness review checked both association classes, paths with spaces/Unicode,
exact registry values and all three create-window callers. Ponytail review:
**Lean already. Ship.** Native window fitting replaces any custom geometry code.

## Second hosted run corrections

Run `36283971394` exposed an early assertion in the macOS workspace probe:
restoration temporarily activates Board B before loading Board C. Its shared
active-tab query now waits for an enabled tab, preserving every tab/order/camera
assertion. The focused native journey passed at
`/var/folders/sp/nwpxh_hj7yj2bv625j6kjrlc0000gn/T/depthplan-tauri-smoke-631wZB`.

The Linux installed launcher opened Firefox. A disposable Ubuntu 24.04 container
reproduced `xdg-mime` falling back to `application/json` without
`libfile-mimeinfo-perl`; installing that desktop helper correctly identified both
extensions. CI now installs it and checks each file's detected MIME type. The
packaged desktop entry also lacked a file placeholder. One Tauri template adds
`%F` for DEB, RPM and the AppImage path that reuses DEB generation. Installed
acceptance validates the generated entry and exact command.

Windows registration checks passed with the corrected quoted paths. Its four
screenshots still showed clipping: sizing fit the work area, but Windows' default
placement offset the window below it. Native centering now accompanies fitting;
the installed check asserts the actual client rectangle is inside the monitor's
work area. No resize policy or custom window positioning code is introduced.

The macOS report passed, but its cold standalone screenshot showed the blank
canvas after a fixed three-second wait. That result is not accepted as a pass.
The probe now uses the built-in Vision text recognizer to wait for the expected
document title in each screenshot and retains recognized text in its report.
Local checks correctly distinguish the failing blank screenshot from the warm
standalone screenshot. The next hosted run must establish the cold-open result.

Correctness review traced all restoration waits, Linux MIME detection and all
Linux desktop-template consumers, and native work-area calculations. Ponytail
review: **Lean already. Ship.** Existing native APIs and one desktop template
cover the fixes without new application dependencies.

## Installed verification and Linux native ownership

Run `36285125807` passed all three ordinary installed jobs. All twelve retained
screenshots were inspected: both project identities and standalone content open
correctly, Windows controls fit above the taskbar, and macOS cold standalone
opening is confirmed by screenshot text as well as visual review. Source checks
passed on all three OSes, and macOS native integration passed.

Linux native integration aborted with allocator corruption during an existing
connector test, before reaching the project journeys. Tracing the native context
found a Linux Tao `Rc` counter cloned/dropped by Tauri worker handles. A disposable
Ubuntu reproduction using that actual target aborted with the same allocator
diagnostic (exit 134). Changing only that counter to `Arc` passed three identical
800,000-clone runs. The vendored package preserves its upstream files except for
that field, constructor and import; archive comparison verified all 119 files.
See [the dependency record](../../../src-tauri/vendor/README.md#linux-target-reference-counting).
CI and the Linux local gate now run the existing real-Tauri handle regression.
No dependency versions or unrelated lockfile edges change. The full matrix must
pass again before this work is complete.

Correctness review checked both window-ID collection users, handle cloning and
cleanup, the package diff and preserved display-handle lifetimes. Ponytail review:
**Lean already. Ship.** An atomic reference count fixes the ownership boundary;
no retry, longer timeout, disabled test or alternate runtime is needed.

The final window-placement build's fixed project scenario passed unchanged at
`out/project-capacity/run-wlwKr7/report.json`: cold max 1,018 ms, open max 219 ms,
switch p95 42 ms, host 116 MiB and WebKit 318 MiB. The preceding fresh-build run
`run-i8EPsY` exceeded the 2,000 ms cold budget once (2,319 ms; subsequent launches
861/840 ms), coinciding with macOS policy evaluation. That failure and its policy
trace remain retained, as do the earlier `run-2HZwnu` failure and `run-e27eGZ`
unchanged passing repeat. These results do not certify first-download admission
latency or broader installed performance. All budgets and repetitions are intact.

## Native startup readiness

Run `36286461360` at `deece9d` passed Linux source checks, the real-Tauri
800,000-clone regression, full Linux integration and Linux/macOS installed checks.
The macOS native job timed out on its first WebDriver script after a normal Quit
and relaunch, before project tests. No native crash or application exception was
reported. Twenty unchanged local Quit/relaunch cycles passed; the hosted timeout
was not reproduced locally.

Source inspection found that the driver's synchronous script implementation
stores a result in a page global, then polls it. Initial navigation can discard
that global. Startup now waits for the app's static page title through the
driver's single native evaluation before sending scripts. Existing readiness
conditions, deadlines and application checks stay intact. The new regression
fails against the previous driver when a script reaches the initial document,
and passes with the readiness check. Twenty real macOS Quit/relaunch cycles also
passed after the change (`depthplan-tauri-smoke-Xe2fcf`). No application behavior
changes.

Correctness review checked all native-driver consumers and the static document
title. Ponytail review: **Lean already. Ship.** One existing WebDriver read closes
the startup gap without sleeps, retries of failed journeys or timeout increases.

## Completed feature and sample follow-up

The [Test workflow at `9697dc4`](https://github.com/TwistedPears/depthplan-diagram/actions/runs/36287387845)
passed all nine jobs: source checks, native integration and ordinary installed
acceptance on macOS, Windows and Linux. This includes the native handle ownership
regressions and the corrected startup sequence. All three installed reports
identify that commit and pass all five phases. All twelve screenshots in
`out/ci/36287387845/installed-*/` were inspected with no material regression.
The fresh Impeccable reviewer also returned `ship` for the twelve installed
captures from run `36285125807`; subsequent dependency and test-driver corrections
do not change the interface. No new durable design-system decisions were needed.

Only after the complete feature workflow passed, `docs/sample/sample.depthproject`
was added with relative paths and the existing identities of all three samples.
The existing curated-sample suite now checks manifest validity, exact membership,
matching document identities, home board and the disabled autosave preference.
All five sample tests passed. A native check opened a copied sample folder,
visited all three boards, verified renderer titles and canonical source paths,
kept one canvas, closed cleanly and compared every file byte afterward. Screenshot
and profile evidence: `depthplan-samples-N1Dc1s`. The three maintained diagram
hashes still match base `c78bd1c`; their data was not edited.

Correctness review checked every member path and identity, folder portability,
the home board and untouched diagram bytes. Ponytail review: **Lean already. Ship.**
One manifest and the existing sample test suite cover the request.
