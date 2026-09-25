#!/usr/bin/env python3
"""Charlotte Square social ads, in the Evolution24 hiring-ad language: dark
ground, a big serif headline with one italic accent, a ruled row of three
figures, contact and a QR code at the foot. Writes self-contained HTML to
marketing/social-ads/src/; render.mjs turns each into a PNG."""
import os, segno

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")
SITE = "https://www.charlottesquareroc.com"

MARK = ('<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#A93B3F"/>'
        '<path d="M9 9 H55 V27 H45 V19 H19 V45 H55 V55 H9 Z" fill="#fff"/></svg>')
GHOST = ('<svg class="ghost" viewBox="9 9 46 46" aria-hidden="true">'
         '<path d="M9 9 H55 V27 H45 V19 H19 V45 H55 V55 H9 Z" fill="currentColor"/></svg>')
EHO = ('<svg class="eho" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">'
       '<path d="M3 11l9-7 9 7v9H3z"/><path d="M7 20v-6h10v6"/><path d="M9 17h6"/></svg>')

def qr_svg(campaign):
    url = f"{SITE}/tour/?utm_source=social&utm_medium=qr&utm_campaign={campaign}"
    q = segno.make(url, error="m")
    n = q.symbol_size(border=0)[0]
    rects = []
    for y, row in enumerate(q.matrix):
        x = 0
        while x < n:
            if row[x]:
                start = x
                while x < n and row[x]:
                    x += 1
                rects.append(f"M{start} {y}h{x - start}v1h-{x - start}z")
            else:
                x += 1
    return url, (f'<svg class="qr__code" viewBox="0 0 {n} {n}" shape-rendering="crispEdges" aria-hidden="true">'
                 f'<path d="{"".join(rects)}" fill="#1A1613"/></svg>')

