// ─── /api/v1/kyc ─────────────────────────────────────────────────────────────
// kyc.uid (PK = users.uid), reviewed_by → users.uid

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { pinJSONToIPFS }       = require('../helpers/ipfs');

const router = express.Router();

const ROLE_INCOMPATIBILITIES = {
  ombudsman: ['licensee','household','jeweler','designer','returnee','consultant','advertiser'],
  jeweler:   ['household','returnee','designer','consultant','licensee'],
  household: ['jeweler'], returnee: ['jeweler'], designer: ['jeweler'],
  consultant:['jeweler'], licensee: ['jeweler'],
};

function rolesCompatible(roles) {
  if (!roles || !roles.length) return true;
  for (const r of roles) {
    const blocked = ROLE_INCOMPATIBILITIES[r] || [];
    for (const o of roles) {
      if (r !== o && blocked.includes(o)) return false;
    }
  }
  return true;
}

// GET /kyc/pending
router.get('/pending', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const r = await pool.query(
      `SELECT k.*, u.first_name, u.last_name, u.email,
              array_agg(ur.role ORDER BY ur.role) AS roles
       FROM kyc k
       JOIN users u ON u.uid = k.uid
       LEFT JOIN user_roles ur ON ur.uid = k.uid
       WHERE k.kyc_status = 'submitted'
       GROUP BY k.uid, u.first_name, u.last_name, u.email
       ORDER BY k.submitted_at ASC`
    );
    res.json(r.rows.map(kycRow));
  } catch (err) { next(err); }
});

// POST /kyc/approve
router.post('/approve', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const { targetUserId, approved, notes } = req.body;
    if (!targetUserId) throw apiError(400, 'INVALID_ARGUMENT', 'targetUserId required.');

    if (approved) {
      const rRes = await pool.query(
        'SELECT array_agg(role) AS roles FROM user_roles WHERE uid = $1',
        [targetUserId]
      );
      const roles = (rRes.rows[0]?.roles || []).filter(Boolean);
      if (!rolesCompatible(roles))
        throw apiError(422, 'INCOMPATIBLE_ROLES',
          `Incompatible roles [${roles.join(', ')}]. Fix before approving.`);
    }

    const uRes = await pool.query('SELECT uid FROM users WHERE uid = $1', [targetUserId]);
    if (!uRes.rows.length) throw apiError(404, 'NOT_FOUND', 'User not found.');

    const newStatus    = approved ? 'active' : 'rejected';
    const newKycStatus = approved ? 'approved' : 'rejected';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET status=$1, updated_at=NOW() WHERE uid=$2', [newStatus, targetUserId]);
      await client.query(
        'UPDATE kyc SET kyc_status=$1, reviewed_at=NOW(), reviewed_by=$2, notes=$3 WHERE uid=$4',
        [newKycStatus, req.uid, notes||'', targetUserId]
      );
      await client.query(
        `INSERT INTO audit_logs (action, actor_id, target_user_id, entity_type, entity_id, changes)
         VALUES ($1,$2,$3,'kyc',$3,$4::jsonb)`,
        [approved ? 'kyc_approved' : 'kyc_rejected', req.uid, targetUserId, JSON.stringify({ notes })]
      );
      await client.query('COMMIT');

      if (approved) {
        const ipfsResult = await pinJSONToIPFS({
          event: 'kyc_approved', userId: targetUserId, approvedBy: req.uid,
          approvedAt: new Date().toISOString(), platform: 'TGDP Ecosystem — TROT Gold Pvt. Ltd.',
        }, `kyc-approval-${targetUserId}`, { userId: targetUserId, event: 'kyc_approved' });
        if (ipfsResult) {
          await pool.query(
            'UPDATE kyc SET kyc_ipfs_hash=$1, kyc_ipfs_uri=$2 WHERE uid=$3',
            [ipfsResult.ipfsHash, ipfsResult.metadataUri, targetUserId]
          );
        }
      }

      res.json({ success: true, status: newStatus });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

async function requireAdmin(uid) {
  const r = await pool.query("SELECT role FROM user_roles WHERE uid = $1 AND role = 'admin'", [uid]);
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

function normaliseRoles(roles) {
  if (!roles) return [];
  if (typeof roles === 'string') return roles.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  return roles.filter(Boolean);
}

function kycRow(r) {
  return {
    uid: r.uid, firstName: r.first_name, lastName: r.last_name, email: r.email,
    roles: normaliseRoles(r.roles),
    panDocUrl: r.pan_doc_url, aadhaarDocUrl: r.aadhaar_doc_url,
    photoDocUrl: r.photo_doc_url, addressDocUrl: r.address_doc_url,
    kycStatus: r.kyc_status, submittedAt: r.submitted_at, notes: r.notes,
    kycIpfsHash: r.kyc_ipfs_hash,
  };
}

module.exports = router;
