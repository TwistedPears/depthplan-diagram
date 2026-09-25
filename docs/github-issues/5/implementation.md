# Issue 5: MCP text search

## Design and scope

Add one read-only `depthplan_search` tool to the existing registry and renderer
dispatch. Generated schemas provide native adapter exposure; there is no second
Rust search implementation. Existing `query` and `read_chunk` behavior is unchanged.

Search shares the UI's literal, case-insensitive, whitespace-separated all-term
matcher. Matching uses locale-independent lowercase for deterministic results.
Objects search names and flattened rich/code content; connections search labels;
bookmarks search names. Recorded source paths, constants and aliases are ordinary
searchable content. No framework inference, external service or persistent index
is introduced.

Root/subtree scope includes hidden descendants. Connections belong to a scope
when their owner or either bound endpoint belongs. Bookmarks have no object
association and remain document-wide. Results distinguish collections and include
bounded labels/snippets, object ancestry/visibility and connection endpoints.
See [the MCP contract guide](../../mcp.md#text-search) for exact semantics/limits.

Results sort by collection and ID. Opaque cursors share the existing bounded
cursor store, bind the query/filter/session/document/view state and record a
candidate position. Later pages skip earlier content without retaining matches
or document text. Reads cannot publish document or view mutations.

Rollback removes the tool/dispatch and its generated schema; no persisted data
or document-format migration is involved.

## Review and verification

Ponytail reviewed all new code, tests and measurement code, then reviewed the
final cursor optimization. Both passes returned “Lean already. Ship.” There were
no suggested changes left to apply.

The focused tests exercise rich/code content, constants/paths/recorded Rails
aliases, duplicate names across roots, scopes, hidden/collapsed objects,
bookmarks/connections, empty/no matches, edits/deletion, pagination and response
bounds, stale filters/revisions/sessions, cursor eviction, Unicode snippet offsets
and unchanged document/view state.

The native smoke probe discovers the generated tool, calls it through the Rust
stdio adapter against a live document, verifies typed/scoped hidden results and
pagination, checks state equality across reads, then verifies Undo removes the
new content and invalidates its cursor. The ordinary smoke suite runs afterward.

Reproduce with:

```sh
npm test -- --runInBand editorSearch objectSearch editorQueries
npm run check:local
node scripts/measure-search.mjs
```

Pre-submission gates use the repository's full `check:local` wrapper. After PR
creation, the normal submission gates are Test on macOS/Windows/Linux and CodeQL.
Packaging/installed-client release acceptance remains a separate release gate.
The targeted change does not alter paint, geometry, persistence or transport;
search measurements below cover the new content-scanning path.

## Search measurement baseline

Measured on 2026-09-24: Apple M1 Pro, arm64 macOS/Darwin 25.6.0, Node 24.19.0.
`node scripts/measure-search.mjs` uses the existing deterministic stress generator,
seed `search-v1`, two warmups and ten measured iterations. Each measurement reads
**all** result pages at page size 200, including response serialization and
correctness assertions. It checks expected match counts, response bounds and
unchanged state. The script prints raw samples for comparisons on future changes.
These are in-process timings, excluding native transport and paint; they are an
initial reproducible baseline, not new application-capacity or release claims.

| Workload                                               | Objects | Query     | Pages | Median ms | p95 ms | Largest page bytes |
| ------------------------------------------------------ | ------: | --------- | ----: | --------: | -----: | -----------------: |
| Large preset                                           |   2,040 | `diagram` |    11 |     17.66 |  19.74 |             73,376 |
| Large preset                                           |   2,040 | no match  |     1 |      3.08 |   3.48 |                189 |
| Large + 8,192 text characters and 20 code lines/object |   2,040 | `diagram` |    11 |    175.77 | 177.81 |             97,405 |
| Same text-heavy workload                               |   2,040 | no match  |     1 |     85.07 |  87.03 |                189 |
| Deep preset (128 generations)                          |     258 | `diagram` |     2 |      2.28 |   2.47 |            215,699 |
| Deep preset                                            |     258 | no match  |     1 |      0.24 |   0.35 |                189 |

An initial version rescanned prior matching content on each page. Recording
candidate positions reduced the text-heavy all-pages median from 1,043.70 ms to
175.77 ms on the same workload, without retaining an index. All measured responses
fit within the existing 1 MiB limit. Query cost still scales with document size,
content volume and term count; reducing scope avoids scanning excluded content.
