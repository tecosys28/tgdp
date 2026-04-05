// ─── /api/v1/ftr ─────────────────────────────────────────────────────────────
// ftr_balances schema: (uid, category ftr_category, balance_inr) PK(uid,category)
// ftr_swaps.ftr_category is type ftr_category (hospitality|healthcare|education|retail|travel)

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { generateId }          = require('../helpers/generateId');

const router = express.Router();
const CAT_NAMES = { 1:'hospitality', 2:'healthcare', 3:'education', 4:'retail', 5:'travel' };

// GET /ftr/swaps
router.get('/swaps', verifyFirebaseToken, async (req, res, next) => {
  try {
    const n = Math.min(parseInt(req.query.limit) || 20, 200);
    const r = await pool.query(
      'SELECT * FROM ftr_swaps WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.uid, n]
    );
    res.json(r.rows.map(swapRow));
  } catch (err) { next(err); }
});

// POST /ftr/redeem
router.post('/redeem', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    const { ftrCategory, amountINR, partnerName, redemptionNote } = req.body;
    if (!ftrCategory || !amountINR || amountINR <= 0)
      throw apiError(400, 'INVALID_ARGUMENT', 'ftrCategory and amountINR required.');

    const catName  = CAT_NAMES[Number(ftrCategory)];
    if (!catName) throw apiError(400, 'INVALID_ARGUMENT', 'ftrCategory must be 1–5.');
    const redeemId = generateId('REDEEM');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const balRes = await client.query(
        'SELECT balance_inr FROM ftr_balances WHERE uid = $1 AND category = $2 FOR UPDATE',
        [req.uid, catName]
      );
      const catBalance = Number(balRes.rows[0]?.balance_inr || 0);
      if (catBalance < amountINR) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient FTR balance.');

      await client.query(
        'UPDATE ftr_balances SET balance_inr = balance_inr - $1, updated_at = NOW() WHERE uid = $2 AND category = $3',
        [amountINR, req.uid, catName]
      );
      await client.query(
        `INSERT INTO ftr_redemptions
           (redeem_id, user_id, ftr_category, amount_inr, partner_name, redemption_note, status)
         VALUES ($1,$2,$3,$4,$5,$6,'completed')`,
        [redeemId, req.uid, catName, amountINR, partnerName||'', redemptionNote||'']
      );

      await client.query('COMMIT');
      res.json({ success: true, redeemId });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

async function requireKYC(uid) {
  const r = await pool.query('SELECT status FROM users WHERE uid = $1', [uid]);
  if (!r.rows.length) throw apiError(404, 'NOT_FOUND', 'User not found.');
  if (r.rows[0].status !== 'active') throw apiError(422, 'KYC_REQUIRED', 'KYC verification required.');
}

function swapRow(r) {
  return {
    id: r.swap_id, swapId: r.swap_id, userId: r.user_id,
    tgdpAmount: Number(r.tgdp_amount), commission: Number(r.commission),
    ftrAmount: Number(r.ftr_amount), ftrValueINR: Number(r.ftr_value_inr),
    ftrCategory: r.ftr_category, expiryDate: r.expiry_date,
    status: r.status, createdAt: r.created_at,
  };
}

module.exports = router;
