-- ═══════════════════════════════════════════════════════════════════════════
-- TGDP ECOSYSTEM — RELATIONAL DATABASE SCHEMA
-- PostgreSQL 15+
-- Mirrors the Firestore collections in functions/index.js exactly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email

-- ═══════════════════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE user_role AS ENUM (
  'household', 'licensee', 'jeweler', 'designer',
  'returnee', 'consultant', 'advertiser', 'ombudsman', 'admin'
);

CREATE TYPE kyc_status AS ENUM ('submitted', 'approved', 'rejected');

CREATE TYPE user_status AS ENUM ('pending_kyc', 'active', 'rejected', 'suspended');

CREATE TYPE earmark_status AS ENUM ('pending_verification', 'active', 'rejected', 'redeemed');

CREATE TYPE tx_type AS ENUM ('mint', 'trade', 'withdrawal', 'swap', 'redeem');

CREATE TYPE tx_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

CREATE TYPE ftr_category AS ENUM ('hospitality', 'healthcare', 'education', 'retail', 'travel');

CREATE TYPE gic_stream AS ENUM ('registration', 'minting', 'trading');

CREATE TYPE complaint_status AS ENUM (
  'filed', 'acknowledged', 'investigating', 'mediation', 'resolved', 'closed', 'appealed'
);

CREATE TYPE complaint_stage AS ENUM (
  'acknowledgment', 'investigation', 'mediation', 'resolution', 'appeal'
);

CREATE TYPE return_status AS ENUM (
  'submitted', 'assigned', 'assessed', 'payment_processing', 'completed', 'rejected'
);

CREATE TYPE design_status AS ENUM ('active', 'inactive', 'sold');

CREATE TYPE order_status AS ENUM ('pending', 'in_production', 'shipping', 'delivered', 'cancelled');

