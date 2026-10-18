(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var GH = GLYPH_DATA.H, GW = GLYPH_DATA.W, BASE = GLYPH_DATA.glyphs;
  var GC = GlyphCompose, isMark = GC.isMark;
  var STORE_KEY = 'liquidfont.project.v1';

  var PRESETS = BlobEngine.PRESETS || {
    liquid:  { mass: 1.00, melt: 15, tension: -4, wobble: 0,   grain: 0.045, smooth: 2, res: 1.6 },
    mercury: { mass: 1.05, melt: 24, tension: -2, wobble: 0,   grain: 0.045, smooth: 3, res: 1.6 },
    acid:    { mass: 1.08, melt: 26, tension: -2, wobble: 2.2, grain: 0.050, smooth: 3, res: 1.5 },
    molten:  { mass: 1.16, melt: 30, tension:  2, wobble: 1.2, grain: 0.040, smooth: 3, res: 1.6 },
    bubble:  { mass: 0.94, melt:  7, tension: -7, wobble: 0,   grain: 0.045, smooth: 2, res: 1.6 },
    goo:     { mass: 1.10, melt: 20, tension:  0, wobble: 3.6, grain: 0.070, smooth: 3, res: 1.5 },
  };
  var SHAPE_KEYS = ['mass', 'melt', 'tension', 'wobble', 'grain', 'smooth', 'res'];

  var PALETTE = ['#ffffff', '#ff5000', '#000000', '#8a8a8a'];

  // Vertical metrics, as fractions of the em. Caps fill 70% of it; above them
  // is room for Vietnamese stacked marks (Ẩ Ẫ Ặ climb ~0.4em over the caps),
  // below for the dot below and the comma tail. Sizes everywhere — preview
  // px, OTF units — are em sizes, exactly like any installed font. The
  // ascender and descender are re-measured from the ink (measureStacks).
  var CAP_EM = 0.70, WORD_EM = 0.24;
  var ASC_EM = 1.02, DESC_EM = 0.25;

  var LETTERS = Object.keys(BASE).filter(function (k) { return !isMark(k); });
  var MARK_KEYS = GC.MARK_ORDER.filter(function (k) { return BASE[k]; });
  var VIET = GC.vietnameseUpper();
  var ALNUM = /^[A-Z0-9]$/;
  var SETS = [
    ['Uppercase', Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ')],
    ['Numerals', Array.from('0123456789')],
    ['Punctuation', LETTERS.filter(function (k) { return !ALNUM.test(k); })],
    ['Vietnamese', VIET],
    ['Marks', MARK_KEYS],
  ];
  var ORDER = [];
  SETS.forEach(function (s) { ORDER = ORDER.concat(s[1]); });

  // ------------------------------------------------------------ glyph model
  // Every key in BASE — letters and diacritic marks alike — is a flat node
  // list plus chain lengths. Edits are overrides on top of that.
  function flatten(chains) {
    var nodes = [], lens = [];
    chains.forEach(function (c) { lens.push(c.length); c.forEach(function (n) { nodes.push(n.slice()); }); });
    return { nodes: nodes, lens: lens };
  }
  var FLAT = {}, MIRROR = {};
  Object.keys(BASE).forEach(function (L) { FLAT[L] = flatten(BASE[L]); });
  function computeMirrorMap(L) {
    var ns = FLAT[L].nodes, ax = isMark(L) ? 0 : GW; // marks are drawn around their own origin
    return ns.map(function (p, i) {
      var best = i, bd = Infinity;
      ns.forEach(function (q, j) {
        if (j === i) return;
        var d = Math.abs(q[1] - p[1]) + Math.abs(q[0] - (ax - p[0]));
        if (d < bd) { bd = d; best = j; }
      });
      return bd < 7 ? best : i;
    });
  }
  Object.keys(BASE).forEach(function (L) { MIRROR[L] = computeMirrorMap(L); });

  var globalOv = {}, letterOv = {}, undoStack = [], redoStack = [];
  // letters whose node structure was changed (add/delete node) bake the
  // global offsets in and leave global editing: global offsets are keyed by
  // node number, which no longer lines up once a letter has been restructured
  var globalExempt = {};
  var letterVer = {}; Object.keys(BASE).forEach(function (L) { letterVer[L] = 0; });
  var globalVer = 0;

  // Global edits shift node #i of every letter; marks have their own
  // numbering, so they never take part.
  function effNodes(L) {
    return FLAT[L].nodes.map(function (n, i) {
      var dx = 0, dy = 0, dr = 0;
      var g = !isMark(L) && !globalExempt[L] && globalOv[i]; if (g) { dx += g[0]; dy += g[1]; dr += g[2]; }
      var l = letterOv[L] && letterOv[L][i]; if (l) { dx += l[0]; dy += l[1]; dr += l[2]; }
      var out = [n[0] + dx, n[1] + dy, Math.max(2, n[2] + dr)];
      if (n.length > 3) out.push(n[3]);
      return out;
    });
  }
  function chainsOf(L) {
    var f = effNodes(L), lens = FLAT[L].lens, out = [], k = 0;
    for (var i = 0; i < lens.length; i++) { out.push(f.slice(k, k + lens[i])); k += lens[i]; }
    return out;
  }
  function setOverride(L, i, d) {
    if (state.globalEdit && !isMark(L) && !globalExempt[L]) { globalOv[i] = d; globalVer++; }
    else { if (!letterOv[L]) letterOv[L] = {}; letterOv[L][i] = d; letterVer[L]++; }
  }
  function bumpAll() { globalVer++; Object.keys(letterVer).forEach(function (k) { letterVer[k]++; }); }

  // ------------------------------------------------------------------ cache
  var cache = {}, cacheN = 0;
  function remember(k, v) {
    if (++cacheN > 2400) { cache = {}; cacheN = 0; }
    cache[k] = v;
    return v;
  }
  function shapeKey() {
    var s = state, L = GC.LAYOUT;
    return [s.mass, s.melt, s.tension, s.wobble, s.grain, s.smooth, s.res, s.seed, s.draft ? 'd' : '',
      L.scale, L.gapTop, L.gapStack, L.gapBottom].join('|');
  }
  function verOf(L) { return (isMark(L) ? 0 : globalVer) + '.' + letterVer[L]; }
  function hasKey(k) { return !!FLAT[k]; }

  function traceChains(chains, key, tag) {
    var k = 't|' + key + '|' + tag;
    if (cache[k]) return cache[k];
    var r;
    try {
      r = BlobEngine.glyphRings(GC.markChains(key, chains), GC.traceOpts(key, {
        mass: state.mass, melt: state.melt, tension: state.tension, wobble: state.wobble,
        grain: state.grain, smooth: state.smooth, simplify: 0.3,
        // while a slider is being dragged, trace coarser and refine on release
        res: state.draft ? state.res * 1.7 : state.res,
        seed: state.seed + key.charCodeAt(0) * 13,
      }));
    } catch (e) { console.error('glyph failed', key, e); r = []; }
    return remember(k, r);
  }
  function compositeOf(L) {
    var p = GC.plan(L, hasKey);
    if (!p || p.simple) return null;
    var tag = shapeKey() + '@' + [p.base].concat(p.fused, p.top, p.bottom).map(verOf).join(',');
    var k = 'c|' + L + '|' + tag;
    if (cache[k]) return cache[k];
    return remember(k, GC.compose(L, {
      rings: ringsOf, chains: chainsOf, lines: function () { return { cap: MET.cap, foot: MET.base }; },
      trace: function (ch, key) { return traceChains(ch, key, tag); },
    }, hasKey));
  }
  function ringsOf(L) {
    if (FLAT[L]) return traceChains(chainsOf(L), L, shapeKey() + '@' + verOf(L));
    var c = compositeOf(L);
    return c ? c.rings : [];
  }
  function canDraw(L) { return (FLAT[L] && !isMark(L)) || !!GC.plan(L, hasKey); }
  // path strings are cached per traced ring set (rings are immutable once
  // traced), so a spacing-only change rebuilds no geometry text at all
  var dCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function ringsToD(rings) {
    var hit = dCache && dCache.get(rings);
    if (hit !== undefined) return hit;
    var d = ringsToDRaw(rings);
    if (dCache) dCache.set(rings, d);
    return d;
  }
  // smooth cubics through the traced points (BlobEngine.ringToCubics)
  function f2d(p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }
  function ringsToDRaw(rings) {
    var d = '';
    for (var i = 0; i < rings.length; i++) {
      var segs = BlobEngine.ringToCubics(rings[i]);
      d += 'M' + f2d(segs[0][0]);
      for (var j = 0; j < segs.length; j++) d += 'C' + f2d(segs[j][1]) + ' ' + f2d(segs[j][2]) + ' ' + f2d(segs[j][3]);
      d += 'Z';
    }
    return d;
  }
  function gid(L) { return 'g' + Array.from(L).map(function (c) { return c.codePointAt(0).toString(16); }).join('_'); }

  // ---------------------------------------------------------------- metrics
  // Baseline and cap height are measured from the rendered ink, not taken
  // from the skeleton frame: a heavier Mass or a looser Tension moves the
  // ink edge, and the font has to sit on that edge.
  var MET = { base: 110, cap: -9, capH: 119, em: 170 };
  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }
  function measureMetrics() {
    var bot = [], top = [];
    Array.from('HIELNMKTFZ').forEach(function (L) { var b = FLAT[L] && GC.bbox(ringsOf(L)); if (b) bot.push(b[3]); });
    Array.from('HIETFZBDPRKL').forEach(function (L) { var b = FLAT[L] && GC.bbox(ringsOf(L)); if (b) top.push(b[1]); });
    MET.base = bot.length ? median(bot) : GH;
    MET.cap = top.length ? median(top) : 0;
    MET.capH = Math.max(20, MET.base - MET.cap);
    MET.em = MET.capH / CAP_EM;
  }

  // Ascender = the tallest stacked Vietnamese capital, descender = the lowest
  // ink (dot below, comma, brackets), each plus a hair, never under the
  // defaults — so nothing pokes out of the line box or the OTF's metrics.
  function measureStacks() {
    var top = MET.cap, bot = MET.base;
    function take(rings) {
      var b = GC.bbox(rings);
      if (!b) return;
      if (b[1] < top) top = b[1];
      if (b[3] > bot) bot = b[3];
    }
    LETTERS.forEach(function (L) { take(ringsOf(L)); });
    VIET.forEach(function (V) { var c = compositeOf(V); if (c) take(c.rings); });
    ASC_EM = Math.max(1.02, (MET.base - top) / MET.em + 0.02);
    DESC_EM = Math.max(0.22, (bot - MET.base) / MET.em + 0.02);
  }

  // ----------------------------------------------------------------- spacing
  // Each glyph is scanned into horizontal profiles: its leftmost and
  // rightmost ink on a stack of rows reaching from the top of the accent zone
  // to below the baseline. Sidebearings come from how much white the shape
  // already holds inside its own bounds (a round O carries some, a flat H
  // none, an A or T a lot); kerning from how two neighbours' profiles nest.
  var ROWS = 72, SPC = {}, KERN = {};
  function rowFrame() {
    var y0 = MET.cap - 0.48 * MET.capH, y1 = MET.base + 0.3 * MET.capH;
    return { y0: y0, st: (y1 - y0) / ROWS, c0: MET.cap, c1: MET.base };
  }
  function profileOf(rings, fr) {
    var lo = [], hi = [];
    for (var i = 0; i < ROWS; i++) { lo.push(Infinity); hi.push(-Infinity); }
    rings.forEach(function (r) {
      for (var j = 0; j < r.length; j++) {
        var p = r[j], q = r[(j + 1) % r.length];
        if (p[1] === q[1]) continue;
        var ya = Math.min(p[1], q[1]), yb = Math.max(p[1], q[1]);
        var i0 = Math.max(0, Math.ceil((ya - fr.y0) / fr.st - 0.5));
        var i1 = Math.min(ROWS - 1, Math.floor((yb - fr.y0) / fr.st - 0.5));
        for (var k = i0; k <= i1; k++) {
          var y = fr.y0 + (k + 0.5) * fr.st;
          var x = p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]);
          if (x < lo[k]) lo[k] = x;
          if (x > hi[k]) hi[k] = x;
        }
      }
    });
    return { lo: lo, hi: hi };
  }
  function spacingOf(L) {
    if (SPC[L]) return SPC[L];
    var rings = ringsOf(L), fr = rowFrame();
    var bb = GC.bbox(rings) || [0, MET.cap, MET.capH * 0.3, MET.base];
    var pr = profileOf(rings, fr);
    // average white depth per side over the cap band, capped so one deep
    // notch (the inside of a T's arm) can't dominate
    var dmax = 0.30 * MET.capH, dl = 0, dr = 0, n = 0;
    for (var i = 0; i < ROWS; i++) {
      var y = fr.y0 + (i + 0.5) * fr.st;
      if (y < fr.c0 || y > fr.c1 || !isFinite(pr.lo[i])) continue;
      dl += Math.min(pr.lo[i] - bb[0], dmax); dr += Math.min(bb[2] - pr.hi[i], dmax); n++;
    }
    dl = n ? dl / n / dmax : 0; dr = n ? dr / n / dmax : 0;
    var sp = state.spacing * MET.capH / 100, k = 1;
    var lsb = sp * (1 - k * dl), rsb = sp * (1 - k * dr);
    var adj = state.metrics[L];
    if (adj) { lsb += adj[0]; rsb += adj[1]; }
    return (SPC[L] = { x0: bb[0], x1: bb[2], lsb: lsb, rsb: rsb, adv: lsb + bb[2] - bb[0] + rsb, lo: pr.lo, hi: pr.hi });
  }
  // Kerning is only about how two shapes meet; how much white one side
  // carries on its own is the sidebearings' job (white area adds up row by
  // row, so an area kern would just be a sidebearing smeared over every
  // pair). Two interaction terms, scaled by the Kerning slider:
  //   nesting  how much farther apart the nearest inks are than the two
  //            sidebearings alone would put them (A|V, L|T, P|.)
  //   overlap  white both shapes leave open in the same rows — the hole
  //            under T's arm meeting the fork of Y, the two bellies of O|O
  // A floor then keeps the nearest ink, accents included, at least 0.4× the
  // H|H gap apart, which can also loosen a pair that crowds.
  var KBASE = null, KOVER = 0;
  function kernOf(a, b) {
    if (!a || !b) return 0;
    var key = a + '\u0000' + b;
    if (state.kernOv[key] != null) return state.kernOv[key];   // a designer's own value wins
    if (!(state.kern > 0)) return 0;
    if (key in KERN) return KERN[key];
    if (KBASE == null) {
      var h = spacingOf('H');
      KBASE = Math.max(1, h.lsb + h.rsb);
      KOVER = interaction(h, h).over;   // H|H is the zero point: only extra shared white counts
    }
    var it = interaction(spacingOf(a), spacingOf(b)), v = 0;
    if (isFinite(it.minG)) {
      v = -(it.nest + 0.5 * Math.max(0, it.over - KOVER)) * state.kern;
      v = Math.max(v, 0.4 * KBASE - it.minG);                       // ink floor
      v = Math.min(0.25 * KBASE, Math.max(-0.45 * MET.capH, v));    // sane range
    }
    if (Math.abs(v) < 0.6) v = 0;
    return (KERN[key] = v);
  }
  function interaction(A, B) {
    var fr = rowFrame(), cap = 0.3 * MET.capH;
    var minG = Infinity, over = 0, n = 0;
    for (var i = 0; i < ROWS; i++) {
      var ha = isFinite(A.hi[i]), hb = isFinite(B.lo[i]);
      if (ha && hb) {
        var g = (A.x1 - A.hi[i]) + A.rsb + B.lsb + (B.lo[i] - B.x0);
        if (g < minG) minG = g;
      }
      var y = fr.y0 + (i + 0.5) * fr.st;
      if (y < fr.c0 || y > fr.c1) continue;
      var da = ha ? Math.min(A.x1 - A.hi[i], cap) : cap, db = hb ? Math.min(B.lo[i] - B.x0, cap) : cap;
      over += Math.min(da, db); n++;
    }
    return { minG: minG, nest: Math.max(0, minG - (A.rsb + B.lsb)), over: n ? over / n : 0 };
  }

  // ------------------------------------------------------------------ state
  var uid = 0;
  function block(text, size, lh, tr, paper) {
    return { id: ++uid, text: text, size: size, lh: lh, tr: tr, paper: !!paper, editing: false };
  }
  function defaultBlocks() {
    return [
      block('LIQUID TYPE 2026', 200, 100, 0.01),
      block('TIẾNG VIỆT: CHỮ LỎNG NHƯ NƯỚC, MỀM NHƯ MÂY', 120, 145, 0.01),
      block('THE RIGHT MAN IN THE WRONG PLACE CAN MAKE ALL THE DIFFERENCE IN THE WORLD', 88, 112, 0.01),
      block('OOZE?!', 340, 100, 0.01, true),
      block('IN A CULTURE LIKE OURS, LONG ACCUSTOMED TO SPLITTING AND DIVIDING ALL THINGS AS A MEANS OF CONTROL, IT IS SOMETIMES A BIT OF A SHOCK TO BE REMINDED THAT, IN OPERATIONAL AND PRACTICAL FACT, THE MEDIUM IS THE MESSAGE.', 38, 128, 0.02),
    ];
  }
  var state = Object.assign({
    seed: 5, preset: 'liquid', presetEdited: false,
    fontName: 'Ooze', ink: PALETTE[0],
    selected: 'A', activeNode: -1, globalEdit: false, mirror: false,
    spacing: 7, kern: 0.7, metrics: {}, kernOv: {},
    draft: false,
    blocks: defaultBlocks(),
  }, PRESETS.liquid);

  var $ = function (id) { return document.getElementById(id); };
  var defsInner = $('glyphDefsInner');
  var testerList = $('testerList'), glyphSetEl = $('glyphSet');
  var edSvg = $('editorSvg'), readout = $('editorReadout'), badge = $('letterBadge');
  var nodeXEl = $('nodeX'), nodeYEl = $('nodeY'), nodeREl = $('nodeR');
  var addNodeBtn = $('btnAddNode'), delNodeBtn = $('btnDelNode');
  var toastEl = $('toast'), toastT = null;
  function toast(m, ms) {
    toastEl.textContent = m; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
  }

  // ----------------------------------------------------- shared glyph defs
  // One <path> per glyph, referenced by every preview instance via <use>.
  // A long paragraph would otherwise mean hundreds of copies of the same
  // few-hundred-point outline. Composites met in preview text are added on
  // demand.
  var extraKeys = {};
  // a lone mark is shown where it would sit on a host letter
  function markHost(m) { return m === '̵' ? 'D' : 'O'; }
  function markPlacement(m) {
    var c = compositeOf(markHost(m) + m), part = null;
    if (c) c.parts.forEach(function (p) { if (p.key === m) part = p; });
    return part || { ox: 0, oy: 0 };
  }
  function displayRings(L) {
    if (!isMark(L)) return ringsOf(L);
    var p = markPlacement(L);
    return GC.shift(ringsOf(L), p.ox, p.oy);
  }
  // A composite's def reuses its base outline through <use> and only adds
  // its marks, so 67 Vietnamese letters cost 67 small mark paths rather than
  // 67 copies of A E I O U Y. Fused bases (Ơ Ư Đ) get one def each.
  //
  // Defs are diffed against what is already in the document, so dragging one
  // node rewrites that letter and the composites built on it, not all 140.
  var fusedDefs = {}, lastDefs = {};
  var markD = typeof WeakMap === 'function' ? new WeakMap() : null;
  function defEntries(L, out) {
    var c = !FLAT[L] && compositeOf(L);
    if (!c) { out.push([gid(L), '<path id="' + gid(L) + '" d="' + ringsToD(displayRings(L)) + '" fill-rule="nonzero"/>']); return; }
    if (c.baseKey !== c.parts[0].key && !fusedDefs[c.baseKey]) {
      fusedDefs[c.baseKey] = 1;
      out.push([gid(c.baseKey), '<path id="' + gid(c.baseKey) + '" d="' + ringsToD(c.baseRings) + '" fill-rule="nonzero"/>']);
    }
    var m = markD && markD.get(c);
    if (m === undefined) { m = ringsToDRaw(c.rings.slice(c.baseCount)); if (markD) markD.set(c, m); }
    out.push([gid(L), '<g id="' + gid(L) + '"><use href="#' + gid(c.baseKey) + '"/><path d="' + m + '" fill-rule="nonzero"/></g>']);
  }
  function refreshDefs() {
    SPC = {}; KERN = {}; KBASE = null; fusedDefs = {};
    measureMetrics();
    measureStacks();
    var list = [];
    MARK_KEYS.concat(LETTERS, VIET, Object.keys(extraKeys)).forEach(function (L) { defEntries(L, list); });
    var changed = list.filter(function (e) { return lastDefs[e[0]] !== e[1]; });
    if (changed.length > list.length / 3 || !defsInner.firstChild) {
      defsInner.innerHTML = list.map(function (e) { return e[1]; }).join('');
    } else {
      changed.forEach(function (e) {
        var el = document.getElementById(e[0]);
        if (el) { el.insertAdjacentHTML('afterend', e[1]); el.parentNode.removeChild(el); }
        else defsInner.insertAdjacentHTML('beforeend', e[1]);
      });
    }
    lastDefs = {};
    list.forEach(function (e) { lastDefs[e[0]] = e[1]; });
  }
  function ensureDef(L) {
    if (extraKeys[L] || LETTERS.indexOf(L) >= 0 || VIET.indexOf(L) >= 0) return;
    extraKeys[L] = 1;
    var list = [];
    defEntries(L, list);
    list.forEach(function (e) { lastDefs[e[0]] = e[1]; defsInner.insertAdjacentHTML('beforeend', e[1]); });
  }

  // mode 'text': the svg's margin box collapses onto the baseline, so the
  // line box comes from CSS line-height alone and glyphs overhang into the
  // leading exactly as a real font's do. mode 'cell': a full ascender-to-
  // descender frame, for grids where every cell must line up.
  // the advance box of a glyph (a mark: its host's box, widened to fit it)
  function setFrame(svg, L, sizePx) {
    var em = MET.em, k = sizePx / em, host = isMark(L) ? markHost(L) : null;
    var s = spacingOf(host || L), vx = s.x0 - s.lsb, vw = s.adv;
    if (host) {
      var hb = GC.bbox(displayRings(L));
      if (hb) { var x0 = Math.min(vx, hb[0] - 4), x1 = Math.max(vx + vw, hb[2] + 4); vx = x0; vw = x1 - x0; }
    }
    var y0 = MET.base - ASC_EM * em, h = (ASC_EM + DESC_EM) * em;
    svg.setAttribute('viewBox', vx.toFixed(2) + ' ' + y0.toFixed(2) + ' ' + vw.toFixed(2) + ' ' + h.toFixed(2));
    svg.setAttribute('width', (vw * k).toFixed(2));
    svg.setAttribute('height', (h * k).toFixed(2));
  }
  function glyphSvg(L, sizePx, mode) {
    var svg = document.createElementNS(NS, 'svg');
    if (isMark(L)) {   // a mark is shown on a faint copy of its host letter
      var gh = document.createElementNS(NS, 'use');
      gh.setAttribute('href', '#' + gid(markHost(L)));
      gh.setAttribute('fill', 'currentColor');
      gh.setAttribute('opacity', '0.16');
      svg.appendChild(gh);
    }
    setFrame(svg, L, sizePx);
    if (mode === 'text') {
      svg.style.marginTop = (-ASC_EM * sizePx).toFixed(2) + 'px';
      svg.style.marginBottom = (-DESC_EM * sizePx).toFixed(2) + 'px';
    }
    svg.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#' + gid(L));
    u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + gid(L));
    u.setAttribute('fill', 'currentColor');
    svg.appendChild(u);
    return svg;
  }
  // visible stand-in for a character the font can't draw yet
  function notdefSvg(sizePx) {
    var svg = document.createElementNS(NS, 'svg'), w = 0.42 * sizePx, h = CAP_EM * sizePx;
    svg.setAttribute('viewBox', '0 0 42 70');
    svg.setAttribute('width', w.toFixed(1)); svg.setAttribute('height', h.toFixed(1));
    svg.setAttribute('class', 'notdef');
    var r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', 4); r.setAttribute('y', 2); r.setAttribute('width', 34); r.setAttribute('height', 66);
    r.setAttribute('rx', 4); r.setAttribute('fill', 'none');
    r.setAttribute('stroke-width', 3); r.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(r);
    return svg;
  }

  // --------------------------------------------------------- tester blocks
  function renderTesters() {
    testerList.innerHTML = '';
    state.blocks.forEach(function (b) { testerList.appendChild(buildTester(b)); });
    if (!state.blocks.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No preview blocks. Add one below to type with your font.';
      testerList.appendChild(empty);
    }
  }

  function ctrl(label, min, max, step, val, fmt, onInput) {
    var wrap = document.createElement('label');
    wrap.className = 'tester-ctrl';
    var t = document.createElement('span');
    t.className = 'tester-ctrl-name';
    t.textContent = label;
    var b = document.createElement('b');
    b.textContent = fmt(val);
    var r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
    r.setAttribute('aria-label', label);
    var armed = false;
    r.addEventListener('input', function () {
      if (!armed) { pushUndo(); armed = true; }
      var v = parseFloat(r.value);
      b.textContent = fmt(v);
      onInput(v);
    });
    r.addEventListener('change', function () { armed = false; markDirty(); });
    wrap.appendChild(t); wrap.appendChild(b); wrap.appendChild(r);
    return wrap;
  }

  function buildTester(b) {
    var root = document.createElement('div');
    root.className = 'tester' + (b.paper ? ' paper' : '');

    var head = document.createElement('div');
    head.className = 'tester-head';

    var name = document.createElement('div');
    name.className = 'tester-name';
    name.textContent = state.fontName;
    name.dataset.role = 'name';
    head.appendChild(name);

    head.appendChild(ctrl('Size', 10, 480, 1, b.size, function (v) { return Math.round(v) + 'px'; },
      function (v) { b.size = v; paintText(root, b); }));
    head.appendChild(ctrl('Leading', 70, 220, 1, b.lh, function (v) { return Math.round(v) + '%'; },
      function (v) { b.lh = v; paintText(root, b); }));
    head.appendChild(ctrl('Tracking', -0.06, 0.4, 0.005, b.tr, function (v) { return v.toFixed(3) + 'em'; },
      function (v) { b.tr = v; paintText(root, b); }));

    var sp = document.createElement('div'); sp.className = 'tester-spacer';
    head.appendChild(sp);

    var inv = document.createElement('button');
    inv.type = 'button';
    inv.className = 'mini-btn' + (b.paper ? ' on' : '');
    inv.textContent = b.paper ? 'Paper' : 'Ink';
    inv.setAttribute('aria-pressed', String(b.paper));
    inv.title = 'Switch between ink on black and black on paper';
    inv.addEventListener('click', function () {
      pushUndo();
      b.paper = !b.paper;
      root.classList.toggle('paper', b.paper);
      inv.classList.toggle('on', b.paper);
      inv.textContent = b.paper ? 'Paper' : 'Ink';
      inv.setAttribute('aria-pressed', String(b.paper));
      paintText(root, b); markDirty();
    });
    head.appendChild(inv);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini-btn';
    del.textContent = '×';
    del.title = 'Remove this block';
    del.setAttribute('aria-label', 'Remove this preview block');
    del.addEventListener('click', function () {
      pushUndo();
      state.blocks = state.blocks.filter(function (x) { return x !== b; });
      renderTesters(); markDirty();
      toast('Block removed — Ctrl/⌘ Z brings it back');
    });
    head.appendChild(del);

    root.appendChild(head);

    var body = document.createElement('div');
    body.className = 'tester-body';
    root.appendChild(body);

    paintText(root, b);
    return root;
  }

  var lastMissing = '';
  function paintText(root, b) {
    var body = root.querySelector('.tester-body');
    body.innerHTML = '';

    if (b.editing) {
      var ta = document.createElement('textarea');
      ta.className = 'tester-edit';
      ta.value = b.text;
      ta.setAttribute('aria-label', 'Preview text');
      body.appendChild(ta);
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      var commit = function () {
        if (!b.editing) return;
        if (ta.value !== b.text) pushUndo();
        b.text = ta.value; b.editing = false; paintText(root, b); markDirty();
        reportMissing(b.text);
      };
      ta.addEventListener('blur', commit);
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { b.editing = false; paintText(root, b); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
      });
      return;
    }

    var holder = document.createElement('div');
    holder.className = 'tester-text';
    holder.style.lineHeight = (b.lh / 100);
    holder.style.fontSize = b.size + 'px';
    // stacked marks on the first line need headroom the leading doesn't give
    if (/[\u0300-\u036f]/.test(b.text.normalize('NFD'))) holder.style.paddingTop = (0.2 * b.size).toFixed(1) + 'px';
    holder.style.color = b.paper ? '#000' : state.ink;
    holder.title = 'Click to edit this text';
    holder.tabIndex = 0;
    holder.setAttribute('role', 'button');
    holder.setAttribute('aria-label', 'Preview text: ' + b.text + '. Press Enter to edit.');
    var edit = function () { b.editing = true; paintText(root, b); };
    holder.addEventListener('click', edit);
    holder.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); edit(); } });
    body.appendChild(holder);
    fillText(holder, b.text, fitSize(b, body), b.tr);
  }
  // On a narrow screen a 200px word can be wider than the block; shrink the
  // rendering (not the setting) so the longest word still fits.
  function fitSize(b, body) {
    var avail = body.clientWidth - 2;
    if (!(avail > 0)) return b.size;
    var widest = 0;
    b.text.split(/\s+/).forEach(function (w) {
      var em = 0, prev = null;
      GC.clusters(w).forEach(function (L) {
        if (!canDraw(L)) { em += 0.42; prev = null; return; }
        em += (spacingOf(L).adv + (prev ? kernOf(prev, L) : 0)) / MET.em + b.tr;
        prev = L;
      });
      if (em > widest) widest = em;
    });
    return widest * b.size > avail ? Math.max(8, Math.floor(avail / widest)) : b.size;
  }

  function fillText(holder, text, size, tr) {
    var k = size / MET.em, space = WORD_EM * size + tr * size;
    text.split(/\s+/).forEach(function (chunk) {
      if (!chunk) return;
      var word = document.createElement('span');
      word.className = 'word';
      var prev = null;
      GC.clusters(chunk).forEach(function (L) {
        var el;
        if (canDraw(L)) {
          if (!FLAT[L]) ensureDef(L);
          el = glyphSvg(L, size, 'text');
          if (prev) el.style.marginLeft = (kernOf(prev, L) * k + tr * size).toFixed(2) + 'px';
          prev = L;
        } else {
          el = notdefSvg(size);
          if (prev) el.style.marginLeft = (tr * size).toFixed(2) + 'px';
          prev = null;
        }
        word.appendChild(el);
      });
      word.style.marginRight = space.toFixed(2) + 'px';
      holder.appendChild(word);
      holder.appendChild(document.createTextNode('​'));
    });
  }

  function missingIn(text) {
    var miss = [];
    GC.clusters(text).forEach(function (L) {
      if (/^\s$/.test(L) || canDraw(L) || miss.indexOf(L) >= 0) return;
      miss.push(L);
    });
    return miss;
  }
  function reportMissing(text) {
    var miss = missingIn(text).join(' ');
    if (miss && miss !== lastMissing) toast('Not in this font yet: ' + miss, 3200);
    lastMissing = miss;
  }

  function repaintAllTesters() {
    var roots = testerList.querySelectorAll('.tester');
    for (var i = 0; i < roots.length; i++) {
      if (!state.blocks[i].editing) paintText(roots[i], state.blocks[i]);
    }
  }

  // ------------------------------------------------------------- glyph set
  // Built once; afterwards only the cells' frames are refreshed, the outlines
  // themselves follow the shared defs.
  var cellSize = 64;
  function renderGlyphSet() {
    glyphSetEl.innerHTML = '';
    SETS.forEach(function (grp) {
      var g = document.createElement('div');
      g.className = 'glyphset-group';
      var lab = document.createElement('div');
      lab.className = 'glyphset-label';
      var n = grp[1].filter(function (L) { return isMark(L) ? !!FLAT[L] : canDraw(L); }).length;
      lab.textContent = grp[0] + '  ' + n + '/' + grp[1].length;
      g.appendChild(lab);
      var row = document.createElement('div');
      row.className = 'glyphset-row';
      grp[1].forEach(function (L) {
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'glyph-cell' + (L === state.selected ? ' selected' : '') + (isMark(L) ? ' mark' : '');
        cell.dataset.letter = L;
        cell.setAttribute('aria-pressed', String(L === state.selected));
        var info = isMark(L) && GC.MARKS[L];
        cell.title = info ? info.name + ' (' + info.vi + ') — shared by every letter that uses it' : L;
        cell.setAttribute('aria-label', info ? 'Mark: ' + info.name : 'Glyph ' + L);
        cell.addEventListener('click', function () { selectLetter(L); });
        row.appendChild(cell);
      });
      g.appendChild(row);
      glyphSetEl.appendChild(g);
    });
    refreshGlyphSet();
  }
  function refreshGlyphSet() {
    var color = state.ink === '#000000' ? '#fff' : state.ink;
    glyphSetEl.querySelectorAll('.glyph-cell').forEach(function (cell) {
      var L = cell.dataset.letter, svg = cell.firstChild;
      cell.style.color = color;
      if (svg) setFrame(svg, L, cellSize);
      else cell.appendChild(glyphSvg(L, cellSize, 'cell'));
      cell.classList.toggle('edited', isEdited(L));
    });
  }
  function isEdited(L) {
    if (state.metrics[L]) return true;
    var p = GC.plan(L, hasKey);
    var keys = !p ? [] : p.simple ? [L] : [p.base].concat(p.fused, p.top, p.bottom);
    return keys.some(function (k) {
      return (letterOv[k] && Object.keys(letterOv[k]).length) || JSON.stringify(FLAT[k]) !== JSON.stringify(flatten(BASE[k]));
    });
  }

  // ----------------------------------------------------------------- editor
  function mkEl(t, a) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); return e; }

  // The editor edits a *view*: one or more source glyphs, each drawn at an
  // offset. A plain letter is one part; a composite like Ấ is its base plus
  // every mark where compose() put it, so dragging the acute there edits the
  // one acute every letter shares; a lone mark is shown on a ghost host.
  function viewOf(L) {
    if (isMark(L)) {
      var mp = markPlacement(L);
      return { parts: [{ key: L, ox: mp.ox, oy: mp.oy, zone: GC.MARKS[L].zone }], rings: displayRings(L), ghost: markHost(L) };
    }
    if (FLAT[L]) return { parts: [{ key: L, ox: 0, oy: 0, zone: 'base' }], rings: ringsOf(L) };
    var c = compositeOf(L);
    return c ? { parts: c.parts, rings: c.rings } : { parts: [], rings: [] };
  }
  function partScale(p) { return p.zone === 'top' || p.zone === 'bottom' || (isMark(p.key) && p.zone !== 'fused') ? GC.LAYOUT.scale : 1; }
  function viewNodes(v) {
    var out = [];
    v.parts.forEach(function (p) {
      var s = partScale(p);
      effNodes(p.key).forEach(function (n, i) {
        out.push({ key: p.key, idx: i, ox: p.ox, oy: p.oy, s: s, x: n[0] * s + p.ox, y: n[1] * s + p.oy, r: n[2] * s, zone: p.zone });
      });
    });
    return out;
  }
  function viewIndex(L, key, idx) {
    var ns = viewNodes(viewOf(L));
    for (var i = 0; i < ns.length; i++) if (ns[i].key === key && ns[i].idx === idx) return i;
    return -1;
  }
  var EDV = { nodes: [] };

  // zoom / pan: a square viewBox of side ED_SPAN / edZoom centred on (edCx, edCy)
  var ED_SPAN = 170, edZoom = 1, edCx = GW / 2, edCy = 50;
  function fitEditor() {
    var v = viewOf(state.selected), b = GC.bbox(v.rings) || [0, 0, GW, GH];
    var x0 = Math.min(b[0], 0), x1 = Math.max(b[2], GW);
    var y0 = Math.min(b[1], MET.cap), y1 = Math.max(b[3], MET.base);
    var span = Math.max(x1 - x0, y1 - y0) + 34;
    edZoom = Math.min(4, Math.max(0.5, ED_SPAN / span));
    edCx = (x0 + x1) / 2; edCy = (y0 + y1) / 2;
  }

  function renderEditor() {
    var L = state.selected, v = viewOf(L), nodes = viewNodes(v), z = edZoom;
    EDV = { view: v, nodes: nodes };
    if (state.activeNode >= nodes.length) state.activeNode = -1;
    badge.textContent = isMark(L) ? '◌' + L : L;
    var span = ED_SPAN / z, vx = edCx - span / 2, vy = edCy - span / 2;
    edSvg.setAttribute('viewBox', vx.toFixed(2) + ' ' + vy.toFixed(2) + ' ' + span.toFixed(2) + ' ' + span.toFixed(2));
    edSvg.innerHTML = '';
    var hair = 0.6 / Math.sqrt(z);
    for (var gx = 0; gx <= GW; gx += 12) edSvg.appendChild(mkEl('line', { x1: gx, y1: 0, x2: gx, y2: GH, stroke: '#1c1c1c', 'stroke-width': hair }));
    for (var gy = 0; gy <= GH; gy += 12) edSvg.appendChild(mkEl('line', { x1: 0, y1: gy, x2: GW, y2: gy, stroke: '#1c1c1c', 'stroke-width': hair }));

    // metric guides: measured baseline and cap height, the accent line the
    // marks hang from, and the advance box the spacing gives this glyph
    var gl = vx, gr = vx + span, fs = 5.2 / z;
    function guide(y, label, color) {
      edSvg.appendChild(mkEl('line', { x1: gl, y1: y, x2: gr, y2: y, stroke: color, 'stroke-width': 1 / z, 'stroke-dasharray': (3 / z) + ' ' + (2 / z) }));
      var t = mkEl('text', { x: gl + 3 / z, y: y - 2 / z, fill: '#8a8a8a', 'font-size': fs, 'font-family': 'IBM Plex Mono, monospace' });
      t.textContent = label;
      edSvg.appendChild(t);
    }
    guide(MET.base, 'baseline', '#4d4d4d');
    guide(MET.cap, 'cap', '#4d4d4d');
    guide(MET.base - ASC_EM * MET.em, 'ascender', '#2e2e2e');
    guide(MET.base + DESC_EM * MET.em, 'descender', '#2e2e2e');
    var ax0 = 0, ax1 = GW;
    if (canDraw(L)) {
      var sp = spacingOf(L); ax0 = sp.x0 - sp.lsb; ax1 = ax0 + sp.adv;
      [ax0, ax1].forEach(function (x) {
        edSvg.appendChild(mkEl('line', { x1: x, y1: vy, x2: x, y2: vy + span, stroke: 'rgba(255,80,0,0.45)', 'stroke-width': 1 / z }));
      });
    }

    // spacing context: a faint H before and O after, placed with the live
    // sidebearings and kerning, the way a type designer proofs H?O
    if (canDraw(L) && !isMark(L)) {
      var hs = spacingOf('H'), os = spacingOf('O');
      var lx = ax0 + kernOf('H', L) - hs.adv - (hs.x0 - hs.lsb), rx = ax1 + kernOf(L, 'O') - (os.x0 - os.lsb);
      edSvg.appendChild(mkEl('path', { d: ringsToD(ringsOf('H')), fill: '#262626', transform: 'translate(' + lx.toFixed(2) + ',0)' }));
      edSvg.appendChild(mkEl('path', { d: ringsToD(ringsOf('O')), fill: '#262626', transform: 'translate(' + rx.toFixed(2) + ',0)' }));
    }
    if (v.ghost) edSvg.appendChild(mkEl('path', { d: ringsToD(ringsOf(v.ghost)), fill: '#1d1d1d', 'fill-rule': 'nonzero' }));
    edSvg.appendChild(mkEl('path', { d: ringsToD(v.rings), fill: '#3b3b3b', 'fill-rule': 'nonzero' }));

    v.parts.forEach(function (p) {
      var s = partScale(p);
      chainsOf(p.key).forEach(function (c) {
        if (c.length < 2) return;
        edSvg.appendChild(mkEl('path', {
          d: 'M' + c.map(function (n) { return (n[0] * s + p.ox).toFixed(1) + ',' + (n[1] * s + p.oy).toFixed(1); }).join('L'),
          fill: 'none', stroke: p.zone === 'base' ? '#6a6a6a' : '#8a5a3a', 'stroke-width': 0.9 / z,
          'stroke-dasharray': (3 / z) + ' ' + (2.5 / z),
        }));
      });
    });

    nodes.forEach(function (n, i) {
      var act = i === state.activeNode;
      if (act) {
        var rr = n.r * state.mass;
        edSvg.appendChild(mkEl('circle', {
          cx: n.x, cy: n.y, r: rr, fill: 'none',
          stroke: '#ff5000', 'stroke-width': 1.1 / z, 'stroke-dasharray': (3 / z) + ' ' + (2 / z), opacity: 0.95,
        }));
        var g = mkEl('circle', { cx: n.x + rr, cy: n.y, r: 4.2 / z });
        g.setAttribute('class', 'rim-grip');
        g.setAttribute('stroke-width', 1.8 / z);
        g.addEventListener('pointerdown', function (e) { startDrag(e, i, 'radius'); });
        edSvg.appendChild(g);
      }
      var h = mkEl('circle', { cx: n.x, cy: n.y, r: (act ? 4.6 : 3.4) / z });
      h.setAttribute('class', 'node-handle' + (act ? ' active' : '') + (n.zone !== 'base' ? ' mark-node' : ''));
      h.setAttribute('stroke-width', 1.6 / z);
      h.addEventListener('pointerdown', function (e) { startDrag(e, i, 'move'); });
      edSvg.appendChild(h);
    });
    $('zoomLabel').textContent = Math.round(z * 100) + '%';
    updateUndo();
    updateNodeInspector();
    updateMetricFields();
    updatePair();
  }

  function describeNode(n) {
    if (!n) return '';
    if (n.zone === 'base') return '';
    var info = GC.MARKS[n.key];
    var users = VIET.filter(function (V) { var p = GC.plan(V, hasKey); return p && [].concat(p.top, p.bottom, p.fused).indexOf(n.key) >= 0; }).length;
    return '   · ' + info.name.toLowerCase() + ' mark, shared by ' + users + ' letters';
  }

  // ---- zoom (scroll) & pan (drag empty canvas) for finer editing precision
  edSvg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = edSvg.getBoundingClientRect(), vb = edSvg.viewBox.baseVal;
    var mx = vb.x + (e.clientX - r.left) / r.width * vb.width;
    var my = vb.y + (e.clientY - r.top) / r.height * vb.height;
    zoomAt(mx, my, edZoom * Math.pow(1.0016, -e.deltaY));
  }, { passive: false });
  function zoomAt(mx, my, nz) {
    nz = Math.min(8, Math.max(0.4, nz));
    var k = edZoom / nz;
    edCx = mx + (edCx - mx) * k;
    edCy = my + (edCy - my) * k;
    edZoom = nz;
    renderEditor();
  }

  var pan = null;
  edSvg.addEventListener('pointerdown', function (e) {
    edWrap.focus({ preventScroll: true });
    pan = { sx: e.clientX, sy: e.clientY, cx: edCx, cy: edCy, moved: false };
    window.addEventListener('pointermove', onPan);
    window.addEventListener('pointerup', onPanUp);
  });
  function onPan(e) {
    if (!pan) return;
    var r = edSvg.getBoundingClientRect(), vb = edSvg.viewBox.baseVal;
    var dx = (e.clientX - pan.sx) * (vb.width / r.width);
    var dy = (e.clientY - pan.sy) * (vb.height / r.height);
    if (Math.abs(e.clientX - pan.sx) + Math.abs(e.clientY - pan.sy) > 3) pan.moved = true;
    edCx = pan.cx - dx; edCy = pan.cy - dy;
    renderEditor();
  }
  function onPanUp() {
    // a plain click on empty canvas deselects
    if (pan && !pan.moved && state.activeNode >= 0) { state.activeNode = -1; renderEditor(); }
    pan = null;
    window.removeEventListener('pointermove', onPan);
    window.removeEventListener('pointerup', onPanUp);
  }

  var drag = null;
  function userDelta(dx, dy) {
    var r = edSvg.getBoundingClientRect(), vb = edSvg.viewBox.baseVal;
    return [dx * (vb.width / r.width), dy * (vb.height / r.height)];
  }
  function clampNode(c) {
    return [Math.min(2 * GW, Math.max(-GW, c[0])), Math.min(2 * GH, Math.max(-GH, c[1])), Math.min(60, Math.max(2, c[2]))];
  }
  // write a node position given in the glyph's own space, mirrored if asked
  function applyNode(key, i, cur) {
    cur = clampNode(cur);
    var base = FLAT[key].nodes[i];
    setOverride(key, i, [cur[0] - base[0], cur[1] - base[1], cur[2] - base[2]]);
    if (state.mirror) {
      var m = MIRROR[key][i];
      if (m !== i) {
        var ax = isMark(key) ? 0 : GW, mb = FLAT[key].nodes[m];
        setOverride(key, m, [(ax - cur[0]) - mb[0], cur[1] - mb[1], cur[2] - mb[2]]);
      }
    }
  }
  function startDrag(e, idx, mode) {
    e.preventDefault(); e.stopPropagation();
    edWrap.focus({ preventScroll: true });
    var n = EDV.nodes[idx];
    if (!n) return;
    state.activeNode = idx;
    // the undo step is taken on the first move, so a plain click (selecting
    // a node) doesn't wipe the redo stack
    drag = { idx: idx, mode: mode, key: n.key, src: n.idx, s: n.s, zone: n.zone, sx: e.clientX, sy: e.clientY,
             start: effNodes(n.key)[n.idx].slice(), moved: false, snap: snapshot() };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    renderEditor();
  }
  function onMove(e) {
    if (!drag) return;
    var d = userDelta(e.clientX - drag.sx, e.clientY - drag.sy);
    if (!drag.moved) {
      undoStack.push(drag.snap);
      if (undoStack.length > 80) undoStack.shift();
      redoStack = [];
    }
    drag.moved = true;
    var cur;
    if (drag.mode === 'move') cur = [drag.start[0] + d[0] / drag.s, drag.start[1] + d[1] / drag.s, drag.start[2]];
    else cur = [drag.start[0], drag.start[1], Math.max(2, drag.start[2] + d[0] / drag.s / state.mass)];
    applyNode(drag.key, drag.src, cur);
    readout.textContent = (drag.mode === 'radius' ? 'radius ' + (cur[2] * drag.s).toFixed(1) : 'x ' + Math.round(cur[0]) + '   y ' + Math.round(cur[1]))
      + (state.globalEdit && !isMark(drag.key) ? '   · global' : '') + (state.mirror ? '   · mirrored' : '')
      + describeNode(EDV.nodes[drag.idx]);
    schedule();
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    var moved = drag && drag.moved;
    drag = null;
    if (moved) { markDirty(); schedule(); }   // schedule: refresh the character-set frames skipped mid-drag
  }

  var queued = false, repaintT = null;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      refreshDefs();          // instances are <use>, so outlines update everywhere at once
      renderEditor();
      if (!state.draft && !drag) refreshGlyphSet();   // cell frames catch up when the slider / node is let go
      // advance widths and kerning follow a beat later, so dragging stays light
      clearTimeout(repaintT);
      repaintT = setTimeout(repaintAllTesters, 140);
    });
  }

  // ------------------------------------------------------------- undo / redo
  // Snapshots cover every glyph's node structure and both override maps (so
  // structural edits undo as cleanly as drags), plus the shape, spacing and
  // accent settings and the preview blocks — anything a click can lose.
  function blocksData() {
    return state.blocks.map(function (b) { return { text: b.text, size: b.size, lh: b.lh, tr: b.tr, paper: b.paper }; });
  }
  function snapshot() {
    var sh = {};
    SHAPE_KEYS.forEach(function (k) { sh[k] = state[k]; });
    var L = GC.LAYOUT;
    return JSON.stringify({ g: globalOv, l: letterOv, f: FLAT, m: state.metrics, x: globalExempt, k: state.kernOv,
      sh: sh, preset: state.preset, pe: state.presetEdited, seed: state.seed, sp: state.spacing, kern: state.kern,
      lay: { scale: L.scale, gapTop: L.gapTop, gapStack: L.gapStack, gapBottom: L.gapBottom },
      blocks: blocksData() });
  }
  function restore(s) {
    var o = JSON.parse(s);
    globalOv = o.g; letterOv = o.l; FLAT = o.f; state.metrics = o.m || {}; globalExempt = o.x || {}; state.kernOv = o.k || {};
    Object.keys(FLAT).forEach(function (k) { MIRROR[k] = computeMirrorMap(k); });
    if (o.sh) {
      SHAPE_KEYS.forEach(function (k) { state[k] = o.sh[k]; });
      state.preset = o.preset; state.presetEdited = o.pe; state.seed = o.seed;
      state.spacing = o.sp; state.kern = o.kern;
      for (var k in o.lay) GC.LAYOUT[k] = o.lay[k];
      syncShape();
    }
    if (o.blocks && JSON.stringify(o.blocks) !== JSON.stringify(blocksData())) {
      state.blocks = o.blocks.map(function (b) { return block(b.text, b.size, b.lh, b.tr, b.paper); });
      renderTesters();
    }
    bumpAll();
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    updateUndo();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    if (state.activeNode >= viewNodes(viewOf(state.selected)).length) state.activeNode = -1;
    schedule(); markDirty();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    schedule(); markDirty();
  }
  function updateUndo() {
    $('btnUndo').disabled = !undoStack.length;
    $('btnRedo').disabled = !redoStack.length;
  }
  function selectLetter(L) {
    if (!FLAT[L] && !canDraw(L)) return;
    state.selected = L; state.activeNode = -1;
    fitEditor();
    renderEditor();
    var info = isMark(L) && GC.MARKS[L];
    readout.textContent = info
      ? info.name + ' (' + info.vi + '): every letter that carries it changes with it. Shown on ' + markHost(L) + ' for context.'
      : (FLAT[L] ? 'Click a node, then drag to move it, or drag its orange rim to swell / pinch the stroke.'
                 : L + ' is built from its base letter and marks: drag a base node to edit the letter, a brown mark node to edit the shared mark.');
    glyphSetEl.querySelectorAll('.glyph-cell').forEach(function (c) {
      var on = c.dataset.letter === L;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-pressed', String(on));
    });
  }
  function stepLetter(d) {
    var i = ORDER.indexOf(state.selected);
    selectLetter(ORDER[(i + d + ORDER.length) % ORDER.length]);
  }

  // -------------------------------------------------- structural node edits
  // bakes the letter's own overrides into FLAT[L] as the new base, clearing
  // them — needed before any insert/delete since those resize the node array
  // and would otherwise desync the index-keyed override maps. Global offsets
  // stay global (baking them too would apply them twice).
  function commitLetterNodes(L) {
    var lo = letterOv[L] || {}, go = !isMark(L) && !globalExempt[L] ? globalOv : {};
    FLAT[L] = {
      nodes: FLAT[L].nodes.map(function (n, i) {
        var l = lo[i] || [0, 0, 0], g = go[i] || [0, 0, 0];
        var out = [n[0] + l[0] + g[0], n[1] + l[1] + g[1], Math.max(2, n[2] + l[2] + g[2])];
        if (n.length > 3) out.push(n[3]);
        return out;
      }),
      lens: FLAT[L].lens.slice(),
    };
    if (letterOv[L]) delete letterOv[L];
    if (!isMark(L)) globalExempt[L] = true;
    letterVer[L]++;
  }
  function chainRangeOf(L, idx) {
    var lens = FLAT[L].lens, k = 0;
    for (var i = 0; i < lens.length; i++) {
      if (idx >= k && idx < k + lens[i]) return { ci: i, cs: k, ce: k + lens[i] - 1 };
      k += lens[i];
    }
    return null;
  }
  function activeSrc() { return EDV.nodes[state.activeNode] || null; }
  function addNode() {
    var n = activeSrc();
    if (!n) return;
    var L = n.key, idx = n.idx, rng = chainRangeOf(L, idx);
    if (!rng) return;
    var eff = effNodes(L);
    var partner = idx < rng.ce ? idx + 1 : (idx > rng.cs ? idx - 1 : -1);
    var nn, insertAt;
    if (partner === -1) {
      var a = eff[idx];
      nn = [a[0] + 4, a[1] + 4, a[2]];
      insertAt = idx + 1;
    } else {
      var a2 = eff[idx], b2 = eff[partner];
      nn = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2, (a2[2] + b2[2]) / 2];
      insertAt = Math.min(idx, partner) + 1;
    }
    pushUndo();
    commitLetterNodes(L);
    FLAT[L].nodes.splice(insertAt, 0, nn);
    FLAT[L].lens[rng.ci] += 1;
    MIRROR[L] = computeMirrorMap(L);
    letterVer[L]++;
    state.activeNode = viewIndex(state.selected, L, insertAt);
    schedule(); markDirty();
    toast('Node added — drag it to shape the curve');
  }
  function deleteNode() {
    var n = activeSrc();
    if (!n) return;
    var L = n.key, idx = n.idx, rng = chainRangeOf(L, idx);
    if (!rng || rng.ce - rng.cs + 1 <= 2) { toast('This chain needs at least 2 nodes'); return; }
    pushUndo();
    commitLetterNodes(L);
    FLAT[L].nodes.splice(idx, 1);
    FLAT[L].lens[rng.ci] -= 1;
    MIRROR[L] = computeMirrorMap(L);
    state.activeNode = -1;
    letterVer[L]++;
    schedule(); markDirty();
    toast('Node removed');
  }

  // ---------------------------------------------------------- node inspector
  // Fields show the node where it is drawn (so a mark's nodes read in letter
  // coordinates) and convert back on entry.
  function updateNodeInspector() {
    var n = activeSrc(), has = !!n;
    [nodeXEl, nodeYEl, nodeREl, addNodeBtn, delNodeBtn].forEach(function (el) { el.disabled = !has; });
    if (!has) { nodeXEl.value = ''; nodeYEl.value = ''; nodeREl.value = ''; return; }
    if (document.activeElement !== nodeXEl) nodeXEl.value = n.x.toFixed(1);
    if (document.activeElement !== nodeYEl) nodeYEl.value = n.y.toFixed(1);
    if (document.activeElement !== nodeREl) nodeREl.value = n.r.toFixed(1);
  }
  function applyNodeField() {
    var n = activeSrc();
    if (!n) return;
    var x = parseFloat(nodeXEl.value), y = parseFloat(nodeYEl.value), r = parseFloat(nodeREl.value);
    if (!isFinite(x) || !isFinite(y) || !isFinite(r)) { updateNodeInspector(); return; }
    pushUndo();
    applyNode(n.key, n.idx, [(x - n.ox) / n.s, (y - n.oy) / n.s, Math.max(2, r / n.s)]);
    schedule(); markDirty();
  }
  [nodeXEl, nodeYEl, nodeREl].forEach(function (el) { el.addEventListener('change', applyNodeField); });

  // per-glyph sidebearings: the fields show the final value; what is stored
  // is the offset from the automatic (optical) spacing, so it survives any
  // later change to Spacing or the shape sliders
  var lsbEl = $('glyphLsb'), rsbEl = $('glyphRsb');
  function updateMetricFields() {
    var L = state.selected, ok = canDraw(L);
    lsbEl.disabled = rsbEl.disabled = !ok;
    if (!ok) { lsbEl.value = ''; rsbEl.value = ''; return; }
    var s = spacingOf(L);
    if (document.activeElement !== lsbEl) lsbEl.value = s.lsb.toFixed(1);
    if (document.activeElement !== rsbEl) rsbEl.value = s.rsb.toFixed(1);
  }
  function applyMetric() {
    var L = state.selected;
    if (!canDraw(L)) return;
    var l = parseFloat(lsbEl.value), r = parseFloat(rsbEl.value);
    if (!isFinite(l) || !isFinite(r)) { updateMetricFields(); return; }
    var s = spacingOf(L), adj = state.metrics[L] || [0, 0];
    var nl = l - (s.lsb - adj[0]), nr = r - (s.rsb - adj[1]);
    pushUndo();
    if (Math.abs(nl) < 0.05 && Math.abs(nr) < 0.05) delete state.metrics[L];
    else state.metrics[L] = [Math.max(-60, Math.min(60, nl)), Math.max(-60, Math.min(60, nr))];
    schedule(); markDirty();
  }
  [lsbEl, rsbEl].forEach(function (el) { el.addEventListener('change', applyMetric); });
  // per-pair kerning: type two glyphs, see the automatic value, override it.
  // Overrides are absolute (glyph units) and go into previews, specimen and
  // the OTF's GPOS table.
  var pairL = $('pairLeft'), pairR = $('pairRight'), pairK = $('pairKern'), pairPv = $('pairPreview');
  function pairKeys() {
    var a = GC.clusters(pairL.value.trim())[0], b = GC.clusters(pairR.value.trim())[0];
    return a && b && canDraw(a) && canDraw(b) ? [a, b] : null;
  }
  function updatePair() {
    var ab = pairKeys();
    pairK.disabled = !ab;
    pairPv.innerHTML = '';
    if (!ab) { pairK.value = ''; return; }
    var key = ab[0] + '\u0000' + ab[1], v = kernOf(ab[0], ab[1]), manual = state.kernOv[key] != null;
    if (document.activeElement !== pairK) pairK.value = v.toFixed(1);
    pairK.classList.toggle('manual', manual);
    $('btnPairAuto').disabled = !manual;
    var size = 52, s0 = glyphSvg(ab[0], size, 'cell'), s1 = glyphSvg(ab[1], size, 'cell');
    s1.style.marginLeft = (v * size / MET.em).toFixed(2) + 'px';
    pairPv.classList.toggle('manual', manual);
    pairPv.appendChild(s0); pairPv.appendChild(s1);
  }
  [pairL, pairR].forEach(function (el) {
    el.addEventListener('input', function () { updatePair(); });
    el.addEventListener('focus', function () { el.select(); });
  });
  pairK.addEventListener('change', function () {
    var ab = pairKeys(), v = parseFloat(pairK.value);
    if (!ab || !isFinite(v)) { updatePair(); return; }
    pushUndo();
    state.kernOv[ab[0] + '\u0000' + ab[1]] = Math.max(-60, Math.min(30, v));
    KERN = {}; schedule(); markDirty();
  });
  $('btnPairAuto').addEventListener('click', function () {
    var ab = pairKeys();
    if (!ab) return;
    pushUndo();
    delete state.kernOv[ab[0] + '\u0000' + ab[1]];
    KERN = {}; schedule(); markDirty(); toast('Back to automatic kerning for ' + ab.join(''));
  });

  $('btnAutoMetrics').addEventListener('click', function () {
    if (!state.metrics[state.selected]) return;
    pushUndo(); delete state.metrics[state.selected];
    schedule(); markDirty(); toast('Back to automatic spacing');
  });
  addNodeBtn.addEventListener('click', addNode);
  delNodeBtn.addEventListener('click', deleteNode);

  // keyboard: nudge / resize / cycle the active node
  function nudge(dx, dy, dr) {
    var n = activeSrc();
    if (!n) return false;
    var now = Date.now();
    if (now - (nudge.t || 0) > 700) pushUndo();   // a burst of arrow presses is one undo step
    nudge.t = now;
    var e = effNodes(n.key)[n.idx];
    applyNode(n.key, n.idx, [e[0] + dx / n.s, e[1] + dy / n.s, e[2] + dr / n.s]);
    schedule(); markDirty();
    return true;
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    var mod = e.metaKey || e.ctrlKey, k = e.key;
    if (mod && (k === 'z' || k === 'Z')) {
      if (typing) return;   // native undo inside text fields
      e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
    }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); saveProjectFile(); return; }
    if (mod && (k === 'o' || k === 'O')) { e.preventDefault(); $('projectFile').click(); return; }
    if (typing || mod) return;
    var step = e.shiftKey ? 10 : 1;
    if (k === '?') { $('keysDialog').showModal(); return; }
    if (k === '[') { stepLetter(-1); return; }
    if (k === ']') { stepLetter(1); return; }
    // node keys only act while the canvas has focus, so Backspace on a
    // button or arrows on a slider never edit a glyph behind your back
    if (state.activeNode < 0 || !canvasFocused()) return;
    var used = false;
    if (k === 'Escape') { state.activeNode = -1; renderEditor(); used = true; }
    else if (k === 'Delete' || k === 'Backspace') { deleteNode(); used = true; }
    else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowRight')) used = nudge(0, 0, e.shiftKey ? 2 : 0.5);
    else if (e.altKey && (k === 'ArrowDown' || k === 'ArrowLeft')) used = nudge(0, 0, e.shiftKey ? -2 : -0.5);
    else if (k === 'ArrowLeft') used = nudge(-step, 0, 0);
    else if (k === 'ArrowRight') used = nudge(step, 0, 0);
    else if (k === 'ArrowUp') used = nudge(0, -step, 0);
    else if (k === 'ArrowDown') used = nudge(0, step, 0);
    if (used) e.preventDefault();
  });
  // With the canvas focused: Enter picks the first node, Tab / Shift+Tab walk
  // the nodes, and stepping past either end (or Esc, then Tab) lets focus
  // leave the canvas like any other control.
  var edWrap = $('editorWrap');
  function canvasFocused() { var a = document.activeElement; return a === edWrap || edWrap.contains(a); }
  function announceNode() {
    readout.textContent = 'node ' + (state.activeNode + 1) + ' of ' + EDV.nodes.length + describeNode(EDV.nodes[state.activeNode])
      + ' — arrows move it (shift ×10), alt+arrows resize';
  }
  edWrap.addEventListener('keydown', function (e) {
    var n = EDV.nodes.length, i = state.activeNode;
    if ((e.key === 'Enter' || e.key === ' ') && n && i < 0) {
      e.preventDefault(); state.activeNode = 0; renderEditor(); announceNode(); return;
    }
    if (e.key !== 'Tab' || !n || i < 0) return;
    var next = i + (e.shiftKey ? -1 : 1);
    if (next < 0 || next >= n) { state.activeNode = -1; renderEditor(); return; }   // let Tab move on
    e.preventDefault();
    state.activeNode = next;
    renderEditor(); announceNode();
  });

  // ---------------------------------------------------------------- controls
  // While a shape slider is moving, glyphs are traced at a coarser grid; the
  // full-quality pass runs once it is let go.
  function draftOn() { state.draft = true; }
  function draftOff() { if (!state.draft) return; state.draft = false; schedule(); markDirty(); }
  function bindRange(id, valId, get, set, fmt, heavy) {
    var el = $(id);
    el.value = get();
    $(valId).textContent = fmt ? fmt(get()) : get();
    var armed = false;   // one undo step per slider gesture
    el.addEventListener('input', function () {
      if (!armed) { pushUndo(); armed = true; }
      set(parseFloat(el.value));
      $(valId).textContent = fmt ? fmt(get()) : get();
      if (heavy) draftOn();
      schedule();
    });
    el.addEventListener('change', function () { armed = false; if (heavy) draftOff(); else markDirty(); });
  }
  var f1 = function (v) { return v.toFixed(1); }, f2 = function (v) { return v.toFixed(2); };
  function bindShape(id, valId, key, fmt) {
    bindRange(id, valId, function () { return state[key]; },
      function (v) { state[key] = v; markPresetEdited(); }, fmt, true);
  }
  bindShape('sldMass', 'valMass', 'mass', f2);
  bindShape('sldMelt', 'valMelt', 'melt', null);
  bindShape('sldTension', 'valTension', 'tension', f1);
  bindShape('sldWobble', 'valWobble', 'wobble', f1);
  bindShape('sldSmooth', 'valSmooth', 'smooth', null);
  bindRange('sldSpacing', 'valSpacing', function () { return state.spacing; },
    function (v) { state.spacing = v; }, f1, false);
  bindRange('sldKern', 'valKern', function () { return state.kern; },
    function (v) { state.kern = v; }, function (v) { return Math.round(v * 100) + '%'; }, false);
  bindRange('sldMarkScale', 'valMarkScale', function () { return GC.LAYOUT.scale; },
    function (v) { GC.LAYOUT.scale = v; }, function (v) { return Math.round(v * 100) + '%'; }, true);
  bindRange('sldMarkGap', 'valMarkGap', function () { return GC.LAYOUT.gapTop; },
    function (v) { GC.LAYOUT.gapTop = v; GC.LAYOUT.gapBottom = v; GC.LAYOUT.gapStack = Math.max(1, v * 0.5); }, f1, true);

  function toggle(id, key, after) {
    var b = $(id);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () {
      state[key] = !state[key];
      b.classList.toggle('active', state[key]);
      b.setAttribute('aria-pressed', String(state[key]));
      if (after) after();
    });
  }
  toggle('btnGlobalEdit', 'globalEdit', function () {
    $('globalWarn').hidden = !state.globalEdit;
  });
  toggle('btnMirror', 'mirror');
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnResetGlyph').addEventListener('click', function () {
    var v = viewOf(state.selected), n = activeSrc();
    var keys = n ? [n.key] : v.parts.map(function (p) { return p.key; });
    pushUndo();
    keys.forEach(function (k) {
      delete letterOv[k]; FLAT[k] = flatten(BASE[k]); MIRROR[k] = computeMirrorMap(k); letterVer[k]++;
    });
    state.activeNode = -1;
    schedule(); markDirty();
    toast(keys.length > 1 ? 'Glyph and its marks reset' : (isMark(keys[0]) ? 'Mark reset' : 'Glyph reset'));
  });
  $('btnFit').addEventListener('click', function () { fitEditor(); renderEditor(); });
  $('btnZoomIn').addEventListener('click', function () { zoomAt(edCx, edCy, edZoom * 1.25); });
  $('btnZoomOut').addEventListener('click', function () { zoomAt(edCx, edCy, edZoom / 1.25); });
  $('btnReseed').addEventListener('click', function () {
    pushUndo();
    state.seed = Math.floor(Math.random() * 100000);
    $('seedLabel').textContent = '#' + state.seed;
    schedule(); markDirty();
  });

  $('btnAddBlock').addEventListener('click', function () {
    pushUndo();
    state.blocks.push(block('NEW PREVIEW BLOCK', 120, 120, 0.01));
    renderTesters(); markDirty();
  });
  // proofing strings a type designer reaches for
  var PROOFS = {
    spacing: 'HAMBURGEFONTSIV HOHOHOH NONONON',
    kerning: 'AV AW AY LT LV LY TA TO VA WA YA P. T, Y. F. L’ AT TY',
    vietnamese: 'ĂN ẤM ỞN ỨNG ĐẸP CHỮ NGHĨA KHỎE MẠNH QUẬY PHÁ ỒN ÀO',
    pangram: 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789',
  };
  $('proofSelect').addEventListener('change', function (e) {
    var v = e.target.value, t = PROOFS[v];
    e.target.value = '';
    if (v) pushUndo();
    if (v === 'waterfall') {
      // one line at falling sizes: where the melt stops reading
      [18, 28, 44, 72].forEach(function (sz) { state.blocks.unshift(block('ĐẸP QUÁ, TIẾNG VIỆT! AV LT 2026', sz, 145, 0.01)); });
      renderTesters(); markDirty(); $('specimenScroll').scrollTop = 0;
      return;
    }
    if (!t) return;
    state.blocks.unshift(block(t, 96, v === 'vietnamese' ? 150 : 125, 0.01));
    renderTesters(); markDirty();
    $('specimenScroll').scrollTop = 0;
  });

  $('presetSelect').addEventListener('change', function (e) {
    var p = PRESETS[e.target.value]; if (!p) return;
    pushUndo();
    state.preset = e.target.value;
    Object.keys(p).forEach(function (k) { state[k] = p[k]; });
    state.presetEdited = false;
    syncShape(); schedule(); markDirty();
  });
  function markPresetEdited() {
    if (state.presetEdited) return;
    state.presetEdited = true;
    syncPresetLabel();
  }
  function syncPresetLabel() {
    var sel = $('presetSelect');
    Array.prototype.forEach.call(sel.options, function (o) {
      var base = o.value.charAt(0).toUpperCase() + o.value.slice(1);
      o.textContent = base + (o.value === state.preset && state.presetEdited ? ' (edited)' : '');
    });
    sel.value = state.preset;
  }
  function syncShape() {
    $('sldMass').value = state.mass; $('valMass').textContent = f2(state.mass);
    $('sldMelt').value = state.melt; $('valMelt').textContent = state.melt;
    $('sldTension').value = state.tension; $('valTension').textContent = f1(state.tension);
    $('sldWobble').value = state.wobble; $('valWobble').textContent = f1(state.wobble);
    $('sldSmooth').value = state.smooth; $('valSmooth').textContent = state.smooth;
    $('sldSpacing').value = state.spacing; $('valSpacing').textContent = f1(state.spacing);
    $('sldKern').value = state.kern; $('valKern').textContent = Math.round(state.kern * 100) + '%';
    $('sldMarkScale').value = GC.LAYOUT.scale; $('valMarkScale').textContent = Math.round(GC.LAYOUT.scale * 100) + '%';
    $('sldMarkGap').value = GC.LAYOUT.gapTop; $('valMarkGap').textContent = f1(GC.LAYOUT.gapTop);
    $('seedLabel').textContent = '#' + state.seed;
    syncPresetLabel();
  }

  $('fontNameInput').addEventListener('input', function (e) {
    state.fontName = e.target.value || 'Untitled';
    testerList.querySelectorAll('[data-role=name]').forEach(function (n) { n.textContent = state.fontName; });
    markDirty();
  });

  var sw = $('swatchRow');
  function renderSwatches() {
    sw.innerHTML = '';
    PALETTE.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === state.ink ? ' active' : '');
      b.style.background = c;
      b.setAttribute('aria-label', 'Ink colour ' + c);
      b.setAttribute('aria-pressed', String(c === state.ink));
      b.addEventListener('click', function () {
        state.ink = c;
        renderSwatches();
        repaintAllTesters(); refreshGlyphSet(); markDirty();
      });
      sw.appendChild(b);
    });
  }
  renderSwatches();
  function updateCoverage() {
    var n = LETTERS.length + VIET.filter(canDraw).length;
    $('glyphCountMeta').textContent = n + ' glyphs · Việt ' + VIET.filter(canDraw).length + '/' + VIET.length;
  }

  // ------------------------------------------------------------ persistence
  // The whole project autosaves to this browser, and can be saved to /
  // opened from a .liquid.json file. `chains` carries every skeleton with the
  // edits applied, which is what the Poster tool reads.
  var dirtyT = null;
  function markDirty() {
    clearTimeout(dirtyT);
    $('saveState').textContent = 'Saving…';
    dirtyT = setTimeout(autosave, 500);
  }
  function projectData() {
    var shape = {}, chains = {};
    SHAPE_KEYS.forEach(function (k) { shape[k] = state[k]; });
    Object.keys(FLAT).forEach(function (k) { chains[k] = chainsOf(k); });
    return {
      app: 'liquid.font', version: 1, savedAt: new Date().toISOString(),
      fontName: state.fontName, ink: state.ink, preset: state.preset, presetEdited: state.presetEdited,
      seed: state.seed, shape: shape,
      spacing: { spacing: state.spacing, kern: state.kern, metrics: state.metrics, pairs: state.kernOv },
      marks: { scale: GC.LAYOUT.scale, gapTop: GC.LAYOUT.gapTop, gapStack: GC.LAYOUT.gapStack, gapBottom: GC.LAYOUT.gapBottom },
      globalOv: globalOv, letterOv: letterOv, globalExempt: globalExempt, flat: FLAT,
      blocks: state.blocks.map(function (b) { return { text: b.text, size: b.size, lh: b.lh, tr: b.tr, paper: b.paper }; }),
      chains: chains,
    };
  }
  function autosave() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(projectData()));
      $('saveState').textContent = 'Saved in browser';
    } catch (e) { $('saveState').textContent = 'Not saved'; }
  }
  function num(v, lo, hi, d) { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }
  function validFlat(f) {
    return f && Array.isArray(f.nodes) && Array.isArray(f.lens) && f.nodes.length < 400 &&
      f.nodes.every(function (n) {
        return Array.isArray(n) && n.length >= 3 && Math.abs(n[0]) <= 3 * GW && Math.abs(n[1]) <= 3 * GH && n[2] >= 1 && n[2] <= 80;
      }) &&
      f.lens.every(function (l) { return l >= 1 && l === Math.floor(l); }) &&
      f.lens.reduce(function (a, b) { return a + b; }, 0) === f.nodes.length;
  }
  // {key: {index: [dx, dy, dr]}} with sane numbers only
  function cleanOv(o, flat) {
    var out = {};
    if (!o || typeof o !== 'object') return out;
    Object.keys(o).forEach(function (i) {
      var d = o[i];
      if (!/^\d+$/.test(i) || !Array.isArray(d) || d.length < 3) return;
      var v = [num(d[0], -2 * GW, 2 * GW, NaN), num(d[1], -2 * GH, 2 * GH, NaN), num(d[2], -60, 60, NaN)];
      if (v.every(isFinite) && (!flat || +i < flat.nodes.length)) out[i] = v;
    });
    return out;
  }
  // Ranges are the sliders' own, so a hand-edited or hostile file can't push
  // the engine somewhere it never goes (smooth 100 froze the tab, res < 0
  // blanked every glyph).
  var SHAPE_RANGE = { mass: [0.6, 1.5], melt: [0, 40], tension: [-12, 8], wobble: [0, 8], grain: [0.01, 0.2], smooth: [0, 4], res: [1.2, 3] };
  // Validate everything into a staging object first; nothing is touched
  // unless the whole file passes, so a rejected Open leaves no trace.
  function parseProject(p) {
    if (!p || p.app !== 'liquid.font') throw new Error('not a Liquid.Font project');
    var q = {}, base;
    q.fontName = String(p.fontName || 'Untitled').slice(0, 60);
    q.ink = PALETTE.indexOf(p.ink) >= 0 ? p.ink : PALETTE[0];
    q.preset = PRESETS[p.preset] ? p.preset : 'liquid';
    q.presetEdited = !!p.presetEdited;
    q.seed = Math.round(num(p.seed, 0, 1e6, 5));
    base = PRESETS[q.preset];
    var sh = p.shape || {};
    q.shape = {};
    SHAPE_KEYS.forEach(function (k) { q.shape[k] = num(sh[k], SHAPE_RANGE[k][0], SHAPE_RANGE[k][1], base[k]); });
    q.shape.smooth = Math.round(q.shape.smooth);
    var spc = p.spacing || {};
    q.spacing = num(spc.spacing, 0, 20, 7); q.kern = num(spc.kern, 0, 1, 0.7);
    q.metrics = {};
    if (spc.metrics && typeof spc.metrics === 'object') Object.keys(spc.metrics).forEach(function (k) {
      var m = spc.metrics[k];
      if (BASE[k] || GC.plan(k, function (x) { return !!BASE[x]; })) {
        if (Array.isArray(m) && isFinite(m[0]) && isFinite(m[1])) q.metrics[k] = [num(m[0], -60, 60, 0), num(m[1], -60, 60, 0)];
      }
    });
    q.kernOv = {};
    var hasK = function (x) { return !!BASE[x]; };
    if (spc.pairs && typeof spc.pairs === 'object') Object.keys(spc.pairs).slice(0, 5000).forEach(function (k) {
      var ab = k.split('\u0000'), v = +spc.pairs[k];
      if (ab.length === 2 && isFinite(v) && ab.every(function (g) { return GC.plan(g, hasK); })) q.kernOv[k] = num(v, -60, 30, 0);
    });
    var mk = p.marks || {};
    q.marks = { scale: num(mk.scale, 0.6, 1.5, 1), gapTop: num(mk.gapTop, 0, 20, 6), gapStack: num(mk.gapStack, 0, 20, 3), gapBottom: num(mk.gapBottom, 0, 20, 6) };
    q.flat = {};
    Object.keys(BASE).forEach(function (k) { q.flat[k] = p.flat && validFlat(p.flat[k]) ? p.flat[k] : flatten(BASE[k]); });
    q.globalOv = cleanOv(p.globalOv, null);
    q.letterOv = {};
    if (p.letterOv && typeof p.letterOv === 'object') Object.keys(p.letterOv).forEach(function (k) {
      if (q.flat[k]) q.letterOv[k] = cleanOv(p.letterOv[k], q.flat[k]);
    });
    q.globalExempt = {};
    if (p.globalExempt && typeof p.globalExempt === 'object') Object.keys(p.globalExempt).forEach(function (k) { if (BASE[k]) q.globalExempt[k] = true; });
    if (Array.isArray(p.blocks)) {
      q.blocks = p.blocks.slice(0, 40).map(function (b) {
        return block(String((b && b.text) || '').slice(0, 5000), num(b && b.size, 10, 480, 96), num(b && b.lh, 70, 220, 120), num(b && b.tr, -0.06, 0.4, 0.01), b && b.paper);
      });
    }
    return q;
  }
  function applyProject(p) {
    var q = parseProject(p);
    state.fontName = q.fontName; state.ink = q.ink; state.preset = q.preset; state.presetEdited = q.presetEdited;
    state.seed = q.seed;
    SHAPE_KEYS.forEach(function (k) { state[k] = q.shape[k]; });
    state.spacing = q.spacing; state.kern = q.kern; state.metrics = q.metrics; state.kernOv = q.kernOv;
    for (var k in q.marks) GC.LAYOUT[k] = q.marks[k];
    FLAT = q.flat;
    Object.keys(FLAT).forEach(function (x) { MIRROR[x] = computeMirrorMap(x); });
    globalOv = q.globalOv; letterOv = q.letterOv; globalExempt = q.globalExempt;
    if (q.blocks) state.blocks = q.blocks;
    undoStack = []; redoStack = []; bumpAll(); extraKeys = {};
    state.activeNode = -1;
  }
  function rebuildAll() {
    $('fontNameInput').value = state.fontName;
    syncShape(); renderSwatches();
    refreshDefs(); renderTesters(); renderGlyphSet(); fitEditor(); renderEditor(); updateCoverage();
  }
  function saveProjectFile() {
    dl(new Blob([JSON.stringify(projectData(), null, 1)], { type: 'application/json' }), safeName() + '.liquid.json');
    toast('Project saved — open it again with Open');
  }
  $('btnSaveProject').addEventListener('click', saveProjectFile);
  $('btnOpenProject').addEventListener('click', function () { $('projectFile').click(); });
  $('projectFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var p;
      try { p = JSON.parse(rd.result); parseProject(p); }       // validate before touching anything
      catch (err) { toast('Could not open: ' + err.message, 3500); return; }
      applyProject(p); rebuildAll(); autosave(); toast('Opened ' + f.name);
    };
    rd.readAsText(f);
  });
  $('btnNewProject').addEventListener('click', function () {
    if (!confirm('Start a new font? Unsaved edits in this browser will be replaced.')) return;
    applyProject({ app: 'liquid.font', fontName: 'Ooze', preset: 'liquid', seed: 5, shape: PRESETS.liquid, ink: PALETTE[0] });
    state.blocks = defaultBlocks();
    rebuildAll(); autosave(); toast('New font');
  });

  // ----------------------------------------------------------------- exports
  // Lay a block out the same way the preview does: em-sized glyphs, measured
  // spacing, kerning, tracking, word wrap at maxW. Returns placed glyphs.
  function layoutBlock(b, maxW) {
    var k = b.size / MET.em, trk = b.tr * b.size, space = WORD_EM * b.size + trk;
    var lines = [[]], x = 0, lineW = [0];
    b.text.split(/\s+/).forEach(function (chunk) {
      if (!chunk) return;
      var word = [], wx = 0, prev = null;
      GC.clusters(chunk).forEach(function (L) {
        if (!canDraw(L)) {   // the same orange box the preview shows
          if (prev || word.length) wx += trk;
          word.push({ notdef: true, x: wx, w: 0.42 * b.size });
          wx += 0.42 * b.size; prev = null; return;
        }
        if (prev) wx += kernOf(prev, L) * k + trk;
        var s = spacingOf(L);
        word.push({ L: L, x: wx, s: s });
        wx += s.adv * k; prev = L;
      });
      if (!word.length) return;
      if (x > 0 && x + wx > maxW) { lines.push([]); lineW.push(0); x = 0; }
      word.forEach(function (g) { g.x += x; lines[lines.length - 1].push(g); });
      x += wx; lineW[lineW.length - 1] = x; x += space;
    });
    return { lines: lines, widths: lineW, k: k };
  }
  // The whole specimen as one SVG: every block in its own size, leading,
  // tracking and ink/paper colours, glyphs referenced from shared defs.
  function buildSVG() {
    var W = 1600, pad = 60, inner = W - pad * 2, y = 0, body = '', used = {};
    var bg = state.ink === '#000000' ? '#ffffff' : '#000000';
    var blocks = state.blocks.length ? state.blocks : [block(state.fontName.toUpperCase(), 160, 110, 0.01)];
    blocks.forEach(function (b) {
      var lay = layoutBlock(b, inner), lh = b.lh / 100 * b.size, top = y;
      var h = pad * 0.6 + (ASC_EM - CAP_EM) * b.size + lay.lines.length * lh + DESC_EM * b.size + pad * 0.6;
      var ink = b.paper ? '#000000' : (state.ink === '#000000' ? '#000' : state.ink);
      if (b.paper) body += '<rect x="0" y="' + top.toFixed(1) + '" width="' + W + '" height="' + h.toFixed(1) + '" fill="#ffffff"/>';
      var baseline = top + pad * 0.6 + (ASC_EM - CAP_EM) * b.size + CAP_EM * b.size + (lh - b.size) / 2;
      body += '<g fill="' + ink + '">';
      lay.lines.forEach(function (line, li) {
        var by = baseline + li * lh;
        line.forEach(function (g) {
          if (g.notdef) {
            body += '<rect x="' + (pad + g.x + g.w * 0.1).toFixed(1) + '" y="' + (by - CAP_EM * b.size).toFixed(1) + '" width="' + (g.w * 0.8).toFixed(1) +
              '" height="' + (CAP_EM * b.size).toFixed(1) + '" rx="3" fill="none" stroke="#ff5000" stroke-width="2"/>';
            return;
          }
          used[g.L] = 1;
          var tx = pad + g.x - (g.s.x0 - g.s.lsb) * lay.k, ty = by - MET.base * lay.k;
          body += '<use href="#' + gid(g.L) + '" xlink:href="#' + gid(g.L) + '" transform="translate(' + tx.toFixed(2) + ',' + ty.toFixed(2) + ') scale(' + lay.k.toFixed(5) + ')"/>';
        });
      });
      body += '</g>';
      y += h;
    });
    var defs = Object.keys(used).map(function (L) {
      return '<path id="' + gid(L) + '" d="' + ringsToD(ringsOf(L)) + '" fill-rule="nonzero"/>';
    }).join('');
    var H = Math.ceil(y);
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '"><title>' + escapeXml(state.fontName) + ' specimen</title><defs>' + defs + '</defs><rect width="100%" height="100%" fill="' + bg + '"/>' + body + '</svg>';
  }
  function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function dl(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function safeName() {
    return (state.fontName || 'font').trim().replace(/[^a-z0-9\-_]+/gi, '-').toLowerCase() || 'font';
  }
  $('btnExportSvg').addEventListener('click', function () {
    dl(new Blob([buildSVG()], { type: 'image/svg+xml' }), safeName() + '-specimen.svg');
    toast(state.blocks.length ? 'Specimen SVG exported' : 'No preview blocks — exported the font name as the specimen');
  });
  $('btnExportPng').addEventListener('click', function () {
    var s = buildSVG(), img = new Image();
    var u = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = function () {
      var m = s.match(/width="([\d.]+)" height="([\d.]+)"/);
      var w = m ? +m[1] : img.width, h = m ? +m[2] : img.height, f = 2;
      var c = document.createElement('canvas');
      c.width = w * f; c.height = h * f;
      var g = c.getContext('2d'); g.scale(f, f); g.drawImage(img, 0, 0, w, h);
      c.toBlob(function (bl) { dl(bl, safeName() + '-specimen.png'); toast('Specimen PNG exported'); });
      URL.revokeObjectURL(u);
    };
    img.onerror = function () { toast('PNG export failed'); URL.revokeObjectURL(u); };
    img.src = u;
  });
  $('btnExportOtf').addEventListener('click', function () {
    var b = $('btnExportOtf'), lbl = b.textContent;
    b.disabled = true; b.textContent = 'Pouring…';
    setTimeout(function () {
      try { var n = buildOtf(); toast('OTF exported — ' + n + ' glyphs, kerned. Install it like any font file.', 3200); }
      catch (e) { console.error(e); toast('OTF export failed: ' + e.message, 4000); }
      finally { b.disabled = false; b.textContent = lbl; }
    }, 30);
  });

  // AGL-style names so apps and fontTools show something sensible
  var AGL = { '.': 'period', ',': 'comma', '!': 'exclam', '?': 'question', "'": 'quotesingle', '-': 'hyphen',
    ':': 'colon', ';': 'semicolon', '"': 'quotedbl', '(': 'parenleft', ')': 'parenright', '/': 'slash',
    '&': 'ampersand', '+': 'plus', '=': 'equal', '*': 'asterisk', '#': 'numbersign', '%': 'percent', '@': 'at',
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
    '8': 'eight', '9': 'nine', '–': 'endash', '—': 'emdash', '‘': 'quoteleft', '’': 'quoteright',
    '“': 'quotedblleft', '”': 'quotedblright', '$': 'dollar', '\u20AB': 'dong', '\u20AC': 'Euro',
    '\u00A9': 'copyright', '\u2026': 'ellipsis', '\u00B0': 'degree', '[': 'bracketleft', ']': 'bracketright',
    '{': 'braceleft', '}': 'braceright', '<': 'less', '>': 'greater', '|': 'bar', '\\': 'backslash',
    '^': 'asciicircum', '_': 'underscore', '`': 'grave', '~': 'asciitilde' };
  function glyphName(L) {
    if (AGL[L]) return AGL[L];
    if (/^[A-Z]$/.test(L)) return L;
    var cps = Array.from(L).map(function (c) { return c.codePointAt(0); });
    return cps.length === 1 ? 'uni' + ('0000' + cps[0].toString(16).toUpperCase()).slice(-4) : 'u_' + cps.map(function (c) { return c.toString(16); }).join('_');
  }
  // The OTF uses the same metrics as the preview: baseline on the measured
  // ink bottom, caps scaled to 700/1000, ascender sized for Vietnamese stacks.
  // Lowercase input maps onto the caps; combining marks are zero-width so
  // decomposed text still lands its accents; kerning goes into a GPOS table.
  function buildOtf() {
    var UPM = 1000, SC = UPM / MET.em;
    var tx = function (x) { return Math.round(x * SC); }, ty = function (y) { return Math.round((MET.base - y) * SC); };
    // cubic outlines, the same curves the preview draws
    function pathOf(rings, dx) {
      var path = new opentype.Path();
      rings.forEach(function (r) {
        var segs = BlobEngine.ringToCubics(r);
        path.moveTo(tx(segs[0][0][0] + dx), ty(segs[0][0][1]));
        segs.forEach(function (c) {
          path.curveTo(tx(c[1][0] + dx), ty(c[1][1]), tx(c[2][0] + dx), ty(c[2][1]), tx(c[3][0] + dx), ty(c[3][1]));
        });
        path.close();
      });
      return path;
    }
    // CFF wants outer contours counter-clockwise in y-up space, which is
    // clockwise here (y down); the engine already winds shells and holes
    // oppositely, so flip the whole set if the biggest shell is wrong.
    function orient(rings) {
      if (!rings.length) return rings;
      var big = rings.reduce(function (a, r) { return Math.abs(BlobEngine.signedArea(r)) > Math.abs(BlobEngine.signedArea(a)) ? r : a; });
      return BlobEngine.signedArea(big) < 0 ? rings : rings.map(function (r) { return r.slice().reverse(); });
    }
    var nd = new opentype.Path(), w = Math.round(UPM * 0.5), hcap = Math.round(UPM * CAP_EM);
    nd.moveTo(50, 0); nd.lineTo(50, hcap); nd.lineTo(w - 50, hcap); nd.lineTo(w - 50, 0); nd.close();
    nd.moveTo(100, 50); nd.lineTo(w - 100, 50); nd.lineTo(w - 100, hcap - 50); nd.lineTo(100, hcap - 50); nd.close();
    var glyphs = [
      new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: w, path: nd }),
      new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: Math.round(WORD_EM * UPM), path: new opentype.Path() }),
    ];
    glyphs[1].addUnicode(0xA0);
    var index = {}, keys = LETTERS.concat(VIET.filter(canDraw));
    keys.forEach(function (L) {
      var s = spacingOf(L), rings = orient(ringsOf(L));
      var g = new opentype.Glyph({
        name: glyphName(L), unicode: L.codePointAt(0),
        advanceWidth: Math.max(0, Math.round(s.adv * SC)), path: pathOf(rings, s.lsb - s.x0),
        leftSideBearing: Math.round(s.lsb * SC),
      });
      var lower = L.toLowerCase();
      if (lower !== L && Array.from(lower).length === 1) g.addUnicode(lower.codePointAt(0));
      index[L] = glyphs.length;
      glyphs.push(g);
    });
    // zero-width combining marks, drawn left of the origin over a cap O. Their
    // anchor is the point on that O where they attach (its ink centre on the
    // cap line, or on the baseline for the dot below); every letter gets the
    // same two anchors at its own ink centre, so GPOS mark-to-base lands an
    // accent on any letter — even sequences with no precomposed glyph (Q̃).
    var o = spacingOf('O'), oPlain = GC.bbox(ringsOf('O')) || [0, 0, GW, GH];
    var oDx = o.lsb - o.x0 - o.adv, markSpec = { classes: { top: [], bottom: [] }, bases: [] }, gdefCls = {};
    MARK_KEYS.forEach(function (m) {
      var pl = markPlacement(m), rings = orient(GC.shift(ringsOf(m), pl.ox, pl.oy));
      var g = new opentype.Glyph({ name: glyphName(m), unicode: m.codePointAt(0), advanceWidth: 0,
        path: pathOf(rings, oDx) });
      var zone = GC.MARKS[m].zone, gidM = glyphs.length;
      if (zone === 'top' || zone === 'bottom') {
        markSpec.classes[zone].push([gidM, tx((oPlain[0] + oPlain[2]) / 2 + oDx), ty(zone === 'top' ? MET.cap : MET.base)]);
        gdefCls[gidM] = 3;
      }
      glyphs.push(g);
    });
    LETTERS.forEach(function (L) {
      if (!ALNUM.test(L)) return;
      var sp = spacingOf(L), pb = GC.bbox(ringsOf(L));
      if (!pb) return;
      var cx = tx((pb[0] + pb[2]) / 2 + sp.lsb - sp.x0);
      markSpec.bases.push([index[L], { top: [cx, ty(MET.cap)], bottom: [cx, ty(MET.base)] }]);
    });
    keys.forEach(function (L) { gdefCls[index[L]] = 1; });
    var family = (state.fontName || 'Untitled').trim() || 'Untitled';
    // the PostScript / CFF name must be printable ASCII without ()[]{}<>/%
    // and spaces, or browsers' font sanitiser rejects the whole file
    var psName = family.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0110/g, 'D').replace(/\u0111/g, 'd')
      .replace(/[^!-~]|[\[\](){}<>\/%]/g, '').slice(0, 54) || 'Untitled';
    var font = new opentype.Font({
      familyName: family, styleName: 'Regular', unitsPerEm: UPM, postScriptName: psName + '-Regular',
      ascender: Math.round(UPM * ASC_EM), descender: -Math.round(UPM * DESC_EM),
      designer: 'Made with Liquid.Font', manufacturer: 'Liquid.Font',
      description: 'Generative liquid display caps with Vietnamese. Flow state: ' + state.preset + '.',
      copyright: '© ' + new Date().getFullYear() + ' ' + family,
      version: '1.000',
      glyphs: glyphs,
    });
    var pairs = [];
    keys.forEach(function (a) {
      keys.forEach(function (b) {
        var v = Math.round(kernOf(a, b) * SC);
        if (state.kernOv[a + '\u0000' + b] != null && v) { pairs.push([index[a], index[b], v]); return; }
        if (Math.abs(v) >= 8) pairs.push([index[a], index[b], v]);   // under 0.8% em is invisible
      });
    });
    // drop the name records opentype.js would otherwise fill with a blank
    ['designerURL', 'manufacturerURL', 'license', 'licenseURL', 'trademark'].forEach(function (k) { delete font.names[k]; });
    var buf = font.toArrayBuffer(), extra = {};
    var gpos = FontTables.gpos({ kern: pairs, marks: markSpec }), gdef = FontTables.gdef(gdefCls);
    // hmtx: opentype.js 1.3.4 ignores leftSideBearing, so write xMin per glyph
    var hmtx = FontTables.readTable(buf, 'hmtx'), hhea = FontTables.readTable(buf, 'hhea');
    if (hmtx && hhea) {
      var hd = new DataView(hmtx.buffer, hmtx.byteOffset, hmtx.byteLength);
      var nh = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34);
      glyphs.forEach(function (g, i) {
        var bb = g.path.commands.length ? g.getBoundingBox() : null, lsb = bb ? Math.round(bb.x1) : 0;
        var at = i < nh ? i * 4 + 2 : nh * 4 + (i - nh) * 2;
        if (at + 2 <= hmtx.length) hd.setInt16(at, lsb);
      });
      extra.hmtx = hmtx;
    }
    if (gpos) extra.GPOS = gpos;
    if (gdef) extra.GDEF = gdef;
    // OS/2 v4 with USE_TYPO_METRICS, so every platform lays lines out from
    // the measured ascender/descender (which cover the Vietnamese stacks)
    var os2 = FontTables.readTable(buf, 'OS/2');
    if (os2 && os2.length >= 96) {
      var od = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
      if (od.getUint16(0) < 4) od.setUint16(0, 4);
      od.setUint16(62, od.getUint16(62) | 0x80);
      od.setInt16(72, 0);   // sTypoLineGap
      od.setUint32(78, od.getUint32(78) | 1 | (1 << 8));   // code pages: Latin 1 + Vietnamese (1258)
      extra['OS/2'] = os2;
    }
    buf = FontTables.injectTables(buf, extra);
    dl(new Blob([buf], { type: 'font/otf' }), safeName() + '.otf');
    return glyphs.length;
  }

  // -------------------------------------------------------------------- boot
  var restored = false;
  try {
    var saved = localStorage.getItem(STORE_KEY);
    if (saved) { applyProject(JSON.parse(saved)); restored = true; }
  } catch (e) { console.warn('could not restore the saved project', e); }
  $('fontNameInput').value = state.fontName;
  syncShape();
  refreshDefs();
  renderTesters();
  renderGlyphSet();
  fitEditor();
  renderEditor();
  updateCoverage();
  $('saveState').textContent = restored ? 'Restored from browser' : 'Autosaves in this browser';
})();
