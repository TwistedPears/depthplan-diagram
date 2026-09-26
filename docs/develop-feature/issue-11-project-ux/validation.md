# Issue #11 — Design validation and implementation handoff

Review date: 2026-09-26. Result: the design package is ready for a documentation PR. All product questions are resolved. Issue closure/publication is still pending; no runtime Projects implementation is claimed.

Reviewed [specification.md](specification.md), the [decision record](decision-checklist.md), the four [image concepts](../../design/project-ui-concepts-2026-09-26/README.md), the [supplemental wireframes](wireframes.html), the existing [document lifecycle](../../document-and-editing.md), and core issue descriptions. This is a tabletop design review plus actual browser inspection of the wireframe artifact. It is not an observed user study, screen-reader certification, or a native end-to-end test of the future feature.

## Three-board working-day walkthrough

Scenario: a user has an independently saved Overview board, creates Platform Architecture, imports API Services, creates Data Model, edits across them, and encounters an unavailable folder before closing.

| Step                                                           | Contract followed and review result                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Start and save a single board                               | Blank canvas and existing Save/Save As remain available without a project. The menu adds optional Project actions. **Design pass:** no onboarding or project requirement is introduced.                                                                     |
| 2. New Project → Copy current board                            | Name/location and copy choice are explicit. Resolve drafts; copy the applied snapshot with new identity; switch only after successful creation. **Design pass:** original file stays intact, canceled/failed creation retains the old workspace.            |
| 3. Import API Services; create Data Model                      | The import copies a validated file; creation produces an independent board. Membership/order persist in the manifest. **Design pass:** original source and unrelated files are not overwritten; failure cannot claim a missing copy is a member.            |
| 4. Edit Overview, then switch to API Services                  | Applied revisions/history remain with Overview; inactive eligible autosave continues there. **Design pass:** Save/Export and delayed acknowledgements cannot retarget to the new active board.                                                              |
| 5. Leave an unfinished Data Model form; switch away and return | Q3 retains the draft in its board's memory, restores focus, and shows Draft not saved. **Design pass:** navigation does not call ordinary blur acceptance, and Saved does not imply draft protection.                                                       |
| 6. Set API Services as home                                    | Explicit settings Save changes persists the home identity and does not alter board contents. **Design pass:** canceled/failed settings writes remain honest; location/Reveal is included.                                                                   |
| 7. Turn autosave off; modify two boards                        | In-flight source write may finish; subsequent edits remain unsaved until manual Save/Save All. Recovery remains independent. **Design pass:** disabling autosave is not an implicit save or discard.                                                        |
| 8. Close the project while a form remains unfinished           | Resolve the form via Apply/Discard draft/Cancel before handling applied work. **Design pass:** Discard draft does not discard already-applied edits. Cancel keeps all sessions open.                                                                        |
| 9. Folder becomes unavailable during Save All/close            | API Services has a failed save; Data Model has a draft; Overview is already saved. The close summary names each state and offers Keep open and targeted actions. **Design pass:** successful saves are not rolled back, but no problem session is disposed. |
| 10. Restore access and retry                                   | Retry rechecks target/provenance and saves the latest eligible revision. Newer work remains pending until acknowledged. **Design pass:** an old successful write never clears newer unsaved edits.                                                          |
| 11. Close/reopen explicitly                                    | Save local tabs, active board, and camera separately; restore them before considering home fallback. Fresh local state uses API Services. **Design pass:** restored navigation does not dirty shared files; undo/drafts are not promised across close.      |
| 12. Crash with applied edits and a draft                       | Offer recovery for acknowledged applied snapshots with identity/location/time. Restore opens unsaved work and requires a safe source-destination decision. **Design pass:** draft/undo loss is disclosed; a recovery path alone never authorizes overwrite. |

## Adverse paths and consistency corrections

| Case                                                                    | Resolution in the final contract                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary inline outside-click acceptance versus tab-switch preservation | Treat project navigation as session navigation, not blur acceptance. Keep existing within-canvas acceptance behavior. This is explicit work for #13.                                         |
| Save a copy from inside a project                                       | Keep project membership/current destination unchanged and create an independent document. Standalone Save As retains its original semantics. This avoids a silently moved project member.    |
| Copy current unsaved board into a new project                           | Successful copy preserves the captured applied snapshot without rewriting the original file. Failed copy or newer edits prevents disposal.                                                   |
| Save in flight plus newer edits plus draft                              | Apply transition precedence, capture session/revision, recheck after acknowledgement, then dispose only resolved work.                                                                       |
| Board versus manifest external conflict                                 | Board conflict pauses its writer. Manifest conflict pauses membership/settings and uncertain targets; reload reconciles by identity and protects externally removed/repathed dirty sessions. |
| Empty project / no open tabs                                            | Valid states with Create/Import/Open actions. Document actions are unavailable without an active board. The last tab is not silently reopened.                                               |
| Home removal, missing/corrupt members                                   | Clear home reference on removal; choose a valid local/home/first-healthy fallback. Keep the project and healthy members usable.                                                              |
| Duplicate names and case-only paths                                     | Stable identity, visible secondary filename, reviewed filename suffixes, and guarded collision handling prevent title-based retargeting or overwrite.                                        |
| Whole-folder move versus copy                                           | Validate identity plus canonical location. Explicit Locate can migrate a missing location's local state; a copied project is a separate workspace/writer location.                           |
| Native Open during an active gesture/draft                              | Route through the same queue/guards. Validate before replacing the current workspace. Cancel preserves it.                                                                                   |
| Interrupted multi-file operation                                        | Preserve the last valid state; report recoverable orphan output; never silently adopt/delete unknown files. Native crash consistency is tested in #12.                                       |

