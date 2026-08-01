// ---------------------------------------------------------------------------
// Poster generator.
//
// Big title: one or more ROWS of text, each independently placed, sized and
// tracked. Each row is rendered from either the built-in Liquid glyph engine
// (reusing blob-engine.js + glyphs_meta.js, same as the Font tool) or an
// uploaded font file (parsed with opentype.js). Every row is rasterized to a
// shared offscreen mask once per ECHO — copies of the whole composition
// transformed along a trail / radial spiral, or fed back through themselves —
// then blurred, thresholded into a scalar field, and re-traced with
// BlobEngine.traceField. That's the same marching-squares + Chaikin pipeline
// the Font tool uses per glyph, just fed a raster-derived field instead of an
// analytic capsule one; the blur+threshold is what fuses separate copies into
// one molten mass.
//
// Small text: any number of independent blocks in Google Mono webfonts, drawn
// crisply on top and untouched by the melt.
//
// Positions are stored as PERCENTAGES of the canvas, so changing the poster
// size rescales the composition instead of scattering it.
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var GH = GLYPH_DATA.H, GW = GLYPH_DATA.W, BASE = GLYPH_DATA.glyphs;
  var SIDE = 5, SPACE = 30;
  // Flow states lifted from the Font tool, so a shape sculpted there can be
  // reproduced here by name.
  var GLYPH_PRESETS = {
    liquid: { mass: 1.00, melt: 15, tension: -4, wobble: 0, grain: 0.045, smooth: 2 },
    mercury: { mass: 1.05, melt: 24, tension: -2, wobble: 0, grain: 0.045, smooth: 3 },
    acid: { mass: 1.08, melt: 26, tension: -2, wobble: 2.2, grain: 0.050, smooth: 3 },
    molten: { mass: 1.16, melt: 30, tension: 2, wobble: 1.2, grain: 0.040, smooth: 3 },
    bubble: { mass: 0.94, melt: 7, tension: -7, wobble: 0, grain: 0.045, smooth: 2 },
    goo: { mass: 1.10, melt: 20, tension: 0, wobble: 3.6, grain: 0.070, smooth: 3 },
  };

  var SIZE_PRESETS = {
    square: [1200, 1200], portrait: [1000, 1333], tall: [1080, 1920], landscape: [1333, 1000],
  };

  // [css family, label, weight]. The weight matters: Space Mono and Courier
  // Prime ship 400/700 only, so asking Google for 600 404s and the browser
  // silently synthesises a different weight than the export would embed. Each
  // entry names a weight the family actually has, and that same number is used
  // for canvas rendering, the SVG attribute and the webfont request.
  var MONO_FONTS = [
    ["'JetBrains Mono'", 'JetBrains Mono', 700],
    ["'IBM Plex Mono'", 'IBM Plex Mono', 600],
    ["'Space Mono'", 'Space Mono', 700],
    ["'Roboto Mono'", 'Roboto Mono', 600],
    ["'Fira Code'", 'Fira Code', 600],
    ["'Courier Prime'", 'Courier Prime', 700],
  ];
  function fontWeight(fam) {
    for (var i = 0; i < MONO_FONTS.length; i++) if (MONO_FONTS[i][0] === fam) return MONO_FONTS[i][2];
    return 400;
  }

  // Palette derived from the tool's black / white / orange identity, plus a
  // cool complement of the orange so posters can go two-tone without leaving
  // the family.
  var RAMPS = [
    ['#000000', '#141414', '#2b2b2b', '#4d4d4d', '#7a7a7a', '#a8a8a8', '#d4cfc5', '#f5f2ec', '#ffffff'],
    ['#1f0800', '#3d1100', '#661d00', '#8f2900', '#c23a00', '#ff5000', '#ff7a3d', '#ffa679', '#ffd2b8'],
    ['#001018', '#002233', '#003d5c', '#005c8a', '#0084c2', '#00a8f0', '#4cc3f7', '#94dbfb', '#d1eefd'],
  ];
  var PAIRS = [
    { name: 'Paper', bg: '#f5f2ec', ink: '#141414' },
    { name: 'Noir', bg: '#000000', ink: '#ffffff' },
    { name: 'Blaze', bg: '#f5f2ec', ink: '#ff5000' },
    { name: 'Ember', bg: '#000000', ink: '#ff5000' },
    { name: 'Sand', bg: '#ffd2b8', ink: '#8f2900' },
    { name: 'Deep', bg: '#002233', ink: '#00a8f0' },
  ];

  var TITLE_STYLE_HINTS = {
    melt: 'Glyph silhouettes fused by the blur — blocky and poster-weight.',
    ink: 'Letter skeletons drawn as one thin variable-width pen stroke, joined along the baseline, with small pockets flooded solid. Needs the built-in skeleton; an uploaded font falls back to Melt geometry.',
  };

  // ------------------------------------------------------------------ state
  var uid = 0;
  // Every big-title row carries its own transform AND its own style, so one
  // poster can pair a melted headline with an inked subhead.
  function makeRow(over) {
    var row = {
      id: ++uid, text: 'TEMPO', size: 170, tracking: 0.02,
      xp: 50, yp: 40, rot: 0,
      // how the letterform geometry is built
      style: 'melt', flow: 14, slant: 8, weight: 0.7, pocket: 0.045,
      // how the traced contour is drawn
      effect: 'solid', mode: 'outline',
      gap: 4, jitter: 2.2,          // rough
      lines: 5, spacing: 9,         // contour
    };
    if (over) Object.keys(over).forEach(function (k) { row[k] = over[k]; });
    return row;
  }
  function makeBlock(over) {
    var b = {
      id: ++uid, text: 'NEW TEXT', font: "'JetBrains Mono'",
      size: 15, lh: 145, align: 'left', xp: 6, yp: 92, color: '#141414',
    };
    if (over) Object.keys(over).forEach(function (k) { b[k] = over[k]; });
    return b;
  }

  var state = {
    fontSource: 'builtin', uploadedFont: null, uploadedFontName: '',
    glyph: { preset: 'liquid', mass: 1.00, melt: 15, tension: -4, wobble: 0, grain: 0.045, smooth: 2 },

    bigRows: [makeRow({ text: 'TEMPO' })],
    smallBlocks: [
      makeBlock({
        text: 'TEMPO CLUB / 00:00\n012KM NIGHT LOOP',
        align: 'right', xp: 94, yp: 7,
      }),
    ],

    seed: 5,
    melt: 8, tension: 2, wobble: 1.6, grain: 0.055, smooth: 2, strokeWidth: 1.5,

    canvasPreset: 'portrait', canvasW: 1000, canvasH: 1333,
    ink: '#141414', bg: '#f5f2ec', bgTransparent: false,

    zoom: 0.5,
    selected: null, // {type:'row'|'block', id}
  };

  // -------------------------------------------------------------- utilities
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2200);
  }
  function dl(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function safeName() {
    var t = (state.bigRows[0] && state.bigRows[0].text) || 'poster';
    return t.trim().replace(/[^a-z0-9\-_]+/gi, '-').toLowerCase() || 'poster';
  }
  function escapeXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mk(tag, cls, txt) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt != null) el.textContent = txt;
    return el;
  }
  function findRow(id) { for (var i = 0; i < state.bigRows.length; i++) if (state.bigRows[i].id === id) return state.bigRows[i]; return null; }
  function findBlock(id) { for (var i = 0; i < state.smallBlocks.length; i++) if (state.smallBlocks[i].id === id) return state.smallBlocks[i]; return null; }

  // ------------------------------------------------------- built-in glyphs
  var builtinCache = {};
  function glyphKey() {
    var g = state.glyph;
    return [g.mass, g.melt, g.tension, g.wobble, g.grain, g.smooth].join(',');
  }
  function builtinRings(L) {
    var key = L + '@' + glyphKey();
    if (builtinCache[key]) return builtinCache[key];
    var g = state.glyph, r;
    try {
      r = BlobEngine.glyphRings(BASE[L], {
        mass: g.mass, melt: g.melt, tension: g.tension, wobble: g.wobble,
        grain: g.grain, smooth: g.smooth, res: 1.6, simplify: 0.3,
        seed: 7 + L.charCodeAt(0) * 13,
      });
    } catch (e) { r = []; }
    if (Object.keys(builtinCache).length > 400) builtinCache = {};
    builtinCache[key] = r;
    return r;
  }
  function inkBounds(rings) {
    var a = 1e9, b = -1e9;
    rings.forEach(function (r) { r.forEach(function (p) { if (p[0] < a) a = p[0]; if (p[0] > b) b = p[0]; }); });
    return a > b ? [0, GW] : [a, b];
  }

  // Lay out one row using the built-in glyph set. Returns the same shape as
  // uploadRowLayout so the rest of the pipeline never has to know which font
  // source produced it.
  // Both layout builders hand back raw geometry rather than a finished shape,
  // so finishLayout can slant it and measure the result before anyone draws.
  function builtinRowGeom(text, size, tracking) {
    var scale = size / GH, gap = tracking * size;
    var x = 0, y = 0, polys = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (/\s/.test(ch)) { x += SPACE * scale + gap; continue; }
      var L = ch.toUpperCase();
      if (!BASE[L]) { x += SPACE * scale + gap; continue; }
      var rings = builtinRings(L), bb = inkBounds(rings);
      var w = (bb[1] - bb[0] + SIDE * 2) * scale;
      var ox = x - (bb[0] - SIDE) * scale;
      for (var r = 0; r < rings.length; r++) {
        var ring = rings[r], poly = new Array(ring.length);
        for (var p = 0; p < ring.length; p++) poly[p] = [ox + ring[p][0] * scale, y + ring[p][1] * scale];
        polys.push(poly);
      }
      x += w + gap;
    }
    return { kind: 'polys', polys: polys, fallbackW: size * 0.6, fallbackH: size };
  }

  // Ink style, built-in font only: the glyph data is already a set of node
  // chains carrying per-node radii — i.e. a pen skeleton, not an outline. Using
  // it directly gives a genuinely variable-width stroke that swells where
  // strokes cross, instead of melting a fat silhouette into a blob.
  function builtinInkGeom(text, size, tracking, weight) {
    var scale = size / GH, gap = tracking * size;
    var x = 0, chains = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (/\s/.test(ch)) { x += SPACE * scale + gap; continue; }
      var L = ch.toUpperCase();
      if (!BASE[L]) { x += SPACE * scale + gap; continue; }
      var nmin = 1e9, nmax = -1e9;
      BASE[L].forEach(function (c) {
        c.forEach(function (n) {
          if (n[0] - n[2] < nmin) nmin = n[0] - n[2];
          if (n[0] + n[2] > nmax) nmax = n[0] + n[2];
        });
      });
      var w = (nmax - nmin + SIDE * 2) * scale;
      var ox = x - (nmin - SIDE) * scale;
      BASE[L].forEach(function (c) {
        chains.push(c.map(function (n) {
          return [ox + n[0] * scale, n[1] * scale, Math.max(0.6, n[2] * scale * weight)];
        }));
      });
      x += w + gap;
    }
    return { kind: 'chains', chains: chains, fallbackW: size * 0.6, fallbackH: size };
  }

  // ------------------------------------------------------- uploaded fonts
  // Some uploaded fonts — including this tool's own OTF export, which only
  // maps A–Z/0–9/punctuation — have no lowercase in their cmap at all.
  // font.stringToGlyphs() doesn't know that; it silently hands back .notdef
  // (usually an empty path) for anything unmapped, so the row renders as
  // nothing with no error. Look each character up ourselves and retry
  // uppercased before giving up, the same fallback the built-in font documents.
  function glyphIndexFor(font, ch) {
    var idx = font.charToGlyphIndex(ch);
    if (idx) return idx;
    var upper = ch.toUpperCase();
    if (upper !== ch) idx = font.charToGlyphIndex(upper);
    return idx || 0;
  }
  function uploadRowGeom(font, text, size, trackingPx) {
    var scale = size / font.unitsPerEm;
    var cmds = [];
    var x = 0, drawn = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (/\s/.test(ch)) { x += font.unitsPerEm * 0.28 * scale + trackingPx; continue; }
      var gi = glyphIndexFor(font, ch);
      var g = font.glyphs.get(gi);
      if (gi) { cmds = cmds.concat(g.getPath(x, 0, size).commands); drawn++; }
      x += (g.advanceWidth || font.unitsPerEm * 0.55) * scale + trackingPx;
    }
    return {
      kind: 'path', cmds: cmds, fallbackW: Math.max(x, size * 0.6), fallbackH: size,
      empty: text.length > 0 && drawn === 0,
    };
  }

  // Slant about the baseline: points above it swing right, so the baseline
  // itself stays put the way a real italic does.
  function shearGeom(geom, tan, pivotY) {
    if (!tan) return;
    if (geom.kind === 'polys') {
      geom.polys.forEach(function (poly) {
        poly.forEach(function (p) { p[0] -= tan * (p[1] - pivotY); });
      });
    } else if (geom.kind === 'chains') {
      geom.chains.forEach(function (ch) {
        ch.forEach(function (n) { n[0] -= tan * (n[1] - pivotY); });
      });
    } else {
      geom.cmds.forEach(function (c) {
        if (c.x != null) c.x -= tan * (c.y - pivotY);
        if (c.x1 != null) c.x1 -= tan * (c.y1 - pivotY);
        if (c.x2 != null) c.x2 -= tan * (c.y2 - pivotY);
      });
    }
  }

  function geomBBox(geom) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    if (geom.kind === 'polys') {
      geom.polys.forEach(function (r) { r.forEach(function (p) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }); });
    } else if (geom.kind === 'chains') {
      geom.chains.forEach(function (ch) { ch.forEach(function (n) {
        if (n[0] - n[2] < x0) x0 = n[0] - n[2]; if (n[0] + n[2] > x1) x1 = n[0] + n[2];
        if (n[1] - n[2] < y0) y0 = n[1] - n[2]; if (n[1] + n[2] > y1) y1 = n[1] + n[2];
      }); });
    } else {
      var p = new opentype.Path(); p.commands = geom.cmds;
      try {
        var bb = p.getBoundingBox();
        x0 = bb.x1; y0 = bb.y1; x1 = bb.x2; y1 = bb.y2;
      } catch (e) { /* falls through to the guard below */ }
    }
    if (!(isFinite(x0) && isFinite(y0) && x1 > x0 && y1 > y0)) {
      return [0, -geom.fallbackH, geom.fallbackW, 0];
    }
    return [x0, y0, x1, y1];
  }

  // Stamp overlapping discs along a chain, lerping the radius between nodes.
  // The mask is blurred and thresholded downstream, so discs are indistinguish-
  // able from a true tapered capsule and cost a fraction of the code.
  function strokeChain(ctx, ch) {
    if (ch.length === 1) {
      var n = ch[0];
      ctx.moveTo(n[0] + n[2], n[1]);
      ctx.arc(n[0], n[1], n[2], 0, Math.PI * 2);
      return;
    }
    for (var i = 0; i < ch.length - 1; i++) {
      var a = ch[i], b = ch[i + 1];
      var d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var steps = Math.max(2, Math.ceil(d / Math.max(0.8, Math.min(a[2], b[2]) * 0.45)));
      for (var s = 0; s <= steps; s++) {
        var t = s / steps;
        var px = a[0] + (b[0] - a[0]) * t;
        var py = a[1] + (b[1] - a[1]) * t;
        var pr = a[2] + (b[2] - a[2]) * t;
        ctx.moveTo(px + pr, py);
        ctx.arc(px, py, pr, 0, Math.PI * 2);
      }
    }
  }

  function drawGeom(geom, ctx) {
    ctx.beginPath();
    if (geom.kind === 'polys') {
      geom.polys.forEach(function (r) {
        if (!r.length) return;
        ctx.moveTo(r[0][0], r[0][1]);
        for (var i = 1; i < r.length; i++) ctx.lineTo(r[i][0], r[i][1]);
        ctx.closePath();
      });
    } else if (geom.kind === 'chains') {
      geom.chains.forEach(function (ch) { strokeChain(ctx, ch); });
    } else {
      geom.cmds.forEach(function (c) {
        if (c.type === 'M') ctx.moveTo(c.x, c.y);
        else if (c.type === 'L') ctx.lineTo(c.x, c.y);
        else if (c.type === 'C') ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
        else if (c.type === 'Q') ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
        else if (c.type === 'Z') ctx.closePath();
      });
    }
    ctx.fill();
  }

  // The connector: an undulating, variable-width stroke running along the
  // baseline. Once the melt fuses it into the letters the row stops reading as
  // separate glyphs and starts reading as one continuous ink ribbon — which is
  // what makes a script wordmark look written rather than set.
  function makeRibbon(bbox, flow, seed) {
    if (flow <= 0) return [];
    var x0 = bbox[0], x1 = bbox[2], y0 = bbox[1], y1 = bbox[3];
    var h = Math.max(1, y1 - y0), w = Math.max(1, x1 - x0);
    var baseY = y1 - h * 0.30;
    var amp = h * 0.11;
    var n = Math.max(10, Math.round(w / 5));
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var wob = (BlobEngine.valueNoise(t * 5.5, seed * 0.37, seed) - 0.5) * 2
              + (BlobEngine.valueNoise(t * 13.1, seed * 0.71, seed + 31) - 0.5);
      var rr = flow * (0.45 + 0.85 * BlobEngine.valueNoise(t * 7.3 + 11, seed * 0.19, seed + 5));
      // taper the very ends so the ribbon enters and leaves like a brush lift
      var ease = Math.min(1, Math.min(t, 1 - t) * 9);
      pts.push([x0 + w * t, baseY + wob * amp, Math.max(0.4, rr * ease)]);
    }
    return pts;
  }

  // Layouts are pure functions of their inputs, so cache them — dragging a row
  // around must not re-tessellate its glyphs.
  var layoutCache = {};
  function rowLayout(row) {
    var text = (row.text || '').trim();
    if (!text) return null;
    var ink = row.style === 'ink';
    var slant = ink ? row.slant : 0;
    var flow = ink ? row.flow * (row.size / 180) : 0;
    var weight = ink ? row.weight : 1;
    var srcKey = state.fontSource === 'upload' ? 'u:' + state.uploadedFontName : 'b:' + glyphKey();
    var key = [srcKey, text, row.size, row.tracking, slant, flow, weight, ink, state.seed].join('|');
    if (layoutCache[key]) return layoutCache[key];

    var geom = null;
    if (state.fontSource === 'upload') {
      if (!state.uploadedFont) return null;
      try { geom = uploadRowGeom(state.uploadedFont, text, row.size, row.tracking * row.size); }
      catch (e) { console.error('upload layout failed', e); return null; }
      // Fires only on genuinely new (text, font) combos — this branch is
      // skipped entirely on a cache hit, so it can't spam on every slider drag.
      if (geom.empty) {
        toast('"' + text + '" has no matching glyphs in ' + state.uploadedFontName + ' (even uppercased)', 3800);
      }
    } else {
      geom = ink ? builtinInkGeom(text, row.size, row.tracking, weight)
                 : builtinRowGeom(text, row.size, row.tracking);
    }

    var bbox = geomBBox(geom);
    if (slant) {
      shearGeom(geom, Math.tan(slant * Math.PI / 180), bbox[3]);
      bbox = geomBBox(geom);
    }
    var ribbon = makeRibbon(bbox, flow, state.seed + 3);
    if (ribbon.length) {
      // the ribbon can bulge past the glyphs, so re-measure with it included
      ribbon.forEach(function (p) {
        if (p[0] - p[2] < bbox[0]) bbox[0] = p[0] - p[2];
        if (p[0] + p[2] > bbox[2]) bbox[2] = p[0] + p[2];
        if (p[1] - p[2] < bbox[1]) bbox[1] = p[1] - p[2];
        if (p[1] + p[2] > bbox[3]) bbox[3] = p[1] + p[2];
      });
    }

    var out = {
      bbox: bbox,
      draw: function (ctx) {
        drawGeom(geom, ctx);
        if (!ribbon.length) return;
        ctx.beginPath();
        strokeChain(ctx, ribbon);
        ctx.fill();
      },
    };
    if (Object.keys(layoutCache).length > 120) layoutCache = {};
    layoutCache[key] = out;
    return out;
  }

  // Pick a point size that makes this row span `frac` of the canvas width, so
  // a freshly added row never lands overflowing the poster.
  function autoFitRowSize(row, frac) {
    var REF = 100;
    var lay = rowLayout({ text: row.text, size: REF, tracking: row.tracking });
    if (!lay) return;
    var w = lay.bbox[2] - lay.bbox[0];
    if (!(w > 0)) return;
    row.size = Math.round(Math.max(20, Math.min(500, REF * (frac * state.canvasW) / w)));
  }

  // Each row placed so its ink bbox centre lands on the row's (xp,yp) point.
  function buildRowLayouts() {
    var W = state.canvasW, H = state.canvasH, out = [];
    state.bigRows.forEach(function (row) {
      var lay = rowLayout(row);
      if (!lay) return;
      var bb = lay.bbox;
      out.push({
        row: row, layout: lay,
        cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2,
        w: bb[2] - bb[0], h: bb[3] - bb[1],
        px: row.xp / 100 * W, py: row.yp / 100 * H,
      });
    });
    return out;
  }
  // Once rows can rotate, the selection box stops being axis-aligned: corners
  // are the source of truth and anything that needs an AABB derives one.
  function rowCorners(rl) {
    var hw = rl.w / 2, hh = rl.h / 2;
    var rad = (rl.row.rot || 0) * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(function (c) {
      return [rl.px + c[0] * cos - c[1] * sin, rl.py + c[0] * sin + c[1] * cos];
    });
  }
  function cornersAABB(cs) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    cs.forEach(function (p) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    });
    return [x0, y0, x1, y1];
  }
  // Test in the row's own frame so rotation is handled by un-rotating the point.
  function pointInRow(p, rl, slack) {
    slack = slack || 0;
    var rad = -(rl.row.rot || 0) * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var dx = p.x - rl.px, dy = p.y - rl.py;
    var lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    return Math.abs(lx) <= rl.w / 2 + slack && Math.abs(ly) <= rl.h / 2 + slack;
  }

  // ------------------------------------------------------- distance field
  // The three line treatments are all "the same shape, offset inward by N
  // pixels", so the pipeline needs true distance — not the blurred alpha ramp,
  // whose spacing would drift with the melt radius. This is the standard
  // Felzenszwalb & Huttenlocher exact squared-EDT: two O(n) passes of a 1-D
  // lower-envelope scan, run down the columns then across the rows.
  var EDT_INF = 1e20;
  function edt1d(f, d, v, z, n) {
    var k = 0;
    v[0] = 0; z[0] = -EDT_INF; z[1] = EDT_INF;
    for (var q = 1; q < n; q++) {
      var s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = EDT_INF;
    }
    k = 0;
    for (q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      var dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }
  function edt2d(grid, w, h) {
    var m = Math.max(w, h);
    var d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
    var col = new Float64Array(h), x, y;
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) col[y] = grid[y * w + x];
      edt1d(col, d, v, z, h);
      for (y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    var row = new Float64Array(w);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) row[x] = grid[y * w + x];
      edt1d(row, d, v, z, w);
      for (x = 0; x < w; x++) grid[y * w + x] = d[x];
    }
  }
  // Signed distance in mask pixels: negative inside the shape, positive out.
  // Also reports the deepest point inside, which is what tells the caller how
  // many inward contours the shape can actually hold.
  function signedDistance(alpha, w, h, level) {
    var n = w * h, i;
    var inside = new Float32Array(n), outside = new Float32Array(n);
    for (i = 0; i < n; i++) {
      if (alpha[i * 4 + 3] >= level) { inside[i] = 0; outside[i] = EDT_INF; }
      else { inside[i] = EDT_INF; outside[i] = 0; }
    }
    edt2d(inside, w, h);
    edt2d(outside, w, h);
    var sd = new Float32Array(n), deepest = 0;
    for (i = 0; i < n; i++) {
      var v = Math.sqrt(inside[i]) - Math.sqrt(outside[i]);
      sd[i] = v;
      if (v < deepest) deepest = v;
    }
    return { sd: sd, maxInside: -deepest };
  }

  // Wrap the distance field as something traceField can contour: shift it by
  // `offset` to move the line inward, and displace it with noise to rough it up.
  function makeOffsetField(sd, w, h, maskDpr, ox, oy, offset, noise, grain, seed) {
    return function (x, y) {
      var px = Math.round((x - ox) * maskDpr), py = Math.round((y - oy) * maskDpr);
      // anything off the mask is far outside, so every contour closes
      var d = (px < 0 || px >= w || py < 0 || py >= h) ? 1e4 : sd[py * w + px] / maskDpr;
      var v = d + offset;
      if (noise > 0) {
        var nz = BlobEngine.valueNoise(x * grain, y * grain, seed) - 0.5;
        nz += (BlobEngine.valueNoise(x * grain * 2.3, y * grain * 2.3, seed + 91) - 0.5) * 0.5;
        v += nz * noise;
      }
      return v;
    };
  }

  // ------------------------------------------------------------- effects
  // Each effect is just a list of contour levels to trace. Offsets are in
  // poster pixels measured inward from the shape's edge.
  var EFFECT_HINTS = {
    solid: 'One clean contour around the mass.',
    rough: 'A second line just inside the first, shivered with high-frequency noise — reads as a rough double-stroke band.',
    contour: 'Nested lines stepping inward at even spacing, like a topographic map.',
  };
  function effectLevels(row) {
    var wob = state.wobble;
    if (row.effect === 'contour') {
      var out = [];
      for (var i = 0; i < row.lines; i++) {
        out.push({ offset: i * row.spacing, noise: wob, grain: state.grain });
      }
      return out;
    }
    if (row.effect === 'rough') {
      return [
        { offset: 0, noise: wob, grain: state.grain },
        { offset: row.gap, noise: wob + row.jitter, grain: state.grain * 4 },
      ];
    }
    return [{ offset: 0, noise: wob, grain: state.grain }];
  }
  // How far inward the deepest line of this effect reaches — the mask has to
  // be padded enough to still contain it.
  function effectDepth(row) {
    if (row.effect === 'contour') return row.lines * row.spacing;
    if (row.effect === 'rough') return row.gap;
    return 0;
  }

  // ------------------------------------------------------------ raster field
  function rowBounds(rl) {
    var b = cornersAABB(rowCorners(rl));
    var pad = state.melt * 0.8 + state.strokeWidth + effectDepth(rl.row) + state.wobble * 2 + 12;
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  }

  function rasterizeRow(rl, bounds, maskDpr) {
    var x0 = bounds[0], y0 = bounds[1];
    var pw = Math.max(1, Math.round((bounds[2] - x0) * maskDpr));
    var ph = Math.max(1, Math.round((bounds[3] - y0) * maskDpr));
    var mask = document.createElement('canvas'); mask.width = pw; mask.height = ph;
    var mctx = mask.getContext('2d');
    mctx.setTransform(maskDpr, 0, 0, maskDpr, 0, 0);
    mctx.translate(-x0, -y0);
    mctx.fillStyle = '#000';
    mctx.translate(rl.px, rl.py);
    if (rl.row.rot) mctx.rotate(rl.row.rot * Math.PI / 180);
    mctx.translate(-rl.cx, -rl.cy);
    rl.layout.draw(mctx);
    return { canvas: mask, w: pw, h: ph };
  }

  var cachedContour = null;

  // Rows are traced independently now, so each one can carry its own effect
  // and its own fill mode. (They no longer melt into each other — a shared
  // trace could not be split back apart per row.)
  function computeContour(exportMode) {
    var out = { rows: [] };
    buildRowLayouts().forEach(function (rl) {
      var bounds = rowBounds(rl);
      var maskDpr = exportMode ? 3 : 1.8;
      var bw = bounds[2] - bounds[0], bh = bounds[3] - bounds[1];
      var MAXPIX = exportMode ? 2600 : 1500;
      if (bw * maskDpr > MAXPIX || bh * maskDpr > MAXPIX) {
        maskDpr = MAXPIX / Math.max(bw, bh);
      }

      var mask = rasterizeRow(rl, bounds, maskDpr);
      var src = mask.canvas;
      if (state.melt > 0) {
        var bc = document.createElement('canvas'); bc.width = mask.w; bc.height = mask.h;
        var bctx = bc.getContext('2d');
        bctx.filter = 'blur(' + (state.melt * maskDpr) + 'px)';
        bctx.drawImage(mask.canvas, 0, 0);
        src = bc;
      }
      var img = src.getContext('2d').getImageData(0, 0, mask.w, mask.h).data;

      // tension biases the threshold, fattening or starving the mass
      var level = Math.max(10, Math.min(245, 128 - state.tension * 3));
      var dist;
      try { dist = signedDistance(img, mask.w, mask.h, level); }
      catch (err) { console.error('distance field failed', err); return; }
      var maxInside = dist.maxInside / maskDpr;   // poster px

      var seedBase = state.seed * 13 + 7 + rl.row.id * 101;
      var levels = [];
      effectLevels(rl.row).forEach(function (lv, i) {
        // A line deeper than the thickest part of the mass has nothing to trace;
        // attempting it anyway shatters the field into thousands of noise
        // fragments and the O(n^2) chain repair then stalls the page.
        if (lv.offset > 0 && lv.offset >= maxInside - 0.5) return;
        // ease the noise off with depth for the same reason
        var noise = lv.noise * (1 - 0.6 * Math.min(1, lv.offset / Math.max(1, maxInside)));
        var field = makeOffsetField(dist.sd, mask.w, mask.h, maskDpr, bounds[0], bounds[1],
          lv.offset, noise, lv.grain, seedBase + i * 37);
        try {
          levels.push(BlobEngine.traceField(field, bounds, {
            res: exportMode ? 1.1 : 1.7, smooth: state.smooth, simplify: 0.35,
          }));
        } catch (err) { console.error('contour trace failed', err); levels.push([]); }
      });
      out.rows.push({ row: rl.row, levels: levels });
    });
    return out;
  }

  // ------------------------------------------------------------ small text
  var measureCtx = document.createElement('canvas').getContext('2d');
  function blockFontStr(b) { return fontWeight(b.font) + ' ' + b.size + 'px ' + b.font + ', monospace'; }
  function blockLayout(b) {
    var W = state.canvasW, H = state.canvasH;
    var lines = b.text.split('\n');
    var lh = b.size * (b.lh / 100);
    var x = b.xp / 100 * W, y = b.yp / 100 * H;
    measureCtx.font = blockFontStr(b);
    var maxW = 0;
    lines.forEach(function (l) { maxW = Math.max(maxW, measureCtx.measureText(l).width); });
    var blockH = lh * (lines.length - 1);
    var x0 = b.align === 'left' ? x : b.align === 'right' ? x - maxW : x - maxW / 2;
    return {
      lines: lines, lh: lh, x: x, y: y, align: b.align, width: maxW,
      bbox: [x0, y - b.size * 0.82, x0 + maxW, y + blockH + b.size * 0.26],
    };
  }
  function drawSmallBlocks(ctx) {
    ctx.textBaseline = 'alphabetic';
    state.smallBlocks.forEach(function (b) {
      var t = blockLayout(b);
      ctx.font = blockFontStr(b);
      ctx.fillStyle = b.color || state.ink;
      ctx.textAlign = b.align === 'left' ? 'left' : b.align === 'right' ? 'right' : 'center';
      t.lines.forEach(function (line, i) { ctx.fillText(line, t.x, t.y + t.lh * i); });
    });
  }

  // ------------------------------------------------------------------ paint
  // Backing-store scale: sharp at the current zoom without letting a zoomed-in
  // 1080x1920 poster allocate a gigapixel canvas.
  function renderScale() {
    var base = Math.min(window.devicePixelRatio || 1, 2);
    return Math.max(0.5, Math.min(3, state.zoom * base));
  }

  function sizeCanvases() {
    var W = state.canvasW, H = state.canvasH, s = renderScale(), z = state.zoom;
    ['posterCanvas', 'overlayCanvas'].forEach(function (id) {
      var c = $(id);
      c.width = Math.max(1, Math.round(W * s));
      c.height = Math.max(1, Math.round(H * s));
      c.style.width = (W * z) + 'px';
      c.style.height = (H * z) + 'px';
    });
    var holder = $('canvasHolder');
    holder.style.width = (W * z) + 'px';
    holder.style.height = (H * z) + 'px';
  }

  function ringCentroid(r) {
    var x = 0, y = 0;
    for (var i = 0; i < r.length; i++) { x += r[i][0]; y += r[i][1]; }
    return { x: x / r.length, y: y / r.length };
  }

  // Ink style floods the small enclosed pockets — the slivers where the stroke
  // doubles back on itself — solid, and outlines everything else. That contrast
  // between hollow stroke and a few inked wedges is what sells the brush look.
  // Only the outermost contour is eligible; inner effect lines stay hairlines.
  function splitPockets(row, rings) {
    if (row.mode === 'filled' || row.style !== 'ink' || !(row.pocket > 0) || !rings.length) {
      return { line: rings, solid: [] };
    }
    var areas = rings.map(function (r) { return Math.abs(BlobEngine.signedArea(r)); });
    var maxA = 0;
    areas.forEach(function (a) { if (a > maxA) maxA = a; });
    var line = [], solid = [];
    rings.forEach(function (r, i) { (areas[i] < maxA * row.pocket ? solid : line).push(r); });
    return { line: line, solid: solid };
  }

  function traceRings(ctx, rings) {
    ctx.beginPath();
    rings.forEach(function (r) {
      ctx.moveTo(r[0][0], r[0][1]);
      for (var i = 1; i < r.length; i++) ctx.lineTo(r[i][0], r[i][1]);
      ctx.closePath();
    });
  }

  // Filled uses even-odd across every line the effect produced, so Solid reads
  // as a solid mass while Contour reads as concentric bands.
  function drawRowRings(ctx, entry) {
    var row = entry.row, levels = entry.levels;
    if (!levels.length) return;
    if (row.mode === 'filled') {
      ctx.beginPath();
      levels.forEach(function (rings) {
        rings.forEach(function (r) {
          ctx.moveTo(r[0][0], r[0][1]);
          for (var i = 1; i < r.length; i++) ctx.lineTo(r[i][0], r[i][1]);
          ctx.closePath();
        });
      });
      ctx.fillStyle = state.ink;
      ctx.fill('evenodd');
      return;
    }
    levels.forEach(function (rings, idx) {
      if (!rings.length) return;
      var split = idx === 0 ? splitPockets(row, rings) : { line: rings, solid: [] };
      if (split.line.length) {
        traceRings(ctx, split.line);
        ctx.strokeStyle = state.ink; ctx.lineWidth = state.strokeWidth;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      }
      if (split.solid.length) {
        traceRings(ctx, split.solid);
        ctx.fillStyle = state.ink; ctx.fill();
      }
    });
  }

  function drawContour(ctx, result) {
    if (!result || !result.rows) return;
    result.rows.forEach(function (entry) { drawRowRings(ctx, entry); });
  }

  function paint(result) {
    var W = state.canvasW, H = state.canvasH, s = renderScale();
    sizeCanvases();
    var ctx = $('posterCanvas').getContext('2d');
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!state.bgTransparent) { ctx.fillStyle = state.bg; ctx.fillRect(0, 0, W, H); }

    drawContour(ctx, result);
    drawSmallBlocks(ctx);
    paintOverlay();
    $('stageMeta').textContent = W + ' × ' + H + ' px — ' +
      (state.fontSource === 'upload' ? (state.uploadedFontName || 'no font uploaded') : 'Liquid (built-in)');
  }

  // Rough, instant stand-in used while dragging: the raw silhouettes with no
  // blur/threshold/trace, so the composition stays interactive.
  function paintFast() {
    var W = state.canvasW, H = state.canvasH, s = renderScale();
    sizeCanvases();
    var ctx = $('posterCanvas').getContext('2d');
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!state.bgTransparent) { ctx.fillStyle = state.bg; ctx.fillRect(0, 0, W, H); }

    ctx.fillStyle = state.ink;
    ctx.globalAlpha = 0.45;
    buildRowLayouts().forEach(function (rl) {
      ctx.save();
      ctx.translate(rl.px, rl.py);
      if (rl.row.rot) ctx.rotate(rl.row.rot * Math.PI / 180);
      ctx.translate(-rl.cx, -rl.cy);
      rl.layout.draw(ctx);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    drawSmallBlocks(ctx);
    paintOverlay();
  }

  // Geometry of the selection widget, in poster units. Shared by the painter
  // and the hit-tester so what you see is exactly what you can grab.
  var HANDLE_R = 5, ROTATE_ARM = 26;
  function rowGizmo(rl) {
    var pad = 7 / state.zoom;
    var hw = rl.w / 2 + pad, hh = rl.h / 2 + pad;
    var rad = (rl.row.rot || 0) * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var toWorld = function (lx, ly) {
      return [rl.px + lx * cos - ly * sin, rl.py + lx * sin + ly * cos];
    };
    return {
      corners: [toWorld(-hw, -hh), toWorld(hw, -hh), toWorld(hw, hh), toWorld(-hw, hh)],
      rotate: toWorld(0, -hh - ROTATE_ARM / state.zoom),
      rotateAnchor: toWorld(0, -hh),
      center: [rl.px, rl.py],
    };
  }

  function paintOverlay() {
    var W = state.canvasW, H = state.canvasH, s = renderScale(), z = state.zoom;
    var ctx = $('overlayCanvas').getContext('2d');
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!state.selected) return;
    var lw = 1.5 / z;
    ctx.strokeStyle = '#ff5000';
    ctx.fillStyle = '#ff5000';
    ctx.lineWidth = lw;

    if (state.selected.type === 'row') {
      var rl = buildRowLayouts().filter(function (r) { return r.row.id === state.selected.id; })[0];
      if (!rl) return;
      var g = rowGizmo(rl);
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.beginPath();
      ctx.moveTo(g.corners[0][0], g.corners[0][1]);
      for (var i = 1; i < 4; i++) ctx.lineTo(g.corners[i][0], g.corners[i][1]);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // rotation arm
      ctx.beginPath();
      ctx.moveTo(g.rotateAnchor[0], g.rotateAnchor[1]);
      ctx.lineTo(g.rotate[0], g.rotate[1]);
      ctx.stroke();
      var hs = HANDLE_R / z;
      g.corners.forEach(function (p) {
        ctx.fillRect(p[0] - hs, p[1] - hs, hs * 2, hs * 2);
      });
      ctx.beginPath();
      ctx.arc(g.rotate[0], g.rotate[1], hs, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    var b = findBlock(state.selected.id);
    if (!b) return;
    var bbox = blockLayout(b).bbox, pad = 6 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeRect(bbox[0] - pad, bbox[1] - pad, bbox[2] - bbox[0] + pad * 2, bbox[3] - bbox[1] + pad * 2);
    ctx.setLineDash([]);
  }

  // -------------------------------------------------------------- scheduler
  var heavyTimer = null, dragging = false;
  function scheduleRender(heavy) {
    if (!heavy) { paint(cachedContour); return; }
    paintFast();
    clearTimeout(heavyTimer);
    heavyTimer = setTimeout(function () {
      if (dragging) return;
      $('stageLoading').classList.add('show');
      setTimeout(function () {
        try { cachedContour = computeContour(false); }
        catch (e) { console.error(e); cachedContour = null; }
        paint(cachedContour);
        $('stageLoading').classList.remove('show');
      }, 0);
    }, 130);
  }

  // ---------------------------------------------------------------- sidebar
  function sliderRow(label, min, max, step, value, fmt, onInput) {
    var wrap = mk('div', 'mini-slider');
    wrap.appendChild(mk('span', null, label));
    var inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    var val = mk('b', null, fmt(value));
    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value);
      val.textContent = fmt(v);
      onInput(v);
    });
    wrap.appendChild(inp); wrap.appendChild(val);
    wrap._input = inp; wrap._val = val; wrap._fmt = fmt;
    return wrap;
  }

  function segRow(options, current, onPick) {
    var row = mk('div', 'seg-row');
    options.forEach(function (o) {
      var btn = mk('div', 'pill-btn' + (current === o[0] ? ' active' : ''), o[1]);
      if (o[2]) btn.title = o[2];
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        row.querySelectorAll('.pill-btn').forEach(function (x) { x.classList.remove('active'); });
        btn.classList.add('active');
        onPick(o[0]);
      });
      row.appendChild(btn);
    });
    return row;
  }

  function cardHead(label, meta) {
    var head = mk('div', 'item-card-head');
    head.appendChild(mk('span', null, label));
    var m = mk('span', 'meta', meta || '');
    head.appendChild(m);
    head.appendChild(mk('div', 'spacer'));
    head._meta = m;
    return head;
  }

  function rowMetaText(row) {
    var bits = [Math.round(row.size) + 'px'];
    if (Math.round(row.rot)) bits.push(Math.round(row.rot) + '\u00b0');
    if (row.style === 'ink') bits.push('ink');
    if (row.effect !== 'solid') bits.push(row.effect);
    if (row.mode === 'filled') bits.push('filled');
    return bits.join(' \u00b7 ');
  }

  // Called during a canvas drag: refresh the header readout and the Turn
  // slider in place, rather than rebuilding the card (which would blow away
  // focus and the open state).
  function updateCardMeta() {
    if (!state.selected || state.selected.type !== 'row') return;
    var row = findRow(state.selected.id);
    if (!row) return;
    var cards = $('bigRowList').children;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c._id !== row.id) continue;
      if (c._meta) c._meta.textContent = rowMetaText(row);
      if (c._turn) {
        c._turn._input.value = row.rot;
        c._turn._val.textContent = c._turn._fmt(row.rot);
      }
      return;
    }
  }

  function renderBigRowCards() {
    var list = $('bigRowList');
    list.innerHTML = '';
    state.bigRows.forEach(function (row, idx) {
      var selected = state.selected && state.selected.type === 'row' && state.selected.id === row.id;
      var card = mk('div', 'item-card' + (selected ? ' selected' : ''));
      card._id = row.id;
      card.addEventListener('mousedown', function () { select('row', row.id); });

      var head = cardHead('Row ' + (idx + 1), rowMetaText(row));
      card._meta = head._meta;
      var up = mk('button', 'icon-btn', '\u2191'); up.title = 'Move up';
      up.disabled = idx === 0;
      up.addEventListener('click', function (e) {
        e.stopPropagation(); moveItem(state.bigRows, idx, -1);
        renderBigRowCards(); scheduleRender(true);
      });
      var del = mk('button', 'icon-btn danger', '\u00d7'); del.title = 'Delete row';
      del.disabled = state.bigRows.length <= 1;
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        state.bigRows.splice(idx, 1);
        if (state.selected && state.selected.id === row.id) state.selected = null;
        renderBigRowCards(); scheduleRender(true);
      });
      head.appendChild(up); head.appendChild(del);
      card.appendChild(head);

      var txt = document.createElement('input');
      txt.className = 'ptext compact'; txt.value = row.text; txt.spellcheck = false;
      txt.setAttribute('aria-label', 'Row ' + (idx + 1) + ' text');
      txt.addEventListener('input', function () { row.text = txt.value; scheduleRender(true); });
      card.appendChild(txt);

      var body = mk('div', 'item-card-body');
      body.appendChild(sliderRow('Track', -0.06, 0.5, 0.005, row.tracking,
        function (v) { return v.toFixed(3); },
        function (v) { row.tracking = v; scheduleRender(true); }));
      var turn = sliderRow('Turn', -180, 180, 1, row.rot,
        function (v) { return Math.round(v) + '\u00b0'; },
        function (v) { row.rot = v; updateCardMeta(); scheduleRender(true); });
      card._turn = turn;
      body.appendChild(turn);

      body.appendChild(segRow([
        ['melt', 'Melt', TITLE_STYLE_HINTS.melt],
        ['ink', 'Ink stroke', TITLE_STYLE_HINTS.ink],
      ], row.style, function (v) {
        row.style = v;
        renderBigRowCards();
        scheduleRender(true);
      }));

      if (row.style === 'ink') {
        body.appendChild(mk('p', 'phint', TITLE_STYLE_HINTS.ink));
        body.appendChild(sliderRow('Flow', 0, 46, 1, row.flow,
          function (v) { return Math.round(v) + 'px'; },
          function (v) { row.flow = v; scheduleRender(true); }));
        body.appendChild(sliderRow('Slant', -25, 25, 0.5, row.slant,
          function (v) { return v.toFixed(1) + '\u00b0'; },
          function (v) { row.slant = v; scheduleRender(true); }));
        body.appendChild(sliderRow('Pen', 0.15, 1.4, 0.01, row.weight,
          function (v) { return v.toFixed(2) + '\u00d7'; },
          function (v) { row.weight = v; scheduleRender(true); }));
        body.appendChild(sliderRow('Pocket', 0, 0.14, 0.002, row.pocket,
          function (v) { return (v * 100).toFixed(1) + '%'; },
          function (v) { row.pocket = v; scheduleRender(false); }));
      }

      body.appendChild(mk('div', 'field-label', 'Line effect'));
      body.appendChild(segRow([
        ['solid', 'Solid', EFFECT_HINTS.solid],
        ['rough', 'Rough', EFFECT_HINTS.rough],
        ['contour', 'Contour', EFFECT_HINTS.contour],
      ], row.effect, function (v) {
        row.effect = v; renderBigRowCards(); scheduleRender(true);
      }));
      body.appendChild(mk('p', 'phint', EFFECT_HINTS[row.effect]));

      if (row.effect === 'rough') {
        body.appendChild(sliderRow('Gap', 1, 20, 0.5, row.gap,
          function (v) { return v.toFixed(1) + 'px'; },
          function (v) { row.gap = v; scheduleRender(true); }));
        body.appendChild(sliderRow('Shake', 0, 10, 0.1, row.jitter,
          function (v) { return v.toFixed(1); },
          function (v) { row.jitter = v; scheduleRender(true); }));
      } else if (row.effect === 'contour') {
        body.appendChild(sliderRow('Lines', 2, 14, 1, row.lines,
          function (v) { return Math.round(v); },
          function (v) { row.lines = Math.round(v); scheduleRender(true); }));
        body.appendChild(sliderRow('Step', 3, 40, 0.5, row.spacing,
          function (v) { return v.toFixed(1) + 'px'; },
          function (v) { row.spacing = v; scheduleRender(true); }));
      }

      body.appendChild(segRow([
        ['outline', 'Outline'], ['filled', 'Filled'],
      ], row.mode, function (v) {
        row.mode = v; updateCardMeta(); scheduleRender(false);
      }));

      card.appendChild(body);
      list.appendChild(card);
    });
  }

  function renderSmallBlockCards() {
    var list = $('smallBlockList');
    list.innerHTML = '';
    state.smallBlocks.forEach(function (b, idx) {
      var selected = state.selected && state.selected.type === 'block' && state.selected.id === b.id;
      var card = mk('div', 'item-card' + (selected ? ' selected' : ''));
      card._id = b.id;
      card.addEventListener('mousedown', function () { select('block', b.id); });

      var firstLine = (b.text.split('\n')[0] || '').slice(0, 18);
      var head = cardHead('Text ' + (idx + 1), firstLine);
      var del = mk('button', 'icon-btn danger', '\u00d7'); del.title = 'Delete text block';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        state.smallBlocks.splice(idx, 1);
        if (state.selected && state.selected.id === b.id) state.selected = null;
        renderSmallBlockCards(); scheduleRender(false);
      });
      head.appendChild(del);
      card.appendChild(head);

      var ta = document.createElement('textarea');
      ta.className = 'ptextarea'; ta.value = b.text; ta.spellcheck = false;
      ta.setAttribute('aria-label', 'Text block ' + (idx + 1));
      ta.addEventListener('input', function () {
        b.text = ta.value;
        head._meta.textContent = (b.text.split('\n')[0] || '').slice(0, 18);
        scheduleRender(false);
      });
      card.appendChild(ta);

      var body = mk('div', 'item-card-body');

      var sel = document.createElement('select');
      sel.className = 'pselect compact';
      sel.setAttribute('aria-label', 'Font for text block ' + (idx + 1));
      MONO_FONTS.forEach(function (f) {
        var o = document.createElement('option');
        o.value = f[0]; o.textContent = f[1];
        if (f[0] === b.font) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        b.font = sel.value;
        loadFontThen(b, function () { scheduleRender(false); });
      });
      body.appendChild(sel);

      body.appendChild(segRow([['left', 'L'], ['center', 'C'], ['right', 'R']], b.align, function (v) {
        b.align = v; scheduleRender(false);
      }));

      body.appendChild(sliderRow('Size', 6, 72, 1, b.size,
        function (v) { return Math.round(v) + 'px'; },
        function (v) { b.size = v; scheduleRender(false); }));
      body.appendChild(sliderRow('Lead', 90, 220, 1, b.lh,
        function (v) { return Math.round(v) + '%'; },
        function (v) { b.lh = v; scheduleRender(false); }));

      // Small text carries its own colour so it can sit apart from the title ink.
      var colorRow = mk('div', 'prow prow-baseline');
      var pick = mk('label', 'swatch-pick');
      var ci = document.createElement('input');
      ci.type = 'color'; ci.value = b.color || state.ink;
      ci.addEventListener('input', function () { b.color = ci.value; scheduleRender(false); });
      pick.appendChild(ci); pick.appendChild(mk('span', null, 'Colour'));
      colorRow.appendChild(pick);
      colorRow.appendChild(mk('div', 'spacer'));
      var matchBtn = mk('button', 'mini-btn', 'Match ink');
      matchBtn.title = 'Reset to the title ink colour';
      matchBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        b.color = state.ink; ci.value = state.ink; scheduleRender(false);
      });
      colorRow.appendChild(matchBtn);
      body.appendChild(colorRow);

      card.appendChild(body);
      list.appendChild(card);
    });
  }

  function moveItem(arr, idx, dir) {
    var j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    var tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
  }

  function select(type, id) {
    if (state.selected && state.selected.type === type && state.selected.id === id) return;
    state.selected = { type: type, id: id };
    renderBigRowCards(); renderSmallBlockCards();
    paintOverlay();
  }

  // ---------------------------------------------------------------- palette
  function renderPalette() {
    var pairs = $('pairPalette'); pairs.innerHTML = '';
    PAIRS.forEach(function (p) {
      var btn = mk('button', 'pair-btn' + (p.ink === state.ink && p.bg === state.bg ? ' active' : ''));
      var chip = mk('div', 'pair-chip'); chip.style.background = p.bg;
      var s = mk('span', null, 'Aa'); s.style.color = p.ink;
      chip.appendChild(s);
      btn.appendChild(chip);
      btn.appendChild(mk('div', 'pair-name', p.name));
      btn.addEventListener('click', function () {
        state.ink = p.ink; state.bg = p.bg; state.bgTransparent = false;
        $('inkColor').value = p.ink; $('bgColor').value = p.bg;
        $('bgTransparent').checked = false;
        renderPalette(); scheduleRender(false);
      });
      pairs.appendChild(btn);
    });

    [['inkPalette', 'ink'], ['bgPalette', 'bg']].forEach(function (cfg) {
      var host = $(cfg[0]), key = cfg[1];
      host.innerHTML = '';
      RAMPS.forEach(function (ramp) {
        ramp.forEach(function (c) {
          var sw = mk('button', 'sw' + (state[key].toLowerCase() === c ? ' active' : ''));
          sw.style.background = c; sw.title = c;
          sw.addEventListener('click', function () {
            state[key] = c;
            $(key === 'ink' ? 'inkColor' : 'bgColor').value = c;
            if (key === 'bg') { state.bgTransparent = false; $('bgTransparent').checked = false; }
            renderPalette(); scheduleRender(false);
          });
          host.appendChild(sw);
        });
      });
    });
    $('valInk').textContent = state.ink.toUpperCase();
    $('valBg').textContent = state.bgTransparent ? 'NONE' : state.bg.toUpperCase();
  }

  // ------------------------------------------------------------------- zoom
  function setZoom(z, focal) {
    var scroll = $('stageScroll');
    var prev = state.zoom;
    state.zoom = Math.max(0.05, Math.min(2, z));
    $('zoomRange').value = Math.round(state.zoom * 100);
    $('valZoom').textContent = Math.round(state.zoom * 100) + '%';
    // keep the point under the cursor (or the viewport centre) put
    var rect = scroll.getBoundingClientRect();
    var fx = focal ? focal.x - rect.left : rect.width / 2;
    var fy = focal ? focal.y - rect.top : rect.height / 2;
    var ratio = state.zoom / prev;
    var nl = (scroll.scrollLeft + fx) * ratio - fx;
    var nt = (scroll.scrollTop + fy) * ratio - fy;
    paint(cachedContour);
    scroll.scrollLeft = nl; scroll.scrollTop = nt;
  }
  function zoomToFit() {
    var scroll = $('stageScroll');
    var pad = 60;
    // At boot the stage may not have been laid out yet; fitting against a
    // zero-size box would clamp the zoom to its 5% floor.
    if (scroll.clientWidth < 50 || scroll.clientHeight < 50) {
      requestAnimationFrame(zoomToFit);
      return;
    }
    var zx = (scroll.clientWidth - pad) / state.canvasW;
    var zy = (scroll.clientHeight - pad) / state.canvasH;
    setZoom(Math.min(zx, zy));
  }

  // --------------------------------------------------------- canvas pointer
  function canvasPoint(ev) {
    var rect = $('posterCanvas').getBoundingClientRect();
    return { x: (ev.clientX - rect.left) / state.zoom, y: (ev.clientY - rect.top) / state.zoom };
  }
  function inBox(p, b, slack) {
    slack = slack || 0;
    return p.x >= b[0] - slack && p.x <= b[2] + slack && p.y >= b[1] - slack && p.y <= b[3] + slack;
  }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  // Handles on the *selected* row win over everything, so a corner grip stays
  // grabbable even where it overlaps other artwork.
  function hitHandles(p) {
    if (!state.selected || state.selected.type !== 'row') return null;
    var rl = buildRowLayouts().filter(function (r) { return r.row.id === state.selected.id; })[0];
    if (!rl) return null;
    var g = rowGizmo(rl), grab = (HANDLE_R + 4) / state.zoom;
    if (dist(p.x, p.y, g.rotate[0], g.rotate[1]) <= grab) {
      return { mode: 'rotate', rl: rl, row: rl.row };
    }
    for (var i = 0; i < 4; i++) {
      if (dist(p.x, p.y, g.corners[i][0], g.corners[i][1]) <= grab) {
        return { mode: 'resize', rl: rl, row: rl.row };
      }
    }
    return null;
  }

  function hitTest(p) {
    var handle = hitHandles(p);
    if (handle) return handle;
    // small text sits on top, so it wins ties
    for (var i = state.smallBlocks.length - 1; i >= 0; i--) {
      var b = state.smallBlocks[i];
      if (inBox(p, blockLayout(b).bbox, 6)) return { mode: 'move', type: 'block', id: b.id, item: b };
    }
    var layouts = buildRowLayouts();
    for (var j = layouts.length - 1; j >= 0; j--) {
      if (pointInRow(p, layouts[j], 4)) {
        return { mode: 'move', type: 'row', id: layouts[j].row.id, item: layouts[j].row };
      }
    }
    return null;
  }

  function initCanvasInteraction() {
    var overlay = $('overlayCanvas'), scroll = $('stageScroll');
    var drag = null, pan = null;

    function setCursor(hit) {
      overlay.classList.toggle('movable', !!hit && hit.mode === 'move');
      overlay.classList.toggle('resizing', !!hit && hit.mode === 'resize');
      overlay.classList.toggle('rotating', !!hit && hit.mode === 'rotate');
    }

    overlay.addEventListener('mousemove', function (ev) {
      if (drag || pan) return;
      setCursor(hitTest(canvasPoint(ev)));
    });

    overlay.addEventListener('mousedown', function (ev) {
      var p = canvasPoint(ev);
      var hit = hitTest(p);
      if (!hit) {
        state.selected = null;
        renderBigRowCards(); renderSmallBlockCards(); paintOverlay();
        pan = { x: ev.clientX, y: ev.clientY, sl: scroll.scrollLeft, st: scroll.scrollTop };
        scroll.classList.add('panning');
        return;
      }
      ev.preventDefault();
      dragging = true;
      if (hit.mode === 'move') {
        select(hit.type, hit.id);
        drag = { mode: 'move', hit: hit, startX: p.x, startY: p.y, origXp: hit.item.xp, origYp: hit.item.yp };
        overlay.classList.add('grabbing');
      } else {
        var row = hit.row, rl = hit.rl;
        drag = {
          mode: hit.mode, hit: hit, row: row,
          cx: rl.px, cy: rl.py,
          origSize: row.size, origRot: row.rot || 0,
          startDist: Math.max(1e-3, dist(p.x, p.y, rl.px, rl.py)),
          startAngle: Math.atan2(p.y - rl.py, p.x - rl.px),
        };
      }
    });

    window.addEventListener('mousemove', function (ev) {
      if (drag) {
        var p = canvasPoint(ev);
        if (drag.mode === 'move') {
          drag.hit.item.xp = drag.origXp + (p.x - drag.startX) / state.canvasW * 100;
          drag.hit.item.yp = drag.origYp + (p.y - drag.startY) / state.canvasH * 100;
          if (drag.hit.type === 'row') paintFast(); else paint(cachedContour);
        } else if (drag.mode === 'resize') {
          var f = dist(p.x, p.y, drag.cx, drag.cy) / drag.startDist;
          drag.row.size = Math.max(20, Math.min(500, Math.round(drag.origSize * f)));
          paintFast();
        } else {
          var a = Math.atan2(p.y - drag.cy, p.x - drag.cx);
          var deg = drag.origRot + (a - drag.startAngle) * 180 / Math.PI;
          if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
          drag.row.rot = ((deg + 180) % 360 + 360) % 360 - 180;
          paintFast();
        }
        updateCardMeta();
      } else if (pan) {
        scroll.scrollLeft = pan.sl - (ev.clientX - pan.x);
        scroll.scrollTop = pan.st - (ev.clientY - pan.y);
      }
    });

    window.addEventListener('mouseup', function () {
      if (drag) {
        var heavy = drag.mode !== 'move' || drag.hit.type === 'row';
        drag = null; dragging = false;
        overlay.classList.remove('grabbing');
        if (heavy) scheduleRender(true);
      }
      if (pan) { pan = null; scroll.classList.remove('panning'); }
    });

    scroll.addEventListener('wheel', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      setZoom(state.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), { x: ev.clientX, y: ev.clientY });
    }, { passive: false });

    window.addEventListener('keydown', function (ev) {
      if (!state.selected) return;
      var tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      var item = state.selected.type === 'row' ? findRow(state.selected.id) : findBlock(state.selected.id);
      if (!item) return;
      var isRow = state.selected.type === 'row';
      var step = ev.shiftKey ? 1 : 0.15, moved = true;
      if (ev.key === 'ArrowLeft') item.xp -= step;
      else if (ev.key === 'ArrowRight') item.xp += step;
      else if (ev.key === 'ArrowUp') item.yp -= step;
      else if (ev.key === 'ArrowDown') item.yp += step;
      else if (isRow && (ev.key === '[' || ev.key === ']')) {
        item.rot = (item.rot || 0) + (ev.key === '[' ? -1 : 1) * (ev.shiftKey ? 15 : 1);
      } else moved = false;
      if (!moved) return;
      ev.preventDefault();
      if (isRow) updateCardMeta();
      scheduleRender(isRow);
    });
  }

  // --------------------------------------------------------------- binding
  function bindRange(id, valId, get, set, fmt, heavy) {
    var el = $(id), val = valId ? $(valId) : null;
    el.value = get();
    if (val) val.textContent = fmt(get());
    el.addEventListener('input', function () {
      var v = parseFloat(el.value);
      set(v);
      if (val) val.textContent = fmt(v);
      scheduleRender(heavy);
    });
  }
  function bindSegRow(rowId, get, set, heavy, onChange) {
    var row = $(rowId);
    var cells = row.querySelectorAll('.pill-btn');
    cells.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.value === get());
      btn.addEventListener('click', function () {
        cells.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        set(btn.dataset.value);
        if (onChange) onChange();
        scheduleRender(heavy);
      });
    });
  }

  function loadFontThen(block, cb) {
    if (document.fonts && document.fonts.load) {
      document.fonts.load(blockFontStr(block)).then(cb).catch(cb);
    } else cb();
  }

  function updateFontSourceUI() {
    var isUpload = state.fontSource === 'upload';
    $('fontDropzone').hidden = !isUpload;
    $('glyphControls').hidden = isUpload;
  }

  function applyCanvasSize(w, h) {
    state.canvasW = w; state.canvasH = h;
    layoutCache = {};
    scheduleRender(true);
  }

  function init() {
    // -- typeface
    bindSegRow('fontSourceRow', function () { return state.fontSource; },
      function (v) { state.fontSource = v; layoutCache = {}; }, true, updateFontSourceUI);
    updateFontSourceUI();

    var dropzone = $('fontDropzone'), fileInput = $('fontFileInput');
    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.style.borderColor = 'var(--accent)'; });
    dropzone.addEventListener('dragleave', function () { if (!state.uploadedFont) dropzone.style.borderColor = ''; });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault(); dropzone.style.borderColor = '';
      if (e.dataTransfer.files[0]) loadFontFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', function (e) { if (e.target.files[0]) loadFontFile(e.target.files[0]); });
    fileInput.addEventListener('click', function (e) { e.stopPropagation(); });

    function loadFontFile(file) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var font = opentype.parse(e.target.result);
          state.uploadedFont = font; state.uploadedFontName = file.name;
          layoutCache = {};
          $('fontDropLabel').textContent = 'Loaded: ' + file.name + ' — click to replace.';
          dropzone.classList.add('has-font');
          var fam = (font.names && font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) || file.name;
          toast('Font loaded: ' + fam);
          scheduleRender(true);
        } catch (err) {
          console.error(err); toast('Could not parse that font file', 3200);
        }
      };
      reader.onerror = function () { toast('Failed to read file', 3200); };
      reader.readAsArrayBuffer(file);
    }

    // -- built-in letterform shape
    var GLYPH_FIELDS = [
      ['glyphMass', 'valGlyphMass', 'mass', function (v) { return v.toFixed(2); }],
      ['glyphMelt', 'valGlyphMelt', 'melt', function (v) { return Math.round(v); }],
      ['glyphTension', 'valGlyphTension', 'tension', function (v) { return v.toFixed(1); }],
      ['glyphWobble', 'valGlyphWobble', 'wobble', function (v) { return v.toFixed(1); }],
    ];
    function syncGlyphSliders() {
      GLYPH_FIELDS.forEach(function (f) {
        $(f[0]).value = state.glyph[f[2]];
        $(f[1]).textContent = f[3](state.glyph[f[2]]);
      });
      $('glyphPreset').value = state.glyph.preset;
    }
    function glyphChanged() {
      // the letterforms themselves changed, so both caches are stale
      builtinCache = {}; layoutCache = {};
      scheduleRender(true);
    }
    $('glyphPreset').addEventListener('change', function (ev) {
      var name = ev.target.value;
      state.glyph.preset = name;
      var p = GLYPH_PRESETS[name];
      if (p) Object.keys(p).forEach(function (k) { state.glyph[k] = p[k]; });
      syncGlyphSliders();
      glyphChanged();
    });
    GLYPH_FIELDS.forEach(function (f) {
      $(f[0]).addEventListener('input', function (ev) {
        state.glyph[f[2]] = parseFloat(ev.target.value);
        $(f[1]).textContent = f[3](state.glyph[f[2]]);
        state.glyph.preset = 'custom';
        $('glyphPreset').value = 'custom';
        glyphChanged();
      });
    });
    syncGlyphSliders();

    // -- rows / blocks
    renderBigRowCards();
    renderSmallBlockCards();
    $('btnAddBigRow').addEventListener('click', function () {
      // inherit the last row's look so a new line joins the composition
      // instead of arriving with unrelated settings
      var last = state.bigRows[state.bigRows.length - 1] || {};
      var row = makeRow({
        text: 'SPLIT',
        tracking: last.tracking != null ? last.tracking : 0.02,
        rot: last.rot || 0,
        style: last.style || 'melt',
        flow: last.flow, slant: last.slant, weight: last.weight, pocket: last.pocket,
        xp: 50, yp: last.yp != null ? Math.min(112, last.yp + 16) : 50,
      });
      autoFitRowSize(row, 0.8);
      state.bigRows.push(row);
      state.selected = { type: 'row', id: row.id };
      renderBigRowCards(); scheduleRender(true);
    });
    $('btnAddSmallBlock').addEventListener('click', function () {
      var last = state.smallBlocks[state.smallBlocks.length - 1] || {};
      var b = makeBlock({
        font: last.font || "'JetBrains Mono'",
        size: last.size || 15, lh: last.lh || 145,
        color: last.color || state.ink,
      });
      state.smallBlocks.push(b);
      state.selected = { type: 'block', id: b.id };
      renderSmallBlockCards(); scheduleRender(false);
    });

    // -- merge & finish
    bindRange('melt', 'valMelt', function () { return state.melt; }, function (v) { state.melt = v; }, function (v) { return Math.round(v) + 'px'; }, true);
    bindRange('tension', 'valTension', function () { return state.tension; }, function (v) { state.tension = v; }, function (v) { return Math.round(v); }, true);
    bindRange('wobble', 'valWobble', function () { return state.wobble; }, function (v) { state.wobble = v; }, function (v) { return v.toFixed(1); }, true);
    bindRange('grain', 'valGrain', function () { return state.grain; }, function (v) { state.grain = v; }, function (v) { return v.toFixed(3); }, true);
    bindRange('smooth', 'valSmooth', function () { return state.smooth; }, function (v) { state.smooth = v; }, function (v) { return Math.round(v); }, true);
    bindRange('strokeWidth', 'valStroke', function () { return state.strokeWidth; }, function (v) { state.strokeWidth = v; }, function (v) { return v.toFixed(2) + 'px'; }, false);
    $('valSeed').textContent = '#' + state.seed;
    $('btnReseed').addEventListener('click', function () {
      state.seed = Math.floor(Math.random() * 9999);
      $('valSeed').textContent = '#' + state.seed;
      scheduleRender(true);
    });

    // -- canvas
    $('canvasPreset').value = state.canvasPreset;
    $('canvasPreset').addEventListener('change', function (ev) {
      var v = ev.target.value; state.canvasPreset = v;
      $('customSizeRow').hidden = v !== 'custom';
      if (v !== 'custom') {
        var s = SIZE_PRESETS[v];
        $('canvasW').value = s[0]; $('canvasH').value = s[1];
        applyCanvasSize(s[0], s[1]);
        zoomToFit();
      }
    });
    $('canvasW').value = state.canvasW; $('canvasH').value = state.canvasH;
    $('canvasW').addEventListener('input', function (ev) { applyCanvasSize(Math.max(100, parseInt(ev.target.value, 10) || 1000), state.canvasH); });
    $('canvasH').addEventListener('input', function (ev) { applyCanvasSize(state.canvasW, Math.max(100, parseInt(ev.target.value, 10) || 1000)); });

    // -- palette
    renderPalette();
    $('inkColor').value = state.ink; $('bgColor').value = state.bg;
    $('inkColor').addEventListener('input', function (ev) { state.ink = ev.target.value; renderPalette(); scheduleRender(false); });
    $('bgColor').addEventListener('input', function (ev) { state.bg = ev.target.value; state.bgTransparent = false; $('bgTransparent').checked = false; renderPalette(); scheduleRender(false); });
    $('bgTransparent').addEventListener('change', function (ev) { state.bgTransparent = ev.target.checked; renderPalette(); scheduleRender(false); });

    // -- zoom
    $('zoomRange').value = Math.round(state.zoom * 100);
    $('zoomRange').addEventListener('input', function (ev) { setZoom(parseFloat(ev.target.value) / 100); });
    $('btnZoomIn').addEventListener('click', function () { setZoom(state.zoom * 1.2); });
    $('btnZoomOut').addEventListener('click', function () { setZoom(state.zoom / 1.2); });
    $('btnZoomFit').addEventListener('click', zoomToFit);
    $('btnZoom100').addEventListener('click', function () { setZoom(1); });

    initCanvasInteraction();

    // -- export
    $('btnExportPng').addEventListener('click', exportPng);
    $('btnExportSvg').addEventListener('click', exportSvg);

    // -- boot
    state.bigRows.forEach(function (r) { autoFitRowSize(r, 0.8); });
    renderBigRowCards();
    cachedContour = computeContour(false);
    zoomToFit();
    paint(cachedContour);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { paint(cachedContour); });
    window.addEventListener('resize', function () { paint(cachedContour); });
  }

  // --------------------------------------------------------------- exports
  // Exports must not inherit the on-screen zoom or the selection chrome, so
  // they render through a detached canvas of their own.
  function renderToCanvas(result, scale) {
    var W = state.canvasW, H = state.canvasH;
    var c = document.createElement('canvas');
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    var ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (!state.bgTransparent) { ctx.fillStyle = state.bg; ctx.fillRect(0, 0, W, H); }
    drawContour(ctx, result);
    drawSmallBlocks(ctx);
    return c;
  }

  function exportPng() {
    var scale = parseFloat($('exportScale').value) || 2;
    $('stageLoading').classList.add('show');
    setTimeout(function () {
      try {
        var res = computeContour(true);
        renderToCanvas(res, scale).toBlob(function (blob) {
          dl(blob, safeName() + '.png');
          $('stageLoading').classList.remove('show');
          toast('PNG exported');
        });
      } catch (err) {
        console.error(err); toast('PNG export failed: ' + err.message, 3500);
        $('stageLoading').classList.remove('show');
      }
    }, 30);
  }

  function ringsToPathD(rings) {
    var d = '';
    rings.forEach(function (r) {
      d += 'M' + r[0][0].toFixed(2) + ',' + r[0][1].toFixed(2);
      for (var i = 1; i < r.length; i++) d += 'L' + r[i][0].toFixed(2) + ',' + r[i][1].toFixed(2);
      d += 'Z';
    });
    return d;
  }

  // Which characters each family actually has to render, so the export can ask
  // Google for exactly that subset.
  function usedGlyphsByFamily() {
    var map = {};
    state.smallBlocks.forEach(function (b) {
      var chars = map[b.font] || (map[b.font] = {});
      b.text.split('').forEach(function (ch) { if (ch !== '\n' && ch !== '\r') chars[ch] = 1; });
    });
    return map;
  }

  // Inline each family the poster uses as a base64 @font-face, so the exported
  // SVG renders identically on a machine that has never seen the font.
  //
  // The subset must be requested with `text=`: a plain css2 request returns one
  // @font-face per unicode-range (latin-ext first, then latin…), so grabbing
  // the first url() embeds a subset with no ASCII in it and the text silently
  // falls back to a generic mono wherever the font isn't already installed.
  function fetchFontFaceCSS(cb) {
    var used = usedGlyphsByFamily();
    var fams = Object.keys(used).filter(function (f) { return Object.keys(used[f]).length; });
    var out = [], pending = fams.length;
    if (!pending) return cb('');
    var timer = setTimeout(function () { pending = -1; cb(out.join('')); }, 8000);
    fams.forEach(function (fam) {
      var famName = fam.replace(/'/g, '').trim();
      var wt = fontWeight(fam);
      var text = Object.keys(used[fam]).sort().join('');
      var url = 'https://fonts.googleapis.com/css2?family=' +
        encodeURIComponent(famName).replace(/%20/g, '+') + ':wght@' + wt +
        '&text=' + encodeURIComponent(text);
      function done(css) {
        if (pending < 0) return;
        if (css) out.push(css);
        if (--pending === 0) { clearTimeout(timer); cb(out.join('')); }
      }
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('css ' + r.status);
        return r.text();
      }).then(function (css) {
        // The text= endpoint serves /l/font?kit=… with no file extension, so
        // match any https url inside url(), not just *.woff2.
        var m = css.match(/url\((https:\/\/[^)'"]+)\)/);
        if (!m) throw new Error('no font url');
        return fetch(m[1]).then(function (r2) {
          if (!r2.ok) throw new Error('font ' + r2.status);
          return r2.blob();
        });
      }).then(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
          done('@font-face{font-family:"' + famName + '";src:url(' + reader.result +
            ') format("woff2");font-weight:' + wt + ';}');
        };
        reader.onerror = function () { done(''); };
        reader.readAsDataURL(blob);
      }).catch(function (err) { console.warn('font embed failed for', famName, err); done(''); });
    });
  }

  function exportSvg() {
    $('stageLoading').classList.add('show');
    setTimeout(function () {
      var res;
      try { res = computeContour(true); }
      catch (err) {
        console.error(err); toast('SVG export failed: ' + err.message, 3500);
        $('stageLoading').classList.remove('show'); return;
      }

      var W = state.canvasW, H = state.canvasH;
      var bgRect = state.bgTransparent ? '' : '<rect width="100%" height="100%" fill="' + state.bg + '"/>';
      // One path group per row, mirroring how drawRowRings paints it.
      var strokeAttrs = 'fill="none" stroke="' + state.ink + '" stroke-width="' +
        state.strokeWidth + '" stroke-linejoin="round" stroke-linecap="round"';
      var pathEl = (res.rows || []).map(function (entry) {
        var row = entry.row, out = '';
        if (row.mode === 'filled') {
          var all = [];
          entry.levels.forEach(function (rings) { all = all.concat(rings); });
          return all.length
            ? '<path d="' + ringsToPathD(all) + '" fill="' + state.ink + '" fill-rule="evenodd" stroke="none"/>'
            : '';
        }
        entry.levels.forEach(function (rings, idx) {
          if (!rings.length) return;
          var split = idx === 0 ? splitPockets(row, rings) : { line: rings, solid: [] };
          if (split.line.length) out += '<path d="' + ringsToPathD(split.line) + '" ' + strokeAttrs + '/>';
          if (split.solid.length) {
            out += '<path d="' + ringsToPathD(split.solid) + '" fill="' + state.ink + '" fill-rule="nonzero" stroke="none"/>';
          }
        });
        return out;
      }).join('');

      var anchorOf = { left: 'start', center: 'middle', right: 'end' };
      var textEls = state.smallBlocks.map(function (b) {
        var t = blockLayout(b);
        var fam = b.font.replace(/"/g, "'");
        return t.lines.map(function (line, i) {
          return '<text x="' + t.x.toFixed(1) + '" y="' + (t.y + t.lh * i).toFixed(1) +
            '" text-anchor="' + (anchorOf[b.align] || 'start') +
            '" font-family="' + fam + ', monospace" font-size="' + b.size +
            '" font-weight="' + fontWeight(b.font) + '" fill="' + (b.color || state.ink) + '">' + escapeXml(line) + '</text>';
        }).join('');
      }).join('');

      fetchFontFaceCSS(function (faceCss) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
          (faceCss ? '<style>' + faceCss + '</style>' : '') + bgRect + pathEl + textEls + '</svg>';
        dl(new Blob([svg], { type: 'image/svg+xml' }), safeName() + '.svg');
        $('stageLoading').classList.remove('show');
        toast('SVG exported' + (faceCss ? '' : ' (small text font referenced by name only)'));
      });
    }, 30);
  }

  init();
})();
