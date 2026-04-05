// ─── /api/v1/users ────────────────────────────────────────────────────────────

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');

const router = express.Router();

// GET /users/me — current user profile
router.get('/me', verifyFirebaseToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.*, array_agg(ur.role ORDER BY ur.role) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.firebase_uid = $1
       GROUP BY u.id`,
      [req.uid]
    );
    if (!result.rows.length) return next(apiError(404, 'NOT_FOUND', 'User not found.'));
    res.json(toProfile(result.rows[0]));
  } catch (err) { next(err); }
});

// GET /users/:uid — any user profile (admin or self)
router.get('/:uid', verifyFirebaseToken, async (req, res, next) => {
  try {
    // Allow self-lookup or admin
    const me = await pool.query(
      `SELECT u.id, array_agg(ur.role) AS roles FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.firebase_uid = $1 GROUP BY u.id`,
      [req.uid]
    );
    const myRoles = me.rows[0]?.roles || [];
    if (req.params.uid !== req.uid && !myRoles.includes('admin')) {
      return next(apiError(403, 'FORBIDDEN', 'Admin access required.'));
    }
    const result = await pool.query(
      `SELECT u.*, array_agg(ur.role ORDER BY ur.role) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.firebase_uid = $1
       GROUP BY u.id`,
      [req.params.uid]
    );
    if (!result.rows.length) return next(apiError(404, 'NOT_FOUND', 'User not found.'));
    res.json(toProfile(result.rows[0]));
  } catch (err) { next(err); }
});

// GET /users — all users (admin only), with optional ?limit=100
router.get('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 100, 500);
    const result = await pool.query(
      `SELECT u.*, array_agg(ur.role ORDER BY ur.role) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $1`,
      [n]
    );
    res.json(result.rows.map(toProfile));
  } catch (err) { next(err); }
});

// POST /users — create user profile (called right after Firebase Auth account creation)
// No auth token required yet (user just created their account)
router.post('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    const {
      email, firstName, lastName, phone, pan, aadhaar,
      address, city, state, pincode,
      roles, primaryRole, authProvider, photoURL,
      panDocUrl, aadhaarDocUrl, photoDocUrl, addressDocUrl,
    } = req.body;

    if (!email) return next(apiError(400, 'INVALID_ARGUMENT', 'email required.'));

    const roleList = Array.isArray(roles) && roles.length > 0 ? roles : (primaryRole ? [primaryRole] : ['household']);
    const pRole    = primaryRole || roleList[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert user row
      const uRes = await client.query(
        `INSERT INTO users
           (firebase_uid, email, first_name, last_name, phone, pan, aadhaar,
            address, city, state, pincode, primary_role, status,
            auth_provider, photo_url, email_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_kyc',$13,$14,false)
         ON CONFLICT (firebase_uid) DO UPDATE SET
           email          = EXCLUDED.email,
           updated_at     = NOW()
         RETURNING id`,
        [req.uid, email, firstName||'', lastName||'', phone||'', pan||'', aadhaar||'',
         address||'', city||'', state||'', pincode||'', pRole,
         authProvider||'email', photoURL||'']
      );
      const userId = uRes.rows[0].id;

      // Insert roles
      for (const role of roleList) {
        await client.query(
          `INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, role]
        );
      }

      // Insert KYC record
      await client.query(
        `INSERT INTO kyc
           (user_id, pan_doc_url, aadhaar_doc_url, photo_doc_url, address_doc_url, kyc_status)
         VALUES ($1,$2,$3,$4,$5,'submitted')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, panDocUrl||'', aadhaarDocUrl||'', photoDocUrl||'', addressDocUrl||'']
      );

      // Create balance rows
      await client.query(
        `INSERT INTO tgdp_balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]
      );
      await client.query(
        `INSERT INTO ftr_balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]
      );
      await client.query(
        `INSERT INTO gic_balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]
      );

      await client.query('COMMIT');
      res.status(201).json({ success: true, uid: req.uid, primaryRole: pRole });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function toProfile(row) {
  return {
    uid:          row.firebase_uid,
    email:        row.email,
    firstName:    row.first_name,
    lastName:     row.last_name,
    phone:        row.phone,
    pan:          row.pan,
    aadhaar:      row.aadhaar,
    address:      row.address,
    city:         row.city,
    state:        row.state,
    pincode:      row.pincode,
    primaryRole:  row.primary_role,
    roles:        row.roles?.filter(Boolean) || [],
    status:       row.status,
    authProvider: row.auth_provider,
    photoURL:     row.photo_url,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

async function requireAdmin(uid) {
  const res = await pool.query(
    `SELECT ur.role FROM users u JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.firebase_uid = $1 AND ur.role = 'admin'`,
    [uid]
  );
  if (!res.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

module.exports = router;
