/* ==========================================================================
   MATERIALHUNT — delete my account
   The member confirms with their password (or Google sign-in), then everything linked to the account
   is deleted from the database, and finally the sign-in itself. There is no undo.
   Left behind (not personal data): public counters, other members' reports about this account, and
   admin records of prizes already paid.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const fb = () => window.MH_FIREBASE;
  let running = false;

  function modal() {
    let m = q('#acctModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'acctModal';
      m.className = 'modal-backdrop hidden';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m && !running) m.classList.add('hidden'); });
    }
    return m;
  }

  function open() {
    if (!state.user) { openAuth('login'); return; }
    q('#profileModal')?.classList.add('hidden');
    const user = fb()?.auth?.currentUser;
    const usesPassword = Boolean(user?.providerData?.some((p) => p.providerId === 'password'));
    const m = modal();
    m.innerHTML = `<div class="auth-modal glass tool-modal acct-modal" role="dialog" aria-modal="true" aria-labelledby="acctTitle">
      <button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">DANGER ZONE</span><h2 id="acctTitle">Delete my account</h2>
      <p>This permanently deletes your account and everything linked to it:</p>
      <ul class="acct-list"><li>your profile, photo and bio</li><li>saved designs</li><li>your leaderboard and community entries and challenges</li><li>your requests, feedback, notifications and prizes</li><li>your promo and plan records</li></ul>
      <p><b>This cannot be undone.</b> Any Pro time left on the account is lost. You can sign up again later with a fresh, empty account.</p>
      <form class="auth-form" id="acctForm">
        ${usesPassword
    ? '<label class="field-label" for="acctPass">Type your password to confirm</label><input id="acctPass" type="password" autocomplete="current-password" required />'
    : '<p class="micro-note">You signed in with Google, so you will be asked to confirm with Google.</p>'}
        <button class="btn btn-primary full acct-danger" type="submit" id="acctGo">Delete everything and close my account</button>
        <p class="form-error" id="acctError"></p>
        <p class="micro-note hidden" id="acctProgress"></p>
      </form></div>`;
    m.classList.remove('hidden');
    q('[data-x]', m).addEventListener('click', () => { if (!running) m.classList.add('hidden'); });
    q('#acctForm', m).addEventListener('submit', (e) => { e.preventDefault(); run(m, usesPassword); });
    setTimeout(() => q('#acctPass', m)?.focus(), 100);
  }

  async function reauth(user, usesPassword, password) {
    const A = window.firebase.auth;
    if (usesPassword) {
      await user.reauthenticateWithCredential(A.EmailAuthProvider.credential(user.email, password));
    } else {
      await user.reauthenticateWithPopup(new A.GoogleAuthProvider());
    }
  }

  async function removeWhere(db, collection, field, uid) {
    const snap = await db.collection(collection).where(field, '==', uid).limit(400).get();
    if (snap.empty) return 0;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }

  async function run(m, usesPassword) {
    if (running) return;
    const err = q('#acctError', m);
    const prog = q('#acctProgress', m);
    const btn = q('#acctGo', m);
    err.textContent = '';
    const password = usesPassword ? q('#acctPass', m).value : '';
    if (usesPassword && !password) { err.textContent = 'Enter your password to continue.'; return; }
    const user = fb()?.auth?.currentUser;
    if (!user) { err.textContent = 'Please sign in again.'; return; }
    running = true;
    btn.disabled = true;
    const say = (t) => { prog.classList.remove('hidden'); prog.textContent = t; };
    try {
      say('Checking your password…');
      try { await reauth(user, usesPassword, password); }
      catch (e) {
        running = false; btn.disabled = false; prog.classList.add('hidden');
        err.textContent = /wrong-password|invalid-credential|invalid-login/.test(String(e.code || e.message)) ? 'That password is not correct.' : (e.code === 'auth/popup-closed-by-user' ? 'Confirmation was cancelled.' : 'Could not confirm it is you. Please try again.');
        return;
      }
      const db = fb().db;
      const uid = user.uid;
      say('Deleting your content…');
      // 1) everything that can be deleted while the account record still exists
      for (const [c, f] of [['designs', 'user_id'], ['challenge_entries', 'user_id'], ['community_entries', 'user_id'], ['community_challenges', 'owner'], ['rfq_leads', 'user_id'], ['feedback', 'user_id']]) {
        await removeWhere(db, c, f, uid);
      }
      const first = db.batch();
      first.delete(db.collection('profiles').doc(uid));
      first.delete(db.collection('redemptions').doc(uid));
      first.delete(db.collection('users').doc(uid));
      await first.commit();
      say('Removing the rest…');
      // 2) records that can only be removed once the account record is gone
      await removeWhere(db, 'prizes', 'user_id', uid);
      const second = db.batch();
      second.delete(db.collection('signups').doc(uid));
      const now = Date.now();
      for (let i = 0; i < 60; i += 1) {
        const d = new Date(now + 19800000 - i * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
        second.delete(db.collection('ai_usage').doc(`${uid}_${d}`));
      }
      await second.commit();
      say('Closing your sign-in…');
      await user.delete();
      try {
        Object.keys(localStorage).filter((k) => /^mh_/.test(k) && (k.includes(uid) || /^(mh_usage|mh_notif|mh_chat|mh_shape_color|mh_photo_ok)/.test(k))).forEach((k) => localStorage.removeItem(k));
      } catch { /* storage unavailable */ }
      m.innerHTML = '<div class="auth-modal glass tool-modal acct-modal"><h2>Your account was deleted</h2><p>All of your data has been removed. Thank you for trying MaterialHunt. You are welcome back any time.</p></div>';
      setTimeout(() => location.reload(), 2600);
    } catch (e) {
      running = false;
      btn.disabled = false;
      err.textContent = 'Something went wrong part-way. Please press the button again to finish deleting. If it keeps failing, contact support.';
      console.warn('Account deletion stopped:', e.code || e.message);
    }
  }

  window.MH_ACCOUNT = { open };
})();
