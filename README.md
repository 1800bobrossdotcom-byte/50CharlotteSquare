# Charlotte Square — 50 Charlotte Street, Rochester NY

A fresh, bold marketing site for **Charlotte Square**, the 72-home apartment community at the heart of Rochester's East End, now managed by **Evolution24 Properties**. It replaces the dated Home Leasing site with a sleek, contemporary build: warm stone, deep ink, and a brick-red accent pulled straight from the building's panels, plus a squared "C" mark that echoes the sign on the façade.

No framework, no build step. Plain HTML, one stylesheet, one script. Open `index.html` in a browser and it works.

**Three design directions ship in this build.** A floating "Style" switcher in the bottom-right corner of every page toggles between them, and the choice sticks on that device:

| Style | Feel | Type | Accent |
|---|---|---|---|
| **Brick & Stone** (default) | Warm stone ground, bold grotesk, rounded cards | Bricolage Grotesque + Manrope | Brick `#D2452D` |
| **Gallery** | Editorial: white space, hairlines, serif italics, framed photography | Instrument Serif + DM Sans | Oxblood `#7A1F12` |
| **Night** | Dark ground, glassy cards, wide geometric type, gold | Syne + DM Sans | Gold `#E4B84A` |

You can also link straight to a style with `?style=gallery` or `?style=night` on any page.

## Pages

| URL | File | What it does |
|---|---|---|
| `/` | `index.html` | Hero, at-a-glance stats, intro, residences preview, amenity bento grid, East End ticker, management intro, tour CTA |
| `/residences/` | `residences/index.html` | Filterable 1/2/3-bedroom floor plans, what's included, in-home features, FAQ |
| `/amenities/` | `amenities/index.html` | Bento overview, detail rows (rooftop, fitness, community room, pocket park), sustainability, gallery |
| `/neighborhood/` | `neighborhood/index.html` | Walk/bike/transit, ticker, what's-near cards, Google map |
| `/story/` | `story/index.html` | The Charlotte story, podium cross-section diagram, LEED features, about Evolution24 |
| `/contact/` | `contact/index.html` | Working inquiry form, contact cards, resident portal, map |
| `/privacy/` | `privacy/index.html` | Privacy policy, accessibility statement, fair housing |
| `404.html` | | Self-contained not-found page (works at any depth) |

## Structure

```
index.html                 home
residences/ amenities/ neighborhood/ story/ contact/ privacy/   one index.html each (clean URLs)
404.html
assets/css/main.css        the whole design system (tokens → components → sections)
assets/js/main.js          header state, mobile drawer, reveal animations, ticker, plan filters, contact form
assets/img/                favicon.svg, og.png, and the photo slots listed below
assets/fonts/              self-hosted variable fonts + licenses
.github/workflows/pages.yml   deploys to GitHub Pages on push to main
site.webmanifest robots.txt sitemap.xml .nojekyll
```

## Preview locally

```bash
python3 -m http.server 8000      # then open http://localhost:8000
# or
npx http-server -p 8000
```

## Deploy (GitHub Pages)

1. Merge to `main`.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the repo root on every push to `main` (and, during the mock-up phase, to `claude/dazzling-hypatia-ap7gcn`).
4. For a custom domain, add a `CNAME` file containing the domain (for example `www.charlottesquareroc.com`), point DNS at GitHub Pages, then update the domain in `sitemap.xml` and `robots.txt`.

The site also works on Netlify, Vercel, Cloudflare Pages, or any static host: publish the repo root.

## Photos

Every image on the site is a **slot**: a fixed filename in `assets/img/`. Replace a file and the site updates; delete one and the slot falls back to art-directed gradient art with a small label naming the file it expects.

What is in the slots right now:

- **Building and common areas** (hero, lobby, community room, fitness center, plan cards, rooftop and terrace crops): the six photographs from the previous Charlotte Square website, at the resolution that site served them (about 1,000 px wide). They are stand-ins. In particular the "plan" cards and the "residence" slots show common-area photos because no apartment interiors were available, and the rooftop slots are crops of the exterior shot. Confirm rights to these images or reshoot before launch; a hero photo at 2,400 px or wider is the single biggest visual upgrade available.
- **Neighborhood** (East End photo on the home page, neighborhood hero, East Avenue, skyline view in the gallery): Creative Commons photographs from Wikimedia Commons, credited on the privacy page and below. The cropped versions in this repo are shared under the same licenses.

