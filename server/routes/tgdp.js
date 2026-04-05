// ─── /api/v1/tgdp ────────────────────────────────────────────────────────────
// Schema: users.uid, earmarks.user_id→users.uid, tgdp_balances.uid, tgdp_transactions.*

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
    const n = Math.min(parseInt(req.query.limit) || 20, 200);
    // transactions where the user is sender or receiver
    const r = await pool.query(
      `SELECT * FROM tgdp_transactions
       WHERE from_user_id = $1 OR to_user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [req.uid, n]
    );
    res.json(r.rows.map(txRow));
  } catch (err) { next(err); }
});

// ─── GET /tgdp/earmarks ───────────────────────────────────────────────────────
router.get('/earmarks', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM earmarks WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.uid]
    );
    res.json(r.rows.map(earmarkRow));
  } catch (err) { next(err); }
});

// ─── POST /tgdp/mint ─────────────────────────────────────────────────────────
router.post('/mint', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    await requireRole(req.uid, 'household');

    const { goldGrams, purity, itemDescription, jewelerId } = req.body;
    if (!goldGrams || goldGrams <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'goldGrams must be > 0.');
    if (![999,916,875,750,585,417].includes(Number(purity)))
      throw apiError(400, 'INVALID_ARGUMENT', 'Invalid purity value.');

    const purityFactor  = purity / 1000;
    const pureGoldGrams = goldGrams * purityFactor;
    const tgdpAmount    = Math.floor(pureGoldGrams * 10);
    const rate          = await getLBMARate();
    const valueINR      = Math.round(pureGoldGrams * rate);
    const mintId        = generateId('MINT');

    // jewelerId is a Firebase UID string
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO earmarks
           (mint_id, user_id, jeweler_id, gold_grams, purity, pure_gold_grams,
            tgdp_amount, value_inr, item_description, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_verification')`,
        [mintId, req.uid, jewelerId||null, goldGrams, purity, pureGoldGrams,
         tgdpAmount, valueINR, itemDescription||'']
      );
      await client.query(
        `INSERT INTO audit_logs (action, actor_id, target_user_id, entity_type, entity_id, changes)
         VALUES ('mint_requested',$1,$1,'earmark',$2,$3::jsonb)`,
        [req.uid, mintId, JSON.stringify({ tgdpAmount, goldGrams, purity })]
      );
      await client.query('COMMIT');
      res.json({ success: true, mintId, tgdpAmount, status: 'pending_verification' });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/mint/:mintId/confirm ─────────────────────────────────────────
