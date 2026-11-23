/* ==========================================================================
   MaterialHunt AI proxy: Cloudflare Worker using Workers AI (free tier, no API key)
   ----------------------------------------------------------------------
   The website sends a question; this Worker adds the instructions, calls an open model
   running on Cloudflare, and streams the answer back. No secret ever reaches the browser.

   Setup (see the steps in the chat):
     1. Create a Worker and paste this file.
     2. Settings -> Bindings -> add "Workers AI" with the variable name  AI
     3. (Optional) Settings -> Variables: ALLOWED_ORIGINS, MODEL
   ========================================================================== */

const DEFAULT_ORIGINS = 'https://materialhunt-2026.web.app,https://materialhunt-2026.firebaseapp.com';
// Tried in order; the first one that works is used. Cloudflare retires models from time to time,
// so a list keeps the assistant alive. You can put your own first with a MODEL variable
// (one name, or several separated by commas).
const DEFAULT_MODELS = [
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/ibm-granite/granite-4.0-h-micro',
];
// Note: "thinking" models (for example Gemma 4) are left out on purpose. They spend the whole
// token budget reasoning and return no answer text.

const RULES = `You are the MaterialHunt Assistant: a practical materials, manufacturing and sourcing engineer for Indian engineers, student teams, makers, fabricators and buyers.
Answer ANY question the user asks. Materials, design, machining, welding, 3D printing, corrosion, failure analysis, procurement, costs and standards are your specialty, but you can also help with general, study and writing questions.
Rules:
- Be specific and useful. Give numbers with units, name real grades and standards (ASTM, IS, EN), and use INR (Rs) for prices.
- Prices are indicative ranges, never live quotes. Never invent supplier names, phone numbers or exact stock. For buying, point to the MaterialHunt RFQ.
- "Reference data" below comes from the app's own database and the user's current simulation. Prefer it over memory. Never claim to have run tests you did not run. If a number is not in the reference data and you are unsure, say so.
- For safety-critical parts say a qualified engineer and an accredited lab should confirm.
- Refuse help with weapons, explosives, or evading export controls.
- Keep answers under about 170 words unless the user asks for depth. Short paragraphs and bullet lists. No headings.
- When you recommend a specific grade from the library you may add a tag [[load:ID]] to offer a one-click test. To suggest a search add [[find:requirement in plain words]]. To open a tool add [[view:doctor]], [[view:bom]], [[view:ai-design]] or [[view:pricing]].
- End EVERY answer with one final line exactly like: FOLLOWUPS: question one | question two | question three (each under 9 words).`;

function cors(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'POST only' }, headers);
    if (!allowed.includes(origin)) return reply(403, { error: 'This site is not allowed to use the assistant.' }, headers);
    if (!env.AI) return reply(500, { error: 'Workers AI binding "AI" is not set up.' }, headers);

    let body;
    try { body = await request.json(); } catch { return reply(400, { error: 'Bad request' }, headers); }

    const history = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    const messages = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') return reply(400, { error: 'No question' }, headers);

    const reference = String(body.reference || '').slice(0, 5000);
    const ids = String(body.libraryIds || '').slice(0, 2500);
    const system = `${RULES}\n\nLibrary grade ids you may use in [[load:ID]] tags: ${ids || 'none'}\n\nReference data:\n${reference || 'none'}`;

    const chain = String(env.MODEL || '').split(',').map((m) => m.trim()).filter(Boolean).concat(DEFAULT_MODELS);
    const errors = [];
    for (const model of chain) {
      try {
        const stream = await env.AI.run(model, {
          messages: [{ role: 'system', content: system }, ...messages],
          stream: true,
          max_tokens: 700,
          temperature: 0.5,
        });
        return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Model': model, 'Access-Control-Expose-Headers': 'X-Model' } });
      } catch (error) {
        errors.push(`${model}: ${String(error && error.message ? error.message : error).slice(0, 120)}`);
      }
    }
    // every model failed (for example the free daily limit is used up): the site falls back to built-in answers
    return reply(503, { error: 'No model available', tried: errors }, headers);
  },
};
