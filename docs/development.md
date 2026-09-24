# Development

## Prerequisites and build

Use Node.js 24 and npm 10 or later; the package also accepts Node 22.13+.
`.nvmrc` selects Node 24. Install Rust 1.94.1 with rustfmt and Clippy, the
[Tauri native prerequisites](https://v2.tauri.app/start/prerequisites/), and the
pinned license/audit tools:

```sh
cargo install cargo-about --version 0.9.2 --locked --features cli
cargo install cargo-audit --version 0.22.2 --locked
npm ci
npm run dev
```

Run commands from the repository root. Dependencies use public registries without
private credentials. Linux needs WebKitGTK 4.1, appindicator, librsvg and patchelf;
Windows needs the MSVC toolchain and WebView2. macOS needs an accepted Xcode license
and a working developer toolchain. When using Command Line Tools intentionally,
prefix native commands with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

| Command                            | Purpose                                           |
| ---------------------------------- | ------------------------------------------------- |
| `npm run dev`                      | Tauri development app with renderer hot reload    |
| `npm run build`                    | Ordinary release executables without installers   |
| `npm run package:dir`              | macOS application bundle                          |
| `npm run package`                  | Native installers for the host; does not publish  |
| `npm run icons`                    | Regenerate desktop icons from the canonical logo  |
| `npm run generate:contracts`       | Generate native MCP schemas and document fixtures |
| `npm run build:automation`         | Debug native build with explicit test automation  |
| `npm run build:automation:release` | Optimized native build with test automation       |

Tauri's build hooks generate the renderer, matching native MCP sidecar and bundled
license inventories. Outputs live under `src-tauri/target/release/` unless
`CARGO_TARGET_DIR` overrides it; installers are in `bundle/`. For another CPU,
install its Rust target and pass `--target` to Tauri; cross-compilation does not
validate native execution. `CI=true npm run package -- --ci` produces a macOS DMG
without Finder's cosmetic AppleScript layout step.

## Validation

Run relevant checks while editing and the full set before a release candidate:

```sh
npm run format:check
npm run format:rust:check
npm run lint
npm run typecheck
npm test -- --runInBand
npm run test:native
npm run build:automation
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
npm run smoke:ci
npm run build
node scripts/check-licenses.cjs
```

For Clippy without bundle resources, use
`TAURI_CONFIG='{"bundle":{"active":false,"externalBin":[],"resources":[]}}'`.
Linux smoke needs a display, or `xvfb-run --auto-servernum npm run smoke:ci`.
Automation uses disposable profiles/files and prints its evidence directory.
The suite covers real native persistence/recovery/MCP plus editor input. It does
not replace real-dialog, desktop-lifecycle or supported-client acceptance on the
[installed candidate](release.md#installed-application-checks).

Ordinary and automation builds can share an output path: rebuilding ordinary
release replaces the instrumented executable. Rebuild automation before running
native probes against it. To use a release-mode probe:

```sh
npm run build:automation:release
DEPTHPLAN_EXECUTABLE=src-tauri/target/release/depthplan npm run smoke:ci
DEPTHPLAN_EXECUTABLE=src-tauri/target/release/depthplan node scripts/native-png-test.mjs
```

The PNG probe checks transformed bounds, tiled output against a canvas reference,
wide full-resolution output and cancellation. Culling correctness requires native
pixels for overflow, rotated clips, transparency, crossing routes/labels/markers,
pan/zoom, offscreen numeric edits, Undo and canceled previews.

The `automation` feature adds WebDriver, native dialog queues, isolated profiles
and process inspection only to test builds. Normal executables must expose none
of them. Check `cargo tree --manifest-path src-tauri/Cargo.toml --locked -e normal`
for absence of `tauri-plugin-wdio`, then verify the actual packaged binary.
Development recovery uses `DepthPlan Development`, production uses `DepthPlan`,
and automation uses a temporary profile. Test-only profile overrides are not
ordinary release configuration.

The Test workflow runs formatting, lint, types, JavaScript/Rust tests, Clippy,
audits, native smoke and an ordinary build on macOS, Windows and Linux. A local
pass is not hosted CI completion. The Draft release workflow adds version-tag
validation and installer packaging; see [release](release.md).

## Dependency audits and notices

Run both ecosystems' audits. To retain machine-readable evidence while preserving
the failing command's status, run this block in Bash:

```bash
mkdir -p .tmp/security-audit
set -o pipefail
cargo audit --file src-tauri/Cargo.lock --json | tee .tmp/security-audit/cargo-audit.json
```

Record its status immediately; do not append `|| true`. Separately run `npm audit
--json`, saving output and exit status. Record source commit, lockfile hashes,
`rustc --version`, `cargo audit --version` and the audit JSON database revision.
Inspect both vulnerability entries and informational warnings. Exit zero alone
does not clear the [open Rust findings](release.md#open-dependency-findings).

Both CI workflows run the Rust JSON audit under Bash with pipeline failure
propagation and upload immediately with `if: always()`. Reports are named
`rust-audit-<matrix.os>` or `release-rust-audit-<matrix.os>` and stay visible after
later checks fail. Missing, empty or partial reports are missing evidence, not
clean results. Runner termination/artifact-service failure can still prevent
retention. No warning category is ignored or automatically accepted.

Resolve platform/feature applicability separately from the lockfile audit:

```bash
for target in aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do
  cargo tree --manifest-path src-tauri/Cargo.toml --locked --target "$target" -e normal > ".tmp/security-audit/$target.txt"
done
# Repeat with --features custom-protocol for ordinary bundled builds.
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target aarch64-apple-darwin -e normal -i unic-ucd-ident@0.9.0
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target x86_64-unknown-linux-gnu -e normal -i proc-macro-error@1.0.4
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target x86_64-unknown-linux-gnu -e normal -i glib@0.18.5
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target x86_64-unknown-linux-gnu -e normal --features automation,custom-protocol -i glib@0.21.5
```

Repeat with `-e normal,build` for build-only dependencies; normal edges already
include procedural macros. Use `--offline` only after sources are cached. For
GLib reachability investigation, obtain resolved package/version pairs with
`--prefix none --format '{p}'`, locate each package's source, and search
`VariantStrIter|array_iter_str` in all its Rust files and `src-tauri/src`. Record
missing sources and inspect generated code/target execution separately. A literal
source search does not prove unreachability.

Vite inventories actual bundled JavaScript modules. `scripts/check-licenses.cjs`
requires their full license texts and uses cargo-about against Cargo.lock with
[src-tauri/about.toml](../src-tauri/about.toml). Missing/unresolved licensing fails
the build. Regenerate after dependency changes and review upstream NOTICE/COPYRIGHT
obligations; an automated license pass is not a legal compatibility determination.

Bundles must contain `licenses/JAVASCRIPT-LICENSES.json`, `licenses/RUST-LICENSES.json`,
LICENSE, THIRD-PARTY-NOTICES.md and COMMERCIAL-TERMS.md. On macOS inspect
`DepthPlan.app/Contents/Resources/`. JavaScript notices are also embedded with the
frontend. Generated inventories stay ignored; retained components keep their
required notices.

## Capacity

Run timing suites sequentially without concurrent builds/tests:

```sh
npm run build:automation:release
npm run capacity
npm run capacity -- dense large
```

The complete runner uses that release-mode automation executable and measures eight deterministic
`capacity-v1` workloads: small, dense, reveal-all, sparse, deep, text-heavy,
many-layout and large. The current process-memory instrumentation is macOS-specific;
other platforms need equivalent native measurement before support claims.
See [measure-tauri-capacity.mjs](../scripts/measure-tauri-capacity.mjs) for fixture
settings, timing definitions and correctness checks.

| Metric                                                                                              | Required budget |
| --------------------------------------------------------------------------------------------------- | --------------- |
| Pan/zoom input-to-paint p95                                                                         | 200 ms          |
| Accepted edits, depth reveal/collapse, Undo/Redo, history, save/recovery preparation and soak edits | 250 ms          |
| Warm Open, Save and recovery Restore                                                                | 1,000 ms        |
| Checkpoint acknowledgment                                                                           | 2,000 ms        |
| Compact whole SVG/PNG exports                                                                       | 1,500 ms        |
| Host peak RSS                                                                                       | 350 MiB         |
| Combined WebKit WebContent/GPU/network peak RSS                                                     | 1,536 MiB       |

Sparse/large whole exports have no timing cap but must complete at full resolution.
The matrix uses a 1280×900 viewport, six Opens (one cold-process, five warm), five
pan/zoom samples, 100 history edits, five saves and three crash/restore cycles per
workload. Dense also runs a focused 120-second edit soak. Preserve workload sizes,
repetitions, correctness checks and budgets when comparing a change.

Button measurements cover DOM click through two animation frames; pan additionally
includes driver transport. They are not hardware-input or complete-animation
duration measurements. Nearest-rank p95 with small samples is descriptive. RSS is
sampled every 200 ms and at phases: shared pages may be counted twice and shorter
peaks missed. Five-second idle CPU uses 100% for one core. Record source, binary,
lockfile and harness hashes, OS/WebView/CPU/RAM/display data and raw observations.

`capacity:diagnostic` is a smaller diagnostic, not a substitute for this matrix.
Neither instrumented suite certifies the uninstrumented installed app or an
unlimited document size. Fresh candidates need appropriate measurements and
[installed performance acceptance](release.md#installed-application-checks).
Store run output/CI artifacts outside tracked docs; retain failures alongside the
candidate's results, not as permanent public documentation or reduced budgets.

## Samples and generated stress documents

The three [curated samples](sample/README.md) are readable feature examples.
`npm test -- --runInBand curatedSamples` checks their exact schema/visibility,
bookmarks, rich content, repairs and movement. Native conformance generation and
smoke also read these files; preserve their paths.

Generate stress files on demand:

```sh
npm run stress -- --presets
npm run stress -- --preset large --seed my-run
npm run stress -- --preset sparse --seed viewport-test --settings '{"roots":80,"textCharacters":200,"depthMode":"all"}'
node scripts/smoke-stress.mjs
```

The same seed, settings and generator version produce identical document bytes,
IDs and timestamps. Presets cover small, large, sparse, dense, deep and reveal-all;
`--presets` is the authoritative settings list. Maximum depth counts descendants
with roots at zero. Mixed depth uses root index modulo depth+1; all reveals every
generation. The deep preset contains two 128-generation chains.

Each run owns `out/stress-runs/run-*`, validates written bytes and removes its
`document.depthplan` on success. `run.json` and `result.json` retain settings,
counts and reproduction information; failed fixtures remain for investigation.
`npm run stress -- --cleanup run-XXXXXX` removes only that owned document and
rejects redirected directories. It does not delete unrelated files. Keep generated
fixtures and run records out of the repository's release documentation.
