/* Sign-in form for /admin/. Posts to /api/login; the server sets the cookie. */
(() => {
  'use strict';
  const form = document.getElementById('signin-form');
  const msg = document.getElementById('signin-msg');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const password = form.elements.password.value;
    btn.disabled = true;
    msg.textContent = '';
    msg.className = 'signin__msg';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // The gate is server-side, so a plain reload is now served the dashboard.
        location.reload();
        return;
      }
      const data = await res.json().catch(() => ({}));
      msg.textContent = data.error || 'Sign-in failed.';
      msg.className = 'signin__msg is-bad';
      form.elements.password.select();
    } catch (err) {
      msg.textContent = 'Could not reach the server. Check your connection.';
      msg.className = 'signin__msg is-bad';
    } finally {
      btn.disabled = false;
    }
  });
})();
