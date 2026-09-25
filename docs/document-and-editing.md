# Document and editing reference

This is the current file and editor behavior contract. Executable validation lives
in [recursiveDocument.ts](../src/shared/recursiveDocument.ts); shared operations
and their tests define detailed edge cases. [PRD](PRD.md) describes product scope.

## Format and identity

DepthPlan diagrams use `.depthplan` files containing ordinary JSON. Existing
`.depthplan.json` files remain supported. **Save** writes to the exact opened
filename; **Save As** suggests the same basename with `.depthplan`, leaves the
original file intact, and makes the selected copy the current save destination.
New documents default to `untitled.depthplan`. Editable document exports also
default to `.depthplan`. This naming change does not change the document format.

The Open dialog accepts `.depthplan` and `.json`; contents must pass the same
validation regardless of extension. Packaged applications register `.depthplan`,
not generic `.json`. OS file-open requests use the same draft and unsaved-work
guards as Open. Multiple requests are handled in order; canceling one preserves
the current document. Finish an active gesture before retrying an open request.

Only `formatVersion: 2` is accepted. Missing/unsupported versions and malformed
input fail without replacing the current document or modifying the source file.
The document contains `id`, `metadata`, `objects`, `rootDepths`, `layouts` and
`connections`, with optional `namedViews`, `connectionRepairs` and `extensions`.

Objects form an acyclic forest. Each has one `parentId`, or null for a root.
Rectangles, ellipses, diamonds and frames can contain children. Lines/arrows are
connections. IDs are opaque, map keys must match record IDs, and prototype keys
are rejected. New authoring uses fresh IDs. Unknown extension JSON is preserved;
recognized extensions must also pass their consuming operation's validation.

Content, style, ownership and boundary points belong to the object across depths.
Shape fills support solid, none, hachure and cross-hatch, with transparent gaps
for patterns. Corner radius is a numeric style value; quick controls use 0 or 12,
and Properties accepts custom values. Stroke width/dash, color and opacity remain
shared across views. Object links are separate from rich-text links.

Geometry is `{x, y, z, width, height, rotation}`. X/Y are centers in canvas units,
positive Y points down, dimensions are finite and positive, Z is an integer
stacking order, and rotation is in degrees. Authored rotations normalize to
[0, 360). Roots use world coordinates; children use parent-local coordinates and
inherit ancestor translation/rotation. Resizing a parent neither scales children
nor changes their coordinate origin.

`layouts[rootId][depth][objectId]` stores depth-specific geometry. D0 and the active
depth must exist, with geometry for every depth-revealed member. Additional hidden
entries and inactive depths beyond the current maximum can retain authored data;
foreign/missing object references are invalid. First use copies the closest lower
saved depth, or the closest higher one if none is lower. Newly revealed members
use their nearest saved geometry (lower depth wins ties), otherwise their seed.
This initializes a layout without automatic neighbor movement.

## Visibility and remembered arrangements

A root's integer depth reveals generations from zero through that depth, unless
an ancestor is locally collapsed. `extensions.collapsedObjects` stores those
local folds. An expanded parent retains its own outline, title, style and
rotation. Its body is omitted from canvas/export while children are shown, but
remains editable and saved. Clipping is optional and off by default. The editor
adds no dotted child enclosure or substitute frame.

Ordinary collapse folds only that parent and preserves descendants' disclosure.
Reopening restores those descendants. Ctrl+click on the stack control folds the
whole subtree; the next reveal opens only immediate children. Newly reachable
levels start folded. The control is fixed in screen size, follows the upper-right
rectangle/frame corner or diamond/ellipse outline, and has a light gray border
when collapsed. A single leaf child uses two stacked squares; other branches use
three. Controls never appear in exports.

