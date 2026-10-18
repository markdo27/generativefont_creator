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

G['A'] = [[[42, -2, 12], [28, 46, 12.5], [11, 94, 20]],          # apex split in two: a wider,
          [[50, -2, 12], [64, 46, 12.5], [81, 94, 20]],          # sturdier counter top
          [[19, 75, 11.5], [73, 75, 11.5]]]
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
          [[20, 50, 15], [60, 50, 15]]]
G['F'] = [[[20, 94, 20], [19, 50, 15], [22, 6, 19], [72, 8, 15]],
          [[20, 52, 15], [60, 52, 15]]]
_g = sell(47, OCY, 32, ORY, [-48, -90, -135, -180, -225, -270, -315], 16.5, 15, 2.3, 15)
G['G'] = [_g + [[79, 75, 15.5], [79, 58, 14.5], [56, 58, 13]]]
G['H'] = [STEM_L, STEM_R, [[20, 50, 15], [72, 50, 15]]]
G['I'] = [[[46, 6, 19], [45, 50, 15], [46, 94, 20]]]
G['J'] = [[[64, 6, 19], [64, 40, 15], [63, 66, 15.5], [56, 88, 15.5], [38, bot_y(15), 15],
           [22, 95, 15], [12, 77, 16]]]
G['K'] = [STEM_L, [[76, flat_top(17), 17], [22, 54, 13.5]], [[38, 45, 13.5], [78, flat_bot(18), 18]]]
G['L'] = [[[20, 6, 19], [19, 50, 15], [22, 94, 20], [74, flat_bot(15.5), 15.5]]]
G['M'] = [[[10, 94, 20], [12, flat_top(18) - 1, 18], [46, 58, 13], [80, flat_top(18) - 1, 18], [82, 94, 20]]]
G['N'] = [[[19, 94, 20], [18, 50, 13.5], [18, flat_top(18), 18], [46, 50, 12], [74, flat_bot(18), 18],
           [74, 50, 13.5], [74, 6, 19]]]
G['O'] = [sloop(46, OCY, 33, ORY, 16.5, 15)]
G['P'] = [[[20, 6, 19], [19, 50, 15], [20, 94, 20]],
          [[20, 6, 19], [44, BOWL_T, 14], [64, 6, 15], [73, 26, 16.5], [64, 46, 15], [44, 55, 13], [22, 56, 13]]]
G['Q'] = [sloop(46, OCY, 33, ORY, 16.5, 15), [[58, 80, 12], [86, 108, 15]]]
G['R'] = [G['P'][0], G['P'][1], [[40, 56, 13], [78, flat_bot(18), 18]]]


def squeeze(pts, k=0.88, cx=46):
    return [[R(cx + (p[0] - cx) * k)] + p[1:] for p in pts]


G['S'] = [squeeze([[76, 20, 15], [64, 4.5, 14.5], [46, top_y(14.5), 14.5], [26, 4, 14.5], [16, 20, 15],
                   [22, 37, 14.5], [40, 47, 14], [56, 54, 14], [72, 64, 14.5], [77, 81, 15], [68, 96, 14.5],
                   [47, bot_y(14.5), 14.5], [26, 98, 14.5], [13, 82, 15]])]
G['T'] = [[[13, flat_top(16), 16], [79, flat_top(16), 16]], [[46, 6, 17], [45, 50, 14], [46, 94, 20]]]
_ub = ell(46, 66, 27, bot_y(15.5) - 66, [180, 135, 90, 45, 0], 15.5, 15.5)
G['U'] = [[[19, 6, 19], [19, 40, 15]] + _ub + [[73, 40, 15], [73, 6, 19]]]
G['V'] = [[[11, flat_top(18), 18], [29, 50, 14], [46, flat_bot(19) + OVER, 19], [63, 50, 14],
           [81, flat_top(18), 18]]]
G['W'] = [[[0, flat_top(16), 16], [11, 50, 12], [22, flat_bot(15.5) + 1, 15.5], [34, 66, 11], [46, 36, 11.5],
           [58, 66, 11], [70, flat_bot(15.5) + 1, 15.5], [81, 50, 12], [92, flat_top(16), 16]]]
