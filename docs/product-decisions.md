# Product decision backlog

**Status: proposals and recorded decisions, not committed delivery scope.** Created October 15,
2026 alongside the [current PRD](PRD.md), based on app revision `b4172f0` and the
[historical architecture PRD][historical]. That PRD preserves the original wording;
its dates, feature promises and success metrics do not apply to the current beta.

**Decision review completed October 15, 2026.** All 20 feature decisions and three
validation decisions below have a disposition. PD-16 was split into PD-16a and
PD-16b to separate dropped services from deferred local PDF export.

- **Retain (4):** built-in symbols (PD-03), recent custom colors (PD-07), supported
  format specifications/compatibility (PD-12), and mobile support (PD-15).
- **Defer (8):** custom SVG/symbol imports (PD-04), batch bookmark export (PD-06),
  control customization (PD-08), Git conflict merging (PD-09), interactive
  onboarding (PD-10), external diagram imports (PD-11), interactive web sharing
  (PD-13), and local PDF export (PD-16b).
- **Drop (8):** cascading styles (PD-01), shape variants/shortcut cycling (PD-02),
  audience presets/bulk view management (PD-05), cloud collaboration (PD-14),
  integrations/hosted services (PD-16a), the hosted security package (PD-17),
  enterprise accounts/management (PD-18), and built-in AI (PD-19).

Retained work is future scope, not implemented capability or a delivery schedule.
New proposals start **Decision needed**. Record each decision's maker, date and rationale.
Retain requires a bounded requirement and acceptance criteria before implementation;
Defer requires a reason and a condition for reconsideration. Link resulting work
items here. Add a feature to the current baseline only when it is implemented and
verified.

## Authoring and presentation

