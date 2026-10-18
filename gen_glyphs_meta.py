# Amorphous alphabet: each glyph is chains of NODES [x, y, r].
# r varies per node on purpose — fat at terminals and feet where a liquid
# would pool, pinched at joints where it stretches thin.
#
# Frame (node centres, 92 x 100 box, y down): flat tops at y 6 with r 19
# terminals, flat feet at y 94 with r 20. blob-engine.js draws each chain as
# a smooth spline through its nodes, so curves need a node at least every
# ~50 degrees of turn; a node where the stroke turns by more than ~75
# degrees is a corner (the spline breaks there and the melt fillets it).
#
# Rounds overshoot: their ink reaches ~2 units past the flat ink edges under
# the liquid preset, so they look as tall as the flats. top_y()/bot_y() give
# the node centre for a node of radius r to land there.
#
# A 4th node element 1 on a chain's FIRST node ([x, y, r, 1]) starts a
# detached group: it never melts into the chains before it (the dot of ! ?).
import json
import math

W, H = 92, 100

LIQ_MASS, LIQ_TENSION = 0.98, -4          # liquid preset, for overshoot maths
FLAT_TOP = 6 - 19 * LIQ_MASS - LIQ_TENSION     # ink top of an H stem
FLAT_BOT = 94 + 20 * LIQ_MASS + LIQ_TENSION    # ink bottom of an H foot
OVER = 2.0                                     # round overshoot, glyph units


def R(v):
    return round(v + 0.0, 1)


def top_y(r, over=OVER):
    """Node centre y so a round node of radius r overshoots the cap line."""
    return R(FLAT_TOP - over + r * LIQ_MASS + LIQ_TENSION)


def bot_y(r, over=OVER):
    """Node centre y so a round node of radius r overshoots the baseline."""
    return R(FLAT_BOT + over - r * LIQ_MASS - LIQ_TENSION)


def flat_top(r):
    return R(FLAT_TOP + r * LIQ_MASS + LIQ_TENSION)


def flat_bot(r):
    return R(FLAT_BOT - r * LIQ_MASS - LIQ_TENSION)


def ell(cx, cy, rx, ry, psis, r_side, r_tb, r_ends=None):
    """Nodes on an ellipse placed by NORMAL angle (deg, 0 = right, 90 = down),
    so the turn between nodes is even all round. Radius follows the stress:
    r_side at the left/right extremes, r_tb at top/bottom."""
    out = []
    for i, p in enumerate(psis):
        a = math.radians(p)
        c, s = math.cos(a), math.sin(a)
        d = math.sqrt(rx * rx * c * c + ry * ry * s * s)
        x = cx + rx * rx * c / d
        y = cy + ry * ry * s / d
        r = r_tb + (r_side - r_tb) * c * c
        if r_ends is not None and (i == 0 or i == len(psis) - 1):
            r = r_ends
        out.append([R(x), R(y), R(r)])
    return out


def sell(cx, cy, rx, ry, ts, r_side, r_tb, ex=2.4, r_ends=None):
    """Nodes on a superellipse |x/rx|^ex + |y/ry|^ex = 1 at parameter angles
    ts (deg, 0 = right, 90 = down). ex > 2 squares the oval off a little, so
    the counter of a tall round stays an oval instead of going lemon-shaped."""
    out = []
    for i, t in enumerate(ts):
        a = math.radians(t)
        c, s = math.cos(a), math.sin(a)
        x = cx + rx * math.copysign(abs(c) ** (2.0 / ex), c)
        y = cy + ry * math.copysign(abs(s) ** (2.0 / ex), s)
        r = r_tb + (r_side - r_tb) * abs(c) ** 1.5
        if r_ends is not None and (i == 0 or i == len(ts) - 1):
            r = r_ends
        out.append([R(x), R(y), R(r)])
    return out


def sloop(cx, cy, rx, ry, r_side, r_tb, ex=2.4, n=8):
    """Closed superelliptic loop starting at the top; first node == last."""
    pts = sell(cx, cy, rx, ry, [-90 + 360.0 * i / n for i in range(n + 1)], r_side, r_tb, ex)
    pts[-1] = list(pts[0])
    return pts


def loop(cx, cy, rx, ry, r_side, r_tb, n=8):
    """Closed elliptical loop starting at the top; first node == last node."""
    psis = [-90 + 360.0 * i / n for i in range(n + 1)]
    pts = ell(cx, cy, rx, ry, psis, r_side, r_tb)
    pts[-1] = list(pts[0])
    return pts


