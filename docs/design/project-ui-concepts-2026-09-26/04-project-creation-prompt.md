# Project creation — generation prompt

Generated using the built-in Image Generation tool. Reference inputs: the user's original standalone-board screenshot and the project-settings concept for modal styling.

```text
Use case: ui-mockup.
Asset type: one high-fidelity TWO-STEP UI FLOW image for adding optional Projects to the existing DepthPlan macOS desktop app.
Input image 1: original current application screenshot, source of truth for the standalone single-board app layout.
Input image 2: previously generated Project settings dialog, supporting reference for the modal styling ONLY. Do not copy its project sidebar or tabs into the pre-project screens.
Primary request: show how somebody continues using a single independent board, then deliberately creates a project from the existing app menu. This is a small addition to the app, not a replacement onboarding or dashboard.

Composition: create ONE large, crisp landscape image around 2.2:1 aspect ratio, preferably about 3000 pixels wide. Two equally sized app screenshots side by side with a narrow neutral gutter and modest short captions OUTSIDE and above their windows. Both windows should show the full app; enough resolution to read the dropdown and dialog. Left caption "1. Start from your board"; right caption "2. Create a project". Small restrained arrow in the gutter if space allows, not across controls. The screenshots are two successive moments, not two overlapping menus active at once. White/light gray presentation surround, no decorative treatment.

Visual invariants IN BOTH APP WINDOWS: reproduce original macOS titlebar with traffic lights and DepthPlan name, blue-gray dotted canvas, upper-left floating document identity card, upper-center compact white drawing toolbar, upper-right Save icon and blue Export button, lower-left Bookmarks with undo/redo, lower-right zoom controls. Same blue accent, white cards, slate typography, thin line icons, modest radii and subtle shadows. No permanent sidebar, no board tabs, no project identity yet. No new app header or onboarding screen. The current document card says "System Overview" and underneath "Saved". Its canvas contains a modest three-node diagram: "Web app" -> "API" -> "Database", simple ordinary rectangles and connecting arrows, surrounded by open space.

LEFT SCREEN — existing single-board workspace with application menu open:
At the existing upper-left menu icon, show a compact white dropdown directly below the document card. It should feel like extending the existing file menu.
Menu entries, exactly:
"New board"
"Open board…"
"Open recent" with right chevron
thin separator
"Save"
"Save as…"
thin separator
"New project…" highlighted with a very pale blue background and blue text as the chosen next action
"Open project…"
Use small restrained file/folder line icons if helpful. No chevrons on New project. Keep all menu text comfortably readable.
Below this screen, outside the app, one small sentence: "Keep creating and saving single boards as usual."

RIGHT SCREEN — project creation dialog, after choosing New project:
The menu is CLOSED. The standalone workspace behind the modal is gently dimmed. Do not already show a project drawer or project tabs, because the project has not been created yet.
Centered compact white modal, in the same style as image 2, with balanced padding and normal UI-sized type.
Heading "Create project", small close x at top right.
Subtitle "Group related boards in a local folder."
Form in this order:
Label "Project name"
Input value "Platform Architecture"
Label "Location"
One horizontal row: input displaying "Documents / DepthPlan" and a secondary "Choose…" button.
Small helper "A new project folder will be created here."
Label "First board"
Two simple radio rows, not big cards:
SELECTED blue radio: "Start with a blank board"
UNSELECTED radio: "Copy current board into project"
Indented muted helper directly under the second choice: "Your original board file stays where it is."
No other questions, no description field, no autosave toggle, no accounts or team setup.
Bottom divider then footer: secondary "Cancel", primary blue "Create project".
Below the right screen, outside the app, one small sentence: "Project navigation appears only after creation."

Meaning: single boards remain a first-class workflow. Project creation is explicit and optional. Including existing work is an explicit choice and a copy, never a silent move. The current standalone board remains intact if Cancel is chosen. The image shows the default blank-board choice, not an automatically selected import.
Keep all required copy spelled correctly, with sharp legible lettering. Do not include implementation notes, code, manifest filenames, numbered UI controls, giant marketing text, cloud sync, collaboration, billing, templates, or a complete visual redesign.
```
