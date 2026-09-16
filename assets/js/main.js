/* =============================================================================
   Charlotte Square — main.js (vanilla, no dependencies)
   Header state · mobile drawer · reveal-on-scroll · ticker · plan filters
   · contact form (endpoint or mailto fallback) · footer year
   ============================================================================= */
(() => {
  'use strict';
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Missing photo -> show the labelled placeholder --------------------
     This used to be an onerror="" attribute on every <img>. Inline event
     handlers are blocked by the Content Security Policy even when the inline
     <script> hashes are allowed, so it lives here instead.
     Two halves, and both are needed: the listener catches images that fail
     after this file runs, and the sweep catches the ones that already failed
     while the parser was still working, since 'error' does not replay. It is
     registered in the capture phase because 'error' does not bubble. */
  const dropImage = (img) => {
    const fig = img.parentNode;
    if (fig && fig.classList) fig.classList.add('is-empty');
    img.remove();
  };
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG') dropImage(e.target);
  }, true);
  $$('img').forEach((img) => {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) dropImage(img);
  });

  /* ---- Header: solid once the page scrolls ------------------------------- */
  const topbar = $('.topbar');
  const onScroll = () => topbar && topbar.classList.toggle('is-scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- Mobile drawer ------------------------------------------------------ */
  const drawer  = $('#drawer');
  const toggles = $$('[data-menu-toggle]');
  let lastFocus = null;
  const setMenu = (open) => {
    if (!drawer) return;
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('menu-open', open);
    toggles.forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (open) {
      lastFocus = document.activeElement;
      const first = $('a, button', drawer);
      first && first.focus();
    } else if (lastFocus) {
      lastFocus.focus();
    }
  };
  toggles.forEach((b) => b.addEventListener('click', () => setMenu(!drawer.classList.contains('is-open'))));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer && drawer.classList.contains('is-open')) setMenu(false);
  });
  if (drawer) $$('a', drawer).forEach((a) => a.addEventListener('click', () => setMenu(false)));

  /* ---- Reveal on scroll --------------------------------------------------- */
  const revealEls = $$('.reveal');
  if ('IntersectionObserver' in window && revealEls.length && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* ---- Ticker -------------------------------------------------------------
     A marquee that cannot be stopped fails WCAG 2.2.2, and :hover is not a
     mechanism — it is unreachable by keyboard and by touch. So the motion is
     opt-in via a real button, and prefers-reduced-motion only decides what that
     button starts as. Someone who wants the movement can still have it; someone
     who asked their OS for stillness gets stillness without losing the content,
     because the stopped ticker becomes a scrollable row. */
  const ICON = {
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  };
  $$('.ticker').forEach((ticker) => {
    const track = $('.ticker__track', ticker);
    if (!track) return;

    // The loop works by translating the track -50%, which only reads as seamless
    // once the items appear twice. Cloned on first play, so a ticker that never
    // runs does not show every name twice in its scrollable row.
    let cloned = false;
    const cloneOnce = () => {
      if (cloned) return;
      Array.from(track.children).forEach((item) => {
        const clone = item.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      });
      cloned = true;
    };

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ticker__toggle';

    const setRunning = (run, remember) => {
      if (run) cloneOnce();
      ticker.classList.toggle('is-running', run);
      btn.innerHTML = run ? ICON.pause : ICON.play;
      btn.setAttribute('aria-pressed', String(run));
      btn.setAttribute('aria-label', run ? 'Stop the scrolling list' : 'Start the scrolling list');
      if (remember) { try { localStorage.setItem('cs-ticker', run ? 'run' : 'stop'); } catch (e) {} }
    };

    let stored = null;
    try { stored = localStorage.getItem('cs-ticker'); } catch (e) {}
    setRunning(stored ? stored === 'run' : !reduceMotion, false);

    btn.addEventListener('click', () => setRunning(!ticker.classList.contains('is-running'), true));
    ticker.appendChild(btn);
  });

  /* ---- Floor plan filters ------------------------------------------------- */
  const chipWrap = $('[data-filter-group]');
  if (chipWrap) {
    const scope = chipWrap.closest('section') || document;
    const plans = $$('[data-beds]', scope);
    const empty = $('.plans__empty', scope);
    chipWrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      $$('.chip', chipWrap).forEach((c) => {
        const active = c === chip;
        c.classList.toggle('is-active', active);
        c.setAttribute('aria-pressed', String(active));
      });
      const f = chip.dataset.filter;
      let shown = 0;
      plans.forEach((p) => {
        const show = f === 'all' || p.dataset.beds === f;
        p.hidden = !show;
        if (show) shown++;
      });
      if (empty) empty.style.display = shown ? 'none' : 'block';
    });
  }

  /* ---- Contact form ------------------------------------------------------- */
  const form = $('form[data-contact]');
  if (form) {
    const phone = form.dataset.phone || '';
    const status = $('.form__status', form);

    // Prefill from the query string, e.g. contact/?plan=2&interest=tour
    const prefill = (q) => {
      ['plan', 'interest'].forEach((name) => {
        const el = form.elements[name];
        const v = q.get(name);
        if (el && v && Array.from(el.options).some((o) => o.value === v)) el.value = v;
      });
    };
    prefill(new URLSearchParams(location.search));
    document.addEventListener('cs:prefill', (e) => prefill(e.detail));

    const labelFor = (name) => {
      const el = form.elements[name];
      const lab = el && el.id ? $(`label[for="${el.id}"]`, form) : null;
      return lab ? lab.textContent.replace('*', '').trim() : name;
    };
    const showStatus = (ok, msg) => {
      if (!status) return;
      status.textContent = msg;
      status.className = 'form__status ' + (ok ? 'is-ok' : 'is-err');
      status.setAttribute('tabindex', '-1');
      status.focus();
    };
    const validate = () => {
      let valid = true;
      $$('.field', form).forEach((f) => {
        const input = $('input, select, textarea', f);
        if (!input) return;
        const ok = input.checkValidity();
        f.classList.toggle('is-invalid', !ok);
        if (!ok) valid = false;
      });
      return valid;
    };
    form.addEventListener('input', (e) => {
      const f = e.target.closest('.field');
      if (f && f.classList.contains('is-invalid') && e.target.checkValidity()) f.classList.remove('is-invalid');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.elements['website'] && form.elements['website'].value) return; // honeypot
      if (!validate()) {
        const first = $('.field.is-invalid input, .field.is-invalid select, .field.is-invalid textarea', form);
        first && first.focus();
        return;
      }
      const btn = $('button[type="submit"]', form);
      const label = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      const data = new FormData(form);
      data.delete('website');
      const endpoint = (form.dataset.endpoint || '').trim();
      const to = (form.dataset.email || '').trim();

      try {
        if (endpoint) {
          // Formspree / Basin / your own handler: any endpoint that accepts a POSTed form.
          const res = await fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          form.reset();
          showStatus(true, 'Thanks — your message is on its way. We typically reply within one business day.');
        } else if (!to) {
          // Nowhere to deliver to yet: say so plainly and hand over the phone number.
          showStatus(false, `We can't send messages from the site just yet. Please call ${phone} and we'll take your details.`);
        } else {
          // No endpoint configured yet: open the visitor's email app with the message pre-filled.
          // Read the controls rather than the FormData so a dropdown sends what the
          // visitor actually chose ("Two bedroom"), not its value ("2").
          const lines = [];
          Array.from(form.elements).forEach((el) => {
            if (!el.name || el.name === 'website') return;
            if (el.tagName === 'SELECT' && !el.value) return;   // an unchosen placeholder
            const chosen = el.tagName === 'SELECT' && el.selectedOptions[0] ? el.selectedOptions[0].text : el.value;
            if (!String(chosen).trim()) return;
            lines.push(`${labelFor(el.name)}: ${String(chosen).trim()}`);
          });
          const who = `${data.get('first_name') || ''} ${data.get('last_name') || ''}`.trim();
          const subject = encodeURIComponent(`Charlotte Square inquiry — ${who}`);
          const body = encodeURIComponent(lines.join('\n'));
          window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
          showStatus(true, `Your email app should open with your message ready to send. If it doesn't, call us at ${phone}.`);
          // Announced, not reported: analytics.js listens if it is loaded, and
          // nothing happens if it is not.
          const planSel = form.elements['plan'];
          const planName = planSel && planSel.selectedOptions[0] ? planSel.selectedOptions[0].text : '';
          document.dispatchEvent(new CustomEvent('cs:lead', { detail: { plan: planName } }));
        }
      } catch (err) {
        showStatus(false, `Something went wrong sending your message. Please call ${phone} or email us directly.`);
      } finally {
        btn.disabled = false;
        btn.innerHTML = label;
      }
    });
  }

  /* ---- Footer year -------------------------------------------------------- */
  $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();

