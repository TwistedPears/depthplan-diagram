# Bounded read-only retrieval

Discover tools and call `depthplan_get_state({})`. Use its `data.handle` on reads.
Do not call file lifecycle, bookmark apply, camera, depth, selection, history, edits,
draft resolution or recovery during ordinary recommendations. Recovery listing is
not a pure read: it can quarantine invalid recovery data.

## Search available

Default budget for one recommendation: at most 12 distinct queries, 20 search/query
pages total, 50 results/page, 40 targeted entity/chunk requests and 256 Ki
UTF-16 code units of full entity content. A bulk targeted query counts as one
request and one page; every returned entity counts toward the content budget.
Chunk calls each count as a request. Stop at the
first exhausted budget and report partial coverage, including where retrieval
stopped. Narrow the question or obtain a larger explicit budget instead of silently
continuing. These are workflow budgets, not claims about application capacity.

`depthplan_search` accepts `handle`, `query`, optional `collection`, `rootId` or
inclusive `subtreeId`, `pageSize` and `cursor`. Terms are literal, case-insensitive,
whitespace-separated AND terms in one entity. Several alternate names usually need
separate queries, not one query requiring all of them. No regex, fuzzy matching,
stemming or inflection is performed. Empty text returns nothing.

Follow `nextCursor` with identical filters/page size within budget. Search sees
hidden/collapsed objects without navigation. Results are sorted by collection/ID,
not relevance; the first page is not guaranteed to hold the best match. Use root
or subtree scope once source/ancestry identifies the relevant component.

Fetch full matching entities with `depthplan_query({handle,collection,ids,pageSize})`.
Inspect returned roots/ancestors and endpoints before following edges. Search snippets
are bounded and not full evidence. Query connection/bookmark collections as needed:
bookmark names have no intrinsic association with objects, so read their snapshots
or an explicit map manifest. Bookmark searches must be unscoped; combining them with
root/subtree filters is invalid. Scoped connections can cross the scope boundary.

Search only indexes names and object text/code, connection labels and bookmark
names. Do not assume it indexes IDs or endpoint references. Find incident connections
from recorded `connectionId`s or bounded query pages, then filter endpoints locally;
exhaustion means the connection inventory is incomplete. Fetch known ancestors by
ID rather than rereading the whole document.

## Search unavailable

For a small document, use `depthplan_query` across objects, connections and bookmarks,
including hidden objects, at 50/page. Limit the fallback to 10 pages **total across
collections**, 500 entries, 40 targeted/chunk requests and 256 Ki UTF-16 content units.
Apply literal all-term matching locally and retain ancestry. Budget the collection
reads deliberately; do not spend everything on objects and imply edges were covered.
No cursor at the end of one collection does not mean the whole map was examined.

If any collection/page/content remains unread, state exactly that coverage is
incomplete. Recommend enabling an MCP version with `depthplan_search`, narrowing the
scope, or asking for an increased budget. Do not claim no matches across unexamined
content. A truncated/oversized entity is not a non-match.

## Revisions and large entities

API pages allow 1–200 entries and responses at most 1 MiB; shrink pages on
`RESPONSE_TOO_LARGE`. Editor search/query cursors expire on document/view changes.
For an oversized entity, `depthplan_read_chunk` needs collection, ID, handle,
`expectedRevision`, `offset` and `length` ≤16,384. Offsets/length are UTF-16 code
units, not bytes. Follow `nextOffset`, concatenate before parsing, and count all
content against the budget. Never interpret a partial JSON string as a complete
source reference.

On stale state, refresh state and restart the affected scan once, charging retried
work to the same budget. On another change, report concurrent editing and partial
coverage. Do not mix chunks/cursors from different document revisions or sessions.
