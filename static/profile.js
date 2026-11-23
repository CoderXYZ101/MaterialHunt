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

  const cache = new Map();   // uid -> profile (or null when none)
  let mine = null;
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

  async function openMine() {
    if (!state.user) { openAuth('register'); return; }
    await loadMine();
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
          <label class="guardrail-check prof-show"><input type="checkbox" id="profShow" ${p.show_avatar ? 'checked' : ''} /><span><strong>Show my photo on the leaderboard</strong><small>Only signed-in members can see it. Off by default.</small></span></label>
        </div>
      </div>
      <form class="auth-form" id="profForm">
        <label class="field-label" for="profName">Display name</label><input id="profName" type="text" maxlength="40" value="${esc(p.display_name || state.user.organization_name || '')}" required />
        <label class="field-label" for="profOrg">School, college or company (optional)</label><input id="profOrg" type="text" maxlength="80" value="${esc(p.org || '')}" />
        <label class="field-label" for="profBio">About you (optional, <span id="profCount">0</span>/200)</label><textarea id="profBio" rows="3" maxlength="200">${esc(p.bio || '')}</textarea>
        <p class="micro-note">Do not share phone numbers, home addresses or other private details. Your name, organisation and bio can be seen by other signed-in members.</p>
        <button class="btn btn-primary full" type="submit">Save profile</button>
        <p class="form-error" id="profError"></p>
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
    q('#profForm', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = q('#profError', m);
      err.textContent = '';
      const doc = {
        display_name: q('#profName', m).value.trim().slice(0, 40), bio: q('#profBio', m).value.trim().slice(0, 200), org: q('#profOrg', m).value.trim().slice(0, 80),
        avatar: draftAvatar, show_avatar: Boolean(draftAvatar && q('#profShow', m).checked),
      };
      if (!doc.display_name) { err.textContent = 'Please enter a display name.'; return; }
      try {
        await window.MH_FIREBASE.initFirebase();
        await db().collection('profiles').doc(uid()).set({ ...doc, updated_at: window.firebase.firestore.FieldValue.serverTimestamp() });
        mine = { ...doc };
        cache.set(uid(), mine);
        applyChip();
        notify('Profile saved.', 'success', 2500);
        closeModal();
      } catch (error) { err.textContent = error.message || 'Could not save your profile.'; }
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
        <div><h2>${esc(name)}</h2>${p?.org ? `<p class="micro-note">${esc(p.org)}</p>` : ''}</div></div>
      ${p?.bio ? `<p class="prof-bio">${esc(p.bio)}</p>` : '<p class="micro-note">This member has not added a bio yet.</p>'}
      ${row ? `<div class="prof-entry"><span class="medal-dot medal-${esc(String(row.medal).toLowerCase())}"></span> <b>${esc(row.medal)}</b> · ${esc(row.formula)} · score <b>${row.score}</b></div>` : ''}`;
    q('[data-x]', m).addEventListener('click', closeModal);
  }

  /* ---------------- wiring ---------------- */
  document.addEventListener('click', (e) => {
    const person = e.target.closest('[data-person]');
    if (person) { viewPerson(person.dataset.person); return; }
    if (e.target.closest('#userAvatar, #userName')) openMine();
  });
  window.addEventListener('mh:session', (e) => { cache.clear(); if (e.detail.user) loadMine(); else { mine = null; } });

  window.MH_PROFILE = { open: openMine, view: viewPerson, decorate, displayName: () => mine?.display_name || '' };
})();
