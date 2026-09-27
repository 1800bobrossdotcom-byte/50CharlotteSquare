/* =============================================================================
   The email a visitor gets after sending the contact or tour form: a branded
   "we've got it", from the leasing address, with Privacy, Terms and a
   one-click unsubscribe.

   The form is public, so anything this email carries can be aimed at a
   stranger's inbox by whoever fills it in. So it carries nothing the visitor
   typed except a first name that looks like one, and only the choices they
   picked from the form's own lists. It goes at most once per address every
   12 hours, and never to an address that has unsubscribed.

   Unsubscribing is a row in email_prefs. The link carries a random token for
   the address, never the address itself.
   ============================================================================= */
import { sendEmail, replyTo, logEmail } from './email.js';
import { moveInLabel } from './movein.js';

const PHONE = '(585) 748-5588';
const PHONE_TEL = '+15857485588';
const HOURS = 'Monday to Friday, 8am to 4pm';
const STREET = '50 Charlotte Street, Rochester, NY 14607';
const EVO_URL = 'https://evolution24.net/';
const QUIET = 12 * 3600;   // seconds between two confirmations to one address

const INTEREST = {
  tour: 'A tour', availability: 'Current availability',
  pricing: 'Pricing and lease terms', question: 'A general question',
};
const PLAN = { 1: 'One bedroom', 2: 'Two bedroom', 3: 'Three bedroom' };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A first name to greet, or '' when what was typed does not look like one:
 *  letters, the odd hyphen or apostrophe, and a full stop only at the end, as
 *  in "J.". A link or an advert in the name field then gets "Thank you."
 *  instead of a platform. */
