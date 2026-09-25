# Issue 6: evidence-backed code placement

`skills/depthplan-locate/` consumes the shared source convention from Issue 4.
The skill checks repository identity and current source before using map claims,
prefers literal MCP search and includes a bounded paginated fallback. It reads
ancestors, relevant connection evidence and bookmark definitions without navigation.
Recommendations distinguish existing paths from proposed additions and preserve
namespace, actual local architecture and test conventions.

[Worked recommendations](../../../skills/examples/README.md#placement-recommendations-from-this-map)
cover a People endpoint, UI preferences, a persisted field, membership behavior,
background work, custom inflections and a separate Admin Person. The no-database
example distinguishes two “Health” objects using source symbols and IDs.

The examples also define expected responses for stale/missing provenance, moved or
deleted paths, ambiguous requests, no matches, exhausted retrieval budgets and
concurrent revisions. These are evidence-checked worked answers, not an independent
model benchmark. Native validation separately exercises scoped hidden reads,
pagination/chunks, incomplete fallback detection and exact read-only state equality.

See the [combined implementation and validation record](../4/implementation.md) for
the fixture scope, commands, observed guarantees and remaining limits. Installation,
refresh instructions and source-reference documentation are linked from the root
README and `skills/README.md`.
