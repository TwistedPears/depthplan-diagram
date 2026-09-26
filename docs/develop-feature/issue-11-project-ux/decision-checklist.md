# Issue #11 — Decisions and completion record

The product questions are resolved. On 2026-09-26 the user selected the existing mockups, blank-canvas startup, in-memory draft preservation, and reuse of the current window with the added Project widget. The user authorized choosing practical v1 defaults, extrapolating the missing visual states, and preparing the documentation for a later PR.

The resulting contract is [specification.md](specification.md). [wireframes.html](wireframes.html) extends the [four generated concepts](../../design/project-ui-concepts-2026-09-26/README.md). [validation.md](validation.md) records the design walkthrough and acceptance evidence. This record supersedes the earlier planning checklist; it does not claim the feature is implemented or that issue #11 has already been closed.

## Recorded user decisions

| Decision           | Selected behavior                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visual baseline    | Floating project drawer/widget, open-board tabs, compact creation/settings dialogs. Preserve the existing canvas UI.                                               |
| Startup            | Existing blank single-board canvas. New/Open/Recent Projects are optional menu actions.                                                                            |
| Drafts             | Preserve unfinished board text/forms in memory across tab switches. Apply/Discard/Cancel before session disposal. Crash recovery covers applied edits, not drafts. |
| Window reuse       | Open boards/projects in the existing window. Add or remove Project navigation with the workspace mode.                                                             |
| Remaining defaults | Choose a conservative first version and refine feel/interaction through later human testing.                                                                       |
| Visual gaps        | Reuse the generated images as the baseline and extrapolate compact, error, close, and recovery states.                                                             |
| Delivery sequence  | Assemble and validate the docs first; get latest main; create a new branch. PR submission follows preparation.                                                     |

## Selected v1 defaults

These implement the user's delegation; they are no longer unanswered product questions.

- Create Project defaults to a blank Overview board with an explicit Copy current board alternative. A copy preserves the original file.
- Save targets the active board; Save All is a project menu action. Neither silently applies explicit drafts.
- Project autosave is on by default; disabling it preserves ordinary manual-save/unsaved-work guards. Recovery stays separate.
- Explicit project reopening restores valid local tabs first, then home/first-healthy fallback. Bare app launch stays a blank canvas.
- Remove from Project preserves files and clears a removed home reference. An empty project is valid.
- Project settings use Save changes/Cancel, including location and Reveal in File Manager. Display-name changes do not rename the project folder.
- Conflicts pause unsafe writes. Aggregate close failures identify each board; Keep open is the safe default.
- At compact widths, use an overlay drawer, active tab with overflow, scrollable dialog bodies, and reachable footers.
- Reuse the existing validation, identity, source-fingerprint, history, recovery, and accessibility conventions in downstream implementation.

## Completion evidence

| Requirement from #11                                                       | Evidence                                                                                       | Design status                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| State/transition table                                                     | Specification sections 5–7 cover all six required states and overlap precedence.               | Complete                                                                 |
| Wide/narrow startup, project navigation, settings, conflicts, failed close | Four concept PNGs plus 11 wireframe states at wide/default/compact sizes.                      | Complete                                                                 |
| Ownership of project, board, personal state                                | Specification section 3 distinguishes shared content, local workspace, sessions, and recovery. | Complete                                                                 |
| Honest save/draft/recovery language                                        | Specification section 7 and draft/recovery/close wireframes.                                   | Complete                                                                 |
| Decisions remove downstream ambiguity                                      | Specification sections 2–9; validation cross-ticket table.                                     | Complete                                                                 |
| Working-day and accessibility review                                       | Recorded tabletop review and browser inspection in validation.md.                              | Complete for design; runtime/human usability testing belongs downstream. |

## Publication and closure

- [x] Record all user choices and selected defaults.
- [x] Complete the normative UX/lifecycle specification.
- [x] Extrapolate missing visual states and compact layouts.
- [x] Review the three-board working day, adverse paths, accessibility, and downstream scope.
- [ ] Publish the documentation PR and link its evidence from #11.
- [ ] Close #11 after the documentation is accepted/merged; then start the separately scoped #12/#13 implementation work.

No further product answer is needed to prepare this package. The develop-feature source-code approval gate applies to later implementation, not to this authorized documentation work.