def fit(r_tb, over=OVER):
    """(cy, ry) of an oval whose top and bottom nodes (radius r_tb) overshoot."""
    t, b = top_y(r_tb, over), bot_y(r_tb, over)
    return R((t + b) / 2), R((b - t) / 2)


def mirror(chains, axis=W / 2):
    return [[[R(2 * axis - n[0])] + n[1:] for n in c] for c in chains]


def rot180(chains, cx=W / 2, cy=50.5):
    return [[[R(2 * cx - n[0]), R(2 * cy - n[1])] + n[2:] for n in c] for c in chains]


def detached(chain):
    """Mark a chain as the start of a detached (never-melted) group."""
    first = list(chain[0])
    while len(first) < 3:
        first.append(0)
    return [first[:3] + [1]] + [list(n) for n in chain[1:]]


G = {}

# ---------------------------------------------------------------- capitals
STEM_L = [[20, 6, 19], [19, 50, 14], [20, 94, 20]]
STEM_R = [[72, 6, 19], [73, 50, 14], [72, 94, 20]]
BOWL_T = top_y(14, 1.5)          # B D P R bowls overshoot a little less
BOWL_B = bot_y(14, 1.5)

G['A'] = [[[40, -2, 11], [27, 44, 11], [10, 94, 20]],            # apex split in two: a wider,
          [[52, -2, 11], [65, 44, 11], [82, 94, 20]],            # sturdier counter top; lean
          [[19, 76, 10.5], [73, 76, 10.5]]]                      # legs + bar keep it open in molten
G['B'] = [[[20, 6, 19], [19, 49, 13], [20, 94, 20]],
          [[20, 6, 19], [42, top_y(13.5, 1.5), 13.5], [63, 5, 13.5], [72, 21, 14.5], [66, 37, 13], [46, 46.5, 12],
           [22, 48, 11.5]],
          [[22, 48, 11.5], [48, 49, 12], [69, 56, 13.5], [78, 73, 15.5], [70, 92, 14], [46, BOWL_B, 14],
           [20, 94, 20]]]
OCY, ORY = fit(15)
G['C'] = [sell(47, OCY, 32, ORY, [-36, -90, -135, -180, -225, -270, -324], 16.5, 15, 2.3, 15.5)]
G['D'] = [[[20, 6, 19], [19, 50, 15], [20, 94, 20]],
          [[20, 6, 19], [44, BOWL_T, 14], [65, 8, 15], [77, 28, 16.5], [79, 50, 17], [77, 72, 16.5],
           [65, 92, 15], [44, BOWL_B, 14], [20, 94, 20]]]
G['E'] = [[[72, 8, 15], [22, 6, 19], [19, 50, 15], [22, 94, 20], [74, flat_bot(15.5), 15.5]],
          [[20, 50, 13], [60, 50, 13]]]
G['F'] = [[[20, 94, 20], [19, 50, 15], [22, 6, 19], [72, 8, 15]],
          [[20, 52, 13], [60, 52, 13]]]
_g = sell(47, OCY, 32, ORY, [-48, -90, -135, -180, -225, -270, -315], 16.5, 15, 2.3, 15)
G['G'] = [_g + [[79, 75, 15.5], [79, 58, 13.5], [56, 58, 11.5]]]
G['H'] = [STEM_L, STEM_R, [[20, 50, 13], [72, 50, 13]]]
G['I'] = [[[46, 6, 19], [45, 50, 15], [46, 94, 20]]]
G['J'] = [[[64, 6, 19], [64, 40, 15], [63, 66, 15.5], [56, 88, 15.5], [38, bot_y(15), 15],
           [22, 95, 15], [12, 77, 16]]]
G['K'] = [STEM_L, [[76, flat_top(17), 17], [22, 54, 13.5]], [[38, 45, 13.5], [78, flat_bot(18), 18]]]
G['L'] = [[[20, 6, 19], [19, 50, 15], [22, 94, 20], [74, flat_bot(15.5), 15.5]]]


def along(a, b, t, r):
    """Node at fraction t of the straight line a -> b, radius r."""
    return [R(a[0] + (b[0] - a[0]) * t), R(a[1] + (b[1] - a[1]) * t), r]


