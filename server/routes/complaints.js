// ─── /api/v1/complaints ───────────────────────────────────────────────────────
// complaints.complainant_id, respondent_id, assigned_ombudsman → users.uid
// complaint_timeline: separate table (id bigserial, complaint_id, stage, note, actor_id)

const express = require('express');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { generateId }          = require('../helpers/generateId');

const router = express.Router();

const STAGE_ORDER = ['acknowledgment','investigation','mediation','resolution','appeal','closed'];
const STAGE_DAYS  = { acknowledgment:2, investigation:7, mediation:10, resolution:14 };

// GET /complaints
router.get('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT c.*, coalesce(json_agg(ct ORDER BY ct.created_at) FILTER (WHERE ct.id IS NOT NULL), '[]') AS timeline
       FROM complaints c
       LEFT JOIN complaint_timeline ct ON ct.complaint_id = c.complaint_id
       WHERE c.complainant_id = $1
       GROUP BY c.complaint_id
       ORDER BY c.created_at DESC`,
      [req.uid]
    );
    res.json(r.rows.map(complaintRow));
  } catch (err) { next(err); }
});

// GET /complaints/open
router.get('/open', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireOmbudsmanOrAdmin(req.uid);
    const n = Math.min(parseInt(req.query.limit) || 50, 200);
    const r = await pool.query(
      `SELECT c.*, coalesce(json_agg(ct ORDER BY ct.created_at) FILTER (WHERE ct.id IS NOT NULL), '[]') AS timeline
       FROM complaints c
       LEFT JOIN complaint_timeline ct ON ct.complaint_id = c.complaint_id
       WHERE c.status IN ('filed','acknowledged','investigating','mediation')
       GROUP BY c.complaint_id
       ORDER BY c.created_at ASC LIMIT $1`,
      [n]
    );
    res.json(r.rows.map(complaintRow));
  } catch (err) { next(err); }
});

// POST /complaints
router.post('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    const { portal, category, subject, description, respondentId } = req.body;
    if (!portal || !subject || !description)
      throw apiError(400, 'INVALID_ARGUMENT', 'portal, subject, description required.');

    const complaintId = generateId('CMP');
    const ackDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const resDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO complaints
           (complaint_id, complainant_id, respondent_id, portal, category,
            subject, description, status, stage, ack_deadline, resolution_deadline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'filed','acknowledgment',$8,$9)`,
        [complaintId, req.uid, respondentId||null, portal, category||'general',
         subject, description, ackDeadline, resDeadline]
      );
      await client.query(
        `INSERT INTO complaint_timeline (complaint_id, stage, note, actor_id)
         VALUES ($1,'filed','Complaint filed by user.',$2)`,
        [complaintId, req.uid]
      );
      await client.query('COMMIT');
      res.json({ success: true, complaintId, ackDeadline: ackDeadline.toISOString() });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// PATCH /complaints/:id
router.patch('/:id', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireOmbudsmanOrAdmin(req.uid);
    const { newStage, note, resolution } = req.body;
    const complaintId = req.params.id;

    const cRes = await pool.query('SELECT * FROM complaints WHERE complaint_id = $1', [complaintId]);
    if (!cRes.rows.length) throw apiError(404, 'NOT_FOUND', 'Complaint not found.');
    const current = cRes.rows[0];

    if (newStage) {
      const curIdx = STAGE_ORDER.indexOf(current.stage);
      const newIdx = STAGE_ORDER.indexOf(newStage);
      if (newIdx === -1) throw apiError(400, 'INVALID_ARGUMENT', `Invalid stage: ${newStage}`);
      if (newIdx <= curIdx) throw apiError(422, 'STAGE_BACKWARDS', `Cannot move from '${current.stage}' to '${newStage}'`);
    }
    if ((newStage === 'resolution' || newStage === 'closed') && !resolution)
      throw apiError(400, 'INVALID_ARGUMENT', 'resolution decision required.');

    const filedAt       = new Date(current.created_at);
    const stageDays     = newStage ? STAGE_DAYS[newStage] : null;
    const stageDeadline = stageDays
      ? new Date(filedAt.getTime() + stageDays * 24 * 60 * 60 * 1000)
      : null;
    const appealDeadline= newStage === 'resolution'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      : null;

    let newStatus = current.status;
    if (newStage === 'resolution') newStatus = 'resolved';
    if (newStage === 'closed')     newStatus = 'closed';

    // Assign ombudsman if not yet assigned
    let assignedUid = current.assigned_ombudsman;
    if (!assignedUid) {
      const isOmbudsman = await pool.query(
        "SELECT role FROM user_roles WHERE uid = $1 AND role = 'ombudsman'", [req.uid]
      );
      if (isOmbudsman.rows.length) assignedUid = req.uid;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE complaints SET
           stage = COALESCE($1, stage), status = $2,
           stage_deadline = COALESCE($3, stage_deadline),
           appeal_deadline = COALESCE($4, appeal_deadline),
           resolution_note = COALESCE($5, resolution_note),
           assigned_ombudsman = COALESCE($6, assigned_ombudsman),
           updated_at = NOW()
         WHERE complaint_id = $7`,
        [newStage||null, newStatus, stageDeadline, appealDeadline,
         resolution||null, assignedUid, complaintId]
      );
      await client.query(
        `INSERT INTO complaint_timeline (complaint_id, stage, note, actor_id)
         VALUES ($1,$2,$3,$4)`,
        [complaintId, newStage||current.stage, note||'', req.uid]
      );
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function requireKYC(uid) {
  const r = await pool.query('SELECT status FROM users WHERE uid = $1', [uid]);
  if (!r.rows.length) throw apiError(404, 'NOT_FOUND', 'User not found.');
  if (r.rows[0].status !== 'active') throw apiError(422, 'KYC_REQUIRED', 'KYC verification required.');
}

async function requireOmbudsmanOrAdmin(uid) {
  const r = await pool.query(
    "SELECT role FROM user_roles WHERE uid = $1 AND role IN ('ombudsman','admin')", [uid]
  );
  if (!r.rows.length) throw apiError(403, 'PERMISSION_DENIED', 'Ombudsman or admin required.');
}

function complaintRow(r) {
  return {
    id: r.complaint_id, complaintId: r.complaint_id,
    complainantId: r.complainant_id, respondentId: r.respondent_id,
    portal: r.portal, category: r.category, subject: r.subject,
    description: r.description, status: r.status, stage: r.stage,
    ackDeadline: r.ack_deadline, resolutionDeadline: r.resolution_deadline,
    stageDeadline: r.stage_deadline, appealDeadline: r.appeal_deadline,
    assignedOmbudsman: r.assigned_ombudsman,
    resolution: r.resolution_note, timeline: r.timeline || [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

module.exports = router;
