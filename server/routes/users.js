// ─── /api/v1/users ────────────────────────────────────────────────────────────
// Schema: users.uid = Firebase UID (TEXT PRIMARY KEY)

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');

const router = express.Router();

// GET /users/me
router.get('/me', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT u.*, array_agg(ur.role ORDER BY ur.role) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.uid = u.uid
       WHERE u.uid = $1 GROUP BY u.uid`,
      [req.uid]
    );
    if (!r.rows.length) return next(apiError(404, 'NOT_FOUND', 'User not found.'));
    res.json(toProfile(r.rows[0]));
  } catch (err) { next(err); }
});

// GET /users/:uid — self or admin
router.get('/:uid', verifyFirebaseToken, async (req, res, next) => {
  try {
    if (req.params.uid !== req.uid) await requireAdmin(req.uid);
    const r = await pool.query(
      `SELECT u.*, array_agg(ur.role ORDER BY ur.role) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.uid = u.uid
       WHERE u.uid = $1 GROUP BY u.uid`,
      [req.params.uid]
    );
    if (!r.rows.length) return next(apiError(404, 'NOT_FOUND', 'User not found.'));
    res.json(toProfile(r.rows[0]));
  } catch (err) { next(err); }
});

// GET /users
router.get('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await pool.query(
      `SELECT u.*, array_agg(ur.role ORDER BY ur.role) AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.uid = u.uid
       GROUP BY u.uid ORDER BY u.created_at DESC LIMIT $1`,
      [n]
    );
    res.json(r.rows.map(toProfile));
  } catch (err) { next(err); }
});

// POST /users — create profile right after Firebase Auth account creation
router.post('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    const {
      email, firstName, lastName, phone, pan, aadhaar,
      address, city, state, pincode, roles, primaryRole,
      authProvider, photoURL,
      panDocUrl, aadhaarDocUrl, photoDocUrl, addressDocUrl,
    } = req.body;

    if (!email) return next(apiError(400, 'INVALID_ARGUMENT', 'email required.'));
    const roleList = Array.isArray(roles) && roles.length ? roles : (primaryRole ? [primaryRole] : ['household']);
    const pRole    = primaryRole || roleList[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO users
           (uid, email, first_name, last_name, phone, pan, aadhaar,
            address, city, state, pincode, primary_role, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_kyc')
         ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()`,
        [req.uid, email, firstName||'', lastName||'', phone||'', pan||'', aadhaar||'',
         address||'', city||'', state||'', pincode||'', pRole]
      );

      for (const role of roleList) {
        await client.query(
          `INSERT INTO user_roles (uid, role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.uid, role]
        );
      }

      await client.query(
        `INSERT INTO kyc (uid, pan_doc_url, aadhaar_doc_url, photo_doc_url, address_doc_url, kyc_status)
         VALUES ($1,$2,$3,$4,$5,'submitted') ON CONFLICT DO NOTHING`,
        [req.uid, panDocUrl||'', aadhaarDocUrl||'', photoDocUrl||'', addressDocUrl||'']
      );

      // Balance rows
      await client.query(`INSERT INTO tgdp_balances (uid) VALUES ($1) ON CONFLICT DO NOTHING`, [req.uid]);
      await client.query(`INSERT INTO ftr_balances  (uid, category, balance_inr) VALUES ($1,'hospitality',0),($1,'healthcare',0),($1,'education',0),($1,'retail',0),($1,'travel',0) ON CONFLICT DO NOTHING`, [req.uid]);
      await client.query(`INSERT INTO gic_balances  (uid) VALUES ($1) ON CONFLICT DO NOTHING`, [req.uid]);

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
  // pg returns array_agg as a JS array already when there are multiple rows,
  // but as a string like "{admin}" when there's only one — normalise both.
  let roles = row.roles || [];
  if (typeof roles === 'string') {
    roles = roles.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  } else {
    roles = roles.filter(Boolean);
  }
  return {
    uid:         row.uid,
    email:       row.email,
    firstName:   row.first_name,
    lastName:    row.last_name,
    phone:       row.phone,
    pan:         row.pan,
    aadhaar:     row.aadhaar,
    address:     row.address,
    city:        row.city,
    state:       row.state,
    pincode:     row.pincode,
    primaryRole: row.primary_role,
    roles,
    status:      row.status,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

async function requireAdmin(uid) {
  const r = await pool.query(
    `SELECT role FROM user_roles WHERE uid = $1 AND role = 'admin'`, [uid]
  );
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

module.exports = router;
