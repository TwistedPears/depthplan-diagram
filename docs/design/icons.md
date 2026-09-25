# Icons and artwork

## Application icon

The transparent [DepthPlan logo](../../src/renderer/assets/depthplan_logo.svg) is
the canonical branding artwork. Keep its geometry, colors and square view box.
The generated [app icon](../../src/renderer/assets/depthplan_app_icon.svg) places
it on a white rounded square with transparent outer corners and padding.

Run `npm run icons` after changing the logo or its generator. It derives the app
SVG, then uses the pinned Tauri CLI to create PNG, macOS ICNS and Windows ICO files
in `assets/`. Tauri bundles these desktop icons; Vite uses the app SVG as favicon.
Do not edit generated artwork directly. Commit the source/generator and regenerated
files together. No image service or runtime download is used.

## Interface icons

The [interface asset directory](../../src/renderer/assets/icons/) currently contains
80 SVGs, including Style controls and the two/three-square child indicators.
The shipped files are the inventory; the prompt collections describe overlapping
generation sets, not a count of all integrated icons:

- [Base icon prompt bible](DepthPlan%20Icon%20Prompt%20Bible.json).
- [Style popup icon prompt bible](DepthPlan%20Style%20Popup%20Icon%20Prompt%20Bible.json).

The five stroke width/pattern assets are integrated; there is no outstanding
placeholder-icon backlog. Keep the Style bible's path and `assets[].summary`
`Target SVG:` entries stable: [native-expansion.mjs](../../scripts/native-expansion.mjs)
uses them to validate its 40-icon set plus `square-stack-2` and `square-stack-3`.
Corner previews show only the top-left corner. The Link asset and implementation
are retained while its Style action is hidden.

Use the shared prompt in the appropriate bible to generate original monochrome
geometric artwork: rounded ends/joins, consistent optical weight, clear negative
space and readability at 16, 20 and 24 pixels. Generate separate raster masters,
then convert and clean them into static vectors. Generation padding is for raster
masters; final interface SVGs fit their visible artwork, including strokes, to the
longest 24-unit edge without stretching. Controls supply surrounding padding.

## Integration and verification

Use descriptive kebab-case filenames and `viewBox="0 0 24 24"`. Visible paint uses
`currentColor`; retain intentional `none` and transparent gaps. Remove tracing
metadata, editor IDs, unused definitions and unnecessary points. Assets must have
no embedded raster images, scripts, event attributes or external references.
Only trusted checked-in artwork belongs in the inline loader.

[src/renderer/index.tsx](../../src/renderer/index.tsx) loads raw SVGs once into a
symbol sheet. `arrow-down.svg` becomes `icon-arrow-down`; components use
`<Icon name="arrow-down" />`. CSS supplies color/disabled/active states; rotation
can reuse a glyph. Icons are decorative, so put accessible names and tooltips on
their controls. Shape geometry, endpoint markers and resize handles are separate
canvas primitives, not missing interface assets.

After artwork changes, run lint, typecheck, tests, build and native smoke. Visually
check small sizes on light/dark backgrounds, disabled/active states, alignment
directions and rotations, including the packaged app. Preserve required licensing
notices separately from this design guide.