export function greetName(first) {
  const s = String(first || '').trim().split(/\s+/)[0] || '';
  return /^\p{L}[\p{L}\p{M}'’-]{0,29}\.?$/u.test(s) ? s : '';
}

const token = () => {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The subject, HTML and plain text. Pure: it takes the links it should use,
 *  so it can be previewed without a database or a send. */
export function confirmationEmail(row, links) {
  const name = greetName(row.first_name);
  const tour = row.form === 'tour';
  const hello = name ? `Thanks, ${name}.` : 'Thank you.';
  const got = tour
    ? 'We’ve got your tour request. Our leasing team will be in touch within one business day to set a time that suits you.'
    : 'We’ve got your message. A real person on our leasing team will reply within one business day, usually sooner.';
  const subject = tour ? 'We’ve got your tour request · Charlotte Square' : 'We’ve got your message · Charlotte Square';
  const preheader = tour ? 'We’ll be in touch within one business day to set a time.' : 'A real person will reply within one business day.';
  const told = [
    ['Interested in', INTEREST[row.interest]],
    ['Home', PLAN[row.plan]],
    ['Move-in', moveInLabel(row.move_in)],
  ].filter(([, v]) => v);

  const serif = "'Instrument Serif', Georgia, 'Times New Roman', serif";
  const sans = "'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
  const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

  const toldRows = told.map(([k, v]) => `
              <tr>
                <td width="120" style="width:120px;padding:6px 16px 6px 0;font-family:${sans};font-size:14px;line-height:1.4;color:#8A8580;white-space:nowrap;vertical-align:top;">${esc(k)}</td>
                <td style="padding:6px 0;font-family:${sans};font-size:15px;line-height:1.4;color:#1A1613;font-weight:600;">${esc(v)}</td>
              </tr>`).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; }
  a { color: #7A1F12; }
  @media (max-width: 620px) {
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 34px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F3F0EB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table ${T} width="100%" style="background:#F3F0EB;">
  <tr>
    <td align="center" style="padding:28px 12px 36px;">
      <table ${T} width="600" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:4px;overflow:hidden;">
        <tr>
          <td class="px" style="padding:26px 40px 22px;">
            <a href="${esc(links.home)}" style="text-decoration:none;">
              <table ${T}>
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;"><img src="${esc(links.img)}/mark.png" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:40px;"></td>
                  <td style="vertical-align:middle;">
                    <div style="font-family:${serif};font-size:24px;line-height:1;color:#1A1613;">Charlotte <i>Square</i></div>
                    <div style="padding-top:5px;font-family:${sans};font-size:10px;line-height:1;letter-spacing:2.4px;color:#8A8580;">AT THE EAST END</div>
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>
        <tr>
          <td><img src="${esc(links.img)}/header.jpg" width="600" alt="Charlotte Square at 50 Charlotte Street, Rochester" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td>
        </tr>
        <tr>
          <td class="px" style="padding:36px 40px 4px;">
            <h1 class="h1" style="margin:0 0 16px;font-family:${serif};font-weight:400;font-size:40px;line-height:1.1;color:#1A1613;">${esc(hello)}</h1>
            <p style="margin:0 0 14px;font-family:${sans};font-size:16px;line-height:1.6;color:#3A3632;">${esc(got)}</p>
            <p style="margin:0;font-family:${sans};font-size:16px;line-height:1.6;color:#3A3632;">If it can’t wait, call us at <a href="tel:${PHONE_TEL}" style="color:#7A1F12;font-weight:600;text-decoration:underline;white-space:nowrap;">${PHONE}</a>, ${HOURS}.</p>
          </td>
        </tr>${told.length ? `
        <tr>
          <td class="px" style="padding:26px 40px 0;">
            <table ${T} width="100%" style="border-top:1px solid #E7E2DA;border-bottom:1px solid #E7E2DA;">
              <tr><td colspan="2" style="padding:16px 0 6px;font-family:${sans};font-size:11px;line-height:1;letter-spacing:2px;font-weight:600;color:#8A8580;">WHAT YOU TOLD US</td></tr>${toldRows}
              <tr><td colspan="2" style="padding:0 0 10px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>` : ''}
        <tr>
          <td class="px" style="padding:28px 40px 38px;">
            <table ${T}>
              <tr>
                <td style="border-radius:3px;background:#7A1F12;">
                  <a href="${esc(links.plans)}" style="display:inline-block;padding:14px 26px;font-family:${sans};font-size:15px;line-height:1;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:3px;">See the floor plans&nbsp;&rarr;</a>
                </td>
              </tr>
            </table>
            <p style="margin:26px 0 0;font-family:${sans};font-size:15px;line-height:1.6;color:#3A3632;">The Charlotte Square leasing team</p>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:30px 40px 28px;background:#1A1613;">
            <div style="font-family:${serif};font-size:21px;line-height:1.2;color:#F5F1E9;">Charlotte <i>Square</i></div>
            <p style="margin:8px 0 0;font-family:${sans};font-size:13px;line-height:1.7;color:#C9C2B6;">${STREET}<br><a href="tel:${PHONE_TEL}" style="color:#C9C2B6;text-decoration:none;">${PHONE}</a> · ${HOURS}<br>LEED Gold certified · Equal Housing Opportunity</p>
            <table ${T} style="margin-top:20px;">
              <tr>
                <td style="padding-right:10px;vertical-align:middle;font-family:${sans};font-size:11px;line-height:1;letter-spacing:1.6px;color:#948A7E;">MANAGED BY</td>
                <td style="vertical-align:middle;"><a href="${EVO_URL}"><img src="${esc(links.img)}/evolution24.png" width="120" height="49" alt="Evolution24 Properties" style="display:block;border:0;width:120px;height:49px;"></a></td>
              </tr>
            </table>
            <p style="margin:22px 0 0;font-family:${sans};font-size:13px;line-height:1.6;color:#948A7E;">
              <a href="${esc(links.privacy)}" style="color:#F5F1E9;text-decoration:underline;">Privacy</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${esc(links.terms)}" style="color:#F5F1E9;text-decoration:underline;">Terms</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${esc(links.unsubscribe)}" style="color:#F5F1E9;text-decoration:underline;">Unsubscribe</a>
            </p>
            <p style="margin:10px 0 0;font-family:${sans};font-size:12px;line-height:1.6;color:#948A7E;">You’re getting this email because you sent us a message through our website. It isn’t a mailing list, and we never sell your information.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    hello,
    '',
    got,
    '',
    `If it can’t wait, call us at ${PHONE}, ${HOURS}.`,
    ...(told.length ? ['', 'What you told us', ...told.map(([k, v]) => `- ${k}: ${v}`)] : []),
    '',
    `See the floor plans: ${links.plans}`,
    '',
    'The Charlotte Square leasing team',
    '',
    '--',
    'Charlotte Square',
    STREET,
    `${PHONE} · ${HOURS}`,
    'LEED Gold certified · Equal Housing Opportunity · Managed by Evolution24 Properties',
    '',
    `Privacy: ${links.privacy}`,
    `Terms: ${links.terms}`,
    `Unsubscribe: ${links.unsubscribe}`,
    '',
    'You’re getting this email because you sent us a message through our website. It isn’t a mailing list, and we never sell your information.',
  ].join('\n');

  return { subject, html, text };
}

/** The address's row in email_prefs, made the first time the site writes. */
async function prefsFor(env, email, now) {
  await env.DB.prepare(
    'INSERT INTO email_prefs (email, token, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING',
  ).bind(email, token(), now).run();
  return env.DB.prepare('SELECT token, last_sent_at, unsubscribed_at FROM email_prefs WHERE email = ?')
    .bind(email).first();
}

/** Send the visitor their confirmation. Returns {ok, id} or {ok:false, reason,
 *  note}: reason is unsubscribed, recent, off or error, and note says why in
 *  words the dashboard can show as they are. */
export async function sendConfirmation(env, row, origin) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'off', note: 'Email is not set up yet.' };
  if (!env.DB) return { ok: false, reason: 'off', note: 'No database, so no unsubscribe link: not sent.' };
  const email = String(row.email || '').trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  let prefs;
  try {
    prefs = await prefsFor(env, email, now);
  } catch {
    return { ok: false, reason: 'error', note: 'Could not check their email preferences: not sent.' };
  }
  if (!prefs) return { ok: false, reason: 'error', note: 'Could not check their email preferences: not sent.' };
  if (prefs.unsubscribed_at) return { ok: false, reason: 'unsubscribed', note: 'They have unsubscribed.' };
  if (prefs.last_sent_at && now - prefs.last_sent_at < QUIET) return { ok: false, reason: 'recent', note: 'They already got one in the last 12 hours.' };

  const links = {
    home: `${origin}/`,
    plans: `${origin}/residences/`,
    privacy: `${origin}/privacy/`,
    terms: `${origin}/terms/`,
    unsubscribe: `${origin}/unsubscribe/${prefs.token}`,
    img: `${origin}/assets/img/email`,
  };
  const mail = confirmationEmail(row, links);
  const sent = await sendEmail(env, {
    to: [String(row.email).trim()],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    replyTo: replyTo(env),
    // One-click unsubscribe (RFC 8058): the mail app's own Unsubscribe button
    // posts to the same link, with no page to click through.
    headers: {
      'List-Unsubscribe': `<${links.unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  if (!sent.ok) return { ok: false, reason: 'error', note: sent.error };
  try {
    await env.DB.prepare('UPDATE email_prefs SET last_sent_at = ? WHERE email = ?').bind(now, email).run();
  } catch { /* sent either way */ }
  return { ok: true, id: sent.id };
}

/** Send it, and log how it went, for the enquiry's card and the reports. */
export async function confirmAndRecord(env, row, origin) {
  const result = await sendConfirmation(env, row, origin);
  await logEmail(env, 'confirmation', row.id, result);
  if (!result.ok) console.log('confirmation not sent:', result.note);
  return result;
}
