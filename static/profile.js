/* ==========================================================================
   MATERIALHUNT — member profiles
   Optional photo, display name, organisation and a short bio. Visible only to signed-in
   members (see firestore.rules). The photo is shown on the leaderboard only if the owner
   switches that on. Photos are shrunk to a small square and stored inside the profile document.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };

  const WHO = ['Student', 'Engineer or professional', 'Business owner or buyer', 'Educator', 'Researcher', 'Maker or hobbyist'];
  const cache = new Map();   // uid -> profile (or null when none)
  let mine = null;
  let photosBlocked = false;
  let draftAvatar = '';
  const db = () => window.MH_FIREBASE?.db;
  const uid = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

  async function fetchProfile(id) {
    if (cache.has(id)) return cache.get(id);
    if (!state.user) return null;
    try {
      await window.MH_FIREBASE.initFirebase();
      const snap = await db().collection('profiles').doc(id).get();
      const data = snap.exists ? snap.data() : null;
      cache.set(id, data);
      return data;
    } catch { return null; }
  }

  async function loadMine() {
    if (!state.user) { mine = null; applyChip(); return; }
    mine = await fetchProfile(uid());
    applyChip();
  }

  function applyChip() {
    const av = q('#userAvatar');
    if (!av) return;
    if (mine && mine.avatar) { av.innerHTML = `<img src="${esc(mine.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`; }
    else if (state.user) { av.textContent = initials(mine?.display_name || state.user.organization_name || state.user.email); }
  }

  /* ---------------- leaderboard avatars and names ---------------- */
  async function decorate(root) {
    const slots = Array.from((root || document).querySelectorAll('[data-av]'));
    for (const slot of slots) {
      slot.textContent = initials(slot.dataset.nm);
      if (!state.user) continue;
      const p = await fetchProfile(slot.dataset.av);
      if (p && p.show_avatar && p.avatar) slot.innerHTML = `<img src="${esc(p.avatar)}" alt="" />`;
    }
  }

  /* ---------------- modals ---------------- */
  function modal() {
    let m = q('#profileModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'profileModal';
      m.className = 'modal-backdrop hidden';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    }
    return m;
  }
  const closeModal = () => q('#profileModal')?.classList.add('hidden');

  const PHOTO_ERRORS = {
    unsafe: 'that picture was not accepted. Please choose a different one (a clear, appropriate photo of you or a logo).',
    photo_blocked: 'photos are switched off for this account.',
    check_unavailable: 'the automatic photo check is not available right now. Please try again later.',
    save_profile_first: 'please save your profile first.',
    bad_image: 'that image could not be used.',
    sign_in_required: 'please sign in again.',
  };

  /* a photo only goes onto a profile after the server's safety check */
  async function uploadPhoto(dataUrl) {
    const base = window.MH_CONFIG?.aiProxyUrl;
    if (!base) throw new Error(PHOTO_ERRORS.check_unavailable);
    const token = await window.MH_FIREBASE.auth.currentUser.getIdToken();
    let res;
    try {
      res = await fetch(`${base}/set-avatar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image: dataUrl }) });
    } catch { throw new Error(PHOTO_ERRORS.check_unavailable); }
    if (res.ok) return;
    let code = '';
    try { code = (await res.json()).error; } catch { code = ''; }
    throw new Error(PHOTO_ERRORS[code] || 'something went wrong. Please try again.');
  }

  async function openMine() {
    if (!state.user) { openAuth('register'); return; }
    await loadMine();
    try { await window.MH_FIREBASE.initFirebase(); photosBlocked = (await db().collection('photo_blocks').doc(uid()).get()).exists; } catch { photosBlocked = false; }
    const m = modal();
    const p = mine || {};
    draftAvatar = p.avatar || '';
    m.innerHTML = `<div class="auth-modal glass tool-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profTitle">
      <button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">MY PROFILE</span><h2 id="profTitle">Your profile</h2>
      <div class="prof-top">
        <div class="prof-avatar" id="profAvatar"></div>
        <div class="prof-photo-actions">
          <button class="btn btn-glass small" type="button" id="profPick">Add a photo</button>
          <button class="btn btn-ghost small" type="button" id="profClear">Remove</button>
          <input type="file" id="profFile" accept="image/*" class="hidden" />
          <label class="guardrail-check prof-show"><input type="checkbox" id="profShow" ${p.show_avatar ? 'checked' : ''} /><span><strong>Show my photo on the leaderboard</strong><small>Only signed-in members can see it. Off by default. Photos are reviewed by our team and can be reported.</small></span></label>
        </div>
      </div>
      <form class="auth-form" id="profForm">
        <label class="field-label" for="profName">Display name</label><input id="profName" type="text" maxlength="40" value="${esc(p.display_name || state.user.organization_name || '')}" required />
        <label class="field-label" for="profWho">I am a (optional)</label>
        <select id="profWho" class="field-select"><option value="">Prefer not to say</option>${WHO.map((w) => `<option${p.who === w ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>
        <label class="guardrail-check"><input type="checkbox" id="profFind" ${p.discoverable === false ? '' : 'checked'} /><span><strong>Let other members find me by name</strong><small>You appear in the member search. Turn off to stay out of it.</small></span></label>
        <label class="field-label" for="profOrg">Organisation (optional)</label><input id="profOrg" type="text" maxlength="80" placeholder="Company, institute or team" value="${esc(p.org || '')}" />
        <label class="field-label" for="profBio">About you (optional, <span id="profCount">0</span>/200)</label><textarea id="profBio" rows="3" maxlength="200">${esc(p.bio || '')}</textarea>
        <p class="micro-note">Do not share phone numbers, home addresses or other private details. Your name, organisation and bio can be seen by other signed-in members.</p>
        <button class="btn btn-primary full" type="submit">Save profile</button>
        <p class="form-error" id="profError"></p>
        <button class="btn btn-ghost full acct-link" type="button" id="profDeleteAccount">Delete my account…</button>
        ${mine ? '<button class="btn btn-ghost full" type="button" id="profDelete">Delete my profile</button><p class="micro-note">Deleting removes your photo, bio and display name from MaterialHunt. Your account and past leaderboard entries stay.</p>' : ''}
      </form></div>`;
    m.classList.remove('hidden');
    q('[data-x]', m).addEventListener('click', closeModal);
    const paint = () => { q('#profAvatar', m).innerHTML = draftAvatar ? `<img src="${esc(draftAvatar)}" alt="Your photo" />` : `<span>${esc(initials(q('#profName', m).value))}</span>`; };
    paint();
    q('#profName', m).addEventListener('input', () => { if (!draftAvatar) paint(); });
    const count = () => { q('#profCount', m).textContent = String(q('#profBio', m).value.length); };
    q('#profBio', m).addEventListener('input', count); count();
    q('#profPick', m).addEventListener('click', () => q('#profFile', m).click());
    q('#profClear', m).addEventListener('click', () => { draftAvatar = ''; q('#profShow', m).checked = false; paint(); });
    q('#profFile', m).addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const c = document.createElement('canvas');
          c.width = c.height = 128;
          c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
          draftAvatar = c.toDataURL('image/jpeg', 0.82);
          paint();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    q('#profDeleteAccount', m)?.addEventListener('click', () => window.MH_ACCOUNT?.open());
    q('#profDelete', m)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Tap again to delete for good'; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = 'Delete my profile'; } }, 4000); return; }
      btn.disabled = true;
      try {
        await window.MH_FIREBASE.initFirebase();
        await db().collection('profiles').doc(uid()).delete();
        mine = null;
        cache.set(uid(), null);
        draftAvatar = '';
        applyChip();
        notify('Your profile was deleted.', 'success', 3500);
        closeModal();
      } catch { q('#profError', m).textContent = 'Your profile could not be deleted right now. Please contact support.'; btn.disabled = false; }
    });
    q('#profForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = q('#profError', m);
      err.textContent = '';
      const blocked = photosBlocked;
      const doc = {
        display_name: q('#profName', m).value.trim().slice(0, 40), bio: q('#profBio', m).value.trim().slice(0, 200), org: q('#profOrg', m).value.trim().slice(0, 80), who: q('#profWho', m).value, discoverable: q('#profFind', m).checked,
        avatar: blocked ? '' : draftAvatar, show_avatar: Boolean(!blocked && draftAvatar && q('#profShow', m).checked),
      };
      doc.name_lower = doc.display_name.toLowerCase();
      if (!doc.display_name) { err.textContent = 'Please enter a display name.'; return; }
      if (blocked && draftAvatar) { err.textContent = 'Photos are switched off for this account.'; return; }
      const submit = q('button[type=submit]', m);
      submit.disabled = true;
      try {
        await window.MH_FIREBASE.initFirebase();
        await db().collection('profiles').doc(uid()).set({ ...doc, updated_at: window.firebase.firestore.FieldValue.serverTimestamp() });
        mine = { ...doc };
        cache.set(uid(), mine);
        applyChip();
        notify('Profile saved.', 'success', 2500);
        closeModal();
      } catch (error) { err.textContent = error.message || 'Could not save your profile.'; }
      submit.disabled = false;
    });
  }

  async function viewPerson(id) {
    if (!state.user) { notify('Sign in to view member profiles.', 'info', 3500); openAuth('login'); return; }
    if (id === uid()) { openMine(); return; }
    const m = modal();
    m.innerHTML = '<div class="auth-modal glass tool-modal profile-modal"><button class="modal-close" data-x aria-label="Close">×</button><div class="empty-state"><span>Loading…</span></div></div>';
    m.classList.remove('hidden');
    q('[data-x]', m).addEventListener('click', closeModal);
    const p = await fetchProfile(id);
    const row = (window.MH_CHALLENGE?.boardRows?.() || []).find((r) => r.user_id === id);
    const name = p?.display_name || row?.name || 'Member';
    q('.profile-modal', m).innerHTML = `<button class="modal-close" data-x aria-label="Close">×</button>
      <div class="prof-top"><div class="prof-avatar">${p && p.show_avatar && p.avatar ? `<img src="${esc(p.avatar)}" alt="" />` : `<span>${esc(initials(name))}</span>`}</div>
        <div><h2>${esc(name)}</h2>${p?.who || p?.org ? `<p class="micro-note">${esc([p.who, p.org].filter(Boolean).join(' · '))}</p>` : ''}</div></div>
      ${p?.bio ? `<p class="prof-bio">${esc(p.bio)}</p>` : '<p class="micro-note">This member has not added a bio yet.</p>'}
      <div id="repBox"><button class="btn btn-ghost small report-btn" id="repOpen">Report this profile</button></div>
      ${row ? `<div class="prof-entry"><span class="medal-dot medal-${esc(String(row.medal).toLowerCase())}"></span> <b>${esc(row.medal)}</b> · ${esc(row.formula)} · score <b>${row.score}</b></div>` : ''}`;
    q('[data-x]', m).addEventListener('click', closeModal);
    q('#repOpen', m)?.addEventListener('click', () => reportForm(m, id));
  }

  function reportForm(m, target) {
    const box = q('#repBox', m);
    box.innerHTML = `<form class="auth-form" id="repForm"><label class="field-label" for="repReason">What is the problem?</label>
      <select id="repReason" class="field-select"><option value="photo">Inappropriate photo</option><option value="name_or_bio">Inappropriate name or bio</option><option value="harassment">Harassment or abuse</option><option value="other">Something else</option></select>
      <label class="field-label" for="repNote">Details (optional)</label><textarea id="repNote" rows="2" maxlength="200"></textarea>
      <button class="btn btn-primary small" type="submit">Send report</button> <span class="micro-note" id="repMsg"></span></form>`;
    q('#repForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = q('#repMsg', m);
      if (!state.user?.email_verified) { msg.textContent = 'Verify your email first to send a report.'; return; }
      try {
        await window.MH_FIREBASE.initFirebase();
        await db().collection('reports').doc(`${uid()}_${target}`).set({ reporter: uid(), target, reason: q('#repReason', m).value, note: q('#repNote', m).value.trim().slice(0, 200), status: 'new', created_at: window.firebase.firestore.FieldValue.serverTimestamp() });
        box.innerHTML = '<p class="micro-note">Thank you. Our team will review this report.</p>';
      } catch { msg.textContent = 'You have already reported this member, or the report could not be sent.'; }
    });
  }

  /* ---------------- member search ---------------- */
  function mountSearch() {
    const layout = q('#view-challenge .challenge-layout');
    if (!layout) return false;
    if (q('#memberSearch')) return true;
    const card = document.createElement('article');
    card.id = 'memberSearch';
    card.className = 'glass cm-panel';
    card.innerHTML = `<div class="panel-title-row"><div><span class="panel-kicker">MEMBERS</span><h3>Find a member</h3></div></div>
      <input id="msInput" type="search" maxlength="40" placeholder="Search by display name" autocomplete="off" />
      <div id="msResults" class="ms-results"><p class="micro-note">Type at least 2 letters. Only members who chose to be listed appear. You need to be signed in.</p></div>`;
    layout.insertAdjacentElement('afterend', card);
    let timer = null;
    q('#msInput', card).addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => searchMembers(e.target.value), 320); });
    q('#msResults', card).addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (b) viewPerson(b.dataset.person); });
    return true;
  }

  async function searchMembers(raw) {
    const box = q('#msResults');
    if (!box) return;
    const term = String(raw || '').trim().toLowerCase();
    if (term.length < 2) { box.innerHTML = '<p class="micro-note">Type at least 2 letters. Only members who chose to be listed appear. You need to be signed in.</p>'; return; }
    if (!state.user) { box.innerHTML = '<p class="micro-note">Sign in to search members.</p>'; return; }
    box.innerHTML = '<p class="micro-note">Searching…</p>';
    try {
      await window.MH_FIREBASE.initFirebase();
      const snap = await db().collection('profiles').orderBy('name_lower').startAt(term).endAt(`${term}\uf8ff`).limit(25).get();
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.discoverable !== false);
      box.innerHTML = rows.length
        ? rows.map((p) => `<button class="ms-row" data-person="${esc(p.id)}"><span class="lb-av">${p.show_avatar && p.avatar ? `<img src="${esc(p.avatar)}" alt="" />` : esc(initials(p.display_name))}</span><span><b>${esc(p.display_name)}</b><small>${esc([p.who, p.org].filter(Boolean).join(' · '))}</small></span></button>`).join('')
        : '<p class="micro-note">No members found with that name.</p>';
    } catch { box.innerHTML = '<p class="micro-note">Search is not available right now.</p>'; }
  }

  /* ---------------- wiring ---------------- */
  document.addEventListener('click', (e) => {
    const person = e.target.closest('[data-person]');
    if (person) { viewPerson(person.dataset.person); return; }
    if (e.target.closest('#userAvatar, #userName')) openMine();
  });
  window.addEventListener('mh:session', (e) => { cache.clear(); if (e.detail.user) loadMine(); else { mine = null; } });
  window.addEventListener('mh:view', () => { mountSearch(); });
  { let n = 0; const t = setInterval(() => { if (mountSearch() || n++ > 40) clearInterval(t); }, 250); }

  window.MH_PROFILE = { open: openMine, view: viewPerson, decorate, displayName: () => mine?.display_name || '' };
})();
