---
name: depthplan-locate
description: Recommend where a feature, fix or refactor belongs by combining a DepthPlan architecture map with verified current repository source. Use for implementation/test placement across APIs, UI, database and Rails layers; recommendations are read-only unless visual navigation is separately requested.
---

# Locate a code change

Accept the proposed behavior, target checkout and corresponding open DepthPlan map.
Use the shared [source-reference convention](../depthplan-audit/references/source-evidence.md)
and [retrieval procedure](references/retrieval.md). Keep the companion audit folder
installed alongside this skill. Do not implement the change or refresh the map.

## Verify identity and freshness

Read current MCP state and map provenance. Compare its repository/subdirectory,
commit and recorded worktree hashes to the actual checkout. A different repository
is a mismatch; ask for the correct source/map before using diagram relationships.
Missing provenance is unknown, not a match inferred from the document filename.

Inspect actual paths and symbols before relying on any map claim. A changed commit
does not make every object wrong: inspect the diff and cited files, classify each
reference as current, stale/moved/deleted, inferred or unresolved. Revalidate dirty
files against their content, not just commit links. Never invent the replacement for
a missing file. Search current source for verified renames or ask a focused question.

## Find the relevant context

Search user terms and evidenced paths/symbols/routes/schema names. Preserve namespace,
engine and ancestor context when labels collide. Expand terms only from source or
recorded aliases, not English singular/plural guesses. Read matching objects, their
ancestors, relevant connection endpoints/evidence and saved bookmark definitions.
Hidden descendants remain searchable without changing depth or applying bookmarks.

For Rails, use the actual version/conventions and the companion
[Rails checklist](../depthplan-audit/references/rails.md). Trace route → controller
action → model/association → view/serializer and existing concerns/jobs/services/
policies as evidenced. Check migrations, callbacks, validations, asynchronous work
and actual Minitest/RSpec locations. Do not introduce a service layer or callback
merely because another Rails project uses one.

## Recommend with evidence

Lead with the best supported implementation location and architectural reason.
For each affected layer, give:

- Existing path and symbol, or an explicitly **proposed new file** beside a verified
  local precedent; never present a hypothetical file as existing.
- Diagram object ID, ancestor/root identity and relevant connection/bookmark IDs.
- Source declaration/path/symbol and a valid commit link when available; explain
  discrepancies with the map and any unverified relationship.
- Nearby patterns to reuse, caller/data-flow impact, tests and any required schema,
  configuration, authorization or asynchronous changes evidenced by the repository.

Include alternatives when evidence does not establish a single answer. A vague
request gets a targeted behavior/scope question plus any independent findings. No
matches get an explicit limitation and source-only findings clearly labeled as such.
Missing provenance or stale maps do not justify invented links. Explain how a new
audit and bounded `depthplan-map` refresh can repair coverage, without doing it as a
side effect of placement.

Report retrieval counts, budgets, unread areas and freshness limitations. Verify
state again at the end: your calls must not have changed document revision, dirty
state, view revision, selection, depth or camera. Concurrent user changes are not
yours to revert; report that consistent-snapshot verification was interrupted.

Navigation is separate and only on request. Explain which existing bookmark or
object would be useful; applying it, changing depth/camera, opening a document or
refreshing the map requires that additional user-directed action.
