#!/usr/bin/env python3
"""Charlotte Square on Instagram: a nine-post profile grid and two Reels.

The nine posts read as one picture on the profile: photographs at the corners
and in the middle, the brand and the facts in between, in the social ads'
language (Instrument Serif with one italic accent, DM Sans small caps, the
dark ground, sand and brick). Each is a 4:5 feed post, 1080x1350 css px,
rendered at 1440x1800; the profile grid shows the middle 3:4 of each, so
nothing that matters sits within 40 px of the left or right edge.

This writes the HTML in src/. Then:
  node marketing/instagram/render.cjs        the PNGs (grid posts, reel captions and end cards)
  python3 marketing/instagram/make_reels.py  the two Reels (MP4) and the grid preview
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "src")
IMG = "../../../assets/img/"

PHONE = "(585) 748-5588"
FROM_RENT = "$2,195"          # the lowest rent on the site's live list, November 2026
RENT_AS_OF = "November 2026"
SITE = "charlottesquareroc.com"

MARK = ('<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#A93B3F"/>'
        '<path d="M9 9 H55 V27 H45 V19 H19 V45 H55 V55 H9 Z" fill="#fff"/></svg>')
MARK_LINE = ('<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#F1ECE1"/>'
             '<path d="M9 9 H55 V27 H45 V19 H19 V45 H55 V55 H9 Z" fill="#A93B3F"/></svg>')
GHOST = ('<svg class="ghost" viewBox="9 9 46 46" aria-hidden="true">'
         '<path d="M9 9 H55 V27 H45 V19 H19 V45 H55 V55 H9 Z" fill="currentColor"/></svg>')
EHO = ('<svg class="eho" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">'
       '<path d="M3 11l9-7 9 7v9H3z"/><path d="M7 20v-6h10v6"/><path d="M9 17h6"/></svg>')
LEAF = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        '<path d="M4 20c0-8 6-14 16-16-1 10-6 16-14 16"/><path d="M4 20l8-8"/></svg>')

# Where text may go, so no crop Instagram uses cuts it off (x0, y0, x1, y1 in css px).
# A feed post (4:5, 1080x1350) shows whole in the feed, the middle 3:4 on the
# profile grid today, and the middle square on older apps and some embeds: the
# safe area is inside all three, with a margin. Reels are covered by
# Instagram's buttons: the account bar at the top, the caption, sound and
# reply field at the foot, the like/comment/share column on the right. A
# Reel's cover shows on the grid as its middle 3:4, or the middle square.
SAFE_POST = (58, 159, 1022, 1191)
SAFE_REEL = (60, 220, 940, 1500)
SAFE_COVER = (60, 444, 1020, 1476)

CSS = """
:root {
  --bg: #1A1613; --cream: #F1ECE1; --paper: #EDE6D8; --body: #BEB6A7; --muted: #8F877A;
  --sand: #E2B07A; --line: rgba(241, 236, 225, .17); --brick: #A93B3F; --ink: #1A1613;
}
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; }
i { font-style: italic; }
.post {
  position: relative; overflow: hidden; width: 1080px; height: 1350px;
  background: var(--bg); color: var(--cream);
  font-family: 'DM Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  padding: 170px 96px 170px; display: flex; flex-direction: column;
}
.serif { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; }
.caps { font-size: 15px; font-weight: 600; letter-spacing: .32em; text-transform: uppercase; }
.mark { width: 64px; height: 64px; border-radius: 6px; flex: none; display: block; }
.ghost { position: absolute; right: -120px; bottom: -150px; width: 620px; height: 620px; color: var(--cream); opacity: .045; pointer-events: none; }

/* ---- Photographs: full bleed, a shade at the foot for the caption. */
.post--photo { padding: 0; }
.post--photo img.bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.post--photo::after { content: ""; position: absolute; inset: auto 0 0 0; height: 560px;
  background: linear-gradient(to top, rgba(18,14,12,.86), rgba(18,14,12,.5) 45%, rgba(18,14,12,0)); }
