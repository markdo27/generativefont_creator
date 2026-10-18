# Liquid.Font — band-score benchmark

Four audit rounds, each scored by four independent specialist auditors (type
designer, Vietnamese typographer, product/visual designer, font engineer)
against the same fixed rubric. Every round audited a frozen snapshot of the
branch, served locally and driven in headless Chromium; auditors exported and
inspected real OTF files (fontTools, HarfBuzz, OTS), measured outlines,
spacing and timings, and had to cite evidence for every score. Fixes from
each round's findings landed before the next snapshot.

## Scores

Band 1–9, IELTS-style (half bands allowed). Overall = mean of C1–C8, rounded
to the nearest half band.

| Criterion | R1 (baseline) | R2 | R3 | R4 |
|---|---|---|---|---|
| C1 Letterform quality | 4.5 | 6.0 | 6.5 | 7.0 |
| C2 Character coverage & Vietnamese | 2.5 | 6.0 | 7.0 | 7.5 |
| C3 Spacing & metrics | 3.5 | 6.5 | 6.5 | 7.0 |
| C4 Font-creation functions | 4.0 | 6.0 | 6.5 | 7.0 |
| C5 Export & technical correctness | 4.5 | 6.5 | 7.0 | 7.5 |
| C6 UX & interaction design | 5.0 | 6.5 | 7.0 | 7.5 |
| C7 Visual aesthetic & brand | 6.5 | 7.0 | 7.0 | 7.0 |
| C8 Robustness & performance | 5.5 | 6.0 | 6.5 | 7.0 |
| Mean | 4.50 | 6.31 | 6.75 | 7.19 |
| **Overall band** | **4.5** | **6.5** | **7.0** | **7.0** |

Every criterion rose by at least half a band from the baseline; Vietnamese
(C2) moved furthest, from 2.5 to 7.5.

## Rubric

| Band | Descriptor |
|---|---|
| 9 | Expert — foundry / pro-tool grade, no meaningful flaw |
| 8 | Very good — rare, minor flaws |
| 7 | Good — works well; a few gaps a professional would flag |
| 6 | Competent — functional, clear limitations that affect results |
| 5 | Modest — partial; frequent issues |
| 4 | Limited — major gaps |
| 3 | Extremely limited |
| 2 | Intermittent |
| 1 | Absent |

- **C1 Letterform quality** — weight/colour consistency, proportions, curve
  quality, legibility at text and display sizes, every flow-state preset.
- **C2 Character coverage & Vietnamese** — charset breadth; all 67 Vietnamese
  capitals + Đ, lowercase mapping, mark design, placement, stacking, marks
  never melted into the letter, NFC and NFD input.
- **C3 Spacing & metrics** — sidebearings, kerning, baseline/cap consistency,
  vertical metrics and line spacing (room for stacked marks), word space.
- **C4 Font-creation functions** — editing precision, guides, undo/redo,
  persistence, per-glyph spacing, workflow.
- **C5 Export & technical correctness** — OTF validity, cmap, metrics tables,
  naming, kerning, SVG/PNG and poster exports.
- **C6 UX & interaction design** — discoverability, feedback, keyboard,
  accessibility, responsive layout, error/empty states.
- **C7 Visual aesthetic & brand coherence** — hierarchy, UI typography, colour,
  rhythm, consistency between the two tools, polish.
- **C8 Robustness & performance** — console errors, editing responsiveness,
  edge cases, hostile input, code health.

## What each round found, and what changed

### Round 1 — baseline 4.5
Vietnamese text was silently dropped ("TIẾNG VIỆT" → "TING VIT"); 42 glyphs
only; counters closed in five of six presets; every glyph had the same fixed
sidebearing and nothing was kerned; the OTF baseline sat 10–14% of the em
below the letters and caps overflowed the ascender; the Leading control did
nothing below 140%; no save, no redo, no keyboard access to the glyph grid;
26 unnamed controls; unusable at phone width.

Built in response: diacritic composition (`glyph-compose.js`) with shared,
editable mark glyphs and Vietnamese stacking rules; ink-measured metrics;
optical sidebearings and profile kerning written to GPOS (`font-tables.js`);
lowercase cmap, combining marks, notdef, AGL names; autosave and project
files; undo/redo and shortcuts; editor guides; engine counter clamp, spline
strokes, culling; retuned glyphs and 18 new punctuation glyphs; accessible,
responsive UI; Vietnamese in the poster tool.

