---
name: DepthPlan — Systems atlas
description: An infinite technical map with small, precise instruments.
colors:
  canvas: '#f6f8fb'
  surface: '#ffffff'
  surface-hover: '#eef2f7'
  ink: '#243144'
  muted: '#5d6b7e'
  line: '#dbe2ec'
  accent: '#2d62d5'
  accent-hover: '#214fac'
  accent-soft: '#eaf0ff'
  danger: '#ac323b'
  button-active: '#e2e9f4'
  primary-active: '#193f8d'
  disabled-ink: '#8a94a4'
  disabled-surface: '#f6f8fa'
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '28px'
    fontWeight: 620
    letterSpacing: '-0.025em'
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '16px'
    fontWeight: 650
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '14px'
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 500
  document-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 600
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '11px'
rounded:
  key: '3px'
  field: '5px'
  button: '6px'
  drawing-tool: '7px'
  notice: '8px'
  instrument: '10px'
  panel: '12px'
spacing:
  tight: '4px'
  compact: '6px'
  control: '8px'
  group: '12px'
  panel-compact: '16px'
  workspace-edge: '18px'
  panel: '20px'
  dialog: '24px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.surface}'
    typography: '{typography.label}'
    rounded: '{rounded.button}'
    padding: '7px 14px'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-primary-active:
    backgroundColor: '{colors.primary-active}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.button}'
    padding: '7px 12px'
  button-secondary-hover:
    backgroundColor: '{colors.surface-hover}'
  button-secondary-active:
    backgroundColor: '{colors.button-active}'
  button-ghost:
    textColor: '{colors.ink}'
    rounded: '{rounded.button}'
    padding: '8px'
    width: '36px'
    height: '36px'
  button-ghost-open:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.accent}'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    padding: '6px 8px'
  canvas-navigation:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.instrument}'
    padding: '5px'
  drawing-toolbar:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.panel}'
    padding: '6px'
  drawing-tool:
    textColor: '{colors.ink}'
    rounded: '{rounded.drawing-tool}'
    width: '38px'
    height: '38px'
    padding: '8px'
  drawing-tool-selected:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.surface}'
  selection-panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    width: '228px'
    padding: '14px'
  selection-panel-expanded:
    width: 'min(360px, calc(100vw - 36px))'
  depth-summary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.instrument}'
    padding: '10px 14px'
  depth-summary-open:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.accent}'
  depth-panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: '20px'
---

# Design System: DepthPlan — Systems atlas

## Overview

**Creative North Star: "Systems atlas"**

An infinite technical map with small, precise instruments. Cool white surfaces, slate text, and blue interaction states give nested diagrams a calm, legible setting. The drawing remains the visual center; supporting controls appear when they are useful.

The material is restrained and practical: a system sans, compact controls, light borders, and shallow shadows support long desktop editing sessions in ordinary office light. A compact floating toolbar at the top groups pan and selection, shapes and frames, then lines and arrows. Active tools have a clear selected state; properties and arrangement controls appear when the current selection needs them.

**Key Characteristics:**

- Infinite canvas with unrestricted pan and zoom navigation.
- White floating instruments on a cool canvas.
- Slate labels and blue interaction states.
- Compact controls with contextual disclosure.
- System typography and tabular depth and zoom values.

This document captures the implemented renderer chrome. `src/renderer/App.css`, `src/renderer/components/UnifiedToolbar.css`, `src/renderer/components/ShapeToolbar.css`, and `src/renderer/components/SelectionProperties.css` are the token sources. Diagram object styles remain document data; existing canvas feedback colors are not redefined by this chrome palette. The first workspace composition is recorded in `.impeccable/surfaces/src-renderer-app-tsx.md`.

## Colors

The palette pairs cool paper and slate neutrals with a clear instrument blue.

### Primary

- **Instrument Blue** (`accent`) identifies primary actions, active drawing tools, focus, and links. **Deep Instrument Blue** (`accent-hover`) and **Pressed Instrument Blue** (`primary-active`) provide primary button feedback.
- **Blue Wash** (`accent-soft`) marks open instruments and secondary selected states without giving them the weight of the active drawing tool.

### Neutral

- **Cool Canvas** (`canvas`) is the workspace ground. **Instrument White** (`surface`) separates controls from the drawing.
- **Hover Mist** (`surface-hover`) and **Pressed Mist** (`button-active`) provide neutral control feedback.
- **Slate Ink** (`ink`) carries principal text; **Slate Annotation** (`muted`) carries descriptions, counts, and hints.
- **Instrument Line** (`line`) supplies field edges and panel boundaries.
- **Disabled Slate** (`disabled-ink`) and **Disabled Paper** (`disabled-surface`) mute unavailable standard buttons. Disabled drawing tools use their existing local treatment.

**Error Red** (`danger`) identifies invalid fields and destructive menu actions; it is a semantic state, not an additional brand accent.

**The Interaction Blue Rule.** Use blue for action, focus, and selected or open state; keep resting chrome neutral.

