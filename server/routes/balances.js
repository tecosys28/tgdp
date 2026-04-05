// ─── /api/v1/balances ─────────────────────────────────────────────────────────

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');

const router = express.Router();

// GET /balances/tgdp
router.get('/tgdp', verifyFirebaseToken, async (req, res, next) => {
  try {
    const uid = await getUserId(req.uid);
    if (!uid) return res.json({ balance: 0 });
    const r = await pool.query('SELECT balance FROM tgdp_balances WHERE user_id = $1', [uid]);
    res.json({ balance: r.rows[0]?.balance || 0 });
  } catch (err) { next(err); }
});

// GET /balances/ftr
router.get('/ftr', verifyFirebaseToken, async (req, res, next) => {
  try {
    const uid = await getUserId(req.uid);
    if (!uid) return res.json({ cat_1: 0, cat_2: 0, cat_3: 0, cat_4: 0, cat_5: 0 });
    const r = await pool.query('SELECT cat_1,cat_2,cat_3,cat_4,cat_5 FROM ftr_balances WHERE user_id = $1', [uid]);
    res.json(r.rows[0] || { cat_1: 0, cat_2: 0, cat_3: 0, cat_4: 0, cat_5: 0 });
  } catch (err) { next(err); }
});

// GET /balances/gic
router.get('/gic', verifyFirebaseToken, async (req, res, next) => {
  try {
    const uid = await getUserId(req.uid);
    if (!uid) return res.json({ balance: 0 });
    const r = await pool.query('SELECT balance FROM gic_balances WHERE user_id = $1', [uid]);
    res.json({ balance: r.rows[0]?.balance || 0 });
  } catch (err) { next(err); }
});

async function getUserId(firebaseUid) {
  const r = await pool.query('SELECT id FROM users WHERE firebase_uid = $1', [firebaseUid]);
  return r.rows[0]?.id || null;
}

module.exports = router;
