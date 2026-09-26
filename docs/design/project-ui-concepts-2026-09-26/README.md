# Projects UI concepts

Image concepts selected as the visual baseline for issue #11. They are design artifacts, not implemented UI. The completed [v1 specification](../../develop-feature/issue-11-project-ux/specification.md) defines behavior; [supplemental wireframes](../../develop-feature/issue-11-project-ux/wireframes.html) cover compact and failure states, and the [validation record](../../develop-feature/issue-11-project-ux/validation.md) maps the acceptance criteria.

Generated with the built-in Image Generation tool using the current application screenshot as the visual reference.

## Recommended direction

Extend the existing top-left document card into a project control. A collapsible floating drawer lists every board; a compact strip below the drawing toolbar shows open boards. Keep the canvas, drawing tools, bookmarks, and zoom controls in their familiar locations. Project settings use a small modal form.

- [Project drawer](01-project-drawer.png): all project boards, create/import actions, and settings.
- [Focused workspace](02-focused-workspace.png): drawer collapsed, with open-board tabs available.
- [Project settings](03-project-settings.png): project name, description, home board, and autosave.
- [Project creation](04-project-creation.png): a two-step flow from the standalone board menu to a project-creation dialog.

The four images show one design direction. Standalone boards remain the default workflow. New/Open Project actions extend the existing application menu. Creating a project asks for a name, parent location, and an explicit choice between a blank first board and copying the current board. The v1 default is a blank board; copying leaves the original file intact. Project navigation appears in the same window after successful creation. Cancel returns to the standalone board. Project actions include New/Open/Recent Projects. The linked specification resolves keyboard/focus behavior, in-memory drafts, save/conflict states, and compact layouts. Its details take precedence over incidental generated-image wording; settings also includes location/Reveal, and the project menu exposes Save All.

## Generation prompts

The creation flow prompt is saved in [04-project-creation-prompt.md](04-project-creation-prompt.md). The first three prompts follow below.

### 01 — Project drawer

```text
Use case: ui-mockup.
Asset type: high fidelity screenshot-based UI concept for the existing DepthPlan macOS desktop application, image 1 of a coordinated 3-image exploration.
Input image 1 is the exact existing application screenshot, the edit target and visual source of truth. Create a convincing native app screenshot that adds local Projects with minimal disruption, not a redesign.
Output one large landscape screenshot, approximately the reference's 1409x1030 aspect ratio, no presentation board, captions, annotations, watermark, browser, or extra environment around the window. Remove the thin accidental desktop slivers outside the app. Crisp readable UI at full resolution.

PRESERVE the existing macOS window chrome, "DepthPlan" wordmark, very pale blue-gray dotted infinite canvas, blue accent, dark slate typography, small rounded white floating toolbars with subtle shadows and thin line icons. Keep the top-center drawing toolbar in its existing position and scale with the pointer selected in blue; keep Save and blue Export in the upper right; keep Bookmarks and undo/redo at bottom left; keep existing zoom/navigation at bottom right. Do not create a full-width header or a different application shell.

Main requested change: add an OPEN FLOATING PROJECT DRAWER below the existing top-left document card. The project card stays near x24 y60, becomes about 275px wide: left small sidebar/menu icon, first line "Platform Architecture" with a down chevron, second line "Overview · Saved". The chevron suggests a project menu; the sidebar icon toggles the board drawer.
Drawer is white, about 275px wide, starts at y124, ends around y515, has a thin gray border, 12px rounded corners and subtle shadow consistent with current controls. It is a floating panel, NOT a full-height docked sidebar. Heading "BOARDS" with small plus icon and overflow button. A compact "Find a board…" input. Four clear rows, each a separate document, not a nested object hierarchy:
1. "Overview", a small home icon, selected in very light blue with blue left accent.
2. "API Services".
3. "Data Model".
4. "Deployment".
Simple sheet/document icons for other rows and restrained overflow at row ends.
Below a divider: "+ New board", then "Import board…".
Below another divider a gear icon and "Project settings".
Everything generously readable but compact, matching the reference app.

Add a slim SECOND FLOATING STRIP under the drawing toolbar, from approximately x470 y126, with only two open-board tabs: "Overview" selected with blue underline and a subtle close x; "API Services" inactive with a close x. Distinguish the complete board list from open tabs. This strip is short, not full-width, approximately 335px wide and 38px tall. Do not add redundant status labels everywhere.
The active board still uses the familiar original empty state, shifted just enough to be centered in the usable space to the right of the drawer: outlined blue square above "Start with the big picture.", same short explanatory text, blue "Draw a shape" button and the small infinite-canvas sentence. Keep almost all of the canvas open and quiet.
Maintain existing proportions and ordinary app-sized fonts. This must look like a small, shippable addition to the supplied app, not a concept for a different product.
Avoid: dark mode, gradients, purple, giant typography, dashboards, project tiles, avatars, cloud collaboration, presence dots, issue tracking, extra side rails, card grids, unnecessary features. Local projects only.
```

