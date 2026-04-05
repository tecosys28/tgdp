// ─── /api/v1/admin ────────────────────────────────────────────────────────────

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { fetchAndRefreshLBMA } = require('../helpers/lbma');

const router = express.Router();

// GET /admin/stats
router.get('/stats', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const [usersRes, kycRes, complaintsRes, revenueRes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query("SELECT COUNT(*) FROM kyc WHERE kyc_status = 'submitted'"),
      pool.query("SELECT COUNT(*) FROM complaints WHERE status = 'filed'"),
      pool.query("SELECT value FROM config WHERE key = 'revenue'"),
    ]);
    const rev = revenueRes.rows[0]?.value || {};
    res.json({
      totalUsers:         parseInt(usersRes.rows[0].count),
      pendingKYC:         parseInt(kycRes.rows[0].count),
      openComplaints:     parseInt(complaintsRes.rows[0].count),
      totalFTRCommission: rev.totalFTRCommission || 0,
      totalDesignRevenue: rev.totalDesignRevenue || 0,
    });
  } catch (err) { next(err); }
});

// POST /admin/lbma/refresh
router.post('/lbma/refresh', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const rate = await fetchAndRefreshLBMA();
    if (rate) {
      res.json({ success: true, ratePerGram: rate });
    } else {
      res.status(502).json({ error: { code: 'LBMA_FETCH_FAILED', message: 'LBMA fetch failed — existing rate kept.', status: 502 } });
    }
  } catch (err) { next(err); }
});

async function requireAdmin(uid) {
  const r = await pool.query("SELECT role FROM user_roles WHERE uid = $1 AND role = 'admin'", [uid]);
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

module.exports = router;
