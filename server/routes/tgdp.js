// ─── /api/v1/tgdp — TGDP balance operations ──────────────────────────────────

const express  = require('express');
const pool     = require('../db');
const { verifyFirebaseToken }  = require('../middleware/auth');
const { apiError }             = require('../middleware/errorHandler');
const { generateId }           = require('../helpers/generateId');
const { getLBMARate }          = require('../helpers/lbma');
const { pinJSONToIPFS }        = require('../helpers/ipfs');
const { recordOnChain, ethers} = require('../helpers/blockchain');

const router = express.Router();

// ─── GET /tgdp/transactions ───────────────────────────────────────────────────
router.get('/transactions', verifyFirebaseToken, async (req, res, next) => {
  try {
    const userId = await getUserId(req.uid);
    if (!userId) return res.json([]);
    const n = Math.min(parseInt(req.query.limit) || 20, 200);
    const r = await pool.query(
      `SELECT * FROM tgdp_transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, n]
    );
    res.json(r.rows.map(txRow));
  } catch (err) { next(err); }
});

// ─── GET /tgdp/earmarks ───────────────────────────────────────────────────────
router.get('/earmarks', verifyFirebaseToken, async (req, res, next) => {
  try {
    const userId = await getUserId(req.uid);
    if (!userId) return res.json([]);
    const r = await pool.query(
      `SELECT * FROM earmarks WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json(r.rows.map(earmarkRow));
  } catch (err) { next(err); }
});

// ─── POST /tgdp/mint ─────────────────────────────────────────────────────────
router.post('/mint', verifyFirebaseToken, async (req, res, next) => {
  try {
    const userId = await requireKYC(req.uid);
    await requireRole(req.uid, 'household');

    const { goldGrams, purity, itemDescription, jewelerId } = req.body;
    if (!goldGrams || goldGrams <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'goldGrams must be > 0.');
    if (![999, 916, 875, 750, 585, 417].includes(Number(purity)))
      throw apiError(400, 'INVALID_ARGUMENT', 'Invalid purity value.');

    const purityFactor  = purity / 1000;
    const pureGoldGrams = goldGrams * purityFactor;
    const tgdpAmount    = Math.floor(pureGoldGrams * 10);
    const rate          = await getLBMARate();
    const valueINR      = Math.round(pureGoldGrams * rate);
    const mintId        = generateId('MINT');

    // Find jeweler user_id if provided
    let jewelerUserId = null;
    if (jewelerId) {
      const jRes = await pool.query('SELECT id FROM users WHERE firebase_uid = $1', [jewelerId]);
      jewelerUserId = jRes.rows[0]?.id || null;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO earmarks
           (mint_id, user_id, jeweler_user_id, gold_grams, purity, pure_gold_grams,
            tgdp_amount, value_inr, item_description, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_verification')`,
        [mintId, userId, jewelerUserId, goldGrams, purity, pureGoldGrams,
         tgdpAmount, valueINR, itemDescription || '']
      );

      await client.query(
        `INSERT INTO audit_logs (action, target_user_id, changes)
         VALUES ('mint_requested', $1, $2)`,
        [userId, JSON.stringify({ mintId, tgdpAmount, goldGrams, purity })]
      );

      await client.query('COMMIT');
      res.json({ success: true, mintId, tgdpAmount, status: 'pending_verification' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/mint/:mintId/confirm ────────────────────────────────────────
router.post('/mint/:mintId/confirm', verifyFirebaseToken, async (req, res, next) => {
  try {
    const adminUserId = await requireAdmin(req.uid);
    const { mintId } = req.params;
    const { approved, rejectionReason } = req.body;

    const earmarkRes = await pool.query(
      `SELECT e.*, u.firebase_uid AS owner_firebase_uid
       FROM earmarks e JOIN users u ON u.id = e.user_id
       WHERE e.mint_id = $1`, [mintId]
    );
    if (!earmarkRes.rows.length) throw apiError(404, 'NOT_FOUND', 'Earmark not found.');
    const earmark = earmarkRes.rows[0];
    if (earmark.status !== 'pending_verification')
      throw apiError(422, 'ALREADY_PROCESSED', 'Earmark already processed.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (approved) {
        // Credit TGDP balance
        await client.query(
          `INSERT INTO tgdp_balances (user_id, balance) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET balance = tgdp_balances.balance + $2, updated_at = NOW()`,
          [earmark.user_id, earmark.tgdp_amount]
        );

        const txId = generateId('TX');
        await client.query(
          `INSERT INTO tgdp_transactions
             (tx_id, tx_type, user_id, amount, gold_grams, purity, description, status, mint_id)
           VALUES ($1,'mint',$2,$3,$4,$5,$6,'completed',$7)`,
          [txId, earmark.user_id, earmark.tgdp_amount, earmark.gold_grams,
           earmark.purity, `Gold minted: ${earmark.item_description}`, mintId]
        );

        await client.query(
          `UPDATE earmarks SET status='active', approved_by=$1, approved_at=NOW(), updated_at=NOW()
           WHERE mint_id=$2`,
          [adminUserId, mintId]
        );
      } else {
        await client.query(
          `UPDATE earmarks SET status='rejected', rejection_reason=$1, updated_at=NOW()
           WHERE mint_id=$2`,
          [rejectionReason || '', mintId]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, admin_user_id, target_user_id, changes)
         VALUES ($1, $2, $3, $4)`,
        [approved ? 'mint_approved' : 'mint_rejected', adminUserId,
         earmark.user_id, JSON.stringify({ mintId })]
      );

      await client.query('COMMIT');

      // IPFS + blockchain (non-fatal, after commit)
      if (approved) {
        const certRecord = {
          event: 'gold_earmarked', mintId,
          userId: earmark.owner_firebase_uid,
          goldGrams: earmark.gold_grams, purity: earmark.purity,
          pureGoldGrams: earmark.pure_gold_grams, tgdpAmount: earmark.tgdp_amount,
          itemDescription: earmark.item_description || '',
          approvedBy: req.uid, approvedAt: new Date().toISOString(),
          platform: 'TGDP Ecosystem — TROT Gold Pvt. Ltd.',
        };
        const certIPFS = await pinJSONToIPFS(certRecord, `purity-cert-${mintId}`,
          { mintId, userId: earmark.owner_firebase_uid, event: 'gold_earmarked' });
        if (certIPFS) {
          await pool.query(
            `UPDATE earmarks SET cert_ipfs_hash=$1, cert_ipfs_uri=$2 WHERE mint_id=$3`,
            [certIPFS.ipfsHash, certIPFS.metadataUri, mintId]
          );
        }

        const goldMilligrams = Math.round(earmark.pure_gold_grams * 1000);
        const certIpfsHash   = certIPFS?.ipfsHash;
        const certHash       = certIpfsHash
          ? ethers.keccak256(ethers.toUtf8Bytes(certIpfsHash))
          : ethers.keccak256(ethers.toUtf8Bytes(mintId));
        const tgdpWei = ethers.parseUnits(String(earmark.tgdp_amount), 18);

        await recordOnChain('earmarkGold', async (signer, addr) => {
          const REGISTRY_ABI = ['function earmarkGold(address owner, bytes32 certificateHash, uint256 pureGoldMilligrams, uint256 tgdpAmount) returns (bytes32)'];
          const registry = new ethers.Contract(addr.registry, REGISTRY_ABI, signer);
          const tx = await registry.earmarkGold(earmark.owner_firebase_uid, certHash, BigInt(goldMilligrams), tgdpWei);
          const receipt = await tx.wait();
          return { txHash: receipt.hash };
        }, async (txHash) => {
          await pool.query(
            `UPDATE earmarks SET blockchain_tx_hash=$1, blockchain_network=$2, blockchain_recorded_at=NOW() WHERE mint_id=$3`,
            [txHash, process.env.POLYGON_NETWORK || 'amoy', mintId]
          );
        });
      }

      res.json({ success: true, approved });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/trade ────────────────────────────────────────────────────────
router.post('/trade', verifyFirebaseToken, async (req, res, next) => {
  try {
    const userId = await requireKYC(req.uid);
    await requireRole(req.uid, 'household');

    const { toUserId: toFirebaseUid, amount, note } = req.body;
    if (!toFirebaseUid || toFirebaseUid === req.uid)
      throw apiError(400, 'INVALID_ARGUMENT', 'Invalid recipient.');
    if (!amount || amount <= 0)
      throw apiError(400, 'INVALID_ARGUMENT', 'Amount must be > 0.');

    // Verify recipient exists and is active
    const recipRes = await pool.query(
      `SELECT id, status FROM users WHERE firebase_uid = $1`, [toFirebaseUid]
    );
    if (!recipRes.rows.length) throw apiError(404, 'NOT_FOUND', 'Recipient not found.');
    if (recipRes.rows[0].status !== 'active')
      throw apiError(422, 'RECIPIENT_INACTIVE', 'Recipient not active.');

    const recipientUserId = recipRes.rows[0].id;
    const txId = generateId('TRADE');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock sender balance
      const balRes = await client.query(
        `SELECT balance FROM tgdp_balances WHERE user_id = $1 FOR UPDATE`, [userId]
      );
      const balance = balRes.rows[0]?.balance || 0;
      if (balance < amount) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient TGDP balance.');

      await client.query(
        `UPDATE tgdp_balances SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2`,
        [amount, userId]
      );
      await client.query(
        `INSERT INTO tgdp_balances (user_id, balance) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET balance = tgdp_balances.balance + $2, updated_at = NOW()`,
        [recipientUserId, amount]
      );
      await client.query(
        `INSERT INTO tgdp_transactions (tx_id, tx_type, user_id, from_user_id, to_user_id, amount, fee, note, status)
         VALUES ($1,'trade',$2,$2,$3,$4,0,$5,'completed')`,
        [txId, userId, recipientUserId, amount, note || '']
      );

      await client.query('COMMIT');
      res.json({ success: true, txId, amount });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/swap (TGDP → FTR, 4% commission) ────────────────────────────
router.post('/swap', verifyFirebaseToken, async (req, res, next) => {
  try {
    const userId = await requireKYC(req.uid);
    await requireRole(req.uid, 'household');

    const { tgdpAmount, ftrCategory } = req.body;
    if (!tgdpAmount || tgdpAmount <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'tgdpAmount must be > 0.');
    if (![1,2,3,4,5].includes(Number(ftrCategory))) throw apiError(400, 'INVALID_ARGUMENT', 'ftrCategory must be 1–5.');

    const FTR_COMMISSION = 0.04;
    const commission     = Math.round(tgdpAmount * FTR_COMMISSION);
    const ftrAmount      = tgdpAmount - commission;
    const rate           = await getLBMARate();
    const ftrValueINR    = Math.round((ftrAmount / 10) * rate);
    const expiryDate     = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const swapId = generateId('SWAP');
    const catCol = `cat_${ftrCategory}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const balRes = await client.query(
        `SELECT balance FROM tgdp_balances WHERE user_id = $1 FOR UPDATE`, [userId]
      );
      const balance = balRes.rows[0]?.balance || 0;
      if (balance < tgdpAmount) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient TGDP balance.');

      await client.query(
        `UPDATE tgdp_balances SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2`,
        [tgdpAmount, userId]
      );
      await client.query(
        `INSERT INTO ftr_balances (user_id, ${catCol}) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET ${catCol} = ftr_balances.${catCol} + $2, updated_at = NOW()`,
        [userId, ftrValueINR]
      );
      await client.query(
        `INSERT INTO ftr_swaps
           (swap_id, user_id, tgdp_amount, commission, ftr_amount, ftr_value_inr, ftr_category, expiry_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
        [swapId, userId, tgdpAmount, commission, ftrAmount, ftrValueINR, ftrCategory, expiryDate]
      );
      // Update platform revenue
      await client.query(
        `UPDATE config SET value = value || jsonb_build_object(
           'totalFTRCommission', COALESCE((value->>'totalFTRCommission')::numeric, 0) + $1,
           'updatedAt', NOW()::text
         ), updated_at = NOW() WHERE key = 'revenue'`,
        [commission]
      );

      await client.query('COMMIT');
      res.json({ success: true, swapId, ftrAmount, ftrValueINR, commission, expiryDate: expiryDate.toISOString() });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/withdraw ─────────────────────────────────────────────────────
router.post('/withdraw', verifyFirebaseToken, async (req, res, next) => {
  try {
    const userId = await requireKYC(req.uid);
    await requireRole(req.uid, 'household');

    const { tgdpAmount, bankAccountNumber, ifscCode, accountHolderName } = req.body;
    if (!tgdpAmount || tgdpAmount <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'tgdpAmount must be > 0.');
    if (!bankAccountNumber || !ifscCode) throw apiError(400, 'INVALID_ARGUMENT', 'Bank details required.');

    const rate       = await getLBMARate();
    const pureGrams  = tgdpAmount / 10;
    const amountINR  = Math.round(pureGrams * rate);
    const withdrawId = generateId('WD');
    const txId       = generateId('TX');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const balRes = await client.query(
        `SELECT balance FROM tgdp_balances WHERE user_id = $1 FOR UPDATE`, [userId]
      );
      const balance = balRes.rows[0]?.balance || 0;
      if (balance < tgdpAmount) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient TGDP balance.');

      await client.query(
        `UPDATE tgdp_balances SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2`,
        [tgdpAmount, userId]
      );
      await client.query(
        `INSERT INTO tgdp_withdrawals
           (withdraw_id, user_id, tgdp_amount, amount_inr, rate_per_gram,
            bank_account_number, ifsc_code, account_holder_name, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'processing')`,
        [withdrawId, userId, tgdpAmount, amountINR, rate,
         bankAccountNumber, ifscCode, accountHolderName || '']
      );
      await client.query(
        `INSERT INTO tgdp_transactions
           (tx_id, tx_type, user_id, amount, amount_inr, description, status, withdraw_id)
         VALUES ($1,'withdrawal',$2,$3,$4,$5,'processing',$6)`,
        [txId, userId, -tgdpAmount, amountINR,
         `Withdrawal to ****${bankAccountNumber.slice(-4)}`, withdrawId]
      );

      await client.query('COMMIT');
      res.json({ success: true, withdrawId, amountINR, status: 'processing' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getUserId(firebaseUid) {
  const r = await pool.query('SELECT id FROM users WHERE firebase_uid = $1', [firebaseUid]);
  return r.rows[0]?.id || null;
}

async function requireKYC(firebaseUid) {
  const r = await pool.query(
    'SELECT id, status FROM users WHERE firebase_uid = $1', [firebaseUid]
  );
  if (!r.rows.length) throw apiError(404, 'NOT_FOUND', 'User not found.');
  if (r.rows[0].status !== 'active')
    throw apiError(422, 'KYC_REQUIRED', 'KYC verification required before this action.');
  return r.rows[0].id;
}

async function requireRole(firebaseUid, role) {
  const r = await pool.query(
    `SELECT ur.role FROM users u JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.firebase_uid = $1 AND ur.role = $2`,
    [firebaseUid, role]
  );
  if (!r.rows.length) throw apiError(403, 'PERMISSION_DENIED', `Role '${role}' required.`);
}

async function requireAdmin(firebaseUid) {
  const r = await pool.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.firebase_uid = $1 AND ur.role = 'admin'`,
    [firebaseUid]
  );
  if (!r.rows.length) throw apiError(403, 'FORBIDDEN', 'Admin access required.');
  return r.rows[0].id;
}

function txRow(r) {
  return {
    id: r.tx_id, txId: r.tx_id, type: r.tx_type,
    userId: r.firebase_uid, amount: r.amount, amountINR: r.amount_inr,
    goldGrams: r.gold_grams, purity: r.purity,
    description: r.description, status: r.status,
    fromUserId: r.from_user_id, toUserId: r.to_user_id,
    mintId: r.mint_id, withdrawId: r.withdraw_id,
    createdAt: r.created_at,
  };
}

function earmarkRow(r) {
  return {
    id: r.mint_id, mintId: r.mint_id, userId: r.firebase_uid,
    goldGrams: r.gold_grams, purity: r.purity, pureGoldGrams: r.pure_gold_grams,
    tgdpAmount: r.tgdp_amount, valueINR: r.value_inr,
    itemDescription: r.item_description, status: r.status,
    certIpfsHash: r.cert_ipfs_hash, certIpfsUri: r.cert_ipfs_uri,
    blockchainTxHash: r.blockchain_tx_hash,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

module.exports = router;