# M and N: diagonals run ~3.5 r thinner than the stems' feet and thin out
# right after the corner, and the stems pinch a little more at the waist
# (mid node pushed outward so the outer edge stays put). The heavy presets
# fill the acute crease between a stem and a diagonal for a long way, so
# the slit there only survives if the strokes beside it are lean.
_ml, _mv, _mr = [8, flat_top(18) - 1], [46, 67], [84, flat_top(18) - 1]
G['M'] = [[[6, 94, 20], [5.5, 50, 13], _ml + [18], along(_ml, _mv, 0.22, 11), along(_ml, _mv, 0.6, 10.5),
           _mv + [11.5], along(_mr, _mv, 0.6, 10.5), along(_mr, _mv, 0.22, 11), _mr + [18], [86.5, 50, 13],
           [86, 94, 20]]]
_nl, _nr = [15, flat_top(18)], [77, flat_bot(18)]
G['N'] = [[[15, 94, 20], [13.8, 50, 12.5], _nl + [18], along(_nl, _nr, 0.2, 10.5), along(_nl, _nr, 0.5, 10),
           along(_nl, _nr, 0.8, 10.5), _nr + [18], [78.2, 50, 12.5], [77, 6, 19]]]
G['O'] = [sloop(46, OCY, 33, ORY, 16.5, 15)]
G['P'] = [[[20, 6, 19], [19, 50, 15], [20, 94, 20]],
          [[20, 6, 19], [44, BOWL_T, 14], [64, 6, 15], [73, 26, 16.5], [64, 46, 15], [44, 55, 13], [22, 56, 13]]]
G['Q'] = [sloop(46, OCY, 33, ORY, 16.5, 15), [[58, 80, 12], [86, 108, 15]]]
G['R'] = [G['P'][0], G['P'][1], [[40, 56, 13], [78, flat_bot(18), 18]]]


def squeeze(pts, k=0.88, cx=46):
    return [[R(cx + (p[0] - cx) * k)] + p[1:] for p in pts]


_S = [[76, 20, 15], [64, 4.5, 14.5], [46, top_y(14.5), 14.5], [26, 4, 14.5], [16, 20, 15],
      [22, 37, 14.5], [40, 47, 14], [56, 54, 14], [72, 64, 14.5], [77, 81, 15], [68, 96, 14.5],
      [47, bot_y(14.5), 14.5], [26, 98, 14.5], [13, 82, 15]]
G['S'] = [squeeze(_S)]
G['T'] = [[[13, flat_top(14.5), 14.5], [79, flat_top(14.5), 14.5]], [[46, 6, 17], [45, 50, 14], [46, 94, 20]]]
_ub = ell(46, 66, 27, bot_y(15.5) - 66, [180, 135, 90, 45, 0], 15.5, 15.5)
G['U'] = [[[19, 6, 19], [19, 40, 15]] + _ub + [[73, 40, 15], [73, 6, 19]]]
G['V'] = [[[11, flat_top(18), 18], [29, 50, 14], [46, flat_bot(19) + OVER, 19], [63, 50, 14],
           [81, flat_top(18), 18]]]
# W: wider than V, with thinner inner strokes and a lower middle apex, so the
# two notches stay open even in the heavy presets (they clotted in molten)
G['W'] = [[[-3, flat_top(16), 16], [9, 50, 12], [21, flat_bot(15) + 1, 15], [33, 70, 9.5], [46, 42, 10],
           [59, 70, 9.5], [71, flat_bot(15) + 1, 15], [83, 50, 12], [95, flat_top(16), 16]]]
G['X'] = [[[13, flat_top(17), 17], [46, 50, 13.5], [79, flat_bot(19), 19]],
          [[79, flat_top(17), 17], [46, 50, 13.5], [13, flat_bot(19), 19]]]
G['Y'] = [[[13, flat_top(17), 17], [46, 52, 13.5], [79, flat_top(17), 17]],
          [[46, 52, 14], [46, 94, 20]]]
G['Z'] = [[[13, flat_top(15.5), 15.5], [77, flat_top(15), 15], [15, flat_bot(16), 16],
           [80, flat_bot(16.5), 16.5]]]

