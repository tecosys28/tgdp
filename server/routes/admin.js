// ─── /api/v1/admin ────────────────────────────────────────────────────────────
// All endpoints require admin role. Full master access.

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { fetchAndRefreshLBMA } = require('../helpers/lbma');

const router = express.Router();

// ─── Stats ────────────────────────────────────────────────────────────────────
// GET /admin/stats
router.get('/stats', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const [usersRes, kycRes, complaintsRes, revenueRes, tgdpRes, gicRes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query("SELECT COUNT(*) FROM kyc WHERE kyc_status = 'submitted'"),
      pool.query("SELECT COUNT(*) FROM complaints WHERE status NOT IN ('closed','resolved')"),
      pool.query("SELECT value FROM config WHERE key = 'revenue'"),
      pool.query('SELECT COALESCE(SUM(balance),0) AS total FROM tgdp_balances'),
      pool.query('SELECT COALESCE(SUM(balance),0) AS total FROM gic_balances'),
    ]);
    const rev = revenueRes.rows[0]?.value || {};
    res.json({
      totalUsers:         parseInt(usersRes.rows[0].count),
      pendingKYC:         parseInt(kycRes.rows[0].count),
      openComplaints:     parseInt(complaintsRes.rows[0].count),
      totalFTRCommission: rev.totalFTRCommission || 0,
      totalDesignRevenue: rev.totalDesignRevenue || 0,
      totalTGDPIssued:    Number(tgdpRes.rows[0].total),
      totalGICIssued:     Number(gicRes.rows[0].total),
    });
  } catch (err) { next(err); }
});

// ─── LBMA ─────────────────────────────────────────────────────────────────────
// POST /admin/lbma/refresh
router.post('/lbma/refresh', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const rate = await fetchAndRefreshLBMA();
    if (rate) res.json({ success: true, ratePerGram: rate });
    else res.status(502).json({ error: { code:'LBMA_FETCH_FAILED', message:'LBMA fetch failed — existing rate kept.', status:502 } });
  } catch (err) { next(err); }
});

// ─── Users ────────────────────────────────────────────────────────────────────
// PATCH /admin/users/:uid — edit status, roles, primary_role
router.patch('/users/:uid', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const { status, primaryRole, addRole, removeRole } = req.body;
    const targetUid = req.params.uid;

    const uRes = await pool.query('SELECT uid FROM users WHERE uid=$1', [targetUid]);
    if (!uRes.rows.length) throw apiError(404, 'NOT_FOUND', 'User not found.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (status) {
        await client.query('UPDATE users SET status=$1, updated_at=NOW() WHERE uid=$2', [status, targetUid]);
      }
      if (primaryRole) {
        await client.query('UPDATE users SET primary_role=$1, updated_at=NOW() WHERE uid=$2', [primaryRole, targetUid]);
      }
      if (addRole) {
        await client.query('INSERT INTO user_roles (uid,role) VALUES ($1,$2) ON CONFLICT DO NOTHING', [targetUid, addRole]);
      }
      if (removeRole) {
        await client.query('DELETE FROM user_roles WHERE uid=$1 AND role=$2', [targetUid, removeRole]);
      }
      await client.query(
        `INSERT INTO audit_logs (action, actor_id, target_user_id, entity_type, entity_id, changes)
         VALUES ('admin_user_edit',$1,$2,'user',$2,$3::jsonb)`,
        [req.uid, targetUid, JSON.stringify({ status, primaryRole, addRole, removeRole })]
      );
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ─── Balances (any user) ──────────────────────────────────────────────────────
// GET /admin/balances/:uid
router.get('/balances/:uid', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const uid = req.params.uid;
    const [tgdp, ftr, gic] = await Promise.all([
      pool.query('SELECT balance FROM tgdp_balances WHERE uid=$1', [uid]),
      pool.query('SELECT category, balance_inr FROM ftr_balances WHERE uid=$1', [uid]),
      pool.query('SELECT balance FROM gic_balances WHERE uid=$1', [uid]),
    ]);
    const ftrByCategory = {};
    for (const row of ftr.rows) ftrByCategory[row.category] = Number(row.balance_inr);
    res.json({
      tgdp: Number(tgdp.rows[0]?.balance || 0),
      ftr:  ftrByCategory,
      gic:  Number(gic.rows[0]?.balance || 0),
    });
  } catch (err) { next(err); }
});

