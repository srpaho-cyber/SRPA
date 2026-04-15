-- ═══════════════════════════════════════════════════════════════
-- FREIGHT ERP PRO — SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID extension (usually already enabled on Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════
-- TABLE: company_settings (single row)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS company_settings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name    TEXT NOT NULL DEFAULT 'Your Company',
  address         TEXT DEFAULT '',
  phone           TEXT DEFAULT '',
  email           TEXT DEFAULT '',
  gstin           TEXT DEFAULT '',
  pan             TEXT DEFAULT '',
  logo_url        TEXT DEFAULT '',
  show_amount_on_print BOOLEAN DEFAULT true,
  gst_enabled_default  BOOLEAN DEFAULT false,
  gst_pct_default      NUMERIC DEFAULT 18,
  auto_eway_alerts     BOOLEAN DEFAULT true,
  duplicate_detection  BOOLEAN DEFAULT true,
  credit_limit_warnings BOOLEAN DEFAULT true,
  fy_start_month  INTEGER DEFAULT 4,
  ui_theme        TEXT DEFAULT 'midnight-navy',
  ui_custom_colors JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: branches
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS branches (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT DEFAULT '',
  address     TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: users
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  mobile        TEXT DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'operator'
                CHECK (role IN ('admin','manager','operator','accountant')),
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  is_active     BOOLEAN DEFAULT true,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Password hashing function (using pgcrypto)
-- Usage: SELECT hash_password('mypassword');
CREATE OR REPLACE FUNCTION hash_password(plain TEXT)
RETURNS TEXT AS $$
  SELECT crypt(plain, gen_salt('bf', 10));
$$ LANGUAGE sql;

-- Password verify function
-- Usage: SELECT verify_password('mypassword', password_hash) FROM users WHERE email='...';
CREATE OR REPLACE FUNCTION verify_password(plain TEXT, hashed TEXT)
RETURNS BOOLEAN AS $$
  SELECT hashed = crypt(plain, hashed);
$$ LANGUAGE sql;

-- ═══════════════════════════════════════════════════════════════
-- TABLE: parties (consignors, consignees, or both)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS parties (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'both'
                      CHECK (type IN ('consignor','consignee','both')),
  mobile              TEXT DEFAULT '',
  email               TEXT DEFAULT '',
  gstin               TEXT DEFAULT '',
  pan                 TEXT DEFAULT '',
  address             TEXT DEFAULT '',
  city                TEXT DEFAULT '',
  state               TEXT DEFAULT '',
  credit_limit        NUMERIC DEFAULT 0,
  outstanding_balance NUMERIC DEFAULT 0,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: drivers
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS drivers (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT NOT NULL,
  mobile              TEXT NOT NULL,
  license_no          TEXT NOT NULL,
  license_expiry_date DATE,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: vehicles
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vehicles (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_no   TEXT NOT NULL UNIQUE,
  owner_name   TEXT DEFAULT '',
  mobile       TEXT DEFAULT '',
  vehicle_type TEXT DEFAULT 'truck',
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: brokers
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS brokers (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name               TEXT NOT NULL,
  mobile             TEXT DEFAULT '',
  commission_percent NUMERIC DEFAULT 0,
  is_active          BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: rate_chart (₹ per kg for routes)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rate_chart (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  from_city      TEXT NOT NULL,
  to_city        TEXT NOT NULL,
  rate_per_kg    NUMERIC NOT NULL DEFAULT 0,
  min_charge     NUMERIC DEFAULT 0,
  effective_date DATE DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_city, to_city)
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: number_series (per module per branch)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS number_series (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  module      TEXT NOT NULL CHECK (module IN ('lr','booking','manifest','payment','expense')),
  prefix      TEXT NOT NULL,
  last_number INTEGER DEFAULT 0,
  pad_width   INTEGER DEFAULT 6,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_id, module)
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: bookings
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bookings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_no    TEXT UNIQUE NOT NULL,
  booking_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  consignor_id  UUID REFERENCES parties(id) ON DELETE SET NULL,
  consignee_id  UUID REFERENCES parties(id) ON DELETE SET NULL,
  from_city     TEXT NOT NULL,
  to_city       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','lr_created','cancelled')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  remarks       TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: manifests
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS manifests (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manifest_no      TEXT UNIQUE NOT NULL,
  manifest_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  vehicle_no       TEXT NOT NULL,
  driver_id        UUID REFERENCES drivers(id) ON DELETE SET NULL,
  from_branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
  to_branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','dispatched','completed')),
  dispatch_time    TIMESTAMPTZ,
  total_weight_kg  NUMERIC DEFAULT 0,
  remarks          TEXT DEFAULT '',
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: lorry_receipts
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lorry_receipts (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lr_number            TEXT UNIQUE NOT NULL,
  lr_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  booking_id           UUID REFERENCES bookings(id) ON DELETE SET NULL,
  branch_id            UUID REFERENCES branches(id) ON DELETE SET NULL,
  consignor_id         UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  consignee_id         UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  from_city            TEXT NOT NULL,
  to_city              TEXT NOT NULL,
  vehicle_no           TEXT NOT NULL,
  driver_id            UUID REFERENCES drivers(id) ON DELETE SET NULL,
  broker_id            UUID REFERENCES brokers(id) ON DELETE SET NULL,
  broker_commission    NUMERIC DEFAULT 0,
  goods_desc           TEXT DEFAULT '',
  packages             INTEGER DEFAULT 0,
  weight_kg            NUMERIC DEFAULT 0,
  unit                 TEXT DEFAULT 'kg',
  freight_type         TEXT NOT NULL DEFAULT 'variable'
                       CHECK (freight_type IN ('variable','fixed')),
  rate                 NUMERIC DEFAULT 0,
  fixed_amount         NUMERIC DEFAULT 0,
  freight_amount       NUMERIC DEFAULT 0,
  hamali               NUMERIC DEFAULT 0,
  unloading            NUMERIC DEFAULT 0,
  st_charge            NUMERIC DEFAULT 0,
  lr_charge            NUMERIC DEFAULT 0,
  other_charges        NUMERIC DEFAULT 0,
  subtotal             NUMERIC DEFAULT 0,
  gst_enabled          BOOLEAN DEFAULT false,
  gst_pct              NUMERIC DEFAULT 18,
  gst_amount           NUMERIC DEFAULT 0,
  round_off            NUMERIC DEFAULT 0,
  total_amount         NUMERIC DEFAULT 0,
  payment_type         TEXT NOT NULL DEFAULT 'to_pay'
                       CHECK (payment_type IN ('paid','to_pay','credit','to_be_billed')),
  eway_bill_no         TEXT DEFAULT '',
  eway_expiry_date     DATE,
  eway_status          TEXT DEFAULT 'none'
                       CHECK (eway_status IN ('valid','expiring','expired','none')),
  status               TEXT NOT NULL DEFAULT 'booked'
                       CHECK (status IN ('booked','in_transit','delivered','partial','cancelled')),
  manifest_id          UUID REFERENCES manifests(id) ON DELETE SET NULL,
  delivery_date        DATE,
  pod_remarks          TEXT DEFAULT '',
  show_amount_on_print BOOLEAN DEFAULT true,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: manifest_lrs (junction: many LRs per manifest)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS manifest_lrs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manifest_id UUID NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  lr_id       UUID NOT NULL REFERENCES lorry_receipts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(manifest_id, lr_id)
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: payments
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_ref  TEXT UNIQUE NOT NULL,
  party_id     UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount       NUMERIC NOT NULL CHECK (amount > 0),
  payment_mode TEXT NOT NULL DEFAULT 'cash'
               CHECK (payment_mode IN ('cash','neft','cheque','upi','rtgs')),
  reference_no TEXT DEFAULT '',
  remarks      TEXT DEFAULT '',
  branch_id    UUID REFERENCES branches(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: expenses
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS expenses (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_ref  TEXT UNIQUE NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  lr_id        UUID REFERENCES lorry_receipts(id) ON DELETE SET NULL,
  category     TEXT NOT NULL,
  amount       NUMERIC NOT NULL CHECK (amount > 0),
  payment_mode TEXT DEFAULT 'cash'
               CHECK (payment_mode IN ('cash','neft','cheque','upi','rtgs')),
  description  TEXT DEFAULT '',
  branch_id    UUID REFERENCES branches(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE: audit_log
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID,
  user_name  TEXT NOT NULL DEFAULT 'System',
  action     TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','CANCEL','DISPATCH','LOGIN')),
  module     TEXT NOT NULL,
  record_id  TEXT,
  record_ref TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW daybook AS
  SELECT
    pay.payment_date AS entry_date,
    pay.payment_ref  AS ref_no,
    'Payment'        AS entry_type,
    p.name           AS party_name,
    pay.amount       AS credit_amount,
    0                AS debit_amount,
    pay.payment_mode,
    pay.remarks
  FROM payments pay
  LEFT JOIN parties p ON p.id = pay.party_id
UNION ALL
  SELECT
    ex.expense_date  AS entry_date,
    ex.category      AS ref_no,
    'Expense'        AS entry_type,
    'Internal'       AS party_name,
    0                AS credit_amount,
    ex.amount        AS debit_amount,
    ex.payment_mode,
    ex.description   AS remarks
  FROM expenses ex
ORDER BY entry_date DESC;

CREATE OR REPLACE VIEW party_ledger AS
  SELECT
    lr.consignee_id  AS party_id,
    lr.lr_date       AS txn_date,
    lr.lr_number     AS ref_no,
    'LR'             AS txn_type,
    lr.total_amount  AS debit_amount,
    0                AS credit_amount
  FROM lorry_receipts lr
  WHERE lr.payment_type IN ('to_pay','credit')
    AND lr.status != 'cancelled'
UNION ALL
  SELECT
    pay.party_id,
    pay.payment_date AS txn_date,
    pay.payment_ref  AS ref_no,
    'Payment'        AS txn_type,
    0                AS debit_amount,
    pay.amount       AS credit_amount
  FROM payments pay
ORDER BY txn_date;

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_lr_date        ON lorry_receipts(lr_date DESC);
CREATE INDEX IF NOT EXISTS idx_lr_status      ON lorry_receipts(status);
CREATE INDEX IF NOT EXISTS idx_lr_consignor   ON lorry_receipts(consignor_id);
CREATE INDEX IF NOT EXISTS idx_lr_consignee   ON lorry_receipts(consignee_id);
CREATE INDEX IF NOT EXISTS idx_lr_eway_expiry ON lorry_receipts(eway_expiry_date);
CREATE INDEX IF NOT EXISTS idx_lr_manifest    ON lorry_receipts(manifest_id);
CREATE INDEX IF NOT EXISTS idx_bk_status      ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_pay_party_date ON payments(party_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_exp_date       ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_date     ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module   ON audit_log(module, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- DISABLE ROW LEVEL SECURITY (for simplicity — enable later if needed)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE company_settings    DISABLE ROW LEVEL SECURITY;
ALTER TABLE branches            DISABLE ROW LEVEL SECURITY;
ALTER TABLE users               DISABLE ROW LEVEL SECURITY;
ALTER TABLE parties             DISABLE ROW LEVEL SECURITY;
ALTER TABLE drivers             DISABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles            DISABLE ROW LEVEL SECURITY;
ALTER TABLE brokers             DISABLE ROW LEVEL SECURITY;
ALTER TABLE rate_chart          DISABLE ROW LEVEL SECURITY;
ALTER TABLE number_series       DISABLE ROW LEVEL SECURITY;
ALTER TABLE bookings            DISABLE ROW LEVEL SECURITY;
ALTER TABLE manifests           DISABLE ROW LEVEL SECURITY;
ALTER TABLE lorry_receipts      DISABLE ROW LEVEL SECURITY;
ALTER TABLE manifest_lrs        DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments            DISABLE ROW LEVEL SECURITY;
ALTER TABLE expenses            DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════════

-- Insert default company settings (only if empty)
INSERT INTO company_settings (company_name, address, phone, email, gstin, pan)
SELECT 'Your Company Name', 'Main Branch Address', '+91 00000 00000', 'info@company.com', '', ''
WHERE NOT EXISTS (SELECT 1 FROM company_settings);

-- Insert default branch (only if empty)
INSERT INTO branches (id, name, city, address, phone)
SELECT gen_random_uuid(), 'Main Branch', 'Mumbai', 'Andheri East, Mumbai 400069', '022-00000000'
WHERE NOT EXISTS (SELECT 1 FROM branches);

-- Insert default admin user (only if empty)
INSERT INTO users (name, email, mobile, role, branch_id, password_hash)
SELECT 'Admin', 'admin@company.com', '9876543210', 'admin',
       (SELECT id FROM branches LIMIT 1),
       crypt('admin123', gen_salt('bf', 10))
WHERE NOT EXISTS (SELECT 1 FROM users);

-- ─── HOW TO CHANGE DEFAULT PASSWORD ───────────────────────────────────────
-- After running this script, log in with: admin@company.com / admin123
-- Then go to Users & Roles → Edit → change password immediately.
-- Or run: UPDATE users SET password_hash = crypt('YourNewPass', gen_salt('bf',10)) WHERE email = 'admin@company.com';
-- ──────────────────────────────────────────────────────────────────────────

-- Insert number series for all 5 modules for the default branch
DO $$
DECLARE
  v_branch_id UUID;
BEGIN
  SELECT id INTO v_branch_id FROM branches LIMIT 1;

  INSERT INTO number_series (branch_id, module, prefix, last_number, pad_width)
  VALUES
    (v_branch_id, 'lr',       'LR/' || EXTRACT(YEAR FROM NOW())::TEXT || '/', 0, 6),
    (v_branch_id, 'booking',  'BK/' || EXTRACT(YEAR FROM NOW())::TEXT || '/', 0, 6),
    (v_branch_id, 'manifest', 'MNF/' || EXTRACT(YEAR FROM NOW())::TEXT || '/', 0, 5),
    (v_branch_id, 'payment',  'PMT/' || EXTRACT(YEAR FROM NOW())::TEXT || '/', 0, 6),
    (v_branch_id, 'expense',  'EXP/' || EXTRACT(YEAR FROM NOW())::TEXT || '/', 0, 6)
  ON CONFLICT (branch_id, module) DO NOTHING;
END $$;
