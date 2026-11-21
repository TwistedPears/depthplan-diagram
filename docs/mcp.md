# Local MCP setup and tools

DepthPlan exposes 31 tools for inspecting and editing the live document, navigating,
managing history/bookmarks and projects, approved file operations, recovery,
export and inline canvas snapshots. The
bundled Rust `depthplan-mcp` adapter uses stdio and needs no global Node runtime.
The executable schemas are [mcpRegistry.ts](../src/shared/mcpRegistry.ts),
[depthApiContract.ts](../src/shared/depthApiContract.ts) and
[mcpFileContract.ts](../src/shared/mcpFileContract.ts). Discover those schemas for
exact fields; this guide describes their semantics.

## Connect a client

1. Start the intended DepthPlan instance. In **Menu**, turn **MCP Server** On and
   open **MCP Details**. Access starts Off on every application launch.
2. Use the displayed **MCP executable** as the client's stdio command, followed
   by `--descriptor` and the displayed **Descriptor** as separate arguments.
   For Codex, copy **Codex configuration** into its `config.toml`, replacing an
   existing `mcp_servers.depthplan` table rather than duplicating it. Enable or
   restart that server in the client after a configuration change.
3. Query `depthplan_get_state({})` and verify the selected app/document. Discovery
   alone works while disconnected and does not prove a live connection.
4. For disk operations, choose **Approve folder…** locally in MCP Details. There
   are no folder grants initially; MCP cannot approve its own access.

The equivalent executable invocation is:

```sh
'/absolute/path/to/depthplan-mcp' --descriptor '/absolute/private/connection.json'
```

Use the exact values shown by the app, with spaces treated as path data. The
copied client configuration already escapes them. Never paste descriptor contents
or tokens into client configuration, chat or logs. The entry selects one instance;
the adapter does not start the GUI, open a file or search for another instance.

Disabling immediately revokes access. Re-enabling during the same app run rotates
credentials at the same descriptor. Restarting DepthPlan creates a new descriptor:
turn access On, copy fresh setup and restart the client server. Remove the
DepthPlan client entry and disable MCP to disconnect permanently. On means ready
for local requests, not that a client holds a persistent connection.

The adapter lives in `DepthPlan.app/Contents/MacOS` on macOS, beside the application
executable on Windows (`depthplan-mcp.exe`), and beside the running executable on
Linux. AppImage mount paths can change at restart; prefer displayed paths.

## State, revisions and retries

`depthplan_get_state` returns the app/session handle, document `revision`,
`viewRevision`, camera/viewport, selection, history availability, source, dirty
state, busy reasons and supported tools. New editor mutations use fresh fields:

```json
{
  "handle": { "appInstanceId": "from-state", "sessionId": "from-state" },
  "expectedRevision": 4,
  "expectedViewRevision": 8,
  "requestId": "unique-command-id"
}
```

Document edits and Undo/Redo advance revision. Selection, camera, viewport and
controls advance view revision without dirtying the document. Bookmarks may affect
both. New/Open/Reload/Restore changes session identity even for the same file;
Save/Save As retains it. Reads/no-ops/rejections do not create document edits.
Stale requests change nothing. Busy drafts/gestures must be resolved; commands
are not queued for later execution. Atomic batches publish all actions or none.

Reuse a request ID only for the identical tool/payload. The last 256 command
receipts remain per document session. File workflows retain the latest 64 operations
and 256 request identities across New/Open in the app run. Exact retries do not
repeat creation, Undo or restore. Restart loses receipts. A timeout/disconnect may
occur after commit: inspect current state/files and retry the same identity when
appropriate, rather than blindly sending a new mutation.

Results contain structured content and equivalent JSON text. Application errors
set `isError`; they do not expose internal stack traces. Labels are not identity
keys. IDs are opaque, case-sensitive and limited to 256 characters at the API.

## Projects and explicit board targets

`get_project({})` returns the active portable project ID, canonical manifest
location, live project handle and first page of members. Use `offset`/`pageSize`
(maximum 100) for more members. Each member includes its persistent board ID,
relative path, display name, status and a live document handle when open. Names
may repeat; IDs and paths distinguish boards. A missing project returns `null`.
Metadata discovery grants no filesystem access and does not read unopened content.

`open_board({handle, boardId, requestId})` opens or activates an existing member
and returns its document handle. Here `handle` contains `appInstanceId` and
`projectSessionId` from project discovery. Reading a closed board requires an
approved folder. Opening a project in the UI never grants MCP disk access.

