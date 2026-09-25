# Social ads

Six ads for Instagram and Facebook, in the language of the Evolution24 hiring
ad: dark ground, a serif headline with one italic accent, three figures between
two rules, then contact details and a QR code. Charlotte Square's own mark,
fonts (Instrument Serif and DM Sans, the site's Gallery style) and photographs.

| File | Format | QR code / link goes to |
| --- | --- | --- |
| `01-now-leasing.png` | Feed, 1440×1440 | `/tour/`, campaign `ad-leasing` |
| `02-east-end.png` | Feed, 1440×1440 | `/tour/`, campaign `ad-east-end` |
| `03-terrace.png` | Feed, 1440×1440 | `/tour/`, campaign `ad-terrace` |
| `04-see-it-in-person.png` | Feed, 1440×1440 | `/tour/`, campaign `ad-tour` |
| `05-now-leasing-story.png` | Story, 1440×2560 | add a link sticker (see below) |
| `06-east-end-story.png` | Story, 1440×2560 | add a link sticker (see below) |

**Post them after the site is live on Cloudflare.** The QR codes and the printed
address point at `/tour/`, which only exists there. Each QR code carries its own
campaign name, so every ad shows up as its own row under Campaigns on the
dashboard (source `social`, kind `qr`).

Stories have no QR code: people see them on the phone they would scan with.
Leave the bottom of a story clear and add Instagram's link sticker there, with a
link from the dashboard's **Make a tracking link** box (page: Tour page;
where: instagram; kind: unpaid social post, or paid social ad for a boosted
one; campaign: e.g. `story-leasing`). The top and bottom 250 px of a story are
already kept clear of Instagram's own bars.

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
4. **Come see it.** Tours by appointment, Monday to Friday, 8am to 4pm. *Alt:*
   "The red and grey four-storey Charlotte Square building on Charlotte
   Street, with the words See your next home in person."

## Changing them

The copy lives in `make_ads.py`; it writes the HTML in `src/`, and
`render.cjs` turns that into the PNGs (1080 CSS px at 4/3 scale).

```bash
pip install segno                  # QR codes
python3 marketing/social-ads/make_ads.py
npx playwright install chromium    # once
node marketing/social-ads/render.cjs
```

This folder is not part of the website: `scripts/stage.sh` never copies it.
