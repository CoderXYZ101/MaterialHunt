/* ==========================================================================
   MATERIALHUNT — engineer endorsements
   Real people (engineers, students, buyers, teachers) can write a short endorsement. Nothing is shown
   until an admin approves it. An admin can also mark an endorsement "identity checked" after confirming
   the person is who they say they are (for example on LinkedIn or by email from a company address).
   Only approved endorsements appear on the home page, so the strip is always real and reviewed.
   Share this address with people you would like feedback from:   https://materialhunt-2026.web.app/?endorse=1
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const db = () => window.MH_FIREBASE?.db;
  const FV = () => window.firebase.firestore.FieldValue;

  /* ------------------------------------------------------------------ */
  /* The write-an-endorsement form                                        */
  /* ------------------------------------------------------------------ */
  function modal() {
    let m = q('#endorseModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'endorseModal';
      m.className = 'modal-backdrop hidden';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    }
    return m;
  }

  async function open() {
    if (!state.user) { sessionStorage.setItem('mh_want_endorse', '1'); notify('Create a free account (or sign in) so we can confirm you are a real person.', 'info', 5000); openAuth('register'); return; }
    if (!state.user.email_verified) { notify('Please verify your email first, then you can write an endorsement.', 'warning', 5000); return; }
    let old = null;
    try { await window.MH_FIREBASE.initFirebase(); const s = await db().collection('endorsements').doc(window.MH_FIREBASE.auth.currentUser.uid).get(); old = s.exists ? s.data() : null; } catch { old = null; }
    const m = modal();
    const mine = window.MH_PROFILE?.displayName?.() || '';
    m.innerHTML = `<div class="auth-modal glass tool-modal endorse-modal" role="dialog" aria-modal="true" aria-labelledby="endTitle">
      <button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">ENDORSE MATERIALHUNT</span><h2 id="endTitle">Tell others what you think</h2>
      <p class="micro-note">A short, honest note about what you tried and whether it was useful. Our team reads every one before it appears. ${old ? `Your last endorsement is <b>${esc(old.status)}</b>; sending a new one replaces it.` : ''}</p>
      <form class="auth-form" id="endForm">
        <label class="field-label" for="endName">Your name (shown publicly)</label><input id="endName" type="text" maxlength="60" value="${esc(old?.name || mine)}" required />
        <label class="field-label" for="endRole">Your role</label><input id="endRole" type="text" maxlength="80" placeholder="e.g. Mechanical design engineer" value="${esc(old?.role || '')}" required />
        <label class="field-label" for="endOrg">Company or institute (optional)</label><input id="endOrg" type="text" maxlength="80" value="${esc(old?.org || '')}" />
        <label class="field-label" for="endRating">How useful was it?</label>
        <select id="endRating" class="field-select">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${(old?.rating || 5) === n ? ' selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n}/5)</option>`).join('')}</select>
        <label class="field-label" for="endQuote">Your endorsement (<span id="endCount">0</span>/400)</label>
        <textarea id="endQuote" rows="4" minlength="20" maxlength="400" placeholder="What did you use it for, and what did you find useful?" required>${esc(old?.quote || '')}</textarea>
        <label class="guardrail-check"><input type="checkbox" id="endOk" required /><span><strong>MaterialHunt may show this publicly</strong><small>With my name, role and organisation, after the team approves it.</small></span></label>
        <button class="btn btn-primary full" type="submit">Send for review</button>
        <p class="form-error" id="endError"></p>
      </form></div>`;
    m.classList.remove('hidden');
    q('[data-x]', m).addEventListener('click', () => m.classList.add('hidden'));
    const count = () => { q('#endCount', m).textContent = String(q('#endQuote', m).value.length); };
    q('#endQuote', m).addEventListener('input', count); count();
    q('#endForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = q('#endError', m);
      err.textContent = '';
      const doc = {
        user_id: window.MH_FIREBASE.auth.currentUser.uid, name: q('#endName', m).value.trim().slice(0, 60), role: q('#endRole', m).value.trim().slice(0, 80), org: q('#endOrg', m).value.trim().slice(0, 80),
        rating: Number(q('#endRating', m).value), quote: q('#endQuote', m).value.trim().slice(0, 400), status: 'pending', verified: false,
      };
      if (doc.quote.length < 20) { err.textContent = 'Please write at least a sentence or two (20 characters).'; return; }
      const btn = q('button[type=submit]', m);
      btn.disabled = true;
      try {
        await db().collection('endorsements').doc(doc.user_id).set({ ...doc, created_at: FV().serverTimestamp() });
        m.classList.add('hidden');
        notify('Thank you! Your endorsement will appear once our team has reviewed it.', 'success', 6000);
        window.MH_GROWTH?.track?.('endorsement_sent', { rating: doc.rating });
      } catch { err.textContent = 'Could not send it. Please try again in a moment.'; btn.disabled = false; }
    });
  }

  /* ------------------------------------------------------------------ */
  /* The public strip on the home page (approved only)                    */
  /* ------------------------------------------------------------------ */
  async function renderStrip() {
    const host = q('#view-simulator');
    if (!host) return;
    try {
      await window.MH_FIREBASE.initFirebase();
      if (!db()) return;
      const snap = await db().collection('endorsements').where('status', '==', 'approved').limit(12).get();
      const rows = snap.docs.map((d) => d.data());
      q('#endorseStrip')?.remove();
      if (!rows.length) return;
      rows.sort((a, b) => Number(b.verified) - Number(a.verified));
      const sec = document.createElement('section');
      sec.id = 'endorseStrip';
      sec.className = 'endorse-strip';
      sec.innerHTML = `<div class="section-head"><div><span class="panel-kicker">WHAT PEOPLE SAY</span><h2>Tried by engineers, makers and students</h2><p>Every note is written by a real member and approved by our team${rows.some((r) => r.verified) ? '. A tick means we checked who they are' : ''}.</p></div></div>
        <div class="endorse-grid">${rows.map((r) => `<figure class="endorse-card glass"><div class="endorse-stars">${'★'.repeat(r.rating || 5)}</div><blockquote>${esc(r.quote)}</blockquote><figcaption><b>${esc(r.name)}${r.verified ? ' <span class="endorse-tick" title="Identity checked by the MaterialHunt team">✔</span>' : ''}</b><span>${esc([r.role, r.org].filter(Boolean).join(' · '))}</span></figcaption></figure>`).join('')}</div>`;
      host.appendChild(sec);
    } catch { /* leave the page as it is */ }
  }

  function boot() {
    setTimeout(renderStrip, 2000);
    const wants = new URLSearchParams(location.search).get('endorse') === '1';
    if (wants) sessionStorage.setItem('mh_want_endorse', '1');
  }
  window.addEventListener('mh:session', (e) => {
    if (e.detail.user && sessionStorage.getItem('mh_want_endorse')) { sessionStorage.removeItem('mh_want_endorse'); setTimeout(open, 1200); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_ENDORSE = { open, refresh: renderStrip };
})();
