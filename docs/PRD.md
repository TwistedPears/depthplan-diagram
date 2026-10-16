# DepthPlan product requirements

**Status: canonical current product baseline.** Reviewed October 15, 2026 against
app revision `b4172f0`, including a macOS UI walkthrough. This describes the
development app; it does not establish release readiness or approved platform support.
Future scope and recorded decisions live in the [product decision backlog](product-decisions.md).
The [original architecture PRD](https://github.com/TwistedPears/depth-plan-architecture/blob/dev/planning/depth_plan_prd.md)
is historical and does not define current requirements.

DepthPlan is a local desktop diagram editor for solution architects, technical
leads and teams explaining systems to different audiences. Users keep related
boards in a project, organize objects into nested containers, show or hide
children on the same canvas, and save bookmarks for useful views of a whole board.
Text, code and connections stay in one editable board as its presentation changes.

The primary workflow is: start a board or project, create nested components,
connect and arrange them, bookmark useful views, search or follow links between
boards, save locally, and export a view for sharing. Success means readers can
find the current system design without maintaining separate copies for each
audience. Numerical usability claims remain unvalidated.

The [document and editing reference](document-and-editing.md) defines exact board
behavior, [projects](projects.md) defines workspace and file behavior, and
[architecture](architecture.md) describes the Tauri/Rust/React implementation.
[Release requirements](release.md) distinguish development targets from approved support.

## Projects and boards

A project is a folder of independent boards, similar to files in a VS Code project.
Its `.depthproject` manifest records membership and project metadata; each board
is a separate `.depthplan` file with its own content and bookmarks.
Each live board has its own Undo history. A board can also be used standalone.
The manifest does not embed board content.

- **New Project** wraps the current board in an in-memory project without losing
  its content, selection, view or Undo history. New boards need no immediate file
  destination. First **Save All** or **Save Project As…** saves the manifest and
  boards together; canceling keeps the work in memory.
- The **Project** drawer lists boards by name, with filenames to distinguish
  repeated names. Switching boards preserves each live board's accepted edits,
  Undo history, selection, camera and suspended drafts.
- Users can create, import, duplicate, rename, remove and close boards. Import and
  duplicate create independent documents with fresh identities. Closing ends an
  editing session but keeps project membership; reopening starts fresh history.
  Removing a member leaves its saved file on disk.
- Project and board names are edited inline. Filename changes check safe paths
  and collisions. Recent Projects and remembered open boards make local work
  resumable; missing members remain visible as diagnostics.
- **Save Project As…** copies the project and all boards to a new location and
  switches to the copy. **Save Board As…** on a project member exports an independent
  copy while keeping the original project association.
- Share or move the complete folder with its relative paths intact. Local
  navigation preferences, recovery and Undo history are not portable project data.
  A project location allows one writer; folder sharing is not simultaneous editing.

The [project manifest schema](projects.md#project-file-schema) specifies
`projectVersion: 1`, stable project/member identities, relative board paths,
compatibility fields and validation limits. Board content has its own
`formatVersion: 2` contract. Neither version implies migration of the historical
architecture repository's schemas.

## Nested objects and arrangement

- Rectangles, ellipses, diamonds and frames can contain children recursively. Each
  object has one identity, one parent and shared content/style across all views.
  Lines and arrows are connections with their own stacking order, including when
  attached to objects. Leaves need no special terminal generation.
- Child controls independently show or hide branches on the same canvas.
  Ordinary collapse remembers descendant disclosure, so reopening returns to those children.
  Ctrl+click collapses the entire subtree; the next reveal opens immediate children.
  The stack control follows the parent's upper-right corner or actual diamond/ellipse outline.
- Children use parent-relative centers; moving a parent carries its subtree.
  Direct manipulation and numeric editing provide precise positioning, sizing
  and rotation; resizing does not scale children.
- Opening children auto-arranges overlaps, grows containers and pushes affected
  neighboring groups aside. Closing restores the relevant arrangement while
  keeping siblings inside their parents. Remembered states retain manual edits
  and survive save/reopen. Unaffected neighbors retain their current geometry;
  displaced neighbors have their position restored without reverting their size.
  This memory is separate from user bookmarks.
- Opening uses a brief bounce and closing eases into place; both honor reduced motion and keep
  attached connections aligned. Animation never adds intermediate history entries
  or changes saved/exported geometry. Ordinary dragging/resizing does not trigger
  continuous automatic layout.
- Creating a child reveals its branch. Drag adoption requires intentional hover;
  dropping into a collapsed container preserves that collapse. Reparenting keeps
  world pose and authored layouts, including conflicting inactive arrangements.
  Deleting a parent deletes its hidden descendants in one undoable action.
- Duplicate and Ctrl/Cmd+C, Ctrl/Cmd+V copy selected diagrams with a small down/right
  offset and new identities, preserving nested content and internal connections.
  Text editing retains normal text clipboard behavior.
- Selection actions include cut, style copy/paste, flips and stacking. Alignment
  and size matching require at least two independent shapes; distribution requires
  three. Size matching uses the first selected shape.
- Scroll zooms around the pointer; right-drag or the Hand tool pans. Fit and the
  minimap help navigate the board without changing its content.

The visible interaction is child disclosure and bookmarks. D0/D1/D2 selection
is no longer the user navigation model. Numeric root depths, inactive layouts and
depth commands remain in the file/automation contracts for compatibility; see
[visibility and remembered arrangements](document-and-editing.md#visibility-and-remembered-arrangements).

## Connections and content

Connections support free endpoints and direct shape attachments,
straight/elbow/curved routes, editable bends, labels, styles and independent
endpoint markers. Arrows can connect outside objects directly to nested children.
Collapsing a container projects external child attachments onto its visible border;
expanding restores the saved child attachment. Internal routes stay hidden while
their owner is collapsed. Cross-container moves keep arrows connected, and pending
repairs from older documents remain available for explicit resolution. Stored
boundary points and automation bridge operations remain supported, but custom
boundary-point authoring is no longer exposed in Style.

Objects store structured rich text, rather than Markdown source. The visual editor
offers text formatting, lists, alignment, links, system fonts and favorites, size
and color. The content contract also supports headings and quotes.
Code blocks preserve source text and optional wrapping. Highlighting covers
JavaScript, TypeScript, JSON, YAML, Python, SQL, Bash, C#, Java, HTML and CSS, with
plaintext fallback. Code is displayed, never executed. Expanded parents show their
title and children; hiding children displays the parent's own body again.

Style controls include preset/custom colors, solid or patterned fills, no fill,
stroke width/dash or no stroke, corners, opacity and connection markers.
Styles belong to individual objects; copying styles does not create shared,
cascading definitions.

## Bookmarks, search and links

Bookmarks save named views of a board's child disclosure, positions/sizes and
camera focus/zoom. Create, apply, reset, rename, duplicate and delete are undoable.
**Reset View** replaces a bookmark's saved view with the current view.
Applying a bookmark preserves current content, styles, ownership and object
existence; rotation and stacking also stay current. It is a presentation snapshot,
not a historical document copy. Pan/zoom alone is transient and does not dirty the
document or overwrite a bookmark.

Board search includes hidden objects and their text. Choosing a result reveals
its ancestry, selects it and brings it into view. **Search boards** searches a
project's object names, rich text/code, connection labels and bookmark names.
Open boards contribute accepted in-memory changes; unopened boards are validated
and read from disk without opening editing sessions. Results identify exact
entities, report unreadable boards, and stop at 500 matches.

Objects can link to a project board and optionally one of its bookmarks.
**Back to previous board** restores the previous board/view and still-visible
selection without reversing edits. Stable identities preserve targets through
renames and folder moves. Missing or foreign targets require explicit repair.
Separate object links focus an item in an already-open board; web/email and
rich-text links remain available. These local links do not publish a web view.
See [project navigation links](projects.md#link-boards-and-bookmarks).

## Templates

The offline gallery provides editable examples across architecture, delivery,
workflows, product, planning, strategy and operations. Inserting a template adds
ordinary objects and connections to the current board, selects them and brings
them into view. Existing content, board identity, project membership and bookmarks
stay intact. One Undo removes the insertion.

Users can save a board or selection as a personal template, update personal
entries, and import/export `.depthtemplate` files. Personal templates live on the
local computer. Inserted objects have no live link back to the library, so editing
a template never updates previous insertions. Templates do not add custom SVG
shape types. See [templates](templates.md) for the gallery and portable contract.

## Saving, recovery and export

Editable boards use `.depthplan` JSON with `formatVersion: 2`; the older
`.depthplan.json` filename is still accepted when its contents pass current
validation. Saving preserves the complete document, including inactive layouts
and bookmarks.
Unsupported versions and malformed documents are rejected without replacing the
open document. Writes are atomic; external source changes require an explicit
conflict decision. Multi-file project operations can leave diagnosed recoverable
intermediates; they are not one filesystem-wide transaction.

Autosave is On by default in Settings for saved standalone boards and saved
project boards. Accepted edits save after about one second idle, with a
five-second scheduling bound while editing; active operations can defer the write.
New unsaved work needs an initial destination. **Save All** flushes pending changes.
Unapplied drafts are not saved automatically. A failed save retains work and pauses
automatic retries for that board until resolved.

Accepted edits, including child disclosure and bookmark changes, participate in
per-board Undo/Redo. Save and board switching preserve live history; closing or
replacing an editing session resets it. Unsaved-work and active-draft
guards protect document replacement and quit. Failed or canceled saves do not
silently discard work.

Local recovery checkpoints preserve accepted unsaved edits separately from source
files and autosave. Restore opens a fresh unsaved standalone session for explicit
saving, including when the checkpoint originated in a project. Recovery is best
effort; drafts and Undo history are not recovered. Keep separate backups.

Static SVG/PNG exports include the current revealed scene, including offscreen
content, for either the whole board or a selection and its revealed descendants.
They exclude editor controls, hidden children and pending connection repairs.
Apply a bookmark before exporting that view. Export does not batch saved views or
make project links interactive. Editable JSON remains available separately.

## Local automation

The opt-in local MCP server lets an external client inspect and author live boards,
discover project membership, open/target boards, navigate, manage bookmarks/history,
and perform approved file operations.
UI and MCP share one command layer, validation, dirty-state and recovery behavior.
Session/revision guards prevent stale edits; mutations are atomic and retry-aware.
The server starts Off, disk access needs local folder approval, and credentials
stay in the native host. No built-in model account or hosted API is required.
See [MCP](mcp.md) for setup and the tool contract.

## Observable acceptance outcomes

These outcomes define the current baseline for regression review; they are not a
claim that every platform and failure path was exercised in the baseline walkthrough.

- Hide a parent with expanded descendants, then reopen it: descendant disclosure
  returns. Ctrl+click folds the subtree, and the next reveal shows immediate children.
- Save a bookmark, change the board's view and edit text, then apply it: the saved
  disclosure, compatible positions/sizes and framing return while new text remains.
- Create a project with two boards, edit both and switch between them: accepted
  edits and live history remain separate. Save, close and reopen the complete
  folder: membership, content and bookmarks persist; Undo history starts fresh.
- Search a project for hidden content in an unopened board, then activate a result:
  the correct board and ancestry open. A project link can target that board's
  bookmark, and Back returns to the previous view.
- Insert a template into a populated board, then Undo: existing content is retained,
  and the insertion is removed as one action.
- Save accepted edits with autosave enabled: the saved board updates. Introduce an
  external source change or a failed write: work remains available and the app
  requires conflict resolution rather than silently replacing it.
- Export a board with revealed offscreen content and hidden children: the SVG/PNG
  includes the revealed content and omits hidden descendants and editor controls.

## Validation and scope limits

Target platforms are macOS, Windows and Linux. Apple Silicon is the first macOS
acceptance target; Intel Mac is deferred. Windows x64 and Linux x86_64/ARM64 require their
own native validation. Claim support only for tested and approved OS/CPU
combinations; initial releases may support a limited set. Configured build targets
do not establish release support. Mobile remains retained future work under PD-15.

The canvas has no fixed page boundary or chosen product object-count cap. Its
usable capacity depends on revealed objects, nesting, connections, text, layouts,
history and available memory. Use the fixed [development budgets](development.md#capacity)
and exact installed-candidate checks; do not substitute a large fixture for
measured responsiveness. Curated [samples](sample/README.md) demonstrate behavior;
stress documents are generated on demand.

Keyboard navigation, screen-reader behavior, contrast and reduced motion are
release acceptance requirements. Named controls alone do not establish
accessibility. Gather real user feedback to guide improvements. The historical
performance targets and usability/productivity claims are dropped; retain current
benchmark budgets and release checks, and make quantitative claims only when
actual measurements or study evidence support them.

Full Markdown, cloud sync/collaboration, executable code, embedded documents/media,
tables, multiple owning parents/aliases, custom shape marketplaces, permanent change history and
automatic updates are outside the current scope.

The October 15, 2026 [decision review](product-decisions.md) retains built-in
symbols, recent custom colors, supported-format specifications/compatibility and
mobile support as future work. The backlog records the scope of these items,
triggers for deferred proposals and explicit drops. No implementation order or
delivery dates are assigned. The old architecture schemas are excluded from the
retained compatibility policy.

When behavior changes, update this PRD, the affected detailed reference and
acceptance evidence in the same change. Retained future work becomes part of this
current baseline only after implementation and verification.
