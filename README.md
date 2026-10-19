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
  stitching, chain repair, Chaikin smoothing). Exposes `glyphRings` /
  `glyphTrace` (the hand-authored capsule/node field used by both tools) and
  the generic `traceField` + `valueNoise` used by the Poster tool below.
  The liquid terms make the letters flow rather than sit:
  - **Flow** (slider): the field is read through a smooth, one-to-one domain
    warp, so contours slide and undulate, and strokes bead and neck along
    their length with a drop at each free end.
  - **Drip** (slider, 0 = none): a few seeded drips — a flared neck and a
    round drop — hang from free stem feet and bar tips, never under a bowl,
    from a round, a mark, a dot or punctuation, or from a letter carrying a
    mark below it. The baseline is measured from the drip-free foot
    (`glyphTrace().foot`), so drips never move it.
  - Per preset: `warp`, `neck`, `sag` (gravity: the lower part slides and
    spreads), `dripForm` (fat and short to long and thin) and `stretch`
    (surface noise running downward), so each Flow state keeps its
    character at any slider value.
  - Strokes meeting face to face pool into their joints; strokes facing
    across a gap melt only by a share of it, so counters stay open. Beads
    are capped by the room around them and the Lipschitz bound covers every
    term, so coarse sampling never misses a contour.
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
  (`GLYPH_DATA`), for pages that load it directly instead of through
  `bundle.py` (Liquid.Poster keeps a copy).
- `bundle.py` — assembles `index.html` from the source files above.
- `jsdom_check.js` — headless DOM/interaction smoke test (`npm i jsdom`, then
  `node jsdom_check.js` after `python3 bundle.py`).

### Poster tool

The poster tool now lives on its own as **Liquid.Poster**, at
https://markdo27.github.io/liquid-poster/ (source in the
[markdo27.github.io](https://github.com/markdo27/markdo27.github.io) repo,
`liquid-poster/`). It shares this tool's origin, so it can still draw with
the letters you sculpt here: it reads the project this tool autosaves.

## Design language

The tool is strictly black and white, the same as the type it makes. No
hue carries meaning; emphasis comes from inversion and motion (tokens at the
top of `styles.css`, all of it switched off under *reduce motion*):

- **Invert**: selection, on-states, focus, toasts and labels such as the
  glyph badge or *Manual* kern turn white with black text. The selected
  glyph in the character set is printed in negative.
- **Ink wipe**: an inverted state floods in from the left like ink running
  along a stroke. Toggles wipe when switched on; action buttons wipe on hover.
- **Liquid fill**: the main action (*Export OTF*, *PNG*) fills from below
  with a turning meniscus. A difference blend inverts exactly what it covers,
  label included. The fill stays full while an export is pouring.
- **Drip**: the full stop in the wordmark now and then swells, drops a bead
  and settles.
- **March**: things to drag say so by moving: the selected node's radius
  ring marches.

## Rebuilding

```
python3 bundle.py
```

regenerates `index.html` from the current source files.

## Editing glyphs

Open `index.html` in a browser. Click a letter in the character set, drag
its nodes to reshape the letter (drag a selected node's marching ring to
change stroke thickness at that point), or use the X/Y/R fields and Add/Delete Node
controls for finer control. Toggle Global Edit to apply a change to every
glyph sharing that node index, or Mirror to mirror edits across the
vertical axis. The canvas shows the measured baseline, cap height, ascender,
descender and the glyph's advance box; `Fit` / `+` / `−` or scrolling zoom it.

Keyboard: Ctrl/⌘Z undo, Shift+Ctrl/⌘Z redo, Ctrl/⌘S save, `[` `]` previous /
next glyph, Tab (canvas focused) cycles nodes, arrows nudge (Shift ×10),
Alt+arrows swell/pinch, Delete removes a node, Esc deselects. `Keys` in the
topbar lists them.

## Preview text

The preview blocks are live text: click or tap anywhere in one (or Tab to it)
and type — there is no separate text box. The caret is a thin bar in the
block's ink, cap-height tall; it blinks, and holds still with reduced motion.
Arrow keys move letter by letter (an accented letter is one step: the caret
never lands between a letter and its marks), Up/Down and Home/End follow the
lines as they are drawn, Shift extends the selection, a drag selects, a
double-click selects a word and Ctrl/⌘A the whole block; a drag held at the
top or bottom edge scrolls. Right-click gives the usual Cut / Copy / Paste on
the selection. Enter starts a new line. Esc (or Ctrl/⌘ Enter) leaves the text
for the block itself — Tab then moves on to its controls, Enter goes back in —
and a click outside leaves it too; while a preview has focus the editor
shortcuts above stay out of the way (Ctrl/⌘S still saves).

Keys go to an invisible native textarea kept at the caret, so IME composition
(Vietnamese Telex / VNI, macOS Vietnamese, dead keys, mobile keyboards),
paste and screen readers all work as in any text field. Undo is the app's:
each typing burst — the first edit after focusing, after a pause or after
moving the caret; each paste or cut — is one Ctrl/⌘Z step, on the same stack
as glyph edits; typing over a selection (after Ctrl/⌘A, a drag) starts a new
step too. An undo that brings a block back or removes one keeps the caret in
the block you were typing in (blocks keep a stable id), and an undo of typing
leaves focus where it was; if the undo takes away the very block you were
typing in, focus moves to the nearest remaining block (the block, not its
text, so the next key changes nothing). Each preview's text field is labelled
with its position and size for screen readers. A block holds up to 5,000
characters and all blocks together 20,000; Add block and the proofs may add
their short strings on top (up to 2,000 more) and there are at most 40
blocks — exactly what a project file and the autosave keep, so everything
comes back after a reload. The project autosaves half a second after you
stop, and at once when the tab is hidden or closed; the save status only
speaks (to a screen reader) when a save settles, and shows a dot while one is
pending.