Recommended: JPG, 2000px on the long edge for heroes, 1600px for everything else, under 400 KB each.

| File | First used on | Shot | Aspect |
|---|---|---|---|
| `hero-exterior.jpg` | Home | Hero · building exterior from Charlotte St at golden hour | wide (16:9+), full-bleed |
| `community-room.jpg` | Home | Community room · kitchen bar and fireplace | 4:5 |
| `detail-terrace.jpg` | Home | Detail · a private terrace over Charlotte St | 1:1 |
| `plan-1br.jpg` | Home | Floor plan · One Bedroom interior | 4:3 |
| `plan-2br.jpg` | Home | Floor plan · Two Bedroom interior | 4:3 |
| `plan-3br.jpg` | Home | Floor plan · Three Bedroom interior | 4:3 |
| `rooftop-terrace.jpg` | Home | Rooftop terrace · pergola, fire pit and skyline at dusk | 16:10 |
| `fitness-center.jpg` | Home | Fitness center · cardio row and rig | 16:10 |
| `lobby-lounge.jpg` | Home | Lobby lounge · reclaimed wood wall | 16:10 |
| `pocket-park.jpg` | Home | Pocket park · fire pit and grills beside the building | 16:10 |
| `east-end-street.jpg` | Home | Neighborhood · East Avenue streetscape at blue hour | 4:5 |
| `residence-living.jpg` | Residences | Residence · living room toward the balcony | 16:10 |
| `residence-kitchen.jpg` | Residences | Residence · kitchen and dining | 4:5 |
| `amenities-hero.jpg` | Amenities | Amenities hero · rooftop terrace at dusk | wide (16:9+), full-bleed |
| `rooftop-evening.jpg` | Amenities | Rooftop terrace · evening with the fire pit lit | 4:3 |
| `fitness-rig.jpg` | Amenities | Fitness center · rig and free weights | 4:3 |
| `community-room-wide.jpg` | Amenities | Community room · wide view with kitchen bar | 4:3 |
| `pocket-park-summer.jpg` | Amenities | Pocket park · cookout in summer | 4:3 |
| `gallery-01.jpg` | Amenities | Gallery · lobby lounge | 4:3 |
| `gallery-02.jpg` | Amenities | Gallery · fitness center | 4:3 |
| `gallery-03.jpg` | Amenities | Gallery · community lounge seating | 4:3 |
| `gallery-04.jpg` | Amenities | Gallery · rooftop pergola | 4:3 |
| `gallery-05.jpg` | Amenities | Gallery · building exterior and pocket park | 4:3 |
| `gallery-06.jpg` | Amenities | Gallery · residence balcony view | 4:3 |
| `neighborhood-hero.jpg` | Neighborhood | Neighborhood hero · East Ave at night | wide (16:9+), full-bleed |
| `inner-loop-greenway.jpg` | Neighborhood | Neighborhood · Inner Loop greenway path | 4:5 |
| `story-hero.jpg` | Story | Story hero · exterior detail, brick panels and steel | wide (16:9+), full-bleed |
| `contact-hero.jpg` | Contact | Contact hero · lobby entrance on Charlotte St | wide (16:9+), full-bleed |
| `legal-hero.jpg` | Privacy | Legal hero · exterior detail | wide (16:9+), full-bleed |

### Photo credits

