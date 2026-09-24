# Architecture

DepthPlan is a Tauri 2 desktop application with a React/TypeScript/Konva renderer
built by Vite. Rust supplies the native host and bundled `depthplan-mcp` adapter.
The renderer has no Node runtime access. The OS supplies WKWebView on macOS,
WebView2 on Windows and WebKitGTK on Linux.

```text
React/Konva editor + shared TypeScript document commands
    ↕ typed desktop commands and scoped events
Rust host: windows, menus, dialogs, files, recovery, permissions
    ↕ authenticated Unix socket / current-user Windows named pipe
Bundled depthplan-mcp: Rust MCP SDK + stdio
    ↕ local MCP client
```

## Ownership and source map

| Area           | Responsibility                                                                        | Source                                          |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Document model | Validation, hierarchy, geometry, visibility, connections, transactions and bookmarks  | [src/shared](../src/shared/)                    |
| Editor         | Canonical in-memory document, drafts, undo history, selection, camera and rendering   | [src/renderer](../src/renderer/)                |
| Desktop bridge | Typed commands/events crossing the native boundary                                    | [desktop.ts](../src/renderer/desktop.ts)        |
| Native host    | Dialog-selected file sources, atomic writes, fingerprints, recovery and folder grants | [src-tauri/src](../src-tauri/src/)              |
| MCP registry   | Schemas for all 25 tools, generated for the native SDK adapter                        | [mcpRegistry.ts](../src/shared/mcpRegistry.ts)  |
| Packaging      | Embedded renderer, native adapter, icons and license resources                        | [tauri.conf.json](../src-tauri/tauri.conf.json) |

Rust validates callers, arguments and document data before writing; it does not
maintain a second editable document. MCP and manual editing use the same command
layer and session/revision guards. See [document behavior](document-and-editing.md)
and [MCP](mcp.md).

The application window has a restrictive CSP and minimal capabilities. Native
file-source IDs and approved-folder leases remain necessary for allowed commands.
Navigation and external-link activation use native validation. MCP starts disabled;
tokens never enter renderer code. The local transport trusts the signed-in OS
user, not arbitrary network callers.

## Scene and viewport

Depth and local folds determine the complete logical scene. The renderer reuses
unchanged scene/object/connection paint and derives hierarchy data together.
Viewport culling reduces scene/hit drawing while retaining logical nodes,
ancestor transforms, opacity and clipping. Fit, minimap, selection and exports
still use the full revealed scene; culling does not modify the document or history.

Culling runs when scene, geometry previews, camera/viewport or relevant rendering
inputs change. Unrelated UI renders do not require another pass. Native local
paint bounds are transformed with Konva's cached absolute transforms. Conservative
stroke, marker, text-overhang, hit and antialiasing padding prevents visible ink
from being dropped. A fresh per-pass map shares combined ancestor clip envelopes.
This is not a persistent spatial index or bitmap cache.

Only offscreen shapes receive `viewportCulled` and become invisible to scene/hit
painting. Groups remain so offscreen parents cannot hide overflowing children;
paths and labels are considered independently. Export clones the committed scene,
restores culling-disabled shapes and then applies whole/selection scope. It never
restores depth-hidden content. Native bounds also support export ink measurement.
See [recursivePaintBounds.ts](../src/renderer/utils/recursivePaintBounds.ts) and
[RecursiveCanvas.tsx](../src/renderer/components/RecursiveCanvas.tsx).

Child disclosure animation interpolates changed geometry over 340 ms, with a small
overshoot when opening and easing when closing. The accepted final document is authoritative throughout. Reduced-motion
preferences skip interpolation; interrupted transitions settle on current state.
History, saving, recovery and export use accepted geometry, not animation frames.

## Profiles and packaging

Production recovery uses the `DepthPlan` profile; development uses `DepthPlan
Development`. Automation supplies isolated temporary profiles. Development and
automation WebViews use incognito data stores and do not consume production
recovery entries. Saved source documents remain in user-selected locations.

The explicit Cargo `automation` feature adds test-only WebDriver, native-dialog
responses and process inspection. Ordinary build/package commands exclude it.
An instrumented test pass cannot certify the exact installed application.

The app and MCP executable are self-contained native executables with no global
Node requirement. Bundles include product/dependency notices. Updates currently
require manual installation; no updater feed is configured. Build instructions
are in [development](development.md); installed-candidate, signing and support
requirements are in [release](release.md).
