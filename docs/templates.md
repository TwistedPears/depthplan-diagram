# Templates

Open **Menu → Templates** to browse the gallery. Search by name, category or tag,
filter by use case, or choose **My templates**. Select a preview for a closer look,
or use **Insert template** directly on a card.

Insertion adds an independent example to the **current board**. It starts near the
center of your current view and moves right as needed to leave space around
existing visible shapes and connections. Existing content stays in place. The
sample is selected and brought into view; Undo removes the whole insertion and
restores the previous view in one step.

Each inserted example has an outer frame with a light grey dotted outline and
transparent fill. An existing enclosing frame is reused; otherwise a frame is
added around the sample. Shapes and connectors move with this ordinary editable
frame.

Templates are diagram accelerators. Rename, resize, duplicate, delete, connect,
and rearrange the inserted objects with the ordinary board tools. Their hierarchy,
hidden children and depth layouts still work normally. There are no template
instances, parent-role rules, special editing modes or links back to the library.
Inserting a template keeps the current board's identity, file, project membership,
and bookmarks. It does not create a new board or import the template's bookmarks.

## Save and share

**Save board as template** captures the whole current board. **Save selection**
captures the selected shapes, their descendants, and copied connections using the
same behavior as normal Copy. This supports multiple shapes and standalone
connections. Connections outside the selection are listed before saving; explicitly
selected connections to uncopied objects use free endpoints, as in normal Copy.
You can also right-click selected objects or connections and choose **Save
Template** to go directly to the personal-template form.

Give the example a name, description and optional tags. Save a new personal entry,
or explicitly choose an entry to replace. Review before saving. To customize an
existing template, insert it, edit the objects normally, then save the selection.
Replacing or removing a gallery entry never changes content on boards.

Open a card's preview to **Export template** as a `.depthtemplate` file, or remove
a personal entry. **Import template** reviews a portable file before saving it to
your gallery. A duplicate ID creates a separate copy instead of silently replacing
an existing entry. Stale replacements and removal are rejected if the library file
has changed since the gallery opened.

Personal templates stay on this computer. Exported files carry ordinary diagram
content. Content links remain visible in the review; source paths, session state,
clipboard bookkeeping and retained template libraries are removed before sharing.

The native app writes personal entries as `.depthtemplate` files outside the
application installation, in a version-independent user folder:

- macOS: `~/Library/Application Support/DepthPlan/templates`
- Linux: `$XDG_CONFIG_HOME/DepthPlan/templates` (normally `~/.config/DepthPlan/templates`)
- Windows: `%APPDATA%\DepthPlan\templates`

These files survive application updates and restarts. Development builds use
`DepthPlan Development` instead; automated checks use an isolated test profile.
Export templates to back them up or transfer them to another computer.

## Selection menu

Right-click an object or connection to select it and open its actions. Clicking
a member of the current selection keeps the whole selection. Right-drag still
pans. The keyboard Menu key or Shift+F10 opens the same menu; arrows navigate and
Escape closes it.

Cut, Copy, Paste, Duplicate, Delete, stacking, flips and style copying use ordinary
editable objects and Undo. Cut removes content only after copying succeeds. Flips
mirror the active arrangement while keeping text readable. Copy styles transfers
appearance without replacing links or containment settings.

**Add link** accepts web, email and DepthPlan object links. **Copy link to object**
copies a stable board/item reference. Paste it into an item's link or rich text
link; opening it focuses the item in an already-open board in DepthPlan. Open the
target board first if it is closed. These links do not launch the app externally.

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

## Portable compatibility

Portable templates remain normal `formatVersion: 2` documents with a version-1
`extensions.template` manifest. Name, description and tags describe the gallery
entry; its ID, version and fingerprint protect personal-library operations. Older
component/guidance fields remain readable for file compatibility but do not impose
behavior on inserted objects. No library definitions or manifest are copied into
boards. Existing retained definitions in older boards are ignored by the gallery.

The native and renderer boundaries still validate files. Limits remain 8 MiB,
5,000 objects, 10,000 connections, 64 hierarchy/JSON levels and 128 layouts per
root. Malformed or unsupported templates fail with an error. The application does
not execute templates or fetch remote assets. Ordinary board format compatibility
is unchanged.
