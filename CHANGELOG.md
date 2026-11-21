# Changelog

## 0.1.0 — Unreleased

- Tauri 2 desktop application with a Rust host and native MCP adapter.
- Recursive diagrams with per-depth layouts, connections, rich text, code and bookmarks.
- Native file operations, session Undo/Redo, unsaved-work guards and local recovery.
- Editable SVG and streamed PNG exports for whole documents and selections.
- Local opt-in MCP automation with guarded document commands and folder permissions.
- DepthPlan application artwork and locally bundled interface icons.
- Native validation and measured capacity targets; production acceptance remains pending.
- Status tags with pills and a derived legend; text fit modes with an overflow marker and MCP overflow query.
- Per-depth connection routes, and opt-in elbow routing around shapes with separate lanes and label placement.
- MCP: inline PNG snapshots, project and board management, automatic child layout, tag and overflow queries, and folder access that explains itself.
- MCP Details: copyable Claude Code configuration (`.mcp.json`) next to the Codex one.
- Legend fill swatches are outlined and legend rows show counts; object and whole-scene snapshots enlarge small regions.
- Fix: a project board resized while hidden now remeasures its canvas when shown.
- Fix: shape-avoiding routes glide to the final layout when a view opens or closes instead of flipping between paths.
