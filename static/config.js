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

  /* ---------- Your own damage-photo model (optional) ----------
     Train an Image Project at teachablemachine.withgoogle.com, export it ("Upload my model") and paste the
     shared link here, for example: 'https://teachablemachine.withgoogle.com/models/XXXXXXXX/'
     Name the classes with words like rust, heat damage, snapped, crack, bent. Leave empty to use the
     basic built-in colour-and-texture check. Runs on the visitor's device and uses no cloud tokens. */
  defectModelUrl: '',

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
  paymentLinks: { pro_month: '', pro_year: '', max_month: '', max_year: '', ultra_month: '', ultra_year: '', team_month: '', team_year: '', team_max_month: '', team_max_year: '', team_ultra_month: '', team_ultra_year: '', credits: '' },

  /* Prices in INR (shown on the Pricing page and used at checkout). */
  prices: {
    pro: { month: 1499, year: 14990 }, max: { month: 2999, year: 29990 }, ultra: { month: 5999, year: 59990 },
    team: { month: 4999, year: 49990 }, team_max: { month: 9999, year: 99990 }, team_ultra: { month: 19999, year: 199990 },
    credits: 999,
  },

  /* ---------- Rotating challenge ----------
     challengePeriod: 'week' (Monday to Sunday, India time) or 'month'.
     The challenge and its leaderboard change automatically each period, cycling through `rotation`.
     To force a particular challenge for a period: featured: { '2026-W49': 'submersible' } */
  challengePeriod: 'week',
  rotation: ['machine-bracket', 'submersible', 'ev-enclosure', 'turbine-blade'],
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