Local child disclosure runs auto-arrange: separate overlapping children, grow
parents with title/padding space, and push colliding sibling groups through the
ancestor chain and canvas. Children are not scaled and connector routes are not
layout obstacles. Shrinking an ancestor still fits every visible child, including
siblings with live edits. Opening a remembered state checks newly conflicting
neighbors too. Manual drag/resize does not continuously run this arrangement.

`extensions.expansionLayouts` version 2 stores sparse geometry per effective
branch/depth context:

- The toggled subtree and affected ancestors retain positions and sizes.
- Neighbors actually displaced by arrangement retain positions only. Their live
  size is preserved, and unrelated objects are not restored from a full snapshot.
- Leaving a state captures its manual edits. Returning restores that state; an
  unseen state uses the closest applicable subset and then arranges as needed.
- Deleted/reparented entries are pruned; newly created geometry stays live. Older
  version-1 memory drops unrelated full-scene entries when consumed.
- Content, style, connections, Z, rotation and camera are not expansion snapshots.
  The data survives save/reopen and recovery, without creating user bookmarks.

Explicit root-depth commands choose that depth's layout and clear folds for the
root. Selecting the same depth is a no-op only if no folds/context changes need
clearing. Bookmark application resets expansion memory's active context.
Animation bounces when opening and eases when closing; attached endpoints follow
it. Reduced motion, interruption and export use the accepted final state.

## Authoring, containment and stacking

Direct movement changes the active layout only. Reparenting preserves the moved
object's world center/rotation and its descendants' local geometry. Drag adoption
uses the actual outline, chooses deepest candidate then Z, area and ID, and needs
400 ms of intentional hover. Current-parent tolerance is eight screen pixels.
Resizing across another shape does not adopt it. A canceled drag restores its
starting state. Drawing a shape inside a container creates a child and reveals its
branch; dropping into a collapsed container keeps it collapsed.

When ancestry changes from generation `g` to `h`, source depth `d` maps to
`d - g + h`. Destination layouts initialize before insertion. Negative translated
keys and conflicting geometry are retained in `extensions.layoutArchive`, with
source/destination root/depth, parent, subtree geometry and move provenance.
Inverse moves can restore exact original arrangements without losing newer edits;
undo restores the exact transaction state instead of reversing arithmetic.

Deleting a parent removes its entire subtree, hidden children, associated layouts
and internal connections. Surviving outside connections detach at their last world
endpoint, converted to their owner's coordinates. Deleting a boundary point
similarly detaches its endpoints without deleting the connections.

Objects and connections paint in ascending Z within their owning scope. A
connection has its own Z, independent of its attached objects and shared across
depths. At equal Z, connections precede objects, with ID tie-breaking. A parent's
background precedes its contents. Layer commands use that same ordering.

Duplicate includes selected subtrees, hidden children, saved layouts, styles,
boundary points and internal connections with fresh IDs. Ctrl/Cmd+C captures a
snapshot; Ctrl/Cmd+V creates new IDs for every paste and offsets down/right by
24 canvas units per paste. Same-document pastes can retain an expanded owner;
otherwise roots retain their world pose. Copied external endpoints become free;
explicit Duplicate can retain outside bindings. Both create one undo entry.
Inside text editors, clipboard shortcuts continue to operate on text.

## Connections and repairs

Connections have an ID, `ownerId` (container or null for canvas), kind, Z, style,
label, endpoints and optional interior `points` in owner-local coordinates.
Endpoints are free local points, object side/offset attachments, or object boundary
point IDs. Boundary points use top/right/bottom/left and offset [0, 1]. A ray from
the center through that rectangle-side position intersects the actual outline,
including rounded corners, diamonds and ellipses. Handles and routes share this
projection at every depth and rotation.

