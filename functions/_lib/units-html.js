/* =============================================================================
   The open units, written into the page itself.

   main.js used to be the only thing that filled in the units list and the
   plan cards' prices, after the page loaded. Search engines that do not run
   scripts, and the assistants that answer apartment questions, read the page
   as it arrives, and there it said "Nothing is listed as open this minute"
   while a dozen homes were open. So the Worker now passes the residences,
   availability and home-type pages, and the home page, through here on the
   way out: the same rows and prices main.js would draw, in the HTML.

   The markup matches main.js's, so the filters and sort work on these rows
   as they are. The <html> element gets data-units-rendered, which tells
   main.js the list is already there.
   ============================================================================= */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const when = (a) => {
  if (a === 'now') return 'Available now';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a || '');
  return m ? `Available ${MON[Number(m[2]) - 1]} ${Number(m[3])}` : 'Opening soon';
};
const label = (u) => (/^\d/.test(u.unit) ? `Unit ${u.unit}` : String(u.unit));
const facts = (u) => [
  u.beds != null ? `${u.beds} bed` : null,
  u.baths != null ? `${u.baths} bath` : null,
  u.sqft ? `${Math.round(u.sqft).toLocaleString('en-US')} sq ft` : null,
].filter(Boolean).join(' · ');

/** Lowest rent first; a home without a rent goes last; ties by unit number. */
export function sortUnits(units) {
  return [...units].sort((a, b) => (!(a.rent > 0) - !(b.rent > 0)) || (a.rent - b.rent)
    || String(a.unit).localeCompare(String(b.unit), 'en', { numeric: true }));
}

function row(u, i) {
  const data = [
    u.beds != null ? ` data-beds="${esc(u.beds)}"` : '',
    ` data-furnished="${u.furnished ? 'yes' : 'no'}"`,
    u.rent > 0 ? ` data-rent="${esc(u.rent)}"` : '',
    u.sqft > 0 ? ` data-sqft="${esc(Math.round(u.sqft))}"` : '',
    ` data-order="${i}"`,
  ].join('');
  const tag = (u.special ? ' <span class="unit__tag unit__tag--special">Special</span>' : '')
    + (u.furnished ? ' <span class="unit__tag">Furnished</span>' : '');
  const rent = u.rent ? `${money(u.rent)}<span> a month</span>` : 'Rent on request';
  const apply = /^https:\/\//.test(u.apply || '')
    ? `<a class="btn btn--sm btn--primary unit__apply" href="${esc(u.apply)}" rel="noopener" aria-label="Apply for ${esc(label(u).toLowerCase())}">Apply</a>`
    : '';
  return `<article class="unit"${data}><div class="unit__head"><h3 class="unit__name">${esc(label(u))}${tag}</h3>`
    + `<p class="unit__meta">${esc(facts(u))}</p></div><p class="unit__rent">${rent}</p>`
    + `<p class="unit__when${u.available === 'now' ? ' is-now' : ''}">${esc(when(u.available))}</p>${apply}</article>`;
}

/** The page response with the units in it. With no units it is the page as built. */
export function withUnits(res, units) {
  if (!units.length) return res;
  const all = sortUnits(units);
  const ofBeds = (b) => all.filter((u) => String(u.beds) === String(b));
  let list = [];      // the units for the list being filled, set at its container
  let beds = null;    // the plan card being filled
  return new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('data-units-rendered', ''); } })
    .on('[data-units]', {
      element(el) {
        const want = el.getAttribute('data-units-beds');
        list = want && want !== 'all' ? ofBeds(want) : all;
        if (list.length) el.removeAttribute('hidden');
      },
    })
    .on('[data-units-list]', {
      element(el) { if (list.length) el.setInnerContent(list.map(row).join(''), { html: true }); },
    })
    .on('[data-units-empty]', { element(el) { el.setAttribute('hidden', ''); } })
    .on('.plan[data-beds]', { element(el) { beds = el.getAttribute('data-beds'); } })
    .on('.plan__price', {
      element(el) {
        const mine = beds == null ? [] : ofBeds(beds);
        if (!mine.length) return;
        const rents = mine.map((u) => u.rent).filter((r) => r > 0);
        const first = rents.length ? `From ${money(Math.min(...rents))}` : 'Pricing on request';
        el.setInnerContent(`${first}<small>${mine.length} open now or soon</small>`, { html: true });
      },
    })
    .transform(res);
}
