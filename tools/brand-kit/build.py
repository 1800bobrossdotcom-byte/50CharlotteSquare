#!/usr/bin/env python3
"""The Charlotte Square logo kit, drawn from the website's own parts.

Every logo file in brand/ starts here. The C is the favicon's own path, read
from assets/img/favicon.svg, so the kit and the site cannot drift apart. The
lettering is the site's own fonts (assets/fonts), shaped with HarfBuzz the way
a browser shapes them (kerning on; ligatures off, as letter-spacing turns them
off) and turned into outlines, so the files need no fonts installed and look
the same in every program.

The proportions are the site's:
  horizontal  the header lockup (.brand in the Gallery style, desktop)
  stacked     the home page's intro (.intro, desktop)

  pip install fonttools brotli uharfbuzz
  python3 tools/brand-kit/build.py     # the SVG masters, plus brand/manifest.json
  node tools/brand-kit/export.mjs      # PNGs and PDFs from them, in Chromium
"""
import io
import json
import os
import re
import shutil

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "brand")

# The mark, from the favicon: a 64 x 64 tile and the C inside it.
_fav = open(os.path.join(ROOT, "assets", "img", "favicon.svg"), encoding="utf-8").read()
RED = re.search(r'<rect[^>]*fill="(#[0-9A-Fa-f]{6})"', _fav).group(1).upper()
C_PATH = re.search(r'<path d="([^"]+)"', _fav).group(1)

INK = "#1A1A1A"     # the Gallery style's --fg
MUTED = "#4F4B47"   # its --fg-muted, which the intro gives the descriptor
WHITE = "#FFFFFF"
BLACK = "#000000"

# On light grounds the descriptor is the muted grey. Reversed, it is white at
# the header's 74%, which lets any dark ground or photo show through. The one-
# colour versions are one colour throughout, C knocked out of the tile, for
# print, embroidery, engraving and anything else that takes a single ink.
COLORWAYS = {
    "color":   {"tile": RED,   "c": WHITE, "name": INK,   "tag": MUTED, "tag_opacity": 1},
    "reverse": {"tile": RED,   "c": WHITE, "name": WHITE, "tag": WHITE, "tag_opacity": 0.74},
    "black":   {"tile": BLACK, "c": None,  "name": BLACK, "tag": BLACK, "tag_opacity": 1},
    "white":   {"tile": WHITE, "c": None,  "name": WHITE, "tag": WHITE, "tag_opacity": 1},
}

NAME = ("Charlotte ", "Square")     # the second word is set in italic
TAG = "AT THE EAST END"             # text-transform: uppercase of "at the East End"


class Face:
    def __init__(self, file, variations=None):
        tt = TTFont(os.path.join(FONTS, file))
        tt.flavor = None
        raw = io.BytesIO()
        tt.save(raw)
        self.font = hb.Font(hb.Face(raw.getvalue()))
        if variations:
            self.font.set_variations(variations)
        self.upem = self.font.face.upem
        self.asc, self.desc = tt["hhea"].ascent, -tt["hhea"].descent
        self.cap = tt["OS/2"].sCapHeight

    def baseline(self, size):
        """Where the baseline sits below the top of a line-height: 1 line box:
        half the leading (negative here) plus the ascent, as CSS lays it out."""
        return size / 2 + (self.asc - self.desc) / 2 * size / self.upem


SERIF = Face("instrument-serif-latin.woff2")
SERIF_ITALIC = Face("instrument-serif-italic-latin.woff2")


def dm_sans(px):
    # The browser sets DM Sans's optical size to the type's size in pixels.
    return Face("dm-sans-latin.woff2", {"wght": 700, "opsz": max(9.0, min(40.0, px))})


def shape(runs, size, tracking):
    """[(face, text)] -> glyphs [(face, gid, x, k)] and the advance width.
    tracking follows every character, as CSS letter-spacing does; the width
    returned leaves off the last one, so centring is on the letters."""
    glyphs, x = [], 0.0
    for face, text in runs:
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(face.font, buf, {"liga": False, "clig": False})
        k = size / face.upem
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            glyphs.append((face, info.codepoint, x + pos.x_offset * k, k))
            x += pos.x_advance * k + tracking
    return glyphs, x - tracking


