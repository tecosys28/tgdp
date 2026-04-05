// ─── /api/v1/gic ─────────────────────────────────────────────────────────────
// gic_balances.uid (PK), gic_credits.licensee_id, gic_redemptions.licensee_id

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { generateId }          = require('../helpers/generateId');

const router = express.Router();

// GET /gic/credits
router.get('/credits', verifyFirebaseToken, async (req, res, next) => {
  try {
    const n = Math.min(parseInt(req.query.limit) || 30, 200);
    const r = await pool.query(
      'SELECT * FROM gic_credits WHERE licensee_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.uid, n]
    );
    res.json(r.rows.map(creditRow));
  } catch (err) { next(err); }
});

// POST /gic/redeem
router.post('/redeem', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    await requireRole(req.uid, 'licensee');

    const { gicAmount, bankAccountNumber, ifscCode } = req.body;
    if (!gicAmount || gicAmount <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'gicAmount must be > 0.');

    const redeemId = generateId('GICR');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const balRes = await client.query(
        'SELECT balance FROM gic_balances WHERE uid = $1 FOR UPDATE', [req.uid]
      );
      const balance = Number(balRes.rows[0]?.balance || 0);
      if (balance < gicAmount) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient GIC balance.');

      await client.query(
        'UPDATE gic_balances SET balance = balance - $1, updated_at = NOW() WHERE uid = $2',
        [gicAmount, req.uid]
      );
      await client.query(
        `INSERT INTO gic_redemptions (redeem_id, licensee_id, gic_amount, bank_account_number, ifsc_code, status)
         VALUES ($1,$2,$3,$4,$5,'processing')`,
        [redeemId, req.uid, gicAmount, bankAccountNumber||'', ifscCode||'']
      );

      await client.query('COMMIT');
      res.json({ success: true, redeemId });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /gic/credit — admin only
router.post('/credit', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const { licenseeUid, stream, amount, sourceRef } = req.body;
    if (!licenseeUid || !amount) throw apiError(400, 'INVALID_ARGUMENT', 'licenseeUid and amount required.');
    const gicAmount = Math.round(amount * 0.25);
    const credited  = await creditGIC(licenseeUid, stream||'registration', gicAmount, sourceRef||'');
    res.json({ success: true, credited });
  } catch (err) { next(err); }
});

// ─── Exported helper (used by households route) ───────────────────────────────

async function creditGIC(licenseeUid, stream, gicAmount, sourceRef) {
  // Verify licensee exists
  const lRes = await pool.query('SELECT uid FROM users WHERE uid = $1', [licenseeUid]);
  if (!lRes.rows.length) return 0;

  const creditId = generateId('GIC');
  await pool.query(
    `INSERT INTO gic_balances (uid, balance) VALUES ($1,$2)
     ON CONFLICT (uid) DO UPDATE SET balance = gic_balances.balance + $2, updated_at = NOW()`,
    [licenseeUid, gicAmount]
  );
  await pool.query(
    `INSERT INTO gic_credits (credit_id, licensee_id, stream, amount, source_ref)
     VALUES ($1,$2,$3,$4,$5)`,
    [creditId, licenseeUid, stream, gicAmount, sourceRef]
  );
  return gicAmount;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function requireKYC(uid) {
  const r = await pool.query('SELECT status FROM users WHERE uid = $1', [uid]);
  if (!r.rows.length) throw apiError(404, 'NOT_FOUND', 'User not found.');
  if (r.rows[0].status !== 'active') throw apiError(422, 'KYC_REQUIRED', 'KYC verification required.');
}

async function requireRole(uid, role) {
  const r = await pool.query('SELECT role FROM user_roles WHERE uid = $1 AND role = $2', [uid, role]);
  if (!r.rows.length) throw apiError(403, 'PERMISSION_DENIED', `Role '${role}' required.`);
}

async function requireAdmin(uid) {
  const r = await pool.query("SELECT role FROM user_roles WHERE uid = $1 AND role = 'admin'", [uid]);
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

function creditRow(r) {
  return {
    id: r.credit_id, creditId: r.credit_id, licenseeId: r.licensee_id,
    stream: r.stream, amount: Number(r.amount), sourceRef: r.source_ref,
    createdAt: r.created_at,
  };
}

module.exports = { router, creditGIC };
