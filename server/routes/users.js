// ─── /api/v1/users ────────────────────────────────────────────────────────────

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /users/me ────────────────────────────────────────────────────────────
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

// ─── GET /users/:uid — self or admin ─────────────────────────────────────────
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

// ─── GET /users — admin only ──────────────────────────────────────────────────
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

// ─── POST /users — create profile after Firebase Auth account creation ────────
//
// Called in two scenarios:
//   1. Email/password registration — full form data including KYC docs
//   2. Google OAuth first sign-in  — email, displayName, photoURL only
//      (authProvider = 'google'; no KYC docs yet, status = 'pending_kyc')
//
router.post('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    const {
      email, firstName, lastName, phone, pan, aadhaar,
      address, city, state, pincode, roles, primaryRole,
      authProvider, photoURL,
      panDocUrl, aadhaarDocUrl, photoDocUrl, addressDocUrl,
    } = req.body;

    if (!email) return next(apiError(400, 'INVALID_ARGUMENT', 'email required.'));

    const provider  = authProvider || 'email';
    const roleList  = Array.isArray(roles) && roles.length ? roles : (primaryRole ? [primaryRole] : ['household']);
    const pRole     = primaryRole || roleList[0];

    // Google OAuth users skip KYC doc upload at registration.
    // They are created with status 'pending_kyc' and must submit KYC separately.
    const isOAuth   = provider === 'google';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert user row — safe for repeat calls (e.g. token refresh race)
      await client.query(
        `INSERT INTO users
           (uid, email, first_name, last_name, phone, pan, aadhaar,
            address, city, state, pincode, primary_role, status,
            auth_provider, photo_url, email_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_kyc',$13,$14,$15)
         ON CONFLICT (uid) DO UPDATE SET
           email          = EXCLUDED.email,
           photo_url      = COALESCE(EXCLUDED.photo_url, users.photo_url),
           email_verified = EXCLUDED.email_verified,
           updated_at     = NOW()`,
        [
          req.uid,
          email,
          firstName || '',
          lastName  || '',
          phone     || '',
          pan       || '',
          aadhaar   || '',
          address   || '',
          city      || '',
          state     || '',
          pincode   || '',
          pRole,
          provider,
          photoURL  || null,
          // Firebase tells us if email is verified (Google OAuth = always true)
          isOAuth || req.firebaseUser?.email_verified || false,
        ]
      );

      // Assign roles
      for (const role of roleList) {
        await client.query(
          `INSERT INTO user_roles (uid, role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.uid, role]
        );
      }

      // KYC row — Google OAuth users get an empty submitted row;
      // email users get their uploaded doc URLs.
      await client.query(
        `INSERT INTO kyc (uid, pan_doc_url, aadhaar_doc_url, photo_doc_url, address_doc_url, kyc_status)
         VALUES ($1,$2,$3,$4,$5,'submitted')
         ON CONFLICT (uid) DO NOTHING`,
        [
          req.uid,
          panDocUrl     || '',
          aadhaarDocUrl || '',
          photoDocUrl   || '',
          addressDocUrl || '',
        ]
      );

      // Balance rows — idempotent
      await client.query(
        `INSERT INTO tgdp_balances (uid) VALUES ($1) ON CONFLICT DO NOTHING`,
        [req.uid]
      );
      await client.query(
        `INSERT INTO ftr_balances (uid, category, balance_inr)
         VALUES ($1,'hospitality',0),($1,'healthcare',0),($1,'education',0),
                ($1,'retail',0),($1,'travel',0)
         ON CONFLICT DO NOTHING`,
        [req.uid]
      );
      await client.query(
        `INSERT INTO gic_balances (uid) VALUES ($1) ON CONFLICT DO NOTHING`,
        [req.uid]
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

// ─── PATCH /users/me — update own profile fields ──────────────────────────────
router.patch('/me', verifyFirebaseToken, async (req, res, next) => {
  try {
    const { phone, address, city, state, pincode } = req.body;
    await pool.query(
      `UPDATE users SET
         phone   = COALESCE($1, phone),
         address = COALESCE($2, address),
         city    = COALESCE($3, city),
         state   = COALESCE($4, state),
         pincode = COALESCE($5, pincode),
         updated_at = NOW()
       WHERE uid = $6`,
      [phone||null, address||null, city||null, state||null, pincode||null, req.uid]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function toProfile(row) {
  let roles = row.roles || [];
  if (typeof roles === 'string') {
    roles = roles.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  } else {
    roles = roles.filter(Boolean);
  }
  return {
    uid:          row.uid,
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
    photoURL:     row.photo_url,
    authProvider: row.auth_provider,
    primaryRole:  row.primary_role,
    roles,
    status:       row.status,
    emailVerified:row.email_verified,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

async function requireAdmin(uid) {
  const r = await pool.query(
    `SELECT role FROM user_roles WHERE uid = $1 AND role = 'admin'`, [uid]
  );
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
}

module.exports = router;
