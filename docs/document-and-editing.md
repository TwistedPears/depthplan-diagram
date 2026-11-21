# Document and editing reference

This is the current file and editor behavior contract. Executable validation lives
in [recursiveDocument.ts](../src/shared/recursiveDocument.ts); shared operations
and their tests define detailed edge cases. [PRD](PRD.md) describes product scope.

## Format and identity

DepthPlan diagrams use `.depthplan` files containing ordinary JSON. Existing
`.depthplan.json` files remain supported. **Save All** writes to the exact opened
filename; **Save Board As…** suggests the same basename with `.depthplan`, leaves the
original file intact, and makes the selected copy the current save destination
in standalone mode. In a [project](projects.md), Save Board As creates an independent
copy with a fresh identity while retaining the project source and dirty state.
New documents default to `untitled.depthplan`. Editable document exports also
default to `.depthplan`. This naming change does not change the document format.

The Open dialog accepts `.depthplan` and `.json`; contents must pass the same
validation regardless of extension. Packaged applications register `.depthplan` and `.depthproject`,
not generic `.json`. OS file-open requests use the same draft and unsaved-work
guards as Open. Multiple requests are handled in order; canceling one preserves
the current document. Finish an active gesture before retrying an open request.

Only `formatVersion: 2` is accepted. Missing/unsupported versions and malformed
input fail without replacing the current document or modifying the source file.
The document contains `id`, `metadata`, `objects`, `rootDepths`, `layouts` and
`connections`, with optional `namedViews`, `connectionRepairs`, `tagDefinitions`
and `extensions`.

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
Objects may also carry `projectLink: { projectId, boardId, bookmarkId? }` for
[internal project navigation](projects.md#link-boards-and-bookmarks). This optional
v2 field is retained by older v2 readers that preserve unknown object properties,
but those readers cannot activate it. Current TypeScript and native readers
validate its exact keys and bounded identities. It contains no path or URI and
does not expand the external URL allowlist.
New shapes and connectors use the 2px Thin stroke preset, selected in Style on
creation. Older 1.5px Thin strokes are also recognized without changing their
stored width.

Geometry is `{x, y, z, width, height, rotation}`. X/Y are centers in canvas units,
positive Y points down, dimensions are finite and positive, Z is an integer
stacking order, and rotation is in degrees. Authored rotations normalize to
[0, 360). Roots use world coordinates; children use parent-local coordinates and
inherit ancestor translation/rotation. Resizing a parent neither scales children
nor changes their coordinate origin.

To rotate a selected shape, move just outside any resize handle until the rotation
cursor appears, then drag around its center. Rotation uses whole degrees. Pull
40 screen pixels farther from the center to snap to 15° increments; move inward
again for 1° increments. The angle and snapping mode appear during the gesture.
Children rotate with their parent, and attached arrows follow their shapes.
Release to commit one Undo step, or press Escape to cancel.

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
levels start folded. The control stays upright inside the visual upper-right
part of its shape, even when the shape or its ancestors rotate, with space for
the border and rounded corners. It shrinks with zoom,
becomes a clickable blue dot below 60%, and returns to the stack icon when
zooming in, capped at 32 screen pixels. Small shapes also shrink the control to
fit their interior. Panning does not pin it to the viewport edge.
The icon has a light gray border when collapsed. A single leaf child uses two
stacked squares; other branches use three. Controls never appear in exports.

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

### Automatic layout

The MCP `layout` edit action arranges a container's visible direct children in
the active layout of its root's current depth. Children hidden by depth or a fold
are skipped (so a folded or leaf container is a no-op), and other depths are not
written. Each child keeps its size, rotation, Z and local subtree; spacing uses its
stroked footprint including visible descendants. `row`/`column` order children by
current position; `grid` uses uniform cells of the largest footprint. `layered`
ranks children by connector direction (start to end, attached to the child or any
descendant): every connector outside a cycle points to a later row/column, and
members of a cycle share one. A barycentre pass orders each rank to reduce
crossings; ties use current position, then ID. `gap` separates neighbors and ranks.

The block is centered horizontally and starts `padding` below the top edge (at
least 44 units, clearing the title and stack control). The parent grows to fit
with `padding` on the other sides, then ordinary expansion fitting grows
ancestors and pushes colliding neighbors as disclosure does. Ellipse and diamond
parents can grow further to inscribe the block. Layout is one atomic edit and Undo
step. It is not a persistent constraint: later edits do not rerun it.

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
Beziers, and elbows use orthogonal segments. Labels follow arc-length centers,
or `style.labelPosition` (0–1, a fraction of the displayed path length).

`style.avoidShapes: true` on an elbow connector without bends (Style: **Elbow
path around shapes**) routes it around the visible shapes and frames in its
container, including siblings of nested endpoint ancestors. The router picks the
side facing the other end and spreads connectors sharing a side; `fixed`
bindings, boundary points and rotated targets keep their attachment. Connectors
sharing a corridor get parallel lanes, and labels without `labelPosition` slide
along the path away from shapes and other labels in the same container. These
routes are derived for canvas, hit testing and SVG/PNG export, deterministic
(ordered by connection ID) and never saved; authored bends always win. Curved
and straight connectors are unaffected.
Creation uses world points; endpoint/point edits use owner-local points.

Optional `depthRoutes` lets one connection keep a different route per depth:
`depthRoutes[depth]` may hold `points`, `start` and/or `end`, and each present
field replaces the shared value at that depth. The depth is the active depth of
the connection's **route root**: the owner's root, or for an unowned connection
the single root of its bound endpoints. Free-free lines and canvas connections
between two roots have no route root and always use the shared route. Override
endpoints keep the shared endpoint's target object (or stay free), so changing
which object an endpoint binds to always edits the shared endpoint and drops
that endpoint's overrides. Switching depth or applying a bookmark shows the
matching route; folds do not change the key. In Style, **Route** switches a
single connection between the shared route and its own route at the current
depth. Dragging points, segments or endpoints edits whichever route is shown;
moving an overridden route into another container requires the shared route.
Deleting endpoint objects or boundary points prunes affected overrides.
Reparenting or pasting shifts owned overrides with the owner's layouts
(`d - g + h`); changing a connection's owner, or an unowned route root, drops
them. Duplicate keeps them, and switching to a straight path clears their bends.

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

## Tags and legends

Optional `tagDefinitions` maps a stable tag ID to `{ id, name, color, strokeStyle? }`
(`solid`, `dashed` or `dotted`). Objects and connections carry an optional `tags`
array of those IDs. Validation checks both shapes but ignores IDs without a
definition, so pasted or hand-edited files still load; rendering, queries and the
legend skip them. Names are unique ignoring case. Deleting a definition removes it
from every object, connection and pending repair in the same Undo step.

Tagged objects show colored pills in one row at the lower left of their text area,
which is reserved below the body text; pills that do not fit collapse into `+N`.
The row is reserved whenever `tags` is non-empty, even if no ID is defined.
Connection pills sit under the label, or on the path middle without one. A tag's
line style applies to a connection that has no `strokeStyle` of its own; choosing
any stroke style in Style overrides it.

Any object with `style.legend: true` replaces its body with a legend derived while
painting: the tags in use (name, color, line style, count), then up to 12 explicit
object fill colors and connection stroke/style pairs, most used first. Legend
objects are excluded from the counts. The legend is ordinary rich text, so it
exports to SVG/PNG, fits and clips like other content and never goes stale.

Select shapes or connectors to add, create or remove tags under **Tags** in Style;
**Manage tags** renames, recolors, sets line styles and deletes definitions, and
**Show tag legend** marks a single selected object. Board search accepts
`tag:Name` or `tag:"Two words"` terms; with no other words it lists every object
with that tag.

Duplicate keeps tag IDs. Copy carries the definitions it uses. Pasting or inserting
a template into another board keeps a definition with the same ID, reuses a tag
with the same name, and otherwise adds the source definition. Templates retain
their `tagDefinitions`.

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
prose wraps. Font families use local fallbacks and are not embedded in exports.

`style.fit` chooses what happens when body text is taller than its box (Style →
**Text fit**). `clip` (the default) clips vertically and leaves the object alone.
`grow-height` grows the object's height in the active layout during any accepted
edit that changes its text, name, tags, shape, width or fit, in that edit's Undo
step. Growth never shrinks an object, keeps its top edge fixed, and lets parents
and neighbors make room with the auto-arrange rules. Other depths keep their saved
size until the object is edited while they are active, or until that depth's
layout is first created for it. Resize and drag previews do not grow; their commit
does. Painting never creates
edits. `shrink-text` scales the body text uniformly while painting, down to 60%,
and clips below that. Horizontal overflow of unwrapped code is not measured.

Clipped bodies show a small red `…` marker in the lower-right corner, also in
SVG/PNG exports. A body too short to paint (10 units or less) with content counts
as clipped. Expanded parents, whose bodies are not painted, never count. Overflow
uses the renderer's text metric and bounds, which include the tag-pill row but not
the zoom-dependent space beside a child-stack control.

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
Application recomputes pixel offsets for the current viewport. Each canvas
remeasures the window whenever its board is shown, so a project board that was
hidden during a window resize reports and uses its real viewport. Legacy bookmarks
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
