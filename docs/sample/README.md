# Sample documents

Open these files through DepthPlan's File menu. They are small readable regression
examples, not capacity claims or real project data. Keep generated stress files
under the owned `out/stress-runs` directory. Only the three filenames
below are allowed through `.gitignore`.

| Sample                                                             | Declared format and purpose                                                   | Exact scenarios                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [recursive_document](recursive_document.depthplan)                 | V2, seven objects; uneven nesting and independent roots.                      | `app` D0: `app,payments`; D1 adds `api,cache`; D2 adds `endpoint`; D3 adds `handler`. `payments` remains D0 until changed independently; D1 adds `ledger`. App overview width is 160 and deepest width 640; returning to D0 restores its saved layout.     |
| [workflow_document](workflow_document.depthplan)                   | V2, four objects; fixed connectors, repairs, rich/code content and bookmarks. | Roots `system,client`; `service` belongs to system, `worker` belongs to service. Starts system D2/client D0. Contains two parent-to-child connections and one global external route. `detached` is a pending repair and never a drawn/exported connection. |
| [depthplan_application_tour](depthplan_application_tour.depthplan) | V2; comprehensive application map.                                            | 56 objects, eight roots, 31 connections, three parent-to-child routes, app D0–D3, 12 bookmarks, all 12 code languages, all 18 endpoint markers, and no pending repairs.                                                                                    |

## Application tour

Open `depthplan_application_tour.depthplan`, then choose **Bookmarks →
00 • Start here / how to explore**. The file stores the compact system overview;
opening a file resets ordinary camera navigation, so apply a bookmark to restore
its intended framing. Bookmark creation order is preserved when saving and reopening.
All samples use fixed object anchors or free boundary bindings; none contain legacy
custom boundary points. Numbered bookmarks guide readers through:

- **00–04:** instructions, system context, subsystems, modules and a nested MCP
  transaction. Follow `agent → app → mcp → dispatch → version-guard`, then the
  sibling connection to `atomic-edit`.
- **05:** heading levels 1–6, bold/italic/underline/strike, combined marks,
  font/size/color, nested lists, a numbered list starting at 3, quotes, links,
  paragraph alignment, Unicode and long content.
- **06–07:** all supported code languages, with wrapping enabled or disabled. Code is
  illustrative, not production configuration or an executable integration.
- **08:** rectangle, ellipse, diamond, nested clipping frame, rotated child,
  opacity, rounded corners, and solid/dashed/dotted strokes.
- **09–10:** all endpoint markers, fixed/auto object bindings, free endpoints,
  straight/elbow/curved paths and explicit bends.
- **11:** app D2 with renderer and domain branches collapsed independently.

For a selection export of the notation gallery, select its free marker lines
along with the frame. Selecting the frame alone includes connections bound to its
descendants, but does not implicitly select free-ended lines. Whole export includes
all visible lines.

The sample covers document structure, rich content, routes, bookmarks and saved
layouts. Its code snippets are illustrative. Schema, round-trip behavior and
feature coverage are checked by the sample tests. Native behavior must also pass
the [installed-app scenario inventory](../release.md#installed-application-checks).

For the recursive sample, selecting `app` includes only its depth-visible subtree;
it excludes `payments`, `ledger` and the `external` connector. Selecting both
roots includes `external`. Whole export uses all revealed objects even offscreen,
so the table's visible set is also the whole-export set. Changing camera does not
reveal hidden objects. Save/reopen retains every inactive layout.

For the workflow sample:

| Depth/bookmark       | Whole visible objects / connections                                      | Selecting system                                                                       |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Overview / system D0 | `system,client` / `external`                                             | `system` only; overview text visible; no service, code, or connectors.                 |
| system D1            | `system,service,client` / `external,system-bridge`                       | `system,service` and `system-bridge`; service rich text is visible.                    |
| Details / system D2  | `system,service,worker,client` / `external,system-bridge,service-bridge` | `system,service,worker` and both parent-to-child routes; worker TypeScript is visible. |

An explicitly selected visible connector is included by itself. Neither export
scope includes the pending `detached` repair. Both SVG and PNG are flattened;
links/bookmarks/editor controls are not interactive in the result. Expanded
containers show titles/children and retain their own rich content for editing.

`overview` and `details` persist their complete depth maps. `retained` intentionally
contains system D9 and a former root: Apply clamps to D2, defaults the missing
client to D0, and ignores the former root, while retaining the bookmark unchanged.
Moving system at D2 moves the visible subtree in canvas coordinates; inactive D0
geometry, child ownership, content, repair records and extensions stay intact.

Validation:

- `npm test -- --runInBand curatedSamples`: all three samples' JSON round trips,
  current-format validation, exact visibility/selection membership, bookmarks, content,
  repairs and subtree movement. [Tests](../../src/__tests__/curatedSamples.test.ts).
- `npm run test:native`: native disk round trips for the valid conformance corpus,
  including these three samples, conflict rejection and preservation checks.
- `npm run build:automation && npm run smoke`: the Tauri
  [native probe](../../scripts/native-smoke.mjs) checks file operations, actual
  SVG/PNG delivery, recovery including crash/Restore, and live MCP schema/editor
  behavior. Repeat the installed-application checks for the exact release candidate;
  instrumented smoke does not certify the distributed artifact.