# ---------------------------------------------------------------- figures
G['0'] = [sloop(46, fit(14.5)[0], 28, fit(14.5)[1], 16, 14.5, 2.3)]
G['1'] = [[[26, 22, 14], [47, flat_top(17), 17], [46, 50, 15], [46, 94, 20]]]
G['2'] = [[[16, 24, 15], [26, 8, 15], [45, top_y(15), 15], [64, 6, 15], [74, 22, 15.5], [69, 40, 14],
           [52, 58, 13.5], [19, flat_bot(16.5), 16.5], [78, flat_bot(16), 16]]]
G['3'] = [[[17, 16, 15], [30, 3, 14.5], [48, top_y(14.5), 14.5], [66, 6, 14.5], [72, 22, 15],
           [62, 39, 13.5], [40, 46, 12.5], [62, 52, 14], [76, 68, 15.5], [74, 86, 15], [60, 98, 14.5],
           [40, bot_y(14.5), 14.5], [22, 97, 14.5], [11, 82, 15]]]
_4t, _4f = [68, flat_top(16)], [-1, 77]          # stem top, diagonal foot: lean strokes round a
G['4'] = [[[68, flat_bot(20), 20], [68.5, 60, 13], [68.5, 36, 11.5], _4t + [16],   # big counter
           along(_4t, _4f, 0.15, 10), along(_4t, _4f, 0.5, 9.5), _4f + [11.5], [90, 77, 11.5]]]
G['5'] = [[[76, flat_top(15.5), 15.5], [27, flat_top(17), 17], [22, 42, 14], [44, 38, 13.5], [66, 46, 15],
           [77, 66, 16.5], [71, 88, 15.5], [52, bot_y(14.5), 14.5], [31, 99, 14.5], [14, 86, 15]]]
G['6'] = [[[72, 12, 15], [56, top_y(14.5), 14.5], [37, 3, 15], [22, 18, 15.5], [15, 42, 16], [15, 64, 16],
           [22, 86, 15.5], [40, bot_y(14.5), 14.5], [60, 98, 14.5], [75, 84, 15.5], [77, 66, 15.5],
           [66, 51, 14], [46, 46, 13.5], [27, 52, 14], [16, 64, 15]]]
G['7'] = [[[12, flat_top(15.5), 15.5], [80, flat_top(15.5), 15.5], [56, 50, 14], [40, flat_bot(18), 18]]]
_t8 = loop(46, (top_y(13.5) + 50) / 2, 22, (50 - top_y(13.5)) / 2, 14, 13.5)
_b8 = loop(46, (46 + bot_y(14.5)) / 2, 26, (bot_y(14.5) - 46) / 2, 15, 14.5)
G['8'] = [_t8, _b8]
G['9'] = rot180(G['6'], cy=(top_y(14.5) + bot_y(14.5)) / 2)

# ------------------------------------------------------------ punctuation
DOT = [46, 97, 17]
G['.'] = [[DOT]]
G[','] = [[[47, 96, 17], [39, 120, 9]]]
G['!'] = [[[46, 6, 16], [45, 60, 12]], detached([[46, 97, 16]])]
G['?'] = [[[16, 22, 14.5], [27, 5, 14.5], [46, top_y(14.5), 14.5], [65, 5, 14.5], [74, 21, 15],
           [66, 38, 13.5], [50, 48, 12.5], [46, 62, 12]],
          detached([[46, 97, 16]])]
G["'"] = [[[46, -2, 15], [41, 24, 10]]]
G['-'] = [[[32, 51, 14], [60, 51, 14]]]
G[':'] = [[[46, 45, 16]], detached([DOT])]
G[';'] = [[[46, 45, 16]], detached([[47, 96, 17], [39, 120, 9]])]
G['"'] = [[[30, -2, 15], [26, 24, 10]], detached([[62, -2, 15], [58, 24, 10]])]
G['('] = [[[64, -12, 13], [44, 10, 14], [35, 50, 15.5], [44, 90, 14], [64, 112, 13]]]
G[')'] = mirror(G['('])
G['/'] = [[[70, -4, 14], [22, 104, 14]]]
G['&'] = [[[85, 57, 14], [79, 78, 14], [64, 94, 14], [44, bot_y(14), 14], [23, 96, 14.5], [12, 80, 15],
           [17, 62, 14], [34, 48, 12.5], [52, 36, 13], [61, 21, 13.5], [57, 6, 13.5], [42, top_y(13.5), 13.5],
           [28, 6, 13.5], [22, 21, 13.5], [28, 37, 12.5], [56, 68, 13], [84, flat_bot(17), 17]]]