Use the returned **document** handle for edits, saves, exports, draft resolution
and reads. `get_state`, `get_drafts` and `get_context` accept an optional handle;
omitting it resolves the active board at acceptance. Later board switches cannot
redirect a request. File receipts contain their captured `target`, and
`get_operation`/`cancel_operation` find that receipt even after switching or closing
a board session. The workspace retains the latest 64 workflow owners and 256 accepted request
results; expiration requires reconciling current state. Identical accepted retries
return the original result without repeating work. New commands using a closed or
replaced handle fail; reopening the same file creates a new handle.

`create_project({appInstanceId, requestId, name, path})` performs **New Project**
(the active board travels with its content and Undo history), applies the name
and saves to `path`, a new `.depthproject` file inside an approved folder; all
boards are written beside it. The grant and a vacant destination are checked
before the workspace changes. It returns an `operationId`. Replacing an open
project requires `replaceProjectSessionId` from `get_project`; replacing one that
was never saved offers a `discard`/`cancel` decision instead of the local prompt.
(Saving it first is not offered; use the UI.) While that decision is pending the
workspace is locked and other workspace tools return BUSY; `decide`,
`cancel_operation`, revoking a folder or turning MCP Server off cancels it (the
local **Cancel MCP operation** button covers board operations only). The folder
containing `path` must already exist. A failed or canceled save keeps the new
project in memory, as in the UI.

`project({handle, requestId, action})` takes the project handle and one action:
`create_board` (`name`; the filename is generated in snake_case and the board
opens), `rename_board` (`boardId` plus `name` and/or `filename`; a name alone also
regenerates the filename, as inline renaming does), `rename_project` (`name`) or
`remove_board` (`boardId`). These run the drawer's own operations: open boards
save accepted edits first and drafts, gestures or a running MCP operation on an
affected board return BUSY (resolve drafts with `resolve_draft`). A saved project
requires an approved folder covering its manifest location; an unsaved project
changes only memory. Names may repeat; unsafe names and filename collisions are
rejected without overwriting. Removal changes membership only: a saved board's
file stays on disk and is reported as an unlisted diagnostic (`file:
"retained-unlisted"`); an unsaved board is discarded (`"discarded"`). Results
include the project summary and the affected board with its live handle. Both
tools replay identical request IDs.

Project `save` and `reload` use the existing native project owner, fingerprint
checks and MCP folder grants. Saving a project board as an independent copy uses a
new document ID and leaves the original association and dirty state intact.
Choose copy/export destinations outside an open project folder; its native
writer lock protects that folder from independent file writes.
Standalone New/Open and recovery Restore require closing project mode first;
recovery discard remains available. Drafts and project transitions retain their
normal guards. Edits to an already loaded project board save automatically,
just like UI edits; explicit MCP file access still requires a grant.

JSON export can target an inactive board. SVG/PNG requires its active canvas;
switching boards is blocked during export. Save decisions can remain pending while
another board is active; use the original handle and fresh target revisions for
`decide`. Closing an owner or its project waits until its MCP workflow finishes
or is canceled.

## Tool groups

All names below have the `depthplan_` prefix.

| Tools                                                     | Purpose                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `get_project`, `open_board`                               | Project members and explicit board sessions                               |
| `create_project`, `project`                               | Create/save a project; create, rename and remove boards; rename project   |
| `get_state`, `search`, `query`, `read_chunk`              | Live state, text discovery and native entity data                         |
| `edit`, `delete_preview`, `history`, `content_transfer`   | Atomic authoring, deletion impact, Undo/Redo and large content transfer   |
| `camera`, `selection`, `controls`, `bookmarks`            | View navigation, selection, editor controls and saved views               |
| `get_drafts`, `resolve_draft`                             | Inspect and explicitly apply/discard a versioned UI draft                 |
| `get_access`, `files`, `export`                           | Approved folders, document file workflows and SVG/PNG/JSON export         |
| `snapshot`                                                | Inline PNG of the rendered canvas for visual checks                       |
| `get_operation`, `decide`, `cancel_operation`             | Poll long operations, answer an offered decision and request cancellation |
| `get_recovery`, `recovery`                                | List, preview, restore or discard app-owned recovery candidates           |
| `get_context`, `get_hierarchy`, `set_depth`, `reveal_all` | Compact depth-navigation interface                                        |

