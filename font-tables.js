// ---------------------------------------------------------------------------
// Raw sfnt table tools.
//
// opentype.js (1.3.4) writes a perfectly good OTF but cannot write kerning
// or mark positioning. This module builds the missing pieces as raw bytes and
// splices them into the ArrayBuffer that font.toArrayBuffer() produced:
//
//   gpos({kern, marks})      -> GPOS table bytes: 'kern' (PairPos Format 1,
//                               XAdvance only) and/or 'mark' (MarkBasePos
//                               Format 1). gposKern(pairs) = kern only.
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

  // ---------------------------------------------------------- kern lookup
  // pairs: [[leftGid, rightGid, xAdvanceAdjust], ...] in font units.
  // Duplicates: the last entry for a pair wins; pairs whose final value is 0
  // are dropped. Returns the lookup bytes, or null when nothing is left.
  //
  // First glyphs are split so no PairPos subtable passes maxSub bytes. The
  // Lookup's own subtable offsets are 16-bit too, so once the subtables
  // together pass 64K the lookup is written as type 9 (Extension, 32-bit
  // offsets) wrapping type-2 subtables. That only kicks in beyond roughly
  // 15000 pairs; note opentype.js 1.3.4 cannot read Extension lookups
  // (HarfBuzz, browsers and fontTools can).
  function kernLookup(pairs, flag, maxSub) {
    var last = {}, sets = {}, firsts = [], i, k;
    for (i = 0; i < (pairs || []).length; i++) {
      var p = pairs[i];
      last[(p[0] & 0xFFFF) * 65536 + (p[1] & 0xFFFF)] = i16(p[2]);
    }
    for (k in last) {
      if (!last[k]) continue;
      var l = Math.floor(k / 65536);
      if (!sets[l]) { sets[l] = []; firsts.push(l); }
      sets[l].push([k % 65536, last[k]]);
    }
    if (!firsts.length) return null;
    firsts.sort(byNum);
    for (i = 0; i < firsts.length; i++) sets[firsts[i]].sort(function (a, b) { return a[0] - b[0]; });

    // greedy split of the (sorted) first-glyph list into subtables
    var groups = [], cur = [], recs = 0;
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
  // spec: { kern: pairs (see kernLookup), marks: (see markLookup),
  //         ignoreMarks: bool }. Returns null when both parts are empty.
  //
  // Structure: ScriptList {DFLT, latn} -> DefaultLangSys -> every feature;
  // FeatureList (by tag) 'kern' -> lookup 0, 'mark' -> lookup 1 (indices
  // close up when a part is missing). The kern lookup gets IgnoreMarks
  // (so A + U+0301 + V still kerns A/V, needs GDEF) whenever marks are
  // present, unless spec.ignoreMarks says otherwise.
  // opts.maxSubtableBytes (default 60000) caps PairPos subtables.
  function gpos(spec, opts) {
    spec = spec || {};
    var maxSub = (opts && opts.maxSubtableBytes) || 60000;
    var mark = markLookup(spec.marks);
    var ign = spec.ignoreMarks != null ? !!spec.ignoreMarks : !!mark;
    var kern = kernLookup(spec.kern, ign ? 0x0008 : 0, maxSub);
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