class Art:
    """One piece of artwork: shapes tagged with a role (tile, c, name, tag)
    that a colourway paints."""

    def __init__(self):
        self.parts = []

    def text(self, role, glyphs, x, baseline):
        for face, gid, gx, k in glyphs:
            self.parts.append((role, ("glyph", face, gid, x + gx, baseline, k)))

    def mark(self, x, y, side):
        f = side / 64
        self.parts.append(("tile", ("poly", [(x, y), (x + side, y), (x + side, y + side), (x, y + side)])))
        self.parts.append(("c", ("poly", [(x + px * f, y + py * f) for px, py in c_points()])))

    @staticmethod
    def draw(shape_, pen):
        if shape_[0] == "glyph":
            _, face, gid, x, baseline, k = shape_
            face.font.draw_glyph_with_pen(gid, TransformPen(pen, (k, 0, 0, -k, x, baseline)))
        else:
            pts = shape_[1]
            pen.moveTo(pts[0])
            for p in pts[1:]:
                pen.lineTo(p)
            pen.closePath()

    def bounds(self):
        b = BoundsPen(None)
        for _, s in self.parts:
            self.draw(s, b)
        return b.bounds

    def svg(self, colorway, title, scale=1.0):
        """The artwork cropped to its ink, at `scale` units per pixel."""
        x0, y0, x1, y1 = self.bounds()
        w, h = (x1 - x0) * scale, (y1 - y0) * scale
        cw = COLORWAYS[colorway]

        def d(roles):
            pen = SVGPathPen(None, ntos=num)
            t = TransformPen(pen, (scale, 0, 0, scale, -x0 * scale, -y0 * scale))
            for role, s in self.parts:
                if role in roles:
                    self.draw(s, t)
            return pen.getCommands()

        out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(w)} {num(h)}" '
               f'width="{num(w)}" height="{num(h)}">', f"<title>{title}</title>"]
        roles = {r for r, _ in self.parts}
        if "tile" in roles:
            if cw["c"]:
                out.append(f'<path fill="{cw["tile"]}" d="{d({"tile"})}"/>')
                out.append(f'<path fill="{cw["c"]}" d="{d({"c"})}"/>')
            else:   # one colour: the C is a hole in the tile
                out.append(f'<path fill="{cw["tile"]}" fill-rule="evenodd" d="{d({"tile", "c"})}"/>')
        if "name" in roles:
            out.append(f'<path fill="{cw["name"]}" d="{d({"name"})}"/>')
        if "tag" in roles:
            op = f' fill-opacity="{num(cw["tag_opacity"])}"' if cw["tag_opacity"] < 1 else ""
            out.append(f'<path fill="{cw["tag"]}"{op} d="{d({"tag"})}"/>')
        out.append("</svg>")
        return "\n".join(out) + "\n", (w, h)


def num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def c_points():
    toks = re.findall(r"[MHVZ]|-?[\d.]+", C_PATH)
    pts, i, x, y = [], 0, 0.0, 0.0
    while i < len(toks):
        t = toks[i]
        if t == "M":
            x, y = float(toks[i + 1]), float(toks[i + 2]); i += 3
        elif t == "H":
            x = float(toks[i + 1]); i += 2
        elif t == "V":
            y = float(toks[i + 1]); i += 2
        else:
            i += 1
            continue
        pts.append((x, y))
    return pts


# ---- The header lockup, in the header's own CSS pixels ----------------------
# .brand: font-size 1.45rem (23.2px); mark 2.15rem; gap .7rem; the name and the
# descriptor in a grid .12em apart; descriptor .46em, letter-spacing .16em;
# both line-height 1; mark and text block centred on each other.
H_SIZE = 23.2
H_MARK = 34.4
H_GAP = 11.2
H_TAG = 0.46 * H_SIZE
H_ROWGAP = 0.12 * H_SIZE


def header_text(art, x, top, with_tag):
    """The header's name block from `top`; returns its height."""
    name, _ = shape([(SERIF, NAME[0]), (SERIF_ITALIC, NAME[1])], H_SIZE, -0.01 * H_SIZE)
    art.text("name", name, x, top + SERIF.baseline(H_SIZE))
    if not with_tag:
        return H_SIZE
    face = dm_sans(H_TAG)
    tag, _ = shape([(face, TAG)], H_TAG, 0.16 * H_TAG)
    tag_top = top + H_SIZE + H_ROWGAP
    art.text("tag", tag, x, tag_top + face.baseline(H_TAG))
    return H_SIZE + H_ROWGAP + H_TAG


def horizontal(with_tag=True, with_mark=True):
    art = Art()
    x = H_MARK + H_GAP if with_mark else 0
    if with_tag:
        block = H_SIZE + H_ROWGAP + H_TAG
        height = max(H_MARK, block)
        header_text(art, x, (height - block) / 2, True)
        mark_top = (height - H_MARK) / 2
    else:
        # Without the descriptor the name's capitals centre on the mark.
        cap = SERIF.cap * H_SIZE / SERIF.upem
        baseline = H_MARK / 2 + cap / 2
        header_text(art, x, baseline - SERIF.baseline(H_SIZE), False)
        mark_top = 0
    if with_mark:
        art.mark(0, mark_top, H_MARK)
    return art


