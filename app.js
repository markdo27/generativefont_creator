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
  // flow and drip have sliders; warp, neck, sag, dripForm and stretch are the
  // Flow preset's own liquid physics and travel with the project
  var SHAPE_KEYS = ['mass', 'melt', 'tension', 'wobble', 'grain', 'smooth', 'res',
    'flow', 'warp', 'neck', 'sag', 'drip', 'dripForm', 'stretch'];

  // preview inks, a tonal ramp; black flips the previews to paper
  var PALETTE = ['#ffffff', '#c4c4c4', '#8a8a8a', '#000000'];

  // Vertical metrics, as fractions of the em. Caps fill 70% of it; above them
  // is room for Vietnamese stacked marks (Ẩ Ẫ Ặ climb ~0.4em over the caps),
  // below for the dot below and the comma tail. Sizes everywhere — preview
  // px, OTF units — are em sizes, exactly like any installed font. The
  // ascender and descender are re-measured from the ink (measureStacks).
  var CAP_EM = 0.70;
  function wordEm() { return 0.18 + 0.0086 * state.spacing; }   // 0.24em at the default Spacing
  var ASC_EM = 1.02, DESC_EM = 0.25;

  var LETTERS = Object.keys(BASE).filter(function (k) { return !isMark(k); });
  var MARK_KEYS = GC.MARK_ORDER.filter(function (k) { return BASE[k]; });
  var VIET = GC.vietnameseUpper();
  // every other Latin capital the mark skeletons can build (Ä Ç Č Ñ Ž …)
  var LATIN = GC.latinUpper(function (k) { return !!BASE[k]; });
  var ALNUM = /^[A-Z0-9]$/;
  // letters drawn as their own skeletons beyond A–Z (Æ Ø Œ) join the caps
  var OWN_CAPS = LETTERS.filter(function (k) { return !ALNUM.test(k) && /^\p{Lu}$/u.test(k); });
  var SETS = [
    ['Uppercase', Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').concat(OWN_CAPS)],
    ['Numerals', Array.from('0123456789')],
    ['Punctuation', LETTERS.filter(function (k) { return !ALNUM.test(k) && OWN_CAPS.indexOf(k) < 0; })],
    ['Vietnamese', VIET],
    ['Latin', LATIN],
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
    return [s.mass, s.melt, s.tension, s.wobble, s.grain, s.smooth, s.res,
      s.flow, s.warp, s.neck, s.sag, s.drip, s.dripForm, s.stretch, s.seed, s.draft ? 'd' : '',
      L.scale, L.gapTop, L.gapStack, L.gapBottom].join('|');
  }
  function verOf(L) { return (isMark(L) ? 0 : globalVer) + '.' + letterVer[L]; }
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function hasKey(k) { return own(FLAT, k); }

  // Per-glyph shape tuning from the glyph data (tune: {M: {melt: 0.6}}):
  // letters with narrow counters (M W # @ 8) take less melt, so the heavy
  // flow states don't clot them while every other letter keeps the full pour.
  var TUNE = GLYPH_DATA.tune || {};
  function meltFor(key) {
    var t = Object.prototype.hasOwnProperty.call(TUNE, key) && TUNE[key];
    return state.melt * (t && t.melt > 0 ? t.melt : 1);
  }
  // Drips hang only from letters and figures: never from a mark, a dot or
  // punctuation, nor from a letter carrying a mark below it (noDrip), whose
  // dot or cedilla would land in the drip.
  function dripsFor(key, noDrip) {
    return noDrip || !(ALNUM.test(key) || OWN_CAPS.indexOf(key) >= 0) ? 0 : state.drip;
  }
  // Each traced ring set remembers its drip-free foot (the ink bottom with
  // drips left out), so drips never move the measured baseline.
  var FOOT = typeof WeakMap === 'function' ? new WeakMap() : null;
  function footOf(rings) {
    var f = FOOT && FOOT.get(rings), b = GC.bbox(rings);
    return f != null ? f : (b ? b[3] : null);
  }
  function traceChains(chains, key, tag, noDrip) {
    var k = 't|' + key + '|' + tag + (noDrip ? '|nd' : '');
    if (cache[k]) return cache[k];
    var r;
    try {
      var t = BlobEngine.glyphTrace(GC.markChains(key, chains), GC.traceOpts(key, {
        mass: state.mass, melt: meltFor(key), tension: state.tension, wobble: state.wobble,
        grain: state.grain, smooth: state.smooth, simplify: 0.3,
        flow: state.flow, warp: state.warp, neck: state.neck, sag: state.sag,
        drip: dripsFor(key, noDrip), dripForm: state.dripForm, stretch: state.stretch,
        // while a slider is being dragged, trace coarser and refine on release
        res: state.draft ? state.res * 1.7 : state.res,
        seed: state.seed + key.charCodeAt(0) * 13,
      }));
      r = t.rings;
      if (FOOT && t.foot != null) FOOT.set(r, t.foot);
    } catch (e) { console.error('glyph failed', key, e); r = []; }
    return remember(k, r);
  }
  function compositeOf(L) {
    var p = GC.plan(L, hasKey);
    if (!p || p.simple) return null;
    var tag = shapeKey() + '@' + [p.base].concat(p.fused, p.top, p.bottom).map(verOf).join(',');
    var k = 'c|' + L + '|' + tag;
    if (cache[k]) return cache[k];
    var below = p.bottom.length > 0;   // a dot below / cedilla: the base must not drip into it
    return remember(k, GC.compose(L, {
      rings: function (key) {
        return below && key === p.base && FLAT[key] ? traceChains(chainsOf(key), key, shapeKey() + '@' + verOf(key), true) : ringsOf(key);
      },
      chains: chainsOf, lines: function () { return { cap: MET.cap, foot: MET.base }; },
      trace: function (ch, key) { return traceChains(ch, key, tag, below); },
    }, hasKey));
  }
  function ringsOf(L) {
    if (FLAT[L]) return traceChains(chainsOf(L), L, shapeKey() + '@' + verOf(L));
    var c = compositeOf(L);
    return c ? c.rings : [];
  }
  function canDraw(L) { return (hasKey(L) && !isMark(L)) || !!GC.plan(L, hasKey); }
  // the letter an accented glyph is built on (Ấ -> A, Ơ -> O); itself otherwise
  function baseOf(L) { var p = !hasKey(L) && GC.plan(L, hasKey); return p ? p.base : L; }
  // path strings are cached per traced ring set (rings are immutable once
  // traced), so a spacing-only change rebuilds no geometry text at all
  var dCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function ringsToD(rings) {
    if (state.draft) return ringsToPoly(rings);   // live slider/global drag: plain polylines, curves on release
    var hit = dCache && dCache.get(rings);
    if (hit !== undefined) return hit;
    var d = ringsToDRaw(rings);
    if (dCache) dCache.set(rings, d);
    return d;
  }
  function ringsToPoly(rings) {
    var d = '';
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      d += 'M' + r[0][0].toFixed(1) + ',' + r[0][1].toFixed(1);
      for (var j = 1; j < r.length; j++) d += 'L' + r[j][0].toFixed(1) + ',' + r[j][1].toFixed(1);
      d += 'Z';
    }
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
  var GIDS = Object.create(null);
  function gid(L) {
    return GIDS[L] || (GIDS[L] = 'g' + Array.from(L).map(function (c) { return c.codePointAt(0).toString(16); }).join('_'));
  }

  // ---------------------------------------------------------------- metrics
  // Baseline and cap height are measured from the rendered ink, not taken
  // from the skeleton frame: a heavier Mass or a looser Tension moves the
  // ink edge, and the font has to sit on that edge.
  var MET = { base: 110, cap: -9, capH: 119, em: 170 };
  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }
  function measureMetrics() {
    var bot = [], top = [];
    Array.from('HIELNMKTFZ').forEach(function (L) { var f = FLAT[L] && footOf(ringsOf(L)); if (f != null && f !== false) bot.push(f); });
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
    VIET.concat(LATIN).forEach(function (V) { var c = compositeOf(V); if (c) take(c.rings); });   // cedilla/ogonek letters too
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
    // a composite is spaced from its letter (plain or fused): floating
    // accents may overhang, the kerning floor keeps them off neighbours
    var comp = !FLAT[L] && compositeOf(L);
    var bb = GC.bbox(comp ? comp.baseRings : rings) || [0, MET.cap, MET.capH * 0.3, MET.base];
    var pr = profileOf(rings, fr);
    // average white depth per side over the cap band; a side that is open
    // for most of its height (L's right, T's) may go past the usual cap
    var dmax = 0.30 * MET.capH, dl = 0, dr = 0, n = 0;
    for (var i = 0; i < ROWS; i++) {
      var y = fr.y0 + (i + 0.5) * fr.st;
      if (y < fr.c0 || y > fr.c1 || !isFinite(pr.lo[i])) continue;
      dl += Math.min(pr.lo[i] - bb[0], 1.4 * dmax); dr += Math.min(bb[2] - pr.hi[i], 1.4 * dmax); n++;
    }
    dl = n ? dl / n / dmax : 0; dr = n ? dr / n / dmax : 0;
    var sp = state.spacing * MET.capH / 100, k = 1;
    var lsb = sp * (1 - k * dl), rsb = sp * (1 - k * dr);
    var adj = own(state.metrics, L) && state.metrics[L];
    if (adj) { lsb += adj[0]; rsb += adj[1]; }
    var full = comp ? GC.bbox(rings) : bb;   // top: how high its ink reaches, marks included
    return (SPC[L] = { x0: bb[0], x1: bb[2], lsb: lsb, rsb: rsb, adv: lsb + bb[2] - bb[0] + rsb, lo: pr.lo, hi: pr.hi, top: full ? full[1] : MET.cap });
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
    if (own(state.kernOv, key)) return state.kernOv[key];   // a designer's own value wins
    // ...and reaches Á Ấ Ạ when set on A: the most specific override wins
    var ba = baseOf(a), bb2 = baseOf(b), tries = [a + '\u0000' + bb2, ba + '\u0000' + b, ba + '\u0000' + bb2];
    for (var ti = 0; ti < tries.length; ti++) if (tries[ti] !== key && own(state.kernOv, tries[ti])) return state.kernOv[tries[ti]];
    if (!(state.kern > 0)) return 0;
    if (key in KERN) return KERN[key];
    if (KBASE == null) {
      var h = spacingOf('H');
      KBASE = Math.max(1, h.lsb + h.rsb);
      KOVER = interaction(h, h).over;   // H|H is the zero point: only extra shared white counts
    }
    var A = spacingOf(a), B = spacingOf(b), it = interaction(A, B), v = 0;
    if (isFinite(it.minG)) {
      v = -(it.nest + 0.5 * Math.max(0, it.over - KOVER)) * state.kern;
      v = Math.max(v, -0.45 * MET.capH, -0.85 * Math.min(A.adv, B.adv));   // never tuck a whole glyph under
      v = Math.min(v, 0.25 * KBASE);
      v = Math.max(v, 0.4 * KBASE - it.minG);   // the ink floor always wins (Ấ|Ầ: two side tones meeting)
    }
    if (Math.abs(v) < 0.6) v = 0;
    return (KERN[key] = v);
  }
  // the nearest-ink test looks ±10% of the cap height up and down, so a
  // period tucked beside the low bar of a 4 is still seen as close
  function dilate(prof, k, hiSide) {
    var out = [];
    for (var i = 0; i < ROWS; i++) {
      var v = hiSide ? -Infinity : Infinity;
      for (var j = Math.max(0, i - k); j <= Math.min(ROWS - 1, i + k); j++) {
        if (hiSide ? prof[j] > v : prof[j] < v) v = prof[j];
      }
      out.push(v);
    }
    return out;
  }
  function interaction(A, B) {
    var fr = rowFrame(), cap = 0.3 * MET.capH;
    var minG = Infinity, over = 0, n = 0, k = Math.max(1, Math.round(0.1 * MET.capH / fr.st));
    if (!A.hiD) A.hiD = dilate(A.hi, k, true);
    if (!B.loD) B.loD = dilate(B.lo, k, false);
    for (var i = 0; i < ROWS; i++) {
      var ha = isFinite(A.hi[i]), hb = isFinite(B.lo[i]);
      if (isFinite(A.hiD[i]) && isFinite(B.loD[i])) {
        var g = (A.x1 - A.hiD[i]) + A.rsb + B.lsb + (B.loD[i] - B.x0);
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
  // a block's id is stable for the session: undo snapshots carry it, so a
  // block that comes back is the same block (and keeps its caret) — never
  // "whichever block now sits in that position"
  var uid = 0;
  // Preview caps, one set for everything: typing stops at BLOCK_MAX a block
  // and TEXT_BUDGET in all; Add block and the proofs may put their short
  // fixed strings on top, up to FIXED_SLACK more, and at most MAX_BLOCKS
  // blocks. A project file (and the autosave) keeps exactly that much, so
  // whatever you can make here comes back whole after a reload.
  var BLOCK_MAX = 5000, TEXT_BUDGET = 20000, FIXED_SLACK = 2000, MAX_BLOCKS = 40;
  function previewChars(but) {
    var n = 0;
    state.blocks.forEach(function (x) { if (x !== but) n += x.text.length; });
    return n;
  }
  // room for n more blocks holding `chars` characters of fixed text
  function roomFor(n, chars) {
    if (state.blocks.length + n > MAX_BLOCKS) { toast('That makes more than ' + MAX_BLOCKS + ' preview blocks — remove one first', 3200); return false; }
    if (previewChars() + chars > TEXT_BUDGET + FIXED_SLACK) { toast('Preview text is full — shorten a block first', 3200); return false; }
    return true;
  }
  function block(text, size, lh, tr, paper, id) {
    if (id > uid) uid = id;
    return { id: id > 0 ? id : ++uid, text: text, size: size, lh: lh, tr: tr, paper: !!paper };
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
  function markHost(m) { return m === '\u0335' ? 'D' : 'O'; }
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
    if (m === undefined) {
      m = state.draft ? ringsToPoly(c.rings.slice(c.baseCount)) : ringsToDRaw(c.rings.slice(c.baseCount));
      if (markD && !state.draft) markD.set(c, m);
    }
    out.push([gid(L), '<g id="' + gid(L) + '"><use href="#' + gid(c.baseKey) + '"/><path d="' + m + '" fill-rule="nonzero"/></g>']);
  }
  function refreshDefs() {
    SPC = {}; KERN = {}; KBASE = null; fusedDefs = {};
    measureMetrics();
    if (!state.draft) measureStacks();   // ascender/descender settle on release
    var list = [];
    MARK_KEYS.concat(LETTERS, VIET, Object.keys(extraKeys)).forEach(function (L) { defEntries(L, list); });
    // the wider Latin set follows a beat later while a slider is moving
    LATIN.forEach(function (L) {
      var id = gid(L);
      if (state.draft && lastDefs[id]) list.push([id, lastDefs[id]]);
      else defEntries(L, list);
    });
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
    if (extraKeys[L] || LETTERS.indexOf(L) >= 0 || VIET.indexOf(L) >= 0 || LATIN.indexOf(L) >= 0) return;
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

  // ------------------------------------------------------------ text layout
  // One layout serves the live previews (glyphs, caret, selection) and the
  // SVG / PNG specimen, so what is typed, what is shown and what is exported
  // always agree. Text is split into clusters — a base character with its
  // combining marks — which are also the caret's steps.
  // Whitespace: every space or tab is one word space and nothing collapses
  // (two spaces show as two); '\n' is a hard line break. Lines wrap between
  // words; the space where a line wraps hangs past the right edge (it takes
  // no room) and the next line starts with the next word. More spaces than
  // that wrap with it, as CSS break-spaces does: a run of spaces typed at
  // the edge, or a line of nothing but spaces, flows on to the next line,
  // so every space still moves the caret. A word wider than
  // the column shrinks the block to fit (down to 8px); one still too wide
  // at that size breaks between letters. Tracking goes between neighbouring
  // glyphs of a word, kerning between two drawn ones; a character the font
  // can't draw yet is a dashed box (one box for a whole emoji, flag or ZWJ
  // sequence, which is also one caret step).
  var TOKEN_RE = /\n|[^\S\n]|\P{M}\p{M}*|\p{M}+/gu, NOTDEF_EM = 0.42;
  var SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  // text the mark-based split can get wrong: ZWJ, astral planes, scripts with conjuncts
  var COMPLEX_RE = /[\u200c\u200d]|[^\u0000-\u024f\u0300-\u036f\u1e00-\u1eff\u2010-\u205f\u20a0-\u20bf]/;
  // start offsets of the grapheme clusters, or null when they are the
  // mark-based clusters anyway
  function graphemeStarts(text) {
    if (!SEG || !COMPLEX_RE.test(text)) return null;
    var out = Object.create(null);
    for (var seg of SEG.segment(text)) out[seg.index] = 1;
    return out;
  }
  function newLine() { return { items: [], glyphs: [], w: 0, br: null }; }
  var CLUSTERS = Object.create(null), nClusters = 0;
  function cacheClusters(s) {
    if (++nClusters > 4000) { CLUSTERS = Object.create(null); nClusters = 0; }
    return (CLUSTERS[s] = GC.clusters(s));
  }
  function layoutText(text, size, tr, maxW, fit) {
    var toks = [], m, i, j, t, wd = null, widest = 0, em = MET.em;
    // pass 1: tokens, and every word measured in em (size-free, so a fit is exact)
    var gb = graphemeStarts(text);
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      var s = m[0], kind = s === '\n' ? 'br' : /^\s$/.test(s) ? 'sp' : 'g';
      if (gb && kind === 'g' && !gb[m.index] && t && t.t === 'g' && t.o1 === m.index) t.o1 += s.length;   // the rest of a grapheme
      else {
        t = { t: kind, o0: m.index, o1: m.index + s.length, x0: 0, x1: 0 };
        toks.push(t);
        if (kind !== 'g') { wd = null; continue; }
        if (!wd) wd = { i0: toks.length - 1, w: 0, prev: null, n: 0 };
        t.word = wd; t.gl = [];
      }
      var Ls = CLUSTERS[s] || cacheClusters(s);   // usually one; ß gives S S
      for (j = 0; j < Ls.length; j++) {
        var L = Ls[j], draw = canDraw(L), g;
        if (!draw && t.gl.length && t.gl[t.gl.length - 1].notdef) continue;   // one box per grapheme
        if (wd.n) wd.w += tr + (draw && wd.prev ? kernOf(wd.prev, L) / em : 0);
        g = draw ? { L: L, e: wd.w, s: spacingOf(L) } : { notdef: true, e: wd.w };
        wd.w += draw ? g.s.adv / em : NOTDEF_EM;
        wd.prev = draw ? L : null; wd.n++;
        t.gl.push(g);
      }
      t.e1 = wd.w;
      if (wd.w > widest) widest = wd.w;
    }
    // on a narrow column a big word can be wider than the block: shrink the
    // rendering (not the setting) so the longest word still fits
    if (fit && maxW > 0 && widest * size > maxW) size = Math.max(8, Math.floor(maxW / widest));
    // pass 2: place in px, wrapping between words
    var k = size / em, spW = (wordEm() + tr) * size, lines = [], line = newLine(), x = 0, hasWord = false, wx = 0;
    for (i = 0; i < toks.length; i++) {
      t = toks[i];
      if (t.t === 'br') {
        t.x0 = t.x1 = x; line.items.push(t); line.br = t;
        lines.push(line); line = newLine(); x = 0; hasWord = false;
        continue;
      }
      if (t.t === 'sp') {
        // a space that would start past the edge goes to the next line
        if (x >= maxW && line.items.length) { lines.push(line); line = newLine(); x = 0; hasWord = false; }
        t.x0 = x; x += spW; t.x1 = x; line.items.push(t); continue;
      }
      wd = t.word;
      if (wd.i0 === i) {
        // a word that doesn't fit after what is on the line (words, or the
        // spaces that open it) starts the next one
        if ((hasWord || x > 0) && x + wd.w * size > maxW) { lines.push(line); line = newLine(); x = 0; }
        hasWord = true; wx = x;
        wd.brk = wd.w * size > maxW;   // too wide even at the fitted size: breaks between letters
      } else if (wd.brk && wx + t.e1 * size > maxW && line.glyphs.length) {
        lines.push(line); line = newLine(); wx = -t.gl[0].e * size;
      }
      x = wx + (wd.brk ? t.e1 : wd.w) * size; line.w = x;
      for (j = 0; j < t.gl.length; j++) {
        var q = t.gl[j], gx = wx + q.e * size;
        line.glyphs.push(q.notdef ? { notdef: true, x: gx, w: NOTDEF_EM * size } : { L: q.L, x: gx, s: q.s });
      }
      t.x0 = wx + t.gl[0].e * size; t.x1 = wx + t.e1 * size;
      line.items.push(t);
    }
    lines.push(line);
    // caret stops: every cluster boundary, each on exactly one line, at the
    // middle of the kerning/tracking gap between its two neighbours
    var pos = new Array(text.length + 1), stops = [];
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i], it = ln.items;
      ln.stops = [];
      for (j = 0; j < it.length; j++) ln.stops.push([it[j].o0, j ? (it[j - 1].x1 + it[j].x0) / 2 : it[j].x0]);
      ln.end = ln.br ? ln.br.x0 : it.length ? it[it.length - 1].x1 : 0;
      if (i === lines.length - 1) ln.stops.push([text.length, ln.end]);
      ln.o0 = ln.stops[0][0];
      for (j = 0; j < ln.stops.length; j++) { pos[ln.stops[j][0]] = [i, ln.stops[j][1]]; stops.push(ln.stops[j][0]); }
    }
    for (i = 0; i < lines.length; i++) lines[i].o1 = i + 1 < lines.length ? lines[i + 1].o0 : text.length;
    return { text: text, size: size, k: k, maxW: maxW, lines: lines, toks: toks, stops: stops, pos: pos };
  }
  // index of the last entry <= o in an ascending list (0 when none is)
  function lowerIdx(arr, o, key) {
    var lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1, v = key ? arr[mid][key] : arr[mid];
      if (v <= o) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // --------------------------------------------------------- tester blocks
  var resizeT = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      // back from the phone layout (where the page itself scrolls) to the
      // desktop one (where it can't): a page scroll left over would hide the app
      var se = document.scrollingElement;
      if (se && se.scrollTop && getComputedStyle(document.documentElement).overflowY === 'hidden') se.scrollTop = 0;
      repaintAllTesters();   // lines re-wrap to the new column
    }, 160);
  });
  var activeEd = null;   // the preview whose text has focus
  // The list is reconciled by block, not rebuilt: a block that is still
  // there keeps its DOM (and, if you are typing in it, its focus), new
  // blocks are built, removed ones dropped. Nothing ever goes by position,
  // so an undo that puts a block back can't hand your caret to its
  // neighbour.
  function renderTesters(focusBlock, mode) {
    var scroller = $('specimenScroll'), keep = scroller.scrollTop;
    // the textarea still shows the text from before this render (an undo
    // may already have changed the block), so that is what the caret is in
    var was = activeEd && activeEd.root.parentNode === testerList ? activeEd : null, wasSel = null, wasText = '';
    if (was) { wasText = was.ta.value; wasSel = [was.ta.selectionStart, was.ta.selectionEnd, was.ta.selectionDirection]; }
    var old = {}, kids = Array.prototype.slice.call(testerList.children);
    kids.forEach(function (r) { if (r.liquidEd) old[r.liquidEd.b.id] = r; });
    var next = state.blocks.map(function (b) {
      var r = old[b.id];
      if (r && r.liquidEd.b === b) { delete old[b.id]; r.liquidSync(); return r; }
      return buildTester(b);
    });
    // drop what is gone first, so the blocks that stay are never moved
    // (moving the focused one would blur it)
    kids.forEach(function (r) { if (next.indexOf(r) < 0) testerList.removeChild(r); });
    next.forEach(function (r, i) { if (testerList.children[i] !== r) testerList.insertBefore(r, testerList.children[i] || null); });
    var landing = null, lost = false;
    if (was && was.root.parentNode !== testerList) {
      // the block you were typing in went away (an undo took it back): focus
      // lands on the nearest block that is still there — the block itself,
      // not its text, so the next key edits nothing — and never on <body>,
      // where the keyboard would lose its place
      var at = kids.indexOf(was.root);
      for (var d = 1; !landing && d < kids.length; d++) {
        [kids[at + d], kids[at - d]].forEach(function (r) { if (!landing && r && r.parentNode === testerList) landing = r; });
      }
      activeEd = null; was = null; lost = true;
    }
    if (!state.blocks.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No preview blocks. Add one below to type with your font.';
      testerList.appendChild(empty);
    }
    labelTesters();
    repaintAllTesters();
    scroller.scrollTop = keep;   // rebuilding the list must not jump the view
    var el, ed;
    if (focusBlock) {
      el = testerList.children[state.blocks.indexOf(focusBlock)];
      if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      ed = el.liquidEd;
      if (mode === 'type' && ed) ed.focusAt(0, ed.ta.value.length);   // a new block: typing replaces its text
      else { var del = el.querySelector('.tester-del'); if (del) del.focus({ preventScroll: true }); }
    } else if (was) {   // still the same block and element: keep (or re-place) its caret
      ed = was;
      if (ed.b.text === wasText) ed.focusAt(wasSel[0], wasSel[1], wasSel[2]);
      else { var c = changedEnd(wasText, ed.b.text); ed.focusAt(c, c); }
    } else if (lost) {   // (no block left: the Add block button)
      (landing || $('btnAddBlock')).focus({ preventScroll: true });
    }
  }
  // each preview's textarea gets its own name, so a screen reader can tell
  // the blocks apart
  function labelTesters() {
    var n = state.blocks.length;
    Array.prototype.forEach.call(testerList.children, function (r, i) {
      if (r.liquidEd) r.liquidEd.ta.setAttribute('aria-label', 'Preview text ' + (i + 1) + ' of ' + n + ', ' + Math.round(r.liquidEd.b.size) + ' px');
    });
  }
  function edOf(b) {
    for (var c = testerList.firstChild; c; c = c.nextSibling) if (c.liquidEd && c.liquidEd.b === b) return c.liquidEd;
    return null;
  }
  // new text for one block from outside its textarea (undo / redo)
  function setBlockText(b, text) {
    var ed = edOf(b), was = b.text;
    b.text = text;
    if (!ed) return;
    ed.paint();
    if (ed === activeEd) { var c = changedEnd(was, text); ed.focusAt(c, c); }
  }
  // where an edit ended: the end of what differs between two texts
  function changedEnd(a, b) {
    var p = 0, n = Math.min(a.length, b.length), q = 0;
    while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    while (q < n - p && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++;
    return b.length - q;
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
    wrap.liquidSet = function (v) { r.value = v; b.textContent = fmt(v); };   // an undo put a value back
    return wrap;
  }

  function buildTester(b) {
    var root = document.createElement('div');
    // black ink would vanish on the black specimen, so it prints on paper
    root.className = 'tester';
    root.tabIndex = -1;   // where Esc leaves you: Tab then goes to this block's controls, Enter back into its text

    var head = document.createElement('div');
    head.className = 'tester-head';

    var name = document.createElement('div');
    name.className = 'tester-name';
    name.textContent = state.fontName;
    name.dataset.role = 'name';
    head.appendChild(name);

    var cSize = ctrl('Size', 10, 480, 1, b.size, function (v) { return Math.round(v) + 'px'; },
      function (v) { b.size = v; paintText(root, b); labelTesters(); });
    var cLh = ctrl('Leading', 70, 220, 1, b.lh, function (v) { return Math.round(v) + '%'; },
      function (v) { b.lh = v; paintText(root, b); });
    var cTr = ctrl('Tracking', -0.06, 0.4, 0.005, b.tr, function (v) { return v.toFixed(3) + 'em'; },
      function (v) { b.tr = v; paintText(root, b); });
    head.appendChild(cSize); head.appendChild(cLh); head.appendChild(cTr);

    var sp = document.createElement('div'); sp.className = 'tester-spacer';
    head.appendChild(sp);

    var inv = document.createElement('button');
    inv.type = 'button';
    inv.title = 'Switch between ink on black and black on paper';
    function syncPaper() {
      root.classList.toggle('paper', b.paper || state.ink === '#000000');
      inv.className = 'mini-btn' + (b.paper ? ' on' : '');
      inv.textContent = b.paper ? 'Paper' : 'Ink';
      inv.setAttribute('aria-pressed', String(b.paper));
    }
    syncPaper();
    inv.addEventListener('click', function () {
      pushUndo();
      b.paper = !b.paper;
      syncPaper();
      paintText(root, b); markDirty();
    });
    head.appendChild(inv);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini-btn tester-del';
    del.textContent = '×';
    del.title = 'Remove this block';
    del.setAttribute('aria-label', 'Remove this preview block');
    del.addEventListener('click', function () {
      pushUndo();
      var at = state.blocks.indexOf(b);
      state.blocks = state.blocks.filter(function (x) { return x !== b; });
      renderTesters(state.blocks[Math.min(at, state.blocks.length - 1)]); markDirty();
      toast('Block removed — Ctrl/⌘ Z brings it back');
    });
    head.appendChild(del);

    root.appendChild(head);

    var body = document.createElement('div');
    body.className = 'tester-body';
    root.appendChild(body);
    makeEditor(root, body, b);   // painted once it is in the document and has a width
    // a kept block picks up what changed around it (undo, font name, ink);
    // its text follows in the repaint
    root.liquidSync = function () {
      name.textContent = state.fontName;
      cSize.liquidSet(b.size); cLh.liquidSet(b.lh); cTr.liquidSet(b.tr);
      syncPaper();
    };
    return root;
  }
  // re-layout one block (size, leading, tracking, ink changed)
  function paintText(root) {
    var ed = root.liquidEd;
    if (ed) ed.paint(ed.surface.clientWidth);
  }

  // ------------------------------------------------------ live preview text
  // Every preview is typed into directly. The glyphs are one SVG of <use>s
  // of the shared defs, laid out by layoutText; the keys go to an invisible
  // native <textarea> parked at the caret, so IME composition (Telex, VNI,
  // macOS Vietnamese, dead keys, mobile keyboards), paste, the clipboard and
  // screen readers work as in any text field, and the IME's candidate window
  // opens where you type. Caret, selection and the arrow keys follow the
  // drawn layout cluster by cluster: an accented letter is one step, and the
  // caret never lands between a letter and its marks.
  //
  // Undo is the app's, never the textarea's: each typing burst (the first
  // edit after focusing, after a pause or after moving the caret; each paste
  // or cut) is one step on the same stack as glyph edits, and Ctrl/⌘Z or
  // Edit › Undo in a preview goes to it.
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  var PLACEHOLDER = 'Type here', BURST_MS = 1000;
  function inkOf(b) { return b.paper || state.ink === '#000000' ? '#000' : state.ink; }
  // Selection and placeholder colours, worked out from the ink and the
  // ground with the WCAG contrast formula (not a fixed tint, which faded to
  // ~1.3:1 on the grey ink): the selection stands >= 3:1 off the ground and
  // the ink >= 3:1 off the selection — on a grey ink that can only be a
  // light selection under the letters — and the placeholder >= 3:1 off the
  // ground. Colours are mixed the way the browser blends them (in sRGB).
  var MIN_CONTRAST = 3.2;   // 3:1, with a margin for rounding
  function rgbOf(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
  }
  function lumOf(c) {
    var f = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function contrastOf(a, b) { var x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mixOf(a, b, t) { return a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }); }
  function inkTones(ink, ground) {
    var I = rgbOf(ink), G = rgbOf(ground), far = lumOf(G) < 0.5 ? [255, 255, 255] : [0, 0, 0], t, best = null, bestScore = -1;
    for (t = 0.05; t <= 1.0001; t += 0.01) {   // selection: the nearest-to-ground colour that passes both
      var S = mixOf(G, far, t), score = Math.min(contrastOf(S, G), contrastOf(I, S));
      if (score >= MIN_CONTRAST) { best = S; break; }
      if (score > bestScore) { bestScore = score; best = S; }
    }
    var ph = 1;
    for (t = 0.2; t <= 1.0001; t += 0.01) if (contrastOf(mixOf(G, I, t), G) >= MIN_CONTRAST) { ph = t; break; }
    return { sel: 'rgb(' + best.join(',') + ')', ph: Math.min(1, ph).toFixed(2) };
  }
  // Room above the first line for the font's ascender (ASC_EM: its tallest
  // stacked Vietnamese capital), whatever the text — the way a line box
  // keeps a font's ascent, and the way the export lays a block out. Room
  // that came and went with the text made the block jump down at the first
  // accent typed, and back up on leaving it.
  function headroomOf(size, L, capH) { return Math.max(0, (ASC_EM + 0.02) * size - (L + capH) / 2); }
  document.addEventListener('selectionchange', function () { if (activeEd) activeEd.syncSel(); });

  function makeEditor(root, body, b) {
    var surface = document.createElement('div');
    surface.className = 'tester-text';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tester-glyphs');
    svg.setAttribute('aria-hidden', 'true');
    var selG = document.createElementNS(NS, 'g');
    selG.setAttribute('class', 'tester-sel');
    var inkG = document.createElementNS(NS, 'g');
    inkG.setAttribute('class', 'tester-ink');
    inkG.setAttribute('fill', 'currentColor');
    svg.appendChild(selG); svg.appendChild(inkG);
    var caret = document.createElement('span');
    caret.className = 'tester-caret';
    caret.setAttribute('aria-hidden', 'true');
    var ta = document.createElement('textarea');
    ta.className = 'tester-input';
    ta.value = b.text;
    ta.rows = 1;
    ta.maxLength = BLOCK_MAX;   // the same cap a project file gets (narrowed to what the budget leaves on focus)
    ta.setAttribute('aria-label', 'Preview text');
    ta.setAttribute('placeholder', PLACEHOLDER);
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('wrap', 'off');
    ta.setAttribute('data-gramm', 'false');   // grammar extensions stay out of it
    surface.appendChild(svg); surface.appendChild(caret); surface.appendChild(ta);
    body.appendChild(surface);

    var ed = {
      b: b, root: root, surface: surface, ta: ta, lay: null, maxW: 0, L: 0, capH: 0, padTop: 0,
      focused: false, composing: false, compStart: 0, compLen: 0, burst: false, moved: false, lastEdit: 0,
      goalX: null, sel: null, lastF: 0, raf: 0, needPaint: false, wantScroll: false, placing: false, winBlur: false,
      flip: false, caretKey: '', selKey: '', missT: 0, ctx: null, ink: '',
    };
    root.liquidEd = ed;

    // ---- drawing
    function baseline(li) { return ed.padTop + li * ed.L + (ed.L + ed.capH) / 2; }
    // One <g> per drawn line, its glyphs in line-local coordinates, so a
    // line that didn't change keeps its nodes and only moves: typing redraws
    // the line under the caret, not the whole block.
    function lineMarkup(gl, lay, by) {
      var out = '', k = lay.k, sz = lay.size, capH = CAP_EM * sz, tail = ') scale(' + k.toFixed(5) + ')"/>';
      var ty = (by - MET.base * k).toFixed(2);
      for (var j = 0; j < gl.length; j++) {
        var g = gl[j];
        if (g.notdef) {
          out += '<rect class="notdef" fill="none" x="' + (g.x + g.w * 0.1).toFixed(1) + '" y="' + (by - capH).toFixed(1) +
            '" width="' + (g.w * 0.8).toFixed(1) + '" height="' + capH.toFixed(1) + '" rx="' + (0.04 * sz).toFixed(1) + '"/>';
          continue;
        }
        if (!FLAT[g.L]) ensureDef(g.L);
        out += '<use href="#' + gid(g.L) + '" transform="translate(' + (g.x - (g.s.x0 - g.s.lsb) * k).toFixed(2) + ' ' + ty + tail;
      }
      return out;
    }
    function renderInk(lay) {
      var by = (ed.L + ed.capH) / 2, pool = {}, next = [], i, c, m;
      for (c = inkG.firstChild; c; c = c.nextSibling) (pool[c.liquidM] || (pool[c.liquidM] = [])).push(c);
      for (i = 0; i < lay.lines.length; i++) {
        m = lineMarkup(lay.lines[i].glyphs, lay, by);
        c = pool[m] && pool[m].pop();
        if (!c) { c = document.createElementNS(NS, 'g'); c.innerHTML = m; c.liquidM = m; }
        var y = (ed.padTop + i * ed.L).toFixed(1);
        if (c.liquidY !== y) { c.liquidY = y; c.setAttribute('transform', 'translate(0 ' + y + ')'); }
        next.push(c);
      }
      for (i = 0; i < next.length; i++) if (inkG.childNodes[i] !== next[i]) inkG.insertBefore(next[i], inkG.childNodes[i] || null);
      while (inkG.childNodes.length > next.length) inkG.removeChild(inkG.lastChild);
    }
    ed.paint = function (w) {
      if (ed.raf) { cancelAnimationFrame(ed.raf); ed.raf = 0; }
      ed.needPaint = false;
      if (w !== undefined) ed.maxW = w;
      var maxW = ed.maxW > 0 ? ed.maxW : (testerList.clientWidth > 100 ? testerList.clientWidth - 52 : 1000);
      if (ta.value !== b.text && !ed.composing) ta.value = b.text;   // the textarea always holds the block's text
      var text = b.text, lay = layoutText(text, b.size, b.tr, maxW, true);
      var size = lay.size, L = b.lh / 100 * size, capH = CAP_EM * size;
      ed.padTop = headroomOf(size, L, capH);
      ed.lay = lay; ed.L = L; ed.capH = capH;
      var ink = inkOf(b);
      if (ink !== ed.ink) {   // selection and placeholder stay visible on a dim ink too
        ed.ink = ink;
        surface.style.color = ink;
        var tones = inkTones(ink, ink === '#000' ? '#fff' : '#000');   // the ground: paper, or the black specimen
        surface.style.setProperty('--sel-c', tones.sel);
        surface.style.setProperty('--ph-a', tones.ph);
      }
      // an empty block keeps the height of one line
      svg.setAttribute('height', (ed.padTop + lay.lines.length * L).toFixed(1));
      var ph = null;
      if (!text) {   // a muted placeholder in the font itself, kept to the one empty line
        ph = layoutText(PLACEHOLDER, size, b.tr, Infinity, false);
        var pw = ph.lines[0].w;
        if (pw > maxW) ph = layoutText(PLACEHOLDER, Math.max(6, size * maxW / pw), b.tr, Infinity, false);
      }
      inkG.setAttribute('class', ph ? 'tester-ink is-ph' : 'tester-ink');
      renderInk(ph || lay);
      if (ed.focused && !ed.composing) snapSel();
      overlay();
    };
    function queue(repaint) {
      if (repaint) ed.needPaint = true;
      if (ed.raf) return;
      ed.raf = requestAnimationFrame(function () {
        ed.raf = 0;
        if (ed.needPaint) ed.paint(); else overlay();
      });
    }
    function current() { if (!ed.lay || ed.lay.text !== ta.value || ed.needPaint) ed.paint(); return ed.lay; }

    // offset -> [line, x] on the drawn layout (an offset inside a cluster
    // reads as the boundary before it)
    function locate(o) {
      var lay = ed.lay, p = lay.pos[o];
      if (p) return p;
      return lay.pos[lay.stops[lowerIdx(lay.stops, o)]];
    }
    // x of a boundary on line li; the end of a line's text is that line's end
    function xOn(li, o) {
      var lines = ed.lay.lines, ln = lines[li];
      return o >= ln.o1 && li < lines.length - 1 ? ln.end : locate(o)[1];
    }
    function overlay() {
      var lay = ed.lay;
      if (!lay) return;
      if (lay.text !== ta.value) { queue(true); return; }
      var s = ta.selectionStart, e = ta.selectionEnd, maxW = lay.maxW, sz = lay.size, capH = ed.capH, rects = '';
      var cl = function (x) { return Math.max(0, Math.min(maxW, x)); };
      if (ed.focused && e > s) {
        var pad = Math.max(0, Math.min(0.14 * sz, (ed.L - capH) / 2));
        for (var li = 0; li < lay.lines.length; li++) {
          var ln = lay.lines[li], a = Math.max(s, ln.o0), z = Math.min(e, ln.o1);
          if (z <= a) continue;
          var x0 = cl(xOn(li, a)), x1 = cl(xOn(li, z));
          if (ln.br && e >= ln.o1) x1 = cl(ln.end) + 0.25 * sz;   // the line break itself is selected
          rects += '<rect x="' + x0.toFixed(1) + '" y="' + (baseline(li) - capH - pad).toFixed(1) + '" width="' +
            Math.max(0, x1 - x0).toFixed(1) + '" height="' + (capH + 2 * pad).toFixed(1) + '"/>';
        }
      }
      if (ed.focused && ed.composing && ed.compLen > 0) {   // the text an IME is still composing
        var c0 = ed.compStart, c1 = Math.min(lay.text.length, c0 + ed.compLen), th = Math.max(1, 0.02 * sz);
        for (var lj = 0; lj < lay.lines.length; lj++) {
          var lm = lay.lines[lj], ca = Math.max(c0, lm.o0), cz = Math.min(c1, lm.o1);
          if (cz <= ca) continue;
          var u0 = cl(xOn(lj, ca)), u1 = cl(xOn(lj, cz));
          rects += '<rect class="comp" x="' + u0.toFixed(1) + '" y="' + (baseline(lj) + 0.9 * DESC_EM * sz).toFixed(1) + '" width="' +
            Math.max(0, u1 - u0).toFixed(1) + '" height="' + th.toFixed(1) + '"/>';   // under the dot below
        }
      }
      if (rects !== ed.selKey) { ed.selKey = rects; selG.innerHTML = rects; }
      // caret at the moving end of the selection; the textarea sits on it so
      // an IME's candidate window and mobile scrolling land where you type
      var f = Math.min(selAF()[1], lay.text.length), p = locate(f), by = baseline(p[0]);
      var cw = Math.max(2, Math.round(sz / 40) / 2), cx = Math.max(0, Math.min(maxW - cw, p[1] - cw / 2));
      caret.classList.toggle('on', ed.focused && s === e);
      caret.style.width = cw + 'px';
      caret.style.height = capH.toFixed(1) + 'px';
      caret.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + (by - capH).toFixed(1) + 'px)';
      var key = cx.toFixed(1) + ',' + by.toFixed(1);
      if (key !== ed.caretKey) {   // a moved caret shows solid, then blinks again
        ed.caretKey = key;
        caret.style.animationName = (ed.flip = !ed.flip) ? 'tester-blink-b' : 'tester-blink-a';
      }
      if (!ed.ctx) {   // (under the pointer while a right-click menu is open)
        ta.style.left = Math.max(0, Math.min(maxW - 1, p[1])).toFixed(1) + 'px';
        ta.style.top = Math.max(0, by - 1).toFixed(1) + 'px';
      }
      if (ed.wantScroll && ed.focused) {
        ed.wantScroll = false;
        if (caret.scrollIntoView) caret.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    // ---- selection: anchor and moving end, always on cluster boundaries
    function selAF() {
      var s = ta.selectionStart, e = ta.selectionEnd, d = ed.sel;
      if (s === e) return [s, s];
      if (d && Math.min(d[0], d[1]) === s && Math.max(d[0], d[1]) === e) return d;
      return ta.selectionDirection === 'backward' ? [e, s] : [s, e];
    }
    function setSel(a, f) {
      ed.sel = [a, f]; ed.lastF = f; ed.wantScroll = true;
      ta.setSelectionRange(Math.min(a, f), Math.max(a, f), f < a ? 'backward' : 'forward');
      queue();
    }
    function snapTo(o, dir) {
      var lay = ed.lay;
      if (lay.pos[o]) return o;
      var st = lay.stops, i = lowerIdx(st, o);
      return dir > 0 && i + 1 < st.length ? st[i + 1] : st[i];
    }
    function snapSel() {
      var lay = ed.lay;
      if (!lay || lay.text !== ta.value) return;
      var s = ta.selectionStart, e = ta.selectionEnd, s2, e2, af = selAF();
      if (s === e) s2 = e2 = snapTo(s, s >= ed.lastF ? 1 : -1);
      else { s2 = snapTo(s, -1); e2 = snapTo(e, 1); }
      if (s2 !== s || e2 !== e) {
        var back = af[1] < af[0];
        ta.setSelectionRange(s2, e2, back ? 'backward' : 'forward');
        ed.sel = s2 === e2 ? null : back ? [e2, s2] : [s2, e2];
      }
      ed.lastF = selAF()[1];
    }
    ed.syncSel = function () { if (!ed.composing && ed.lay && ed.lay.text === ta.value) snapSel(); queue(); };
    function stepStop(o, dir) {
      var st = ed.lay.stops, i = lowerIdx(st, o);
      if (dir > 0) { if (st[i] <= o) i++; return st[Math.min(i, st.length - 1)]; }
      if (st[i] === o) i--;
      return st[Math.max(i, 0)];
    }
    function nearestOn(ln, x) {
      var best = ln.stops[0][0], bd = Infinity;
      for (var i = 0; i < ln.stops.length; i++) {
        var d = Math.abs(Math.min(ln.stops[i][1], ed.lay.maxW) - x);
        if (d < bd) { bd = d; best = ln.stops[i][0]; }
      }
      return best;
    }
    function moveH(dir, shift) {
      var af = selAF(), s = ta.selectionStart, e = ta.selectionEnd;
      var to = !shift && s !== e ? (dir > 0 ? e : s) : stepStop(af[1], dir);
      setSel(shift ? af[0] : to, to);
      ed.goalX = null;
    }
    // up / down go to the rendered line above / below, keeping the column
    function moveV(dir, shift) {
      var af = selAF(), s = ta.selectionStart, e = ta.selectionEnd, lay = ed.lay;
      var p = locate(!shift && s !== e ? (dir < 0 ? s : e) : af[1]), li = p[0] + dir, to;
      if (ed.goalX == null) ed.goalX = Math.min(p[1], lay.maxW);
      if (li < 0) to = 0;
      else if (li >= lay.lines.length) to = lay.text.length;
      else to = nearestOn(lay.lines[li], ed.goalX);
      var gx = ed.goalX;
      setSel(shift ? af[0] : to, to);
      ed.goalX = gx;
    }
    function lineEdge(end, shift) {
      var af = selAF(), st = ed.lay.lines[locate(af[1])[0]].stops, to = end ? st[st.length - 1][0] : st[0][0];
      setSel(shift ? af[0] : to, to);
      ed.goalX = null;
    }
    // the word (or run of spaces) at a boundary; before: the one to its left
    function wordAt(o, before) {
      var toks = ed.lay.toks, n = toks.length;
      if (!n) return [0, 0];
      var i = o >= ed.lay.text.length ? n - 1 : lowerIdx(toks, o, 'o0');
      if (before && i > 0 && toks[i].o0 === o && toks[i - 1].t !== 'br') i--;
      var kind = toks[i].t, a = i, z = i;
      if (kind === 'br') return [o, o];
      while (a > 0 && toks[a - 1].t === kind) a--;
      while (z < n - 1 && toks[z + 1].t === kind) z++;
      return [toks[a].o0, toks[z].o1];
    }
    function paraAt(o) {
      var t = ed.lay.text, z = t.indexOf('\n', o);
      return [t.lastIndexOf('\n', o - 1) + 1, z < 0 ? t.length : z];
    }
    // a pointer position -> the nearest boundary on the nearest rendered line
    function hit(cx, cy) {
      var lay = current(), r = surface.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
      var li = ed.L > 0 ? Math.floor((y - ed.padTop) / ed.L) : 0;
      li = Math.max(0, Math.min(lay.lines.length - 1, li));
      return { o: nearestOn(lay.lines[li], x), x: x };
    }
    function unitAt(h, mode) {
      if (mode === 'word') return wordAt(h.o, h.x < locate(h.o)[1]);
      if (mode === 'para') return paraAt(h.o);
      return [h.o, h.o];
    }
    function focusQuiet() {
      if (document.activeElement === ta) return;
      ed.placing = true;
      try { ta.focus({ preventScroll: true }); } finally { ed.placing = false; }
    }
    ed.focusAt = function (s, e, dir) {
      focusQuiet();
      current();
      ta.setSelectionRange(s, e, dir === 'backward' ? 'backward' : 'forward');
      ed.sel = null; ed.lastF = dir === 'backward' ? s : e;
      snapSel();
      ed.wantScroll = true;
      overlay();
    };

    // ---- pointer: a click anywhere in the block below its controls places
    // the caret, drag selects, double-click a word, triple-click the line;
    // Shift+click extends
    var inHead = function (t) { return t && t.closest && !!t.closest('.tester-head'); };
    // A right-click keeps the text focused and opens the textarea's own
    // menu (Cut / Copy / Paste / Select all on the selection): the
    // textarea is slipped under the pointer until the menu is up. A
    // right-click outside the selection first moves the caret there (on a
    // Mac, selects the word there, as Mac text fields do).
    function endCtx() {
      if (!ed.ctx) return;
      ed.ctx = null; ta.classList.remove('is-ctx');
      overlay();
    }
    function startCtx(e) {
      var wasIn = document.activeElement === ta, h = hit(e.clientX, e.clientY), s = ta.selectionStart, z = ta.selectionEnd;
      focusQuiet();
      if (!wasIn || s === z || h.o < s || h.o > z) {
        var w = IS_MAC ? unitAt(h, 'word') : [h.o, h.o];
        setSel(w[0], w[1]); ed.moved = true;
      }
      var r = surface.getBoundingClientRect();
      ed.ctx = [ta.selectionStart, ta.selectionEnd, ta.selectionDirection]; ta.classList.add('is-ctx');
      ta.style.left = (e.clientX - r.left - 12).toFixed(1) + 'px';
      ta.style.top = (e.clientY - r.top - 12).toFixed(1) + 'px';
    }
    root.addEventListener('contextmenu', function () {
      var c = ed.ctx;
      if (!c) return;
      // the browser may have moved the textarea's own selection to whatever
      // of its (unseen) text is under the pointer: the menu acts on ours
      if (ta.selectionStart !== c[0] || ta.selectionEnd !== c[1]) ta.setSelectionRange(c[0], c[1], c[2]);
      setTimeout(endCtx, 0);
    });
    // the scroller the specimen moves in (the page itself on a phone)
    function scrollerOf() {
      var sc = $('specimenScroll');
      return sc && sc.scrollHeight > sc.clientHeight + 1 && getComputedStyle(sc).overflowY !== 'visible'
        ? sc : document.scrollingElement || document.documentElement;
    }
    root.addEventListener('mousedown', function (e) {
      if (inHead(e.target)) return;
      endCtx();
      if (e.button !== 0) {
        if (e.button === 2) startCtx(e);
        else if (e.button === 1 && document.activeElement === ta) e.preventDefault();   // the selection stays
        if (e.button === 2) e.preventDefault();
        return;
      }
      e.preventDefault();   // focus stays in the textarea, no page text selection
      var wasIn = document.activeElement === ta, h = hit(e.clientX, e.clientY);
      var af = selAF(), mode = e.detail >= 3 ? 'para' : e.detail === 2 ? 'word' : 'char', A;
      focusQuiet();
      if (e.shiftKey && wasIn) { A = [af[0], af[0]]; mode = 'char'; setSel(af[0], h.o); }
      else { A = unitAt(h, mode); setSel(A[0], A[1]); }
      ed.moved = true; ed.goalX = null; ed.wantScroll = false;
      // a drag held at the top or bottom edge of the view scrolls it, and
      // the selection follows
      var last = null, sc = scrollerOf(), tick = 0;
      var extend = function () {
        var r = unitAt(hit(last.clientX, last.clientY), mode);
        if (r[0] < A[0]) setSel(A[1], r[0]); else setSel(A[0], Math.max(A[1], r[1]));
        ed.wantScroll = false;
      };
      var edge = function () {
        tick = 0;
        if (!last) return;
        var page = sc === document.scrollingElement || sc === document.documentElement;
        var rr = page ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect(), zone = 30, y = last.clientY;
        var d = y < rr.top + zone ? y - rr.top - zone : y > rr.bottom - zone ? y - rr.bottom + zone : 0;
        if (!d) return;
        var before = sc.scrollTop;
        sc.scrollTop = before + Math.max(-48, Math.min(48, d / 2));   // faster the further past the edge
        if (sc.scrollTop === before) return;
        extend();
        tick = requestAnimationFrame(edge);
      };
      var move = function (ev) {
        last = ev; extend();
        if (!tick) tick = requestAnimationFrame(edge);
      };
      var up = function () {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (tick) cancelAnimationFrame(tick);
        tick = 0; last = null;
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // after Esc the block itself has focus: Enter goes back into its text
    root.addEventListener('keydown', function (e) {
      if (e.target !== root || e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      ed.focusAt(ta.selectionStart, ta.selectionEnd, ta.selectionDirection);
    });
    // a tap where no mouse events follow still lands the caret
    root.addEventListener('click', function (e) {
      if (document.activeElement === ta || inHead(e.target)) return;
      var h = hit(e.clientX, e.clientY);
      ed.focusAt(h.o, h.o);
      ed.moved = true;
    });

    // ---- keys: only what the drawn layout has to answer; the rest is native
    ta.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;   // the IME's keys
      endCtx();
      var k = e.key, mod = e.ctrlKey || e.metaKey, plain = !mod && !e.altKey;
      if (k === 'Escape' || (k === 'Enter' && mod)) {   // leave the text, onto the block itself
        e.preventDefault();
        root.focus({ preventScroll: true });
        if (document.activeElement === ta) ta.blur();
        return;
      }
      if (mod && !e.altKey && (k === 'a' || k === 'A')) ed.moved = true;   // select all: what you type next is its own step
      var horiz = k === 'ArrowLeft' || k === 'ArrowRight', vert = k === 'ArrowUp' || k === 'ArrowDown';
      var edge = k === 'Home' || k === 'End';
      if (!horiz && !vert && !edge && k !== 'PageUp' && k !== 'PageDown') return;
      current();
      ed.moved = true;
      if (horiz && plain) moveH(k === 'ArrowRight' ? 1 : -1, e.shiftKey);
      else if (vert && plain) moveV(k === 'ArrowDown' ? 1 : -1, e.shiftKey);
      else if (edge && !mod) lineEdge(k === 'End', e.shiftKey);
      else if (horiz && IS_MAC && e.metaKey && !e.ctrlKey && !e.altKey) lineEdge(k === 'ArrowRight', e.shiftKey);
      else {   // word jumps, start / end of the text: native, then snapped to a cluster boundary
        ed.goalX = null; ed.wantScroll = true;
        setTimeout(ed.syncSel, 0);
        return;
      }
      e.preventDefault();
    });
    ta.addEventListener('keyup', ed.syncSel);
    ta.addEventListener('select', ed.syncSel);
    ta.addEventListener('selectionchange', ed.syncSel);

    // ---- editing
    // what this block may grow to: its cap, and what the other blocks leave
    // of the budget (never below what it already holds, so it can shrink)
    function capText() { ta.maxLength = Math.max(ta.value.length, Math.min(BLOCK_MAX, TEXT_BUDGET - previewChars(b))); }
    ta.addEventListener('beforeinput', function (e) {
      var it = e.inputType || '';
      if (it === 'historyUndo' || it === 'historyRedo') {   // Edit › Undo, shake to undo: the app's history
        e.preventDefault();
        if (it === 'historyUndo') undo(); else redo();
        return;
      }
      endCtx();
      // its own undo step: a paste or cut, or typing over a selection
      // (after Ctrl/⌘A, a drag, a double-click)
      if (/Paste|Drop|Cut|Yank/.test(it) || (!ed.composing && ta.selectionStart !== ta.selectionEnd)) ed.moved = true;
      // the textarea's maxLength is this block's share of the preview budget
      // (refreshed here: an undo may have changed the other blocks since focus)
      capText();
      if (/^insert/.test(it) && it !== 'insertCompositionText' && ta.maxLength > 0) {
        var add = e.data != null ? e.data.length : e.dataTransfer ? (e.dataTransfer.getData('text/plain') || '').length : 1;
        if (ta.value.length - (ta.selectionEnd - ta.selectionStart) + add > ta.maxLength) {
          toast('Preview text is full: ' + BLOCK_MAX.toLocaleString('en') + ' characters a block, ' + TEXT_BUDGET.toLocaleString('en') + ' in all', 3200);
        }
      }
    });
    ta.addEventListener('input', function (e) {
      var it = e.inputType || '';
      if (it === 'historyUndo' || it === 'historyRedo') {   // a native undo slipped past beforeinput:
        ta.value = b.text;                                   // drop it and use the app's history
        if (it === 'historyUndo') undo(); else redo();
        return;
      }
      if (ta.value === b.text) { queue(); return; }
      // one undo step per typing burst; the snapshot still holds the old text
      var now = Date.now();
      if (!ed.burst || ed.moved || (!ed.composing && now - ed.lastEdit > BURST_MS)) pushUndo();
      ed.burst = true; ed.moved = /Paste|Drop|Cut|Yank/.test(it); ed.lastEdit = now;
      b.text = ta.value;
      ed.sel = null; ed.wantScroll = true; ed.goalX = null;
      queue(true);
      markDirty();
      clearTimeout(ed.missT);
      ed.missT = setTimeout(function () { reportMissing(b.text); }, 1200);   // once typing pauses
    });
    ta.addEventListener('compositionstart', function () {
      if (ta.selectionStart !== ta.selectionEnd) ed.moved = true;   // composing over a selection: a new step
      ed.composing = true; ed.compStart = ta.selectionStart; ed.compLen = 0;
    });
    ta.addEventListener('compositionupdate', function (e) { ed.compLen = (e.data || '').length; queue(); });
    ta.addEventListener('compositionend', function () { ed.composing = false; ed.compLen = 0; queue(true); });

    ta.addEventListener('focus', function () {
      activeEd = ed; ed.focused = true;
      capText();
      surface.classList.add('is-focused');
      // Tab lands at the end of the text; a click or a window coming back
      // keeps the caret it set or had
      if (!ed.placing && !ed.winBlur) { var n = ta.value.length; ta.setSelectionRange(n, n); ed.sel = null; ed.lastF = n; }
      ed.winBlur = false; ed.burst = false; ed.goalX = null; ed.wantScroll = !ed.placing;
      queue();
    });
    ta.addEventListener('blur', function () {
      endCtx();
      ed.winBlur = typeof document.hasFocus === 'function' && !document.hasFocus();
      if (activeEd === ed) activeEd = null;
      ed.focused = false; ed.composing = false; ed.burst = false;
      surface.classList.remove('is-focused');
      clearTimeout(ed.missT);
      if (!ed.winBlur) reportMissing(b.text);
      queue();
    });
    return ed;
  }

  // what the font can't draw yet, one entry per grapheme (a flag, not its two halves)
  function missingIn(text) {
    var miss = [], units = graphemeStarts(text) ? Array.from(SEG.segment(text), function (x) { return x.segment; }) : null;
    (units || GC.clusters(text)).forEach(function (u) {
      if (/^\s+$/.test(u)) return;
      var cl = units ? GC.clusters(u) : [u];
      if (cl.every(canDraw)) return;
      var L = cl.join('');
      if (miss.indexOf(L) < 0) miss.push(L);
    });
    return miss;
  }
  var lastMissing = '';
  function reportMissing(text) {
    var miss = missingIn(text).join(' ');
    if (miss && miss !== lastMissing) toast('Not in this font yet: ' + miss, 3200);
    lastMissing = miss;
  }

  // re-layout every block; widths are read first so the reads don't
  // interleave with the writes
  function repaintAllTesters() {
    var eds = [];
    Array.prototype.forEach.call(testerList.children, function (r) { if (r.liquidEd) eds.push(r.liquidEd); });
    var ws = eds.map(function (ed) { return ed.surface.clientWidth; });
    eds.forEach(function (ed, i) { ed.paint(ws[i]); });
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
        cell.tabIndex = L === state.selected ? 0 : -1;
        cell.addEventListener('click', function () { selectLetter(L); });
        row.appendChild(cell);
      });
      g.appendChild(row);
      glyphSetEl.appendChild(g);
    });
    refreshGlyphSet();
  }
  // The character set is one Tab stop: arrows move between cells (up/down
  // to the nearest cell on the next row), Enter/Space opens it, Home/End jump.
  glyphSetEl.addEventListener('keydown', function (e) {
    var cells = Array.prototype.slice.call(glyphSetEl.querySelectorAll('.glyph-cell'));
    var i = cells.indexOf(document.activeElement), j = -1;
    if (i < 0) return;
    if (e.key === 'ArrowRight') j = Math.min(cells.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = cells.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var r = cells[i].getBoundingClientRect(), best = Infinity, dir = e.key === 'ArrowDown' ? 1 : -1;
      cells.forEach(function (c, k) {
        var q = c.getBoundingClientRect(), dy = (q.top - r.top) * dir;
        if (dy <= 4) return;
        var score = dy * 4 + Math.abs(q.left - r.left);
        if (score < best) { best = score; j = k; }
      });
    }
    if (j < 0 || j === i) return;
    e.preventDefault(); e.stopPropagation();
    cells[i].tabIndex = -1; cells[j].tabIndex = 0; cells[j].focus();
  });
  function refreshGlyphSet() {
    var color = state.ink === '#000000' ? '#fff' : state.ink;
    glyphSetEl.querySelectorAll('.glyph-cell').forEach(function (cell) {
      var L = cell.dataset.letter, svg = cell.firstChild;
      cell.style.setProperty('--cell-ink', color);
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
    var labels = [];   // drawn after everything else, so glyphs never cover them
    function guide(y, label, color) {
      edSvg.appendChild(mkEl('line', { x1: gl, y1: y, x2: gr, y2: y, stroke: color, 'stroke-width': 1 / z, 'stroke-dasharray': (3 / z) + ' ' + (2 / z) }));
      var t = mkEl('text', { x: gl + 3 / z, y: y - 2 / z, fill: '#8a8a8a', 'font-size': fs, 'font-family': 'IBM Plex Mono, monospace' });
      t.textContent = label;
      labels.push(t);
    }
    guide(MET.base, 'baseline', '#4d4d4d');
    guide(MET.cap, 'cap', '#4d4d4d');
    guide(MET.base - ASC_EM * MET.em, 'ascender', '#2e2e2e');
    guide(MET.base + DESC_EM * MET.em, 'descender', '#2e2e2e');
    var ax0 = 0, ax1 = GW;
    if (canDraw(L)) {
      var sp = spacingOf(L); ax0 = sp.x0 - sp.lsb; ax1 = ax0 + sp.adv;
      [ax0, ax1].forEach(function (x) {
        edSvg.appendChild(mkEl('line', { x1: x, y1: vy, x2: x, y2: vy + span, stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 1 / z }));
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
          // base skeleton dashed, shared-mark skeleton dotted
          fill: 'none', stroke: p.zone === 'base' ? '#6a6a6a' : '#a0a0a0', 'stroke-width': 0.9 / z,
          'stroke-dasharray': p.zone === 'base' ? (3 / z) + ' ' + (2.5 / z) : (0.9 / z) + ' ' + (1.8 / z),
        }));
      });
    });

    labels.forEach(function (t) { edSvg.appendChild(t); });

    nodes.forEach(function (n, i) {
      var act = i === state.activeNode;
      if (act) {
        var rr = n.r * state.mass;
        var ring = mkEl('circle', {
          cx: n.x, cy: n.y, r: rr, fill: 'none',
          stroke: '#ffffff', 'stroke-width': 1.1 / z, 'stroke-dasharray': (3 / z) + ' ' + (2 / z), opacity: 0.95,
        });
        ring.setAttribute('class', 'rim-ring');   // marches: one dash + gap per cycle
        ring.style.setProperty('--dash-cycle', (5 / z).toFixed(3));
        edSvg.appendChild(ring);
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
    if (state.globalEdit && !isMark(n.key)) state.draft = true;   // a global drag reshapes every letter: trace coarse until release
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
    if (state.draft) { draftOff(); return; }
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
    return state.blocks.map(function (b) { return { id: b.id, text: b.text, size: b.size, lh: b.lh, tr: b.tr, paper: b.paper }; });
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
    if (o.blocks && JSON.stringify(o.blocks) !== JSON.stringify(blocksData())) restoreBlocks(o.blocks);
    bumpAll();
  }
  // Blocks are matched by id and updated in place. When only text changed
  // (undoing a typing burst) every block keeps its DOM, so the textarea you
  // are typing in stays the focused element and the caret lands where the
  // undone edit was; a block put back or taken away rebuilds the list,
  // which refocuses the block you were in by its id.
  function restoreBlocks(data) {
    var byId = {}, sameSet = data.length === state.blocks.length;
    state.blocks.forEach(function (b) { byId[b.id] = b; });
    data.forEach(function (d, i) { if (!state.blocks[i] || state.blocks[i].id !== d.id) sameSet = false; });
    var textOnly = sameSet && data.every(function (d, i) {
      var b = state.blocks[i];
      return d.size === b.size && d.lh === b.lh && d.tr === b.tr && !!d.paper === b.paper;
    });
    if (textOnly) {
      data.forEach(function (d, i) { var b = state.blocks[i]; if (b.text !== d.text) setBlockText(b, d.text); });
      return;
    }
    state.blocks = data.map(function (d) {
      var b = d.id > 0 && byId[d.id];
      if (!b) return block(d.text, d.size, d.lh, d.tr, d.paper, d.id);
      b.text = d.text; b.size = d.size; b.lh = d.lh; b.tr = d.tr; b.paper = !!d.paper;
      return b;
    });
    renderTesters();
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    updateUndo();
  }
  function undo() {
    if (!undoStack.length) return;
    if (activeEd) activeEd.burst = false;   // the next keystroke in a preview starts a new step
    redoStack.push(snapshot());
    restore(undoStack.pop());
    if (state.activeNode >= viewNodes(viewOf(state.selected)).length) state.activeNode = -1;
    schedule(); markDirty();
  }
  function redo() {
    if (!redoStack.length) return;
    if (activeEd) activeEd.burst = false;
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
      : (FLAT[L] ? 'Click a node, then drag to move it, or drag its marching ring to swell / pinch the stroke.'
                 : L + ' is built from its base letter and marks: drag a base node to edit the letter, a grey mark node to edit the shared mark.');
    glyphSetEl.querySelectorAll('.glyph-cell').forEach(function (c) {
      var on = c.dataset.letter === L;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-pressed', String(on));
      if (!glyphSetEl.contains(document.activeElement)) c.tabIndex = on ? 0 : -1;
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
    $('btnAutoMetrics').disabled = !ok || !state.metrics[L];
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
    var key = ab[0] + '\u0000' + ab[1], v = kernOf(ab[0], ab[1]), manual = own(state.kernOv, key);
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
    var cv = Math.max(-60, Math.min(30, v));
    if (cv !== v) toast('Kerning is limited to −60 … +30 units; set ' + cv);
    state.kernOv[ab[0] + '\u0000' + ab[1]] = cv;
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
    if (e.isComposing || e.keyCode === 229) return;   // keys an IME is using
    // only text-like fields keep their own keys; a slider, select or button
    // that still has focus must not swallow Ctrl/⌘Z. Preview text is typed
    // into a textarea too, so none of the editor's keys fire there — but its
    // undo is the app's (one step per typing burst), never the textarea's.
    var t = e.target, typing = t && (t.tagName === 'TEXTAREA' || t.isContentEditable ||
      (t.tagName === 'INPUT' && /^(text|number|search|email|url|tel|password)$/.test(t.type)));
    var preview = !!(t && t.classList && t.classList.contains('tester-input'));
    var mod = e.metaKey || e.ctrlKey, k = e.key;
    if (mod && (k === 'z' || k === 'Z')) {
      if (typing && !preview) return;   // native undo inside the other text fields
      e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      if (typing && !preview) return;
      e.preventDefault(); redo(); return;
    }
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
  edWrap.addEventListener('focusout', function () {
    if (state.activeNode < 0) readout.textContent = 'Click a node, then drag to move it, or drag its marching ring to swell / pinch the stroke.';
  });
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

  // On narrow bars the exports are pinned to the right edge; scroll the bar
  // so a focused control never sits underneath them.
  var bar = document.querySelector('.control-bar'), exportsEl = document.querySelector('.export-group');
  bar.addEventListener('focusin', function (e) {
    if (exportsEl.contains(e.target) || bar.scrollWidth <= bar.clientWidth) return;
    var r = e.target.getBoundingClientRect(), ex = exportsEl.getBoundingClientRect(), br = bar.getBoundingClientRect();
    if (r.right > ex.left - 8) bar.scrollLeft += r.right - ex.left + 16;
    else if (r.left < br.left + 8) bar.scrollLeft -= br.left - r.left + 16;
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
  var pct = function (v) { return Math.round(v * 100) + '%'; };
  bindShape('sldFlow', 'valFlow', 'flow', pct);
  bindShape('sldDrip', 'valDrip', 'drip', pct);
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
    if (!roomFor(1, 17)) return;
    pushUndo();
    var nb = block('NEW PREVIEW BLOCK', 120, 120, 0.01);
    state.blocks.push(nb);
    renderTesters(nb, 'type'); markDirty();   // focused with its text selected: just type
  });
  // proofing strings a type designer reaches for
  var PROOFS = {
    spacing: 'HAMBURGEFONTSIV HOHOHOH NONONON',
    kerning: 'AV AW AY LT LV LY TA TO VA WA YA P. T, Y. F. L’ AT TY',
    vietnamese: 'ĂN ẤM ỞN ỨNG ĐẸP CHỮ NGHĨA KHỎE MẠNH QUẬY PHÁ ỒN ÀO',
    pangram: 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789',
  };
  $('proofSelect').addEventListener('change', function (e) {
    var v = e.target.value, t = PROOFS[v], WF = 'ĐẸP QUÁ, TIẾNG VIỆT! AV LT 2026';
    e.target.value = '';
    if (v === 'waterfall' ? !roomFor(4, 4 * WF.length) : t && !roomFor(1, t.length)) return;
    if (v) pushUndo();
    if (v === 'waterfall') {
      // one line at falling sizes: where the melt stops reading
      [18, 28, 44, 72].forEach(function (sz) { state.blocks.unshift(block(WF, sz, 145, 0.01)); });
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
    $('sldFlow').value = state.flow; $('valFlow').textContent = Math.round(state.flow * 100) + '%';
    $('sldDrip').value = state.drip; $('valDrip').textContent = Math.round(state.drip * 100) + '%';
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
  // built once and updated in place, so the swatch you pressed keeps focus
  function renderSwatches() {
    if (!sw.children.length) PALETTE.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.ink = c;
      b.style.background = c;
      b.setAttribute('aria-label', 'Ink colour ' + c + (c === '#000000' ? ' (previews switch to paper)' : ''));
      b.addEventListener('click', function () {
        state.ink = c;
        renderSwatches();
        renderTesters(); refreshGlyphSet(); markDirty();
      });
      sw.appendChild(b);
    });
    Array.prototype.forEach.call(sw.children, function (b) {
      var on = b.dataset.ink === state.ink;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  renderSwatches();
  function updateCoverage() {
    var v = VIET.filter(canDraw).length, l = LATIN.filter(canDraw).length;
    var txt = (LETTERS.length + v + l) + ' glyphs · Việt ' + v + '/' + VIET.length + ' · Latin +' + l;
    $('glyphCountMeta').textContent = txt;
    $('glyphsetCoverage').textContent = txt;
  }

  // ------------------------------------------------------------ persistence
  // The whole project autosaves to this browser, and can be saved to /
  // opened from a .liquid.json file. `chains` carries every skeleton with the
  // edits applied, which is what the Poster tool reads.
  // #saveState is a polite live region: it speaks only when the outcome
  // changes, once things settle ('Saved in browser', 'Not saved'). Pending
  // work only dims it (a class, which a screen reader doesn't announce), so
  // typing in a preview or nudging a node is never read out key by key.
  var dirtyT = null;
  function sayState(t) { var el = $('saveState'); if (el.textContent !== t) el.textContent = t; }
  function markDirty() {
    clearTimeout(dirtyT);
    $('saveState').classList.add('is-saving');
    dirtyT = setTimeout(autosave, 500);
  }
  // leaving or hiding the tab writes what is still waiting
  function flushSave() { if (dirtyT) { clearTimeout(dirtyT); autosave(); } }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushSave(); });
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
    dirtyT = null;
    $('saveState').classList.remove('is-saving');
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(projectData()));
      sayState('Saved in browser');
    } catch (e) { sayState('Not saved'); }
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
    var out = Object.create(null);
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
  var SHAPE_RANGE = { mass: [0.6, 1.5], melt: [0, 40], tension: [-12, 8], wobble: [0, 8], grain: [0.01, 0.2], smooth: [0, 4], res: [1.2, 3],
    flow: [0, 1], warp: [0, 1], neck: [0, 1], sag: [0, 1], drip: [0, 1], dripForm: [0, 1], stretch: [1, 3] };
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
    var hasB = function (x) { return own(BASE, x); };
    q.metrics = Object.create(null);
    if (spc.metrics && typeof spc.metrics === 'object') Object.keys(spc.metrics).forEach(function (k) {
      var m = spc.metrics[k];
      if (hasB(k) || GC.plan(k, hasB)) {
        if (Array.isArray(m) && isFinite(m[0]) && isFinite(m[1])) q.metrics[k] = [num(m[0], -60, 60, 0), num(m[1], -60, 60, 0)];
      }
    });
    q.kernOv = Object.create(null);
    var hasK = hasB;
    if (spc.pairs && typeof spc.pairs === 'object') Object.keys(spc.pairs).slice(0, 5000).forEach(function (k) {
      var ab = k.split('\u0000'), v = +spc.pairs[k];
      if (ab.length === 2 && isFinite(v) && ab.every(function (g) { return GC.plan(g, hasK); })) q.kernOv[k] = num(v, -60, 30, 0);
    });
    var mk = p.marks || {};
    q.marks = { scale: num(mk.scale, 0.6, 1.5, 1), gapTop: num(mk.gapTop, 0, 20, 6), gapStack: num(mk.gapStack, 0, 20, 3), gapBottom: num(mk.gapBottom, 0, 20, 6) };
    q.flat = {};
    Object.keys(BASE).forEach(function (k) { q.flat[k] = p.flat && own(p.flat, k) && validFlat(p.flat[k]) ? p.flat[k] : flatten(BASE[k]); });
    q.globalOv = cleanOv(p.globalOv, null);
    q.letterOv = Object.create(null);
    if (p.letterOv && typeof p.letterOv === 'object') Object.keys(p.letterOv).forEach(function (k) {
      if (own(q.flat, k)) q.letterOv[k] = cleanOv(p.letterOv[k], q.flat[k]);
    });
    q.globalExempt = Object.create(null);
    if (p.globalExempt && typeof p.globalExempt === 'object') Object.keys(p.globalExempt).forEach(function (k) { if (hasB(k)) q.globalExempt[k] = true; });
    if (Array.isArray(p.blocks)) {
      // total preview text: a 200k-character file would freeze the tab.
      // The same caps the editor keeps to (BLOCK_MAX, TEXT_BUDGET +
      // FIXED_SLACK, MAX_BLOCKS), so an autosave always comes back whole.
      var budget = TEXT_BUDGET + FIXED_SLACK;
      q.blocks = p.blocks.slice(0, MAX_BLOCKS).map(function (b) {
        var t = String((b && b.text) || '').replace(/\r\n?/g, '\n').slice(0, Math.max(0, Math.min(BLOCK_MAX, budget)));
        budget -= t.length;
        return block(t, num(b && b.size, 10, 480, 96), num(b && b.lh, 70, 220, 120), num(b && b.tr, -0.06, 0.4, 0.01), b && b.paper);
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
      catch (err) {
        toast('Could not open ' + f.name + (err instanceof SyntaxError ? ': not a readable project file' : ': ' + err.message), 3500);
        return;
      }
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
  // A block laid out exactly as its preview is (layoutText: same clusters,
  // spacing, kerning, tracking, spaces and line breaks), wrapped at maxW.
  // the preview's own layout and fit rule, at the export's column width
  function layoutBlock(b, maxW) {
    var lay = layoutText(b.text, b.size, b.tr, maxW, true);
    return {
      lines: lay.lines.map(function (l) { return l.glyphs; }),
      widths: lay.lines.map(function (l) { return l.w; }),
      k: lay.k, size: lay.size,
    };
  }
  // The whole specimen as one SVG: every block in its own size, leading,
  // tracking and ink/paper colours, glyphs referenced from shared defs.
  function buildSVG() {
    var W = 1600, pad = 60, inner = W - pad * 2, y = 0, body = '', used = {};
    var bg = state.ink === '#000000' ? '#ffffff' : '#000000';
    var blocks = state.blocks.length ? state.blocks : [block(state.fontName.toUpperCase(), 160, 110, 0.01)];
    blocks.forEach(function (b) {
      var lay = layoutBlock(b, inner), sz = lay.size, lh = b.lh / 100 * sz, top = y;
      var h = pad * 0.6 + (ASC_EM - CAP_EM) * sz + lay.lines.length * lh + DESC_EM * sz + pad * 0.6;
      var ink = b.paper ? '#000000' : (state.ink === '#000000' ? '#000' : state.ink);
      if (b.paper) body += '<rect x="0" y="' + top.toFixed(1) + '" width="' + W + '" height="' + h.toFixed(1) + '" fill="#ffffff"/>';
      var baseline = top + pad * 0.6 + (ASC_EM - CAP_EM) * sz + CAP_EM * sz + (lh - sz) / 2;
      body += '<g fill="' + ink + '">';
      lay.lines.forEach(function (line, li) {
        var by = baseline + li * lh;
        line.forEach(function (g) {
          if (g.notdef) {
            body += '<rect x="' + (pad + g.x + g.w * 0.1).toFixed(1) + '" y="' + (by - CAP_EM * sz).toFixed(1) + '" width="' + (g.w * 0.8).toFixed(1) +
              '" height="' + (CAP_EM * sz).toFixed(1) + '" rx="3" fill="none" stroke="' + ink + '" stroke-width="2" stroke-dasharray="6 4"/>';
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
    // fold accents first, so "Chữ Đẹp" saves as chu-dep, not ch-p
    var t = (state.fontName || 'font').trim().replace(/[\u0110\u0111]/g, 'd').normalize('NFD').replace(/\p{M}+/gu, '');
    return t.replace(/[^a-z0-9\-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'font';
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
    var UPM = 2000, SC = UPM / MET.em;   // a finer grid halves rounding: smoother curve joins
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
    var e1 = UPM * 0.05, e2 = UPM * 0.1;   // outer counter-clockwise, inner clockwise (y up)
    nd.moveTo(e1, 0); nd.lineTo(w - e1, 0); nd.lineTo(w - e1, hcap); nd.lineTo(e1, hcap); nd.close();
    nd.moveTo(e2, e1); nd.lineTo(e2, hcap - e1); nd.lineTo(w - e2, hcap - e1); nd.lineTo(w - e2, e1); nd.close();
    var glyphs = [
      new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: w, path: nd }),
      new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: Math.round(wordEm() * UPM), path: new opentype.Path() }),
    ];
    glyphs[1].addUnicode(0xA0);
    var index = {}, keys = LETTERS.concat(VIET.filter(canDraw), LATIN.filter(canDraw));
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
    // accent on any letter — even sequences with no precomposed glyph (Q\u0303).
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
      if (!ALNUM.test(L) && OWN_CAPS.indexOf(L) < 0) return;   // letters and figures (Æ Ø Œ too) carry anchors
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
        if (own(state.kernOv, a + '\u0000' + b) && v) { pairs.push([index[a], index[b], v]); return; }
        if (Math.abs(v) >= UPM * 0.008) pairs.push([index[a], index[b], v]);   // under 0.8% em is invisible
      });
    });
    // drop the name records opentype.js would otherwise fill with a blank
    ['designerURL', 'manufacturerURL', 'license', 'licenseURL', 'trademark'].forEach(function (k) { delete font.names[k]; });
    var buf = font.toArrayBuffer(), extra = {};
    var gpos = FontTables.gpos({ kern: pairs, marks: markSpec }), gdef = FontTables.gdef(gdefCls);
    var ext = { advMax: 0, minL: 0, minR: 0, xMaxExt: 0 }, yMaxAll = 0, yMinAll = 0;
    var fontAsc = Math.round(UPM * ASC_EM), fontDesc = -Math.round(UPM * DESC_EM);
    // post: underline position / thickness (opentype.js leaves 0/0)
    var post = FontTables.readTable(buf, 'post');
    if (post && post.length >= 12) {
      var pv = new DataView(post.buffer, post.byteOffset, post.byteLength);
      pv.setInt16(8, -Math.round(UPM * 0.075)); pv.setInt16(10, Math.round(UPM * 0.05));
      extra.post = post;
    }
    // hmtx: opentype.js 1.3.4 ignores leftSideBearing, so write xMin per glyph
    var hmtx = FontTables.readTable(buf, 'hmtx'), hhea = FontTables.readTable(buf, 'hhea');
    if (hmtx && hhea) {
      var hd = new DataView(hmtx.buffer, hmtx.byteOffset, hmtx.byteLength);
      var nh = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34);
      glyphs.forEach(function (g, i) {
        var bb = g.path.commands.length ? g.getBoundingBox() : null, lsb = bb ? Math.round(bb.x1) : 0;
        ext.advMax = Math.max(ext.advMax, g.advanceWidth || 0);
        if (bb) {
          ext.minL = Math.min(ext.minL, lsb); ext.minR = Math.min(ext.minR, Math.round((g.advanceWidth || 0) - bb.x2));
          ext.xMaxExt = Math.max(ext.xMaxExt, Math.round(bb.x2)); yMaxAll = Math.max(yMaxAll, Math.round(bb.y2)); yMinAll = Math.min(yMinAll, Math.round(bb.y1));
        }
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
      // Windows metrics = hhea/typo (both already cover every glyph's ink)
      od.setUint16(74, Math.max(fontAsc, yMaxAll)); od.setUint16(76, Math.max(-fontDesc, -yMinAll));
      extra['OS/2'] = os2;
    }
    // hhea extents opentype.js leaves at 0: advanceWidthMax, minLSB, minRSB, xMaxExtent
    if (hhea) {
      var hv = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength);
      hv.setUint16(10, ext.advMax); hv.setInt16(12, ext.minL); hv.setInt16(14, ext.minR); hv.setInt16(16, ext.xMaxExt);
      extra.hhea = hhea;
    }
    buf = FontTables.injectTables(buf, extra);
    dl(new Blob([buf], { type: 'font/otf' }), safeName() + '.otf');
    return glyphs.length;
  }

  // a small read-only window into the engine, for tests and the console
  window.LiquidFont = {
    kern: function (a, b) { return kernOf(a, b); },
    spacing: function (L) { var s = spacingOf(L); return { lsb: s.lsb, rsb: s.rsb, adv: s.adv, x0: s.x0, x1: s.x1 }; },
    metrics: function () { return { base: MET.base, cap: MET.cap, em: MET.em, ascender: ASC_EM, descender: DESC_EM }; },
    // the text of each laid-out line, as the previews and exports break it
    layout: function (text, size, maxW) {
      text = String(text);
      var l = layoutText(text, size || 100, 0, maxW || Infinity, true);
      return l.lines.map(function (ln) { return text.slice(ln.o0, ln.o1); });
    },
    glyphs: function () { return LETTERS.concat(VIET, LATIN); },
    rings: function (L) { return ringsOf(L); },
    // counters: rings wound against the outer shells (see ringsFromField), with their areas
    holes: function (L) {
      return ringsOf(L).map(BlobEngine.signedArea).filter(function (a) { return a < 0; }).map(function (a) { return -a; });
    },
    // true 2D distance between the inks of a set pair, glyph units (tests)
    pairGap: function (a, b) {
      var A = spacingOf(a), B = spacingOf(b), shift = A.adv + kernOf(a, b) - (B.x0 - B.lsb) + (A.x0 - A.lsb);
      var ra = ringsOf(a), rb = GC.shift(ringsOf(b), shift, 0), ba = GC.bbox(ra), bb = GC.bbox(rb);
      if (!ba || !bb) return Infinity;
      var best = Infinity;
      ra.forEach(function (r) { r.forEach(function (p) {
        if (p[0] < bb[0] - 20) return;
        rb.forEach(function (q) { for (var k = 0; k < q.length; k++) {
          var u = q[k], v = q[(k + 1) % q.length], dx = v[0] - u[0], dy = v[1] - u[1], l2 = dx * dx + dy * dy;
          var t = l2 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2)) : 0;
          var d = Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy);
          if (d < best) best = d;
        } });
      }); });
      return best;
    },
  };

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