.cap { position: absolute; left: 96px; right: 96px; bottom: 170px; z-index: 2; }
.cap .caps { color: var(--sand); text-shadow: 0 1px 12px rgba(0,0,0,.5); }
.cap h2 { margin-top: 16px; font-size: 76px; line-height: 1; letter-spacing: -.01em; text-wrap: balance; text-shadow: 0 2px 24px rgba(0,0,0,.35); }
.cap h2 i { color: var(--sand); }
.corner { position: absolute; top: 160px; left: 96px; z-index: 2; width: 52px; height: 52px; }
.corner .mark { width: 52px; height: 52px; box-shadow: 0 4px 20px rgba(0,0,0,.3); }
.badge { position: absolute; top: 166px; right: 96px; z-index: 2; display: flex; align-items: center; gap: 12px;
  padding: 14px 22px 14px 18px; border-radius: 999px; background: rgba(26,22,19,.78); color: var(--cream);
  font-size: 15px; font-weight: 600; letter-spacing: .24em; text-transform: uppercase; }
.badge svg { width: 24px; height: 24px; color: #D9B45A; }

/* ---- The brand panel */
.brandpanel { justify-content: center; align-items: center; text-align: center; }
.brandpanel .mark { width: 120px; height: 120px; border-radius: 10px; }
.brandpanel .wm { margin-top: 56px; font-size: 128px; line-height: .9; letter-spacing: -.015em; }
.brandpanel .wm i { color: var(--sand); }
.brandpanel .rule { width: 120px; height: 1px; background: var(--line); margin: 52px auto 0; }
.brandpanel .caps { margin-top: 44px; color: var(--sand); line-height: 2; }
.brandpanel .small { margin-top: 10px; color: var(--body); font-size: 22px; }

/* ---- Facts, on paper */
.post--paper { background: var(--paper); color: var(--ink); }
.post--paper .ghost { color: var(--ink); opacity: .05; }
.post--paper .caps { color: var(--brick); }
.facts h2 { margin-top: 64px; font-size: 132px; line-height: .92; letter-spacing: -.015em; }
.facts h2 i { color: var(--brick); }
.facts dl { margin-top: auto; border-top: 1px solid rgba(26,22,19,.18); }
.facts dl div { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; padding: 26px 0; border-bottom: 1px solid rgba(26,22,19,.18); }
.facts dt { font-size: 15px; font-weight: 600; letter-spacing: .24em; text-transform: uppercase; color: #6E665B; }
.facts dd { font-family: 'Instrument Serif', Georgia, serif; font-size: 64px; line-height: 1; white-space: nowrap; }

/* ---- Brick: one strong colour block */
.post--brick { background: var(--brick); }
.post--brick .caps { color: #F6D9B8; }
.post--brick h2 { margin-top: auto; font-size: 150px; line-height: .9; letter-spacing: -.02em; }
.post--brick h2 i { color: #F6D9B8; }
.post--brick p.sub { margin-top: 40px; font-size: 30px; line-height: 1.4; color: #F7E7DA; max-width: 760px; }
.post--brick .ghost { opacity: .06; }
.post--brick .top { display: flex; justify-content: space-between; align-items: center; }

/* ---- Now leasing */
.lease .caps.k { color: var(--sand); }
.lease h2 { margin-top: 72px; font-size: 150px; line-height: .9; letter-spacing: -.02em; }
.lease h2 i { color: var(--sand); }
.lease .from { margin-top: 60px; padding: 30px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  display: flex; align-items: baseline; gap: 22px; }
.lease .from .fig { font-family: 'Instrument Serif', Georgia, serif; font-size: 92px; line-height: 1; }
.lease .from .lab { font-size: 22px; color: var(--body); line-height: 1.35; }
.lease .call { margin-top: auto; }
.lease .call .caps { color: var(--sand); }
.lease .call .num { margin-top: 10px; font-size: 64px; font-weight: 500; letter-spacing: -.01em; }
.lease .call .site { margin-top: 12px; font-size: 26px; color: var(--body); }
.legal { margin-top: 40px; display: flex; align-items: center; gap: 12px; font-size: 14px; letter-spacing: .02em; color: var(--muted); }
.eho { width: 20px; height: 20px; flex: none; }

/* ---- Reels: 1080x1920, captions in the space Instagram's buttons leave free
   (clear of the top 220 px, the bottom 380 px and the right-hand 140 px). */
.reelcap { width: 1080px; height: 1920px; position: relative; font-family: 'DM Sans', system-ui, sans-serif; color: var(--cream); -webkit-font-smoothing: antialiased; }
.reelcap .shade { position: absolute; inset: auto 0 0 0; height: 1000px;
  background: linear-gradient(to top, rgba(18,14,12,.0) 0, rgba(18,14,12,.72) 30%, rgba(18,14,12,.4) 62%, rgba(18,14,12,0)); }
.reelcap .box { position: absolute; left: 84px; right: 160px; bottom: 444px; }
.reelcap .caps { color: var(--sand); font-size: 18px; text-shadow: 0 1px 14px rgba(0,0,0,.55); }
.reelcap h2 { margin-top: 18px; font-size: 104px; line-height: .96; letter-spacing: -.012em; text-wrap: balance; text-shadow: 0 2px 28px rgba(0,0,0,.4); }
.reelcap h2 i { color: var(--sand); }
.reelcap .brand { position: absolute; top: 240px; left: 84px; display: flex; align-items: center; gap: 18px; }
.reelcap .brand .mark { width: 56px; height: 56px; box-shadow: 0 4px 20px rgba(0,0,0,.3); }
.reelcap .brand .wm { font-size: 40px; text-shadow: 0 2px 18px rgba(0,0,0,.5); }
.reelcap .brand .wm i { color: var(--sand); }

.endcard { width: 1080px; height: 1920px; position: relative; overflow: hidden; background: var(--bg); color: var(--cream);
  font-family: 'DM Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; padding: 300px 160px 420px 84px; display: flex; flex-direction: column; }
.endcard .ghost { width: 900px; height: 900px; right: -220px; bottom: 120px; }
.endcard .mark { width: 96px; height: 96px; border-radius: 8px; }
.endcard .caps { margin-top: 64px; color: var(--sand); font-size: 18px; }
.endcard h2 { margin-top: 28px; font-size: 170px; line-height: .88; letter-spacing: -.02em; }
.endcard h2 i { color: var(--sand); }
.endcard .from { margin-top: 64px; padding: 34px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 30px; color: var(--body); line-height: 1.45; }
.endcard .from b { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; font-size: 84px; color: var(--cream); display: block; line-height: 1; margin-bottom: 10px; }
.endcard .call { margin-top: auto; }
.endcard .call .caps { margin-top: 0; }
.endcard .num { margin-top: 12px; font-size: 76px; font-weight: 500; letter-spacing: -.01em; }
.endcard .site { margin-top: 14px; font-size: 30px; color: var(--body); }
.endcard .legal { margin-top: 36px; font-size: 17px; }
.endcard .eho { width: 22px; height: 22px; }

/* ---- Reel covers: what the profile grid shows for each Reel. Everything
   sits in the middle square, the smallest crop Instagram has used. */
.cover { width: 1080px; height: 1920px; position: relative; overflow: hidden; background: var(--bg); color: var(--cream);
  font-family: 'DM Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.cover img.bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cover::after { content: ""; position: absolute; inset: 0; background: rgba(18,14,12,.5); }
.cover .in { position: absolute; z-index: 2; left: 96px; right: 96px; top: 444px; height: 1032px;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.cover .mark { width: 96px; height: 96px; border-radius: 8px; }
.cover .caps { margin-top: 48px; color: var(--sand); font-size: 20px; text-shadow: 0 1px 14px rgba(0,0,0,.5); }
.cover h2 { margin-top: 24px; font-size: 150px; line-height: .9; letter-spacing: -.02em; text-shadow: 0 2px 30px rgba(0,0,0,.45); }
.cover h2 i { color: var(--sand); }
"""


def page(name, w, h, body, transparent=False, safe=SAFE_POST):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width={w}">
<meta name="ad-size" content="{w}x{h}">
<meta name="safe" content="{",".join(map(str, safe))}">
{'<meta name="transparent" content="1">' if transparent else ''}
<title>{name}</title>
<link rel="stylesheet" href="../../../assets/fonts/fonts.css">
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>
"""


def photo(img, kicker, line, pos="50% 50%", badge=""):
    return (f'<div class="post post--photo"><img class="bg" src="{IMG}{img}" alt="" style="object-position:{pos}">'
            f'<div class="corner">{MARK}</div>{badge}'
            f'<div class="cap"><p class="caps">{kicker}</p><h2 class="serif">{line}</h2></div></div>')


LEGAL = (f'<p class="legal">{EHO}<span>Equal Housing Opportunity · Managed by Evolution24 Properties · '
         f'Rent as listed, {RENT_AS_OF}</span></p>')

# The grid as it reads on the profile, left to right, top to bottom.
# Instagram puts the newest post top left, so they are posted in the reverse
# order: the file numbers are the posting order (01 first, 09 last).
GRID = [
    # Top row
    ("09-exterior", photo("hero-exterior.jpg", "50 Charlotte Street", "Rochester&rsquo;s <i>East End</i>", "46% 50%")),
    ("08-brand", f"""<div class="post brandpanel">{GHOST}{MARK}
      <p class="wm serif">Charlotte<br><i>Square</i></p><div class="rule"></div>
      <p class="caps">Luxury apartments<br>Rochester, New York</p></div>"""),
    ("07-terrace", photo("terrace.jpg", "The terrace", "Grills, a fire pit, <i>downtown views</i>", "50% 40%")),
    # Middle row
    ("06-facts", f"""<div class="post post--paper facts"><p class="caps">The homes</p>
      <h2 class="serif">Room to <i>live.</i></h2>
      <dl><div><dt>Bedrooms</dt><dd>1 to 3</dd></div>
      <div><dt>Square feet</dt><dd>765 to 1,640</dd></div>
      <div><dt>Homes</dt><dd>72</dd></div></dl></div>"""),
    ("05-leed", photo("hero-aerial.jpg", "LEED Gold certified", "Built green, <i>solar on the roof</i>", "57% 50%",
                      badge=f'<p class="badge">{LEAF}LEED Gold</p>')),
    ("04-parking", f"""<div class="post post--brick">{GHOST}<div class="top">{MARK_LINE}<p class="caps">Every lease</p></div>
      <h2 class="serif">Parking,<br><i>included.</i></h2>
      <p class="sub">A garage space comes with every home. No circling the block.</p></div>"""),
    # Bottom row
    ("03-living", photo("unit-living.jpg", "The residences", "Open plans, <i>big windows</i>", "50% 55%")),
    ("02-leasing", f"""<div class="post lease">{GHOST}<p class="caps k">Charlotte Square</p>
      <h2 class="serif">Now<br><i>leasing.</i></h2>
      <div class="from"><span class="fig">From {FROM_RENT}</span><span class="lab">a month.<br>A garage space included.</span></div>
      <div class="call"><p class="caps">Call Tatum to tour</p><p class="num">{PHONE}</p><p class="site">{SITE}</p></div>
      {LEGAL}</div>"""),
    ("01-east-end", photo("east-end-street.jpg", "The East End", "Theatre, dinner, coffee, <i>on foot</i>", "50% 40%")),
]

# The two Reels: a photograph, how it moves, and its caption.
#   move: ("pan", from_x, to_x) across a wide picture, 0..1 of the free width;
#         ("zoom", from, to) into a tall one, about a focus point.
REELS = {
    "reel-1-inside": [
        ("lobby-lounge.jpg", ("pan", 0.35, 0.65), "Charlotte Square", "Come <i>on in.</i>"),
        ("hero-lounge.jpg", ("pan", 0.25, 0.6), "The lounge", "A fireplace <i>downstairs</i>"),
        ("unit-living.jpg", ("zoom", 1.0, 1.1), "The residences", "Light from <i>wall to wall</i>"),
        ("unit-kitchen-range.jpg", ("pan", 0.3, 0.7), "The kitchen", "Stainless, <i>and room to cook</i>"),
        ("unit-bedroom-2.jpg", ("zoom", 1.08, 1.0), "The bedroom", "Room <i>to rest</i>"),
        ("hero-terrace.jpg", ("pan", 0.65, 0.35), "The terrace", "And your <i>evenings</i>"),
    ],
    "reel-2-east-end": [
        ("hero-aerial.jpg", ("pan", 0.45, 0.72), "Rochester&rsquo;s East End", "50 Charlotte <i>Street</i>"),
        ("charlotte-street.jpg", ("pan", 0.55, 0.3), "Home", "On a <i>tree-lined</i> street"),
        ("east-end-street.jpg", ("zoom", 1.0, 1.1), "Out the door", "Theatre nights, <i>on foot</i>"),
        ("neighborhood-hero.jpg", ("pan", 0.3, 0.7), "Downtown", "The city, <i>right there</i>"),
        ("hero-park.jpg", ("pan", 0.6, 0.3), "Next door", "A pocket park, <i>all yours</i>"),
        ("hero-exterior.jpg", ("pan", 0.35, 0.6), "Now leasing", "Come <i>see it.</i>"),
    ],
}


def reel_caption(kicker, line):
    return (f'<div class="reelcap"><div class="shade"></div>'
            f'<div class="brand">{MARK}<p class="wm serif">Charlotte <i>Square</i></p></div>'
            f'<div class="box"><p class="caps">{kicker}</p><h2 class="serif">{line}</h2></div></div>')


ENDCARD = f"""<div class="endcard">{GHOST}{MARK}
  <p class="caps">Charlotte Square · East End, Rochester</p>
  <h2 class="serif">Now<br><i>leasing.</i></h2>
  <p class="from"><b>From {FROM_RENT} a month</b>One to three bedrooms. A garage space with every lease.</p>
  <div class="call"><p class="caps">Call Tatum to tour</p><p class="num">{PHONE}</p><p class="site">{SITE}</p></div>
  {LEGAL}</div>"""


COVERS = {
    "reel-1-inside": ("hero-lounge.jpg", "40% 50%", "Charlotte Square", "Inside<br><i>the Square</i>"),
    "reel-2-east-end": ("hero-aerial.jpg", "60% 50%", "Charlotte Square", "Your<br><i>East End</i>"),
}


def cover(img, pos, kicker, title):
    return (f'<div class="cover"><img class="bg" src="{IMG}{img}" alt="" style="object-position:{pos}">'
            f'<div class="in">{MARK}<p class="caps">{kicker}</p><h2 class="serif">{title}</h2></div></div>')


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".html"):
            os.remove(os.path.join(OUT, f))
    for name, body in GRID:
        with open(os.path.join(OUT, f"grid-{name}.html"), "w") as fh:
            fh.write(page(name, 1080, 1350, body))
    for reel, scenes in REELS.items():
        for i, (_, _, kicker, line) in enumerate(scenes, 1):
            with open(os.path.join(OUT, f"{reel}-cap{i}.html"), "w") as fh:
                fh.write(page(f"{reel} {i}", 1080, 1920, reel_caption(kicker, line), transparent=True, safe=SAFE_REEL))
    with open(os.path.join(OUT, "reel-endcard.html"), "w") as fh:
        fh.write(page("end card", 1080, 1920, ENDCARD, safe=SAFE_REEL))
    for reel, (img, pos, kicker, title) in COVERS.items():
        with open(os.path.join(OUT, f"{reel}-cover.html"), "w") as fh:
            fh.write(page(f"{reel} cover", 1080, 1920, cover(img, pos, kicker, title), safe=SAFE_COVER))
    print("wrote", len(os.listdir(OUT)), "pages to", os.path.relpath(OUT))


if __name__ == "__main__":
    main()