// POST /admin/balances/:uid/adjust — manual balance adjustment
router.post('/balances/:uid/adjust', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const uid = req.params.uid;
    const { type, delta, reason } = req.body; // type: tgdp|gic, delta: number (+/-)
    if (!type || delta === undefined) throw apiError(400, 'INVALID_ARGUMENT', 'type and delta required.');
    if (!['tgdp','gic'].includes(type)) throw apiError(400, 'INVALID_ARGUMENT', 'type must be tgdp or gic.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (type === 'tgdp') {
        await client.query(
          `INSERT INTO tgdp_balances (uid,balance) VALUES ($1,$2)
           ON CONFLICT (uid) DO UPDATE SET balance = GREATEST(0, tgdp_balances.balance + $2), updated_at=NOW()`,
          [uid, delta]
        );
      } else {
        await client.query(
          `INSERT INTO gic_balances (uid,balance) VALUES ($1,$2)
           ON CONFLICT (uid) DO UPDATE SET balance = GREATEST(0, gic_balances.balance + $2), updated_at=NOW()`,
          [uid, delta]
        );
      }
      await client.query(
        `INSERT INTO audit_logs (action, actor_id, target_user_id, entity_type, entity_id, changes)
         VALUES ('admin_balance_adjust',$1,$2,$3,$2,$4::jsonb)`,
        [req.uid, uid, type, JSON.stringify({ delta, reason: reason || '' })]
      );
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ─── Transactions ─────────────────────────────────────────────────────────────
// GET /admin/transactions — all, or filter by ?uid=
router.get('/transactions', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n   = Math.min(parseInt(req.query.limit) || 100, 500);
    const uid = req.query.uid || null;
    let r;
    if (uid) {
      r = await pool.query(
        'SELECT * FROM tgdp_transactions WHERE from_user_id=$1 OR to_user_id=$1 ORDER BY created_at DESC LIMIT $2',
        [uid, n]
      );
    } else {
      r = await pool.query('SELECT * FROM tgdp_transactions ORDER BY created_at DESC LIMIT $1', [n]);
    }
    res.json(r.rows.map(txRow));
  } catch (err) { next(err); }
});