## Typography

Use the system font stack throughout the chrome. There is no separate display or monospace family. The scale is deliberately compact and uses observed roles rather than a mathematical ratio.

- **Headline** is reserved for empty-canvas guidance. It reduces to (25px) at the medium breakpoint and (23px) at the narrow breakpoint.
- **Title** labels panels and dialogs. The selection heading is more compact (14px).
- **Body** supports guidance and descriptions; panel descriptions commonly step down to (13px).
- **Label** is the standard button treatment. Disclosure labels use a slightly stronger weight (550).
- **Document title** distinguishes the current document from its smaller status line (10px).
- **Caption** carries gestures, keyboard hints, and selection counts. Depth and zoom readouts use (12px) tabular numerals; number inputs also use tabular numerals.

**The Readout Rule.** Keep depth and zoom values tabular so changing values do not disturb the instruments around them.

## Layout

The workspace and canvas occupy the full viewport and suppress page scrolling. The canvas owns pan and zoom; the dot grid tracks the camera and adjusts its spacing with zoom. Interface positioning must not impose document edges or camera clamps.

Floating chrome uses the workspace-edge spacing token. At wide widths, document identity and file actions occupy opposite top corners, with drawing tools centered between them. History and bookmarks occupy the lower left, depth the lower center, and camera controls the lower right. Selection controls appear at the left (top: 92px) with bounded height and internal scrolling.

At (1100px) and below, drawing tools move to a second row (top: 80px), and selection controls move below it (top: 150px). At (760px) and below, depth moves above the lower-left controls, navigation buttons compress, and gesture hints disappear. At (600px) and below, selection controls dock above the bottom instruments (bottom: 146px), use the viewport width minus (36px), and scroll within a maximum height (32vh), leaving room to edit the object above. At (480px) and below, history and depth share the row above camera controls, document captions shorten, and drawing tools shrink to (32px × 34px). These are viewport adaptations, not a separate mobile product.

Panels constrain their width to the viewport and scroll internally. The depth panel uses `min(340px, calc(100vw - 36px))`. The bookmark panel uses `min(280px, calc(100vw - 46px))` with 8px padding, grows upward, and scrolls its list above a persistent name field and add button. Bookmark names apply their saved view on click. Right-click or Shift+F10 reveals Reset View, Rename, Duplicate, a separator, and Delete in a native popover; the selection panel uses its compact token width and expands to the selection-panel-expanded width for detailed Properties. Use the existing compact spacing rhythm between related controls and larger panel padding around groups. Fit and text-edit reveal account for the visible selection panel and surrounding instruments; these camera commands preserve unrestricted canvas pan and zoom.

## Elevation & Depth

Depth is shallow and functional. The single floating shadow belongs to persistent instruments: the drawing toolbar, document switcher, quick save, history, camera navigation, and depth summary. Expanded panels and dialogs use white surfaces and thin borders. They do not acquire additional shadow tiers.

### Shadow Vocabulary

- **Floating instrument** (`--floating-shadow`): `0 3px 16px #24314412, 0 1px 3px #2431440d`.

Dialogs dim the canvas through the existing translucent backdrop. Focus uses a blue outline (2px) with an offset (3px); it remains distinct from elevation.

**The Small Instrument Rule.** Use the floating shadow to locate persistent controls above the map; use borders to organize expanded editing surfaces.

## Shapes

Gently rounded rectangles define the interface. Fields, ordinary buttons, and drawing buttons use their respective compact corner tokens. Instrument containers are rounder, and expanded panels and dialogs share the panel radius. Keyboard hints remain small outlined rectangles. Borders are generally (1px) using Instrument Line.

Diagram shapes, connectors, frames, and nesting geometry remain part of the document model. Do not translate interface corner radii into document geometry.

## Components

### Buttons

Precise and quiet at rest. Standard buttons use a thin border and a minimum height (34px). Export uses the primary treatment with a minimum height (38px); empty-canvas creation uses a roomier padding (10px 18px). Icon-only document controls use the ghost treatment, while quick save sits on its own white instrument.

Neutral hover, pressed, selected, and disabled states use the named palette. Primary hover and pressed states deepen the blue. Keep the visible focus outline on every variant. Background and text color transitions last (160ms) with `ease-out`; reduced-motion mode shortens animation and transition durations to (0.01ms).

### Inputs / Fields

White, lightly outlined fields share a minimum height (34px), the field corner token, and compact inset padding. Invalid input changes the border to Error Red and is paired with the existing explanatory text. Root depth is a numeric field (60px wide) with current and maximum values nearby; its set/reveal actions preserve the implementation's validation and draft handling.

### Navigation

Camera navigation groups fit, zoom out, a percentage readout, zoom in, reset, and the optional minimap toggle into one floating instrument. The percentage remains centered with a minimum width (64px), reducing to (52px) in narrow layouts. The minimap toggle uses the secondary selected treatment.