### Round 2 — 6.5
Outlines were straight-line facets; kerning loose on open shapes; the Đ bar
flooded its counter; a tone beside a circumflex touched its apex; the ascender
sat below the tallest stacks; non-ASCII font names produced fonts browsers
rejected; Global edit + Add Node displaced nodes; hostile project files froze
the tab; a keyboard trap on the canvas; Export hidden at 1024 px.

Fixed: cubic outlines everywhere; interaction-only kerning (nesting + shared
open white) with an ink floor; per-pair kern overrides; measured ascender,
OS/2 v4 + USE_TYPO_METRICS, cp1258, real hmtx LSBs, ASCII PostScript name;
measured side-tone placement and vertex-to-segment clearance; hard-unioned Đ
bar; validated/clamped projects; undo over settings and blocks; canvas focus
scoping; distinct presets; M/N/A/4/W retuned; $ ₫ € © … ° and brackets;
uploaded-font accents kept crisp in the poster; poster persistence.

### Round 3 — 7.0
Kerning let `.4`, `,4`, `Z4` collide (same-row test only); overrides on A
didn't reach Á Ấ; heavy presets still clotted M W # @ 8; OTF rounding kinked
short curve segments; GPOS was 17k unclassed pairs; coverage stopped at
Vietnamese; focus hid behind the pinned exports; Ctrl+Z ignored with a slider
focused.

Fixed: nearest-ink test dilated vertically, kern clamps, floor always wins —
an all-pairs scan finds no pair closer than 0.3× the H|H gap (basic set,
three presets, and all Vietnamese composites); base-letter override fallback;
computed Latin coverage (every capital the marks can build) and seven new
marks; GPOS mark-to-base + GDEF; class-based kerning (GPOS 160 KB → 33 KB);
2000-unit em; hhea extents and Windows metrics; roving-tabindex glyph grid and
skip links; focus-safe control bar; per-glyph melt tuning.

### Round 4 — 7.0 (final)
Verified: no ink collisions anywhere — about 75k live pairs per preset (base
set plus composites) and 11k pairs shaped through HarfBuzz in the OTFs, closest
0.30× the H|H gap (round 3's font had six collisions); 11,859 Vietnamese pairs
per preset clean; every round-3 UX gap closed (Tab stops to Export 227 → 74,
0 unnamed controls, poster undo with named steps); 321-glyph OTF (all 67
Vietnamese caps, 179 Latin composites, lowercase mapped) passing OTS,
fontTools and Chrome, class GPOS 32 KB, mark-to-base + GDEF, kerning identical
to the app over 75k pairs; hostile and oversized project files handled; heavy
presets' small counters reopened (Molten @ 0.05 → 0.16 of O).

Remaining findings (why it is a 7, not an 8):
- C1: symbols without melt tuning still clot in the heaviest presets; outlines
  carry 63–136 segments with some extremes between nodes.
- C3: rhythm slipped slightly (T with rounds loose, TO −2); punctuation tucks
  clamped.
- C2/C5: no mark-on-mark (mkmk) positioning or anchors on composites; Ł ß Ő Ű
  Ș Ț Þ and several Latin-1 symbols still missing; uploaded-font Đ bar erodes in
  the poster.
- C4: no multi-node selection, glyph copy or user-added glyphs.
- C6/C7: block add/remove jumped the view (a round-4 regression), black ink
  blanked dark previews, 1024 px top bar overflowed; presets still read as one
  family.
- C8: slider scrubbing ~10 fps (engine-bound; a Web Worker pool is the next
  step); OTF export blocks the main thread for ~0.6 s.

### After round 4 (not scored)
Fixed straight after the final audit, outside the four scored rounds: preview
blocks keep the scroll position and focus the new block; black ink switches
previews to paper; swatches keep focus; coverage moved into the character-set
header so the topbar fits at 1024 px; focus never hides under the sticky
mobile bar; poster captions follow the colour pair and focused fields stay in
view; the descender includes the Latin composites (cedillas); Ð composes like
Đ; Latin coverage extended to U+024F (321 glyphs, 560 cmap entries); the most
specific kerning override wins (T|Á before T|A); Æ Ø Œ carry mark anchors;
`post` underline metrics; accent-folded download names; the punctuation kern
clamp relaxed (still no collisions in the all-pairs scan); melt factors for
™ % ® & ₫ and a gentler W.
