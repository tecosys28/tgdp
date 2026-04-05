// ─── /api/v1/tjr ─────────────────────────────────────────────────────────────
// tjr_returns: user_id, jeweler_id → users.uid
// columns: estimated_grams, purity, assessment_grams, assessment_purity, assessed_value_inr

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { generateId }          = require('../helpers/generateId');
const { getLBMARate }         = require('../helpers/lbma');

const router = express.Router();

// GET /tjr/returns/mine
router.get('/returns/mine', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      'SELECT * FROM tjr_returns WHERE user_id = $1 ORDER BY created_at DESC', [req.uid]
    );
    res.json(r.rows.map(returnRow));
  } catch (err) { next(err); }
});

// GET /tjr/returns/assigned
router.get('/returns/assigned', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      'SELECT * FROM tjr_returns WHERE jeweler_id = $1 ORDER BY created_at DESC', [req.uid]
    );
    res.json(r.rows.map(returnRow));
  } catch (err) { next(err); }
});

// POST /tjr/returns
router.post('/returns', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    const { itemDescription, goldGrams, estimatedPurity, preferredJewelerId, pickupAddress, pickupDate } = req.body;
    if (!itemDescription || !goldGrams)
      throw apiError(400, 'INVALID_ARGUMENT', 'itemDescription and goldGrams required.');

    const rate          = await getLBMARate();
    const estPurity     = estimatedPurity || 916;
    const estPureGrams  = goldGrams * (estPurity / 1000);
    const estimatedValue= Math.round(estPureGrams * rate);
    const returnId      = generateId('TJR');

    await pool.query(
      `INSERT INTO tjr_returns
         (return_id, user_id, jeweler_id, item_description, estimated_grams, purity, status)
       VALUES ($1,$2,$3,$4,$5,$6,'submitted')`,
      [returnId, req.uid, preferredJewelerId||null, itemDescription, goldGrams, estPurity]
    );

    res.json({ success: true, returnId, estimatedValue });
  } catch (err) { next(err); }
});

// PATCH /tjr/returns/:id/assess
router.patch('/returns/:id/assess', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireRole(req.uid, 'jeweler');
    const returnId = req.params.id;
    const { assessedGrams, assessedPurity, certNumber } = req.body;
    if (!assessedGrams || !assessedPurity)
      throw apiError(400, 'INVALID_ARGUMENT', 'assessedGrams, assessedPurity required.');

    const rate         = await getLBMARate();
    const pureGrams    = assessedGrams * (assessedPurity / 1000);
    const assessedValue= Math.round(pureGrams * rate);

    await pool.query(
      `UPDATE tjr_returns SET
         jeweler_id = $1, assessment_grams = $2, assessment_purity = $3,
         assessed_value_inr = $4, assessed_by = $1, status = 'assessed',
         assessed_at = NOW(), updated_at = NOW()
       WHERE return_id = $5`,
      [req.uid, assessedGrams, assessedPurity, assessedValue, returnId]
    );

    res.json({ success: true, assessedValue });
  } catch (err) { next(err); }
});

// POST /tjr/returns/:id/pay — admin
router.post('/returns/:id/pay', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const returnId = req.params.id;

    const snap = await pool.query('SELECT * FROM tjr_returns WHERE return_id = $1', [returnId]);
    if (!snap.rows.length) throw apiError(404, 'NOT_FOUND', 'Return not found.');
    const ret = snap.rows[0];
    if (ret.status !== 'assessed') throw apiError(422, 'NOT_ASSESSED', 'Return not yet assessed.');

    const assessedGrams  = Number(ret.assessment_grams || 0);
    const assessedPurity = Number(ret.assessment_purity || 916);
    const tgdpAmount     = Math.floor((assessedGrams * (assessedPurity / 1000)) * 10);
    const txId           = generateId('TX');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO tgdp_balances (uid, balance) VALUES ($1,$2)
         ON CONFLICT (uid) DO UPDATE SET balance = tgdp_balances.balance + $2, updated_at = NOW()`,
        [ret.user_id, tgdpAmount]
      );
      await client.query(
        `INSERT INTO tgdp_transactions
           (tx_id, type, from_user_id, to_user_id, amount, description, status)
         VALUES ($1,'trade',$2,$2,$3,$4,'completed')`,
        [txId, ret.user_id, tgdpAmount, `Jewelry return: ${ret.item_description}`]
      );
      await client.query(
        `UPDATE tjr_returns SET status='completed', tgdp_credited=$1, completed_at=NOW(), updated_at=NOW()
         WHERE return_id=$2`,
        [tgdpAmount, returnId]
      );

      await client.query('COMMIT');
      res.json({ success: true, tgdpAmount });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

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

function returnRow(r) {
  return {
    id: r.return_id, returnId: r.return_id, userId: r.user_id, jewelerId: r.jeweler_id,
    itemDescription: r.item_description,
    goldGrams: Number(r.estimated_grams||0), estimatedPurity: r.purity,
    assessedGrams: Number(r.assessment_grams||0), assessedPurity: r.assessment_purity,
    assessedValue: Number(r.assessed_value_inr||0),
    tgdpCredited: Number(r.tgdp_credited||0),
    status: r.status, assessedAt: r.assessed_at, completedAt: r.completed_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

module.exports = router;