| Photo | Photographer | License | Used for |
|---|---|---|---|
| [Eastman Theatre before the show (2021)](https://commons.wikimedia.org/wiki/File:EastmanTheatre2021BeforeTheShow.jpg) | DanielPenfield | CC BY-SA 4.0 | `east-end-street.jpg` (cropped) |
| [Part of Rochester's skyline at night](https://commons.wikimedia.org/wiki/File:Part_of_Rochester%27s_Skyline_at_Nigh.jpg) | Factord3r | CC BY-SA 4.0 | `neighborhood-hero.jpg` (cropped) |
| [779 East Avenue, Rochester](https://commons.wikimedia.org/wiki/File:779_East_Avenue,_Rochester,_New_York.jpg) | Kenneth C. Zirkel | CC BY 4.0 | `inner-loop-greenway.jpg` (cropped) |
| [Downtown Rochester at dawn](https://commons.wikimedia.org/wiki/File:DowntownRochesterAtDawn.jpg) | DanielPenfield | CC BY-SA 4.0 | `gallery-06.jpg` (cropped) |

## Editing content

- **Copy** lives directly in each page's HTML. Search for the text you want to change.
- **Header and footer** are repeated in every page for zero-dependency hosting. Change them in one page, then copy the block to the others (or search-and-replace across files).
- **Phone, email, addresses**: search for `585-245-3071`, `tesacoleman9@gmail.com`, `176 N Water`.
- **Floor plans**: each card is an `<article class="plan" data-beds="…">` in `residences/index.html` and `index.html`. Edit square footage, bullets and the price line there. The filter chips work off `data-beds`.
- **Resident portal links** point at `https://evolution.twa.rentmanager.com/`.

## Contact form

The form in `contact/index.html` validates in the browser and then does one of two things:

- If `data-endpoint` on the `<form>` is set (Formspree, Basin, Netlify Forms, or your own handler), it POSTs there and shows an inline success or error message.
- If it is empty (the default), it opens the visitor's email app with the message pre-filled, addressed to `data-email`.

To go live with a real inbox: create a form at Formspree (or similar), paste its URL into `data-endpoint`, done. A honeypot field is already included. Query strings pre-select fields, so `contact/?plan=2&interest=tour` opens the form ready for a two-bedroom tour request; the residences cards and every "Schedule a tour" button already use this.

## Design system

Everything is a token in `assets/css/main.css`:

| Token | Value | Use |
|---|---|---|
| `--brick` | `#D2452D` | Accent: buttons, eyebrows, marks. From the building's red panels |
| `--ink` | `#121316` | Heroes, footer, dark sections |
| `--stone` | `#F4F1EB` | Page background. From the limestone podium |
| `--sage` | `#5E7A70` | Secondary accent. From the lounge interiors |
| `--steel` | `#6E727A` | Subtle text. From the metal cladding |

Type: **Bricolage Grotesque** for display, **Manrope** for body, self-hosted in `assets/fonts/` (SIL Open Font License, no third-party requests). Fluid sizes via `clamp()`. Dark mode follows the visitor's system setting automatically. Motion respects `prefers-reduced-motion`.

The same tokens, mark treatment (`Evolution<b>24</b>`) and type pairing can carry straight over to the new Evolution24 site so the portfolio reads as one family.

### Locking in a style for launch

The switcher is a review tool. Once a direction is chosen:

1. Set it on the root element of every page: `<html lang="en" data-style="gallery">` (omit the attribute for Brick & Stone).
2. Delete the `<div class="styler" …>` block from each page's footer and the "Style switcher" block in `assets/js/main.js`, plus the no-flash script in each `<head>` that reads `cs-style`.
3. Optionally delete the other styles' blocks from `main.css` and their font files from `assets/fonts/` to trim weight.

## Confirm before launch

These came from public listings or the previous site and should be verified with the leasing team:

- [ ] Leasing phone number (currently the Evolution24 main line) and a branded leasing email address
- [ ] Office hours and tour availability
- [ ] Two-bedroom square footage range (shown as approximate) and current pricing
- [ ] Exact list of included utilities
- [ ] Pet policy, parking for additional vehicles, lease terms
- [ ] Rent Manager online application link (add an "Apply" button once it exists)
- [ ] Ownership of the existing Facebook page and the `charlottesquareroc.com` domain
- [ ] Legal review of `privacy/index.html`
- [ ] Rights to the six building photographs from the previous site, or a reshoot at higher resolution
- [ ] Apartment interior photography for the plan cards and residence slots