CSS = """
:root {
  --bg: #1A1613; --cream: #F1ECE1; --body: #BEB6A7; --muted: #8F877A;
  --sand: #E2B07A; --line: rgba(241, 236, 225, .17); --brick: #A93B3F;
}
* { box-sizing: border-box; margin: 0; }
html, body { background: var(--bg); }
.ad {
  position: relative; overflow: hidden; width: 1080px; height: 1080px;
  background: var(--bg); color: var(--cream);
  font-family: 'DM Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  padding: 70px 76px 54px; display: flex; flex-direction: column;
}
/* Stories keep clear of Instagram's own bars: the top 250 px carry the
   progress bar and account name, the bottom 250 px the reply field and
   wherever the link sticker goes. */
.ad--story { height: 1920px; padding: 250px 80px 250px; }
i { font-style: italic; }

.ghost { position: absolute; right: -90px; bottom: -110px; width: 470px; height: 470px; color: var(--cream); opacity: .045; pointer-events: none; }

.top { display: flex; align-items: flex-start; justify-content: space-between; position: relative; z-index: 2; }
.brand { display: flex; align-items: center; gap: 16px; }
.mark { width: 54px; height: 54px; border-radius: 5px; flex: none; }
.wm { font-family: 'Instrument Serif', Georgia, serif; font-size: 36px; line-height: 1; letter-spacing: -.005em; }
.wm i { color: var(--sand); }
.wm-sub { margin-top: 7px; font-size: 11.5px; font-weight: 600; letter-spacing: .34em; color: var(--sand); }
.kicker { margin-top: 12px; font-size: 15px; font-weight: 600; letter-spacing: .32em; color: var(--sand); }

.hl {
  font-family: 'Instrument Serif', Georgia, serif; font-weight: 400;
  font-size: 118px; line-height: .94; letter-spacing: -.012em; margin-top: 96px;
}
.hl i { color: var(--sand); }
.sub { margin-top: 30px; font-size: 25px; line-height: 1.45; color: var(--body); max-width: 860px; text-wrap: pretty; }

.stats {
  margin-top: 40px; padding: 26px 0 28px;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 28px;
}
.fig { font-family: 'Instrument Serif', Georgia, serif; font-size: 64px; line-height: 1; letter-spacing: -.01em; white-space: nowrap; }
.lab { margin-top: 12px; font-size: 12.5px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); line-height: 1.5; }

.bottom { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 40px; position: relative; z-index: 2; }
.tag { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-size: 38px; line-height: 1.15; color: var(--sand); max-width: 640px; margin-bottom: 26px; text-wrap: pretty; }
.clab { font-size: 12.5px; font-weight: 600; letter-spacing: .28em; text-transform: uppercase; color: var(--sand); }
.cval { margin-top: 5px; font-size: 27px; font-weight: 500; letter-spacing: -.005em; color: var(--cream); }
.cval + .clab { margin-top: 20px; }
.qr { display: flex; flex-direction: column; align-items: center; gap: 14px; flex: none; }
.qr__card { width: 196px; height: 196px; background: #fff; border-radius: 18px; padding: 16px; }
.qr__code { display: block; width: 100%; height: 100%; }

.legal { margin-top: 28px; display: grid; grid-template-columns: auto 1fr; column-gap: 10px; row-gap: 3px; align-items: center; font-size: 12px; letter-spacing: .02em; line-height: 1.4; color: var(--muted); position: relative; z-index: 2; max-width: 600px; }
.legal span + span { grid-column: 2; }
.eho { width: 17px; height: 17px; flex: none; }

/* ---- With a photograph: the picture fills the top and fades into the ground. */
.ad--photo .shot { position: absolute; inset: 0 0 auto 0; height: 560px; }
.ad--story.ad--photo .shot { height: 1180px; }
/* On a photograph the small caps go cream, with a soft shadow, because sand
   disappears against warm wood and brick. */
.ad--photo .wm-sub, .ad--photo .kicker { color: var(--cream); }
.ad--photo .top p { text-shadow: 0 1px 14px rgba(0, 0, 0, .55); }
.shot { background: var(--bg); }
.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.shot img.low { object-position: 50% 85%; }   /* fewer pergola beams behind the logo */
.shot::before, .shot::after { content: ""; position: absolute; left: 0; right: 0; }
/* The logo row sits on the picture, so the top gets its own shade. */
.shot::before { top: 0; height: 300px; background: linear-gradient(rgba(26, 22, 19, .88), rgba(26, 22, 19, .5) 45%, rgba(26, 22, 19, 0)); }
/* Past the bottom edge by a few pixels, so no seam shows at 4/3 scale. */
.shot::after { bottom: -4px; height: 72%; background: linear-gradient(rgba(26, 22, 19, 0), rgba(26, 22, 19, .9) 55%, #1A1613 90%); }
.ad--story .shot::before { height: 560px; background: linear-gradient(rgba(26, 22, 19, .9), rgba(26, 22, 19, .6) 55%, rgba(26, 22, 19, 0)); }
.ad--photo .hl { margin-top: auto; font-size: 104px; position: relative; z-index: 2; }
.ad--photo .stats { position: relative; z-index: 2; margin-top: 34px; }
.ad--photo .bottom { margin-top: 36px; }
.ad--story .hl { font-size: 124px; }
.ad--story .sub { position: relative; z-index: 2; font-size: 30px; }
.ad--story .stats { margin-top: 46px; }
.ad--story .fig { font-size: 70px; }
.ad--story .lab { font-size: 15px; }
.ad--story .cval { font-size: 34px; }
.ad--story .clab { font-size: 15px; }
.ad--story .legal { font-size: 15px; }
"""

