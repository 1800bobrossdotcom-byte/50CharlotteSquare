/* Target move-in, as the form sends it: a month ("2026-10"), "asap" or
   "later". The same values the old <input type="month"> sent, plus the two
   answers that are not a month, so rows saved before the change still read.

   Anything else is dropped rather than stored, like the other pickers. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const moveInValue = (v) =>
  (typeof v === 'string' && /^(?:\d{4}-(?:0[1-9]|1[0-2])|asap|later)$/.test(v) ? v : null);

/** "October 2026", "As soon as possible", "Later, or not sure yet", or null. */
export function moveInLabel(v) {
  if (!v) return null;
  if (v === 'asap') return 'As soon as possible';
  if (v === 'later') return 'Later, or not sure yet';
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : v;
}