G['+'] = [[[46, 24, 15], [46, 80, 15]], [[18, 52, 15], [74, 52, 15]]]
G['='] = [[[18, 36, 14], [74, 36, 14]], detached([[18, 68, 14], [74, 68, 14]])]
_ast = []
for k in range(3):
    a = math.radians(90 + 60 * k)
    dx, dy = 23 * math.cos(a), 23 * math.sin(a)
    arm = [[R(46 - dx), R(26 - dy), 10.5], [46, 26, 9.5], [R(46 + dx), R(26 + dy), 10.5]]
    _ast.append(detached(arm) if k else arm)   # arms never melt: the star stays a star
G['*'] = _ast
G['#'] = [[[33, 2, 11.5], [21, 100, 11.5]], [[72, 2, 11.5], [60, 100, 11.5]],
          [[5, 28, 11.5], [92, 28, 11.5]], [[0, 74, 11.5], [87, 74, 11.5]]]
G['%'] = [loop(22, 25, 15, 21, 11, 10, 8), [[76, 0, 13], [16, 102, 13]], loop(70, 77, 15, 21, 11, 10, 8)]
G['@'] = [loop(46, 55, 15, 18.5, 9.5, 9, 8),                      # wider than a cap, like most @s
          [[63, 40, 10.5], [63, 64, 11], [67, 73, 11], [76, 77, 11], [87, 72, 11.5], [95, 55, 12],
           [94, 32, 12.5], [82, 11, 12.5], [60, -1, 12], [34, 0, 12.5], [11, 11, 12.5], [-3, 34, 13],
           [-4, 62, 13], [5, 87, 12.5], [25, 102, 12], [47, 106, 11.5], [65, 103, 11]]]
G['\u2013'] = [[[14, 51, 14], [78, 51, 14]]]                      # en dash
G['\u2014'] = [[[-14, 51, 14], [106, 51, 14]]]                    # em dash
G['\u2018'] = [[[45, 22, 16], [53, -4, 8]]]                       # left single quote
G['\u2019'] = [[[47, 0, 16], [39, 26, 8]]]                        # right single quote
G['\u201C'] = [[[29, 22, 16], [37, -4, 8]], detached([[63, 22, 16], [71, -4, 8]])]   # left double quote
G['\u201D'] = [[[29, 0, 16], [21, 26, 8]], detached([[63, 0, 16], [55, 26, 8]])]     # right double quote

# ---------------------------------------------------- symbols and brackets
# $: the S (86% size, a hair lighter) with the stroke only as stubs above and
# below; a stroke through the spine clots at text sizes. The stubs melt into
# the top and bottom curves like any join.
G['$'] = [[[n[0], R(50.5 + (n[1] - 50.5) * 0.86), R(n[2] - 0.5)] for n in squeeze(_S, 0.86)],
          [[46, -19, 11], [46, 10, 11.5]], [[46.5, 91, 11.5], [46.5, 120, 11]]]
# dong sign (U+20AB): a lowercase d, bar across the ascender, rule on the baseline.
# Bar and rule are their own hard-unioned groups so nothing floods the bowl.
G['\u20AB'] = [[[66, -8, 15], [66, 30, 13.5], [67, 70, 16]],
               [[66, 40, 12], [55, 30.5, 12.5], [39, 29.5, 13], [25, 38, 13.5], [20, 51, 14], [24, 64, 13.5],
                [37, 72.5, 13], [53, 72, 13], [66, 62, 12.5]],
               detached([[49, 2, 10.5], [85, 2, 10.5]]),
               detached([[18, 103, 10.5], [82, 103, 10.5]])]
# euro: a slightly lighter, narrower C with two bars crossing its back, each
# its own group: melted, the pair fills in solid between them.
G['\u20AC'] = [sell(53, OCY, 30, ORY, [-36, -90, -135, -180, -225, -270, -324], 15.5, 14.5, 2.3, 14.5),
               detached([[0, 37, 10], [47, 37, 10]]),
               detached([[0, 64, 10], [45, 64, 10]])]
# copyright: a thin ring round a small C (own group, never melts into the ring).
G['\u00A9'] = [loop(46, 50, 44, 51, 10, 10, 12),
               detached(ell(48, 50, 17, 20, [-40, -90, -135, -180, -225, -270, -320], 10, 9.5))]