### 02 — Focused workspace

```text
Use case: ui-mockup.
Asset type: high-fidelity DepthPlan screenshot, view 2 in a coordinated exploration of a minimal Projects feature.
Input image 1 is the generated open-project concept to EDIT. Input image 2 is the original current application, supplied as a supporting visual invariant reference.
Create the FOCUSED WORKSPACE state of exactly the same application and project, with the floating board drawer collapsed. One landscape app screenshot matching input 1's aspect ratio and proportions; no presentation framing, annotations, watermark or background outside the app.

Keep the macOS titlebar, exact pale gray-blue dotted canvas, blue accent, dark slate UI, rounded white floating controls, drawing toolbar, upper-right Save and Export, lower-left Bookmarks and undo/redo, lower-right zoom/navigation. Preserve the top-left project identity card and its sidebar/menu icon and chevron. All toolbar geometry and styling should match input 1.
Change the card second line to "API Services · Saved"; first line remains "Platform Architecture". Entire floating BOARDS drawer is collapsed/absent, leaving free canvas below this card.
The small floating open-board tab strip under the drawing tools is now three tabs: "Overview" with close x, "API Services" active with blue text and blue underline and close x, "Data Model" with close x. Width only as large as needed, roughly 470 pixels. This strip is not full-width, not a giant navigation bar. Do not add a plus button that could confuse opening versus creating boards.
Replace the empty-state message and button with a simple authored architecture diagram centered in the canvas below the toolbars. Four ordinary white rectangular nodes with subtle slate outlines and slightly rounded corners, joined with thin slate right-angle arrow connectors: "Web app" on the left, "API gateway" in the middle, and "Auth service" and "Data service" in a vertical pair on the right. Web app -> API gateway; API gateway branches to the two service nodes. No decorative icons inside nodes. Comfortable spacing, lots of surrounding canvas, no selection handles, the diagram is modest and does not fill the screen. Keep text and nodes crisp.
This should clearly demonstrate how the board list can be hidden while switching among already-open boards remains easy. It is the same proposed UI in another state, NOT a second unrelated redesign.
Avoid: dashboards, dark sidebars, cloud features, avatars, issue tracking, giant headers, new navigation rails, extra controls, gradients.
```

### 03 — Project settings

```text
Use case: ui-mockup.
Asset type: high fidelity screenshot, view 3 of a coherent minimal Projects addition to the existing DepthPlan desktop app.
Input image 1 is the focused-workspace screenshot to edit; input image 2 is the original application's visual styling reference.
Make a PROJECT SETTINGS DIALOG shown over the same project workspace. Single large landscape app screenshot with the same aspect ratio and app proportions as input 1. No annotations, presentation framing, marketing captions or external desktop.

Invariants: preserve the macOS chrome and DepthPlan title, existing top-left "Platform Architecture" project card with "API Services · Saved", original drawing toolbar position, compact open-board tabs, save/export controls, pale dotted canvas, bottom Bookmarks/undo/redo and zoom/navigation. The diagram and surrounding chrome remain visible but gently dimmed behind the modal. Maintain restrained blue accent, white surfaces, dark slate type, thin gray borders, rounded corners, subtle shadow. No new app shell.
Foreground modal: centered white panel approximately 570px wide by 590px high relative to a 1468x1072 screenshot. Match the floating cards' visual family. Comfortable 26px inner padding, readable app-sized fonts. One focused form with no sidebar or tabs.
Dialog heading "Project settings", with a small close x at upper right. Under it a light secondary sentence "Manage this project's details and saving."
Then simple stacked fields with accurate legible text:
Label "Project name", full-width input value "Platform Architecture".
Label "Description", a compact two-line textarea containing "System overview, services, and deployment."
Label "Home board", full-width select value "Overview" with down chevron.
Fine horizontal divider.
One settings row: "Autosave boards" on the left, an ON toggle in the app's blue on the right. Under the label, small helper "Saves completed edits as you work."
One small quiet note below: "Open tabs and canvas views stay on this device."
Footer separated subtly with whitespace or a fine line: right-aligned secondary "Cancel" button and primary blue "Save changes" button. The buttons must be clearly separate and no larger than existing normal app controls. Do not label the primary Apply as well; only "Save changes".
Modal must be a compact addition consistent with existing white controls; leave substantial surrounding app visible to emphasize minimal change. No billing, team members, cloud sync, permissions, integrations, themes, scary warnings, arbitrary settings, or full-screen settings redesign.
Text must be clean, accurate and readable.
```
