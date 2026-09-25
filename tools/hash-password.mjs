#!/usr/bin/env node
/* Generate the ADMIN_PASSWORD_HASH value for the analytics dashboard.
 *
 *   node tools/hash-password.mjs                  makes a passphrase for you
 *   node tools/hash-password.mjs 'your own one'   or hashes yours (16+ characters)
 *
 * Prints  pbkdf2$<iterations>$<salt>$<hash>  — paste that into
 *   wrangler pages secret put ADMIN_PASSWORD_HASH
 * The password itself is never stored anywhere, including here.
 *
 * Why 10,000 iterations and not OWASP's 600,000: the site runs on Cloudflare's
 * free plan, which stops any request after 10 ms of CPU. 600,000 rounds is
 * about 280 ms, so sign-in would fail every time; 10,000 is about 5 ms on a
 * slow core. Stretching only slows down someone who already holds the hash,
 * and here that means someone inside the Cloudflare account, where secrets
 * are write-only. What protects the password is its own randomness: the one
 * this makes is about 79 bits, beyond any cracking rig at any iteration count,
 * and online guessing is capped at six tries per IP per fifteen minutes.
 * On Workers Paid the count can go up — it travels inside the hash, so old and
 * new hashes both keep working.
 */
const ITERATIONS = 10000;
const MIN_OWN = 16;

// No 0/o, 1/l/i: this gets read off one screen and typed into another.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function makePassphrase(groups = 4, size = 4) {
  const out = [];
  while (out.length < groups * size) {
    // Rejection sampling, so every character is exactly as likely as the next.
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b < 256 - (256 % ALPHABET.length)) out.push(ALPHABET[b % ALPHABET.length]);
  }
  return out.join('').match(new RegExp(`.{${size}}`, 'g')).join('-');
}

const given = process.argv[2];
if (given && given.length < MIN_OWN) {
  console.error(`Refusing: ${given.length} characters. Use at least ${MIN_OWN}, or run with no argument and one will be made for you.`);
  process.exit(1);
}
const password = given || makePassphrase();

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
if (!given) {
  console.log('Your dashboard password (save it in a password manager now; it is not kept anywhere):');
  console.log(`  ${password}\n`);
}
console.log('ADMIN_PASSWORD_HASH:');
console.log(`  pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`);
console.log('\nSESSION_SECRET:');
console.log(`  ${b64(crypto.getRandomValues(new Uint8Array(32)))}`);
console.log('\nVISITOR_SALT:');
console.log(`  ${b64(crypto.getRandomValues(new Uint8Array(32)))}`);
