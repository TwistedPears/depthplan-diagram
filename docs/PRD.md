# DepthPlan product requirements

DepthPlan gives solution architects and technical leads one diagram that can be
read at different levels of detail. Engineers and business stakeholders can start
with a system overview and reveal the components, explanations and implementation
details they need, without maintaining separate copies of the same system.

The primary workflow is: create an overview, add nested components, connect them,
arrange and bookmark useful views, save the document, and export a view for sharing.
Success means readers can find the current system design from a familiar top-level
object. No numerical usability or unlimited-capacity claim is established.

This document defines product scope. The [document and editing reference](document-and-editing.md)
defines exact behavior; [architecture](architecture.md) describes implementation;
[release requirements](release.md) distinguish development targets from approved support.

## Objects, depth and arrangement

- Rectangles, ellipses, diamonds and frames can contain children recursively. Each
  object has one identity, one parent and shared content/style across all views.
  Lines and arrows are connections with their own stacking order, including when
  attached to objects. Leaves need no special terminal generation.
- Each top-level root has an independent depth: D0 shows the root, D1 adds its
  children, D2 adds grandchildren. Reveal all selects the deepest existing level.
  Navigation stays on the same infinite canvas.
- Local child controls independently open or close branches. Ordinary collapse
  remembers descendant disclosure, so reopening returns to those children.
  Ctrl+click collapses the entire subtree. The stack control follows the parent's
  upper-right corner or actual diamond/ellipse outline.
- Each root depth stores its own geometry. Children use parent-relative centers;
  moving a parent carries its subtree. Newly visited depths inherit a deterministic
  initial arrangement. Direct manipulation and numeric editing provide precise
  positioning, sizing and rotation; resizing does not scale children.
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

## Connections and content

Connections support free or attached endpoints, boundary points, explicit inward
bridges, straight/elbow/curved routes, editable bends, labels, styles and independent
endpoint markers. Outside objects can connect directly to nested children.
Collapsing a container projects external child attachments onto its visible border;
expanding restores the saved child attachment. Internal routes stay hidden while
their owner is collapsed. Cross-container moves keep arrows connected, and pending
repairs from older documents remain available for explicit resolution.

Objects support mixed rich text: paragraphs, headings, nested lists, quotes,
alignment, links, bold, italic, underline, strikethrough, font, size and color.
Code blocks preserve exact source text and optional wrapping. Highlighting covers
JavaScript, TypeScript, JSON, YAML, Python, SQL, Bash, C#, Java, HTML and CSS, with
plaintext fallback. Code is displayed, never executed. Expanded parents show their
title and children while retaining their own body content for editing.

Search includes hidden objects and their text; choosing a result reveals its
ancestry, selects it and brings it into view. Selection controls provide relevant
styling and arrangement actions with accessible names for icon controls.

## Views, files and recovery

Bookmarks persist named views of root depths, local folds, positions/sizes and
camera focus. Create, apply, reset, rename, duplicate and delete are undoable.
Applying a bookmark preserves current content, styles, ownership and object
existence. Pan/zoom alone is transient and does not dirty the document.

The editable file is the sharing unit. New/Open/Reload/Save/Save As preserve the
complete current-format document, including inactive layouts and bookmarks.
Unsupported versions and malformed documents are rejected without replacing the
open document. Writes are atomic; external source changes require an explicit
conflict decision. Shared storage does not imply simultaneous collaboration.

Accepted edits, including depth changes, participate in session Undo/Redo. Save
preserves history; replacing the session resets it. Unsaved-work and active-draft
guards protect document replacement and quit. Failed or canceled saves do not
silently discard work.

Local recovery checkpoints preserve accepted unsaved edits separately from source
files. Restore creates unsaved work for explicit saving. Recovery is best effort,
not a source-file autosave or backup guarantee; drafts and undo history are not
recovered.

Static SVG/PNG exports include the current revealed scene, including offscreen
content, for either the whole document or a selection and its revealed descendants.
They exclude editor controls, hidden children and pending connection repairs.
Editable JSON remains available separately.

## Local automation

The opt-in local MCP server lets an external client inspect and author the live
document, navigate, manage bookmarks/history, and perform approved file operations.
UI and MCP share one command layer, validation, dirty-state and recovery behavior.
Session/revision guards prevent stale edits; mutations are atomic and retry-aware.
The server starts Off, disk access needs local folder approval, and credentials
stay in the native host. No built-in model account or hosted API is required.
See [MCP](mcp.md) for setup and the tool contract.

## Validation and scope limits

Target platforms are macOS, Windows and Linux. Apple Silicon is the first macOS
acceptance target; Intel Mac is deferred. Windows x64 and Ubuntu x64 require their
own native validation. Configured build targets do not establish release support.

The canvas has no fixed page boundary or chosen product object-count cap. Its
usable capacity depends on revealed objects, nesting, connections, text, layouts,
history and available memory. Use the fixed [development budgets](development.md#capacity)
and exact installed-candidate checks; do not substitute a large fixture for
measured responsiveness. Curated [samples](sample/README.md) demonstrate behavior;
stress documents are generated on demand.

A real-project usability study can guide further polish. Full Markdown, cloud
sync/collaboration, executable code, embedded documents/media, tables, multiple
owning parents/aliases, custom shape marketplaces, permanent change history and
automatic updates are outside the current scope.
