// ─── /api/v1/config ───────────────────────────────────────────────────────────

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');

const router = express.Router();

// GET /config/lbma — public
router.get('/lbma', async (req, res, next) => {
  try {
    const r = await pool.query("SELECT value FROM config WHERE key = 'lbma'");
    const data = r.rows[0]?.value || {};
    res.json({ ratePerGram: data.ratePerGram || 7342, ...data });
  } catch (err) { next(err); }
});

// GET /config/ipfs — authenticated
router.get('/ipfs', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query("SELECT value FROM config WHERE key = 'ipfs'");
    const data = r.rows[0]?.value || {};
    res.json({ pinataJWT: data.pinataJWT || null });
  } catch (err) { next(err); }
});

// PATCH /config — admin only
router.patch('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const { ftrCommission, gicShare, designerShare, sla, minGICRedemption } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (ftrCommission !== undefined || gicShare !== undefined ||
          designerShare !== undefined || minGICRedemption !== undefined) {
        if (ftrCommission !== undefined && (ftrCommission < 0 || ftrCommission > 0.2))
          throw apiError(400, 'INVALID_ARGUMENT', 'FTR commission must be 0–20%');
        if (gicShare !== undefined && (gicShare < 0 || gicShare > 0.5))
          throw apiError(400, 'INVALID_ARGUMENT', 'GIC share must be 0–50%');
        if (designerShare !== undefined && (designerShare < 0.5 || designerShare > 1))
          throw apiError(400, 'INVALID_ARGUMENT', 'Designer share must be 50–100%');

        const patch = {};
        if (ftrCommission !== undefined)   patch.ftrCommission   = ftrCommission;
        if (gicShare !== undefined)        patch.gicShare        = gicShare;
        if (designerShare !== undefined)   patch.designerShare   = designerShare;
        if (minGICRedemption !== undefined)patch.minGICRedemption= minGICRedemption;
        await client.query(
          `UPDATE config SET value = value || $1::jsonb, updated_at = NOW() WHERE key = 'commissions'`,
          [JSON.stringify(patch)]
        );
      }

      if (sla) {
        await client.query(
          `UPDATE config SET value = value || $1::jsonb, updated_at = NOW() WHERE key = 'sla'`,
          [JSON.stringify(sla)]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, actor_id, changes)
         VALUES ('config_updated', $1, $2::jsonb)`,
        [req.uid, JSON.stringify(req.body).slice(0, 500)]
      );

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

async function requireAdmin(uid) {
  const r = await pool.query(
    `SELECT role FROM user_roles WHERE uid = $1 AND role = 'admin'`, [uid]
  );
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

module.exports = router;
