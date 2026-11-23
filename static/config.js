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
  aiProxyUrl: '',

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

  /* Where upgrade / sales enquiries are emailed from the site footer (optional). */
  supportEmail: '',
};