CREATE TYPE payment_status AS ENUM ('created', 'paid', 'failed', 'refunded');

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. USERS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  uid                 TEXT            PRIMARY KEY,          -- Firebase Auth UID
  email               CITEXT          NOT NULL UNIQUE,
  first_name          TEXT            NOT NULL DEFAULT '',
  last_name           TEXT            NOT NULL DEFAULT '',
  phone               TEXT,
  pan                 TEXT,
  aadhaar             TEXT,
  address             TEXT,
  city                TEXT,
  state               TEXT,
  pincode             TEXT,
  status              user_status     NOT NULL DEFAULT 'pending_kyc',
  primary_role        user_role       NOT NULL,
  email_verified      BOOLEAN         NOT NULL DEFAULT FALSE,
  wallet_address      TEXT,                                 -- Polygon wallet
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- A user can hold multiple roles (household + consultant etc.)
CREATE TABLE user_roles (
  uid                 TEXT            NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  role                user_role       NOT NULL,
  assigned_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (uid, role)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. KYC
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE kyc (
  uid                 TEXT            PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  kyc_status          kyc_status      NOT NULL DEFAULT 'submitted',
  pan_doc_url         TEXT,
  aadhaar_doc_url     TEXT,
  photo_doc_url       TEXT,
  address_doc_url     TEXT,
  kyc_hash            TEXT,                                 -- keccak256 on-chain hash
  kyc_ipfs_hash       TEXT,                                 -- Pinata IPFS hash
  kyc_ipfs_uri        TEXT,
  submitted_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         TEXT            REFERENCES users(uid),
  notes               TEXT            NOT NULL DEFAULT ''
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. HOUSEHOLD ↔ LICENSEE LINKS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE household_links (
  link_id             TEXT            PRIMARY KEY,          -- LINK-xxxx
  household_id        TEXT            NOT NULL REFERENCES users(uid),
  licensee_id         TEXT            NOT NULL REFERENCES users(uid),
  status              TEXT            NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  linked_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (household_id)                                     -- one active link per household
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. GOLD EARMARKS (Mint requests)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE earmarks (
  mint_id             TEXT            PRIMARY KEY,          -- MINT-xxxx
  user_id             TEXT            NOT NULL REFERENCES users(uid),
  jeweler_id          TEXT            REFERENCES users(uid),
  gold_grams          NUMERIC(12,4)   NOT NULL CHECK (gold_grams > 0),
  purity              SMALLINT        NOT NULL CHECK (purity IN (999,916,875,750,585,417)),
  pure_gold_grams     NUMERIC(12,4)   NOT NULL,
  tgdp_amount         BIGINT          NOT NULL,             -- 10 TGDP per pure gram
  value_inr           BIGINT          NOT NULL,
  item_description    TEXT            NOT NULL DEFAULT '',
  status              earmark_status  NOT NULL DEFAULT 'pending_verification',
  approved_by         TEXT            REFERENCES users(uid),
  approved_at         TIMESTAMPTZ,
  rejected_by         TEXT            REFERENCES users(uid),
  rejection_reason    TEXT,
  cert_ipfs_hash      TEXT,
  cert_ipfs_uri       TEXT,
  blockchain_tx_hash  TEXT,
  blockchain_network  TEXT,
  blockchain_recorded_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. TGDP BALANCES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE tgdp_balances (
  uid                 TEXT            PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  balance             NUMERIC(20,8)   NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. TGDP TRANSACTIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE tgdp_transactions (
  tx_id               TEXT            PRIMARY KEY,          -- TX-xxxx / TRADE-xxxx
  type                tx_type         NOT NULL,
  from_user_id        TEXT            REFERENCES users(uid),
  to_user_id          TEXT            REFERENCES users(uid),
  amount              NUMERIC(20,8)   NOT NULL,             -- positive = credit, negative = debit
  amount_inr          BIGINT,
  fee                 NUMERIC(20,8)   NOT NULL DEFAULT 0,
  description         TEXT,
  status              tx_status       NOT NULL DEFAULT 'pending',
  note                TEXT,
  mint_id             TEXT            REFERENCES earmarks(mint_id),
  withdraw_id         TEXT,                                 -- FK added below
  blockchain_tx_hash  TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. TGDP WITHDRAWALS (TGDP → INR bank transfer)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE tgdp_withdrawals (
  withdraw_id           TEXT            PRIMARY KEY,        -- WD-xxxx
  user_id               TEXT            NOT NULL REFERENCES users(uid),
  tgdp_amount           NUMERIC(20,8)   NOT NULL CHECK (tgdp_amount > 0),
  amount_inr            BIGINT          NOT NULL,
  rate_per_gram         NUMERIC(12,2)   NOT NULL,
  bank_account_number   TEXT            NOT NULL,
  ifsc_code             TEXT            NOT NULL,
  account_holder_name   TEXT            NOT NULL DEFAULT '',
  status                tx_status       NOT NULL DEFAULT 'processing',
  utr_number            TEXT,
  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Back-reference withdrawal → transaction
ALTER TABLE tgdp_transactions
  ADD CONSTRAINT fk_withdraw FOREIGN KEY (withdraw_id)
  REFERENCES tgdp_withdrawals(withdraw_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. FTR BALANCES  (per user, per category)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ftr_balances (
  uid                 TEXT            NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  category            ftr_category    NOT NULL,
  balance_inr         BIGINT          NOT NULL DEFAULT 0 CHECK (balance_inr >= 0),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (uid, category)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. FTR SWAPS  (TGDP → FTR)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ftr_swaps (
  swap_id             TEXT            PRIMARY KEY,          -- SWAP-xxxx
  user_id             TEXT            NOT NULL REFERENCES users(uid),
  tgdp_amount         NUMERIC(20,8)   NOT NULL,
  commission          NUMERIC(20,8)   NOT NULL,
  ftr_amount          NUMERIC(20,8)   NOT NULL,
  ftr_value_inr       BIGINT          NOT NULL,
  ftr_category        ftr_category    NOT NULL,
  expiry_date         TIMESTAMPTZ     NOT NULL,
  status              TEXT            NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','redeemed')),
  blockchain_tx_hash  TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. FTR REDEMPTIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ftr_redemptions (
  redeem_id           TEXT            PRIMARY KEY,          -- REDEEM-xxxx
  user_id             TEXT            NOT NULL REFERENCES users(uid),
  ftr_category        ftr_category    NOT NULL,
  amount_inr          BIGINT          NOT NULL CHECK (amount_inr > 0),
  partner_name        TEXT            NOT NULL DEFAULT '',
  redemption_note     TEXT            NOT NULL DEFAULT '',
  status              tx_status       NOT NULL DEFAULT 'completed',
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. GIC BALANCES  (Licensee commission credits)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE gic_balances (
  uid                 TEXT            PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  balance             NUMERIC(20,8)   NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. GIC CREDITS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE gic_credits (
  credit_id           TEXT            PRIMARY KEY,          -- GIC-xxxx
  licensee_id         TEXT            NOT NULL REFERENCES users(uid),
  stream              gic_stream      NOT NULL,
  amount              NUMERIC(20,8)   NOT NULL CHECK (amount > 0),
  source_ref          TEXT,                                 -- swap_id / mint_id / link_id
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. GIC REDEMPTIONS  (GIC → INR bank transfer)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE gic_redemptions (
  redeem_id           TEXT            PRIMARY KEY,          -- GICR-xxxx
  licensee_id         TEXT            NOT NULL REFERENCES users(uid),
  gic_amount          NUMERIC(20,8)   NOT NULL CHECK (gic_amount > 0),
  bank_account_number TEXT            NOT NULL DEFAULT '',
  ifsc_code           TEXT            NOT NULL DEFAULT '',
  status              tx_status       NOT NULL DEFAULT 'processing',
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. COMPLAINTS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE complaints (
  complaint_id        TEXT            PRIMARY KEY,          -- CMP-xxxx
  complainant_id      TEXT            NOT NULL REFERENCES users(uid),
  respondent_id       TEXT            REFERENCES users(uid),
  portal              TEXT            NOT NULL,
  category            TEXT            NOT NULL DEFAULT 'general',
  subject             TEXT            NOT NULL,
  description         TEXT            NOT NULL,
  status              complaint_status NOT NULL DEFAULT 'filed',
  stage               complaint_stage  NOT NULL DEFAULT 'acknowledgment',
  ack_deadline        TIMESTAMPTZ     NOT NULL,
  resolution_deadline TIMESTAMPTZ     NOT NULL,
  assigned_ombudsman  TEXT            REFERENCES users(uid),
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Complaint timeline events (replaces Firestore array field)
CREATE TABLE complaint_timeline (
  id                  BIGSERIAL       PRIMARY KEY,
  complaint_id        TEXT            NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
  stage               TEXT            NOT NULL,
  note                TEXT            NOT NULL DEFAULT '',
  actor_id            TEXT            REFERENCES users(uid),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. TJR RETURNS  (Jewellery return / buy-back)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE tjr_returns (
  return_id           TEXT            PRIMARY KEY,          -- TJR-xxxx
  user_id             TEXT            NOT NULL REFERENCES users(uid),
  jeweler_id          TEXT            REFERENCES users(uid),
  item_description    TEXT            NOT NULL,
  estimated_grams     NUMERIC(12,4),
  purity              SMALLINT        CHECK (purity IN (999,916,875,750,585,417)),
  assessment_grams    NUMERIC(12,4),
  assessment_purity   SMALLINT,
  assessed_value_inr  BIGINT,
  tgdp_credited       NUMERIC(20,8),
  status              return_status   NOT NULL DEFAULT 'submitted',
  assessed_by         TEXT            REFERENCES users(uid),
  assessed_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  rejection_reason    TEXT,
  blockchain_tx_hash  TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 16. TJDB DESIGNS  (T-JDB design registry)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE tjdb_designs (
  design_id           TEXT            PRIMARY KEY,          -- DES-xxxx
  designer_id         TEXT            NOT NULL REFERENCES users(uid),
  title               TEXT            NOT NULL,
  description         TEXT,
  price_tgdp          NUMERIC(20,8)   NOT NULL CHECK (price_tgdp > 0),
  price_inr           BIGINT          NOT NULL,
  category            TEXT,
  image_url           TEXT,
  metadata_uri        TEXT,                                 -- IPFS URI
  design_hash         TEXT,                                 -- keccak256 hash
  ipr_registered      BOOLEAN         NOT NULL DEFAULT FALSE,
  ipr_tx_hash         TEXT,
  ipr_design_id       BIGINT,                              -- on-chain design ID
  status              design_status   NOT NULL DEFAULT 'active',
  sales_count         INTEGER         NOT NULL DEFAULT 0,
  total_revenue_tgdp  NUMERIC(20,8)   NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 17. TJDB ORDERS  (Design purchases)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE tjdb_orders (
  order_id            TEXT            PRIMARY KEY,          -- ORD-xxxx
  buyer_id            TEXT            NOT NULL REFERENCES users(uid),
  design_id           TEXT            NOT NULL REFERENCES tjdb_designs(design_id),
  designer_id         TEXT            NOT NULL REFERENCES users(uid),
  tgdp_amount         NUMERIC(20,8)   NOT NULL,
  price_inr           BIGINT          NOT NULL,
  designer_share_tgdp NUMERIC(20,8)   NOT NULL,
  platform_fee_tgdp   NUMERIC(20,8)   NOT NULL DEFAULT 0,
  status              order_status    NOT NULL DEFAULT 'pending',
  blockchain_tx_hash  TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 18. PAYMENT ORDERS  (Razorpay)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE payment_orders (
  id                  TEXT            PRIMARY KEY,          -- Razorpay order ID
  user_id             TEXT            NOT NULL REFERENCES users(uid),
  amount              BIGINT          NOT NULL,             -- paise
  currency            TEXT            NOT NULL DEFAULT 'INR',
  purpose             TEXT            NOT NULL,             -- 'registration' | 'kyc_fee' etc.
  status              payment_status  NOT NULL DEFAULT 'created',
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 19. WITHDRAWAL REQUESTS  (manual review queue)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE withdrawal_requests (
  id                  BIGSERIAL       PRIMARY KEY,
  user_id             TEXT            NOT NULL REFERENCES users(uid),
  withdraw_id         TEXT            REFERENCES tgdp_withdrawals(withdraw_id),
  redeem_id           TEXT            REFERENCES gic_redemptions(redeem_id),
  type                TEXT            NOT NULL CHECK (type IN ('tgdp','gic')),
  amount              NUMERIC(20,8)   NOT NULL,
  amount_inr          BIGINT,
  status              tx_status       NOT NULL DEFAULT 'processing',
  processed_by        TEXT            REFERENCES users(uid),
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 20. AUDIT LOGS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE audit_logs (
  id                  BIGSERIAL       PRIMARY KEY,
  action              TEXT            NOT NULL,
  actor_id            TEXT            REFERENCES users(uid),
  target_user_id      TEXT            REFERENCES users(uid),
  entity_type         TEXT,                                 -- 'earmark' | 'complaint' | 'kyc' …
  entity_id           TEXT,
  changes             JSONB,
  ip_address          TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 21. CONFIG  (platform-wide settings — one row per key)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE config (
  key                 TEXT            PRIMARY KEY,
  value               JSONB           NOT NULL,
  updated_by          TEXT            REFERENCES users(uid),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Seed default config rows
INSERT INTO config (key, value) VALUES
  ('lbma',        '{"ratePerGram": 7342, "currency": "INR"}'),
  ('contracts',   '{"tgdpToken": "", "ftrToken": "", "gicToken": "", "registry": "", "iprRegistry": "", "network": "amoy"}'),
  ('commissions', '{"ftrCommission": 0.04, "gicShare": 0.25, "designerShare": 0.9, "minGICRedemption": 100}'),
  ('sla',         '{"acknowledgmentHours": 48, "investigationDays": 7, "mediationDays": 14, "resolutionDays": 30, "appealWindowDays": 10}'),
  ('revenue',     '{"totalFTRCommission": 0, "totalDesignRevenue": 0}'),
  ('ipfs',        '{"pinataJWT": ""}')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- Users
CREATE INDEX idx_users_status       ON users(status);
CREATE INDEX idx_users_primary_role ON users(primary_role);

-- User roles
CREATE INDEX idx_user_roles_role    ON user_roles(role);

-- KYC
CREATE INDEX idx_kyc_status         ON kyc(kyc_status);

-- Earmarks
CREATE INDEX idx_earmarks_user      ON earmarks(user_id);
CREATE INDEX idx_earmarks_status    ON earmarks(status);

-- Transactions
CREATE INDEX idx_tgdp_tx_from       ON tgdp_transactions(from_user_id);
CREATE INDEX idx_tgdp_tx_to         ON tgdp_transactions(to_user_id);
CREATE INDEX idx_tgdp_tx_type       ON tgdp_transactions(type);
CREATE INDEX idx_tgdp_tx_created    ON tgdp_transactions(created_at DESC);

-- FTR
CREATE INDEX idx_ftr_swaps_user     ON ftr_swaps(user_id);
CREATE INDEX idx_ftr_swaps_expiry   ON ftr_swaps(expiry_date);

-- GIC
CREATE INDEX idx_gic_credits_lic    ON gic_credits(licensee_id);
CREATE INDEX idx_gic_credits_stream ON gic_credits(stream);

-- Complaints
CREATE INDEX idx_complaints_status  ON complaints(status);
CREATE INDEX idx_complaints_cmp     ON complaints(complainant_id);
CREATE INDEX idx_complaints_ombuds  ON complaints(assigned_ombudsman);

-- Designs
CREATE INDEX idx_designs_designer   ON tjdb_designs(designer_id);
CREATE INDEX idx_designs_status     ON tjdb_designs(status);

-- Orders
CREATE INDEX idx_orders_buyer       ON tjdb_orders(buyer_id);
CREATE INDEX idx_orders_design      ON tjdb_orders(design_id);

-- Audit
CREATE INDEX idx_audit_action       ON audit_logs(action);
CREATE INDEX idx_audit_actor        ON audit_logs(actor_id);
CREATE INDEX idx_audit_created      ON audit_logs(created_at DESC);

-- Household links
CREATE INDEX idx_hhlinks_licensee   ON household_links(licensee_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS — auto-update updated_at
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated        BEFORE UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_earmarks_updated     BEFORE UPDATE ON earmarks        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tgdp_bal_updated     BEFORE UPDATE ON tgdp_balances   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ftr_bal_updated      BEFORE UPDATE ON ftr_balances    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_gic_bal_updated      BEFORE UPDATE ON gic_balances    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_withdrawals_updated  BEFORE UPDATE ON tgdp_withdrawals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_complaints_updated   BEFORE UPDATE ON complaints       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tjr_returns_updated  BEFORE UPDATE ON tjr_returns      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_designs_updated      BEFORE UPDATE ON tjdb_designs     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated       BEFORE UPDATE ON tjdb_orders      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
