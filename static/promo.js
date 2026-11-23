/* ==========================================================================
   MATERIALHUNT — promo codes
   Codes never appear in this file or anywhere in the website. They live only in the database
   (created by an admin) and are checked by the database rules: the code must exist, be active,
   have uses left, and each account can redeem exactly one code. Use long random codes.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const db = () => window.MH_FIREBASE?.db;
  const uid = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const FV = () => window.firebase.firestore.FieldValue;
  let busy = false;

  /* second step: read the number of days for the code this account redeemed and switch Pro on */
  async function activate(code) {
    const snap = await db().collection('promos').doc(code).get();
    const days = Number(snap.data()?.days || 0);
    if (!days) throw new Error('This code has no days attached.');
    await db().collection('users').doc(uid()).update({ promo_code: code, promo_at: FV().serverTimestamp(), promo_days: days });
    return days;
  }

  async function refreshSession() {
    try {
      const res = await api('/api/auth/refresh', { method: 'POST' });
      if (res?.user) setSession(state.token, res.user);
    } catch { /* the plan appears on the next load */ }
  }

  async function redeem(raw) {
    if (busy) return;
    const code = String(raw || '').toUpperCase().replace(/\s+/g, '');
    const msg = q('#promoMsg');
    const say = (text, ok) => { if (msg) { msg.textContent = text; msg.className = `promo-msg ${ok ? 'ok' : 'no'}`; } };
    if (!state.user) { notify('Create a free account first, then enter your code.', 'info', 4000); openAuth('register'); return; }
    if (!state.user.email_verified) { say('Verify your email first (check your inbox), then enter the code.', false); return; }
    if (!/^[A-Z0-9-]{6,40}$/.test(code)) { say('That does not look like a valid code.', false); return; }
    busy = true;
    const btn = q('#promoBtn');
    if (btn) btn.disabled = true;
    try {
      await window.MH_FIREBASE.initFirebase();
      const batch = db().batch();
      batch.set(db().collection('redemptions').doc(uid()), { code, created_at: FV().serverTimestamp() });
      batch.update(db().collection('promos').doc(code), { uses: FV().increment(1) });
      await batch.commit();
      const days = await activate(code);
      await refreshSession();
      say(`Done. ${days} days of Pro are now on your account.`, true);
      notify(`Pro unlocked for ${days} days.`, 'success', 5000);
      window.MH_GROWTH?.track?.('promo_redeemed');
    } catch (error) {
      // the database refuses invalid, used-up, inactive or already-redeemed codes with the same message on purpose
      say('That code is not valid, has been used up, or you have already redeemed one.', false);
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  /* if the second step was interrupted last time (code redeemed but Pro not switched on), finish it */
  async function resume() {
    try {
      await window.MH_FIREBASE.initFirebase();
      if (!uid() || state.user?.trial_until) return;
      const r = await db().collection('redemptions').doc(uid()).get();
      if (!r.exists) return;
      const u = await db().collection('users').doc(uid()).get();
      if (u.exists && u.data().promo_code) return;
      await activate(r.data().code);
      await refreshSession();
    } catch { /* nothing to resume */ }
  }

  /* an admin can choose to show one code on the pricing page (nothing is shown by default) */
  async function loadOffer() {
    const el = q('#promoOffer');
    if (!el) return;
    try {
      await window.MH_FIREBASE.initFirebase();
      const snap = await db().collection('settings').doc('public_promo').get();
      const d = snap.exists ? snap.data() : null;
      if (!d || !d.active || !/^[A-Z0-9-]{6,40}$/.test(String(d.code || ''))) { el.classList.add('hidden'); return; }
      el.innerHTML = `${esc(d.text || 'Special offer')} <button class="text-btn" type="button" data-offer="${esc(d.code)}">Use code ${esc(d.code)}</button>`;
      el.classList.remove('hidden');
    } catch { el.classList.add('hidden'); }
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-offer]');
    if (o) { const i = q('#promoInput'); if (i) { i.value = o.dataset.offer; redeem(o.dataset.offer); } }
  });
  window.addEventListener('mh:view', () => {});
  const _sv = window.setView;
  if (typeof _sv === 'function') window.setView = function promoSetView(view, scroll) { _sv(view, scroll); if (view === 'pricing') loadOffer(); };
  setTimeout(loadOffer, 1500);

  document.addEventListener('click', (e) => { if (e.target.closest('#promoBtn')) redeem(q('#promoInput')?.value); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'promoInput') { e.preventDefault(); redeem(e.target.value); } });
  window.addEventListener('mh:session', (e) => { if (e.detail.user && e.detail.user.email_verified) setTimeout(resume, 1500); });

  window.MH_PROMO = { redeem };
})();
