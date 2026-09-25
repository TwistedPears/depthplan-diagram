# MCP authoring procedure

Discover live tool schemas first. Examples here describe the current API, not a
replacement protocol or a client-specific tool prefix. Use structured results and
check `ok`; failures and no-ops are not successful publication.

## State and bounded edits

`depthplan_get_state({})` returns `data.handle`, `revision`, `viewRevision`, source,
dirty state, busy reasons, camera/viewport and selection. Fetch fresh state before
each command. Editor mutations carry these fields:

```json
{
  "handle": { "appInstanceId": "from-state", "sessionId": "from-state" },
  "expectedRevision": 0,
  "expectedViewRevision": 0,
  "requestId": "unique-id-for-this-exact-command"
}
```

An identical retry reuses the entire payload and request ID. After stale state,
reread/reconcile, then use a new identity for the revised command. A timeout can
follow a committed edit: inspect receipts/current entities before retrying. Stop
after one reconciled retry if the same failure recurs; report the partial outcome.
Do not apply/discard someone's active UI draft or unsaved-work decision implicitly.

`depthplan_edit` accepts 1–100 `actions`, atomically. Keep each serialized request
under 64 KiB, including the JSON-RPC envelope and escaping; target at most 48 KiB
for the tool arguments and split earlier if needed. The action count alone is not
a byte-size limit. No document-wide transaction spans multiple batches.

Create an object with `type: "create_object"`, client-chosen `id`, `shape`, `parentId`,
`name` and `geometry: {x,y,width,height,rotation,z}`. Creation x/y are world-space
centers; subsequent `geometry` patches default to parent-local coordinates unless
`space: "world"` is supplied. Follow with `edit_object` for `content`/`style`.

Paragraph content is `{"type":"paragraph","runs":[{"text":"Evidence…"}]}`.
Code content is `{"type":"code","language":"json","text":"…"}`. Use only
discovered languages: Ruby is currently `plaintext`. Create connections with
`start`/`end` world points and `startTarget`/`endTarget` IDs; then use
`edit_connection` to set the label. Read back endpoints to verify their binding.
Connection evidence belongs in object content, not invented connection metadata.

Bound endpoints must be visible during creation. Ordinary arrows connect peers
with the same parent; a direct child-to-child arrow across containers is rejected.
For a cross-container relationship, create `boundary` points on the containers,
connect the peer boundaries with an outer arrow, and use `bridge` actions from
each boundary to an immediate child (or its boundary). Repeat one level at a time
for deeper nesting. Reveal the required children first. Record the logical source,
target and physical segment IDs together; do not weaken hierarchy to bypass the
boundary rule. Boundary segments may be neutral lines while the outer arrow shows
dependency direction. Verify all segments after authoring.

Large content uses `depthplan_content_transfer`: begin with total UTF-16 length,
append at exact offsets in chunks no larger than 8,192 code units (smaller if JSON
escaping exceeds transport size), then use `contentTransfer` in `edit_object`.
There are four buffers, an 8 Mi-code-unit maximum and five-minute expiry; document
changes invalidate buffers. Finish a transfer and commit it before another edit.
Discard abandoned buffers. Do not confuse UTF-8 bytes with UTF-16 offsets.

Read back with `depthplan_query`, at most 200 entities/page and a 1 MiB response.
Use 50/page initially, reduce on `RESPONSE_TOO_LARGE`; repeat identical filters with
`nextCursor`. Document/view changes invalidate cursors. `depthplan_read_chunk`
reads an entity at `expectedRevision` with UTF-16 offset/length ≤16,384; concatenate
all chunks before JSON parsing. Retry a stale read from offset zero after refreshing
state, once; report concurrent editing if it happens again.

## Views and bookmarks

Use edit action `{"type":"depth","rootId":"…","depth":2}` and `children`
actions for local folds. Follow with `depthplan_camera` (`fit` or explicit `set`),
then `depthplan_bookmarks` action `create` with `id` and `name`. Bookmark creation
captures the current view. `apply` changes the document/view and is undoable;
`reset` replaces its snapshot. Refresh revisions after every operation.

Read saved bookmarks with query collection `bookmarks`. Apply each, check target
object IDs and visible hierarchy, and verify their world geometry fits the viewport
under the resulting camera. Take a visual look when the client supports it; geometry
checks alone cannot prove label readability. Report any unverified visual behavior.

## File lifecycle

Read `depthplan_get_access({})`. If the destination is not granted, ask the user to
approve its folder in local MCP Details; there is no remote grant tool. Never read
or publish descriptor tokens. Start `depthplan_files` with common command fields
and action `new`, `open` + `path`, `save`, or `save_as` + `path`.

Poll `depthplan_get_operation({appInstanceId,operationId})` until `completed`,
`failed`, `canceled` or `needs-decision`. A successful start only acknowledges the
operation. For `needs-decision`, inspect its exact ID and offered choices; use
`depthplan_decide` with fresh command fields and a new request ID only when the
user's existing authorization covers that choice. Otherwise stop for that decision.
Do not silently discard edits or overwrite a file conflict. After ten polls over
roughly 30 seconds, report a running operation and its ID rather than assuming it
finished; later checks can resume that same receipt.

New/Open/Reload changes the session; Save/Save As does not. Reopen the completed
save using its actual returned path, acquire fresh state, and reread entities/views.
Use `.depthplan` for new destinations. Do not rewrite source JSON directly as a
shortcut around the app's grants, decisions, validation or save receipts.
