# Projects

A project groups independent diagrams into one folder. Open its `.depthproject`
file to navigate the boards together. Each `.depthplan` board remains a complete
version-2 diagram that can be opened independently after closing the project.
Existing `.depthplan.json` diagrams remain supported.

## Start and navigate

Use **Menu → New Project** to wrap the current board in an **Untitled Project**
in memory. Its content, selection, view and Undo history stay intact, with no
board save prompt. If no board is open, the project starts with an **Untitled
Board**. New boards also start in memory without a naming prompt. No project
folder or board file is created yet.

Double-click the project title above the Boards list or a board name to edit it
inline. Enter or Tab commits; Escape cancels. Keyboard users can press F2 on the
focused name. The first **Save All** or **Save Project As…** opens the
native save dialog, suggesting the project name in snake_case. Choose the
`.depthproject` file; all boards, including closed boards, are saved beside it. Board filenames use snake_case
(`API Details` becomes `api_details.depthplan`); repeated names receive `_2`, `_3`
and so on. Existing files are never overwritten by the first save. Canceling or
failing the save keeps the project in memory. Successful saving preserves open
boards' undo histories and enables automatic saving.

Closing or replacing an unsaved project asks **Save / Discard / Cancel**, even
if its boards have no edits. Applying or discarding an editor draft is separate
from saving accepted work. Canceling any required guard keeps the workspace.

**Open Project…**, **Open Recent** and native file-open events use the same
lifecycle guards. Opening the same canonical project focuses the existing
workspace. A second application cannot acquire its writer lock. A copied folder
is a different local workspace even when its persistent project ID is unchanged.

Use the vertical **Project** button on the right edge to open the drawer and
switch boards. The button hides while the drawer or a project dialog is open.
The drawer’s right-pointing arrow closes it and restores the button. Boards sort by name, ignoring case and ordering numbers naturally
(for example, Board 2 before Board 10). Names can repeat, so filenames distinguish
them. Use arrow keys and Home/End in the drawer;
Enter/Space activates a focused control. Switch boards without losing accepted
edits, local undo, selections, cameras or suspended drafts. Only the active canvas is mounted.

Right-click a board and choose **Close board** to close its editing session while
keeping its contents in memory or its saved file, and its project membership. Reopening that board creates
a new editing session and a new undo history. Undo is local to a live board and is
not stored in the project or restored after closing/restarting.

## Manage members

Right-click a board for **Rename**, **Duplicate**, **Remove from Project** and
**Close board**. Keyboard users can press Shift+F10 or the Context Menu key on a
focused board. Ordering updates automatically when a board is added or renamed.

- **New Board** creates a fresh independent document and opens it.
- **Import Boards…** copies supported diagrams into the project with fresh document
  IDs. Source files are unchanged. Multiple imports report individual failures and
  retain successful copies.
- **Duplicate** copies accepted content, geometry, connections and bookmarks with
  a fresh document ID. Unapplied form drafts are not part of a copy.
- **Rename** edits the name inline and generates its snake_case filename after
  resolving that board's pending work. Double-click the filename below the name
  to choose the exact filename instead; Enter or Tab saves that change on disk,
  appending `.depthplan` when needed. Escape keeps the previous filename. This
  also works for saved standalone boards. Unsafe names, collisions and unsupported case-only renames
  are rejected without silently overwriting another file.
- **Remove from Project** removes membership after resolving the open board. Its
  saved file remains on disk; an unsaved board is discarded. Removing the home
  board clears the home setting.

An unlisted board is retained and reported for explicit import; it is never
silently adopted or deleted. Interrupted create/import/rename work can leave
recoverable output with a persistent diagnostic. Inspect it before retrying.

## Project title and local navigation

Editing the project title updates the shared manifest atomically once saved.
It has no board-level Undo action. The Project Settings dialog has been removed;
existing description and home-board metadata remain compatible.

Open boards, active board, cameras, drawer state, window size and Recent Projects
are local preferences. Reopening restores valid local boards first. With no usable
local state, DepthPlan tries the home board, then the first healthy member. A
saved workspace with no open boards stays empty. Missing boards are skipped and
reported; malformed preferences fall back without changing project files.

The **Recent Projects** submenu shows the latest five projects from local history.
Selecting an unavailable entry opens **Locate…** to find a moved folder; matching project
identity with a missing old location offers a choice to restore its workspace or
start fresh. Copying a folder does not silently inherit the original location's
navigation state.

## Saving, conflicts and recovery

Project autosave writes accepted board changes after about one second of idle
editing, with a five-second scheduling bound during continuous edits. Active
gestures, file operations, transitions and MCP decisions defer that work. Hidden
open boards retain their own autosave owner. No unapplied draft is written.

Autosave is enabled by default and can be changed in Settings. **Save All**
flushes pending board edits immediately; project metadata saves when edited.
A superscript `*` after a board name marks unsaved work, including unapplied drafts;
its tooltip includes “Unsaved”. The filename appears below the name. Autosave
shows no transient notifications. Manual operation messages appear as plain text
at the bottom of the canvas. An older write acknowledgement cannot mark newer
edits saved.

A failed save pauses automatic retries for that board and retains accepted work.
Use its persistent conflict/error control in the drawer to retry, save a copy, reload through guards, or
explicitly overwrite the observed source. Board and manifest changes on disk are
checked separately. A second external change invalidates the previous overwrite
consent. Healthy boards can continue saving while another has a conflict.

