/* The words for the form's coded answers, and where a visitor came from:
   shared by the leasing notification and the lead sheet. */
export const LABEL = {
  tour: 'Scheduling a tour', availability: 'Current availability',
  pricing: 'Pricing and lease terms', question: 'A general question',
  1: 'One bedroom', 2: 'Two bedroom', 3: 'Three bedroom',
  search: 'Search', listing: 'Apartment listing site', social: 'Social media',
  walkby: 'Walked by', referral: 'Friend or resident', website: 'Website',
};
export const label = (v) => (v && LABEL[v]) || v || '—';

/** "google / cpc · spring-lease · tour page B", or '' when nothing is known. */
export const cameVia = (row) => [
  row.utm_source && [row.utm_source, row.utm_medium].filter(Boolean).join(' / '),
  row.utm_campaign && `campaign ${row.utm_campaign}`,
  !row.utm_source && row.referrer,
  row.variant && `tour page ${row.variant.toUpperCase()}`,
].filter(Boolean).join(' · ');