# ellipsis: three full-size periods, each its own group, apart even in molten.
G['\u2026'] = [[[3, 97, 17]], detached([[46, 97, 17]]), detached([[89, 97, 17]])]
G['\u00B0'] = [loop(46, 14, 18, 19, 9.5, 9.5, 8)]                # degree: high ring
G['['] = [[[64, -9.5, 12.5], [35, -12, 14], [34, 50, 14], [35, 112, 14], [64, 109.5, 12.5]]]  # arms droop
G[']'] = mirror(G['['])                                           # a hair: clean corners
G['{'] = [[[64, -12, 12], [48, -6, 12.5], [42, 8, 13], [42, 32, 13], [36, 46, 12.5], [22, 50, 13.5],
           [36, 54, 12.5], [42, 68, 13], [42, 92, 13], [48, 106, 12.5], [64, 112, 12]]]
G['}'] = mirror(G['{'])
G['<'] = [[[72, 18, 13], [20, 52, 14.5], [72, 86, 13]]]
G['>'] = mirror(G['<'])
G['|'] = [[[46, -14, 13.5], [46, 50, 13.5], [46, 114, 13.5]]]
G['\\'] = mirror(G['/'])
G['^'] = [[[18, 42, 12], [46, 4, 13.5], [74, 42, 12]]]
G['_'] = [[[2, 113, 13], [90, 113, 13]]]
G['`'] = [[[32, -6, 14.5], [58, 18, 9.5]]]
G['~'] = [[[10, 59, 12], [22, 45, 13], [38, 44, 12.5], [54, 58, 12.5], [70, 57, 13], [82, 43, 12]]]

# ----------------------------------------------- Latin-1 letters and signs
# O slash: the O with its stroke as a hard-unioned group, so the crossings
# stay crisp and the two half-counters can't fill in where it meets the ring.
_os = (63 * 0.565, 63 * 0.825)          # along the diagonal, ~12u past the O's ink
G['\u00D8'] = [sloop(46, OCY, 33, ORY, 16.5, 15),
               detached([[R(46 - _os[0]), R(50.5 + _os[1]), 11], [R(46 + _os[0]), R(50.5 - _os[1]), 11]])]
# AE: A's left leg, E's stem and arms, ~1.4 caps wide. The leg meets the top
# arm well left of the stem (a flat apex like A's split one) and one bar runs
# through both halves a little below centre, so the counter between leg and
# stem is a trapezoid, not a sliver, and survives molten.
G['\u00C6'] = [[[0, 94, 20], [17, 50, 10.5], [34, flat_top(15), 15], [66, 6, 17.5], [101, 8, 15]],
               [[66, 6, 17.5], [65, 50, 13.5], [66, 94, 20], [103, flat_bot(15.5), 15.5]],
               [[12, 62, 10.5], [65, 62, 12], [95, 62, 13]]]
# OE: a half O closed by the E's stem; one counter.
_oe = sell(42, OCY, 36, ORY, [-90, -135, -180, -225, -270], 16.5, 15, 2.3)
G['\u0152'] = [[[104, 8, 15], [66, 6, 18]] + _oe + [[66, 94, 20], [106, flat_bot(15.5), 15.5]],
               [[66, 6, 18], [65, 50, 14], [66, 94, 20]],
               [[67, 50, 13], [100, 50, 13]]]
# pound: hooked top, the stem bends into the baseline bar, a bar across it
G['\u00A3'] = [[[78, 24, 14], [70, 7, 13.5], [53, top_y(13.5), 13.5], [36, 6, 14], [27, 24, 14.5], [26, 50, 15],
                [24, 76, 15.5], [12, flat_bot(18), 18], [80, flat_bot(16), 16]],
               [[4, 54, 12.5], [56, 54, 12.5]]]
# yen: a Y with a higher fork and two bars across the stem, each its own group
G['\u00A5'] = [[[13, flat_top(17), 17], [46, 40, 13.5], [79, flat_top(17), 17]],
               [[46, 40, 14], [46, 94, 18]],
               detached([[21, 55, 8.5], [71, 55, 8.5]]),
               detached([[21, 77, 8.5], [71, 77, 8.5]])]
