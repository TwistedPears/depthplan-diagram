# Architecture skills

Three portable skills connect a source audit to a DepthPlan architecture map and
then to evidence-backed implementation advice. They use the agent's existing
source-reading tools and DepthPlan MCP; no additional agent runtime is required.

| Skill                                         | Use it to                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [depthplan-audit](depthplan-audit/SKILL.md)   | Inspect a repository without modifying it and produce a reviewable architecture audit.                 |
| [depthplan-map](depthplan-map/SKILL.md)       | Turn a reviewed audit into a nested diagram, or refresh an explicitly bounded part of an existing map. |
| [depthplan-locate](depthplan-locate/SKILL.md) | Recommend implementation and test locations, verifying the map against current source.                 |

## Install and connect

Copy the three `depthplan-*` folders together into your agent's supported skill
directory. For Codex, that is normally `~/.codex/skills/`; for another client, use
its documented skill-loading mechanism. Keep folder names and references intact:
the map and placement skills share the audit skill's source-reference convention.
Do not replace an existing local skill without checking your customizations.
Agents without automatic skill discovery can read the relevant `SKILL.md` and its
linked references directly from this checkout. No install script or plugin is
needed. Removing these three folders uninstalls the skills, leaving maps intact.

Auditing needs only read access to the target repository. Mapping and placement
need a running DepthPlan application and a connected MCP client. Follow
[MCP setup](../docs/mcp.md#connect-a-client), enable MCP locally, and verify
`depthplan_get_state` identifies the intended document. Mapping also needs local
approval for its destination folder. The skill cannot grant itself file access.
Tool names may have a client prefix; discover the live schemas instead of guessing.

## Typical workflow

1. Ask for an audit, review its evidence, exclusions, unresolved areas and proposed
   hierarchy, then choose the destination document.
2. Ask the mapping skill to create or refresh that map. Review its saved/reopened
   result and bookmark verification report.
3. Ask the placement skill where a change belongs. It reads the diagram and source
   without editing the source, document, selection, depth or camera.

Examples (replace paths with your own):

```text
Use $depthplan-audit on /work/crm at the current checkout. Cover the Rails request
flow, schema and jobs for new maintainers. Return the audit in chat; don't map yet.

Use $depthplan-map with the reviewed audit to create /maps/crm.depthplan. Include
an overview, People request flow, database/table details and operational bookmarks.

Use $depthplan-locate with the open CRM map and /work/crm. Where should a new
person endpoint, an email-preferences UI and a database-backed notification flag go?

Use $depthplan-audit to review changes since the recorded revision. Then refresh
only the People subsystem with $depthplan-map, preserving my other edits.
```

Opening the map is a separate user-directed action if it is not already open.
Placement alone never opens/replaces a document or applies a bookmark. Request
visual navigation separately when you want the canvas to move.

## Coverage and limitations

Secrets, credentials, private customer data, generated output, dependency/vendor
trees and build caches are excluded by default. Record exclusions; inspect relevant
manifests, schema and deployment configuration with values redacted. Do not run
application code, boot Rails, install dependencies or query production databases
just to infer architecture. Static analysis cannot resolve every dynamic link.

Maps are dated explanations, not continuous synchronization or an authority over
the source. Re-audit changed paths before a bounded refresh. If provenance is
missing, establish it from the user and current source; do not infer it from the
`.depthplan` file's own location. A new map is safer when ownership of existing
diagram content cannot be established.

See the [source-reference convention](depthplan-audit/references/source-evidence.md),
[worked examples and acceptance exercises](examples/README.md), and
[MCP limits](depthplan-map/references/mcp-authoring.md). The Rails fixture targets
Rails 8.0 conventions; it is a static source example, not a deployed application.
