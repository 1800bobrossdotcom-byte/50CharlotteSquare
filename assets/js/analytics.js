/* =============================================================================
   Charlotte Square — first-party analytics.

   Sends to /api/collect on this same origin, which is why the Content Security
   Policy needs no third-party origin added and why no request leaves Cloudflare.

   What it never does: set a cookie, read one, store anything in the browser, or
   send an IP. The server derives a daily-rotating hash for counting and throws
   the address away. Delete this file and the <script> tag that loads it and the
   site is exactly as it was.
   ============================================================================= */
(() => {
  'use strict';

  // An explicit Do Not Track signal is honoured, even though nothing here is
  // personal. Set to false if the leasing numbers need to be complete.
  const HONOUR_DNT = true;
  const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
              navigator.msDoNotTrack === '1' || navigator.globalPrivacyControl === true;
  if (HONOUR_DNT && dnt) return;

  const ENDPOINT = '/api/collect';

  const device = () => {
    const w = Math.min(screen.width, screen.height);
    if (w <= 480) return 'mobile';
    if (w <= 1024) return 'tablet';
    return 'desktop';
  };

  const style = () => document.documentElement.getAttribute('data-style') || 'brick';

  function send(kind, meta) {
    const body = JSON.stringify({
      kind,
      path: location.pathname,
      ref: document.referrer || null,
      device: device(),
      style: style(),
      meta: meta || undefined,
    });
    try {
      // sendBeacon survives the page being closed, which matters for the click
      // events below — they are usually the last thing to happen on the page.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST', body, keepalive: true,
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
    } catch (e) { /* a metric is never worth an error in the console */ }
  }

  send('pageview');

  /* ---- Named events -------------------------------------------------------
     Delegated from the document, so this file adds no listeners to anything in
     particular and nothing else has to know it exists. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';

    if (href.startsWith('tel:')) return send('phone_click');
    if (href.includes('rentmanager.com')) return send('portal_click');
    if (href.includes('maps.google.com')) return send('map_click');
    if (a.hasAttribute('data-lightbox')) {
      return send('gallery_open', { caption: (a.dataset.caption || '').slice(0, 80) });
    }
    if (/^https?:/i.test(href) && !href.includes(location.host)) {
      try { return send('outbound', { host: new URL(href).hostname }); } catch (err) { /* ignore */ }
    }
  }, { capture: true });

  // Which floor plan a visitor filtered to — the leasing-relevant one.
  document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('[data-filter-group] [data-filter]');
    if (chip) send('plan_view', { plan: (chip.textContent || '').trim().slice(0, 40) });
  });

  // main.js announces a completed enquiry; nothing listens if this file is gone.
  document.addEventListener('cs:lead', (e) => {
    send('tour_request', (e.detail && e.detail.plan) ? { plan: String(e.detail.plan).slice(0, 40) } : undefined);
  });
})();