`query` pages objects/connections/bookmarks/layouts/repairs. Layout queries require
root ID and depth; hidden objects are included. World geometry is available where
visible. Page size is 1–200 with opaque cursors; continue with matching filters.
Document/view changes expire editor-query cursors. Oversized pages fail explicitly.
`read_chunk` returns revision-bound native JSON text in at most 16,384 UTF-16 code
units; concatenate at `nextOffset` before parsing.

### Text search

Use `depthplan_search` to discover IDs without fetching every entity:

```json
{
  "handle": { "appInstanceId": "from-state", "sessionId": "from-state" },
  "query": "Admin::Person person.rb",
  "collection": "objects",
  "rootId": "admin-engine-root",
  "pageSize": 50
}
```

Search is literal, case-insensitive and requires every whitespace-separated term
to occur in the same entity. Object names and flattened rich-text/code content
are searched together; connections use their labels and bookmarks their names.
Empty/whitespace-only queries return no matches. Punctuation, namespace separators
and paths are literal. Related names such as `Person`, `people` or a custom table
alias are found only when recorded in the searchable name/content; search does
not infer inflections or combine entities. Unfinished UI drafts are not searched.

Omit `collection` to search all three collections. `rootId` must identify a root;
`subtreeId` may identify any object and includes that object and its descendants,
even when hidden or collapsed. When both are supplied, the subtree must belong
to the root. A scoped connection matches when its owner or either bound endpoint
belongs to the scope, including cross-scope connections. Unowned connections with
two free endpoints appear only in unscoped searches. Bookmarks have no object
association: scoped searches omit them; combining `collection: "bookmarks"` with
an object scope is invalid.

Results sort by collection (objects, connections, bookmarks), then case-sensitive
ID, without relevance ranking. Each item has `collection`, `id`, `label`,
`labelTruncated`, `snippet` and `snippetTruncated`. Labels are capped at 512 UTF-16
units and snippets at 240, positioned near a matching term. Object results add
`rootId`, root-to-parent `ancestorIds` and `visible`; connection results add
`ownerId`, `start`, `end` and `visible`. Visibility reflects saved depth/folds,
not viewport position or clipping. IDs and ancestor paths are never truncated.

Queries allow up to 1,024 UTF-16 units; pages default to 50 and allow 1–200 results.
Continue with `nextCursor` and identical query, scope, collection and page size.
Document/view changes invalidate cursors; handles must still match the app/session.
The most recent 256 query/search cursors are retained. The existing 1 MiB response
limit applies; reduce page size on `RESPONSE_TOO_LARGE`. Fetch full results with
`query` or `read_chunk`. Search does not edit the document, change selection/depth,
move the camera or advance revisions; navigation remains a separate command.

`edit` accepts at most 100 typed actions in one transaction/Undo entry: object and
connection creation, geometry/content/style, arrangement/stacking, containment,
visibility, boundaries/bridges/repairs and bookmarks. Creation uses world-space
object centers. Geometry edits default to parent-local space; `space: "world"`
uses world centers. Connection creation points are world coordinates; edited free
endpoints and bends use owner-local coordinates. `edit_connection` route fields
(`points`, `start`, `end`) edit the shared route by default; `depthRoute: "set"`
writes them to an override for the active depth of the connection's route root
instead (alone, it copies the shared route there) and `"clear"` removes that
override. Query connections to read stored `depthRoutes`; label and style are
always shared. See [document behavior](document-and-editing.md).

