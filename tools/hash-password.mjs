#!/usr/bin/env node
/* Generate the ADMIN_PASSWORD_HASH value for the analytics dashboard.
 *
 *   node tools/hash-password.mjs 'your password here'
 *
 * Prints  pbkdf2$<iterations>$<salt>$<hash>  — paste that into
 *   wrangler pages secret put ADMIN_PASSWORD_HASH
 * The password itself is never stored anywhere, including here.
 */
const ITERATIONS = 210000;   // OWASP floor for PBKDF2-SHA256

const password = process.argv[2];
if (!password) {
  console.error("usage: node tools/hash-password.mjs 'your password'");
  process.exit(1);
}
if (password.length < 12) {
  console.error(`Refusing: ${password.length} characters. Use at least 12 — this is the only thing standing between the open internet and your numbers.`);
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
console.log(`pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`);
console.log('\nAlso generate a session secret:');
console.log(`  ${b64(crypto.getRandomValues(new Uint8Array(32)))}`);
