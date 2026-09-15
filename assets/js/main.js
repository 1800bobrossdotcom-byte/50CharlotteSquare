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

  /* ---- Ticker: duplicate items so the loop is seamless -------------------- */
  $$('.ticker__track').forEach((track) => {
    if (reduceMotion) return;
    const items = Array.from(track.children);
    items.forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
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

      try {
        if (endpoint) {
          // Formspree / Basin / your own handler: any endpoint that accepts a POSTed form.
          const res = await fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          form.reset();
          showStatus(true, 'Thanks — your message is on its way. We typically reply within one business day.');
        } else {
          // No endpoint configured yet: open the visitor's email app with the message pre-filled.
          const lines = [];
          data.forEach((v, k) => { if (String(v).trim()) lines.push(`${labelFor(k)}: ${v}`); });
          const who = `${data.get('first_name') || ''} ${data.get('last_name') || ''}`.trim();
          const subject = encodeURIComponent(`Charlotte Square inquiry — ${who}`);
          const body = encodeURIComponent(lines.join('\n'));
          window.location.href = `mailto:${form.dataset.email || ''}?subject=${subject}&body=${body}`;
          showStatus(true, `Your email app should open with your message ready to send. If it doesn't, call us at ${phone}.`);
        }
      } catch (err) {
        showStatus(false, `Something went wrong sending your message. Please call ${phone} or email us directly.`);
      } finally {
        btn.disabled = false;
        btn.innerHTML = label;
      }
    });
  }

  /* ---- Style switcher (mock-up review tool) ------------------------------ */
  const styler = $('[data-styler]');
  if (styler) {
    const NAMES = { brick: 'Brick & Stone', gallery: 'Gallery', night: 'Night' };
    const btn = $('.styler__btn', styler);
    const menu = $('.styler__menu', styler);
    const nameEl = $('[data-styler-name]', styler);
    const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    const apply = (s, persist) => {
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

  /* ---- Footer year -------------------------------------------------------- */
  $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();
