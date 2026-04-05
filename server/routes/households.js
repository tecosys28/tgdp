// ─── /api/v1/households ───────────────────────────────────────────────────────
// household_links: link_id, household_id→users.uid, licensee_id→users.uid

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { generateId }          = require('../helpers/generateId');
const { creditGIC }           = require('./gic');

const router = express.Router();

// GET /households
router.get('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT hl.link_id, hl.linked_at,
              u.uid, u.first_name, u.last_name, u.email, u.phone, u.status, u.primary_role
       FROM household_links hl
       JOIN users u ON u.uid = hl.household_id
       WHERE hl.licensee_id = $1 AND hl.status = 'active'`,
      [req.uid]
    );
    res.json(r.rows.map(r => ({
      linkId: r.link_id, linkedAt: r.linked_at,
      uid: r.uid, firstName: r.first_name, lastName: r.last_name,
      email: r.email, phone: r.phone, status: r.status, primaryRole: r.primary_role,
    })));
  } catch (err) { next(err); }
});

// POST /households/link
router.post('/link', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    await requireRole(req.uid, 'licensee');

    const { householdUserId } = req.body;
    if (!householdUserId) throw apiError(400, 'INVALID_ARGUMENT', 'householdUserId required.');

    // Verify target is a household
    const hRes = await pool.query(
      `SELECT u.uid FROM users u JOIN user_roles ur ON ur.uid = u.uid
       WHERE u.uid = $1 AND ur.role = 'household'`,
      [householdUserId]
    );
    if (!hRes.rows.length) throw apiError(422, 'NOT_HOUSEHOLD', 'Target user is not a household.');

    // Already linked?
    const existing = await pool.query(
      "SELECT link_id FROM household_links WHERE household_id = $1 AND status = 'active'",
      [householdUserId]
    );
    if (existing.rows.length) throw apiError(409, 'ALREADY_LINKED', 'Household already linked to a licensee.');

    const linkId = generateId('LINK');
    await pool.query(
      `INSERT INTO household_links (link_id, household_id, licensee_id, status)
       VALUES ($1,$2,$3,'active')`,
      [linkId, householdUserId, req.uid]
    );

    // Auto-credit GIC (25% of ₹300 registration fee = ₹75)
    await creditGIC(req.uid, 'registration', 75, linkId).catch(e => {
      console.warn('[gic] Auto-credit failed (non-fatal):', e.message);
    });

    res.json({ success: true, linkId });
  } catch (err) { next(err); }
});

async function requireKYC(uid) {
  const r = await pool.query('SELECT status FROM users WHERE uid = $1', [uid]);
  if (!r.rows.length) throw apiError(404, 'NOT_FOUND', 'User not found.');
  if (r.rows[0].status !== 'active') throw apiError(422, 'KYC_REQUIRED', 'KYC verification required.');
}

async function requireRole(uid, role) {
  const r = await pool.query('SELECT role FROM user_roles WHERE uid = $1 AND role = $2', [uid, role]);
  if (!r.rows.length) throw apiError(403, 'PERMISSION_DENIED', `Role '${role}' required.`);
}

module.exports = router;