Document history and bookmarks share the same instrument language. The document menu reveals file and existing document controls beneath the document switcher. MCP Server is an On/Off switch in this menu; while enabled, MCP Details appears directly below it and opens a native modal for connection configuration, approved folders, and active-operation controls. The modal uses the existing dialog tokens, scrolls within the viewport, and closes with its X button, Escape, or a click on the shaded backdrop, returning focus to Menu. MCP controls remain available while document operations lock editing. Maintain accessible names for icon buttons and the real pressed, expanded, and disabled states.

### Selection Panel

A concise editing surface follows selection. The **Style** heading shows the selected count, followed by the object's name for a single selection. Direct controls expose stroke color, background for shapes, stroke width, solid/dashed/dotted strokes, opacity, and shape layers. Color swatches include a custom color input; the active swatch has a blue outline, and selected choices use Blue Wash. **Edit text** receives the blue-wash action emphasis.

Double-clicking an object or choosing **Edit text** edits its content in place. The sidebar heading becomes **Text**, and text color, font family, font size, alignment, and **More text options** replace shape styling. Opacity and layers remain available. Esc, Cmd/Ctrl+Enter, or leaving the editor and its controls finishes the text draft. Detailed **Properties** expands the same sidebar into a non-modal form with Apply and Cancel for advanced fields.

Users can hide selection controls and reopen them from a compact selected-count button; this preserves selection. Active child-creation and bridge flows keep their controls available. Collapse and reopen transfer keyboard focus to the counterpart control. Detailed Properties keeps its form open until Apply or Cancel.

### Drawing Toolbar

The signature top instrument keeps pan, pointer, shapes, line/arrow, and arrangement controls together, separated by small dividers. The active drawing tool is solid blue with a white icon; hovering it uses the same darker blue as the primary Export button and keeps the icon white. Arrangement is unavailable without selection. Preserve the established tool order and accessible labels; the project-provided SVGs in `src/renderer/assets/icons/` are the implemented icon source.

The Alignment popup gives every action a mouse-over tooltip. Distribution occupies the first two columns of its row; Match Width and Match Height occupy the first two columns of the next row. Both rows retain the same three-column widths as the Align controls. The size-reference callout is hidden; sizing still uses the existing selection reference.

With Pointer active, left-drag on empty canvas selects and right-drag pans, including over shapes and resize handles. Left-drag on a shape still moves it. Holding Ctrl at any point during a shape drag preserves its parent and immediately clears any adoption or detachment preview, allowing overlap. Releasing Ctrl resumes parent checks at the current position, with a fresh dwell before adoption. Selection replaces the previous selection unless Shift, Ctrl, or Cmd is held. With Hand active, either mouse button pans. Scrolling pans; Ctrl/Cmd + scrolling zooms.

### Depth Navigator

A compact disclosure reads **Depth** followed by the root count, such as **2 roots**. The count describes roots, not the current depth. Opening it reveals **Levels of detail** and the controls for each root. The summary uses Blue Wash while open. It is an instrument for document detail, separate from camera zoom. Global depth commands clear local folds, and remain available when branches are hidden at the current depth.

Parents keep their original shape as children are revealed. A light dashed enclosure groups child content. Collapsed parents show a child-count disclosure on the canvas; selecting any parent exposes the same action in the sidebar. Each disclosure opens one branch by one level. A compact parent path helps navigate nested selections.

Ordinary movement has no parent highlight. A 400ms hover over a different shape arms a blue outline and “Move into” hint; leaving a parent shows “Move to top level”. Only the previewed relationship is committed. Dragged objects remain visible above the diagram, and a drop preserves the destination’s open or closed state.

### Panels and Dialogs

Bookmarks, depth, alignment, automation, and properties reuse white bordered containers. Keep contextual panels anchored to their controls and let long contents scroll. Detailed Properties stays within the selection sidebar, with bounded height and reachable Apply and Cancel actions. Other dialogs use the dialog spacing token. Preserve the distinction between local document operations and optional local automation in visible copy.

## Do's and Don'ts

### Do:

- **Do** preserve unrestricted infinite-canvas pan and zoom.
- **Do** retain the top drawing toolbar and reveal supporting controls as needed.
- **Do** reuse the implemented palette, system font, corner tokens, and floating shadow.
- **Do** expose visible keyboard focus and accurate selected, expanded, disabled, and invalid states.
- **Do** label root counts explicitly and keep depth and zoom readouts tabular.
- **Do** preserve document-defined shape styles and existing editing behavior.

### Don't:

- **Don't** replace the infinite canvas with a bounded artboard or clamp the camera to document content.
- **Don't** turn contextual editing controls into permanently expanded framing around the canvas.
- **Don't** introduce separate icon, toolbar, or panel styles outside the shared design system.
- **Don't** add unrelated accent colors, decorative shadows, or a new type family to renderer chrome.
- **Don't** imply cloud saving or collaboration through controls, labels, or status treatments.
