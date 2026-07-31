# Liquid.Font

A self-contained, browser-based generative font tool. Sculpt an amorphous,
liquid/Y2K-style typeface using a metaball (signed-distance-field) glyph
engine, preview it live in foundry-style specimen blocks, and export it as
SVG, PNG, or a real installable OTF font file.

## Structure

- `index.html` — the finished, single-file app (open this directly in a browser).
- `app.js` — application state, UI wiring, glyph editor, exports.
- `blob-engine.js` — metaball/SDF glyph geometry engine (marching squares,
  contour stitching, chain repair, Chaikin smoothing).
- `body.html`, `styles.css` — markup and styling, inlined into `index.html`.
- `glyphs_meta.json` / `gen_glyphs_meta.py` — the 42-glyph node data (A–Z,
  0–9, punctuation) and the script that generated it.
- `bundle.py` — assembles `index.html` from the source files above.
- `jsdom_check.js` — headless DOM/interaction smoke test.

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
