# Native dependency patches

## GLib security backport

`glib-0.18.5/` is the complete crates.io package, including its MIT license.
The archive SHA-256 is
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`;
its upstream commit is `42b9caf98e03ded086362d9653ca58fe94dc8658`.

The only change to that package is the two-line fix from
[gtk-rs-core PR #1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343):
`VariantStrIter::impl_get` declares `p` mutable and passes `&mut p` to
`g_variant_get_child`. This remedies
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
([Dependabot alert #1](https://github.com/TwistedPears/depthplan-diagram/security/dependabot/1)).
The version stays 0.18.5; it is not an upstream fixed release.

Tauri's GTK 0.18 dependency cannot use the fixed GLib 0.20+ API. The Cargo patch
replaces every 0.18.5 consumer without changing those APIs or touching the registry
cache. Keep the original crate files intact apart from the documented fix.

On Linux, `npm run test:native` runs the application tests in release mode,
including `glib_regression::variant_str_iter`. It checks forward/reverse iteration,
`nth`, `nth_back`, `last`, empty strings, Unicode and exhaustion. To run only it
after `npm run generate:contracts`:

```sh
TAURI_CONFIG='{"bundle":{"active":false,"externalBin":[],"resources":[]}}' \
  cargo test --manifest-path src-tauri/Cargo.toml --locked --release --lib glib_regression
```

Confirm the actual application graph with:

```sh
cargo tree --manifest-path src-tauri/Cargo.toml --locked \
  --target x86_64-unknown-linux-gnu -i glib@0.18.5
```

Cargo audit and Dependabot may omit local path dependencies; a disappearing alert
is not validation of the patch. Retain source comparison, regression, build and
license evidence. No advisory suppression is added.

Remove this directory and the Cargo patch when a compatible published dependency
chain supplies the upstream fix. Keep the regression while the GLib 0.18 API is in
use, and update the release dependency findings at that time.

## Tauri Windows runtime ownership

`tauri-runtime-wry-2.11.4/` is the complete crates.io package with its MIT and
Apache licenses. Archive SHA-256:
`4e6fac707727b7a2f48e4ded90976324267371073edbb415ffb73bb0458d203f`;
upstream commit: `ca90b46b2e2cbbc981dae1b809f4af4343fe0558`.
Only `src/lib.rs` is changed. The version stays 2.11.4.

On Windows, cloning/dropping Tauri handles on worker threads also touches Tao's
non-atomic event-loop `Rc`, causing heap corruption (exit `0xc0000374`):
[Tauri #15408](https://github.com/tauri-apps/tauri/issues/15408) and
[#15793](https://github.com/tauri-apps/tauri/issues/15793).
The patch follows the ownership approach in
[PR #15411](https://github.com/tauri-apps/tauri/pull/15411), inspected at commit
`2d51238d2597fcb677fd52b7179e5fbee25fd75f`; it is a local adaptation, not a
released upstream fix.

On Windows, `Wry` owns an `Arc` to the target and dispatch contexts carry only
`Weak` references. Only the main-thread dispatch path upgrades a reference;
it reports `EventLoopClosed` after the owner has gone. Runtime monitor getters
use the existing event-loop message path, while `Wry` accesses its own event loop.
The Windows display handle contains no borrowed state, so it uses the safe
`DisplayHandle::windows()` constructor. Other platforms retain their original
target ownership and borrowed display handles. No lifetime extension or new
unsafe block is used, and off-thread handles cannot become the final target owner.

`examples/runtime_handle_stress.rs` clones/drops handles 800,000 times across eight
threads without WebViews, then checks a surviving handle after dropping the app.
Windows CI, release validation and `check:local` run it:

```sh
TAURI_CONFIG='{"bundle":{"active":false,"externalBin":[],"resources":[]}}' \
  cargo run --manifest-path src-tauri/Cargo.toml --locked --example runtime_handle_stress
```

The application's `build.rs` also embeds Common Controls v6 in examples, which
Tauri's normal binary resource handling does not cover. Without it, the Windows
loader exits before this regression runs ([Tauri #11028](https://github.com/tauri-apps/tauri/issues/11028)).

The native integration suite also requires a clean process exit after authoring.
Keep both checks. Remove this crate and its Cargo patch when a compatible
published Tauri runtime passes them without the patch. Review upstream changes
before updating Tauri; Cargo audit does not establish the safety of a path patch.