# ---- The intro lockup, in the intro's CSS pixels at its largest -------------
# .intro: mark 184px; gap 2.4rem; name 3.6rem, letter-spacing -.01em,
# line-height 1; descriptor .85rem, letter-spacing .24em, .9rem below; all
# centred.
S_SIZE = 57.6
S_MARK = 184.0
S_GAP = 38.4
S_TAG = 13.6
S_TAGGAP = 14.4


def stacked(with_tag=True, with_mark=True):
    art = Art()
    top = 0.0
    if with_mark:
        art.mark(-S_MARK / 2, 0, S_MARK)
        top = S_MARK + S_GAP
    name, w = shape([(SERIF, NAME[0]), (SERIF_ITALIC, NAME[1])], S_SIZE, -0.01 * S_SIZE)
    art.text("name", name, -w / 2, top + SERIF.baseline(S_SIZE))
    if with_tag:
        face = dm_sans(S_TAG)
        tag, tw = shape([(face, TAG)], S_TAG, 0.24 * S_TAG)
        tag_top = top + S_SIZE + S_TAGGAP
        art.text("tag", tag, -tw / 2, tag_top + face.baseline(S_TAG))
    return art


def mark_only():
    art = Art()
    art.mark(0, 0, 64)
    return art


# (folder, art, what it is, which colourways, PNG widths, scale)
# scale puts each master at a sensible default size in pixels.
DESIGNS = [
    ("logo-horizontal", horizontal(True), "logo", 600 / 240),
    ("logo-horizontal-short", horizontal(False), "logo", 600 / 240),
    ("logo-stacked", stacked(True), "logo", 1.0),
    ("logo-stacked-short", stacked(False), "logo", 1.0),
    ("wordmark", horizontal(True, with_mark=False), "wordmark", 600 / 240),
    ("wordmark-centered", stacked(True, with_mark=False), "wordmark", 1.0),
    ("wordmark-short", horizontal(False, with_mark=False), "wordmark", 600 / 240),
    ("mark", mark_only(), "mark", 512 / 64),
]

TITLE = "Charlotte Square at the East End"


def social(size=1080, c_scale=0.76):
    """A square profile picture: the tile to the edges, the C shrunk to sit
    inside the circle Instagram, Facebook and Google crop it to (the same
    0.76 as the site's maskable icon)."""
    f = size / 64
    pts = [(((px - 32) * c_scale + 32) * f, ((py - 32) * c_scale + 32) * f) for px, py in c_points()]
    d = "M" + " L".join(f"{num(x)} {num(y)}" for x, y in pts) + " Z"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            f"<title>{TITLE}</title>"
            f'<rect width="{size}" height="{size}" fill="{RED}"/><path fill="{WHITE}" d="{d}"/></svg>\n')


def main():
    if os.path.isdir(OUT):
        for entry in os.listdir(OUT):
            p = os.path.join(OUT, entry)
            if os.path.isdir(p):
                shutil.rmtree(p)
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for folder, art, kind, scale in DESIGNS:
        os.makedirs(os.path.join(OUT, folder), exist_ok=True)
        for colorway in COLORWAYS:
            if kind == "mark" and colorway == "reverse":
                continue    # the coloured tile already works on dark grounds
            what = {"logo": "logo", "wordmark": "wordmark", "mark": "mark"}[kind]
            svg, (w, h) = art.svg(colorway, f"{TITLE} — {what}", scale)
            stem = f"charlotte-square-{folder}-{colorway}" if kind != "mark" else f"charlotte-square-mark-{colorway}"
            path = os.path.join(folder, stem + ".svg")
            with open(os.path.join(OUT, path), "w", encoding="utf-8") as fh:
                fh.write(svg)
            manifest.append({"svg": path, "kind": kind, "colorway": colorway, "w": w, "h": h})
    os.makedirs(os.path.join(OUT, "social"), exist_ok=True)
    with open(os.path.join(OUT, "social", "charlotte-square-profile.svg"), "w", encoding="utf-8") as fh:
        fh.write(social())
    manifest.append({"svg": "social/charlotte-square-profile.svg", "kind": "social", "colorway": "color",
                     "w": 1080, "h": 1080})
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
        fh.write("\n")
    print(f"wrote {len(manifest)} SVG masters to brand/")


if __name__ == "__main__":
    main()
