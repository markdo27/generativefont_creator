// ---------------------------------------------------------------------------
// Raw sfnt table tools.
//
// opentype.js (1.3.4) writes a perfectly good OTF but cannot write kerning
// or mark positioning. This module builds the missing pieces as raw bytes and
// splices them into the ArrayBuffer that font.toArrayBuffer() produced:
//
//   gpos({kern, marks})      -> GPOS table bytes: 'kern' (PairPos Format 1
//                               glyph pairs, or Format 2 class kerning for
//                               big sets; XAdvance only) and/or 'mark'
//                               (MarkBasePos Format 1). gposKern(pairs) =
//                               kern only.
//   gdef(classDefs)          -> GDEF table bytes with a GlyphClassDef, so
//                               shapers know which glyphs are marks.
//   injectTables(buf, tabs)  -> new sfnt with tables added / replaced / removed,
//                               directory, checksums and head.checkSumAdjustment
//                               all rebuilt.
//
// No dependencies; works in the browser (window.FontTables) and in node.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.FontTables = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ byte sink
  // Plain arrays of bytes, big-endian. u16 also takes negative ints: the
  // masks give the two's-complement int16 encoding for free.
  function u16(a, v) { a.push((v >> 8) & 255, v & 255); }
  function u32(a, v) { a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  function tag(a, t) { for (var i = 0; i < 4; i++) a.push(t.charCodeAt(i) & 255); }
  function append(a, b) { for (var i = 0; i < b.length; i++) a.push(b[i]); }
  function byNum(a, b) { return a - b; }
  function i16(v) { return Math.max(-32768, Math.min(32767, Math.round(v))) || 0; }

  // ---------------------------------------------------- PairPos subtable
  // Format 1, ValueFormat1 = XAdvance, ValueFormat2 = none. Layout:
  //   header (10 + 2n) | Coverage fmt 1 (4 + 2n) | PairSet x n
  // Every offset is 16-bit from the subtable start, hence the size cap the
  // caller enforces when it groups first glyphs into subtables.
  function pairPosSize(nFirst, nRecords) { return 14 + 6 * nFirst + 4 * nRecords; }

  function pairPos(firsts, sets) {
    var a = [], n = firsts.length, off = 14 + 4 * n, i, j;
    u16(a, 1); u16(a, 10 + 2 * n); u16(a, 0x0004); u16(a, 0); u16(a, n);
    for (i = 0; i < n; i++) {
      if (off > 0xFFFF) throw new Error('FontTables: PairPos subtable overflow');
      u16(a, off); off += 2 + 4 * sets[firsts[i]].length;
    }
    u16(a, 1); u16(a, n);
    for (i = 0; i < n; i++) u16(a, firsts[i]);
    for (i = 0; i < n; i++) {
      var set = sets[firsts[i]];
      u16(a, set.length);
      for (j = 0; j < set.length; j++) { u16(a, set[j][0]); u16(a, set[j][1]); }
    }
    return a;
  }

  // greedy split of the (sorted) first-glyph list into Format 1 subtables
  function pairSubtables(sets, firsts, maxSub) {
    var groups = [], cur = [], recs = 0, i;
    for (i = 0; i < firsts.length; i++) {
      var r = sets[firsts[i]].length;
      if (cur.length && pairPosSize(cur.length + 1, recs + r) > maxSub) {
        groups.push(cur); cur = []; recs = 0;
      }
      cur.push(firsts[i]); recs += r;
    }
    groups.push(cur);
    var subs = [];
    for (i = 0; i < groups.length; i++) subs.push(pairPos(groups[i], sets));
    return subs;
  }

  // ------------------------------------------------- Coverage / ClassDef
  // The smaller encoding of each. Coverage: format 1 (glyph list) or 2
  // (ranges of consecutive gids). ClassDef: format 1 (one class per gid from
  // the first listed gid to the last) or 2 (runs of consecutive gids that
  // share a class). Class 0 is implicit and never written.
  function runs(gids, classOf) {               // gids sorted ascending
    var out = [], i;
    for (i = 0; i < gids.length; i++) {
      var r = out[out.length - 1], c = classOf(gids[i]);
      if (r && r[1] === gids[i] - 1 && r[2] === c) r[1] = gids[i];
      else out.push([gids[i], gids[i], c]);
    }
    return out;
  }

  function coverageBest(gids) {
    var rs = runs(gids, function () { return 0; }), a = [], i, idx = 0;
    if (6 * rs.length >= 2 * gids.length) return coverage(gids);
    u16(a, 2); u16(a, rs.length);
    for (i = 0; i < rs.length; i++) {
      u16(a, rs[i][0]); u16(a, rs[i][1]); u16(a, idx); idx += rs[i][1] - rs[i][0] + 1;
    }
    return a;
  }

  function classDef(cls) {                     // { gid: class > 0 }
    var g = sortedKeys(cls), rs = runs(g, function (x) { return cls[x]; }), a = [], i;
    var span = g.length ? g[g.length - 1] - g[0] + 1 : 0;
    if (g.length && 6 + 2 * span < 4 + 6 * rs.length) {
      u16(a, 1); u16(a, g[0]); u16(a, span);
      for (i = 0; i < span; i++) u16(a, cls[g[0] + i] || 0);
    } else {
      u16(a, 2); u16(a, rs.length);
      for (i = 0; i < rs.length; i++) { u16(a, rs[i][0]); u16(a, rs[i][1]); u16(a, rs[i][2]); }
    }
    return a;
  }

  // ------------------------------------------------ class kerning (fmt 2)
  // Values are first rounded to multiples of q (half away from zero, so
  // the error is at most floor(q / 2): 1 unit for the default q = 2), which
  // lets rows / columns that differ only by rounding noise share a class.
  function quantise(v, q) {
    if (!(q > 1) || !v) return v;
    var r = (v < 0 ? -1 : 1) * Math.round(Math.abs(v) / q) * q;
    return Math.max(-32768, Math.min(32767, r));
  }

  // Partition refinement: lab[g] for g in gs is replaced by a dense id of
  // (old label, value in row m). Returns the number of distinct ids.
  function refine(gs, lab, m) {
    var ids = {}, n = 0, i;
    for (i = 0; i < gs.length; i++) {
      var k = lab[gs[i]] + ':' + (m[gs[i]] || 0);
      lab[gs[i]] = k in ids ? ids[k] : (ids[k] = n++);
    }
    return n;
  }

  // One PairPos Format 2 subtable for a group of left classes (arrays of
  // first gids with identical rows). Right classes are derived again over
  // just this group's rows, so they are as few as the group allows; class 0
  // on the right is every glyph whose column is all zero here (or that never
  // appears). On the left, Coverage already limits the subtable to the
  // group's glyphs, so class 0 is reused for the group's largest class (as
  // fontTools' feaLib does) and saves one row of the matrix.
  // Layout: header 16 | Class1Records | Coverage | ClassDef1 | ClassDef2.
  function classPairPos(group, row) {
    var reps = [], cov = [], rs = {}, i, j, big = 0;
    for (i = 0; i < group.length; i++) {
      reps.push(row[group[i][0]]);
      for (j = 0; j < group[i].length; j++) cov.push(group[i][j]);
      for (var r in reps[i]) rs[r] = 1;
      if (group[i].length > group[big].length) big = i;
    }
    cov.sort(byNum);
    var R = sortedKeys(rs), lab = {}, n = 0;
    for (i = 0; i < R.length; i++) lab[R[i]] = 0;
    for (i = 0; i < reps.length; i++) n = refine(R, lab, reps[i]);
    var cd2 = {}, rep2 = [];
    for (i = 0; i < R.length; i++) {
      cd2[R[i]] = lab[R[i]] + 1;
      if (rep2[lab[R[i]]] == null) rep2[lab[R[i]]] = R[i];
    }
    var order = [group[big]], cd1 = {}, c1 = group.length, c2 = n + 1;
    for (i = 0; i < group.length; i++) if (i !== big) order.push(group[i]);
    for (i = 1; i < c1; i++) for (j = 0; j < order[i].length; j++) cd1[order[i][j]] = i;

    var a = [], cv = coverageBest(cov), d1 = classDef(cd1), d2 = classDef(cd2);
    var oCov = 16 + 2 * c1 * c2, o1 = oCov + cv.length, o2 = o1 + d1.length;
    if (o2 > 0xFFFF) return null;
    u16(a, 2); u16(a, oCov); u16(a, 0x0004); u16(a, 0); u16(a, o1); u16(a, o2); u16(a, c1); u16(a, c2);
    for (i = 0; i < c1; i++) {
      var m = row[order[i][0]];
      u16(a, 0);
      for (j = 0; j < n; j++) u16(a, m[rep2[j]] || 0);
    }
    append(a, cv); append(a, d1); append(a, d2);
    return a;
  }

  // Classes from the full matrix: right classes = second glyphs with
  // identical (quantised) columns, then left classes = first glyphs with
  // identical rows over those right classes; this is already the exact
  // fixpoint, so one round suffices. Left classes, ordered by first gid,
  // are then packed greedily into subtables of at most maxSub bytes (an
  // upper-bound size estimate, so the real subtable is never larger); each
  // subtable has its own Coverage subset and re-derived right classes.
  // Returns [] when every value rounds to 0, or null when even one left
  // class alone cannot fit a subtable (> ~30000 right classes) -- the
  // caller then writes Format 1.
  function classSubtables(sets, firsts, maxSub, q) {
    var row = {}, L = [], seen = {}, i, j, k;
    for (i = 0; i < firsts.length; i++) {
      var s = sets[firsts[i]], m = null;
      for (j = 0; j < s.length; j++) {
        var v = quantise(s[j][1], q);
        if (v) { (m || (m = {}))[s[j][0]] = v; seen[s[j][0]] = 1; }
      }
      if (m) { row[firsts[i]] = m; L.push(firsts[i]); }
    }
    if (!L.length) return [];
    var R = sortedKeys(seen), lab = {}, n = 0, reps = [];
    for (i = 0; i < R.length; i++) lab[R[i]] = 0;
    for (i = 0; i < L.length; i++) n = refine(R, lab, row[L[i]]);
    for (i = 0; i < R.length; i++) if (reps[lab[R[i]]] == null) reps[lab[R[i]]] = R[i];
    var key = {}, classes = [];
    for (i = 0; i < L.length; i++) {
      var kk = [];
      for (j = 0; j < n; j++) kk.push(row[L[i]][reps[j]] || 0);
      kk = kk.join(',');
      if (!(kk in key)) { key[kk] = classes.length; classes.push([]); }
      classes[key[kk]].push(L[i]);
    }

    // greedy packing; the right partition of the open group is refined row
    // by row (new glyphs enter as "zero so far"), coverage and ClassDefs
    // are bounded by their worst-case encodings
    var groups = [], cur = [], gl = {}, gR = [], nCov = 0, lo = 65535, hi = 0;
    function est(c, nr, ncov, nR, span) {
      return 16 + 2 * c * (nr + 1) + (4 + 2 * ncov) + (4 + 6 * ncov) + Math.min(4 + 6 * nR, 6 + 2 * span);
    }
    for (i = 0; i < classes.length; i++) {
      var mrow = row[classes[i][0]], add = [], nlo = lo, nhi = hi;
      for (k in mrow) if (!(k in gl)) { add.push(+k); if (+k < nlo) nlo = +k; if (+k > nhi) nhi = +k; }
      // trial refinement on a copy, so the group can be closed unchanged
      var tl = {}, tR = gR.concat(add).sort(byNum);
      for (j = 0; j < gR.length; j++) tl[gR[j]] = gl[gR[j]];
      for (j = 0; j < add.length; j++) tl[add[j]] = -1;
      var tn = refine(tR, tl, mrow), tc = nCov + classes[i].length;
      if (cur.length && est(cur.length + 1, tn, tc, tR.length, nhi - nlo + 1) > maxSub) {
        groups.push(cur);
        cur = []; gl = {}; gR = []; nCov = 0; lo = 65535; hi = 0; i--;
        continue;
      }
      if (est(1, tn, classes[i].length, tR.length, nhi - nlo + 1) > maxSub && !cur.length) return null;
      cur.push(classes[i]); gl = tl; gR = tR; nCov = tc; lo = nlo; hi = nhi;
    }
    groups.push(cur);
    var subs = [];
    for (i = 0; i < groups.length; i++) {
      var sub = classPairPos(groups[i], row);
      if (!sub) return null;
      subs.push(sub);
    }
    return subs;
  }

  // ---------------------------------------------------------- kern lookup
  // pairs: [[leftGid, rightGid, xAdvanceAdjust], ...] in font units.
  // Duplicates: the last entry for a pair wins; pairs whose final value is 0
  // are dropped. Returns the lookup bytes, or null when nothing is left.
  //
  // mode: false = PairPos Format 1 (exact glyph pairs); true = Format 2
  // (class kerning, values quantised to q, see classSubtables); null /
  // 'auto' = Format 1 up to CLASS_AUTO distinct pairs, beyond that both are
  // built and the smaller one is kept.
  //
  // First glyphs are split so no PairPos subtable passes maxSub bytes. The
  // Lookup's own subtable offsets are 16-bit too, so once the subtables
  // together pass 64K the lookup is written as type 9 (Extension, 32-bit
  // offsets) wrapping type-2 subtables. With Format 1 that kicks in beyond
  // roughly 15000 pairs; note opentype.js 1.3.4 cannot read Extension
  // lookups (HarfBuzz, browsers and fontTools can). It does read Format 2.
  var CLASS_AUTO = 2000;

  function kernLookup(pairs, flag, maxSub, mode, q) {
    var last = {}, sets = {}, firsts = [], i, k, count = 0;
    for (i = 0; i < (pairs || []).length; i++) {
      var p = pairs[i];
      last[(p[0] & 0xFFFF) * 65536 + (p[1] & 0xFFFF)] = i16(p[2]);
    }
    for (k in last) {
      if (!last[k]) continue;
      var l = Math.floor(k / 65536);
      if (!sets[l]) { sets[l] = []; firsts.push(l); }
      sets[l].push([k % 65536, last[k]]);
      count++;
    }
    if (!firsts.length) return null;
    firsts.sort(byNum);
    for (i = 0; i < firsts.length; i++) sets[firsts[i]].sort(function (a, b) { return a[0] - b[0]; });

    var cls = null;
    if (mode === true || (mode == null || mode === 'auto') && count > CLASS_AUTO) {
      var cs = classSubtables(sets, firsts, maxSub, q);
      if (cs && !cs.length) return null;       // everything rounded to 0
      if (cs) cls = kernWrap(cs, flag);
      if (mode === true && cls) return cls;
    }
    var f1 = kernWrap(pairSubtables(sets, firsts, maxSub), flag);
    return cls && cls.length < f1.length ? cls : f1;
  }

  // subtables -> Lookup bytes
  function kernWrap(subs, flag) {
    var i;
    // plain type-2 lookup if every subtable offset fits in 16 bits
    var n = subs.length, head = 6 + 2 * n, offs = [], at = head, ext = false;
    for (i = 0; i < n; i++) { offs.push(at); if (at > 0xFFFF) ext = true; at += subs[i].length; }

    var lookup = [];
    u16(lookup, ext ? 9 : 2); u16(lookup, flag); u16(lookup, n);
    if (!ext) {
      for (i = 0; i < n; i++) u16(lookup, offs[i]);
    } else {
      // ExtensionPosFormat1 records sit after the header; each one points
      // (32-bit, from its own start) at a PairPos placed after all of them.
      var recBase = head, data = head + 8 * n;
      for (i = 0; i < n; i++) u16(lookup, recBase + 8 * i);
      for (i = 0; i < n; i++) {
        u16(lookup, 1); u16(lookup, 2); u32(lookup, data - (recBase + 8 * i));
        data += subs[i].length;
      }
    }
    for (i = 0; i < n; i++) append(lookup, subs[i]);
    return lookup;
  }

  // ---------------------------------------------------------- mark lookup
  // marks: { classes: { top: [[markGid, x, y], ...], bottom: [...] },
  //          bases: [[baseGid, { top: [x, y], bottom: [x, y] }], ...] }
  // -> type-4 lookup with one MarkBasePos Format 1 subtable, or null when
  // there are no marks or no bases. Class numbers follow top, bottom, then
  // any other names, skipping empty classes. A glyph listed twice keeps its
  // last entry; a base with no anchor in any present class is dropped, and
  // a missing anchor is a NULL offset (marks of that class stay put).
  // Layout: header 12 | MarkCoverage | BaseCoverage | MarkArray | BaseArray,
  // identical anchors shared within each array.
  function coverage(gids) {
    var a = [];
    u16(a, 1); u16(a, gids.length);
    for (var i = 0; i < gids.length; i++) u16(a, gids[i]);
    return a;
  }

  // Anchor Format 1 pool; offsets count from the owning array's start,
  // with `start` bytes of records ahead of the pool.
  function anchorPool(start) {
    var at = {}, bytes = [];
    return {
      bytes: bytes,
      off: function (x, y) {
        var key = x + ',' + y;
        if (!(key in at)) {
          at[key] = start + bytes.length;
          if (at[key] > 0xFFFF) throw new Error('FontTables: MarkBasePos anchor overflow');
          u16(bytes, 1); u16(bytes, x); u16(bytes, y);
        }
        return at[key];
      },
    };
  }

  function sortedKeys(o) { return Object.keys(o).map(Number).sort(byNum); }

  function markLookup(marks) {
    if (!marks || !marks.classes) return null;
    var names = ['top', 'bottom'], mk = {}, used = {}, cls = [], bs = {}, k, i, j;
    for (k in marks.classes) if (names.indexOf(k) < 0) names.push(k);
    for (i = 0; i < names.length; i++) {
      var list = marks.classes[names[i]] || [];
      for (j = 0; j < list.length; j++) mk[list[j][0] & 0xFFFF] = [names[i], i16(list[j][1]), i16(list[j][2])];
    }
    for (k in mk) used[mk[k][0]] = 1;
    for (i = 0; i < names.length; i++) if (used[names[i]]) cls.push(names[i]);
    if (!cls.length) return null;

    for (i = 0; i < (marks.bases || []).length; i++) {
      var b = marks.bases[i], anc = [], any = false;
      for (j = 0; j < cls.length; j++) {
        var q = b[1] && b[1][cls[j]];
        anc.push(q ? [i16(q[0]), i16(q[1])] : null);
        if (q) any = true;
      }
      if (any) bs[b[0] & 0xFFFF] = anc; else delete bs[b[0] & 0xFFFF];
    }
    var mg = sortedKeys(mk), bg = sortedKeys(bs), nm = mg.length, nb = bg.length, nc = cls.length;
    if (!nb) return null;

    var ma = [], mp = anchorPool(2 + 4 * nm);
    u16(ma, nm);
    for (i = 0; i < nm; i++) {
      var m = mk[mg[i]];
      u16(ma, cls.indexOf(m[0])); u16(ma, mp.off(m[1], m[2]));
    }
    append(ma, mp.bytes);
    var ba = [], bp = anchorPool(2 + 2 * nc * nb);
    u16(ba, nb);
    for (i = 0; i < nb; i++) {
      for (j = 0; j < nc; j++) { var c = bs[bg[i]][j]; u16(ba, c ? bp.off(c[0], c[1]) : 0); }
    }
    append(ba, bp.bytes);

    var mc = coverage(mg), bc = coverage(bg);
    var o2 = 12 + mc.length, o3 = o2 + bc.length, o4 = o3 + ma.length;
    if (o4 > 0xFFFF) throw new Error('FontTables: MarkBasePos subtable overflow');
    var lk = [];
    u16(lk, 4); u16(lk, 0); u16(lk, 1); u16(lk, 8);               // Lookup, subtable @8
    u16(lk, 1); u16(lk, 12); u16(lk, o2); u16(lk, nc); u16(lk, o3); u16(lk, o4);
    append(lk, mc); append(lk, bc); append(lk, ma); append(lk, ba);
    return lk;
  }

  // --------------------------------------------------------------- GPOS
  // spec: { kern: pairs or { pairs: pairs } (see kernLookup),
  //         kernClasses: true | false | 'auto' (default 'auto': class
  //                      kerning beyond 2000 pairs when it is smaller),
  //         marks: (see markLookup), ignoreMarks: bool }.
  // Returns null when both parts are empty.
  //
  // Structure: ScriptList {DFLT, latn} -> DefaultLangSys -> every feature;
  // FeatureList (by tag) 'kern' -> lookup 0, 'mark' -> lookup 1 (indices
  // close up when a part is missing). The kern lookup gets IgnoreMarks
  // (so A + U+0301 + V still kerns A/V, needs GDEF) whenever marks are
  // present, unless spec.ignoreMarks says otherwise.
  // opts.maxSubtableBytes (default 60000) caps PairPos subtables;
  // opts.kernQuantum (default 2) is the class-kerning rounding step (1 =
  // exact); opts.kernClasses is used when spec.kernClasses is not given.
  function gpos(spec, opts) {
    spec = spec || {};
    var maxSub = (opts && opts.maxSubtableBytes) || 60000;
    var q = opts && opts.kernQuantum != null ? opts.kernQuantum : 2;
    var mode = spec.kernClasses != null ? spec.kernClasses : opts && opts.kernClasses;
    var pairs = spec.kern && !Array.isArray(spec.kern) ? spec.kern.pairs : spec.kern;
    var mark = markLookup(spec.marks);
    var ign = spec.ignoreMarks != null ? !!spec.ignoreMarks : !!mark;
    var kern = kernLookup(pairs, ign ? 0x0008 : 0, maxSub, mode, q);
    var feats = [], lookups = [], i, j;
    if (kern) { feats.push('kern'); lookups.push(kern); }
    if (mark) { feats.push('mark'); lookups.push(mark); }
    if (!lookups.length) return null;

    var nf = feats.length, nl = lookups.length;
    var scr = 10 + 2 * nf, sl = 14 + 2 * scr, fl = 2 + 12 * nf;
    var a = [];
    u16(a, 1); u16(a, 0); u16(a, 10); u16(a, 10 + sl); u16(a, 10 + sl + fl);
    // ScriptList: 2 records sorted by tag, one Script table each
    u16(a, 2); tag(a, 'DFLT'); u16(a, 14); tag(a, 'latn'); u16(a, 14 + scr);
    for (i = 0; i < 2; i++) {
      u16(a, 4); u16(a, 0);                       // DefaultLangSys @4, no LangSys
      u16(a, 0); u16(a, 0xFFFF); u16(a, nf);
      for (j = 0; j < nf; j++) u16(a, j);
    }
    // FeatureList: records, then one Feature (one lookup) per record;
    // feature j uses lookup j
    u16(a, nf);
    for (j = 0; j < nf; j++) { tag(a, feats[j]); u16(a, 2 + 6 * nf + 6 * j); }
    for (j = 0; j < nf; j++) { u16(a, 0); u16(a, 1); u16(a, j); }
    // LookupList: data placed smallest first, so a > 64K (Extension) kern
    // lookup goes last and every 16-bit offset here still fits
    var order = [], at = 2 + 2 * nl, offs = [];
    for (i = 0; i < nl; i++) order.push(i);
    order.sort(function (x, y) { return lookups[x].length - lookups[y].length; });
    for (i = 0; i < nl; i++) {
      if (at > 0xFFFF) throw new Error('FontTables: LookupList overflow');
      offs[order[i]] = at; at += lookups[order[i]].length;
    }
    u16(a, nl);
    for (i = 0; i < nl; i++) u16(a, offs[i]);
    for (i = 0; i < nl; i++) append(a, lookups[order[i]]);
    return new Uint8Array(a);
  }

  // Kerning-only GPOS (the original API).
  function gposKern(pairs, opts) { return gpos({ kern: pairs }, opts); }

  // --------------------------------------------------------------- GDEF
  // classDefs: { gid: class } with 1 = base, 2 = ligature, 3 = mark,
  // 4 = component; 0 / missing = unclassified. Version 1.0 with only a
  // GlyphClassDef (ClassDef Format 2: runs of consecutive gids sharing a
  // class); AttachList, LigCaretList and MarkAttachClassDef offsets are 0.
  // Returns null when no glyph has a class.
  function gdef(classDefs) {
    var cd = {}, k, i;
    for (k in classDefs || {}) {
      var c = classDefs[k] & 0xFFFF;
      if (c) cd[+k & 0xFFFF] = c;
    }
    var g = sortedKeys(cd), runs = [];
    if (!g.length) return null;
    for (i = 0; i < g.length; i++) {
      var r = runs[runs.length - 1];
      if (r && r[1] === g[i] - 1 && r[2] === cd[g[i]]) r[1] = g[i];
      else runs.push([g[i], g[i], cd[g[i]]]);
    }
    var a = [];
    u16(a, 1); u16(a, 0); u16(a, 12); u16(a, 0); u16(a, 0); u16(a, 0);
    u16(a, 2); u16(a, runs.length);
    for (i = 0; i < runs.length; i++) { u16(a, runs[i][0]); u16(a, runs[i][1]); u16(a, runs[i][2]); }
    return new Uint8Array(a);
  }

  // ----------------------------------------------------------- checksums
  // Sum of big-endian uint32 words over the 4-padded length, mod 2^32.
  function checksum(dv, off, len) {
    var sum = 0, end = off + ((len + 3) & ~3);
    for (var p = off; p < end; p += 4) sum = (sum + dv.getUint32(p)) >>> 0;
    return sum;
  }

  // ------------------------------------------------------------- inject
  // buffer: ArrayBuffer (or typed array) holding an 'OTTO' / 0x00010000 sfnt.
  // tables: { 'GPOS': Uint8Array, ... } -- adds or replaces; null removes.
  // Returns a fresh ArrayBuffer; the input is never modified.
  // A copy of one table's bytes from an sfnt, or null — for patching a table
  // opentype.js wrote (e.g. OS/2 flags) before injecting it back.
  function readTable(buffer, tag) {
    var src = ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer);
    var dv = new DataView(src.buffer, src.byteOffset, src.byteLength), n = dv.getUint16(4);
    for (var i = 0; i < n; i++) {
      var rec = 12 + 16 * i;
      if (String.fromCharCode(src[rec], src[rec + 1], src[rec + 2], src[rec + 3]) !== tag) continue;
      var o = dv.getUint32(rec + 8);
      return src.slice(o, o + dv.getUint32(rec + 12));
    }
    return null;
  }

  function injectTables(buffer, tables) {
    var src = ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer);
    var dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
    var ver = dv.getUint32(0);
    if (ver !== 0x4F54544F && ver !== 0x00010000 && ver !== 0x74727565)
      throw new Error('FontTables: not an OTF/TTF sfnt');

    var map = {}, n = dv.getUint16(4), i, j, t;
    for (i = 0; i < n; i++) {
      var rec = 12 + 16 * i, o = dv.getUint32(rec + 8);
      t = String.fromCharCode(src[rec], src[rec + 1], src[rec + 2], src[rec + 3]);
      map[t] = src.subarray(o, o + dv.getUint32(rec + 12));
    }
    for (t in tables || {}) {
      if (t.length !== 4) throw new Error('FontTables: bad table tag "' + t + '"');
      var v = tables[t];
      if (v == null) delete map[t];
      else map[t] = v instanceof ArrayBuffer ? new Uint8Array(v) : v;
    }

    // tags are ASCII, so string order == the spec's uint32 tag order
    var tags = Object.keys(map).sort(), offs = [], at;
    n = tags.length; at = 12 + 16 * n;
    for (i = 0; i < n; i++) { offs.push(at); at += (map[tags[i]].length + 3) & ~3; }

    var out = new Uint8Array(at), od = new DataView(out.buffer), sr = 1, es = 0;
    while (sr * 2 <= n) { sr *= 2; es++; }
    od.setUint32(0, ver); od.setUint16(4, n);
    od.setUint16(6, sr * 16); od.setUint16(8, es); od.setUint16(10, n * 16 - sr * 16);

    var headAt = -1;
    for (i = 0; i < n; i++) {
      var data = map[tags[i]], r = 12 + 16 * i;
      out.set(data, offs[i]);                     // padding stays zero
      if (tags[i] === 'head') { headAt = offs[i]; od.setUint32(headAt + 8, 0); }
      for (j = 0; j < 4; j++) out[r + j] = tags[i].charCodeAt(j);
      od.setUint32(r + 4, checksum(od, offs[i], data.length));
      od.setUint32(r + 8, offs[i]);
      od.setUint32(r + 12, data.length);
    }
    // head.checkSumAdjustment = 0xB1B0AFBA - sum(whole file with it zeroed)
    if (headAt >= 0) od.setUint32(headAt + 8, (0xB1B0AFBA - checksum(od, 0, out.length)) >>> 0);
    return out.buffer;
  }

  return {
    readTable: readTable,
    gpos: gpos,
    gposKern: gposKern,
    gdef: gdef,
    injectTables: injectTables,
    checksum: checksum,
  };
});
