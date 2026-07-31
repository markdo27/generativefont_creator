(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var GH = GLYPH_DATA.H, GW = GLYPH_DATA.W, BASE = GLYPH_DATA.glyphs;

  // fixed vertical frame: every glyph shares a baseline even though widths vary
  var VB_Y0 = -18, VB_H = GH + 40;

  var PRESETS = {
    liquid:  { mass: 1.00, melt: 15, tension: -4, wobble: 0,   grain: 0.045, smooth: 2, res: 1.6 },
    mercury: { mass: 1.05, melt: 24, tension: -2, wobble: 0,   grain: 0.045, smooth: 3, res: 1.6 },
    acid:    { mass: 1.08, melt: 26, tension: -2, wobble: 2.2, grain: 0.050, smooth: 3, res: 1.5 },
    molten:  { mass: 1.16, melt: 30, tension:  2, wobble: 1.2, grain: 0.040, smooth: 3, res: 1.6 },
    bubble:  { mass: 0.94, melt:  7, tension: -7, wobble: 0,   grain: 0.045, smooth: 2, res: 1.6 },
    goo:     { mass: 1.10, melt: 20, tension:  0, wobble: 3.6, grain: 0.070, smooth: 3, res: 1.5 },
  };

  var PALETTE = ['#ffffff', '#ff5000', '#000000', '#8a8a8a'];

  var SETS = [
    ['Uppercase', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    ['Numerals', '0123456789'],
    ['Punctuation', ".,!?'-"],
  ];

  // ------------------------------------------------------------ glyph model
  var FLAT = {}, MIRROR = {};
  Object.keys(BASE).forEach(function (L) {
    var nodes = [], lens = [];
    BASE[L].forEach(function (c) { lens.push(c.length); c.forEach(function (n) { nodes.push(n.slice()); }); });
    FLAT[L] = { nodes: nodes, lens: lens };
  });
  function computeMirrorMap(L) {
    var ns = FLAT[L].nodes;
    return ns.map(function (p, i) {
      var best = i, bd = Infinity;
      ns.forEach(function (q, j) {
        if (j === i) return;
        var d = Math.abs(q[1] - p[1]) + Math.abs(q[0] - (GW - p[0]));
        if (d < bd) { bd = d; best = j; }
      });
      return bd < 7 ? best : i;
    });
  }
  Object.keys(BASE).forEach(function (L) { MIRROR[L] = computeMirrorMap(L); });

  var globalOv = {}, letterOv = {}, undoStack = [];
  var letterVer = {}; Object.keys(BASE).forEach(function (L) { letterVer[L] = 0; });
  var globalVer = 0;

  function effNodes(L) {
    return FLAT[L].nodes.map(function (n, i) {
      var dx = 0, dy = 0, dr = 0;
      var g = globalOv[i]; if (g) { dx += g[0]; dy += g[1]; dr += g[2]; }
      var l = letterOv[L] && letterOv[L][i]; if (l) { dx += l[0]; dy += l[1]; dr += l[2]; }
      return [n[0] + dx, n[1] + dy, Math.max(2, n[2] + dr)];
    });
  }
  function chainsOf(L) {
    var f = effNodes(L), lens = FLAT[L].lens, out = [], k = 0;
    for (var i = 0; i < lens.length; i++) { out.push(f.slice(k, k + lens[i])); k += lens[i]; }
    return out;
  }
  function setOverride(L, i, d) {
    if (state.globalEdit) { globalOv[i] = d; globalVer++; }
    else { if (!letterOv[L]) letterOv[L] = {}; letterOv[L][i] = d; letterVer[L]++; }
  }

  // ------------------------------------------------------------------ cache
  var cache = {};
  function shapeKey() {
    var s = state;
    return [s.mass, s.melt, s.tension, s.wobble, s.grain, s.smooth, s.res, s.seed].join('|');
  }
  function ringsOf(L) {
    var k = L + '@' + shapeKey() + '@' + globalVer + '.' + letterVer[L];
    if (cache[k]) return cache[k];
    var r;
    try {
      r = BlobEngine.glyphRings(chainsOf(L), {
        mass: state.mass, melt: state.melt, tension: state.tension, wobble: state.wobble,
        grain: state.grain, smooth: state.smooth, res: state.res, simplify: 0.3,
        seed: state.seed + L.charCodeAt(0) * 13,
      });
    } catch (e) { console.error('glyph failed', L, e); r = []; }
    if (Object.keys(cache).length > 700) cache = {};
    cache[k] = r;
    return r;
  }
  function ringsToD(rings) {
    var d = '';
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      d += 'M' + r[0][0].toFixed(2) + ',' + r[0][1].toFixed(2);
      for (var j = 1; j < r.length; j++) d += 'L' + r[j][0].toFixed(2) + ',' + r[j][1].toFixed(2);
      d += 'Z';
    }
    return d;
  }
  function inkBounds(rings) {
    var a = 1e9, b = -1e9;
    rings.forEach(function (r) { r.forEach(function (p) { if (p[0] < a) a = p[0]; if (p[0] > b) b = p[0]; }); });
    return a > b ? [0, GW] : [a, b];
  }

  // ------------------------------------------------------------------ state
  var uid = 0;
  var state = Object.assign({
    seed: 5, preset: 'liquid',
    fontName: 'Ooze', ink: PALETTE[0],
    selected: 'A', activeNode: -1, globalEdit: false, mirror: false,
    blocks: [
      { id: ++uid, text: 'LIQUID TYPE 2026', size: 120, lh: 105, tr: 0.01, paper: false, editing: false },
      { id: ++uid, text: 'THE RIGHT MAN IN THE WRONG PLACE CAN MAKE ALL THE DIFFERENCE IN THE WORLD', size: 54, lh: 122, tr: 0.01, paper: false, editing: false },
      { id: ++uid, text: 'OOZE?!', size: 210, lh: 118, tr: 0.01, paper: true, editing: false },
      { id: ++uid, text: "IN A CULTURE LIKE OURS, LONG ACCUSTOMED TO SPLITTING AND DIVIDING ALL THINGS AS A MEANS OF CONTROL, IT IS SOMETIMES A BIT OF A SHOCK TO BE REMINDED THAT, IN OPERATIONAL AND PRACTICAL FACT, THE MEDIUM IS THE MESSAGE.", size: 22, lh: 140, tr: 0.02, paper: false, editing: false },
    ],
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
  // few-hundred-point outline.
  var METRICS = {};
  function refreshDefs() {
    var out = '';
    Object.keys(BASE).forEach(function (L) {
      var rings = ringsOf(L), bb = inkBounds(rings);
      METRICS[L] = { x0: bb[0], w: bb[1] - bb[0] };
      out += '<path id="gly' + L.charCodeAt(0) + '" d="' + ringsToD(rings) + '" fill-rule="nonzero"/>';
    });
    defsInner.innerHTML = out;
  }

  var SIDE = 5;   // side bearing, glyph units
  var SPACE = 30; // word space, glyph units

  function glyphSvg(L, sizePx, cls) {
    var m = METRICS[L];
    var w = m.w + SIDE * 2;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', (m.x0 - SIDE) + ' ' + VB_Y0 + ' ' + w + ' ' + VB_H);
    var hpx = sizePx * VB_H / GH;
    svg.setAttribute('height', hpx);
    svg.setAttribute('width', w * sizePx / GH);
    svg.style.verticalAlign = (-(VB_H + VB_Y0 - GH) * sizePx / GH) + 'px';
    var u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#gly' + L.charCodeAt(0));
    u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#gly' + L.charCodeAt(0));
    u.setAttribute('fill', 'currentColor');
    svg.appendChild(u);
    if (cls) svg.setAttribute('class', cls);
    return svg;
  }

  // --------------------------------------------------------- tester blocks
  function renderTesters() {
    testerList.innerHTML = '';
    state.blocks.forEach(function (b) { testerList.appendChild(buildTester(b)); });
  }

  function ctrl(label, min, max, step, val, fmt, onInput) {
    var wrap = document.createElement('div');
    wrap.className = 'tester-ctrl';
    var b = document.createElement('b');
    b.textContent = fmt(val);
    var r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
    r.addEventListener('input', function () {
      var v = parseFloat(r.value);
      b.textContent = fmt(v);
      onInput(v);
    });
    wrap.appendChild(b); wrap.appendChild(r);
    wrap.title = label;
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

    head.appendChild(ctrl('Size', 10, 300, 1, b.size, function (v) { return Math.round(v) + 'px'; },
      function (v) { b.size = v; paintText(root, b); }));
    head.appendChild(ctrl('Line height', 80, 220, 1, b.lh, function (v) { return Math.round(v) + '%'; },
      function (v) { b.lh = v; paintText(root, b); }));
    head.appendChild(ctrl('Letter spacing', -0.06, 0.4, 0.005, b.tr, function (v) { return v.toFixed(3) + 'em'; },
      function (v) { b.tr = v; paintText(root, b); }));

    var sp = document.createElement('div'); sp.className = 'tester-spacer';
    head.appendChild(sp);

    var inv = document.createElement('button');
    inv.className = 'mini-btn' + (b.paper ? ' on' : '');
    inv.textContent = b.paper ? 'Paper' : 'Ink';
    inv.addEventListener('click', function () {
      b.paper = !b.paper;
      root.classList.toggle('paper', b.paper);
      inv.classList.toggle('on', b.paper);
      inv.textContent = b.paper ? 'Paper' : 'Ink';
      paintText(root, b);
    });
    head.appendChild(inv);

    var del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '×';
    del.title = 'Remove this block';
    del.addEventListener('click', function () {
      state.blocks = state.blocks.filter(function (x) { return x !== b; });
      renderTesters();
    });
    head.appendChild(del);

    root.appendChild(head);

    var body = document.createElement('div');
    body.className = 'tester-body';
    root.appendChild(body);

    paintText(root, b);
    return root;
  }

  function paintText(root, b) {
    var body = root.querySelector('.tester-body');
    body.innerHTML = '';

    if (b.editing) {
      var ta = document.createElement('textarea');
      ta.className = 'tester-edit';
      ta.value = b.text;
      body.appendChild(ta);
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      var commit = function () {
        b.text = ta.value; b.editing = false; paintText(root, b);
      };
      ta.addEventListener('blur', commit);
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { b.editing = false; paintText(root, b); }
      });
      return;
    }

    var holder = document.createElement('div');
    holder.className = 'tester-text';
    holder.style.lineHeight = (b.lh / 100);
    holder.style.letterSpacing = b.tr + 'em';
    holder.style.fontSize = b.size + 'px';
    holder.style.color = b.paper ? '#000' : state.ink;
    holder.title = 'Click to edit this text';
    holder.addEventListener('click', function () { b.editing = true; paintText(root, b); });

    var words = b.text.split(/(\s+)/);
    words.forEach(function (chunk) {
      if (/^\s+$/.test(chunk)) {
        holder.appendChild(document.createTextNode(' '));
        return;
      }
      var word = document.createElement('span');
      word.className = 'word';
      for (var i = 0; i < chunk.length; i++) {
        var L = chunk[i].toUpperCase();
        if (!BASE[L]) continue;
        word.appendChild(glyphSvg(L, b.size));
      }
      if (word.childNodes.length) holder.appendChild(word);
    });

    body.appendChild(holder);
  }

  function repaintAllTesters() {
    var roots = testerList.querySelectorAll('.tester');
    for (var i = 0; i < roots.length; i++) paintText(roots[i], state.blocks[i]);
  }

  // ------------------------------------------------------------- glyph set
  function renderGlyphSet() {
    glyphSetEl.innerHTML = '';
    SETS.forEach(function (grp) {
      var g = document.createElement('div');
      g.className = 'glyphset-group';
      var lab = document.createElement('div');
      lab.className = 'glyphset-label';
      lab.textContent = grp[0];
      g.appendChild(lab);
      var row = document.createElement('div');
      row.className = 'glyphset-row';
      for (var i = 0; i < grp[1].length; i++) {
        (function (L) {
          if (!BASE[L]) return;
          var cell = document.createElement('div');
          cell.className = 'glyph-cell' + (L === state.selected ? ' selected' : '');
          cell.dataset.letter = L;
          cell.style.color = state.ink === '#000000' ? '#fff' : state.ink;
          cell.appendChild(glyphSvg(L, 46));
          cell.addEventListener('click', function () { selectLetter(L); });
          row.appendChild(cell);
        })(grp[1][i]);
      }
      g.appendChild(row);
      glyphSetEl.appendChild(g);
    });
  }

  // ----------------------------------------------------------------- editor
  function mkEl(t, a) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); return e; }

  // zoom / pan: viewBox is centered on (edCx, edCy) with span shrunk by edZoom
  var ED_PAD = 26;
  var ED_BW = GW + ED_PAD * 2, ED_BH = VB_H + 8;
  var ED_CX0 = -ED_PAD + ED_BW / 2, ED_CY0 = (VB_Y0 - 4) + ED_BH / 2;
  var edZoom = 1, edCx = ED_CX0, edCy = ED_CY0;

  function renderEditor() {
    var L = state.selected;
    badge.textContent = L;
    var vw = ED_BW / edZoom, vh = ED_BH / edZoom;
    var vx = edCx - vw / 2, vy = edCy - vh / 2;
    edSvg.setAttribute('viewBox', vx.toFixed(2) + ' ' + vy.toFixed(2) + ' ' + vw.toFixed(2) + ' ' + vh.toFixed(2));
    edSvg.innerHTML = '';
    for (var gx = 0; gx <= GW; gx += 12) edSvg.appendChild(mkEl('line', { x1: gx, y1: 0, x2: gx, y2: GH, stroke: '#1e1e1e', 'stroke-width': 0.6 }));
    for (var gy = 0; gy <= GH; gy += 12) edSvg.appendChild(mkEl('line', { x1: 0, y1: gy, x2: GW, y2: gy, stroke: '#1e1e1e', 'stroke-width': 0.6 }));
    edSvg.appendChild(mkEl('line', { x1: -ED_PAD, y1: GH, x2: GW + ED_PAD, y2: GH, stroke: '#3a3a3a', 'stroke-width': 1 }));

    edSvg.appendChild(mkEl('path', { d: ringsToD(ringsOf(L)), fill: '#3b3b3b', 'fill-rule': 'nonzero' }));

    chainsOf(L).forEach(function (c) {
      if (c.length < 2) return;
      edSvg.appendChild(mkEl('path', {
        d: 'M' + c.map(function (n) { return n[0].toFixed(1) + ',' + n[1].toFixed(1); }).join('L'),
        fill: 'none', stroke: '#6a6a6a', 'stroke-width': 0.9, 'stroke-dasharray': '3 2.5',
      }));
    });

    effNodes(L).forEach(function (n, i) {
      var act = i === state.activeNode;
      if (act) {
        edSvg.appendChild(mkEl('circle', {
          cx: n[0], cy: n[1], r: n[2] * state.mass, fill: 'none',
          stroke: '#ff5000', 'stroke-width': 1.1, 'stroke-dasharray': '3 2', opacity: 0.95,
        }));
        var g = mkEl('circle', { cx: n[0] + n[2] * state.mass, cy: n[1], r: 4.2 });
        g.setAttribute('class', 'rim-grip');
        g.addEventListener('pointerdown', function (e) { startDrag(e, i, 'radius'); });
        edSvg.appendChild(g);
      }
      var h = mkEl('circle', { cx: n[0], cy: n[1], r: act ? 4.6 : 3.4 });
      h.setAttribute('class', 'node-handle' + (act ? ' active' : ''));
      h.addEventListener('pointerdown', function (e) { startDrag(e, i, 'move'); });
      edSvg.appendChild(h);
    });
    updateUndo();
    updateNodeInspector();
  }

  // ---- zoom (scroll) & pan (drag empty canvas) for finer editing precision
  edSvg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = edSvg.getBoundingClientRect(), vb = edSvg.viewBox.baseVal;
    var mx = vb.x + (e.clientX - r.left) / r.width * vb.width;
    var my = vb.y + (e.clientY - r.top) / r.height * vb.height;
    var nz = Math.min(6, Math.max(0.6, edZoom * Math.pow(1.0016, -e.deltaY)));
    var k = edZoom / nz;
    edCx = mx + (edCx - mx) * k;
    edCy = my + (edCy - my) * k;
    edZoom = nz;
    renderEditor();
  }, { passive: false });

  var pan = null;
  edSvg.addEventListener('pointerdown', function (e) {
    pan = { sx: e.clientX, sy: e.clientY, cx: edCx, cy: edCy };
    window.addEventListener('pointermove', onPan);
    window.addEventListener('pointerup', onPanUp);
  });
  function onPan(e) {
    if (!pan) return;
    var r = edSvg.getBoundingClientRect(), vb = edSvg.viewBox.baseVal;
    var dx = (e.clientX - pan.sx) * (vb.width / r.width);
    var dy = (e.clientY - pan.sy) * (vb.height / r.height);
    edCx = pan.cx - dx; edCy = pan.cy - dy;
    renderEditor();
  }
  function onPanUp() {
    pan = null;
    window.removeEventListener('pointermove', onPan);
    window.removeEventListener('pointerup', onPanUp);
  }

  var drag = null;
  function userDelta(dx, dy) {
    var r = edSvg.getBoundingClientRect(), vb = edSvg.viewBox.baseVal;
    return [dx * (vb.width / r.width), dy * (vb.height / r.height)];
  }
  function startDrag(e, idx, mode) {
    e.preventDefault(); e.stopPropagation();
    pushUndo();
    state.activeNode = idx;
    var n = effNodes(state.selected)[idx];
    drag = { idx: idx, mode: mode, L: state.selected, sx: e.clientX, sy: e.clientY, start: n.slice() };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    renderEditor();
  }
  function onMove(e) {
    if (!drag) return;
    var d = userDelta(e.clientX - drag.sx, e.clientY - drag.sy);
    var base = FLAT[drag.L].nodes[drag.idx], cur;
    if (drag.mode === 'move') cur = [drag.start[0] + d[0], drag.start[1] + d[1], drag.start[2]];
    else cur = [drag.start[0], drag.start[1], Math.max(2, drag.start[2] + d[0] / state.mass)];
    setOverride(drag.L, drag.idx, [cur[0] - base[0], cur[1] - base[1], cur[2] - base[2]]);
    if (state.mirror) {
      var m = MIRROR[drag.L][drag.idx];
      if (m !== drag.idx) {
        var mb = FLAT[drag.L].nodes[m];
        setOverride(drag.L, m, [(GW - cur[0]) - mb[0], cur[1] - mb[1], cur[2] - mb[2]]);
      }
    }
    readout.textContent = (drag.mode === 'radius' ? 'radius ' + cur[2].toFixed(1) : 'x ' + Math.round(cur[0]) + '   y ' + Math.round(cur[1]))
      + (state.globalEdit ? '   · global' : '') + (state.mirror ? '   · mirrored' : '');
    schedule();
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    drag = null;
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      refreshDefs();          // instances are <use>, so this updates every preview
      renderEditor();
      renderGlyphSet();
    });
  }

  function pushUndo() {
    // snapshots overrides plus the currently-selected letter's node structure,
    // since Add/Delete Node mutate FLAT[L] directly (not just overrides)
    undoStack.push({
      g: JSON.stringify(globalOv), l: JSON.stringify(letterOv),
      L: state.selected, flat: JSON.stringify(FLAT[state.selected]),
    });
    if (undoStack.length > 60) undoStack.shift();
    updateUndo();
  }
  function undo() {
    if (!undoStack.length) return;
    var s = undoStack.pop();
    globalOv = JSON.parse(s.g); letterOv = JSON.parse(s.l);
    FLAT[s.L] = JSON.parse(s.flat);
    MIRROR[s.L] = computeMirrorMap(s.L);
    if (state.activeNode >= FLAT[state.selected].nodes.length) state.activeNode = -1;
    globalVer++; Object.keys(letterVer).forEach(function (k) { letterVer[k]++; });
    schedule();
  }
  function updateUndo() {
    var b = $('btnUndo');
    if (undoStack.length) b.removeAttribute('disabled'); else b.setAttribute('disabled', 'true');
  }
  function selectLetter(L) {
    if (!BASE[L]) return;
    state.selected = L; state.activeNode = -1;
    renderEditor();
    glyphSetEl.querySelectorAll('.glyph-cell').forEach(function (c) {
      c.classList.toggle('selected', c.dataset.letter === L);
    });
  }

  // -------------------------------------------------- structural node edits
  // bakes current effective (overridden) node positions into FLAT[L] as the
  // new base, clearing that letter's overrides — needed before any
  // insert/delete since those resize the node array and would otherwise
  // desync the index-keyed override maps.
  function commitLetterNodes(L) {
    var eff = effNodes(L);
    FLAT[L] = { nodes: eff.map(function (n) { return n.slice(); }), lens: FLAT[L].lens.slice() };
    if (letterOv[L]) delete letterOv[L];
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
  function addNode() {
    var L = state.selected, idx = state.activeNode;
    if (idx < 0) return;
    var rng = chainRangeOf(L, idx);
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
    state.activeNode = insertAt;
    letterVer[L]++;
    schedule();
    toast('Node added — drag it to shape the curve');
  }
  function deleteNode() {
    var L = state.selected, idx = state.activeNode;
    if (idx < 0) return;
    var rng = chainRangeOf(L, idx);
    if (!rng || rng.ce - rng.cs + 1 <= 2) { toast('This chain needs at least 2 nodes'); return; }
    pushUndo();
    commitLetterNodes(L);
    FLAT[L].nodes.splice(idx, 1);
    FLAT[L].lens[rng.ci] -= 1;
    MIRROR[L] = computeMirrorMap(L);
    state.activeNode = -1;
    letterVer[L]++;
    schedule();
    toast('Node removed');
  }

  // ---------------------------------------------------------- node inspector
  function updateNodeInspector() {
    var L = state.selected, idx = state.activeNode;
    var has = idx >= 0 && idx < FLAT[L].nodes.length;
    [nodeXEl, nodeYEl, nodeREl, addNodeBtn, delNodeBtn].forEach(function (el) {
      if (has) el.removeAttribute('disabled'); else el.setAttribute('disabled', 'true');
    });
    if (!has) { nodeXEl.value = ''; nodeYEl.value = ''; nodeREl.value = ''; return; }
    var n = effNodes(L)[idx];
    if (document.activeElement !== nodeXEl) nodeXEl.value = n[0].toFixed(1);
    if (document.activeElement !== nodeYEl) nodeYEl.value = n[1].toFixed(1);
    if (document.activeElement !== nodeREl) nodeREl.value = n[2].toFixed(1);
  }
  function applyNodeField() {
    var L = state.selected, idx = state.activeNode;
    if (idx < 0) return;
    var base = FLAT[L].nodes[idx];
    var x = parseFloat(nodeXEl.value), y = parseFloat(nodeYEl.value), r = Math.max(2, parseFloat(nodeREl.value));
    if (isNaN(x) || isNaN(y) || isNaN(r)) return;
    pushUndo();
    setOverride(L, idx, [x - base[0], y - base[1], r - base[2]]);
    if (state.mirror) {
      var m = MIRROR[L][idx];
      if (m !== idx) {
        var mb = FLAT[L].nodes[m];
        setOverride(L, m, [(GW - x) - mb[0], y - mb[1], r - mb[2]]);
      }
    }
    schedule();
  }
  [nodeXEl, nodeYEl, nodeREl].forEach(function (el) { el.addEventListener('change', applyNodeField); });
  addNodeBtn.addEventListener('click', addNode);
  delNodeBtn.addEventListener('click', deleteNode);

  // ---------------------------------------------------------------- controls
  function bind(id, valId, key, fmt) {
    var el = $(id);
    el.value = state[key];
    $(valId).textContent = fmt ? fmt(state[key]) : state[key];
    el.addEventListener('input', function () {
      state[key] = parseFloat(el.value);
      $(valId).textContent = fmt ? fmt(state[key]) : state[key];
      schedule();
    });
  }
  var f1 = function (v) { return v.toFixed(1); }, f2 = function (v) { return v.toFixed(2); };
  bind('sldMass', 'valMass', 'mass', f2);
  bind('sldMelt', 'valMelt', 'melt', null);
  bind('sldTension', 'valTension', 'tension', f1);
  bind('sldWobble', 'valWobble', 'wobble', f1);
  bind('sldSmooth', 'valSmooth', 'smooth', null);

  function toggle(id, key) {
    var b = $(id);
    b.addEventListener('click', function () { state[key] = !state[key]; b.classList.toggle('active', state[key]); });
  }
  toggle('btnGlobalEdit', 'globalEdit');
  toggle('btnMirror', 'mirror');
  $('btnUndo').addEventListener('click', undo);
  $('btnResetGlyph').addEventListener('click', function () {
    pushUndo(); delete letterOv[state.selected]; letterVer[state.selected]++;
    schedule(); toast('Glyph reset');
  });
  $('btnReseed').addEventListener('click', function () {
    state.seed = Math.floor(Math.random() * 100000);
    $('seedLabel').textContent = '#' + state.seed;
    schedule();
  });
  $('seedLabel').textContent = '#' + state.seed;

  $('btnAddBlock').addEventListener('click', function () {
    state.blocks.push({ id: ++uid, text: 'NEW PREVIEW BLOCK', size: 72, lh: 120, tr: 0.01, paper: false, editing: false });
    renderTesters();
  });

  $('presetSelect').addEventListener('change', function (e) {
    var p = PRESETS[e.target.value]; if (!p) return;
    state.preset = e.target.value;
    Object.keys(p).forEach(function (k) { state[k] = p[k]; });
    syncShape(); schedule();
  });
  function syncShape() {
    $('sldMass').value = state.mass; $('valMass').textContent = f2(state.mass);
    $('sldMelt').value = state.melt; $('valMelt').textContent = state.melt;
    $('sldTension').value = state.tension; $('valTension').textContent = f1(state.tension);
    $('sldWobble').value = state.wobble; $('valWobble').textContent = f1(state.wobble);
    $('sldSmooth').value = state.smooth; $('valSmooth').textContent = state.smooth;
  }

  $('fontNameInput').addEventListener('input', function (e) {
    state.fontName = e.target.value || 'Untitled';
    testerList.querySelectorAll('[data-role=name]').forEach(function (n) { n.textContent = state.fontName; });
  });

  var sw = $('swatchRow');
  PALETTE.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'swatch' + (c === state.ink ? ' active' : '');
    b.style.background = c;
    b.addEventListener('click', function () {
      state.ink = c;
      sw.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('active'); });
      b.classList.add('active');
      repaintAllTesters(); renderGlyphSet();
    });
    sw.appendChild(b);
  });
  $('glyphCountMeta').textContent = Object.keys(BASE).length + ' glyphs';

  // ----------------------------------------------------------------- exports
  function buildSVG() {
    var b = state.blocks[0] || { text: 'OOZE', size: 140, tr: 0.01 };
    var size = b.size, scale = size / GH, gap = b.tr * size;
    var x = 40, y = 40, out = '', maxX = 0, maxW = 1700, lh = size * 1.25;
    var txt = b.text;
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (/\s/.test(ch)) { x += SPACE * scale + gap; continue; }
      var L = ch.toUpperCase(); if (!BASE[L]) continue;
      var rings = ringsOf(L), bb = inkBounds(rings);
      var w = (bb[1] - bb[0] + SIDE * 2) * scale;
      if (x + w > maxW) { x = 40; y += lh; }
      out += '<path d="' + ringsToD(rings) + '" transform="translate(' + (x - (bb[0] - SIDE) * scale) + ',' + y + ') scale(' + scale + ')" fill="' + (state.ink === '#000000' ? '#000' : state.ink) + '" fill-rule="nonzero"/>';
      x += w + gap;
      if (x > maxX) maxX = x;
    }
    var tw = Math.min(maxW, maxX) + 40, th = y + size + 40;
    var bg = state.ink === '#000000' ? '#ffffff' : '#000000';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + tw + '" height="' + th + '" viewBox="0 0 ' + tw + ' ' + th + '"><rect width="100%" height="100%" fill="' + bg + '"/>' + out + '</svg>';
  }
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
    dl(new Blob([buildSVG()], { type: 'image/svg+xml' }), safeName() + '.svg'); toast('SVG exported');
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
      c.toBlob(function (bl) { dl(bl, safeName() + '.png'); toast('PNG exported'); });
      URL.revokeObjectURL(u);
    };
    img.onerror = function () { toast('PNG export failed'); URL.revokeObjectURL(u); };
    img.src = u;
  });
  $('btnExportOtf').addEventListener('click', function () {
    var b = $('btnExportOtf'), lbl = b.textContent;
    b.setAttribute('disabled', 'true'); b.textContent = 'Pouring…';
    setTimeout(function () {
      try { buildOtf(); toast('OTF exported — install it like any font file'); }
      catch (e) { console.error(e); toast('OTF export failed: ' + e.message, 4000); }
      finally { b.removeAttribute('disabled'); b.textContent = lbl; }
    }, 30);
  });
  function buildOtf() {
    var UPM = 1000, SC = UPM / GH;
    var glyphs = [
      new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 600, path: new opentype.Path() }),
      new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: Math.round(SPACE * SC), path: new opentype.Path() }),
    ];
    Object.keys(BASE).forEach(function (L) {
      var rings = ringsOf(L), bb = inkBounds(rings);
      var path = new opentype.Path(), ox = -bb[0] + SIDE;
      rings.forEach(function (r) {
        path.moveTo((r[0][0] + ox) * SC, (GH - r[0][1]) * SC);
        for (var i = 1; i < r.length; i++) path.lineTo((r[i][0] + ox) * SC, (GH - r[i][1]) * SC);
        path.close();
      });
      glyphs.push(new opentype.Glyph({
        name: L, unicode: L.charCodeAt(0),
        advanceWidth: Math.round((bb[1] - bb[0] + SIDE * 2) * SC), path: path,
      }));
    });
    var style = state.preset.charAt(0).toUpperCase() + state.preset.slice(1);
    var font = new opentype.Font({
      familyName: state.fontName || 'Untitled', styleName: style, unitsPerEm: UPM,
      ascender: Math.round(UPM * 0.92), descender: -Math.round(UPM * 0.22), glyphs: glyphs,
    });
    dl(new Blob([font.toArrayBuffer()], { type: 'font/otf' }), safeName() + '.otf');
  }

  // -------------------------------------------------------------------- boot
  syncShape();
  refreshDefs();
  renderTesters();
  renderGlyphSet();
  renderEditor();
})();