# guillemets: two small chevrons each, never melted together; steep arms keep
# the band between them open in bubble
_gq = [[38, 29, 10], [16, 53, 11.5], [38, 77, 10]]
G['\u00AB'] = [_gq, detached([[n[0] + 36] + n[1:] for n in _gq])]
G['\u00BB'] = mirror(G['\u00AB'])
G['\u2022'] = [[[46, 52, 22]]]                                    # bullet: a fat period, raised
# multiply: two crossing bars, hard-unioned so so small a cross doesn't web up
G['\u00D7'] = [[[26, 32, 13.5], [66, 72, 13.5]], detached([[66, 32, 13.5], [26, 72, 13.5]])]


def shrink(chains, k, kr, cx=46, cy=50.5, dx=0, dy=0):
    """Scale chains about (cx, cy) by k (radii by kr: small strokes would
    vanish at k), then shift by (dx, dy)."""
    return [[[R(cx + dx + (n[0] - cx) * k), R(cy + dy + (n[1] - cy) * k), R(n[2] * kr)] + n[3:] for n in c]
            for c in chains]


# registered: a small R inside a squarish ring (like ©'s, squared off to give
# the R's corners room). The R's bowl is a closed squarish loop in a group of
# its own, so no melt reaches so small a counter; stem and leg hang off it.
G['\u00AE'] = [sloop(46, 50, 44, 51, 10, 10, 2.8, 12),
               detached(sloop(46, 37.5, 15, 14, 8.5, 8.5, 3.0, 8)),
               detached([[31, 51.5, 8.5], [31, 76, 9.5]]), [[47, 51.5, 8.5], [61, 76, 9.5]]]
# trade mark: a small T and M on the cap line, each its own group
_tmt = flat_top(9.5)
G['\u2122'] = [[[-4, _tmt, 9.5], [26, _tmt, 9.5]], [[11, _tmt, 9.5], [11, 38, 10]],
               detached([[50, 38, 9.5], [50, 21, 8.5], [50, _tmt, 9.5], [71, 34, 8], [92, _tmt, 9.5],
                         [92, 21, 8.5], [92, 38, 9.5]])]
# inverted ? and !: turned 180 degrees and dropped 20u, so the dot sits near
# cap height and the curl hangs below the baseline
G['\u00BF'] = rot180(G['?'], cy=60.5)
G['\u00A1'] = rot180(G['!'], cy=60.5)

# --- diacritic marks -------------------------------------------------------
# Same [x, y, r] chains, but in mark space: (0, 0) is the anchor. glyph-compose.js
# places a top mark so its ink bottom clears the base's ink top, centres its
# origin on the letter, and stacks the next mark above it; the dot below hangs
# under the ink bottom. The horn and the Đ bar are fused: their origin lands on
# a fixed attach point of the base (O [72,15], U [74,7], D [20,50]) and are
# traced with it. The horn melts in like any stroke; the Đ bar is its own
# hard-unioned group (flag 1), since melting it into D's stem flooded the
# counter in the heavy presets.
# Floating marks are traced with 0.4x melt and 0.55x tension, so strokes of
# r 9.5-11 come out ~0.7x a stem. Cap marks are flattened: acute/grave at
# ~30 deg on a 22x13 skeleton, circumflex/breve 32-34 wide and <= 14 tall.
M = {}
M['\u0301'] = [[[-11, 4, 9.5], [11, -9, 11]]]                                  # acute (sắc)
M['\u0300'] = [[[-11, -9, 11], [11, 4, 9.5]]]                                  # grave (huyền)
M['\u0309'] = [[[-9, -18, 8.5], [-1, -24, 8.5], [9, -22, 8.5], [13, -14, 8.5],   # hook above (hỏi): an
                [8, -7, 8], [3, -3, 8], [2, 3, 9]]]                            # open curl, wide bay
M['\u0303'] = [[[-18, -2, 9], [-11, -8.5, 9.5], [-4, -7, 9], [4, -3, 9],        # tilde (ngã)
                [11, -1.5, 9], [18, -8, 9.5]]]
M['\u0323'] = [[[0, 0, 15]]]                                                   # dot below (nặng) = period
M['\u0302'] = [[[-17, 3, 9.5], [0, -11, 10.5], [17, 3, 9.5]]]                  # circumflex (mũ)
M['\u0306'] = [[[-16, -10, 9.5], [-9, 0, 9], [0, 2.5, 9], [9, 0, 9], [16, -10, 9.5]]]  # breve (trăng)
M['\u031B'] = [[[0, 0, 12], [14, -3, 10.5], [24, -10, 11.5]]]                  # horn (móc), fused
M['\u0335'] = [[[-28, 0, 12, 1], [6, 0, 11.5]]]          # Đ bar, fused: hard union (own group), stops
                                                      # just past the stem so D's counter stays clear
