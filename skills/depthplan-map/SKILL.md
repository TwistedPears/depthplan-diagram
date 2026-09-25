---
name: depthplan-map
description: Create or refresh a navigable DepthPlan architecture document from a reviewed source audit using MCP. Use for nested subsystem/schema views, evidence-backed connections and bookmarks; preserve unrelated edits during bounded refreshes.
---

# Map an audited architecture

Require an audit identifying repository/revision, audience, coverage, source
evidence and a proposed hierarchy. If missing, use the companion audit workflow
first and present its findings for review. Map only the requested scope; do not
modify application source or silently resolve the audit's unknowns.

Read the shared [source-reference convention](../depthplan-audit/references/source-evidence.md)
and [MCP authoring procedure](references/mcp-authoring.md). Install the audit folder
alongside this one so the convention travels with the skill.

## Plan the document

Establish the exact DepthPlan instance/document, destination and whether this is a
new map or a bounded refresh. Recheck the audit against the checkout's revision and
relevant dirty files. If source changed, revise affected findings before publishing.
Existing map provenance must match the source repository; a file location is not
identity. Present the proposed roots, drill-down paths and bookmark views.

Use a small overview, nested subsystem/detail objects, and a separate schema branch
when supported by evidence. Include operations/tests and external boundaries where
applicable. Use descriptive labels, readable spacing and meaningful labeled edges.
Keep containment separate from dependency/data-flow/association edges. Explain
confidence on convention-resolved or uncertain relationships.
Put a short human-readable summary before detailed evidence. Keep overview text
brief; move lengthy excerpts into deeper detail objects and verify they remain
accessible through content inspection. Avoid shrinking every label to fit one view.

Render tables/entities as ordinary nested objects with columns/types/nullability,
keys, constraints and indexes in SQL or plaintext content. Create relationships only
when evidenced. A no-database audit gets a coverage note, not an invented schema.
Ruby snippets use `plaintext` unless the discovered schema adds Ruby support.

## Publish and verify

Create parents before children and endpoints before connections. Use stable IDs
from the source-key manifest; neither names nor filesystem basenames are identity.
Record source references and verified aliases in supported rich-text/JSON/code
content. Store coverage and unknowns where a reader can find them from the overview.

Follow live schemas, fresh handles/revisions and bounded transactions. Verify each
batch before advancing. Multi-batch creation is not atomic: retain a progress ledger
and report partial completion if interrupted. Do not blindly Undo unrelated history.

For each planned bookmark, set the relevant depth/folds, arrange its view and fit
the camera, then create its snapshot. Apply it and verify intended objects are
visible and framed. Cover overview, key flows, major subsystems, schema/table detail
and operations/tests as applicable. Never assume a bookmark name proves its view.

Save to the approved destination and poll the operation receipt to completion.
Reopen that saved path through MCP only within the authorized mapping workflow;
refresh the handle afterward. Verify source references, hierarchy, connection
endpoints and bookmark views survived. Leave the agreed overview/landing bookmark
active and report the saved path, coverage, IDs/views checked and any unfinished work.

## Repeat runs

For a new map, use a distinct map key and destination; do not overwrite another map
without authorization. For refresh, inventory the existing managed IDs and baselines
from the manifest, then compare current source and actual diagram fields.

Update only authorized, unchanged generated fields. Preserve geometry/style and
user-added text, objects, connections and bookmarks by default. If a generated field
was edited by the user, report the conflict and leave it intact. Do not duplicate an
object when its stable source key already maps to an ID. Missing/ambiguous ownership
requires a bounded decision or a new map. Preview explicitly authorized deletions;
otherwise report obsolete content without removing it. Reset a bookmark only when
its new framing is authorized, because reset replaces the saved view.

Re-audit stale sources, update only successfully published manifest entries, then
repeat save/reopen validation. A refresh report lists changed, preserved, conflicted,
obsolete and unresolved entries rather than claiming the entire map is current.
