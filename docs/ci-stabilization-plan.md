# CI stabilization plan

Status: proposed, 2026-10-16. Based on every failed `Test` run from 2026-09-27 to 2026-10-16, including PR #51.

## What is failing

Of the last 50 `Test` runs on pull requests, 9 passed, 31 failed and 9 were cancelled. Every PR needs about 2 to 4 pushes before it goes green.

Almost every failure has the same cause. The source checks, unit tests, clippy, packaging and CodeQL jobs pass almost every time. The step that fails is **`Tauri native integration`** (`npm run smoke:ci` → `scripts/native-smoke.mjs`).

| Failure (first error)                                                                                        | Count | OS                     | Where                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ----- | ---------------------- | ------------------------------------------------------------------------------- |
| `Selection menu did not open`                                                                                | 8     | macOS ×7, Linux ARM ×1 | `native-selection-menu.mjs:60` `menu()`, usually right after `save()` or `Undo` |
| `elementFromPoint(...)` is `null`                                                                            | 4     | macOS ×3, Linux ×1     | `native-rotation.mjs:64` `pointer()`                                            |
| Bare `Timed out` (no context)                                                                                | 6     | all                    | `native-driver.mjs` `until()`, called from smoke, persistence, navigation       |
| `APP_UNAVAILABLE` / `BUSY` (`retryable: true`)                                                               | 3     | Windows, Linux         | MCP `state()`/`command()` helpers assert `ok` instead of retrying               |
| `no such window` at startup / `undefined.handle`                                                             | 2     | Windows                | relaunch on fixed port 4467 / MCP state read mid-transition                     |
| `null.kind` (save dialog)                                                                                    | 1     | macOS                  | `native-project-navigation.mjs` (fixed locally in `cd86e0a`, not pushed yet)    |
| Other single assertions (cursor `auto`, search `true !== false`, link button missing, installed screenshot)  | 4     | mixed                  | one-off waits on painting                                                       |
| Infra: rust-cache from a newer Ubuntu image → `glib` compile errors and `cargo-audit` `GLIBC_2.38 not found` | 1 run | Ubuntu 22.04           | fixed by `8d11118` (cache key per `matrix.os`)                                  |

The git history shows the same pattern. Since 2026-09-20 there have been **18 commits named "Wait for X…" / "test: await …"**, and each one patches a single race after a red PR. The next race then fails the next PR.

## Root causes

### 1. The suite is one long, fail-fast serial run, repeated on 4 OSes

`native-smoke.mjs` runs about 25 scenarios in sequence, mostly against one app instance and one profile. It takes 6 to 15 minutes per OS. The first flaky wait anywhere stops the whole job. It is a matrix of 4 independent coin flips: if each OS passes 75% of the time, the PR passes 0.75⁴ ≈ **32%**. That matches what we see. Nothing retries a scenario, nothing isolates scenarios from each other, and nothing records which scenarios flake. Every red run is a fresh investigation.

### 2. Tests wait on proxies instead of the app's real readiness

The tests send synthetic DOM events, then poll for a visible effect. The app **drops gestures silently** when it is not idle:

- `RecursiveCanvas.tsx` context-menu handler: `if (isBusy() || animating || dialog[open]) return;`
- `useEffect(() => setContext(null), [document, active, tool])` closes an open menu whenever the `document` object changes. A save that finishes late (metadata or recovery update) can close the menu before the 100 ms poll sees it. _Hypothesis, to confirm in phase 1._

`save()` in `native-selection-menu.mjs` waits for "Save button enabled and no Unsaved badge". That is a proxy, not the app's `busyReasons`. Commit `c5e307c` tightened this proxy and the same failure came back on the next run. The right-click lands while the app is still busy, gets ignored, and the test times out.

### 3. Pointer coordinates can fall outside the real viewport

`launchNative` asks for a 1280×900 window but never checks the size it actually gets. `native-rotation.mjs` notes that "hosted desktops may be shorter than the requested window size". When a handle lands off-screen, `document.elementFromPoint()` returns `null` and `pointer()` crashes with a JavaScript error, not a clear assertion.

### 4. MCP helpers treat retryable errors as failures

