/* ==========================================================================
   MATERIALHUNT — site configuration (the only file you need to edit)
   Loaded before the rest of the app. Everything here is PUBLIC (it ships to the browser),
   so never put secret keys in this file. Razorpay's key_id is public by design; its
   key_secret must never be added here.
   ========================================================================== */
window.MH_CONFIG = {
  /* ---------- Live AI assistant (Gemini via Firebase AI Logic) ----------
     Turn it on once in the Firebase console: Build -> AI Logic -> Get started ->
     "Gemini Developer API". Until then the assistant answers from its built-in knowledge. */
  aiModel: 'gemini-2.5-flash',

  /* ---------- Free AI via a Cloudflare Worker (Workers AI) ----------
     Paste your Worker address here, for example:
       aiProxyUrl: 'https://materialhunt-ai.yourname.workers.dev',
     When this is set it is used instead of Gemini. Leave empty to use the built-in assistant. */
  aiProxyUrl: 'https://materialhunt-ai.sasi-nayan24.workers.dev',

  /* Busy-day mode (for example the tech summit): common questions (grade comparisons, alloy searches)
     are answered by the built-in assistant so model tokens last longer. Daily limits per member are
     edited live in Admin -> Promo codes -> "Assistant limits" (no redeploy needed). */
  aiSummitMode: true,

  /* ---------- Payments ----------
     Fill in whichever options you have. Any option left empty is simply hidden.

     1) razorpayKeyId   : your Razorpay *Key ID* (starts with rzp_live_ or rzp_test_).
                          Enables card / UPI / netbanking / wallets in one popup.
     2) paymentLinks    : Razorpay Payment Link (or Payment Page / Stripe link) URLs, one per plan.
                          Keys: pro_month, pro_year, team_month, team_year, credits.
     3) upiId           : your UPI ID (VPA), e.g. materialhunt@okaxis. Enables "Pay with UPI".
     payeeName          : name shown in the UPI app.                                              */
  payments: {
    razorpayKeyId: '',
    upiId: '',
    payeeName: 'MaterialHunt',
  },
  paymentLinks: { pro_month: '', pro_year: '', team_month: '', team_year: '', credits: '' },

  /* Prices in INR (shown on the Pricing page and used at checkout). */
  prices: { pro: { month: 1499, year: 14990 }, team: { month: 4999, year: 49990 }, credits: 999 },

  /* ---------- Rotating challenge ----------
     challengePeriod: 'week' (Monday to Sunday, India time) or 'month'.
     The challenge and its leaderboard change automatically each period, cycling through `rotation`.
     To force a particular challenge for a period: featured: { '2026-W49': 'submersible' } */
  challengePeriod: 'week',
  rotation: ['rocket-nozzle', 'submersible', 'turbine-blade', 'ev-enclosure'],
  featured: {},

  /* ---------- Leaderboard prizes ----------
     Shown on the benchmark page. The Admin page has an "Award Pro" button next to each winner
     that grants the number of days below. Edit the text and days freely. */
  awards: [
    { place: '1st', prize: '1 month of Pro', days: 30 },
    { place: '2nd', prize: '2 weeks of Pro', days: 14 },
    { place: '3rd', prize: '1 week of Pro', days: 7 },
  ],

  /* Where upgrade / sales enquiries are emailed from the site footer (optional). */
  supportEmail: '',
};
