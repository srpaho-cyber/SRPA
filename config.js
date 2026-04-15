// ════════════════════════════════════════════════════════════════
// FREIGHT ERP PRO — config.js
// ────────────────────────────────────────────────────────────────
// ONE FILE. ONE PLACE. Paste your Supabase credentials here.
// Every other file reads from here automatically.
//
// HOW TO GET YOUR CREDENTIALS:
//   1. Go to https://supabase.com → your project
//   2. Left sidebar → Settings → API
//   3. Copy "Project URL"  → paste into SUPABASE_URL below
//   4. Copy "anon public"  → paste into SUPABASE_ANON_KEY below
//      (May start with eyJ... or sb_publishable_ — both are valid)
//   5. Save this file. Done. Never touch any other file for credentials.
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL      = 'https://wualazusrxdwtlpjtpde.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nlNalIcQBA4KFwVNm0aZ5w_UCWQnbw9';

// ── APP META ─────────────────────────────────────────────────────
const APP_NAME    = 'Freight ERP Pro';
const APP_VERSION = '4.0';

// ── SESSION CONFIG ────────────────────────────────────────────────
const SESSION_DAYS = 7;
const SESSION_KEY  = 'erp_session';

// ── DEFAULTS ─────────────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_GST_PCT   = 18;

// ── CONFIG VALIDATION ─────────────────────────────────────────────
// Validates using pattern checks — any real Supabase URL/key will pass.
(function validateConfig() {
  const missing = [];

  // Must be a real https://xxxx.supabase.co URL
  const validURL = typeof SUPABASE_URL === 'string' &&
                   /^https:\/\/.+\.supabase\.co$/.test(SUPABASE_URL.trim());

  // Must be a non-empty string (eyJ... JWT or sb_publishable_... both valid)
  const validKEY = typeof SUPABASE_ANON_KEY === 'string' &&
                   SUPABASE_ANON_KEY.trim().length > 20;

  if (!validURL) missing.push('SUPABASE_URL');
  if (!validKEY) missing.push('SUPABASE_ANON_KEY');

  if (missing.length > 0) {
    window.__CONFIG_MISSING = missing;
    console.warn('[Freight ERP] config.js: Missing credentials:', missing.join(', '));
  } else {
    window.__CONFIG_MISSING = null;
    console.info('[Freight ERP] config.js loaded OK ✓');
  }
})();