The app returns `{ ok:false, error:{ code:"BUSY" | "APP_UNAVAILABLE", retryable:true } }` during project transitions. The helpers in `native-authoring.mjs`, `native-expansion.mjs` and `native-project-mcp.mjs` run `assert.equal(result.ok, true)` and abort, even though the protocol says to retry.

### 5. Relaunches reuse a fixed WebDriver port

Every `launchNative()` uses port 4467. If `close()` sends SIGKILL, it resolves on a 2 s timer without waiting for the process to exit. The next launch can then poll `/status` against the dying instance (`no such window` on Windows).

### 6. Timeouts don't say what they were waiting for

`until()` makes 100 attempts with a 100 ms sleep between them. That is a count, not a deadline, so slow WebDriver round trips on macOS stretch it unpredictably. The default message is `Timed out`, with no scenario, no last value and no app state. Each failure needs a re-run with more logging, and that cycle is how the "wait for X" commits pile up.

### 7. PR gates fail on things the PR didn't change

`npm audit` and `cargo audit` run as blocking steps in every PR's `checks` job. A new upstream advisory turns every open PR red (see `e19c9f9` in PR #51). In the same way, the `release` suite packages and runs installed-app acceptance on all 4 OSes for every PR, even ones that don't touch packaging. It adds 4 more chances to fail and about 15 minutes of wall time.

## Plan

Work in this order. Each phase stands on its own and makes CI more reliable.

### Phase 0: Baseline (½ day)

1. Add a `soak` input to `workflow_dispatch` that runs only the `native` suite N times per OS (matrix `attempt: [1..5]`).
2. Make the smoke runner write `native-results.json` (scenario, status, duration, OS) and append a table to `$GITHUB_STEP_SUMMARY`.
3. Run the soak on `main` to get per-scenario, per-OS flake rates. These numbers measure every later phase.

### Phase 1: Fix the harness at the source (1 to 2 days, biggest win)

All changes in `scripts/native-driver.mjs`, so every scenario picks them up:

1. **Deadline-based `until(fn, { timeout, label })`**: use wall-clock time. The default is 10 s, scaled by `NATIVE_TIMEOUT_SCALE` (CI sets 2 on macOS). On timeout, throw with the label, the last returned value, and a snapshot of `automation:status` / `busyReasons`. This removes the bare `Timed out`.
2. **`driver.idle()`**: one helper that waits until the app reports `!busyReasons.length && !animating && no transition` and then two animation frames have run. Read this from the app's own state, not from button states. Call it automatically at the start of `click()`, `drag()` and a new shared `pointer()`. Then delete the per-scenario "wait for save cleanup / repaint / transition" code that this replaces.
3. **Shared `pointer()` / `drag()` that check their target**: if `elementFromPoint` is null, fail with the coordinates, `innerWidth`/`innerHeight` and the scenario name. Move rotation's private `pointer()` onto it.
4. **Check the window size after `window/rect`**: read back `innerWidth`/`innerHeight`. If the window is smaller than requested, either fail fast with a clear message or set a known zoom/camera so every scenario uses the same coordinate space.
5. **`mcpCall()` that retries `retryable: true` errors** within the same deadline, reusing the request ID as the protocol requires. Replace the local `state()`/`command()` helpers with it.
6. **Free port per launch**: bind port 0, read the port and pass it as `TAURI_WEBDRIVER_PORT`. `close()` waits for the `exit` event even after SIGKILL.
7. Gestures that open UI (`menu()`) assert the precondition (`idle()`) and then the result. **No blind retries**: if the app was idle and dropped the gesture, that's a product bug to fix, not a flake to hide.

Add unit tests for the new helpers in `scripts/native-driver.test.mjs`, which already uses a fake WebDriver server.

**Implemented (2026-10-16).** What shipped, and where it differs from the list above:

