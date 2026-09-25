# Source evidence convention: depthplan-source/v1

Use ordinary object content. The editor API cannot author arbitrary object
metadata. A readable explanation plus a JSON code block makes evidence searchable
and usable by both mapping and placement skills. Do not store secrets or entire
source files merely to make them searchable.

## Map provenance

An overview/coverage object records:

- `convention`: `depthplan-source/v1`.
- `repository`: credential-free canonical remote identity, or an explicit local
  identity when no remote exists; `checkoutSubdirectory` for a monorepo scope.
- `revision`: the audited full commit, or `null` with an explanation for a non-Git
  source fixture; audit date and relevant worktree changes separately.
- `coverage`: inspected scopes, exclusions, partial/unknown/not-applicable areas,
  intended audience, framework/version and static versus runtime verification.
- `mapKey`: a stable user-visible identity for this mapping, independent of the
  diagram's path. Multiple maps may describe the same repository.

For uncommitted/new files, capture a content hash and describe their worktree
status. A commit permalink does not establish the contents of a dirty file.
Never fabricate a commit, remote URL or a claim that a fixture was deployed.

## Component and relationship evidence

Use this shape in a component's JSON content block, adding an explanatory
paragraph rather than relying on keys alone:

```json
{
  "convention": "depthplan-source/v1",
  "key": "crm:Person",
  "repository": "local:crm",
  "revision": null,
  "scope": "CRM",
  "status": "declared",
  "sources": [
    {
      "path": "app/models/person.rb",
      "symbol": "Person",
      "sha256": "<hash-of-inspected-file>",
      "worktree": "uncommitted"
    }
  ],
  "terms": ["Person", "people", "crm_members"],
  "relationships": [
    {
      "targetKey": "crm:Membership",
      "kind": "association",
      "status": "declared",
      "evidence": ["app/models/person.rb:Person.memberships"],
      "note": "Application association; check schema separately for its foreign key."
    }
  ]
}
```

`status` is `declared`, `convention-resolved`, `inferred` or `unresolved`. A
convention-resolved edge cites both its declaration and the configuration/framework
rule supporting resolution. An inferred edge explains its uncertainty. An unresolved
edge describes the missing evidence without presenting a guessed target as fact.

Paths are relative to the identified repository root, not the diagram's folder.
Symbols retain case and namespace. Add verified line ranges and commit-specific
HTTPS `url` fields when available. Keep `path` and `symbol` even when a link exists;
line numbers and links alone become stale. Dirty-file hashes supplement the commit.
Use only actual recorded aliases. `Person`, `people`, `PeopleController` and a
custom table name remain distinct entities/terms with explained relationships.

Connections have only labels/endpoints/style in the editor API. Put the evidence
for a connection in its source component or a dedicated relationship object,
recording its `connectionId`; do not invent a connection-content or metadata field.
Bookmarks are view snapshots, not semantic associations. A separate manifest may
record their intended object IDs so navigation can be checked.

## Refresh manifest

Keep a JSON code block in a dedicated manifest object with `mapKey`, repository,
last audited revision and entries mapping stable source keys to object/connection
IDs. Record the hashes of each generated field last published (`name`, `content`,
connection `label`/endpoints as applicable). Hash each field's JSON serialization
with SHA-256, preserving array order and using sorted object keys consistently.
Exclude the manifest's own content from its hash table to avoid self-reference.

Before refresh, compare actual fields to those hashes and verify the source key.
An unchanged generated field can be replaced within the authorized scope; a
different field is a conflict, even if it looks like an agent's previous edit.
Preserve conflicted fields, unrelated objects/connections, user notes, geometry,
styles and bookmarks unless that specific change is authorized. Treat ownership
without baselines as unverified; prefer a new map or request a bounded decision.

Keep IDs stable across a refresh, including renamed files when identity is verified.
Do not create a replacement solely because a display name changed. Obsolete entries
are reported before deletion; use deletion previews for authorized removals. Update
baselines only for fields actually published and verified. If a run stops midway,
record the completed batches and treat missing baselines conservatively next time.