// ─── Earmarks (minting queue) ─────────────────────────────────────────────────
// GET /admin/earmarks — all pending or ?uid=
router.get('/earmarks', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n   = Math.min(parseInt(req.query.limit) || 100, 500);
    const uid = req.query.uid || null;
    const status = req.query.status || null;
    let where = 'WHERE 1=1';
    const params = [];
    if (uid)    { params.push(uid);    where += ` AND e.user_id=$${params.length}`; }
    if (status) { params.push(status); where += ` AND e.status=$${params.length}`; }
    params.push(n);
    const r = await pool.query(
      `SELECT e.*, u.first_name, u.last_name, u.email
       FROM earmarks e JOIN users u ON u.uid = e.user_id
       ${where} ORDER BY e.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(r.rows.map(earmarkRow));
  } catch (err) { next(err); }
});

// ─── Complaints ───────────────────────────────────────────────────────────────
// GET /admin/complaints — all complaints
router.get('/complaints', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await pool.query(
      `SELECT c.*,
              coalesce(json_agg(ct ORDER BY ct.created_at) FILTER (WHERE ct.id IS NOT NULL), '[]') AS timeline,
              u1.first_name || ' ' || u1.last_name AS complainant_name,
              u2.first_name || ' ' || u2.last_name AS respondent_name
       FROM complaints c
       LEFT JOIN complaint_timeline ct ON ct.complaint_id = c.complaint_id
       LEFT JOIN users u1 ON u1.uid = c.complainant_id
       LEFT JOIN users u2 ON u2.uid = c.respondent_id
       GROUP BY c.complaint_id, u1.first_name, u1.last_name, u2.first_name, u2.last_name
       ORDER BY c.created_at DESC LIMIT $1`,
      [n]
    );
    res.json(r.rows.map(complaintRow));
  } catch (err) { next(err); }
});

// ─── TJR Returns ──────────────────────────────────────────────────────────────
// GET /admin/tjr
router.get('/tjr', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await pool.query(
      `SELECT t.*,
              u1.first_name || ' ' || u1.last_name AS user_name,
              u2.first_name || ' ' || u2.last_name AS jeweler_name
       FROM tjr_returns t
       LEFT JOIN users u1 ON u1.uid = t.user_id
       LEFT JOIN users u2 ON u2.uid = t.jeweler_id
       ORDER BY t.created_at DESC LIMIT $1`,
      [n]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ─── TJDB Designs ─────────────────────────────────────────────────────────────
// GET /admin/designs
router.get('/designs', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await pool.query(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS designer_name
       FROM tjdb_designs d JOIN users u ON u.uid = d.designer_id
       ORDER BY d.created_at DESC LIMIT $1`,
      [n]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ─── Audit Log ────────────────────────────────────────────────────────────────
// GET /admin/audit
router.get('/audit', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 200, 1000);
    const r = await pool.query(
      `SELECT al.*,
              u.first_name || ' ' || u.last_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.uid = al.actor_id
       ORDER BY al.created_at DESC LIMIT $1`,
      [n]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ─── Config (full read) ───────────────────────────────────────────────────────
// GET /admin/config
router.get('/config', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const r = await pool.query('SELECT key, value, updated_at FROM config ORDER BY key');
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ─── Withdrawals ──────────────────────────────────────────────────────────────
// GET /admin/withdrawals
router.get('/withdrawals', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await pool.query(
      `SELECT w.*, u.first_name || ' ' || u.last_name AS user_name, u.email
       FROM tgdp_withdrawals w JOIN users u ON u.uid = w.user_id
       ORDER BY w.created_at DESC LIMIT $1`,
      [n]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// PATCH /admin/withdrawals/:id — mark complete/failed
router.patch('/withdrawals/:id', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const { status, utrNumber } = req.body;
    if (!['completed','failed'].includes(status)) throw apiError(400, 'INVALID_ARGUMENT', 'status must be completed or failed.');
    await pool.query(
      'UPDATE tgdp_withdrawals SET status=$1, utr_number=$2, updated_at=NOW() WHERE withdraw_id=$3',
      [status, utrNumber||null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GIC Credits (all licensees) ─────────────────────────────────────────────
// GET /admin/gic-credits
router.get('/gic-credits', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await pool.query(
      `SELECT gc.*, u.first_name || ' ' || u.last_name AS licensee_name
       FROM gic_credits gc JOIN users u ON u.uid = gc.licensee_id
       ORDER BY gc.created_at DESC LIMIT $1`,
      [n]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function requireAdmin(uid) {
  const r = await pool.query("SELECT role FROM user_roles WHERE uid=$1 AND role='admin'", [uid]);
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

function txRow(r) {
  return {
    id: r.tx_id, txId: r.tx_id, type: r.type,
    fromUserId: r.from_user_id, toUserId: r.to_user_id,
    amount: Number(r.amount), amountINR: r.amount_inr,
    fee: Number(r.fee||0), description: r.description, note: r.note,
    status: r.status, mintId: r.mint_id, withdrawId: r.withdraw_id,
    createdAt: r.created_at,
  };
}

function earmarkRow(r) {
  return {
    mintId: r.mint_id, userId: r.user_id, userName: `${r.first_name||''} ${r.last_name||''}`.trim(),
    email: r.email, jewelerId: r.jeweler_id,
    goldGrams: Number(r.gold_grams), purity: r.purity,
    pureGoldGrams: Number(r.pure_gold_grams), tgdpAmount: Number(r.tgdp_amount),
    valueINR: Number(r.value_inr), itemDescription: r.item_description,
    status: r.status, certIpfsHash: r.cert_ipfs_hash, blockchainTxHash: r.blockchain_tx_hash,
    createdAt: r.created_at,
  };
}

function complaintRow(r) {
  return {
    complaintId: r.complaint_id, complainantId: r.complainant_id,
    complainantName: r.complainant_name, respondentName: r.respondent_name || '—',
    portal: r.portal, category: r.category, subject: r.subject,
    status: r.status, stage: r.stage,
    ackDeadline: r.ack_deadline, resolutionDeadline: r.resolution_deadline,
    assignedOmbudsman: r.assigned_ombudsman, resolution: r.resolution_note,
    timeline: r.timeline || [], createdAt: r.created_at,
  };
}

module.exports = router;
