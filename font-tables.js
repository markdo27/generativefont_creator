// ---------------------------------------------------------------------------
// Raw sfnt table tools.
//
// opentype.js (1.3.4) writes a perfectly good OTF but cannot write kerning.
// This module builds the missing piece as raw bytes and splices it into the
// ArrayBuffer that font.toArrayBuffer() produced:
//
//   gposKern(pairs)          -> GPOS table bytes with a 'kern' feature made of
//                               PairPos Format 1 subtables (XAdvance only).
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

  // --------------------------------------------------------------- GPOS
  // pairs: [[leftGid, rightGid, xAdvanceAdjust], ...] in font units.
  // Duplicates: the last entry for a pair wins; pairs whose final value is 0
  // are dropped. Returns null when nothing is left to kern (no GPOS needed).
  //
  // Structure: ScriptList {DFLT, latn} -> DefaultLangSys -> feature 0 'kern'
  // -> lookup 0 -> PairPos subtables, first glyphs split so no subtable
  // passes opts.maxSubtableBytes (default 60000).
  //
  // The Lookup's own subtable offsets are 16-bit too, so once the subtables
  // together pass 64K the lookup is written as type 9 (Extension, 32-bit
  // offsets) wrapping type-2 subtables. That only kicks in beyond roughly
  // 15000 pairs; note opentype.js 1.3.4 cannot read Extension lookups
  // (HarfBuzz, browsers and fontTools can).
  function gposKern(pairs, opts) {
    var maxSub = (opts && opts.maxSubtableBytes) || 60000;
    var last = {}, sets = {}, firsts = [], i, k;
    for (i = 0; i < (pairs || []).length; i++) {
      var p = pairs[i];
      last[(p[0] & 0xFFFF) * 65536 + (p[1] & 0xFFFF)] =
        Math.max(-32768, Math.min(32767, Math.round(p[2]))) || 0;
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
    u16(lookup, ext ? 9 : 2); u16(lookup, 0); u16(lookup, n);
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

    var a = [];
    // header: version 1.0, ScriptList @10, FeatureList @48, LookupList @62
    u16(a, 1); u16(a, 0); u16(a, 10); u16(a, 48); u16(a, 62);
    // ScriptList (38 bytes): 2 records sorted by tag, Script tables @14, @26
    u16(a, 2); tag(a, 'DFLT'); u16(a, 14); tag(a, 'latn'); u16(a, 26);
    for (i = 0; i < 2; i++) {
      u16(a, 4); u16(a, 0);                       // DefaultLangSys @4, no LangSys
      u16(a, 0); u16(a, 0xFFFF); u16(a, 1); u16(a, 0);
    }
    // FeatureList (14 bytes): 'kern' -> Feature @8 -> lookup 0
    u16(a, 1); tag(a, 'kern'); u16(a, 8); u16(a, 0); u16(a, 1); u16(a, 0);
    // LookupList: one lookup @4
    u16(a, 1); u16(a, 4);
    append(a, lookup);
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
    gposKern: gposKern,
    injectTables: injectTables,
    checksum: checksum,
  };
});
