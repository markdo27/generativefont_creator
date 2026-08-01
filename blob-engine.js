// ---------------------------------------------------------------------------
// Metaball / SDF letterform engine.
//
// A glyph is a set of chains of NODES, each node carrying its own radius.
// Consecutive nodes are joined by a tapered capsule (radius lerps along the
// segment -> variable stroke thickness). All capsules are combined with a
// polynomial smooth-minimum, which makes the mass pool and bulge where
// strokes meet, exactly like a viscous liquid.
//
// The resulting scalar field is contoured with marching squares and then
// Chaikin-smoothed, so every edge comes out round -- there are no straight
// lines or corners anywhere in the output by construction.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.BlobEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- noise
  function hash2(ix, iy, seed) {
    var h = ix * 374761393 + iy * 668265263 + seed * 1274126177;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }
  function valueNoise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
  }

  // ------------------------------------------------------------------ sdf
  // Tapered capsule: distance to the segment a-b whose radius lerps ra->rb.
  function sdTaperedCapsule(px, py, ax, ay, ra, bx, by, rb) {
    var bax = bx - ax, bay = by - ay;
    var l2 = bax * bax + bay * bay;
    var t = l2 > 1e-9 ? ((px - ax) * bax + (py - ay) * bay) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var cx = ax + bax * t, cy = ay + bay * t;
    var dx = px - cx, dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy) - (ra + (rb - ra) * t);
  }

  // Polynomial smooth minimum — the "melt". k=0 is a hard union.
  function smin(a, b, k) {
    if (k <= 1e-6) return a < b ? a : b;
    var h = k - Math.abs(a - b);
    if (h < 0) h = 0;
    h /= k;
    return (a < b ? a : b) - h * h * k * 0.25;
  }

  // Flatten chains into a capsule list once, so the field loop stays tight.
  function buildCapsules(chains, mass) {
    var caps = [];
    for (var c = 0; c < chains.length; c++) {
      var ch = chains[c];
      if (ch.length === 1) {
        var n = ch[0];
        caps.push([n[0], n[1], n[2] * mass, n[0], n[1], n[2] * mass]);
        continue;
      }
      for (var i = 0; i < ch.length - 1; i++) {
        var a = ch[i], b = ch[i + 1];
        caps.push([a[0], a[1], a[2] * mass, b[0], b[1], b[2] * mass]);
      }
    }
    return caps;
  }

  function makeField(caps, opts) {
    var melt = opts.melt, tension = opts.tension;
    var wob = opts.wobble, grain = opts.grain, seed = opts.seed;
    return function (px, py) {
      var d = 1e9;
      for (var i = 0; i < caps.length; i++) {
        var c = caps[i];
        var di = sdTaperedCapsule(px, py, c[0], c[1], c[2], c[3], c[4], c[5]);
        d = smin(d, di, melt);
      }
      if (wob > 0) {
        // two octaves of drifting noise = molten, uneven surface
        var n = valueNoise(px * grain, py * grain, seed) - 0.5;
        n += (valueNoise(px * grain * 2.3, py * grain * 2.3, seed + 91) - 0.5) * 0.5;
        d += n * wob;
      }
      return d - tension;
    };
  }

  // -------------------------------------------------------- marching squares
  var CASES = [
    [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
    [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
  ];

  function contour(field, bounds, res) {
    var x0 = bounds[0], y0 = bounds[1], x1 = bounds[2], y1 = bounds[3];
    var nx = Math.max(2, Math.ceil((x1 - x0) / res));
    var ny = Math.max(2, Math.ceil((y1 - y0) / res));
    var hx = (x1 - x0) / nx, hy = (y1 - y0) / ny;

    // sample grid once
    var V = new Float64Array((nx + 1) * (ny + 1));
    for (var j = 0; j <= ny; j++) {
      for (var i = 0; i <= nx; i++) {
        V[j * (nx + 1) + i] = field(x0 + i * hx, y0 + j * hy);
      }
    }

    var segs = [];
    function interp(va, vb, ax, ay, bx, by) {
      var t = va / (va - vb);
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }

    for (var jj = 0; jj < ny; jj++) {
      for (var ii = 0; ii < nx; ii++) {
        var v00 = V[jj * (nx + 1) + ii];
        var v10 = V[jj * (nx + 1) + ii + 1];
        var v11 = V[(jj + 1) * (nx + 1) + ii + 1];
        var v01 = V[(jj + 1) * (nx + 1) + ii];
        var idx = (v00 < 0 ? 1 : 0) | (v10 < 0 ? 2 : 0) | (v11 < 0 ? 4 : 0) | (v01 < 0 ? 8 : 0);
        if (idx === 0 || idx === 15) continue;

        var cx0 = x0 + ii * hx, cy0 = y0 + jj * hy;
        var cx1 = cx0 + hx, cy1 = cy0 + hy;
        var E = [
          v00 !== v10 ? interp(v00, v10, cx0, cy0, cx1, cy0) : [cx0, cy0], // top
          v10 !== v11 ? interp(v10, v11, cx1, cy0, cx1, cy1) : [cx1, cy0], // right
          v11 !== v01 ? interp(v11, v01, cx1, cy1, cx0, cy1) : [cx1, cy1], // bottom
          v01 !== v00 ? interp(v01, v00, cx0, cy1, cx0, cy0) : [cx0, cy1], // left
        ];

        var cs = CASES[idx];
        // saddle disambiguation via the cell-centre sample
        if (idx === 5 || idx === 10) {
          var mid = field((cx0 + cx1) / 2, (cy0 + cy1) / 2);
          if ((idx === 5) === (mid >= 0)) cs = idx === 5 ? [[3, 2], [1, 0]] : [[0, 3], [2, 1]];
        }
        for (var s = 0; s < cs.length; s++) segs.push([E[cs[s][0]], E[cs[s][1]]]);
      }
    }
    return segs;
  }

  // ------------------------------------------------------------- stitching
  // Walk segments into closed rings WITHOUT assuming a consistent direction.
  // Marching-squares saddle cells can emit a segment wound opposite to its
  // neighbours; a head-to-tail-only walk stalls there and leaves the ring
  // open, which later renders as a straight chord across the glyph. Matching
  // either endpoint makes the trace robust — final winding is fixed later by
  // the containment pass anyway.
  function stitch(segs, tol) {
    var key = function (p) { return Math.round(p[0] / tol) + ':' + Math.round(p[1] / tol); };
    var ends = new Map();
    function add(k, rec) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(rec);
    }
    for (var i = 0; i < segs.length; i++) {
      add(key(segs[i][0]), [i, 0]);
      add(key(segs[i][1]), [i, 1]);
    }

    var used = new Array(segs.length).fill(false);
    var rings = [];
    for (var s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = true;
      var ring = [segs[s][0], segs[s][1]];
      var startKey = key(segs[s][0]);
      var guard = 0, flipped = false, closedRing = false;
      while (guard++ < 200000) {
        var tail = ring[ring.length - 1];
        var tk = key(tail);
        if (tk === startKey && ring.length > 2) { closedRing = true; break; }
        var cand = ends.get(tk), nxt = -1, nend = 0;
        if (cand) {
          for (var c = 0; c < cand.length; c++) {
            if (!used[cand[c][0]]) { nxt = cand[c][0]; nend = cand[c][1]; break; }
          }
        }
        if (nxt < 0) {
          // Dead end. The seed segment may have started mid-contour, so turn
          // around and keep growing from the other end before giving up —
          // otherwise a contour gets shredded into orphan fragments.
          if (flipped) break;
          flipped = true;
          ring.reverse();
          startKey = key(ring[0]);
          continue;
        }
        used[nxt] = true;
        ring.push(segs[nxt][nend === 0 ? 1 : 0]);
      }
      // Keep every fragment, however short — repairChains reassembles them.
      // Dropping them here silently deletes whole limbs of a glyph.
      if (ring.length >= 2) rings.push(ring);
    }
    return rings;
  }

  // A single closed contour can still get split into open chains where the
  // shape pinches and four segment-ends meet in one cell. Reassemble by
  // repeatedly joining whichever two open chains have the nearest endpoints,
  // then closing what remains.
  function repairChains(chains, tol) {
    var d2 = function (a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; };
    var closed = [], open = [];
    for (var i = 0; i < chains.length; i++) {
      var c = chains[i];
      (d2(c[0], c[c.length - 1]) <= tol * tol ? closed : open).push(c);
    }

    var joined = true;
    while (joined && open.length > 1) {
      joined = false;
      var bestD = Infinity, bi = -1, bj = -1, mode = 0;
      for (var a = 0; a < open.length && !joined; a++) {
        for (var b = a + 1; b < open.length; b++) {
          var A = open[a], B = open[b];
          var cands = [
            [d2(A[A.length - 1], B[0]), 0],
            [d2(A[A.length - 1], B[B.length - 1]), 1],
            [d2(A[0], B[0]), 2],
            [d2(A[0], B[B.length - 1]), 3],
          ];
          for (var k = 0; k < 4; k++) {
            if (cands[k][0] < bestD) { bestD = cands[k][0]; bi = a; bj = b; mode = cands[k][1]; }
          }
        }
      }
      if (bi >= 0 && bestD <= tol * tol) {
        var A2 = open[bi], B2 = open[bj];
        var merged;
        if (mode === 0) merged = A2.concat(B2);
        else if (mode === 1) merged = A2.concat(B2.slice().reverse());
        else if (mode === 2) merged = A2.slice().reverse().concat(B2);
        else merged = B2.concat(A2);
        open.splice(bj, 1); open.splice(bi, 1);
        open.push(merged);
        joined = true;
      }
    }

    for (var m = 0; m < open.length; m++) {
      if (open[m].length > 4) closed.push(open[m]); // implicit close
    }
    return closed;
  }

  // --------------------------------------------------------------- smoothing
  function chaikin(ring, iters) {
    var pts = ring.slice();
    if (pts.length > 2) {
      var a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts.pop();
    }
    for (var it = 0; it < iters; it++) {
      var n = pts.length;
      if (n < 4) break;
      var out = new Array(n * 2);
      for (var i = 0; i < n; i++) {
        var p = pts[i], q = pts[(i + 1) % n];
        out[i * 2] = [p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25];
        out[i * 2 + 1] = [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75];
      }
      pts = out;
    }
    return pts;
  }

  // ------------------------------------------------------------- decimation
  // Chaikin quadruples the point count; thin it back out with Douglas-Peucker
  // so the contour stays smooth but exportable (font charstrings and polygon
  // maths both choke on thousands of near-collinear points).
  function pointSegDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  function dpChain(pts, first, last, tol, keep) {
    var stack = [[first, last]];
    while (stack.length) {
      var fl = stack.pop(), f = fl[0], l = fl[1];
      if (l <= f + 1) continue;
      var maxD = -1, idx = -1;
      for (var i = f + 1; i < l; i++) {
        var d = pointSegDist(pts[i], pts[f], pts[l]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol) { keep[idx] = true; stack.push([f, idx], [idx, l]); }
    }
  }
  function decimateRing(ring, tol) {
    var n = ring.length;
    if (n < 8) return ring;
    var keep = new Array(n).fill(false);
    var anchor = 0, far = -1;
    for (var i = 1; i < n; i++) {
      var d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
      if (d > far) { far = d; anchor = i; }
    }
    keep[0] = true; keep[anchor] = true;
    dpChain(ring, 0, anchor, tol, keep);
    var tail = ring.slice(anchor).concat([ring[0]]);
    var tk = new Array(tail.length).fill(false);
    tk[0] = true; tk[tail.length - 1] = true;
    dpChain(tail, 0, tail.length - 1, tol, tk);
    for (var j = 1; j < tail.length - 1; j++) if (tk[j]) keep[anchor + j] = true;
    var out = [];
    for (var k = 0; k < n; k++) if (keep[k]) out.push(ring[k]);
    return out.length >= 6 ? out : ring;
  }

  // ------------------------------------------------------------ orientation
  function signedArea(r) {
    var a = 0;
    for (var i = 0; i < r.length; i++) {
      var p = r[i], q = r[(i + 1) % r.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  function pointInRing(pt, ring) {
    var inside = false, x = pt[0], y = pt[1];
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // ------------------------------------------------------------- main entry
  // Shared tail of the pipeline: a scalar field + bounds go in, clean,
  // correctly-wound, hole-punched rings come out. Used both by the capsule
  // (hand-authored glyph) field below and by any other field a caller
  // constructs (e.g. a rasterized/blurred canvas alpha channel).
  function ringsFromField(field, bounds, o, debug) {
    var segs = contour(field, bounds, o.res);
    if (!segs.length) return [];
    if (debug) {
      var raw = stitch(segs, o.res * 0.05);
      return { segs: segs.length, raw: raw.map(function (r) { return r.length; }),
               rawRings: raw, bounds: bounds };
    }
    var rings = repairChains(stitch(segs, o.res * 0.05), o.res * 4)
      .map(function (r) { return chaikin(r, o.smooth); })
      .map(function (r) { return o.simplify > 0 ? decimateRing(r, o.simplify) : r; })
      .filter(function (r) { return r.length > 5 && Math.abs(signedArea(r)) > 0.8; });

    // Outer shells wound one way, counters the other, so a nonzero fill (what
    // OpenType uses) punches the holes correctly.
    return rings.map(function (r, i) {
      var depth = 0;
      for (var j = 0; j < rings.length; j++) {
        if (j !== i && pointInRing(r[0], rings[j])) depth++;
      }
      var wantPositive = depth % 2 === 0;
      var isPositive = signedArea(r) > 0;
      return isPositive === wantPositive ? r : r.slice().reverse();
    });
  }

  function glyphRings(chains, opts) {
    var o = {
      mass: opts.mass == null ? 1 : opts.mass,
      melt: opts.melt == null ? 10 : opts.melt,
      tension: opts.tension == null ? 0 : opts.tension,
      wobble: opts.wobble == null ? 0 : opts.wobble,
      grain: opts.grain == null ? 0.045 : opts.grain,
      seed: opts.seed == null ? 1 : opts.seed,
      smooth: opts.smooth == null ? 2 : opts.smooth,
      res: opts.res == null ? 1.7 : opts.res,
      simplify: opts.simplify == null ? 0.3 : opts.simplify,
    };
    var caps = buildCapsules(chains, o.mass);
    if (!caps.length) return [];

    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (var i = 0; i < caps.length; i++) {
      var c = caps[i];
      minX = Math.min(minX, c[0] - c[2], c[3] - c[5]);
      maxX = Math.max(maxX, c[0] + c[2], c[3] + c[5]);
      minY = Math.min(minY, c[1] - c[2], c[4] - c[5]);
      maxY = Math.max(maxY, c[1] + c[2], c[4] + c[5]);
    }
    // headroom for melt bulge, tension inflation and noise displacement
    var pad = o.melt * 0.5 + Math.abs(o.tension) + o.wobble + o.res * 3;
    var bounds = [minX - pad, minY - pad, maxX + pad, maxY + pad];

    var field = makeField(caps, o);
    return ringsFromField(field, bounds, o, opts._debug);
  }

  // Generic entry point: trace any scalar field(x,y) -> number (negative =
  // inside) over `bounds` = [x0,y0,x1,y1]. Lets callers build their own field
  // (e.g. from a rasterized/blurred canvas) and still get the same
  // marching-squares + stitch + repair + Chaikin + hole-punch treatment.
  function traceField(field, bounds, opts) {
    opts = opts || {};
    var o = {
      smooth: opts.smooth == null ? 2 : opts.smooth,
      res: opts.res == null ? 1.7 : opts.res,
      simplify: opts.simplify == null ? 0.3 : opts.simplify,
    };
    return ringsFromField(field, bounds, o, opts._debug);
  }

  return {
    glyphRings: glyphRings,
    signedArea: signedArea,
    traceField: traceField,
    valueNoise: valueNoise,
  };
});
