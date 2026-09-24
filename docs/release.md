# Release requirements

**DepthPlan is unreleased. Production acceptance, security/support policy and
release platform approval remain pending.** This checklist defines work for the
chosen candidate; it is not a record of historical runs or approval to publish.
Repeatable commands and measurement budgets live in [development](development.md).

## Candidate checklist

- [ ] Approve supported OS versions/architectures. Apple Silicon is the first
      macOS target; Windows x64, Ubuntu x64 and Intel Mac need separate native
      acceptance. Align CI and documentation with the approved scope.
- [ ] Record the source commit, lockfile hashes, app/installer SHA-256,
      OS/WebView versions, CPU/RAM/display scale and actual MCP client version.
- [ ] Pass formatting, lint, typecheck, JavaScript/Rust tests, Clippy, audits,
      license checks, native smoke and ordinary build for that source.
- [ ] Run hosted CI successfully for declared targets and retain its artifacts.
      Ensure runner/billing availability; local results do not clear a blocked run.
- [ ] Complete every installed-application group below on the exact ordinary
      candidate, including representative input-to-paint and process memory checks.
- [ ] Re-run applicable capacity workloads and repeats without reducing budgets,
      fixtures, repetitions, resolution or correctness checks. Preserve candidate
      failures until resolved; older runs cannot approve a new candidate.
- [ ] Resolve or explicitly disposition every applicable dependency finding below.
- [ ] Approve and verify reporting/support, release location and publisher identity.
- [ ] Verify signing/notarization where applicable, installation, direct desktop
      launch, upgrade/manual replacement and removal of the distributed files.
- [ ] Verify icons, notices, current-format compatibility and final repository links,
      including package metadata, Help links and sample content in the clean copy.

Keep raw candidate results in CI/release records or private working storage rather
than checked-in historical docs. Removing old reports does not waive any gate.

## Installed application checks

Install from the actual native installer into a disposable location with spaces
and non-ASCII characters. Keep source backups and use disposable documents.
Record pass/fail observations and failures for each group:

1. **Files:** New/Open/Reload/Save/Save As, canceled dialogs, external-edit conflicts,
   overwrite consent, unsupported/malformed documents and atomic-write failures.
2. **Guards/lifecycle:** draft apply/discard/cancel, accepted unsaved work through
   Save/Discard/Cancel, document replacement, window close and application quit.
3. **Editing:** rich text/code, clipboard, text versus diagram shortcuts,
   geometry/stacking, child disclosure/history/auto-arrange, sibling containment,
   connector/boundary gestures, structural repairs and search.
4. **Bookmarks:** mixed-depth capture, branch folds, viewport-size camera focus,
   apply/reset/rename/duplicate/delete/reopen/Undo and busy-state rejection.
5. **Culling:** compare against an unculled pixel reference for overflow, rotated
   clipping, transparent ancestors, crossing routes, edge markers/labels, pan/zoom,
   offscreen numeric edits, Undo and canceled previews.
6. **Export:** whole/selection SVG/PNG, offscreen content, wide tiled output,
   visible/hidden membership, clipping, cancellation and delivery errors.
7. **Recovery:** actual WebView termination/unresponsiveness, native restart,
   preview/cancel/restore/discard, checkpoint cleanup and restored equality.
8. **MCP:** actual supported client with the installed adapter; live edits/Undo/Save,
   grants and boundary rejection, revoke/disable/reconnect/restart, stale descriptor/
   session/revision handling, busy/cancel and identical retries.
9. **Distribution:** launch without global Node; inspect bundled notices, private
   socket/pipe permissions and absence of WebDriver/test commands. Verify the
   expected publisher, version and artifact hashes.
10. **Performance:** representative real input and host/WebView/GPU/network/adapter
    memory on the uninstrumented app against the unchanged development budgets.
    Instrumented timings do not measure physical input latency or certify all hosts.

On macOS, launch the copied app after ejecting the DMG, test dock reopen and native
shortcuts, and verify the intended signing/notarization outcome. On Windows, test
WebView2 provisioning, installed NSIS launch, current-user pipe ACLs, network-logon
denial and uninstall. On Linux, record distribution, desktop/display session and
WebKitGTK version; test direct AppImage launch and private transport. Xvfb or
extracted AppImage execution alone does not establish desktop acceptance.

## Open dependency findings