`{type: "layout", id, algorithm, gap?, padding?, direction?, columns?}` arranges
the visible direct children of object `id` at its root's active depth, keeping
their sizes, rotation and Z; see [automatic layout](document-and-editing.md#automatic-layout).
`algorithm` is `grid`, `layered`, `row` or `column`; `gap` defaults to 40 and
`padding` to 24 canvas units. `layered` uses connectors between the children (or
their descendants) to order rows (`direction: "down"`, default) or columns
(`"right"`). `grid` fills rows (`"right"`, default) or columns (`"down"`) with
`columns` defaulting to ⌈√n⌉. Roots cannot be arranged with `layout`. A missing or
hidden `id` rejects the batch; no visible children is a no-op. Combine it with
creation and depth actions in one batch to build and arrange a level atomically.

Tags use two `edit` actions. `tag_definition` creates (name and color required),
updates or deletes a tag by ID; `strokeStyle: null` clears its line style, and
delete strips the tag from everything in the same transaction. `tags` adds, removes
or sets `tagIds` on `objects` and `connections`, including ones created earlier in
the batch. `edit_object` with `style.legend: true` turns an object into a legend.
`get_state` returns `tagDefinitions`; query items carry `value.tags`, and search
items carry `tags` (known IDs only). `query` and `search` accept `tag` as an ID or a
case-insensitive name, filtered before paging; an unknown tag is `NOT_FOUND`. A
tagged search with an empty `query` returns every tagged object and connection.
See [tags and legends](document-and-editing.md#tags-and-legends).

Object query items include `overflow`, which is true when the body text is clipped
in the active layout ([text fit](document-and-editing.md#rich-text-and-code)).
`query` with `collection: "objects", overflow: true` lists every clipped object in
one paged result. Only painted bodies count: hidden objects and expanded parents
report false until shown. Fix one by resizing it with
`geometry`, or by setting `edit_object` `style.fit` to `"grow-height"` (it grows in
the same Undo step) or `"shrink-text"`.

For large content, `content_transfer` begins a buffer with an ID and JSON string
`totalLength`, appends at exact UTF-16 offsets (at most 8,192 characters each), then
supplies `contentTransfer` to `edit_object` for atomic validation/publication.
Limits are 8 Mi code units, four buffers and five minutes. Document changes
invalidate transfers; discard abandoned ones. JSON escaping still counts toward
the 64 KiB transport limit, so use smaller chunks when necessary.

Camera set/pan/zoom/fit/reset uses pixel offsets and scale. Selection operations
accept visible objects/connections or boundary points. Controls change drawing
tool, minimap or selection panel. Bookmarks create/apply/reset/rename/duplicate/
delete using the same geometry/fold/camera compatibility rules and compound Undo
as the UI. Reset captures the current view; ordinary navigation does not update it.

The four compact depth tools use document revision only, not view revision.
Context/hierarchy omit content, geometry and source paths; hidden hierarchy entries
remain queryable. Visibility accounts for root depth and ancestor folds, independent
of viewport/clipping. Pages default to 100, maximum 200; roots sort by ID and
hierarchy uses preorder with sorted siblings. Names truncate at 512 UTF-16 units
with a flag, never truncating IDs. Edits invalidate cursors. An empty/no-document
context succeeds with no roots. Depth must be in range and target a root; selecting
the existing depth clears local folds when present. Exact depth-command replay
reports the original applied revision but current state/selected depth.

### Snapshots

`snapshot({handle, scope, ids?, bookmarkId?, maxPixels?})` lets a vision-capable
client see the canvas. The PNG arrives as an MCP image content block (`image/png`);
the text/structured part carries `scope`, `width`, `height`, `scale` (output pixels
per world unit), the world `region` covered and the `revision`/`viewRevision` it
was rendered from. Scopes:

- `viewport` (default): what the board shows now, from its camera and viewport,
  at the on-screen zoom.
- `whole`: all revealed content at the active depths and folds, including
  offscreen objects, widened to painted ink such as overflowing text, with 16
  units of padding.
- `objects`: the frames of the visible `ids` plus 16 units of padding, with
  everything drawn there (connectors, neighbours). Content overflowing an edge
  object's frame by more than the padding is cut off; use `whole` or `viewport`
  to see it. Hidden ids return NOT_FOUND.
- `bookmarkId`: that bookmark's camera view (or whole content when it saved no
  camera). Offscreen rendering of a different depth state is not available, so it
  renders only when applying the bookmark would leave the visible geometry,
  depths, folds and routes unchanged; otherwise it returns INVALID_REQUEST and you
  apply the bookmark with `bookmarks` first.

It rasterizes the export pipeline's committed drawing layer: culled offscreen
shapes are restored, while selection handles, stack/boundary controls, the minimap
and unapplied drafts are not drawn. The scale starts at the on-screen zoom for
`viewport`/bookmark views and 1 for `whole`/`objects`, and is lowered to fit
`maxPixels` (default 1.5 MP, maximum 4 MP; larger values are rejected as
invalid) and 4,096 pixels per side; it is never raised. Encoded
PNGs over 7 MiB return RESPONSE_TOO_LARGE rather than a truncated image; request
a smaller `maxPixels` or region. It waits up to two seconds for the exact
session/document/view render, needs no folder grant, writes nothing and changes
no document, Undo history, selection, camera or revision. Like image export it
requires MCP enabled, a current handle, the active board and no draft, gesture or
running MCP operation (BUSY). A change during rendering returns STALE_REVISION.

## Files, drafts and decisions

Folder grants permit reads/writes and reset each app run. Paths are canonicalized
and checked natively, including new file parents. Traversal, prefix lookalikes,
symlink escapes, replaced grant directories and non-regular targets are rejected;
checks repeat before atomic writes. Existing source files also need grants. This
is not protection against a malicious process with the same user's filesystem
access; do not approve untrusted shared directories.

`get_access({})` reads the instance's live grant list on every call and returns its
`appInstanceId`. Each folder has `writable`; a grant inside the open project's
folder is `writable: false` because the project writer lock rejects Save As copies
and exports there, and a grant containing that folder carries a `reason`. An empty
list adds a `note`. Grants are held by the app instance, not the client
connection: re-enabling access keeps them, and they reset only when DepthPlan
restarts or the user revokes them.

`files` supports new/open/reload/save/save_as. `export` takes a path and svg/png/json;
images use whole/selection scope and committed offscreen content. Capture waits
for the exact session/document/view render and fails if superseded. PNG follows
[export limits](document-and-editing.md#export); JSON includes the whole document.

These operations return an `operationId`. Poll `get_operation` with appInstanceId
and operationId until running, needs-decision, completed, canceled or failed.
Inspect errors and returned file fingerprints. Use `decide` with the offered
decision ID, fresh common fields, its own request ID and an offered choice. Draft
resolution similarly uses an observed draft ID/version; invalid forms remain open.
Stale consent or an external file change fails rather than overwriting new bytes.

Recovery operates on opaque app-owned entry IDs, never arbitrary checkpoint paths.
Restore requires preview/accept plus normal unsaved-work decisions and creates a
fresh unsaved session. Large decision details can be read through operation
`offset`/`length`/`detailText`; verify the decision ID throughout.

Cancel with `cancel_operation`, the local Cancel MCP operation button, revocation
or disabling MCP. Inspect the final receipt: cancellation cannot undo committed
I/O. Once accepted replacement cleanup begins, replacement completes so the old
document is not left without its checkpoint. There is no durable background queue.
Window/quit controls, clipboard, Help links and permission grants remain local.

## Transport and troubleshooting

Each call uses a fresh authenticated local connection: Unix sockets on macOS/Linux,
current-user Windows named pipes with network-logon denial. Unix runtime directories
are 0700 and descriptors/sockets 0600; native permission checks fail closed. No
TCP listener exists for ordinary MCP. Tokens stay outside the renderer. Only the
trusted main frame can enable access or answer host bridge requests.

Requests are limited to 64 KiB, responses to 1 MiB (8 MiB for `snapshot`), and
ordinary calls to five seconds. Long work uses operation receipts. Stdout carries MCP messages only;
diagnostics use stderr. Same-user administrator/account compromise is outside
this boundary.

| Error or symptom                                       | Next step                                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| DISABLED / APP_UNAVAILABLE                             | Enable the intended running instance; check displayed paths/permissions and refresh setup after restart. |
| NO_DOCUMENT                                            | Create or open a current-format document.                                                                |
| STALE_APP / STALE_SESSION                              | Query state and deliberately retarget the new document.                                                  |
| STALE_REVISION / STALE_VIEW / STALE_CURSOR             | Refresh state/query and reassess the intended action.                                                    |
| BUSY                                                   | Finish or explicitly resolve the active draft, gesture or transition.                                    |
| INVALID_REQUEST / NOT_FOUND / NOT_ROOT / INVALID_DEPTH | Inspect the schema/hierarchy and correct the request.                                                    |
| REQUEST_ID_REUSED                                      | Keep identical payload for retry; use a new ID only for a new intended action.                           |
| RESPONSE_TOO_LARGE                                     | Reduce page/chunk size or snapshot `maxPixels`; never truncate stable identity.                          |
| `get_access` lists no folders after approval           | Compare the client's `--descriptor` with MCP Details of that window; restart the client server.          |
| Approved folder has `writable: false`                  | Write outside the open project folder, or close the project first.                                       |
| Timeout, disconnect or internal error                  | Inspect state/files before retry; commit outcome may be unknown.                                         |
| Tools missing or protocol error                        | Restart the client server and record app/client/protocol versions.                                       |

Use disposable sample copies to verify real edits, Undo/Redo, Save, grants/revocation,
disable/re-enable and restart rejection. [Development checks](development.md) test
the instrumented adapter; [release acceptance](release.md#installed-application-checks)
requires the exact installed adapter and intended client on each declared platform.
