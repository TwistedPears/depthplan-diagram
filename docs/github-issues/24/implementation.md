# Issue #24: Children control overlap

Verified against `main` at `48f04d1` (2026-09-25), using the smoke-first workflow.
The existing shrinking stack icon, blue dot, object-relative paint order, and
upright rotation placement were already present. The issue was only partly fixed.

A native 160 × 100 rectangle with a long title and rich text still reproduced the
bug at 100%: the 33 × 33 control crossed both the title and the first body line.
The dot also retained an invisible 12px pointer target. At the tour's 38% Modules
bookmark, the MCP parent's dot still touched the Private local service card.

The fix shares title/body bounds between painting and inline editing. Body text
starts at its original inset: lines beside the Children control use the available
space, then regain the full width below it. The existing canvas line layout takes
a local exclusion rectangle; the inline editor uses a CSS float and shape-outside
with the same rectangle. Unwrapped code rows move below the control when needed.
List markers follow their first line, including when narrow space moves it down.

The title keeps its control allowance, and newly expanded parents retain the
44-unit header for child cards. The dot uses its visible stroke for hit testing.
Dots smaller than 4px use the selection fallback because native hit testing is
unreliable at that size. If the upright control intersects the title or a visible
child subtree, or leaves less than 24 units for body text, it is omitted. The
existing selection Reveal/Hide action remains available, including Ctrl-click
collapse-all. Subtree bounds are accumulated once per scene change and reused
during zooming.

Saved geometry, bookmarks, remembered manual layouts, and document data are not
rewritten to make room for controls. Rotation retains the recent visual upper-right
policy wherever there is room. Wrapping follows the visible control as zoom or
rotation changes. Exports preserve the current canvas text layout and omit the
control. Unchanged exclusion dimensions reuse the measured text layout.
No dependencies, document migrations, or alternative placement search were added.

Regression coverage is in `scripts/native-child-content.mjs`, integrated into
`npm run smoke:ci`, plus the existing expansion and rotation probes. It covers the
tour bookmark, long/unnamed text, four shape types, 25/38/50/100/200% zoom, direct
and nested rotations, collapsed/expanded states, small frames, collision fallback,
visible hit regions, inline-editor character bounds, and navigation/editing
without document/history changes. Text-layout unit coverage checks both sides,
styled prose, quote rules, lists, code, and restoration of full line width below
the icon. Expansion coverage checks that children remain below the 44-unit header.

Validation passed on macOS:

- `npm test -- --runInBand`: 56 suites, 464 tests.
- `npm run typecheck`, `npm run lint`, `npm run format:check`.
- `npm run build:automation` and the complete `npm run smoke:ci` suite, including
  disclosure, native hits, nested rotation, persistence, Undo/Redo, and SVG/PNG.
- Native screenshots inspected for the canvas and inline-editor wrapping, plus
  the long-title fixture and tour.
- Final ponytail-review: **Lean already. Ship.** Shared hierarchy data and geometry
  helpers are reused; no further simplifications remain.

The native probes wait for paint before inspecting controls. Older expectations
of an always-visible inline button now verify the selection fallback in collision
cases. The 12.5% probe checks fallback instead of relying on a 2px hit target.

Conservative bounds may suppress a control where a more expensive ink-level test
could find room; the selection action remains usable. Native execution was checked
on macOS, not Windows/Linux. Rollback is a normal commit revert; no migration is
required. Screenshots stay in disposable test profiles, outside the commit.