/* =============================================================================
   Hero gallery + lightbox (appended module)
   ============================================================================= */
(() => {
  'use strict';
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Hero slideshow ------------------------------------------------------ */
  $$('.hero[data-gallery]').forEach((hero) => {
    const slides = $$('.hero__slide', hero);
    if (slides.length < 2) return;
    const segs = $$('.hero__seg', hero);
    const cap = $('[data-hero-caption]', hero);
    const count = $('[data-hero-count]', hero);
    const media = $('.hero__media', hero);
    const ms = parseInt(hero.dataset.interval || '6500', 10);
    hero.style.setProperty('--slide-ms', ms + 'ms');
    let i = Math.max(0, slides.findIndex((s) => s.classList.contains('is-active')));
    let timer = null;
    let paused = false;

    const restart = () => {
      clearTimeout(timer);
      if (reduceMotion || paused || document.hidden) return;
      timer = setTimeout(() => show(i + 1), ms);
    };
    const show = (n) => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => s.classList.toggle('is-active', k === i));
      segs.forEach((g, k) => {
        g.classList.toggle('is-done', k < i);
        g.classList.remove('is-active');
        if (k === i) { void g.offsetWidth; g.classList.add('is-active'); }
        g.setAttribute('aria-current', k === i ? 'true' : 'false');
      });
      if (cap) cap.textContent = slides[i].dataset.caption || '';
      if (count) count.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
      const next = slides[(i + 1) % slides.length].querySelector('img');
      if (next && next.loading === 'lazy') next.loading = 'eager';
      restart();
    };
    const pause = () => { paused = true; hero.classList.add('is-paused'); clearTimeout(timer); };
    const resume = () => { paused = false; hero.classList.remove('is-paused'); restart(); };

    const prev = $('.hero__btn--prev', hero), nextBtn = $('.hero__btn--next', hero);
    prev && prev.addEventListener('click', () => show(i - 1));
    nextBtn && nextBtn.addEventListener('click', () => show(i + 1));
    segs.forEach((g, k) => g.addEventListener('click', () => show(k)));
    const bar = $('.hero__bar', hero);
    if (bar) { bar.addEventListener('mouseenter', pause); bar.addEventListener('mouseleave', resume); }
    hero.addEventListener('focusin', pause);
    hero.addEventListener('focusout', (e) => { if (!hero.contains(e.relatedTarget)) resume(); });
    hero.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
    });
    let x0 = null;
    if (media) {
      media.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
      media.addEventListener('pointerup', (e) => {
        if (x0 !== null && Math.abs(e.clientX - x0) > 40) show(i + (e.clientX < x0 ? 1 : -1));
        x0 = null;
      });
    }
    document.addEventListener('visibilitychange', () => (document.hidden ? clearTimeout(timer) : restart()));
    show(i);
  });

  /* ---- Lightbox for [data-lightbox] items ---------------------------------- */
  const items = $$('[data-lightbox]');
  if (!items.length) return;
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.setAttribute('aria-label', 'Photo viewer');
  dlg.innerHTML = `
    <button type="button" class="lightbox__close" aria-label="Close">${icon('M6 6l12 12M18 6L6 18')}</button>
    <div class="lightbox__stage">
      <img class="lightbox__img" alt="">
      <div class="lightbox__meta"><b class="lightbox__caption"></b><span class="lightbox__count"></span></div>
      <button type="button" class="lightbox__btn lightbox__btn--prev" aria-label="Previous photo">${icon('M15 5l-7 7 7 7')}</button>
      <button type="button" class="lightbox__btn lightbox__btn--next" aria-label="Next photo">${icon('M9 5l7 7-7 7')}</button>
    </div>`;
  document.body.appendChild(dlg);
  const img = $('.lightbox__img', dlg), capEl = $('.lightbox__caption', dlg), cnt = $('.lightbox__count', dlg);
  let idx = 0;
  const openAt = (n, dx = 0) => {
    idx = (n + items.length) % items.length;
    const it = items[idx];
    const src = it.dataset.full || it.getAttribute('href') || (it.querySelector('img') || {}).src || '';
    img.style.setProperty('--lb-dx', dx + 'px');
    img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
    img.src = src; img.alt = it.dataset.caption || '';
    capEl.textContent = it.dataset.caption || '';
    cnt.textContent = (idx + 1) + ' / ' + items.length;
    if (!dlg.open) { dlg.showModal(); document.body.classList.add('lightbox-open'); }
  };
  items.forEach((it, k) => it.addEventListener('click', (e) => { e.preventDefault(); openAt(k); }));
  $('.lightbox__btn--prev', dlg).addEventListener('click', () => openAt(idx - 1, -28));
  $('.lightbox__btn--next', dlg).addEventListener('click', () => openAt(idx + 1, 28));
  $('.lightbox__close', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => document.body.classList.remove('lightbox-open'));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') openAt(idx + 1, 28);
    if (e.key === 'ArrowLeft') openAt(idx - 1, -28);
  });
  let lx = null;
  img.addEventListener('pointerdown', (e) => { lx = e.clientX; });
  img.addEventListener('pointerup', (e) => { if (lx !== null && Math.abs(e.clientX - lx) > 40) openAt(idx + (e.clientX < lx ? 1 : -1), e.clientX < lx ? 28 : -28); lx = null; });
})();