Ordinary new lines have free endpoints. The Arrow tool binds near/inside visible
shapes; Ctrl/Cmd disables binding. Hovering a target shows four anchors: rectangle
side midpoints, diamond vertices, or ellipse cardinal points, following the shape's
rotation. Creation and endpoint dragging snap within 12 screen pixels of an anchor
and release beyond that radius. Between anchors, dragging near the outline follows
the pointer; dragging into the shape uses an automatic attachment.
`binding: "auto"` follows the adjacent path vertex. `"fixed"` prefers its authored
side/offset while the next path segment faces out of the shape (inward for an
endpoint on its own container), then slides along the visible outline until that
point faces the connection again. Neither sliding nor moving shapes changes the
saved preferred point. Both modes leave an eight-unit outline gap, inside the
border for container endpoints. An absent mode uses the authored attachment
without an added gap. Straight routes join vertices, curved routes use cubic
Beziers, and elbows use orthogonal segments. Labels follow arc-length centers.
Creation uses world points; endpoint/point edits use owner-local points.

The Style panel no longer adds or repositions custom boundary points. Existing
named points remain stored for compatibility and inward bridges, and their canvas
handles are stationary. Selected connector endpoints take priority over these
handles, so a normal endpoint drag reattaches or detaches the connector without
moving its old point. MCP boundary-point commands remain available for stored
documents and bridge authoring.

The Arrow tool connects outside objects directly to children inside other
containers, in either direction and across multiple nesting levels. Endpoint
dragging supports the same attachments. Routes belong to the nearest common
container, or the canvas across roots, and paint above containers they enter.
Parent-border connections and existing named boundary bridges remain supported.

When an attached child is hidden by collapse or a depth change, its endpoint draws
on the nearest visible ancestor's outline. Expanding restores the exact saved
child attachment, including its preferred side and offset. This is a display
projection; collapse never changes the saved target. A route whose endpoints
project onto the same collapsed container stays hidden. Routes owned by a collapsed
container also stay hidden, including free-ended routes. Selection, hit testing
and exports use the displayed path.

Structural changes recompute ownership and transform free endpoints/vertices
through world space. Cross-container moves keep their arrows connected. Legacy
`connectionRepairs` remain supported: users can select a replacement segment to
inherit the original ID, label, kind, style and order. Resolving removes only that
repair in one transaction. Pending repairs persist across save/reopen and never
draw or export.

## Rich text and code

The native content model uses paragraphs, headings (levels 1–6), nested ordered or
unordered lists, quotes and code blocks. Text runs support bold, italic, underline,
strikethrough, font, positive size, color and links. Paragraph/heading alignment
is stored per block. Ordered lists can have a positive starting number. No HTML
or editor-library AST is persisted; unsupported block types are rejected.

Whitespace and Unicode remain intact. Code preserves tabs, CRLF and final
newlines; tabs display at four-column stops. Syntax highlighting is derived, not
saved. Languages are `javascript`, `typescript`, `json`, `yaml`, `python`, `sql`,
`bash`, `csharp`, `java`, `html`, `css` and `plaintext`. Code wrapping defaults off;
prose wraps. Body content clips vertically rather than automatically resizing the
object. Font families use local fallbacks and are not embedded in exports.

Object `style.link` and rich-text links accept absolute HTTP, HTTPS and mailto
URLs; controls, embedded credentials and executable/file schemes are rejected at
validation and activation. Imported clipboard HTML is reduced to supported text
structure/marks. Documents do not execute code or fetch linked content merely by
opening or painting it.

Double-click object text to edit inline. Clicking outside, Escape or Ctrl/Cmd+Enter
**accepts** an inline edit. Properties forms have explicit Apply/Cancel controls;
gesture Escape cancels that gesture. Before a session transition, the draft guard
offers explicit apply/discard/cancel. Drafts are not recovery checkpoints.

## Bookmarks

`namedViews` stores named depth maps with optional fold, geometry and camera data.
New/reset bookmarks capture each root's active layout, including collapsed
members: X/Y/width/height and parent identity, plus world camera focus and zoom.
Application recomputes pixel offsets for the current viewport. Legacy bookmarks
without focus use raw offsets; bookmarks without geometry retain their narrower
scope until reset. A missing camera leaves navigation unchanged.

