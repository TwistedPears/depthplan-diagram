# GLib security backport

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