router.post('/mint/:mintId/confirm', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireAdmin(req.uid);
    const { mintId } = req.params;
    const { approved, rejectionReason } = req.body;

    const eRes = await pool.query(`SELECT * FROM earmarks WHERE mint_id = $1`, [mintId]);
    if (!eRes.rows.length) throw apiError(404, 'NOT_FOUND', 'Earmark not found.');
    const earmark = eRes.rows[0];
    if (earmark.status !== 'pending_verification')
      throw apiError(422, 'ALREADY_PROCESSED', 'Earmark already processed.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (approved) {
        await client.query(
          `INSERT INTO tgdp_balances (uid, balance) VALUES ($1,$2)
           ON CONFLICT (uid) DO UPDATE SET balance = tgdp_balances.balance + $2, updated_at = NOW()`,
          [earmark.user_id, earmark.tgdp_amount]
        );
        const txId = generateId('TX');
        await client.query(
          `INSERT INTO tgdp_transactions
             (tx_id, type, from_user_id, to_user_id, amount, description, status, mint_id)
           VALUES ($1,'mint',$2,$2,$3,$4,'completed',$5)`,
          [txId, earmark.user_id, earmark.tgdp_amount,
           `Gold minted: ${earmark.item_description}`, mintId]
        );
        await client.query(
          `UPDATE earmarks SET status='active', approved_by=$1, approved_at=NOW(), updated_at=NOW()
           WHERE mint_id=$2`,
          [req.uid, mintId]
        );
      } else {
        await client.query(
          `UPDATE earmarks SET status='rejected', rejection_reason=$1, updated_at=NOW()
           WHERE mint_id=$2`,
          [rejectionReason||'', mintId]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (action, actor_id, target_user_id, entity_type, entity_id)
         VALUES ($1,$2,$3,'earmark',$4)`,
        [approved ? 'mint_approved' : 'mint_rejected', req.uid, earmark.user_id, mintId]
      );

      await client.query('COMMIT');

      // Post-commit: IPFS + blockchain (best-effort)
      if (approved) {
        const certRecord = {
          event: 'gold_earmarked', mintId, userId: earmark.user_id,
          goldGrams: earmark.gold_grams, purity: earmark.purity,
          pureGoldGrams: earmark.pure_gold_grams, tgdpAmount: earmark.tgdp_amount,
          itemDescription: earmark.item_description||'',
          approvedBy: req.uid, approvedAt: new Date().toISOString(),
          platform: 'TGDP Ecosystem — TROT Gold Pvt. Ltd.',
        };
        const certIPFS = await pinJSONToIPFS(certRecord, `purity-cert-${mintId}`,
          { mintId, userId: earmark.user_id, event: 'gold_earmarked' });
        if (certIPFS) {
          await pool.query(
            `UPDATE earmarks SET cert_ipfs_hash=$1, cert_ipfs_uri=$2 WHERE mint_id=$3`,
            [certIPFS.ipfsHash, certIPFS.metadataUri, mintId]
          );
        }

        const certHash = certIPFS
          ? ethers.keccak256(ethers.toUtf8Bytes(certIPFS.ipfsHash))
          : ethers.keccak256(ethers.toUtf8Bytes(mintId));
        const goldMilligrams = Math.round(Number(earmark.pure_gold_grams) * 1000);
        const tgdpWei = ethers.parseUnits(String(earmark.tgdp_amount), 18);

        await recordOnChain('earmarkGold', async (signer, addr) => {
          const ABI = ['function earmarkGold(address owner, bytes32 certificateHash, uint256 pureGoldMilligrams, uint256 tgdpAmount) returns (bytes32)'];
          const registry = new ethers.Contract(addr.registry, ABI, signer);
          const tx = await registry.earmarkGold(earmark.user_id, certHash, BigInt(goldMilligrams), tgdpWei);
          const receipt = await tx.wait();
          return { txHash: receipt.hash };
        }, async (txHash) => {
          await pool.query(
            `UPDATE earmarks SET blockchain_tx_hash=$1, blockchain_network=$2, blockchain_recorded_at=NOW() WHERE mint_id=$3`,
            [txHash, process.env.POLYGON_NETWORK||'amoy', mintId]
          );
        });
      }

      res.json({ success: true, approved });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/trade ────────────────────────────────────────────────────────
router.post('/trade', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    await requireRole(req.uid, 'household');

    const { toUserId, amount, note } = req.body;
    if (!toUserId || toUserId === req.uid) throw apiError(400, 'INVALID_ARGUMENT', 'Invalid recipient.');
    if (!amount || amount <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'Amount must be > 0.');

    const recipRes = await pool.query('SELECT uid, status FROM users WHERE uid = $1', [toUserId]);
    if (!recipRes.rows.length) throw apiError(404, 'NOT_FOUND', 'Recipient not found.');
    if (recipRes.rows[0].status !== 'active') throw apiError(422, 'RECIPIENT_INACTIVE', 'Recipient not active.');

    const txId = generateId('TRADE');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const balRes = await client.query(
        'SELECT balance FROM tgdp_balances WHERE uid = $1 FOR UPDATE', [req.uid]
      );
      const balance = Number(balRes.rows[0]?.balance || 0);
      if (balance < amount) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient TGDP balance.');

      await client.query(
        'UPDATE tgdp_balances SET balance = balance - $1, updated_at = NOW() WHERE uid = $2',
        [amount, req.uid]
      );
      await client.query(
        `INSERT INTO tgdp_balances (uid, balance) VALUES ($1,$2)
         ON CONFLICT (uid) DO UPDATE SET balance = tgdp_balances.balance + $2, updated_at = NOW()`,
        [toUserId, amount]
      );
      await client.query(
        `INSERT INTO tgdp_transactions (tx_id, type, from_user_id, to_user_id, amount, fee, note, status)
         VALUES ($1,'trade',$2,$3,$4,0,$5,'completed')`,
        [txId, req.uid, toUserId, amount, note||'']
      );

      await client.query('COMMIT');
      res.json({ success: true, txId, amount });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/swap (TGDP → FTR) ───────────────────────────────────────────
// ftr_balances schema: (uid, category ftr_category, balance_inr) — PK (uid, category)
const FTR_CAT_NAMES = { 1:'hospitality', 2:'healthcare', 3:'education', 4:'retail', 5:'travel' };

router.post('/swap', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    await requireRole(req.uid, 'household');

    const { tgdpAmount, ftrCategory } = req.body;
    if (!tgdpAmount || tgdpAmount <= 0) throw apiError(400, 'INVALID_ARGUMENT', 'tgdpAmount must be > 0.');
    const catNum = Number(ftrCategory);
    if (![1,2,3,4,5].includes(catNum)) throw apiError(400, 'INVALID_ARGUMENT', 'ftrCategory must be 1–5.');

    const FTR_COMMISSION = 0.04;
    const commission     = Math.round(tgdpAmount * FTR_COMMISSION);
    const ftrAmount      = tgdpAmount - commission;
    const rate           = await getLBMARate();
    const ftrValueINR    = Math.round((ftrAmount / 10) * rate);
    const expiryDate     = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const swapId   = generateId('SWAP');
    const catName  = FTR_CAT_NAMES[catNum];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const balRes = await client.query(
        'SELECT balance FROM tgdp_balances WHERE uid = $1 FOR UPDATE', [req.uid]
      );
      const balance = Number(balRes.rows[0]?.balance || 0);
      if (balance < tgdpAmount) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient TGDP balance.');

      await client.query(
        'UPDATE tgdp_balances SET balance = balance - $1, updated_at = NOW() WHERE uid = $2',
        [tgdpAmount, req.uid]
      );
      await client.query(
        `INSERT INTO ftr_balances (uid, category, balance_inr) VALUES ($1,$2,$3)
         ON CONFLICT (uid, category) DO UPDATE SET balance_inr = ftr_balances.balance_inr + $3, updated_at = NOW()`,
        [req.uid, catName, ftrValueINR]
      );
      await client.query(
        `INSERT INTO ftr_swaps
           (swap_id, user_id, tgdp_amount, commission, ftr_amount, ftr_value_inr, ftr_category, expiry_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
        [swapId, req.uid, tgdpAmount, commission, ftrAmount, ftrValueINR, catName, expiryDate]
      );
      await client.query(
        `UPDATE config SET value = jsonb_set(value, '{totalFTRCommission}',
           to_jsonb(COALESCE((value->>'totalFTRCommission')::numeric,0) + $1)),
           updated_at = NOW() WHERE key = 'revenue'`,
        [commission]
      );

      await client.query('COMMIT');
      res.json({ success: true, swapId, ftrAmount, ftrValueINR, commission, expiryDate: expiryDate.toISOString() });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) { next(err); }
});

