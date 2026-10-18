// ---------------------------------------------------------------------------
// Metaball / SDF letterform engine.
//
// A glyph is a set of chains of NODES, each node carrying its own radius.
// Each chain is drawn as a smooth spline through its nodes (radius splined
// too -> variable stroke thickness), cut into short tapered capsules. The
// strokes are combined with a polynomial smooth-minimum, which makes the mass
// pool into the joints where strokes meet, exactly like a viscous liquid.
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
  // ------------------------------------------------------------ presets
  // The Flow states, shared by the Font tool and the Poster tool. Melt is
  // capped per point (see makeField), so counters stay open even when the
  // mass is allowed to pool heavily at the joints.
  var PRESETS = {
    liquid:  { mass: 0.98, melt: 14, tension: -4,   wobble: 0,   grain: 0.045, smooth: 2, res: 1.6 },
    mercury: { mass: 1.00, melt: 22, tension: -3,   wobble: 0,   grain: 0.045, smooth: 3, res: 1.6 },
    acid:    { mass: 1.00, melt: 17, tension: -3,   wobble: 2.6, grain: 0.050, smooth: 3, res: 1.5 },
    molten:  { mass: 1.04, melt: 19, tension: -1.5, wobble: 1.2, grain: 0.040, smooth: 3, res: 1.6 },
    bubble:  { mass: 0.94, melt: 7,  tension: -7,   wobble: 0,   grain: 0.045, smooth: 2, res: 1.6 },
    goo:     { mass: 1.01, melt: 18, tension: -2.5, wobble: 3.6, grain: 0.070, smooth: 3, res: 1.5 },
  };

  // ------------------------------------------------------------- skeleton
  // Chains are drawn through their nodes as a centripetal Catmull-Rom spline
  // (radius splined too), then cut into short tapered capsules, so a round
  // reads as one smooth stroke instead of a polygon with a bump at each node.
  // The editor's nodes are untouched: the spline passes through every one.
  //
  // A node where the stroke turns sharply (> ~75 deg) is a CORNER: the spline
  // breaks there and the two sides meet at an angle, filleted by the melt.
  // Between corners a stretch of chain is one PIECE, hard-unioned (no melt
  // inside a piece, hence no bulge at every sub-node); pieces then melt into
  // each other with the smooth-min. A chain whose first node carries a 4th
  // element 1 ([x, y, r, 1]) starts a new GROUP: groups never melt together
  // (hard union), which keeps the dot of ! ? ; : off its stem.
  var STRIDE = 8;                         // ax ay ra bx by rb piece group
  var CORNER_LO = 60 * Math.PI / 180;     // turn below this: fully smooth
  var CORNER_HI = 90 * Math.PI / 180;     // turn above this: a hard corner
  var SUB_ANGLE = 11 * Math.PI / 180;     // max tangent turn per sub-span
  var SUB_MAX = 8;

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }
  function turnAngle(a, b, c) {
    var ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    var lu = Math.sqrt(ux * ux + uy * uy), lv = Math.sqrt(vx * vx + vy * vy);
    if (lu < 1e-9 || lv < 1e-9) return Math.PI;
    var cs = (ux * vx + uy * vy) / (lu * lv);
    return Math.acos(cs < -1 ? -1 : cs > 1 ? 1 : cs);
  }
  // Centripetal Catmull-Rom tangent at p1 for the span p1 -> p2, in span
  // parameter units (Barry-Goldman form), for x, y and r alike.
  function crTangent(p0, p1, p2, d01, d12) {
    var out = [0, 0, 0];
    for (var c = 0; c < 3; c++) {
      out[c] = d12 * ((p1[c] - p0[c]) / d01 - (p2[c] - p0[c]) / (d01 + d12) + (p2[c] - p1[c]) / d12);
    }
    return out;
  }

  function buildSkeleton(chains, mass) {
    var out = [];
    var piece = -1, group = 0;
    function push(a, b) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], piece, group); }
    for (var c = 0; c < chains.length; c++) {
      var ch = chains[c];
      if (!ch || !ch.length) continue;
      if (ch[0].length > 3 && ch[0][3] === 1 && out.length) group++;
      // scaled copy, consecutive duplicates collapsed
      var pts = [];
      for (var q = 0; q < ch.length; q++) {
        var nd = ch[q], p = [+nd[0], +nd[1], Math.max(0, nd[2] * mass)];
        var last = pts[pts.length - 1];
        if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) {
          if (p[2] > last[2]) last[2] = p[2];
        } else pts.push(p);
      }
      piece++;
      if (pts.length === 1) { push(pts[0], pts[0]); continue; }
      var n = pts.length;
      var closed = n >= 4 && Math.abs(pts[0][0] - pts[n - 1][0]) < 0.5 && Math.abs(pts[0][1] - pts[n - 1][1]) < 0.5;
      if (closed) { pts.pop(); n--; }
      var w = new Array(n);
      for (var i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) w[i] = 1;
        else w[i] = smoothstep(CORNER_LO, CORNER_HI, turnAngle(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]));
      }
      if (closed) {
        // start a cornered loop at a corner, so its first and last spans
        // belong to different pieces only where the loop really breaks
        var rot = -1;
        for (var ci = 0; ci < n; ci++) if (w[ci] >= 0.5) { rot = ci; break; }
        if (rot > 0) { pts = pts.slice(rot).concat(pts.slice(0, rot)); w = w.slice(rot).concat(w.slice(0, rot)); }
      }
      var spans = closed ? n : n - 1;
      for (var s = 0; s < spans; s++) {
        var ia = s, ib = (s + 1) % n;
        if (s > 0 && w[ia] >= 0.5) piece++;
        var P1 = pts[ia], P2 = pts[ib];
        var chord = [P2[0] - P1[0], P2[1] - P1[1], P2[2] - P1[2]];
        var d12 = Math.sqrt(Math.sqrt(chord[0] * chord[0] + chord[1] * chord[1]));
        var m1 = chord, m2 = chord;
        if (w[ia] < 1) {
          var P0 = pts[(ia - 1 + n) % n];
          var d01 = Math.sqrt(Math.hypot(P1[0] - P0[0], P1[1] - P0[1]));
          var t1 = crTangent(P0, P1, P2, d01, d12);
          m1 = [t1[0] + (chord[0] - t1[0]) * w[ia], t1[1] + (chord[1] - t1[1]) * w[ia], t1[2] + (chord[2] - t1[2]) * w[ia]];
        }
        if (w[ib] < 1) {
          var P3 = pts[(ib + 1) % n];
          var d23 = Math.sqrt(Math.hypot(P3[0] - P2[0], P3[1] - P2[1]));
          // tangent at p2 = tangent of the reversed span at its start, negated
          var t2 = crTangent(P3, P2, P1, d23, d12);
          m2 = [-t2[0] + (chord[0] + t2[0]) * w[ib], -t2[1] + (chord[1] + t2[1]) * w[ib], -t2[2] + (chord[2] + t2[2]) * w[ib]];
        }
        // how far the tangent swings along the span decides the sub-spans
        var l1 = Math.hypot(m1[0], m1[1]), l2 = Math.hypot(m2[0], m2[1]);
        var phi = 0;
        if (l1 > 1e-9 && l2 > 1e-9) {
          var cs = (m1[0] * m2[0] + m1[1] * m2[1]) / (l1 * l2);
          phi = Math.acos(cs < -1 ? -1 : cs > 1 ? 1 : cs);
        }
        var sub = Math.max(1, Math.min(SUB_MAX, Math.ceil(phi / SUB_ANGLE - 1e-9)));
        var rlo = Math.min(P1[2], P2[2]), rhi = Math.max(P1[2], P2[2]);
        var prev = P1;
        for (var k = 1; k <= sub; k++) {
          var cur;
          if (k === sub) cur = P2;
          else {
            var u = k / sub, u2 = u * u, u3 = u2 * u;
            var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
            var r = h00 * P1[2] + h10 * m1[2] + h01 * P2[2] + h11 * m2[2];
            cur = [h00 * P1[0] + h10 * m1[0] + h01 * P2[0] + h11 * m2[0],
                   h00 * P1[1] + h10 * m1[1] + h01 * P2[1] + h11 * m2[1],
                   r < rlo ? rlo : r > rhi ? rhi : r];
          }
          push(prev, cur);
          prev = cur;
        }
      }
    }
    return out;
  }

  // Legacy shape, kept for anything that inspected the capsule list:
  // [ax, ay, ra, bx, by, rb] per capsule (now post-subdivision).
  function buildCapsules(chains, mass) {
    var sk = buildSkeleton(chains, mass), caps = [];
    for (var i = 0; i < sk.length; i += STRIDE) caps.push(sk.slice(i, i + 6));
    return caps;
  }

  function skeletonBounds(sk) {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (var i = 0; i < sk.length; i += STRIDE) {
      var ra = sk[i + 2], rb = sk[i + 5];
      minX = Math.min(minX, sk[i] - ra, sk[i + 3] - rb);
      maxX = Math.max(maxX, sk[i] + ra, sk[i + 3] + rb);
      minY = Math.min(minY, sk[i + 1] - ra, sk[i + 4] - rb);
      maxY = Math.max(maxY, sk[i + 1] + ra, sk[i + 4] + rb);
    }
    return [minX, minY, maxX, maxY];
  }

  // The field: per point, each piece is the hard minimum of its capsules;
  // pieces are folded in with the sequential smooth-min (k = melt), and the
  // result is capped at one pairwise blend below the hard minimum, so a
  // counter ringed by many pieces can't be eaten by melt/4 over and over.
  //
  // Spatial culling: capsules are binned into a bucket grid, each bucket
  // listing only the capsules that can still change the field near the
  // contour there (bbox grown by `reach`). Anything farther is provably
  // irrelevant: its distance exceeds every in-bucket hard minimum that can
  // reach the zero level by more than the melt width.
  var BUCKET = 8;
  function makeField(sk, opts, bounds) {
    var melt = opts.melt, tension = opts.tension;
    var wob = opts.wobble, grain = opts.grain, seed = opts.seed;
    var res = opts.res || 1.7;
    var k = melt > 1e-6 ? melt : 0, kq = k * 0.25;
    var ncap = sk.length / STRIDE;
    // Exactness is needed wherever the hard minimum dh can still reach the
    // contour (dh <= T): within interpolation range of zero, or within the
    // coarse sampler's skip radius (see sampleGrid). Capsules farther than
    // T + melt from such a point cannot change its value.
    var lip = opts.lip || 1;
    var skip = lip * 0.5 * COARSE * res * Math.SQRT2;
    var T = tension + 0.75 * wob + kq + Math.max(2.5 * res, skip) + 0.5;
    var reach = Math.max(0, T) + k + 1;

    var AX = new Float64Array(ncap), AY = new Float64Array(ncap), RA = new Float64Array(ncap);
    var BX = new Float64Array(ncap), BY = new Float64Array(ncap), IL = new Float64Array(ncap);
    var DR = new Float64Array(ncap), PC = new Int32Array(ncap), GR = new Int32Array(ncap);
    for (var i = 0; i < ncap; i++) {
      var o = i * STRIDE;
      AX[i] = sk[o]; AY[i] = sk[o + 1]; RA[i] = sk[o + 2];
      BX[i] = sk[o + 3] - sk[o]; BY[i] = sk[o + 4] - sk[o + 1];
      var l2 = BX[i] * BX[i] + BY[i] * BY[i];
      IL[i] = l2 > 1e-9 ? 1 / l2 : 0;
      DR[i] = sk[o + 5] - sk[o + 2];
      PC[i] = sk[o + 6]; GR[i] = sk[o + 7];
    }

    var gx0 = bounds[0], gy0 = bounds[1];
    var gw = Math.max(1, Math.ceil((bounds[2] - gx0) / BUCKET) + 1);
    var gh = Math.max(1, Math.ceil((bounds[3] - gy0) / BUCKET) + 1);
    var counts = new Int32Array(gw * gh + 1);
    var spans = new Int32Array(ncap * 4);
    for (var c = 0; c < ncap; c++) {
      var o2 = c * STRIDE, ra = sk[o2 + 2], rb = sk[o2 + 5];
      var bx0 = Math.min(sk[o2] - ra, sk[o2 + 3] - rb) - reach, bx1 = Math.max(sk[o2] + ra, sk[o2 + 3] + rb) + reach;
      var by0 = Math.min(sk[o2 + 1] - ra, sk[o2 + 4] - rb) - reach, by1 = Math.max(sk[o2 + 1] + ra, sk[o2 + 4] + rb) + reach;
      var cx0 = Math.max(0, Math.floor((bx0 - gx0) / BUCKET)), cx1 = Math.min(gw - 1, Math.floor((bx1 - gx0) / BUCKET));
      var cy0 = Math.max(0, Math.floor((by0 - gy0) / BUCKET)), cy1 = Math.min(gh - 1, Math.floor((by1 - gy0) / BUCKET));
      spans[c * 4] = cx0; spans[c * 4 + 1] = cx1; spans[c * 4 + 2] = cy0; spans[c * 4 + 3] = cy1;
      for (var yy = cy0; yy <= cy1; yy++) for (var xx = cx0; xx <= cx1; xx++) counts[yy * gw + xx + 1]++;
    }
    for (var b = 1; b <= gw * gh; b++) counts[b] += counts[b - 1];
    var fill = counts.slice(0, gw * gh);
    var idx = new Int32Array(counts[gw * gh]);
    for (var c2 = 0; c2 < ncap; c2++) {   // ascending, so pieces stay contiguous
      for (var y2 = spans[c2 * 4 + 2]; y2 <= spans[c2 * 4 + 3]; y2++) {
        for (var x2 = spans[c2 * 4]; x2 <= spans[c2 * 4 + 1]; x2++) idx[fill[y2 * gw + x2]++] = c2;
      }
    }
    var far = reach - tension;   // a point with no capsule in reach is outside

    // The pieces are folded in with a smooth-min that only fills where two
    // surfaces meet at an angle: its fillet is weighted by 1 - cos of the
    // angle between their gradients (capped at 1). A crease or a gap between
    // strokes gets the full melt, but where two strokes overlap face to face
    // (the shared node of a corner, a bar end inside a stem) nothing
    // inflates, so corners and junctions hold the flat cap and base lines.
    // (Written out twice, inline, because this is the hot loop.)
    return function (px, py) {
      var gxi = Math.floor((px - gx0) / BUCKET), gyi = Math.floor((py - gy0) / BUCKET);
      if (gxi < 0 || gyi < 0 || gxi >= gw || gyi >= gh) return far;
      var cell = gyi * gw + gxi, s = counts[cell], e = counts[cell + 1];
      if (s === e) return far;
      var best = 1e9, dh = 1e9;
      var d = 1e9, gx = 0, gy = 0;               // folded value + its gradient
      var pm = 1e9, pdx = 0, pdy = 0, pl = 0;     // current piece: min + offset
      var curP = -1, curG = GR[idx[s]];
      var ad, h, bx, by, gl, w;
      for (var q = s; q < e; q++) {
        var i = idx[q];
        var ax = AX[i], ay = AY[i];
        var t = ((px - ax) * BX[i] + (py - ay) * BY[i]) * IL[i];
        if (t < 0) t = 0; else if (t > 1) t = 1;
        var dx = px - ax - BX[i] * t, dy = py - ay - BY[i] * t;
        var len = Math.sqrt(dx * dx + dy * dy);
        var di = len - (RA[i] + DR[i] * t);    // tapered-capsule distance
        if (PC[i] !== curP) {
          if (curP >= 0) {                       // fold the finished piece in
            ad = d > pm ? d - pm : pm - d;
            if (ad >= k) { if (pm < d) { d = pm; gx = pdx; gy = pdy; gl = pl; } }
            else {
              h = (k - ad) / k;
              gl = Math.sqrt(gx * gx + gy * gy);
              w = gl > 1e-9 && pl > 1e-9 ? 1 - (gx * pdx + gy * pdy) / (gl * pl) : 1;
              if (w > 1) w = 1;
              bx = pl > 1e-9 ? pdx / pl : 0; by = pl > 1e-9 ? pdy / pl : 0;
              gx = gl > 1e-9 ? gx / gl : 0; gy = gl > 1e-9 ? gy / gl : 0;
              if (pm < d) { gx = gx * h * 0.5 + bx * (1 - h * 0.5); gy = gy * h * 0.5 + by * (1 - h * 0.5); d = pm; }
              else { gx = gx * (1 - h * 0.5) + bx * h * 0.5; gy = gy * (1 - h * 0.5) + by * h * 0.5; }
              d -= h * h * k * 0.25 * w;
            }
          }
          if (GR[i] !== curG) {                  // finished group: cap + hard union
            if (d < dh - kq) d = dh - kq;
            if (d < best) best = d;
            d = 1e9; dh = 1e9; curG = GR[i];
          }
          curP = PC[i]; pm = di; pdx = dx; pdy = dy; pl = len;
        } else if (di < pm) { pm = di; pdx = dx; pdy = dy; pl = len; }
        if (di < dh) dh = di;
      }
      ad = d > pm ? d - pm : pm - d;
      if (ad >= k) { if (pm < d) d = pm; }
      else {
        h = (k - ad) / k;
        gl = Math.sqrt(gx * gx + gy * gy);
        w = gl > 1e-9 && pl > 1e-9 ? 1 - (gx * pdx + gy * pdy) / (gl * pl) : 1;
        if (w > 1) w = 1;
        d = (pm < d ? pm : d) - h * h * k * 0.25 * w;
      }
      if (d < dh - kq) d = dh - kq;
      if (d < best) best = d;
      if (wob > 0) {
        // two octaves of drifting noise = molten, uneven surface
        var nz = valueNoise(px * grain, py * grain, seed) - 0.5;
        nz += (valueNoise(px * grain * 2.3, py * grain * 2.3, seed + 91) - 0.5) * 0.5;
        best += nz * wob;
      }
      return best - tension;
    };
  }

  // -------------------------------------------------------- marching squares
  var CASES = [
    [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
    [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
  ];

  // Sample the field on the grid. With a Lipschitz bound `lip` (|grad f| <=
  // lip, known for the capsule field) most of the grid is skipped: the field
  // is first sampled every COARSE cells, and a coarse cell whose corners all
  // sit farther from zero than lip * half its diagonal provably has no
  // contour inside, so its interior samples just take the corners' sign.
  var COARSE = 4;
  function sampleGrid(field, x0, y0, hx, hy, nx, ny, lip) {
    var W = nx + 1, V = new Float64Array(W * (ny + 1));
    var i, j;
    if (!(lip > 0)) {
      for (j = 0; j <= ny; j++) for (i = 0; i <= nx; i++) V[j * W + i] = field(x0 + i * hx, y0 + j * hy);
      return V;
    }
    V.fill(NaN);
    var xs = [], ys = [];
    for (i = 0; i < nx; i += COARSE) xs.push(i);
    xs.push(nx);
    for (j = 0; j < ny; j += COARSE) ys.push(j);
    ys.push(ny);
    for (var b = 0; b < ys.length; b++) {
      for (var a = 0; a < xs.length; a++) V[ys[b] * W + xs[a]] = field(x0 + xs[a] * hx, y0 + ys[b] * hy);
    }
    var nca = xs.length - 1, ncb = ys.length - 1;
    var flat = new Int8Array(nca * ncb);   // 1 / -1: no contour inside
    for (b = 0; b < ncb; b++) {
      var j0 = ys[b], j1 = ys[b + 1];
      for (a = 0; a < nca; a++) {
        var i0 = xs[a], i1 = xs[a + 1];
        var c0 = V[j0 * W + i0], c1 = V[j0 * W + i1], c2 = V[j1 * W + i0], c3 = V[j1 * W + i1];
        var thr = lip * 0.5 * Math.sqrt((i1 - i0) * hx * (i1 - i0) * hx + (j1 - j0) * hy * (j1 - j0) * hy);
        if (c0 > thr && c1 > thr && c2 > thr && c3 > thr) { flat[b * nca + a] = 1; continue; }
        if (c0 < -thr && c1 < -thr && c2 < -thr && c3 < -thr) { flat[b * nca + a] = -1; continue; }
        for (j = j0; j <= j1; j++) {
          for (i = i0; i <= i1; i++) {
            var q = j * W + i;
            if (V[q] !== V[q]) V[q] = field(x0 + i * hx, y0 + j * hy);
          }
        }
      }
    }
    for (b = 0; b < ncb; b++) {
      for (a = 0; a < nca; a++) {
        var f = flat[b * nca + a];
        if (!f) continue;
        var fill = V[ys[b] * W + xs[a]];
        for (j = ys[b]; j <= ys[b + 1]; j++) {
          for (i = xs[a]; i <= xs[a + 1]; i++) {
            var q2 = j * W + i;
            if (V[q2] !== V[q2]) V[q2] = fill;
          }
        }
      }
    }
    return V;
  }

  function contour(field, bounds, res, lip) {
    var x0 = bounds[0], y0 = bounds[1], x1 = bounds[2], y1 = bounds[3];
    var nx = Math.max(2, Math.ceil((x1 - x0) / res));
    var ny = Math.max(2, Math.ceil((y1 - y0) / res));
    var hx = (x1 - x0) / nx, hy = (y1 - y0) / ny;

    // sample grid once
    var V = sampleGrid(field, x0, y0, hx, hy, nx, ny, lip);

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
    var key = function (p) { return Math.round(p[0] / tol) * 4194304 + Math.round(p[1] / tol); };
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
  function pointSegDist2(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var l2 = dx * dx + dy * dy;
    var ex = p[0] - a[0], ey = p[1] - a[1];
    if (l2 < 1e-12) return ex * ex + ey * ey;
    var t = (ex * dx + ey * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    ex -= t * dx; ey -= t * dy;
    return ex * ex + ey * ey;
  }
  function dpChain(pts, first, last, tol, keep) {
    var tol2 = tol * tol;
    var stack = [first, last];
    while (stack.length) {
      var l = stack.pop(), f = stack.pop();
      if (l <= f + 1) continue;
      var maxD = -1, idx = -1, pf = pts[f], pl = pts[l];
      for (var i = f + 1; i < l; i++) {
        var d = pointSegDist2(pts[i], pf, pl);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol2) { keep[idx] = true; stack.push(f, idx, idx, l); }
    }
  }
  function decimateRing(ring, tol) {
    var n = ring.length;
    if (n < 8) return ring;
    var keep = new Array(n).fill(false);
    var anchor = 0, far = -1;
    for (var i = 1; i < n; i++) {
      var ex = ring[i][0] - ring[0][0], ey = ring[i][1] - ring[0][1], d = ex * ex + ey * ey;
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
    var segs = contour(field, bounds, o.res, o.lip);
    if (!segs.length) return [];
    if (debug) {
      var raw = stitch(segs, o.res * 0.05);
      return { segs: segs.length, raw: raw.map(function (r) { return r.length; }),
               rawRings: raw, bounds: bounds };
    }
    // Rings smaller than minArea are specks: a pinhole counter the melt
    // almost closed, or a crumb of noise. glyphRings drops anything under
    // 30 u^2; traceField keeps its old near-zero threshold unless asked.
    var minArea = o.minArea == null ? 0.8 : o.minArea;
    var rings = repairChains(stitch(segs, o.res * 0.05), o.res * 4)
      .map(function (r) { return chaikin(r, o.smooth); })
      .map(function (r) { return o.simplify > 0 ? decimateRing(r, o.simplify) : r; })
      .filter(function (r) { return r.length > 5 && Math.abs(signedArea(r)) > minArea; });

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

  // chains: [[ [x, y, r(, flag)], ... ], ...]. A node's optional 4th element
  // 1 on a chain's FIRST node starts a detached group (see buildSkeleton);
  // plain [x, y, r] nodes behave exactly as before.
  function glyphRings(chains, opts) {
    opts = opts || {};
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
      minArea: opts.minArea == null ? 30 : opts.minArea,
    };
    var sk = buildSkeleton(chains || [], o.mass);
    if (!sk.length) return [];

    var bb = skeletonBounds(sk);
    // Lipschitz bound of the field: 1 for plain distance, plus the steepest
    // radius taper, plus the noise slope (|grad valueNoise| <= 2.12/unit).
    var taper = 0;
    for (var i = 0; i < sk.length; i += STRIDE) {
      var len = Math.hypot(sk[i + 3] - sk[i], sk[i + 4] - sk[i + 1]);
      if (len > 1e-9) taper = Math.max(taper, Math.abs(sk[i + 5] - sk[i + 2]) / len);
    }
    o.lip = (1 + Math.min(taper, 3)) * 1.02 + o.wobble * o.grain * 4.6;
    // headroom for melt bulge, tension inflation and noise displacement
    var pad = o.melt * 0.5 + Math.abs(o.tension) + o.wobble + o.res * 3;
    var bounds = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];

    var field = makeField(sk, o, bounds);
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
      minArea: opts.minArea,
    };
    return ringsFromField(field, bounds, o, opts._debug);
  }

  return {
    PRESETS: PRESETS,
    glyphRings: glyphRings,
    signedArea: signedArea,
    traceField: traceField,
    valueNoise: valueNoise,
    buildCapsules: buildCapsules,
  };
});