Spaces are never collapsed: every space (or tab) is one word space, so two
spaces show as two; `\n` is a hard line break. Lines wrap between words, and
the one space where a line wraps hangs past the right edge; more spaces than
that flow on to the next line (as CSS `break-spaces` does), so every space you
type at the edge, or on a line of nothing but spaces, moves the caret. A word
wider than the column shrinks the block to fit, down to 8px; one still too
wide breaks between letters. Every block keeps room above its first line for
the font's ascender (its tallest stacked Vietnamese capital), as a line box
keeps a font's ascent and as the export does, so typing an accent never moves
the text. An emoji, flag or ZWJ sequence the font can't draw is one dashed box
and one caret step. The SVG / PNG specimen exports use this same layout and
fit rule, line breaks included.

The selection and the empty-block placeholder take their colours from the ink
and the ground by the WCAG contrast formula: the selection stands at least 3:1
off the ground with the ink at least 3:1 on it (on the grey ink that makes it a
light band under the letters), and the placeholder at least 3:1 off the ground,
on every ink swatch and on paper. In Windows High Contrast (forced colours)
the caret and focus rule are drawn in the system text colour and the selection
in the system highlight.

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

The same machinery covers other Latin capitals: diaeresis, ring, caron, dot
above, macron, cedilla and ogonek are mark glyphs too, and the app computes
every precomposed capital the current marks can build (Ä Å Ç Č Ñ Š Ž Ę …),
lists them in the *Latin* row and exports them.

Selecting a Vietnamese letter in the editor shows its base nodes (hollow, on a
dashed skeleton) and its mark nodes (grey-filled, on a dotted skeleton):
dragging a mark node edits that mark in every letter
that uses it. *Mark size* and *Mark gap* in the editor panel tune all marks at
once. Text is normalised, so precomposed (NFC) and decomposed (NFD) input,
upper or lower case, all render; anything the font can't draw yet shows as a
dashed box and is listed in a toast instead of vanishing.

## Spacing, metrics and kerning

Metrics are measured from the ink, not the skeleton frame: baseline = the
median foot of H I E L N…, cap height = their median top, and the em is set so
caps are 70 % of it; the ascender is the tallest stacked Vietnamese capital and
the descender the lowest ink (dot below, comma, brackets). Preview sizes, the
OTF (UPM 1000, caps ≈ 700) and the line-height control all share that em, so
`Leading` behaves like CSS line-height on a real font.

Sidebearings are optical: each glyph is scanned into left/right ink profiles
and loses sidebearing in proportion to the white its own shape already holds
(an O or A gets less than an H). Kerning is only about how two shapes meet —
how much white one side carries on its own is the sidebearings' job. It adds
two interaction terms, scaled by the *Kerning* slider: *nesting* (how much
farther apart the nearest inks are than the two sidebearings alone would put
them: A|V, L|T, P|.) and *shared open white* (white both shapes leave open in
the same rows, relative to H|H: the hole under T's arm, the bellies of O|O). A
floor keeps the nearest ink — accents included — at least 0.4 × the H|H gap
apart (the nearest-ink test also looks ±10% of the cap height up and down, so
a period beside the low bar of a 4 counts). HH, TH, NN stay at zero. A pair
override set on base letters (TA) applies to their accented forms (TÁ TẤ).
Per-glyph `Left SB` / `Right SB` fields override the automatic sidebearings
(stored as offsets, so they survive later shape changes), and the `Pair` row
overrides any single pair's kerning (Vietnamese letters included) with a live
preview. Kerning is applied in the previews and the specimen exports, and
written into the OTF as a GPOS table.

## Projects

Work autosaves to the browser (`localStorage`, key `liquidfont.project.v1`)
and can be saved to / opened from a `.liquid.json` file with `Save` / `Open`.
Opened files are validated into a staging copy (every value clamped to its
slider's range) and only applied if the whole file passes. Undo covers node
edits, sidebearings, kerning pairs, shape/spacing/accent settings, presets and
preview blocks.
The saved project includes every skeleton with your edits applied, which
[Liquid.Poster](https://markdo27.github.io/liquid-poster/) reads so posters use
your glyphs.

## Export

- **OTF** — every letter, numeral, punctuation mark and Vietnamese capital as
  cubic outlines; lowercase and Vietnamese lowercase code points map to the
  caps, NBSP to the space, zero-width combining marks for decomposed text, a
  drawn `.notdef`, AGL glyph names, measured vertical metrics (hhea = typo,
  OS/2 v4 with USE_TYPO_METRICS, Vietnamese code page), real `hmtx` left
  sidebearings, an ASCII-safe PostScript name (the Unicode family name is
  kept), a 2000-unit em, class-based GPOS kerning (PairPos format 2) and GPOS
  mark-to-base anchors + GDEF, so combining accents land on any letter even
  without a precomposed glyph.
- **SVG / PNG** — the whole specimen (every preview block with its own size,
  leading, tracking and ink/paper colours).
