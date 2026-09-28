# Templates

Open **Menu → Templates**. Filter by name/tag and select a bundled, personal, or
**In this document** entry. Preview **As authored**, **Collapsed**, **Expanded**,
or one of the starter's bookmarks.

- **New from template** creates an independent unsaved diagram. Existing work uses
  the normal Save/Discard/Cancel flow. In a project, the workspace guard runs
  before opening the standalone diagram; the project boards are not overwritten.
- Choose a reusable component and a **Destination** (canvas or any parent), then
  **Add component**. Hidden descendants and authored depth layouts are included.
  Parent roles are guidance, not restrictions. **Reveal inserted item** opens its
  ancestors and focuses it; insertion itself preserves the destination disclosure.
  Insertion is one Undo/Redo action. Revealing afterward is a separate view edit.
- Each instance is ordinary editable content. Changing or removing a library
  entry does not update placed instances. Documents retain a source definition
  once per template ID/version, so matching components remain available after
  saving, reopening or sharing without the original library.

## Create, edit and share

**Create from document** captures the current diagram. **Create from selection**
captures one selected object and its complete subtree, including hidden children.
For a component made from several objects, first put them in an ordinary parent.
Supply a name, description, tags and “How to add another item” instructions. Choose
example objects with **Add reusable pattern**, then describe their recommended
parent and naming/content guidance.

**Edit template** opens a personal entry in the existing diagram editor as an
unsaved copy. Make your changes, return to Templates → Create from document, and
choose **Update library entry**. This explicitly saves the next content version.
**Save personal copy** always creates a separate identity. Bundled entries are
customized by saving a personal copy.

**Export template** reviews counts, components, excluded connections, and content
links before opening the native save dialog. Share the `.depthtemplate` file by
repository, chat or email. **Import template** validates and previews its metadata
before saving it. If the ID already exists (even at another version), import offers
**Import separate copy**; it never silently replaces a customized entry. Cancel
leaves the library unchanged. A changed library file rejects stale updates/removal.

Internal connections survive extraction. Connections crossing outside a selected
subtree are excluded and listed by label or ID. No endpoint binds back to its
source document. Intentional rich-text/project links remain in content and are
listed for review. Repair history, source paths, clipboard bookkeeping and session
extensions are removed. Component insertion does not import document-wide
bookmarks; capture a new bookmark with the normal controls. Starter diagrams keep
remapped bookmarks and camera focus across viewport sizes.

## Bundled starters

- **ERD:** schema → tables → columns. Use plural snake_case table names and explicit
  PK/FK, type and nullability annotations. Reconnect relationships after adding a
  table or column. No SQL is executed.
- **Isometric infrastructure:** site → rack/zone → server/switch → ports/services.
  A diamond rack plane and staggered editable 2D shapes provide the isometric
  arrangement. Use environment-zone-role-number names; document VLANs and peers.
- **ISA-95 / Purdue Model:** site with peer functional levels 0–4, then devices and
  details. D0/D1 disclosure does not change functional level labels. The optional
  **3.5 industrial DMZ** is a Purdue network-security adaptation, distinct from
  the functional levels. Edit or remove it for your architecture. This starter
  documents functions and boundaries and does not validate/certify compliance.
  Authoring references: [ISA overview](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard)
  and [Cisco industrial reference](https://www.cisco.com/c/en/us/td/docs/solutions/Verticals/Oil_and_Gas/Pipeline/SecurityReference/Security-IRD/Security-IRD.html).

## Portable contract

A template is a normal `formatVersion: 2` document with an
`extensions.template` manifest (`formatVersion: 1`, independent positive integer
content `version`, identity, name, description, tags, guidance, optional author and
license, component root references, and excluded-connection report).
`extensions.templateSources` in instantiated documents stores clean portable
sources once per version. The application never executes templates or fetches
remote assets. Personal entries live in the application's local `templates`
directory alongside its recovery/workspace data; development and automation use
separate profiles. Portable files include no library paths.

Both native and renderer boundaries validate manifests and document payloads.
Limits: 8 MiB per template, 5,000 objects, 10,000 connections, 64 hierarchy/JSON
levels, 128 layouts per root, 100 reusable components, and 100 retained template
versions per document. Unknown template format versions and malformed data fail
with an error. Ordinary document format compatibility is unchanged.