The locked application graph retains these seven unresolved Rust warnings.
Maintenance warnings and GLib unsoundness are distinct from vulnerability entries;
a successful audit exit does not accept them. Recheck the lockfile and RustSec
for every candidate using the [audit procedure](development.md#dependency-audits-and-notices).

| Advisory                                                                   | Affected locked package  | Platform/stage                                                      | Status                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) | proc-macro-error 1.0.4   | Linux-target macro compilation                                      | Unmaintained; both GTK macro consumers need an upstream change.                                              |
| [RUSTSEC-2025-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html) | unic-char-property 0.9.0 | All target OS families, runtime and compiler macro dependency paths | Unmaintained; blocked by the URLPattern constraint.                                                          |
| [RUSTSEC-2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html) | unic-char-range 0.9.0    | All target OS families, runtime and compiler macro dependency paths | Unmaintained; blocked by the URLPattern constraint.                                                          |
| [RUSTSEC-2025-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html) | unic-common 0.9.0        | All target OS families, runtime and compiler macro dependency paths | Unmaintained; blocked by the URLPattern constraint.                                                          |
| [RUSTSEC-2025-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html) | unic-ucd-ident 0.9.0     | All target OS families, runtime and compiler macro dependency paths | Unmaintained; blocked by the URLPattern constraint.                                                          |
| [RUSTSEC-2025-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html) | unic-ucd-version 0.9.0   | All target OS families, runtime and compiler macro dependency paths | Unmaintained; blocked by the URLPattern constraint.                                                          |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) | glib 0.18.5              | Linux application runtime dependency                                | Unsound string iterator; fixed from 0.20, outside the current constraint. App reachability remains unproven. |

Representative paths from DepthPlan's [Cargo lockfile](../src-tauri/Cargo.lock):

- `tauri 2.11.6 → tauri-utils 2.9.3 → urlpattern 0.3.0 → unic-ucd-ident 0.9.0`.
  The last crate depends on `unic-char-property`, `unic-char-range` and
  `unic-ucd-version`; property also uses range, and version uses `unic-common`.
  The compiler path is `tauri → tauri-macros 2.6.3 → tauri-codegen 2.6.3 → tauri-utils`
  and the same Unicode family.
- `tauri 2.11.6 → gtk 0.18.2 → glib 0.18.5` on Linux, with other routes through
  Tauri runtime, Tao, Wry, Muda and WebKitGTK. macOS/Windows ordinary graphs do not
  include this affected GLib/GTK macro chain.
- `gtk 0.18.2 → glib 0.18.5 → glib-macros 0.18.5 → proc-macro-error 1.0.4` and
  `gtk 0.18.2 → gtk3-macros 0.18.2 → proc-macro-error 1.0.4`.

The six maintenance findings establish maintenance risk, not a demonstrated
DepthPlan exploit. Preserve the distinction between runtime dependency presence
and confirmed application calls.

### Compatible remedies and investigation limits

**Unicode:** the resolved tauri-utils line requires `urlpattern ^0.3`, whose UNIC
dependency remains affected. URLPattern 0.6 uses ICU but is outside that range.
A compatible released Tauri integration must adopt and test the newer parser,
including remote capability URL matching, default path/query/hash behavior and
Unicode identifier semantics. Compile success alone is insufficient for an access
control dependency. Verify the full locked graph against Rust 1.94.1 when such an
integration exists; the URLPattern edition alone does not prove toolchain support.

**GLib:** GTK 0.18 requires `glib ^0.18`; the affected resolved copy is 0.18.5.
Automation additionally includes GLib 0.21.5 through its WebDriver dependency;
that newer copy does not remove the application copy. GTK 0.19 / GLib 0.22 provide
a newer upstream family, but Tauri's GTK `^0.18` constraint prevents a compatible
lockfile-only replacement. The framework/Linux integration must move together.

In GLib 0.18.5, `Variant::array_iter_str` constructs `VariantStrIter`; iterator
methods reach `impl_get`, which passes an immutable pointer reference as a mutable
C out-argument. This is the confirmed upstream defect. A bounded literal search
of resolved Linux normal-dependency Rust sources found implementation/tests but
no DepthPlan or downstream caller. That does **not** prove unreachability: generated
code, build-only packages, native code and target execution remain outside that
search. Further investigation needs a Linux release build, generated-code analysis
and runtime coverage of dialogs, menus, clipboard, WebKit and lifecycle.

**Macro maintenance:** both glib-macros and gtk3-macros must stop depending on
proc-macro-error. Fixing one leaves the other. Newer GTK/GLib macro lines remove
it but are outside current constraints; a compatible released backport to both
consumers or released framework integration is required.

No compatible released fix is established for this graph. Do not force upgrades
with local forks, aliases, patches or prereleases as part of routine dependency
refresh. A release owner must choose to defer release or explicitly disposition
remaining risk for the declared platform scope. No advisory ignore or blanket
acceptance is implied. Dependency changes require the complete build/test/audit/
license/native/capacity validation applicable to the resulting candidate.

### Advisory decision format

Keep one decision per advisory with candidate evidence, outside permanent product
docs. Update the open findings here when the actual shipped graph/status changes.