G['X'] = [[[13, flat_top(17), 17], [46, 50, 13.5], [79, flat_bot(19), 19]],
          [[79, flat_top(17), 17], [46, 50, 13.5], [13, flat_bot(19), 19]]]
G['Y'] = [[[13, flat_top(17), 17], [46, 52, 13.5], [79, flat_top(17), 17]],
          [[46, 52, 14], [46, 94, 20]]]
G['Z'] = [[[13, flat_top(17), 17], [77, flat_top(16.5), 16.5], [15, flat_bot(17), 17],
           [80, flat_bot(17.5), 17.5]]]

# ---------------------------------------------------------------- figures
G['0'] = [sloop(46, fit(14.5)[0], 28, fit(14.5)[1], 16, 14.5, 2.3)]
G['1'] = [[[26, 22, 14], [47, flat_top(17), 17], [46, 50, 15], [46, 94, 20]]]
G['2'] = [[[16, 24, 15], [26, 8, 15], [45, top_y(15), 15], [64, 6, 15], [74, 22, 15.5], [69, 40, 14],
           [52, 58, 13.5], [19, flat_bot(16.5), 16.5], [78, flat_bot(16), 16]]]
G['3'] = [[[17, 16, 15], [30, 3, 14.5], [48, top_y(14.5), 14.5], [66, 6, 14.5], [72, 22, 15],
           [62, 39, 13.5], [40, 46, 12.5], [62, 52, 14], [76, 68, 15.5], [74, 86, 15], [60, 98, 14.5],
           [40, bot_y(14.5), 14.5], [22, 97, 14.5], [11, 82, 15]]]
G['4'] = [[[67, flat_bot(20), 20], [67, 48, 13], [67, flat_top(16), 16], [35, 38, 10.5], [2, 74, 12.5],
           [89, 74, 13.5]]]
G['5'] = [[[76, flat_top(15.5), 15.5], [27, flat_top(17), 17], [22, 42, 14], [44, 38, 13.5], [66, 46, 15],
           [77, 66, 16.5], [71, 88, 15.5], [52, bot_y(14.5), 14.5], [31, 99, 14.5], [14, 86, 15]]]
G['6'] = [[[72, 12, 15], [56, top_y(14.5), 14.5], [37, 3, 15], [22, 18, 15.5], [15, 42, 16], [15, 64, 16],
           [22, 86, 15.5], [40, bot_y(14.5), 14.5], [60, 98, 14.5], [75, 84, 15.5], [77, 66, 15.5],
           [66, 51, 14], [46, 46, 13.5], [27, 52, 14], [16, 64, 15]]]
G['7'] = [[[12, flat_top(17), 17], [80, flat_top(17), 17], [56, 50, 14], [40, flat_bot(18), 18]]]
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

# --- diacritic marks -------------------------------------------------------
# Same [x, y, r] chains, but in mark space: (0, 0) is the anchor. glyph-compose.js
# places a top mark so its ink bottom clears the base's ink top, centres its
# origin on the letter, and stacks the next mark above it; the dot below hangs
# under the ink bottom. The horn and the Đ bar are fused: their origin lands on
# a fixed attach point of the base (O [72,15], U [74,7], D [20,50]) and they
# melt into it like any stroke.
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
M['\u0335'] = [[[-28, 0, 11], [20, 0, 10.5]]]                                  # Đ bar, fused
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
          '\u2013', '\u2014', '\u2018', '\u2019', '\u201C', '\u201D'] + MARK_KEYS)
G = {k: G[k] for k in order}
data = {'H': H, 'W': W, 'glyphs': G}
json.dump(data, open('glyphs_meta.json', 'w'))
# same data as a <script>-loadable global, for pages that skip bundle.py
open('glyphs_meta.js', 'w').write('var GLYPH_DATA = ' + json.dumps(data) + ';\n')
print("missing:", [c for c in order if c not in G], "| have:", len(G))
amb = turn_report()
if amb:
    print("turns in the 57-93 deg band (curve/corner blend):", ' '.join(amb))
