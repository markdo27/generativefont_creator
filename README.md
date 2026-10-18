# Liquid.Font

A self-contained, browser-based generative font tool. Sculpt an amorphous,
liquid/Y2K-style typeface using a metaball (signed-distance-field) glyph
engine, preview it live in foundry-style specimen blocks, and export it as
SVG, PNG, or a real installable OTF font file — with full Vietnamese
(all 67 accented capitals plus Đ), lowercase mapping, measured metrics and
automatic kerning.

## Structure

- `index.html` — the finished, single-file app (open this directly in a browser).
- `app.js` — application state, UI wiring, glyph editor, exports.
- `blob-engine.js` — metaball/SDF geometry engine (marching squares, contour
  stitching, chain repair, Chaikin smoothing). Exposes `glyphRings` (the
  hand-authored capsule/node field used by the Font tool) and the generic
  `traceField` + `valueNoise` used by the Poster tool below.
- `glyph-compose.js` — diacritic composition shared by both tools: splits text
  into clusters (NFC/NFD, lowercase), decomposes accented letters into a base
  glyph plus mark glyphs and places the marks (Vietnamese stacking rules).
- `font-tables.js` — writes a GPOS `kern` table and splices tables into the
  OTF that opentype.js produces (opentype.js cannot write kerning itself).
- `body.html`, `styles.css` — markup and styling, inlined into `index.html`.
- `glyphs_meta.json` / `gen_glyphs_meta.py` — the glyph node data (A–Z,
  0–9, punctuation, and the diacritic marks keyed by combining code point)
  and the script that generates it (`python3 gen_glyphs_meta.py` rewrites both
  `glyphs_meta.json` and `glyphs_meta.js`).
- `glyphs_meta.js` — the same glyph data as a `<script>`-loadable global
  (`GLYPH_DATA`), for pages like `poster.html` that don't go through `bundle.py`.
- `bundle.py` — assembles `index.html` from the source files above.
- `jsdom_check.js` — headless DOM/interaction smoke test (`npm i jsdom`, then
  `node jsdom_check.js` after `python3 bundle.py`).

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
vertical axis. The canvas shows the measured baseline, cap height, ascender,
descender and the glyph's advance box; `Fit` / `+` / `−` or scrolling zoom it.

Keyboard: Ctrl/⌘Z undo, Shift+Ctrl/⌘Z redo, Ctrl/⌘S save, `[` `]` previous /
next glyph, Tab (canvas focused) cycles nodes, arrows nudge (Shift ×10),
Alt+arrows swell/pinch, Delete removes a node, Esc deselects. `Keys` in the
topbar lists them.

## Vietnamese and diacritics

Accented letters are composed, never drawn twice. Each mark — acute, grave,
hook above, tilde, dot below, circumflex, breve, horn, and the Đ bar — is its
own node-chain glyph (the *Marks* row of the character set). `glyph-compose.js`
decomposes a letter like Ấ into A + circumflex + acute and places the marks
from the rendered ink: they hang a fixed gap above the font's cap line (one
shared accent line for every letter), stack upward, and follow Vietnamese
conventions — acute/hook beside a circumflex on the right, grave on the left,
a circumflex or breve that carries a tone squashed to 80 %, the dot below
under the foot line. Floating marks are traced as separate fields, so the
melt can never weld them to the letter; the horn (Ơ Ư) and Đ bar are fused
and melt in like any stroke.

Selecting a Vietnamese letter in the editor shows its base nodes (grey) and
its mark nodes (brown): dragging a mark node edits that mark in every letter
that uses it. *Mark size* and *Mark gap* in the editor panel tune all marks at
once. Text is normalised, so precomposed (NFC) and decomposed (NFD) input,
upper or lower case, all render; anything the font can't draw yet shows as an
orange box and is listed in a toast instead of vanishing.

## Spacing, metrics and kerning

Metrics are measured from the ink, not the skeleton frame: baseline = the
median foot of H I E L N…, cap height = their median top, and the em is set so
caps are 70 % of it. Preview sizes, the OTF (UPM 1000, caps ≈ 700, ascender
1020 for stacked marks, descender −250) and the line-height control all share
that em, so `Leading` behaves like CSS line-height on a real font.

Sidebearings are optical: each glyph is scanned into left/right ink profiles
and loses sidebearing in proportion to the white its own shape already holds
(an O or A gets less than an H). Kerning compares the closest ink across a pair
with what the two sidebearings alone would give and takes back a share of the
excess (the *Kerning* slider), so AV, LT, TA, P. tuck in while HH stays put.
Per-glyph `Left SB` / `Right SB` fields override the automatic values (stored
as offsets, so they survive later shape changes). Kerning is applied in the
previews and the specimen exports, and written into the OTF as a GPOS table.

## Projects

Work autosaves to the browser (`localStorage`, key `liquidfont.project.v1`)
and can be saved to / opened from a `.liquid.json` file with `Save` / `Open`.
The saved project includes every skeleton with your edits applied, which the
Poster tool reads so posters use your glyphs.

## Export

- **OTF** — every letter, numeral, punctuation mark and Vietnamese capital;
  lowercase and Vietnamese lowercase code points map to the caps, NBSP to the
  space, zero-width combining marks for decomposed text, a drawn `.notdef`,
  AGL glyph names, measured vertical metrics, GPOS kerning.
- **SVG / PNG** — the whole specimen (every preview block with its own size,
  leading, tracking and ink/paper colours).
