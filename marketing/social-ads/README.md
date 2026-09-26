# Social ads

Ten ads for Instagram and Facebook, in the language of the Evolution24 hiring
ad: dark ground, a serif headline with one italic accent, three figures between
two rules, then the line to act on. Charlotte Square's own mark, fonts
(Instrument Serif and DM Sans, the site's Gallery style) and photographs.

| File | Format |
| --- | --- |
| `01-now-leasing.png` | Feed, 1440×1440 |
| `02-east-end.png` | Feed, 1440×1440 |
| `03-terrace.png` | Feed, 1440×1440 |
| `04-see-it-in-person.png` | Feed, 1440×1440 |
| `05-now-leasing-story.png` | Story, 1440×2560 |
| `06-east-end-story.png` | Story, 1440×2560 |
| `07-leed-gold.png` | Feed, 1440×1440 · LEED series |
| `08-leed-solar.png` | Feed, 1440×1440 · LEED series |
| `09-leed-award.png` | Feed, 1440×1440 · LEED series |
| `10-leed-story.png` | Story, 1440×2560 · LEED series |

**The LEED series (07–10)** swaps the sand accent for gold and carries a LEED
Gold seal set in the site's own type. It is not the USGBC logo, which has its
own usage rules. The facts are the ones checked for the website: LEED Gold
certified (LEED for Homes), and the top Urban Multi-Family project in the 2017
NAIOP Upstate New York Awards of Excellence. Each one adds the line "LEED® is a
registered trademark of the U.S. Green Building Council." to the small print.

**For now the only contact is "Call Vicki (585) 748-5588".** The "Book a tour"
address and the QR codes point at `/tour/`, which exists only once the site is
live on Cloudflare, so they are switched off. After launch, set
`SITE_LIVE = True` at the top of `make_ads.py` and re-render: the address comes
back, and each feed post gets a QR code with its own campaign name
(`ad-leasing`, `ad-east-end`, `ad-terrace`, `ad-tour`, `ad-leed`, `ad-solar`,
`ad-award`), so every ad shows up as
its own row under Campaigns on the dashboard.

Stories never carry a QR code: people see them on the phone they would scan
with. After launch, add Instagram's link sticker at the bottom, with a link
from the dashboard's **Make a tracking link** box. The top and bottom 250 px of
a story are kept clear of Instagram's own bars.

Every ad carries the Equal Housing Opportunity mark and "Managed by
Evolution24 Properties"; the two that state a rent say when it was listed.

## Suggested captions and alt text

1. **Now leasing.** Luxury one-, two- and three-bedroom apartments at 50
   Charlotte Street, with a garage parking space in every lease. Tours by
   appointment. *Alt:* "Charlotte Square ad: Luxury living, parking included.
   From $1,750 a month, 765 to 1,640 square feet, one garage space included."
2. **The East End.** Coffee at No. 89, dinner at No. 37, and the Eastman
   Theatre and The Little a short walk away. Come see the block. *Alt:*
   "Charlotte Square ad: Your whole East End, on foot. No. 37 Chick'n Out, No.
   50 your front door, No. 89 Ugly Duck Coffee."
3. **The terrace.** A fire pit, grills under the pergola and a view of
   downtown. *Alt:* "Residents at the fire table under the pergola on
   Charlotte Square's shared terrace, with downtown Rochester behind."
4. **Come see it.** Tours by appointment, Monday to Friday, 8am to 4pm. Call
   Vicki at (585) 748-5588. *Alt:*
   "The red and grey four-storey Charlotte Square building on Charlotte
   Street, with the words See your next home in person."
7. **LEED Gold.** Charlotte Square is LEED Gold certified: independent
   reviewers checked its energy efficiency, water use, indoor air quality and
   materials. Luxury, built to a higher standard. *Alt:* "Charlotte Square ad:
   Built green. Certified Gold. A LEED Gold certificate beside the headline,
   with rooftop solar, EV charging and secure bike storage."
8. **Solar.** Solar panels on the roof help power the building, a block from
   Main Street. *Alt:* "Aerial photograph of Charlotte Square with solar panels
   across the roof, and the words Powered, in part, by the sun."
9. **Award-winning.** Named the top urban multifamily project in NAIOP Upstate
   New York's 2017 Awards of Excellence, and LEED Gold certified. *Alt:*
   "Charlotte Square ad: Award-winning. Certified green. 2017 NAIOP Award of
   Excellence, LEED Gold, 72 homes."
10. **Story.** *Alt:* "Aerial photograph of Charlotte Square's solar roof, with
    the words Built green. Certified Gold."

## Changing them

The copy lives in `make_ads.py`; it writes the HTML in `src/`, and
`render.cjs` turns that into the PNGs (1080 CSS px at 4/3 scale).

```bash
pip install segno                  # QR codes, once SITE_LIVE is True
python3 marketing/social-ads/make_ads.py
npx playwright install chromium    # once
node marketing/social-ads/render.cjs          # every ad
node marketing/social-ads/render.cjs 07 08    # only the ads named so
```

This folder is not part of the website: `scripts/stage.sh` never copies it.