def page(ad, size, body):
    w, h = size
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width={w}">
<meta name="ad-size" content="{w}x{h}">
<title>{ad['name']}</title>
<link rel="stylesheet" href="../../../assets/fonts/fonts.css">
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>
"""

def top(kicker):
    return (f'<header class="top"><div class="brand">{MARK}<div><p class="wm">Charlotte <i>Square</i></p>'
            f'<p class="wm-sub">AT THE EAST END</p></div></div><p class="kicker">{kicker}</p></header>')

def stats(items):
    return '<div class="stats">' + "".join(f'<div><p class="fig">{f}</p><p class="lab">{l}</p></div>' for f, l in items) + "</div>"

def contact(tag=None, qr=None, qr_label="Scan to book a tour"):
    left = (f'<p class="tag">{tag}</p>' if tag else "") + (
        '<p class="clab">Book a tour</p><p class="cval">charlottesquareroc.com/tour</p>'
        '<p class="clab">Call</p><p class="cval">(585) 748-5588</p>')
    right = f'<div class="qr"><div class="qr__card">{qr}</div><p class="clab">{qr_label}</p></div>' if qr else ""
    return f'<footer class="bottom"><div>{left}</div>{right}</footer>'

def legal(extra=""):
    more = f'<span>{extra}</span>' if extra else ''
    return f'<p class="legal">{EHO}<span>Equal Housing Opportunity · Managed by Evolution24 Properties</span>{more}</p>'

RENT = "Rents from $1,750 a month as of September 2026, subject to availability."
ADS = []

def ad(name, size, cls, body):
    ADS.append((name, size, cls, body))

# 1. Leasing, typographic ---------------------------------------------------
url1, qr1 = qr_svg("ad-leasing")
ad("01-now-leasing", (1080, 1080), "ad",
   top("NOW LEASING")
   + '<h1 class="hl">Luxury living,<br><i>parking included.</i></h1>'
   + '<p class="sub">One-, two- and three-bedroom apartments at 50 Charlotte Street,<br>a block from Main Street and East Avenue.</p>'
   + stats([("$1,750+", "Per month · 1–3 bedrooms"), ("765–1,640", "Square feet"), ("Garage", "One space included")])
   + contact("At the heart of Rochester’s East End.", qr1) + legal(RENT))

# 2. The block, typographic -------------------------------------------------
url2, qr2 = qr_svg("ad-east-end")
ad("02-east-end", (1080, 1080), "ad",
   top("ROCHESTER’S EAST END")
   + '<h1 class="hl">Your whole East End,<br><i>on foot.</i></h1>'
   + '<p class="sub">Coffee, dinner, the Eastman Theatre and The Little,<br>all a short walk from your front door.</p>'
   + stats([("No. 37", "Chick’n Out"), ("No. 50", "Your front door"), ("No. 89", "Ugly Duck Coffee")])
   + contact("Live on the block, not just near it.", qr2) + legal())

# 3. The terrace, photo -----------------------------------------------------
url3, qr3 = qr_svg("ad-terrace")
ad("03-terrace", (1080, 1080), "ad ad--photo",
   '<div class="shot"><img class="low" src="../../../assets/img/hero-terrace.jpg" alt=""></div>' + top("AMENITIES")
   + '<h1 class="hl">Evenings on<br><i>the terrace.</i></h1>'
   + stats([("Fire pit", "And grills under the pergola"), ("Fitness", "Center on site"), ("EV", "Charging and bike storage")])
   + contact("A fire pit, grills and a view of downtown.", qr3) + legal())

# 4. Come see it, photo -----------------------------------------------------
url4, qr4 = qr_svg("ad-tour")
ad("04-see-it-in-person", (1080, 1080), "ad ad--photo",
   '<div class="shot"><img src="../../../assets/img/hero-exterior.jpg" alt=""></div>' + top("TOURS BY APPOINTMENT")
   + '<h1 class="hl">See your next home<br><i>in person.</i></h1>'
   + stats([("1–3", "Bedrooms"), ("765–1,640", "Square feet"), ("In-unit", "Laundry in every home")])
   + contact("Tours by appointment, Monday to Friday.", qr4) + legal())

# 5. Leasing, story ---------------------------------------------------------
ad("05-now-leasing-story", (1080, 1920), "ad ad--story ad--photo",
   '<div class="shot"><img src="../../../assets/img/terrace.jpg" alt=""></div>' + top("NOW LEASING")
   + '<h1 class="hl">Luxury living,<br><i>parking included.</i></h1>'
   + '<p class="sub">One-, two- and three-bedroom apartments<br>in Rochester’s East End.</p>'
   + stats([("$1,750+", "Per month"), ("1–3", "Bedrooms"), ("Garage", "Space included")])
   + contact() + legal(RENT))

# 6. The block, story -------------------------------------------------------
ad("06-east-end-story", (1080, 1920), "ad ad--story ad--photo",
   '<div class="shot"><img src="../../../assets/img/east-end-street.jpg" alt=""></div>' + top("ROCHESTER’S EAST END")
   + '<h1 class="hl">Your whole East End,<br><i>on foot.</i></h1>'
   + '<p class="sub">The Eastman Theatre, The Little, coffee and dinner,<br>all a short walk from 50 Charlotte Street.</p>'
   + stats([("No. 37", "Chick’n Out"), ("No. 50", "Home"), ("No. 89", "Ugly Duck Coffee")])
   + contact() + legal())

os.makedirs(OUT, exist_ok=True)
for name, size, cls, body in ADS:
    html = page({"name": name}, size, f'<div class="{cls}">{body}</div>')
    with open(os.path.join(OUT, f"{name}.html"), "w", encoding="utf-8") as f:
        f.write(html)
print("\n".join(f"{u}" for u in (url1, url2, url3, url4)))
print(f"wrote {len(ADS)} ads")