// ─── POST /tgdp/withdraw ─────────────────────────────────────────────────────
router.post('/withdraw', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
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
        'SELECT balance FROM tgdp_balances WHERE uid = $1 FOR UPDATE', [req.uid]
      );
      const balance = Number(balRes.rows[0]?.balance || 0);
      if (balance < tgdpAmount) throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient TGDP balance.');

      await client.query(
        'UPDATE tgdp_balances SET balance = balance - $1, updated_at = NOW() WHERE uid = $2',
        [tgdpAmount, req.uid]
      );
      await client.query(
        `INSERT INTO tgdp_withdrawals
           (withdraw_id, user_id, tgdp_amount, amount_inr, rate_per_gram,
            bank_account_number, ifsc_code, account_holder_name, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'processing')`,
        [withdrawId, req.uid, tgdpAmount, amountINR, rate,
         bankAccountNumber, ifscCode, accountHolderName||'']
      );
      await client.query(
        `INSERT INTO tgdp_transactions
           (tx_id, type, from_user_id, amount, amount_inr, description, status, withdraw_id)
         VALUES ($1,'withdrawal',$2,$3,$4,$5,'processing',$6)`,
        [txId, req.uid, -tgdpAmount, amountINR,
         `Withdrawal to ****${bankAccountNumber.slice(-4)}`, withdrawId]
      );

      await client.query('COMMIT');
      res.json({ success: true, withdrawId, amountINR, status: 'processing' });
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

async function requireRole(uid, role) {
  const r = await pool.query(
    'SELECT role FROM user_roles WHERE uid = $1 AND role = $2', [uid, role]
  );
  if (!r.rows.length) throw apiError(403, 'PERMISSION_DENIED', `Role '${role}' required.`);
}

async function requireAdmin(uid) {
  const r = await pool.query(
    "SELECT role FROM user_roles WHERE uid = $1 AND role = 'admin'", [uid]
  );
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
    id: r.mint_id, mintId: r.mint_id, userId: r.user_id, jewelerId: r.jeweler_id,
    goldGrams: Number(r.gold_grams), purity: r.purity,
    pureGoldGrams: Number(r.pure_gold_grams), tgdpAmount: Number(r.tgdp_amount),
    valueINR: Number(r.value_inr), itemDescription: r.item_description,
    status: r.status, certIpfsHash: r.cert_ipfs_hash, certIpfsUri: r.cert_ipfs_uri,
    blockchainTxHash: r.blockchain_tx_hash,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

module.exports = router;
