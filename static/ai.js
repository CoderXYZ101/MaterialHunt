/* ==========================================================================
   MATERIALHUNT — Assistant v2
   Answers any question (Gemini via Firebase AI Logic) with streaming, photo + voice input,
   follow-up chips and one-click actions. If live AI is not enabled yet, it falls back to a
   built-in engineering assistant that understands grades, comparisons and requirements.
   Loaded after tools.js and growth.js.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 0) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: d });
  const rupee = (v) => `₹${num(v)}`;
  const T = () => window.MH_TOOLS;
  const STORE = 'mh_chat_v2';
  const SDK = '11.10.0';

  let messages = [];
  try { messages = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { messages = []; }
  let modelPromise = null;
  let chat = null;
  let aiOff = false;
  let attached = null;
  let busy = false;
  let restored = false;

  /* ------------------------------------------------------------------ */
  /* System prompt + per-question context                                */
  /* ------------------------------------------------------------------ */
  function systemPrompt() {
    const grades = (T()?.GRADES || []).map((g) => `${g.id}=${g.name}`).join('; ');
    return `You are the MaterialHunt Assistant: a practical materials, manufacturing and sourcing engineer for Indian engineers, student teams, makers, fabricators and buyers.
Answer ANY question the user asks. Materials, design, machining, welding, 3D printing, corrosion, failure analysis, procurement, costs and standards are your specialty, but you can also help with general questions, study and career questions, and writing.
Rules:
- Be specific and useful. Give numbers with units, name real grades and standards (ASTM, IS, EN), and use INR (₹) for prices.
- Prices are indicative ranges, never live quotes. Do not invent supplier names, phone numbers or exact stock. For purchasing, point to the MaterialHunt RFQ.
- You are given the user's current simulation as Context. Use it when relevant, and never claim to have run tests you did not run.
- Be honest about uncertainty. For safety-critical parts say a qualified engineer and an accredited lab should confirm.
- Refuse help with weapons, explosives or evading export controls.
- Keep answers under about 180 words unless the user asks for depth. Short paragraphs and bullet lists. No headings.
- When you recommend a specific grade from the app's library you may add a tag [[load:ID]] to offer a one-click test. Library ids: ${grades}
- To suggest a search for the user's requirement add [[find:their requirement in plain words]]. To open a tool add [[view:doctor]], [[view:bom]], [[view:ai-design]] or [[view:pricing]].
- End EVERY answer with one final line exactly like: FOLLOWUPS: question one | question two | question three (each under 9 words, things the user is likely to ask next).`;
  }

  function buildContext() {
    const sim = state.simulation;
    const d = sim?.derived;
    const m = T()?.lastMatch;
    const ctx = { page: state.view, user_plan: state.user?.tier || 'guest' };
    if (sim && d) {
      ctx.alloy_wt_pct = typeof normalisedComposition === 'function' ? Object.fromEntries(Object.entries(normalisedComposition()).map(([k, v]) => [k, Number(v.toFixed(1))])) : undefined;
      ctx.conditions = { temperature_c: sim.conditions?.temperature_c, load_mpa: sim.conditions?.load_mpa, safety_factor: sim.conditions?.safety_factor, environment: sim.conditions?.environment };
      ctx.result = { verdict: d.verdict, capacity_used_pct: Math.round((d.utilization_ratio || 0) * 100), working_strength_mpa: Math.round(d.operating_strength_mpa), density_g_cm3: Number(Number(d.density_gcm3).toFixed(2)), raw_cost_inr_per_kg: Math.round(d.cost_per_kg), melting_c: Math.round(d.liquidus_c || 0), phase: d.aggregate_phase };
    }
    if (m) ctx.closest_grade = { name: m.best.grade.name, match_pct: Math.round(m.best.score), price_inr_per_kg: m.price || null, availability: m.avail };
    return ctx;
  }

  /* ------------------------------------------------------------------ */
  /* Live model (Firebase AI Logic -> Gemini Developer API)              */
  /* ------------------------------------------------------------------ */
  async function getModel() {
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      const [appMod, aiMod] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-ai.js`),
      ]);
      const cfg = window.MH_FIREBASE?.config;
      if (!cfg) throw new Error('Firebase config missing');
      const app = appMod.getApps().find((a) => a.name === 'mh-ai') || appMod.initializeApp(cfg, 'mh-ai');
      const ai = aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() });
      return aiMod.getGenerativeModel(ai, { model: (window.MH_CONFIG?.aiModel || 'gemini-2.5-flash'), systemInstruction: systemPrompt(), generationConfig: { temperature: 0.5, maxOutputTokens: 900 } });
    })();
    modelPromise.catch(() => { modelPromise = null; });
    return modelPromise;
  }

  function plainHistory() {
    return messages.slice(-10).filter((m) => m.text).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text.slice(0, 1200) }] }));
  }

  async function askModel(question, onChunk) {
    const model = await getModel();
    if (!chat) chat = model.startChat({ history: plainHistory() });
    const prompt = `Context: ${JSON.stringify(buildContext())}\n\nUser question: ${question}`;
    const parts = attached ? [{ text: prompt }, { inlineData: { mimeType: attached.mime, data: attached.b64 } }] : prompt;
    const result = await chat.sendMessageStream(parts);
    let full = '';
    for await (const chunk of result.stream) {
      full += chunk.text();
      onChunk(full);
    }
    return full;
  }

  /* ------------------------------------------------------------------ */
  /* Built-in fallback assistant                                         */
  /* ------------------------------------------------------------------ */
  function mentionedGrades(text) {
    const norm = String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
    const hits = [];
    (T()?.GRADES || []).forEach((g) => {
      let best = 0;
      g.al.concat([g.id]).forEach((alias) => {
        const a = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (a.length >= 3 && norm.includes(a) && a.length > best) best = a.length;
      });
      if (best) hits.push({ g, len: best });
    });
    hits.sort((a, b) => b.len - a.len);
    const chosen = [];
    hits.forEach((h) => {
      const aliases = h.g.al.concat([h.g.id]).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (!chosen.some((c) => c.len > h.len && c.aliases.some((ca) => aliases.some((a) => ca.includes(a) && a.length <= ca.length && a !== ca)))) chosen.push({ ...h, aliases });
    });
    return chosen.slice(0, 2).map((c) => c.g);
  }

  const AV = { stock: 'readily stocked in India', order: 'orderable in India (2-4 weeks)', import: 'mostly imported (6+ weeks)' };
  const MACH = { easy: 'easy', moderate: 'moderate (carbide tools)', hard: 'hard (rigid setup, carbide/ceramic)' };
  const WELD = { good: 'welds well', fair: 'weldable with care', poor: 'prone to weld cracking' };
  const AM = { proven: 'proven for 3D printing', possible: 'possible, limited data', no: 'not practical to print' };
  const dens = (g) => T().analyticDensity(g.comp);

  function gradeSheet(g) {
    const std = [g.std.astm, g.std.is !== '-' ? g.std.is : '', g.std.en !== '-' ? g.std.en : ''].filter(Boolean).join(' · ');
    return `<b>${esc(g.name)}</b> (${esc(std)})<ul>
      <li>Yield about <b>${num(g.y)} MPa</b>, rated to roughly <b>${num(g.t)}°C</b></li>
      <li>Density <b>${dens(g).toFixed(2)} g/cm³</b>, price about <b>${rupee(g.price[0])}-${rupee(g.price[1])}/kg</b>, ${AV[g.av]}</li>
      <li>Machining ${MACH[g.m]}; ${WELD[g.w]}; ${AM[g.am]}</li>
      <li>Corrosion resistance ${g.c}/3${g.cryo ? '; stays tough at cryogenic temperatures' : ''}</li></ul>`;
  }

  function localAnswer(text) {
    const t = T();
    const lower = text.toLowerCase();
    const req = t.parseRequirement(text);
    const grades = mentionedGrades(text);
    const out = { html: '', followups: [], actions: [] };

    if (/\b(vs|versus|compare|difference|better than|or)\b/.test(lower) && grades.length === 2) {
      const [a, b] = grades;
      const row = (label, fa, fb) => `<tr><td>${label}</td><td>${fa}</td><td>${fb}</td></tr>`;
      out.html = `<table class="chat-table"><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr>
        ${row('Yield', `${num(a.y)} MPa`, `${num(b.y)} MPa`)}${row('Max temp', `${num(a.t)}°C`, `${num(b.t)}°C`)}
        ${row('Density', `${dens(a).toFixed(2)}`, `${dens(b).toFixed(2)}`)}${row('Price/kg', `${rupee(mid(a.price))}`, `${rupee(mid(b.price))}`)}
        ${row('Corrosion', `${a.c}/3`, `${b.c}/3`)}${row('Welding', a.w, b.w)}${row('Machining', a.m, b.m)}</table>
        <p>${mid(a.price) < mid(b.price) ? esc(a.name) : esc(b.name)} is cheaper per kg. ${a.c !== b.c ? `${esc((a.c > b.c ? a : b).name)} resists corrosion better.` : ''} ${a.y !== b.y ? `${esc((a.y > b.y ? a : b).name)} is stronger.` : ''}</p>`;
      out.actions = [['load', a.id, `Test ${a.name}`], ['load', b.id, `Test ${b.name}`]];
      out.followups = ['Which is better for seawater?', 'Which is easier to weld?', 'Create an RFQ for one'];
      return out;
    }

    const constraints = [req.tempC !== null, req.stress, req.maxCost, req.maxDensity, req.banned.length, req.corr, req.weld, req.am, req.hydrogen].filter(Boolean).length;
    if (constraints >= 2 || /\b(recommend|suggest|which|what|best)\b.*\b(metal|alloy|material|grade|steel)\b/.test(lower)) {
      if (req.functional) { out.html = 'That needs a functional-materials search (magnetic, catalytic or amorphous). My search covers structural alloys, so I would not trust a list for it.'; return out; }
      const res = t.findAlloys(text);
      if (res.passed.length) {
        out.html = `<p><b>${res.passed.length}</b> of ${res.total} grades pass every limit you gave. Top picks:</p><ol>${res.passed.slice(0, 3).map((e) => `<li><b>${esc(e.grade.name)}</b>: ${num(Math.round(e.yT))} MPa at temperature, ${e.rho.toFixed(2)} g/cm³, ${rupee(e.grade.price[0])}-${rupee(e.grade.price[1])}/kg</li>`).join('')}</ol>`;
        out.actions = [['load', res.passed[0].grade.id, `Test ${res.passed[0].grade.name}`], ['find', text, 'See all results']];
        out.followups = ['Why not the others?', 'Is it easy to weld?', 'Create an RFQ for the top pick'];
      } else {
        const gate = res.unlock && res.unlock[0];
        out.html = `<p>No commercial grade meets every limit.${gate ? ` The closest option passes everything except <b>${esc(gate.gate)}</b>: <b>${esc(gate.list[0].grade.name)}</b>.` : ''} Relaxing one limit is usually enough.</p>`;
        out.actions = [['find', text, 'See what blocks it']];
        out.followups = ['Which limit should I relax?', 'Show cheaper options', 'Suggest a coating instead'];
      }
      return out;
    }

    if (grades.length === 1) {
      const g = grades[0];
      if (/alternat|substitut|replace|instead|cheaper/.test(lower)) {
        const alts = t.GRADES.filter((c) => c.id !== g.id && c.family === g.family && c.y >= g.y * 0.9 && mid(c.price) < mid(g.price)).slice(0, 3);
        out.html = alts.length ? `<p>Cheaper options in the same family that keep similar strength:</p><ul>${alts.map((a) => `<li><b>${esc(a.name)}</b>: ${rupee(a.price[0])}-${rupee(a.price[1])}/kg, yield ${num(a.y)} MPa</li>`).join('')}</ul>` : `<p>${esc(g.name)} is already among the lowest-cost options for its strength. The Cost-Down Scanner checks your exact load and environment.</p>`;
        out.actions = [['view', 'bom', 'Open Cost-Down Scanner']];
      } else {
        out.html = gradeSheet(g);
        out.actions = [['load', g.id, `Test ${g.name}`], ['view', 'doctor', 'Failure Doctor']];
      }
      const short = (g.name.match(/[A-Za-z]*\d[\w-]*/) || [g.name])[0];
      out.followups = [`Is ${short} good for seawater?`, 'Show cheaper alternatives', 'Create an RFQ'];
      return out;
    }

    if (/\b(rfq|quote|supplier|vendor|nabl|test lab|where (can|do) i buy)\b/.test(lower)) {
      out.html = '<p>The quickest route: test your metal in the simulator, press <b>Create RFQ &amp; test sheet</b>, and download the one-page RFQ with grade, composition window, mechanical needs and the NABL tests to request. You can send it to our sourcing desk or email it to suppliers yourself.</p>';
      out.actions = [['view', 'supplier-marketplace', 'Browse suppliers & labs'], ['view', 'simulator', 'Open simulator']];
      out.followups = ['What tests should I ask for?', 'How do I compare quotes?', 'What is a mill test certificate?'];
      return out;
    }
    if (/\b(crack|broke|snapp|rust|corrod|melt|warp|fail)\w*/.test(lower)) {
      out.html = '<p>Use the <b>Failure Doctor</b>. Tell it the metal, what happened and where it was used, and it names the likely mechanism and a safer grade you can test in one click.</p>';
      out.actions = [['view', 'doctor', 'Open Failure Doctor']];
      out.followups = ['Why do metals crack in the cold?', 'What is chloride pitting?', 'How do I stop fatigue cracks?'];
      return out;
    }
    if (/\b(price|cost|cheap|budget|save|overpay)\w*/.test(lower)) {
      out.html = '<p>Paste your parts list into the <b>Cost-Down Scanner</b>. It checks each part against cheaper grades that still meet your safety factor and totals the saving per batch.</p>';
      out.actions = [['view', 'bom', 'Open Cost-Down Scanner']];
      out.followups = ['What affects metal prices?', 'Is steel cheaper than aluminium?', 'How do I cut machining cost?'];
      return out;
    }

    // existing context-aware answers (current simulation)
    if (typeof copilotAnswer === 'function') {
      try {
        const a = copilotAnswer(text);
        const generic = /^Here is the current picture/.test(a?.text || '');
        if (a && a.text && !/Run one simulation first/.test(a.text) && (!generic || /(my|this|current|result|simulation|verdict|alloy|it|part)/i.test(text))) { out.html = a.text; out.followups = ['How can I make it cheaper?', 'Is it easy to machine?', 'Find a better alloy']; if (a.action) out.actions = [['fix', '', 'Apply suggested fix']]; return out; }
      } catch { /* fall through */ }
    }
    out.html = `<p>I am in quick-answer mode right now, so I cannot take open-ended questions yet. I can <b>describe any grade</b> (try "tell me about 316L"), <b>compare two</b> ("316L vs 2205"), or <b>recommend metals</b> for a job ("part at 600°C, 200 MPa, under ₹1,000/kg").</p>`;
    out.followups = ['Tell me about Ti-6Al-4V', '316L vs 2205 for seawater', 'Metal for 800°C under ₹1,500/kg'];
    return out;
  }
  const mid = (r) => (r[0] + r[1]) / 2;

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function mdLite(raw) {
    let html = esc(raw);
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const lines = html.split('\n');
    const outLines = [];
    let list = null;
    const close = () => { if (list) { outLines.push(`</${list}>`); list = null; } };
    lines.forEach((line) => {
      const ul = line.match(/^\s*[-•*]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (ul) { if (list !== 'ul') { close(); outLines.push('<ul>'); list = 'ul'; } outLines.push(`<li>${ul[1]}</li>`); }
      else if (ol) { if (list !== 'ol') { close(); outLines.push('<ol>'); list = 'ol'; } outLines.push(`<li>${ol[1]}</li>`); }
      else { close(); if (line.trim()) outLines.push(`<p>${line.replace(/^#+\s*/, '')}</p>`); }
    });
    close();
    return outLines.join('');
  }

  function parseModelText(raw, streaming) {
    let text = String(raw || '').trim();
    const followups = [];
    const actions = [];
    text = text.replace(/\n?FOLLOWUPS:\s*(.+)$/i, (m, list) => { list.split('|').map((x) => x.trim()).filter(Boolean).slice(0, 3).forEach((x) => followups.push(x)); return ''; });
    text = text.replace(/\[\[(load|find|view):([^\]]+)\]\]/g, (m, kind, val) => { actions.push([kind, val.trim(), '']); return ''; });
    if (streaming) text = text.replace(/\[\[[^\]]*$/, '').replace(/\n?FOLLOWUPS:.*$/is, '');
    return { html: mdLite(text.trim()), followups, actions };
  }

  function actionLabel(kind, val) {
    if (kind === 'load') return `Test ${T()?.BY_ID?.[val]?.name || val} in simulator`;
    if (kind === 'find') return 'Search alloys for this';
    return { doctor: 'Open Failure Doctor', bom: 'Open Cost-Down Scanner', 'ai-design': 'Open Alloy Finder', pricing: 'See plans', simulator: 'Open simulator', 'supplier-marketplace': 'Suppliers & labs' }[val] || 'Open';
  }

  function runAction(kind, val) {
    if (kind === 'load' && T()?.BY_ID[val]) { T().applyGrade(T().BY_ID[val], {}); }
    else if (kind === 'view') setView(val);
    else if (kind === 'find') {
      setView('ai-design');
      setTimeout(() => { const box = q('#aiDesignPrompt'); if (box) { box.value = val; q('#runAIDesign')?.click(); } }, 150);
    } else if (kind === 'fix' && typeof copilotAction === 'function') copilotAction('fix');
  }

  function decorate(msgEl, parsed) {
    qa('.chat-extras', msgEl).forEach((n) => n.remove());
    const extras = document.createElement('div');
    extras.className = 'chat-extras';
    if (parsed.actions.length) {
      const row = document.createElement('div');
      row.className = 'chat-actions';
      parsed.actions.slice(0, 3).forEach(([kind, val, label]) => {
        const b = document.createElement('button');
        b.className = 'btn btn-primary small';
        b.textContent = label || actionLabel(kind, val);
        b.addEventListener('click', () => runAction(kind, val));
        row.appendChild(b);
      });
      extras.appendChild(row);
    }
    if (parsed.followups.length) {
      const row = document.createElement('div');
      row.className = 'chat-followups';
      parsed.followups.forEach((f) => {
        const b = document.createElement('button');
        b.className = 'copilot-chip';
        b.textContent = f;
        b.addEventListener('click', () => window.copilotAsk(f));
        row.appendChild(b);
      });
      extras.appendChild(row);
    }
    const tools = document.createElement('div');
    tools.className = 'chat-tools';
    const copy = document.createElement('button');
    copy.className = 'text-btn';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => { navigator.clipboard?.writeText(msgEl.querySelector('.chat-body')?.innerText || ''); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); });
    tools.appendChild(copy);
    extras.appendChild(tools);
    msgEl.appendChild(extras);
  }

  function addMessage(role) {
    const box = q('#copilotMessages');
    const el = document.createElement('div');
    el.className = `copilot-msg ${role}`;
    el.innerHTML = `<span class="copilot-role">${role === 'user' ? 'You' : 'Assistant'}</span><div class="chat-body"></div>`;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(messages.slice(-30).map((m) => ({ role: m.role, text: String(m.text || '').slice(0, 1500), followups: m.followups || [] })))); } catch { /* storage full */ }
  }

  function greeting() {
    const el = addMessage('assistant');
    q('.chat-body', el).innerHTML = '<p>Hi, I am the MaterialHunt assistant. Ask me <b>anything</b>: which metal to use, why a part failed, how to cut cost, what to ask a supplier. I can also look at a <b>photo of a damaged part</b>.</p>';
    decorate(el, { actions: [], followups: ['Which metal for a 1000°C part under ₹2,000/kg?', 'Why did my steel bracket rust at the coast?', 'How do I read my simulation result?'] });
  }

  function restore() {
    if (restored) return;
    restored = true;
    const box = q('#copilotMessages');
    if (!box) return;
    if (!messages.length) { greeting(); return; }
    messages.forEach((m) => {
      const el = addMessage(m.role);
      if (m.role === 'user') q('.chat-body', el).textContent = m.text;
      else { const p = parseModelText(m.text, false); q('.chat-body', el).innerHTML = p.html; }
    });
    const last = messages[messages.length - 1];
    const lastEl = box.lastElementChild;
    if (last?.role === 'assistant' && lastEl && (last.followups || []).length) decorate(lastEl, { actions: [], followups: last.followups });
  }

  /* ------------------------------------------------------------------ */
  /* Ask                                                                 */
  /* ------------------------------------------------------------------ */
  window.copilotAsk = async function copilotAskV2(prompt) {
    const question = String(prompt || '').trim();
    if ((!question && !attached) || busy) return;
    if (window.MH_PLAN && !window.MH_PLAN.use('ai')) return;
    restore();
    qa('#copilotMessages .chat-extras').forEach((n) => { qa('.chat-followups', n).forEach((f) => f.remove()); });
    const text = question || 'What can you tell me about this part?';
    const userEl = addMessage('user');
    q('.chat-body', userEl).textContent = text;
    if (attached) { const img = document.createElement('img'); img.src = attached.preview; img.className = 'chat-thumb'; q('.chat-body', userEl).appendChild(img); }
    messages.push({ role: 'user', text });
    const box = q('#copilotMessages');
    const el = addMessage('assistant');
    const body = q('.chat-body', el);
    body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    busy = true;
    q('#copilotSend').disabled = true;
    let final = '';
    let parsed = null;
    try {
      if (aiOff) throw new Error('ai-off');
      final = await askModel(text, (partial) => { body.innerHTML = parseModelText(partial, true).html || '<span class="typing"><i></i><i></i><i></i></span>'; box.scrollTop = box.scrollHeight; });
      parsed = parseModelText(final, false);
      body.innerHTML = parsed.html;
    } catch (error) {
      if (error.message !== 'ai-off') {
        if (!/429|quota|rate|resource.?exhausted|network|fetch/i.test(String(error.message))) aiOff = true;
        console.warn('Live AI unavailable, using built-in assistant:', error.message || error);
      }
      chat = null;
      if (attached) {
        parsed = { html: '<p>Reading photos needs the live AI assistant, which is not switched on yet. Describe the part in words (metal, what happened, where it was used) and I will diagnose it, or open the Failure Doctor.</p>', followups: ['Open the Failure Doctor'], actions: [['view', 'doctor', 'Open Failure Doctor']] };
        final = 'Photo analysis unavailable.';
      } else {
        const local = localAnswer(text);
        parsed = { html: local.html, followups: local.followups, actions: local.actions };
        final = local.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      body.innerHTML = parsed.html;
    }
    decorate(el, parsed);
    messages.push({ role: 'assistant', text: final || '', followups: parsed.followups });
    save();
    busy = false;
    q('#copilotSend').disabled = false;
    clearAttachment();
    box.scrollTop = box.scrollHeight;
    window.MH_GROWTH?.track?.('assistant_question', { live: !aiOff });
  };

  /* ------------------------------------------------------------------ */
  /* Input: textarea, photo, voice, new chat                             */
  /* ------------------------------------------------------------------ */
  function clearAttachment() {
    attached = null;
    const p = q('#copilotAttachPreview');
    if (p) { p.classList.add('hidden'); p.innerHTML = ''; }
    const f = q('#copilotFile');
    if (f) f.value = '';
  }

  function setupInput() {
    const input = q('#copilotInput');
    if (!input) return;
    const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); q('#copilotForm').requestSubmit(); }
      if (e.key === 'Escape') e.stopPropagation();
    });
    q('#copilotForm')?.addEventListener('submit', () => setTimeout(grow, 0));

    q('#copilotAttach')?.addEventListener('click', () => q('#copilotFile').click());
    q('#copilotFile')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.82);
          attached = { mime: 'image/jpeg', b64: url.split(',')[1], preview: url };
          const p = q('#copilotAttachPreview');
          p.classList.remove('hidden');
          p.innerHTML = `<img src="${url}" alt="Attached photo" /><span>Photo attached</span><button type="button" class="text-btn" id="copilotDetach">Remove</button>`;
          q('#copilotDetach').addEventListener('click', clearAttachment);
          input.focus();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    const mic = q('#copilotMic');
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (mic) {
      if (!Rec) mic.classList.add('hidden');
      else {
        let rec = null;
        mic.addEventListener('click', () => {
          if (rec) { rec.stop(); return; }
          rec = new Rec();
          rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false;
          mic.classList.add('listening');
          rec.onresult = (ev) => { input.value = Array.from(ev.results).map((r) => r[0].transcript).join(' '); grow(); };
          rec.onend = () => { mic.classList.remove('listening'); rec = null; input.focus(); };
          rec.onerror = () => { mic.classList.remove('listening'); rec = null; };
          rec.start();
        });
      }
    }

    q('#copilotNew')?.addEventListener('click', () => {
      messages = []; chat = null; restored = false; save();
      q('#copilotMessages').innerHTML = '';
      clearAttachment();
      restore();
    });
  }

  /* hook open so history is restored before the old greeting would be drawn */
  const originalOpen = window.copilotOpen;
  if (typeof originalOpen === 'function') {
    window.copilotOpen = function copilotOpenV2() { restore(); originalOpen(); };
  }

  function boot() { setupInput(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
