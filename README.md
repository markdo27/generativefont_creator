# Liquid.Font

A self-contained, browser-based generative font tool. Sculpt an amorphous,
liquid/Y2K-style typeface using a metaball (signed-distance-field) glyph
engine, preview it live in foundry-style specimen blocks, and export it as
SVG, PNG, or a real installable OTF font file.

## Structure

- `index.html` — the finished, single-file app (open this directly in a browser).
- `app.js` — application state, UI wiring, glyph editor, exports.
- `blob-engine.js` — metaball/SDF geometry engine (marching squares, contour
  stitching, chain repair, Chaikin smoothing). Exposes `glyphRings` (the
  hand-authored capsule/node field used by the Font tool) and the generic
  `traceField` + `valueNoise` used by the Poster tool below.
- `body.html`, `styles.css` — markup and styling, inlined into `index.html`.
- `glyphs_meta.json` / `gen_glyphs_meta.py` — the 42-glyph node data (A–Z,
  0–9, punctuation) and the script that generated it.
- `glyphs_meta.js` — the same glyph data as a `<script>`-loadable global
  (`GLYPH_DATA`), for pages like `poster.html` that don't go through `bundle.py`.
- `bundle.py` — assembles `index.html` from the source files above.
- `jsdom_check.js` — headless DOM/interaction smoke test.

### Poster tool

- `poster.html` / `poster-engine.js` / `poster.css` — a second, standalone
  app ("Poster generator", linked from the topbar of both tools) that builds
  posters from liquid contour type.

  **Typeface** — either the built-in Liquid glyph set or an uploaded font
  (`.ttf`/`.otf`/`.woff`, parsed with opentype.js). For the built-in set the
  letterforms themselves are adjustable here: the Font tool's flow-state
  presets plus Weight / Fuse / Tension / Wobble feed `BlobEngine.glyphRings`,
  so the whole alphabet can be reshaped without leaving the poster. (Per-glyph
  node editing still lives in the Font tool.)

  **Big title** — any number of independent rows, each with its own text,
  tracking, transform and *style*. Each row is rasterized to its own mask,
  which is blurred, thresholded, converted to a signed distance field and
  contoured with `BlobEngine.traceField` — the same marching-squares pipeline the
  Font tool uses per glyph, just fed a raster-derived field instead of an
  analytic one. The blur + threshold is what fuses the letterforms into a
  single molten mass.

  Each row is transformed directly on the canvas: drag the box to move, corner
  handles to resize, the stem handle above it to rotate (hold shift to snap to
  15°). Arrow keys nudge, `[` / `]` rotate.

  Rows are traced independently, which is what lets each one carry its own
  effect and fill mode — a shared trace could not be split back apart per row.
  They therefore overlap rather than melting into one another.

  **Title style (per row)** — `Melt` fuses the glyph silhouettes (blocky,
  poster-weight). `Ink stroke` instead draws the built-in font's node chains as
  one thin variable-width pen stroke — the glyph data is a skeleton with
  per-node radii, so this gives a real modulated stroke that swells where
  strokes cross rather than a melted silhouette. A ribbon along the baseline
  joins the letters into a single written mark, Slant leans it, Pen sets the
  thickness, and Pocket floods small enclosed rings solid (the inked wedges
  where the stroke doubles back). Ink stroke needs the skeleton, so an uploaded font —
  which has outlines only — falls back to Melt geometry plus the ribbon, slant
  and pockets.

  **Line effect (per row)** — the traced mass is contoured from a true signed
  distance field (exact Felzenszwalb EDT), so "the same shape offset inward by
  N pixels" is a first-class operation and the three treatments are just
  different lists of offsets:

  - `Solid` — one clean contour.
  - `Rough` — a second line just inside the first, displaced by
    high-frequency noise: a shivered double-stroke band. Gap / Shake.
  - `Contour` — nested lines stepping inward at even spacing, topographic-map
    style. Lines / Step.

  Lines deeper than the thickest part of the mass are skipped (a contour with
  nothing to trace shatters into noise fragments and the O(n^2) chain repair
  stalls), and noise eases off with depth for the same reason.

  **Outline / Filled (per row)** — `Filled` uses even-odd across every line the
  effect produced, so Solid reads as a solid mass while Contour reads as
  concentric bands.

  **Small text** — any number of independent blocks, each with its own
  Google Mono face, size, leading, alignment, position and colour, drawn
  crisply on top and untouched by the melt. Block colour is independent of the
  title ink (with a "Match ink" shortcut to re-link it).

  Positions are stored as percentages, so changing the poster size rescales the
  composition rather than scattering it. The stage has zoom (slider, +/−, Fit,
  100%, ⌘/Ctrl+scroll) and drag-to-pan. Unselected row/text cards collapse to
  just their identity, so the sidebar stays scannable as a poster grows.

  Exports PNG at 1–3× and SVG (vector outline + each Google font inlined as a
  base64 `@font-face` subset containing only the glyphs actually used).

## Rebuilding

```
python3 bundle.py
```

regenerates `index.html` from the current source files.

## Editing glyphs

Open `index.html` in a browser. Click a letter in the character set, drag
its nodes to reshape the letter (drag a node's orange rim to change stroke
thickness at that point), or use the X/Y/R fields and Add/Delete Node
controls for finer control. Toggle Global Edit to apply a change to every
glyph sharing that node index, or Mirror to mirror edits across the
vertical axis.