- `until` waits up to a 20 s deadline by default, not 10 s. The old version made 100 attempts, and with slow macOS round trips that often took longer than 10 s, so a 10 s deadline would have made some waits stricter. App startup gets 60 s, and the document and bridge get 30 s each. `NATIVE_TIMEOUT_SCALE` exists, but CI doesn't set it yet.
- The snapshot on timeout shows the viewport, the canvas busy/animating state, any open dialog, the focused element and `nativeErrors`. It doesn't include `busyReasons`, because there's no MCP probe at the driver level.
- `idle()` reads `window.depthplanCanvasState()`, a small read-only hook in `RecursiveCanvas.tsx`. It mirrors the guards the canvas uses to drop gestures. This was planned as phase 2.3, but it's needed to make `idle()` read real app state. **`idle()` is not called automatically from `click()`/`pointer()`**: text editing and in-progress gestures legitimately keep the canvas busy while tests click, so scenarios call it explicitly. It's used in `native-selection-menu.mjs` `menu()` now. Add it wherever a gesture assumes a quiet canvas.
- The window-size check warns when the viewport is under 1200×800 and records `driver.viewport`. It doesn't fail yet; the first CI runs will show what each host actually provides.
- `mcpCall`/`mcpState`/`mcpCommand` replace the copied helpers in 10 scenarios. Rotation, parent-drop, shift, expansion and connectors now use the shared `driver.pointer()`.

### Phase 2: Fix the product races the harness found (½ to 1 day)

1. Confirm whether saving changes the `document` reference after it completes. If it does, `setContext(null)` on `[document]` closes an open menu. Narrow that effect to a structural change of the selection (e.g. selected IDs no longer exist), not any `document` identity change.
2. When the canvas ignores a right-click because it is busy, queue it or give feedback. Real users hit the same dead click right after saving.
3. In automation builds only, expose `window.__depthplanTest.idle(): Promise<void>` so `driver.idle()` gets one clear readiness signal. The app already has `busyReasons`, so this is a small change.

### Phase 3: Restructure the suite (1 to 2 days)

1. Split `native-smoke.mjs` into a **scenario runner**: each scenario is `{ name, run(driver) }` with its own fresh profile and app launch. `templates` and `selectionMenu` already work this way. Scenarios that build on each other (crash → restore → save-as) stay together as one scenario.
2. The runner keeps going after a failure, captures `failure.png`/`failure.json` **per scenario**, and exits non-zero at the end. One red run then shows every broken scenario, not only the first.
3. **Retry a failed scenario once** in CI, and mark it `FLAKY` in the summary and the results artifact. The job still passes, but every flake is recorded. This is a safety net while phases 1 and 2 land, not the fix. Phase 5 makes it visible.
4. Optional: shard scenarios across 2 jobs per OS to halve wall time.

### Phase 4: Make PR gates match PR scope (½ day)

1. Move `npm audit` and `cargo audit` into a separate `supply-chain` job.
   - On PRs, it blocks only if `package-lock.json` or `Cargo.lock` changed, or if an advisory is `high`/`critical`.
   - A nightly scheduled run audits `main` and opens or updates one issue when something new appears.
2. Run the `release` suite on PRs only when packaging paths change (`src-tauri/tauri*.conf.json`, `flatpak/**`, `scripts/installed-acceptance.mjs`, `scripts/package*`, `.github/workflows/**`), and always on `main` and nightly. Add one aggregator job (`ci-result`, `needs: [...]`, `if: always()`) as the only required check, so skipped jobs never leave a PR stuck on "pending".
3. Add `${{ runner.os }}-${{ env.ImageOS }}-${{ env.ImageVersion }}` to the Rust cache key, and install `cargo-audit`/`cargo-about` with `taiki-e/install-action` (prebuilt binaries) instead of caching `~/.cargo/bin`. This stops the glibc mismatch from coming back when runner images change.

### Phase 5: Keep it fixed (ongoing)

1. A nightly **soak** (phase 0 workflow, 3 attempts per OS) posts flake rates per scenario. Any scenario above 1% gets an issue labelled `flaky-test`.
2. Rule for test PRs: a new wait must use `idle()`/`until(..., { label })`, and the commit message must name the app state it waits for. No new sleeps, no new bare `Timed out`.
3. Document the harness API (`idle`, `pointer`, `mcpCall`, scenario runner) in `docs/development.md`.

## Success criteria

- Nightly soak: every scenario at or below 1% flake on every OS for 2 weeks.
- At least 95% of PRs pass `Test` on the first push, over the next 20 PRs.
- No new "wait for X" commits without a phase-1 helper behind them.

## Immediate items for PR #51

- Push the local commit `cd86e0a`. It fixes the current macOS `null.kind` failure.
- The selection-menu flake will still come back until phase 1 (`idle()` before `menu()`) lands. If a re-run is needed to merge, re-run the failed jobs only.