Apply clamps stale depths, ignores deleted entries and defaults missing roots to
D0. It never resurrects objects or changes ownership. Geometry applies only where
parent identity still matches. Content, styles, rotation, Z and other depth
layouts stay current. Stale bookmark entries remain stored until explicitly
updated/deleted. Create, reset, rename, duplicate, delete and apply are undoable;
apply is one compound operation, including camera where present. Busy drafts or
gestures must be resolved first. Pan/zoom never overwrites bookmarks.

## Sessions, history and persistence

One renderer owner publishes validated transactions atomically as accepted,
no-op or rejected. A gesture has a draft and one accepted commit, not one undo
entry per pointer frame. New accepted edits clear redo. Undo/Redo restores exact
before/after state. Dirty state compares against the last successfully saved
snapshot, ignoring modification metadata; Save keeps session history. New/Open/
Reload/Restore creates a fresh session even for the same persistent document ID.
History, selection and ordinary camera navigation are not saved in the file.

Resolve active drafts before the accepted-unsaved-work Save/Discard/Cancel guard.
A canceled/failed save blocks the transition. Native writes validate a complete
snapshot, write a temporary file and atomically replace the selected destination.
A source fingerprint change requires Save As or explicit overwrite consent;
further external changes invalidate that consent. Saving an older captured
revision never marks newer edits saved.

Recovery runs separately from source-file Save: approximately one second idle,
or at most five seconds of continued editing since acknowledgment. One write is
in flight at a time and newer work coalesces. Failures degrade recovery status;
this is best-effort scheduling, not a durability deadline. Checkpoints include
complete accepted documents, inactive layouts, extensions, session/revision/time
and source provenance. They exclude drafts, undo history, camera and selection;
a stored source path is not permission to overwrite it.

Save retires only the captured recovery revision. Discard/clean close waits for
pending checkpoint handling before cleanup. Restore creates a fresh dirty session;
the old entry is retired only after replacement checkpoint acknowledgment or
explicit discard. Corrupt entries are quarantined. Native crash/unresponsive
handling offers restart/quit/cancel; restart or a later launch offers recovery.
Keep separate backups of important documents.

## Export

Whole-document export includes all currently revealed content across roots,
including offscreen objects. Selection includes visible selected objects and
revealed descendants, deduplicated. Unselected ancestors supply transforms,
opacity and clipping but are not painted. Connections are included if explicitly
selected or if both attached endpoint objects are in scope; a free-ended line
needs explicit selection. Boundary points belong to their owning object. No scope
reveals hidden children or includes pending repairs.

Export captures committed geometry, not animation/drafts, selection handles,
stack controls or camera position. Bounds use painted ink, including rotations,
strokes, hatching, markers, labels, overflow and clips, with 16 logical units of
padding per side. SVG keeps vector geometry/text; PNG uses logical canvas pixels
at pixel ratio 1 with ceiling-rounded dimensions. Both have white backgrounds
and no interactive links/bookmarks. Empty scope fails without writing.

Large PNGs use tiled canvas rendering and native streaming encoding, so the
single-canvas 32,767-pixel limit is **not** the image width limit. The encoder caps
one RGBA row/chunk at 8 MiB (width at most 2,097,152 pixels) and height at
2,147,483,647 pixels. These are validation limits, not usable-capacity promises:
compressed output still needs memory, disk space and time. Allocation, rendering,
encoding or I/O can fail much earlier. Use SVG or a smaller selection when needed.
See [recursiveExport.ts](../src/renderer/utils/recursiveExport.ts) and
[png_export.rs](../src-tauri/src/png_export.rs).

Canceled/failed export preserves the destination and document/history/dirty state.
Successful export is not an editable-document Save. MCP JSON export writes the
whole editable document rather than a graphical selection.