## Visual and accessibility review

The review sheet provides 11 scenes: startup menu, project widget/tabs, creation, settings, board conflict, aggregate failed close, loading/missing member, recovery, empty project, retained draft/board actions, and project menu/Save All. Each can be rendered at 1440×1000, 1024×728, and 900×640. The native host's existing default is 1024×728; the other two are review targets, not a new enforced minimum.

Browser review used the actual local HTML artifact. All 33 state/viewport combinations rendered application content when exercised with accessibility/DOM snapshots. Representative screenshots were inspected, including conflicts and aggregate close at wide and compact sizes. The settings body scrolls at compact height while its footer stays visible. Compact tabs become an active-tab/overflow control; long menu/drawer content scrolls. Error and draft states use text, not color alone. A read-only iframe geometry probe was limited by the browser tooling, so this is not a claim of automated pixel-bound or exhaustive clipping validation.

Two visual issues were found and corrected during review: the compact missing-member panel needed clearance below the tabs, and empty-project Save/Export controls needed to be disabled. Exact icon artwork is intentionally illustrative; implementations reuse the application's existing icon set.

Keyboard/focus review was a contract walkthrough: menu → named board list/filter → tablist → active canvas; manual tab activation; keyboard alternatives to drag; modal focus containment; focus return to invoker/new active tab/restored draft; Escape precedence; polite/coalesced save announcements. The review artifact exposes its State and Application viewport selectors to keyboard/accessibility APIs. Its inner application controls are illustrative and do not implement focus traps or application actions. Actual keyboard-only and assistive-technology behavior must be tested in #14/#19.

## Acceptance mapping for #11

| Acceptance criterion                                                                    | Evidence                                                                                               | Design result |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| Clean/dirty/saving/failed-save/draft/external-change transition table                   | Specification §§5–7, including overlapping-state precedence and async revision capture.                | Satisfied     |
| Wide/narrow startup, navigation, settings, conflict, aggregate close wireframes         | Accepted images plus wireframe scenes 01–06 at wide/default/compact sizes; supplementary scenes 07–11. | Satisfied     |
| Explicit project/board/personal state ownership                                         | Specification §3, including normal navigation versus authored bookmark camera state.                   | Satisfied     |
| Save wording distinguishes applied persistence, unprotected drafts, and recovery limits | Specification §7 status table; draft, close, recovery and settings scenes.                             | Satisfied     |
| Recorded decisions remove downstream ambiguity                                          | Specification §§1–9 and decision record; user decisions and delegated defaults are explicit.           | Satisfied     |

## Downstream handoff

| Ticket                      | Contract and clarification to carry forward                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #10 — native document files | Already completed; preserve `.depthplan` and legacy compatibility and standalone Save/Save As.                                                                                                        |
| #12 — storage               | Implement identity/path/ownership rules, safe create/import/rename, recoverable multi-file writes, conflict handling, non-destructive removal, and empty projects.                                    |
| #13 — sessions              | Implement per-board history/camera/selection/drafts, navigation distinct from blur, captured async targets, and guards.                                                                               |
| #14 — project UI            | Add the Project widget and tabs to the existing window, name quick switching, board management, unavailable states, compact layouts and accessibility.                                                |
| #15 — settings              | Explicit Save changes/Cancel; location/Reveal; independent shared settings; home fallback.                                                                                                            |
| #16 — persistence           | Save active/Save All, autosave/recovery separation, draft-aware status, targeted conflict pauses, and aggregate close.                                                                                |
| #17 — startup/opening       | Clarify its "start screen" wording to mean the existing blank canvas with menu-based New/Open/Recent Project actions. Reuse the current window; restore local state only on explicit project opening. |
| #18 — MCP                   | Bind operations to captured project/board/session identities and preserve existing explicit disk grants; no automatic permissions from UI project opening.                                            |
| #19 — integrated validation | Execute the implemented working day, failure injection, installed-platform checks, and performance measurements. Design review here is not evidence those runtime checks passed.                      |

The #17 clarification is recorded here for the documentation PR; no remote issue edit has been made. A PR can link this table from #11 without inventing additional implementation tickets. Link the accepted contract from #12/#13 before starting their work.

## Artifact validation and reproduction

From the repository root, format/check only this documentation package and the image notes:

```sh
node_modules/.bin/prettier --check docs/develop-feature/issue-11-project-ux docs/design/project-ui-concepts-2026-09-26/*.md
```

Open `wireframes.html` directly in a browser, or serve the repository locally with `python3 -m http.server 8765 --bind 127.0.0.1` and open `/docs/develop-feature/issue-11-project-ux/wireframes.html`. Select each state at each of the three viewport sizes. The HTML is self-contained apart from the four linked local PNGs; it loads no external scripts, fonts, or assets.

Preparation checks passed: Prettier for both documentation folders, `node --check` on the extracted embedded script, and existence checks for all 33 relative file references in the Markdown/HTML package. The HTML source and document tables were reviewed for scope and consistency. Full native/build/installed-platform tests were not run for this docs-only artifact. Required submission gates still apply when the documentation PR is actually published.

## PR packaging and closure

Include the specification, decision record, this validation record, self-contained wireframes, and the four original PNGs with their prompts/notes. Do not change current product documentation to describe Projects as shipped. Keep the GitHub issue open until the documentation is published/accepted and evidence is linked; then #11 can close and unblock #12/#13. No further product clarification is needed for this v1 package.

Human testing can subsequently refine the drawer size, compact breakpoint, tab overflow, labels, first-board defaults, and autosave feel. It must preserve explicit draft handling, safe source writes, stable identity, independent standalone use, and the same-window decision unless those requirements are explicitly revised.
