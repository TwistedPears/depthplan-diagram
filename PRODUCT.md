# DepthPlan

<!-- impeccable:product-schema 1 -->

## Platform

web

React and Konva inside a Tauri 2 desktop application. See
[architecture](docs/architecture.md) for native boundaries and
[release requirements](docs/release.md) for acceptance and support scope.

## Product purpose and users

Solution architects and technical leads author a single system diagram spanning
an overview through implementation detail. Engineers and business stakeholders
navigate the depth and saved view appropriate to their needs. The
[PRD](docs/PRD.md) is the authoritative product scope.

## Interface direction

Use a canvas-first workspace with cool white surfaces, slate text, blue interaction
states and compact floating controls. Keep the drawing toolbar available for pan,
selection, shapes, frames, lines and arrows; reveal supporting controls as needed.
Preserve unrestricted canvas navigation and use the [local icon set](docs/design/icons.md)
with accessible control names.

Depth, containment, child auto-arrange, connections, rich content, saved views,
history, file operations, recovery and opt-in local automation form one editing
workflow. Do not imply cloud collaboration or cloud saving. Use the
[editable samples](docs/sample/README.md) to check realistic interface states.