**Save Project As…** copies the project and all its boards to a new location,
including accepted edits in open boards and the saved contents of closed boards.
Choose a new folder so existing board files do not collide. DepthPlan switches
to the copy while preserving open boards, undo histories and views. The original
project and boards remain unchanged. Canceling or failing the save keeps the
original workspace; existing files at the destination are never overwritten.

**Save Board As…** creates an independent file with a fresh document ID for a
project board. It keeps the original project association and unsaved status. Choose copy and export
locations outside an open project folder: its native writer lock protects that
folder from independent file writes. Closing a project releases the lock; the
small `.depthproject.lock` file may remain safely on disk.

**Close All**, replacing the workspace or quitting considers every open
board. Accepted changes save automatically before closing, without a review sheet.
A failed save keeps all sessions open for repair. Drafts still need an explicit
apply/discard decision; canceling it keeps all sessions. A running MCP operation
must finish or be canceled first.

Recovery checkpoints are local crash protection, not portable backups. Restored
work retains its originating project/board labels but opens as a fresh standalone
session. Save it to a safe location before replacing any project source. Recovery
cannot infer that a source still belongs to the same project or overwrite it
merely because its old path matches. Unsaved drafts, undo history, a full disk,
unavailable storage and abrupt failures can limit what is recoverable.

## Share or move a project

Close the project, then copy or move **the complete folder**, keeping the relative
layout of its board files. The manifest contains membership and settings, not
embedded board content. Sending only `.depthproject` is insufficient. Local open
boards, recent entries, undo and recovery checkpoints are not part of the shared
folder.

There is one writer per project location. This is folder-based sharing, not live
collaboration or sync conflict resolution. Keep backups before manual edits or
cloud-sync reconciliation. A malformed manifest never replaces the current
workspace; missing, corrupt or identity-mismatched boards never replace healthy
ones. Paths are inspected when opening a project; board contents are validated
on demand when each board opens. Diagnostics remain actionable without rewriting
unrelated files.

## Technical boundaries

The version-1 `autosave` field remains readable for compatibility; it no longer
disables automatic saving in the app. Editing the project title writes it as `true`.

The manifest is strict version 1 JSON, at most 1 MiB and 1,000 members. Member IDs
must match their document IDs. Paths are relative, contained, portable and unique
under case-insensitive comparison; symlink escapes and unsupported versions are
rejected. [Project contracts](../src/shared/projectContract.ts) and
[native storage](../src-tauri/src/projects.rs) are authoritative.

The native owner validates identities, ownership, paths and expected file bytes
before atomic publication. Multi-file creation and rename can leave explicit
recoverable intermediates when interrupted; they are not a filesystem-wide
transaction. Local navigation uses `DepthPlan/workspaces.json` beside local
recovery storage and never changes the manifest or board merely to remember a view.

[MCP](mcp.md#projects-and-explicit-board-targets) exposes persistent membership
separately from live session handles. Opening a project grants no MCP folder
access. Explicit saves, reloads, exports and unopened-board reads require local
grants. Edits to loaded project boards save automatically.

## Search project content

Use the top toolbar's **Search boards** button to search every board's object
names and rich text/code, connection labels and bookmark names, including hidden
descendants. Enter a query and press Enter. Open boards contribute
accepted in-memory content, including unsaved changes; unopened boards are read
and validated from disk without opening editing sessions or canvases. Unapplied
drafts are not accepted content.

Results group by board in project order and list objects, connections and
bookmarks in stable ID order. Board paths and entity IDs distinguish duplicate
names. Search stops at 500 results; narrow the query for more specific matches.
**Stop search** retains partial results and ignores pending reads. Unreadable
boards are reported alongside healthy matches. A single native read completes
before its result can be ignored; no persistent search index is created.

Tab to a result and press Enter to open and reveal its exact target. Searching
itself does not change content, Undo history, selection or camera. Explicit reveal
or bookmark application follows normal editor semantics and may add an Undo
step. If membership, a live revision or an unopened source changed, repeat the
search; stale results never select an entity by a similar name.

## Link boards and bookmarks

Select one object and choose **Add project link** in its selection controls. Pick
an available project board and, optionally, a bookmark, then **Save link**. The
picker reads accepted bookmarks from an open board or validates an unopened file
without opening an editing session. Link edits use normal Undo and saving.

**Open link** opens that exact board and applies its bookmark when specified.
**Menu → Back to previous board** (also in the board drawer) restores the previous
board, camera and still-visible selection. It does not undo edits or restore old
content. The last 32 return positions live only in the current project session.

References use stable project, board and bookmark IDs. Renaming, reordering and
moving the complete project folder preserve targets. A copied project resolves
inside the opened copy. Missing boards/bookmarks and references to another
project report an unavailable target; **Change project link** repairs it or
**Remove link** removes it. No title matching or external file lookup is attempted.
A board opened standalone shows its project links as unavailable; open its
complete project to follow them.

Object and board duplication, import, clipboard and editable JSON exports retain
references exactly. A duplicate's self-link therefore still targets the original
board. Importing into another project leaves foreign references unresolved until
you choose replacement targets. PNG/SVG exports contain no interactive project
navigation. Internal links are separate from external web links.
