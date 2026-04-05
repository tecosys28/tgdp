// ─── /api/v1/balances ─────────────────────────────────────────────────────────
// Schema: tgdp_balances.uid, ftr_balances(uid,category), gic_balances.uid

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');

const router = express.Router();

const FTR_CAT_MAP = { hospitality:1, healthcare:2, education:3, retail:4, travel:5 };

// GET /balances/tgdp
router.get('/tgdp', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query('SELECT balance FROM tgdp_balances WHERE uid = $1', [req.uid]);
    res.json({ balance: Number(r.rows[0]?.balance || 0) });
  } catch (err) { next(err); }
});

// GET /balances/ftr — returns { cat_1:..., cat_2:..., cat_3:..., cat_4:..., cat_5:... }
router.get('/ftr', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      'SELECT category, balance_inr FROM ftr_balances WHERE uid = $1', [req.uid]
    );
    const out = { cat_1: 0, cat_2: 0, cat_3: 0, cat_4: 0, cat_5: 0 };
    for (const row of r.rows) {
      const n = FTR_CAT_MAP[row.category];
      if (n) out[`cat_${n}`] = Number(row.balance_inr);
    }
    res.json(out);
  } catch (err) { next(err); }
});

// GET /balances/gic
router.get('/gic', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query('SELECT balance FROM gic_balances WHERE uid = $1', [req.uid]);
    res.json({ balance: Number(r.rows[0]?.balance || 0) });
  } catch (err) { next(err); }
});

module.exports = router;