# Beyond Vietnamese. The dots are one size for the dot above and the
# diaeresis (a little under the ! dot); the diaeresis pair is spaced to sit
# inside the stems of H/U and is two groups, so the dots never bridge.
M['\u0308'] = [[[-15, 0, 11]], detached([[15, 0, 11]])]                        # diaeresis
M['\u0307'] = [[[0, 0, 11.5]]]                                                 # dot above
M['\u030A'] = [loop(0, 0, 14, 13, 7.5, 7, 8)]            # ring above: one smooth closed piece, so the
                                                      # melt can't fill it; the hole is ring - stroke
M['\u030C'] = [[[-17, -11, 9.5], [0, 3, 10.5], [17, -11, 9.5]]]                # caron = circumflex turned
M['\u0304'] = [[[-14, 0, 10], [14, 0, 10]]]                                    # macron
# cedilla and ogonek hang off the foot: compose() puts their ink top 3u into
# the base's bottom, the cedilla centred, the ogonek at the right foot. The
# first node is the attach stub; the hook stays open so it never blobs.
M['\u0327'] = [[[0, -1, 9.5], [1, 6, 8.5], [5, 9, 8], [10.5, 12.5, 8], [12, 18, 8], [8.5, 23.5, 8],
                [1, 26, 8], [-7, 24.5, 8.5]]]                                  # cedilla
M['\u0328'] = [[[0, -1, 9.5], [-4, 8, 9], [-6, 16, 8.5], [-3, 23, 8], [5, 26, 7.5], [13, 24, 7]]]  # ogonek
MARK_KEYS = list(M.keys())
G.update(M)


# ------------------------------------------------------------ sanity report
def turn_report():
    """Flag nodes whose turn sits in the ambiguous 55-95 degree band, where a
    curve starts reading as a corner (or a corner as a curve)."""
    out = []
    for k, chains in G.items():
        for ci, c in enumerate(chains):
            pts = [n[:2] for n in c]
            closed = len(pts) >= 4 and abs(pts[0][0] - pts[-1][0]) < 0.5 and abs(pts[0][1] - pts[-1][1]) < 0.5
            if closed:
                pts = pts[:-1]
            n = len(pts)
            for i in range(n):
                if not closed and (i == 0 or i == n - 1):
                    continue
                a, b, c2 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
                u = (b[0] - a[0], b[1] - a[1])
                v = (c2[0] - b[0], c2[1] - b[1])
                lu, lv = math.hypot(*u), math.hypot(*v)
                if lu < 1e-9 or lv < 1e-9:
                    continue
                t = math.degrees(math.acos(max(-1, min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))))
                if 57 < t < 93:
                    out.append('%s[%d].%d %.0f' % (k, ci, i, t))
    return out


order = (list("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") +
         ['.', ',', '!', '?', "'", '-', ':', ';', '"', '(', ')', '/', '&', '+', '=', '*', '#', '%', '@',
          '\u2013', '\u2014', '\u2018', '\u2019', '\u201C', '\u201D',
          '$', '\u20AB', '\u20AC', '\u00A9', '\u2026', '\u00B0', '[', ']', '{', '}', '<', '>', '|', '\\',
          '^', '_', '`', '~',
          '\u00D8', '\u00C6', '\u0152', '\u00A3', '\u00A5', '\u00AB', '\u00BB', '\u2022', '\u00D7', '\u00AE',
          '\u2122', '\u00BF', '\u00A1'] + MARK_KEYS)
G = {k: G[k] for k in order}
data = {'H': H, 'W': W, 'glyphs': G}
json.dump(data, open('glyphs_meta.json', 'w'))
# same data as a <script>-loadable global, for pages that skip bundle.py
open('glyphs_meta.js', 'w').write('var GLYPH_DATA = ' + json.dumps(data) + ';\n')
print("missing:", [c for c in order if c not in G], "| have:", len(G))
amb = turn_report()
if amb:
    print("turns in the 57-93 deg band (curve/corner blend):", ' '.join(amb))
