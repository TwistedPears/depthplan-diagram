# Projects

A project groups independent diagrams into one folder. Open its `.depthproject`
file to navigate the boards together. Each `.depthplan` board remains a complete
version-2 diagram that can be opened independently after closing the project.
Existing `.depthplan.json` diagrams remain supported.

## Start and navigate

Use **Menu → New Project…** to choose a name, portable folder name and parent
folder. Start with a blank board or copy the current accepted diagram. Applying or
discarding an editor draft is separate from saving accepted work. Canceling any
required guard keeps the current workspace.

**Open Project…**, **Recent Projects…** and native file-open events use the same
lifecycle guards. Opening the same canonical project focuses the existing
workspace. A second application cannot acquire its writer lock. A copied folder
is a different local workspace even when its persistent project ID is unchanged.

The drawer lists members in project order; the tab strip lists open boards. Names
can repeat, so filenames distinguish them. Filter the drawer by board name. Use
arrow keys and Home/End in the tab strip or drawer; Enter/Space activates a focused
control. Switch boards without losing accepted edits, local undo, selections,
cameras or suspended drafts. Only the active canvas is mounted.

Closing a tab keeps its file and project membership. Reopening that board creates
a new editing session and a new undo history. Undo is local to a live board and is
not stored in the project or restored after closing/restarting.

## Manage members

- **New Board** creates a fresh independent document and opens it.
- **Import Boards…** copies supported diagrams into the project with fresh document
  IDs. Source files are unchanged. Multiple imports report individual failures and
  retain successful copies.
- **Duplicate** copies accepted content, geometry, connections and bookmarks with
  a fresh document ID. Unapplied form drafts are not part of a copy.
- **Rename** changes the member label and reviewed filename after resolving that
  board's pending work. Unsafe names, collisions and unsupported case-only renames
  are rejected without silently overwriting another file.
- **Remove from Project** removes membership after resolving the open board. Its
  file remains on disk. Removing the home board clears the home setting.

An unlisted board is retained and reported for explicit import; it is never
silently adopted or deleted. Interrupted create/import/rename work can leave
recoverable output with a persistent diagnostic. Inspect it before retrying.

## Shared settings and local navigation

**Project Settings…** stores the name, description, home board and autosave policy
in the shared manifest. Apply writes accepted settings atomically; Cancel changes
nothing. These settings have no board-level Undo action.

Open tabs, active board, cameras, drawer state, window size and Recent Projects
are local preferences. Reopening restores valid local tabs first. With no usable
local state, DepthPlan tries the home board, then the first healthy member. A
saved workspace with no open tabs stays empty. Missing tabs are skipped and
reported; malformed preferences fall back without changing project files.

Recent Projects keeps up to 20 entries. Removing an entry forgets local navigation
and does not delete files. **Locate…** can find a moved folder; matching project
identity with a missing old location offers a choice to restore its workspace or
start fresh. Copying a folder does not silently inherit the original location's
navigation state.

## Saving, conflicts and recovery

Project autosave writes accepted board changes after about one second of idle
editing, with a five-second scheduling bound during continuous edits. Active
gestures, file operations, transitions and MCP decisions defer that work. Hidden
open boards retain their own autosave owner. No unapplied draft is written.

With autosave off, use Save for the active board or Save All for open boards.
Status distinguishes Saved, Saving, Unsaved, Conflict, Save failed and Draft not
saved. An older write acknowledgement cannot mark newer edits saved.

A failed save pauses automatic retries for that board and retains accepted work.
Use its persistent save status to retry, save a copy, reload through guards, or
explicitly overwrite the observed source. Board and manifest changes on disk are
checked separately. A second external change invalidates the previous overwrite
consent. Healthy boards can continue saving while another has a conflict.

Project **Save As** creates an independent file with a fresh document ID. It keeps
the original project association and unsaved status. Choose copy and export
locations outside an open project folder: its native writer lock protects that
folder from independent file writes. Closing a project releases the lock; the
small `.depthproject.lock` file may remain safely on disk.

Closing a project, replacing the workspace or quitting considers every open
board. Cancel keeps all sessions. The review distinguishes accepted unsaved work
from drafts; Save All saves accepted data, and drafts still need an explicit
apply/discard decision. A running MCP operation must finish or be canceled first.

Recovery checkpoints are local crash protection, not portable backups. Restored
work retains its originating project/board labels but opens as a fresh standalone
session. Save it to a safe location before replacing any project source. Recovery
cannot infer that a source still belongs to the same project or overwrite it
merely because its old path matches. Unsaved drafts, undo history, a full disk,
unavailable storage and abrupt failures can limit what is recoverable.

## Share or move a project

Close the project, then copy or move **the complete folder**, keeping the relative
layout of its board files. The manifest contains membership and settings, not
embedded board content. Sending only `.depthproject` is insufficient. Local tabs,
recent entries, undo and recovery checkpoints are not part of the shared folder.

There is one writer per project location. This is folder-based sharing, not live
collaboration or sync conflict resolution. Keep backups before manual edits or
cloud-sync reconciliation. A malformed manifest never replaces the current
workspace; missing, corrupt or identity-mismatched boards never replace healthy
ones. Paths are inspected when opening a project; board contents are validated
on demand when each board opens. Diagnostics remain actionable without rewriting
unrelated files.

## Technical boundaries

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
grants. Edits to loaded content follow the user's normal autosave policy.

## Search project content

Choose **Menu → Search Project…** to search every board's object names and rich
text/code, connection labels and bookmark names, including hidden descendants.
This is separate from the drawer's board-name filter. Open boards contribute
accepted in-memory content, including unsaved changes; unopened boards are read
and validated from disk without opening tabs or canvases. Unapplied drafts are
not accepted content.

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
without opening a tab. Link edits use normal Undo and saving.

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