```text
Advisory ID and authoritative source:
Candidate commit / lockfile hashes / decision date:
Audit-tool version / database revision / machine-readable report:
Affected versions / full dependency paths / platforms / runtime-build-test stage:
Confirmed exposure and bounded search/test evidence; remaining uncertainty:
Released remedy and compatibility blocker:
Status: unresolved | fixed | not applicable to declared scope | temporarily accepted
Rationale, validation and pending platform/hosted checks:
Responsible owner and explicit approval reference for acceptance/scope exclusion:
Verified mitigation or user guidance:
Review date / acceptance expiry / upstream or scope recheck triggers:
Next action and owner:
```

“Fixed” requires removal/remedy of the affected shipped copy, not adding an
unaffected second version. Scope exclusion needs evidence and an approved scope.
Temporary acceptance needs rationale, expiration and review triggers. None is
inferred from an informational label, audit exit zero or upstream waiver.

## Security and support proposal

**These choices are proposals, not active promises.** The owner must approve the
contact, maintainers, platforms, response expectations, release location and
signing identity before [SECURITY.md](../SECURITY.md) becomes an active policy.

| Topic              | Proposed choice                                                                                                           | Owner decision required                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Reporting          | GitHub private vulnerability reporting on the chosen public release repository, or a dedicated monitored security mailbox | Exact route; do not assume the current private repository supplies a public reporting channel |
| Maintainers        | Primary security maintainer and backup                                                                                    | Named people, coverage and private-report permissions                                         |
| Versions           | Latest stable release only; older versions upgrade rather than receive routine backports                                  | Approve support window; no stable release commitment exists now                               |
| Prereleases        | Experimental, with no production support commitment                                                                       | Approve wording                                                                               |
| Platforms          | Only named OS/CPU combinations with completed installed acceptance                                                        | Exact supported versions and deferred targets                                                 |
| Acknowledgment     | Target within five business days                                                                                          | Approve calendar/timezone and staffing                                                        |
| Initial assessment | Target within ten business days, then agree the next update privately                                                     | Approve expectations; no guaranteed patch date                                                |
| Updates            | Manual security releases with release notes/advisories                                                                    | Final release URL, verification process and publisher identity                                |

Verify the reporting route before activation: assign primary/backup access,
configure notifications, send a labeled non-sensitive test from another account,
confirm private receipt/reply for both recipients and check spam/quarantine.
Retest after recipient/permission/channel changes and retain private evidence.
GitHub's [configuration guidance](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
explains its route; no repository visibility change is authorized by this proposal.

Reports should identify version/platform, disposable reproduction, expected/actual
behavior and possible impact. Keep user documents, recovery files, tokens and
exploit details out of public issues. Agree disclosure privately without inventing
a universal deadline. No route is active or tested merely because it appears here.

## Distribution and verification

The current app has no automatic updater. The tag-triggered Draft release workflow
requires `v<package version>`, waits for all three configured OS jobs and uploads
ordinary installers to a draft only. Publishing and signing setup are separate
actions; a draft is not a production release. Align this workflow with approved
platform scope before release.

The workflow accepts Tauri Apple certificate/identity/account/team inputs and maps
repository `APPLE_ID_PASS` to `APPLE_PASSWORD`. Windows signing needs release-host
Tauri configuration. Local builds are unsigned unless explicitly configured.
A future updater requires protected signing keys, a feed, rollback/version policy
and native update tests before activation.

For the final user-facing update instructions, supply the approved release URL
and identities, then test these steps on the distributed files:

1. Save work, keep a document backup, read migration/security notes and quit the
   old app. Download the correct platform/CPU/version from the approved source.
2. Compare SHA-256 with the release manifest: `shasum -a 256 'file'` on macOS,
   `Get-FileHash -Algorithm SHA256 'file'` in PowerShell, or `sha256sum 'file'`
   on Linux. A checksum from the same download site establishes integrity, not
   independent publisher identity.
3. Verify the publisher using the approved platform method below. Stop on missing
   or mismatched verification instead of bypassing OS security checks.
4. Install, launch, confirm the version and reopen a document copy. Keep backups
   until verified. Report failures privately through the activated support route;
   do not silently downgrade to a known vulnerable release.

| Platform | Verification to test                                                                                                                                                             | Owner must provide                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| macOS    | `codesign --verify --deep --strict --verbose=2 'DepthPlan.app'`; `spctl --assess --type execute --verbose=2 'DepthPlan.app'`; inspect `codesign -dv --verbose=4 'DepthPlan.app'` | Expected Developer ID/TeamIdentifier, notarization/Gatekeeper result and tested DMG/app instructions |
| Windows  | `Get-AuthenticodeSignature 'installer.exe'` and the installed executable; require Valid status and expected signer                                                               | Signer identity/certificate guidance and tested results                                              |
| Linux    | Verify a signed checksum manifest or detached signature with an independently trusted key                                                                                        | Signature format, trusted-key distribution/fingerprint and exact command                             |

These are proposed verification requirements, not claims that current artifacts
are signed, notarized or supported. Approval requires both owner decisions and
completed acceptance of the exact distributed files.
