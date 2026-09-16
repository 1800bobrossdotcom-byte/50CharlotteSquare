// Archived from assets/js/main.js when the site was locked to Gallery.
//
// It reads the current data-style off <html>, writes the pick to localStorage
// under "cs-style", and removes the attribute entirely for Brick & Stone, which
// is the base layer rather than an override. Paste it back into the first IIFE
// in main.js, above the footer-year block, and restore STYLER and NO_FLASH from
// styler.py alongside it.

  /* ---- Style switcher (mock-up review tool) ------------------------------ */
  const styler = $('[data-styler]');
  if (styler) {
    const NAMES = { brick: 'Brick & Stone', gallery: 'Gallery', atelier: 'Atelier', dusk: 'Dusk' };
    const LEGACY = { night: 'atelier' };  // an earlier direction this one replaced
    const btn = $('.styler__btn', styler);
    const menu = $('.styler__menu', styler);
    const nameEl = $('[data-styler-name]', styler);
    const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    const apply = (s, persist) => {
      s = LEGACY[s] || s;
      if (!NAMES[s]) s = 'brick';
      if (s === 'brick') document.documentElement.removeAttribute('data-style');
      else document.documentElement.setAttribute('data-style', s);
      nameEl.textContent = NAMES[s];
      $$('.styler__opt', styler).forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.stylePick === s)));
      if (persist) { try { localStorage.setItem('cs-style', s); } catch (e) { /* storage unavailable */ } }
    };
    apply(document.documentElement.getAttribute('data-style') || 'brick', false);
    btn.addEventListener('click', () => setOpen(menu.hidden));
    styler.addEventListener('click', (e) => {
      const o = e.target.closest('[data-style-pick]');
      if (o) { apply(o.dataset.stylePick, true); setOpen(false); btn.focus(); }
    });
    document.addEventListener('click', (e) => { if (!styler.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

