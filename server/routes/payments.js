// ─── /api/v1/payments ────────────────────────────────────────────────────────
// payment_orders: id (razorpay order id), user_id → users.uid

const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { apiError }            = require('../middleware/errorHandler');
const { generateId }          = require('../helpers/generateId');

const router = express.Router();

// POST /payments/razorpay/order
router.post('/razorpay/order', verifyFirebaseToken, async (req, res, next) => {
  try {
    const { amount, purpose, metadata = {} } = req.body;
    if (!amount || amount <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'amount required');
    const VALID_PURPOSES = ['gic_license','withdrawal','design_purchase'];
    if (!VALID_PURPOSES.includes(purpose)) throw apiError(400, 'INVALID_ARGUMENT', 'invalid purpose');

    const KEY_ID     = process.env.RAZORPAY_KEY_ID;
    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
    if (!KEY_ID || !KEY_SECRET) throw apiError(503, 'NOT_CONFIGURED', 'Razorpay credentials not configured');

    const credentials = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');

    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:   Math.round(amount * 100),
        currency: 'INR',
        receipt:  `tgdp_${purpose}_${req.uid}_${Date.now()}`,
        notes:    { userId: req.uid, purpose, ...metadata },
      }),
    });
    if (!orderRes.ok) {
      console.error('[razorpay] order creation failed:', await orderRes.text());
      throw apiError(502, 'PAYMENT_FAILED', 'Payment order creation failed');
    }
    const order = await orderRes.json();

    await pool.query(
      `INSERT INTO payment_orders (id, user_id, amount, currency, purpose, status)
       VALUES ($1,$2,$3,'INR',$4,'created')`,
      [order.id, req.uid, Math.round(amount * 100), purpose]
    );

    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: KEY_ID });
  } catch (err) { next(err); }
});

// POST /payments/razorpay/verify
router.post('/razorpay/verify', verifyFirebaseToken, async (req, res, next) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    if (!orderId || !paymentId || !signature)
      throw apiError(400, 'INVALID_ARGUMENT', 'orderId, paymentId, signature required');

    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
    if (!KEY_SECRET) throw apiError(503, 'NOT_CONFIGURED', 'Razorpay credentials not configured');

    const expected = crypto.createHmac('sha256', KEY_SECRET)
      .update(`${orderId}|${paymentId}`).digest('hex');
    if (expected !== signature) throw apiError(403, 'SIGNATURE_INVALID', 'Payment signature verification failed');

    const orderRes = await pool.query('SELECT * FROM payment_orders WHERE id = $1', [orderId]);
    if (!orderRes.rows.length) throw apiError(404, 'NOT_FOUND', 'Order not found');
    const order = orderRes.rows[0];
    if (order.user_id !== req.uid) throw apiError(403, 'FORBIDDEN', 'Order does not belong to user');
    if (order.status === 'paid') return res.json({ success: true, alreadyProcessed: true });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE payment_orders SET status=$1, razorpay_payment_id=$2, razorpay_signature=$3, paid_at=NOW() WHERE id=$4',
        ['paid', paymentId, signature, orderId]
      );

      if (order.purpose === 'gic_license') {
        await client.query(
          'UPDATE users SET updated_at=NOW() WHERE uid=$1', [req.uid]
        );
        await client.query('UPDATE kyc SET kyc_hash=$1 WHERE uid=$2', [paymentId, req.uid]);

      } else if (order.purpose === 'withdrawal') {
        const withdrawId = generateId('WD');
        await client.query(
          `INSERT INTO withdrawal_requests (user_id, type, amount, amount_inr, status)
           VALUES ($1,'tgdp',$2,$2,'processing')`,
          [req.uid, order.amount]
        );
      } else if (order.purpose === 'design_purchase') {
        // Metadata not stored separately in schema — log for manual processing
        console.log('[payment] design_purchase verified, orderId:', orderId);
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