| ID    | Historical proposal                                                                   | Current baseline                                                                                                      | Decision and rationale                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PD-01 | Global style management with cascading updates (§9)                                   | Per-object styles and copy/paste styles exist. Templates insert independent objects.                                  | **Drop — October 15, 2026, user decision.** Existing Copy/Paste Style is sufficient for the intended workflow. Retain independent per-object styling; no named shared styles or cascading updates planned.                                                                         |
| PD-02 | Configurable shape variants and shortcut cycling (§10)                                | No variant definitions or variant settings in the current contract/UI.                                                | **Drop — October 15, 2026, user decision.** Keep the existing drawing and reuse workflow; no configurable shape variants or repeated-shortcut cycling planned.                                                                                                                     |
| PD-03 | Categorized symbol library (§11)                                                      | Rectangle, ellipse, diamond and frame primitives, plus line/arrow connections. Templates compose these into examples. | **Retain — October 15, 2026, user decision.** Built-in symbols are still wanted and should be added when time permits. No delivery date or priority assigned. See [retained scope](#pd-03-built-in-symbol-library).                                                                |
| PD-04 | Custom SVG shapes and `.depthshapes.json` libraries (§12)                             | No arbitrary SVG shape type/import workflow. `.depthtemplate` shares ordinary editable diagram content.               | **Defer — October 15, 2026, user decision.** Coordinate custom SVG and imported libraries with symbol packs under PD-03. Revisit when PD-03 symbol-pack work is planned so they fit the same library system. No delivery date assigned; historical shape schemas remain proposals. |
| PD-05 | Audience view templates and bulk view operations across diagrams (§2)                 | Bookmarks save views of one board; project links can target another board's bookmark.                                 | **Drop — October 15, 2026, user decision.** Current bookmarks cover the intended workflow. No reusable audience presets or bulk view management across boards planned. Batch bookmark export remains a separate decision in PD-06.                                                 |
| PD-06 | Batch export of selected saved views (§3 and Desktop File menu)                       | Apply a bookmark, then export the current revealed scene as SVG/PNG.                                                  | **Defer — October 15, 2026, user decision.** Exporting one bookmark at a time is sufficient for now. Revisit when repeated multi-view exports make the individual workflow cumbersome. No delivery date assigned.                                                                  |
| PD-07 | Recent custom-color history (§8)                                                      | Preset palette and custom color input exist, without a recent-colors list.                                            | **Retain — October 15, 2026, user decision.** Quickly reusing recent custom colors would be useful. No delivery date or priority assigned. See [retained scope](#pd-07-recent-custom-color-history).                                                                               |
| PD-08 | Remappable shortcuts and customizable gestures (Desktop preferences; UX requirements) | Fixed editing/navigation shortcuts and keyboard-accessible controls exist; no remapping settings.                     | **Defer — October 15, 2026, user decision.** Current shortcuts are sufficient for now. Revisit when concrete user needs for shortcut remapping or gesture customization emerge. Existing keyboard accessibility remains a baseline requirement. No delivery date assigned.         |

## Files, onboarding and interoperability

| ID    | Historical proposal                                                                              | Current baseline                                                                                                                                                              | Decision and rationale                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PD-09 | Side-by-side logical Git conflict resolution (§6)                                                | External-file fingerprints, guarded overwrite/copy/reload and connection repairs protect current work. No visual fragment-merge editor.                                       | **Defer — October 15, 2026, user decision.** Revisit when multiple people are working on the same diagrams through Git. Existing external-file safeguards remain in place. Future conflict examples must use current objects and bookmarks, not numbered depths. No delivery date assigned.     |
| PD-10 | Interactive tutorial and progressive feature discovery (Onboarding)                              | Welcome state, sample tour and template gallery exist. No guided interactive tutorial established.                                                                            | **Defer — October 15, 2026, user decision.** The sample tour and templates are sufficient for now. Revisit when more people start using the app and their onboarding needs can be assessed. No delivery date assigned.                                                                          |
| PD-11 | Existing-diagram import wizard (Onboarding)                                                      | Opening validated DepthPlan files and importing project boards/templates work; conversion from other diagram formats is not established.                                      | **Defer — October 15, 2026, user decision.** Revisit when users ask to bring existing diagrams from other tools. Use those requests to choose source formats and required conversion fidelity. Existing DepthPlan imports remain supported. No delivery date assigned.                          |
| PD-12 | Published format specification and backward compatibility across updates (§3; Data requirements) | Board v2 and project v1 have executable contracts; project JSON Schema is generated from the shared contract. Legacy filename support does not migrate arbitrary old schemas. | **Retain — October 15, 2026, user decision.** Maintain specifications and compatibility/migration rules for current and future supported formats. Compatibility with the old architecture schemas is explicitly excluded. See [retained scope](#pd-12-format-specifications-and-compatibility). |

## Sharing, platforms and services

These proposals are outside the current local desktop baseline. Recording them
here does not introduce cloud, identity or compliance requirements into this beta.

| ID     | Historical proposal                                                                                           | Current baseline                                                                                                                                   | Decision and rationale                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PD-13  | Web viewer and read-only share URLs (§2; Roadmap Phase 2)                                                     | Local project/object links and static file exports exist. They do not publish hosted views.                                                        | **Defer — October 15, 2026, user decision.** Sharing files and SVG/PNG exports is sufficient for now. Revisit when users want to share interactive views with people who do not have the app. No delivery date assigned.                                                                                               |
| PD-14  | Realtime editing, comments, change tracking and cloud sync (Roadmap Phase 2)                                  | Single-writer projects, local autosave, per-session Undo and recovery. Cloud collaboration and permanent change history are outside current scope. | **Drop — October 15, 2026, user decision.** No current plans to build a Miro/Lucidchart-style collaboration platform. Drop this bundle of realtime editing, comments, persistent change history and cloud sync. Local saving, session Undo and recovery remain; PD-09 and PD-13 retain their separate deferred status. |
| PD-15  | Mobile viewer/editor, touch/stylus and native mobile integrations (Mobile)                                    | Desktop implementation; no mobile product established by this audit.                                                                               | **Retain — October 15, 2026, user decision.** Firmly wanted for the user's own use. Mobile support remains a definite product direction; no delivery date or implementation order assigned. See [retained scope](#pd-15-mobile-app).                                                                                   |
| PD-16a | Integrations and hosted services (split from PD-16; Integrations and Roadmap Phase 3)                         | Local editable files, SVG/PNG exports and opt-in local MCP. No hosted integration service established.                                             | **Drop — October 15, 2026, user decision.** Drop Confluence/Jira integrations, Slack/Teams sharing, the hosted PDF service and a hosted public API. Existing local MCP remains in scope.                                                                                                                               |
| PD-16b | Local PDF export (scoped alternative to the historical PDF service in PD-16)                                  | SVG/PNG export is available; local PDF export is not implemented.                                                                                  | **Defer — October 15, 2026, user decision.** SVG/PNG is sufficient for now. Revisit when a concrete need for local PDF output is not met by those formats. Any retained PDF export should run locally, without a hosted service. No delivery date assigned.                                                            |
| PD-17  | E2E encryption, zero knowledge, residency, share permissions and access analytics (Security; Roadmap Phase 3) | Plain JSON files and local access controls. No hosted encryption, sharing permissions or access analytics claim.                                   | **Drop — October 15, 2026, user decision.** This package is unnecessary without hosted services. If interactive sharing is revisited under PD-13, define security requirements for that design then. Existing local-file and MCP security obligations remain in force.                                                 |
| PD-18  | SSO/MFA, enterprise directory support, certification and retention controls (Enterprise)                      | No enterprise identity or certification established.                                                                                               | **Drop — October 15, 2026, user decision.** Enterprise accounts and organization management are not planned. Drop the associated enterprise identity, certification and managed retention feature package. Existing security and release checks remain unchanged.                                                      |
| PD-19  | AI layout suggestions and content analysis (Roadmap Phase 4)                                                  | Deterministic disclosure arrangement and external-client MCP automation exist; no built-in model account is required.                              | **Drop — October 15, 2026, user decision.** External AI tools through MCP cover the intended workflow; built-in AI features are not needed. Retain the existing MCP integration and deterministic arrangement behavior.                                                                                                |

## Validation decisions

These decisions govern evidence and release acceptance. They do not establish
that any benchmark, usability study, accessibility or platform check has passed.

| ID    | Historical target                                                                         | Current treatment                                                                                                    | Decision and evidence requirements                                                                                                                                                                                                                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PV-01 | 60 fps, sub-200 ms disclosure, export under five seconds and several object-count targets | The app uses fixed [development capacity budgets](development.md#capacity); usable capacity depends on the workload. | **Drop historical targets — October 15, 2026, user decision.** Retain the current benchmark budgets and release checks. Base performance claims on actual recorded measurements, identifying the workload, hardware, platform and app build. No blanket object-count or responsiveness claim is carried forward.                                           |
| PV-02 | 80% maintenance reduction, 90% preference, 95% consistency and productivity gains         | No validated numerical usability claim in the current PRD.                                                           | **Drop historical claims — October 15, 2026, user decision.** Gather real user feedback. Make quantitative usability or productivity claims only when actual evidence supports them; the historical percentages and productivity gains are not carried forward.                                                                                            |
| PV-03 | Broad accessibility and desktop platform support                                          | Reduced motion and named controls exist; [release acceptance](release.md) still governs supported platforms.         | **Retain — October 15, 2026, user decision.** Keep accessibility checks as release requirements. Claim support only for OS/CPU combinations actually tested and approved; initial releases may support a limited set. Verify keyboard navigation, screen-reader behavior, contrast and reduced motion. Define mobile acceptance when PD-15 is implemented. |

## Retained feature scope

### PD-03: Built-in symbol library

Provide a browsable built-in palette grouped into Basic, Process and Technical
symbols. This is future work, not an implemented feature. Choose the initial
symbol list before implementation; the historical examples are candidates, not
a commitment to every listed shape. Custom SVG/library imports are deferred in
PD-04 and should be revisited alongside this symbol-pack work. Dropped global
styles and shortcut cycling are not prerequisites.

Draft acceptance checks for the retained scope:

- The approved symbols are available offline in their categories and can be
  selected and placed on a board.
- Placed symbols support the board's normal selection, positioning, sizing and
  connection workflows, with a consistent visual style.
- Saving and reopening a board preserves its symbols; SVG/PNG exports render them
  correctly. Current boards remain readable.

### PD-07: Recent custom-color history

Show recently used custom colors as selectable swatches alongside the existing
palette so users can reuse an exact color without reopening the picker or copying
an entire object's style. This is future work. Choose the history limit and whether
history is local to the app, project or board, including restart persistence,
before implementation.

Draft acceptance checks for the retained scope:

- Applying a custom color makes that exact color available in the recent swatches.
- Selecting a recent swatch applies it to the active color property without
  changing unrelated styles, content or links; normal Undo behavior is preserved.
- Recent swatches have accessible labels and keyboard operation, and repeated use
  of the same color does not create duplicate entries.

### PD-12: Format specifications and compatibility

Maintain versioned specifications for current and future supported file formats,
aligned with their executable validators. Define support and migration rules for
future format changes before release, so users know how saved files will carry
forward. This includes current board v2 and project v1; compatibility with the old
architecture repository's schemas is explicitly out of scope.

The retained policy does not make older app versions understand unknown future
formats. Exact migration paths and the specification publication process still
need to be defined; no new migration capability is claimed by this decision.

Draft acceptance checks for the retained scope:

- Each supported format version has a published specification and valid examples
  that agree with the app's executable contract.
- A format-changing release documents which saved versions it reads or migrates
  and how older app versions handle its output.
- Supported upgrades preserve document content, views and project references.
  Invalid or unsupported inputs fail clearly without overwriting the source.
- The compatibility documentation explicitly excludes the historical architecture
  schemas rather than implying support through legacy filename extensions.

### PD-15: Mobile app

Retain a mobile version of DepthPlan as a firm product direction, motivated by the
user's own need. This decision does not depend on broader customer demand. Choose
the initial platforms and phone/tablet targets, the first release's viewing and
editing scope, and stylus/native integration requirements before implementation.
The historical roadmap supplies no delivery date. Mobile work does not reinstate
the cloud collaboration and sync features dropped in PD-14.

Draft acceptance checks for the retained scope:

- On the chosen mobile targets, users can open supported boards and navigate
  their content, child visibility and bookmarks using touch controls.
- Files exchanged with desktop preserve supported board content and project
  references under PD-12's compatibility policy.
- Any included editing workflows preserve the desktop document semantics and
  protect unsaved work during file operations and app lifecycle transitions.

## Baseline changes already recorded

These are current implementation facts, not unresolved proposals:

- Child show/hide controls and bookmarks are the visible navigation model.
  Numeric depths and inactive layouts remain compatibility details.
- The desktop implementation uses Tauri/Rust/React. The original Electron plan
  is historical.
- Structured rich text replaced the proposed Markdown-string editor.
  Full Markdown remains outside current scope.
- Projects group independent boards in a folder using a `.depthproject` manifest.
  Board v2, project v1 and portable templates have separate contracts.
- Templates, project search, board/bookmark links, source-file autosave and
  opt-in local MCP are part of the current product.

The original 1–18 month roadmap is historical. This backlog sets no replacement
schedule. [Release decisions](release.md) remain separate from feature scope.

[historical]: https://github.com/TwistedPears/depth-plan-architecture/blob/dev/planning/depth_plan_prd.md
