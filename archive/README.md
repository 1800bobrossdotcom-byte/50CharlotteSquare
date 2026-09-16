# Archive

Work that shipped, was reviewed, and was then taken out of the live site. It is
here rather than in the git history alone because history is only findable if
you already know what you are looking for.

Nothing in this folder is served. Cloudflare Pages publishes the repository root,
and no page links to anything under `archive/`, so these files cost nothing but
disk. They are also excluded from `sitemap.xml` and disallowed in `robots.txt`.

## What is here

| Folder | What it holds |
|---|---|
| `styles/` | The Atelier and Dusk design directions, and the style switcher's CSS |
| `style-switcher/` | The switcher's markup, its no-flash head script, and its JS |

## Why the site is Gallery now

Four directions were built so the choice could be made by looking rather than by
describing: **Brick & Stone**, **Gallery**, **Atelier** and **Dusk**. Gallery was
chosen in September 2026 and the switcher came out with the others, because a
control that lets a visitor restyle the building's website is a review tool, not
a feature.

**Brick & Stone is not in this folder, and cannot be.** It is the base layer —
the `:root` token block and every component rule in `assets/css/main.css`.
Gallery is an override of it on `<html data-style="gallery">`. So the base is
load-bearing even though no page renders it unstyled, and restoring Brick &
Stone is a matter of removing one attribute, not of adding a file.

## Restoring

### Brick & Stone

Remove `data-style="gallery"` from the `<html>` tag in `build_pages.py` (three
occurrences: the page template, the 404 and the redirect stub) and rebuild.

### Atelier or Dusk

1. Paste `styles/atelier.css` or `styles/dusk.css` into `assets/css/main.css`,
   immediately before the `/* ---------- Map fallback` block. Order matters:
   these are token overrides and they have to land after the base layer and
   after Gallery.
2. Set `data-style="atelier"` or `"dusk"` on `<html>` in `build_pages.py`.
3. Dusk only: check `.diagram .diagram__label.diagram__label--park` near the end
   of `main.css` still carries three class selectors. Dusk's
   `[data-style="dusk"] .diagram .diagram__label` ties it on specificity, and the
   third selector is what wins on source order. Drop it and the pocket-park
   label turns accent-coloured.

### The switcher

1. Paste `styles/style-switcher.css` into `main.css` before the map fallback.
2. Paste `style-switcher/switcher.js` into the first IIFE in `assets/js/main.js`,
   above the footer-year block.
3. Restore `STYLER` and `NO_FLASH` from `style-switcher/styler.py` into
   `build_pages.py`: emit `STYLER` in the page footer and `NO_FLASH` in `HEAD`.
4. Remove the hard-coded `data-style="gallery"` so the script can set it.

`NO_FLASH` is an inline `<script>` on purpose — it has to run before first paint
or a remembered pick flashes the wrong style. The Content Security Policy allows
it by SHA-256 hash, computed at build time by `inline_script_hashes()`. Putting
it back in `HEAD` updates the hash automatically. Do not reach for
`'unsafe-inline'`.
