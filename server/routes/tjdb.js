// ─── /api/v1/tjdb ─────────────────────────────────────────────────────────────
// tjdb_designs: designer_id, tjdb_orders: buyer_id, designer_id → users.uid
// columns: price_tgdp, price_inr, designer_share_tgdp, platform_fee_tgdp, image_url

const express  = require('express');
const pool     = require('../db');
const { verifyFirebaseToken }  = require('../middleware/auth');
const { apiError }             = require('../middleware/errorHandler');
const { generateId }           = require('../helpers/generateId');
const { pinJSONToIPFS }        = require('../helpers/ipfs');
const { recordOnChain, ethers} = require('../helpers/blockchain');
const { getLBMARate }          = require('../helpers/lbma');

const router = express.Router();

// GET /tjdb/designs
router.get('/designs', verifyFirebaseToken, async (req, res, next) => {
  try {
    const n = Math.min(parseInt(req.query.limit) || 50, 200);
    const r = await pool.query(
      "SELECT * FROM tjdb_designs WHERE status = 'active' ORDER BY created_at DESC LIMIT $1", [n]
    );
    res.json(r.rows.map(designRow));
  } catch (err) { next(err); }
});

// GET /tjdb/designs/mine
router.get('/designs/mine', verifyFirebaseToken, async (req, res, next) => {
  try {
    const r = await pool.query(
      'SELECT * FROM tjdb_designs WHERE designer_id = $1 ORDER BY created_at DESC', [req.uid]
    );
    res.json(r.rows.map(designRow));
  } catch (err) { next(err); }
});

// POST /tjdb/designs
router.post('/designs', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    await requireRole(req.uid, 'designer');

    const { title, description, category, price, imageUrls, fileUrls } = req.body;
    if (!title || !price) throw apiError(400, 'INVALID_ARGUMENT', 'title and price required.');

    const designId   = generateId('DES');
    const designHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify({ designId, uid: req.uid, title, category, price }))
    );

    const rate     = await getLBMARate();
    const priceINR = Math.round((price / 10) * rate); // price in TGDP → INR estimate

    // Pin to IPFS (non-fatal)
    let metadataUri = `ipfs://tgdp-designs/${designId}`;
    let ipfsHash    = null;
    const pinRes = await pinJSONToIPFS({
      name: title, description: description||'', category, price,
      designerId: req.uid, designId, designHash,
      imageUrls: imageUrls||[], createdAt: new Date().toISOString(),
      platform: 'TGDP Ecosystem — TROT Gold Pvt. Ltd.',
    }, `design-${designId}`, { designId, designerId: req.uid });
    if (pinRes) { ipfsHash = pinRes.ipfsHash; metadataUri = pinRes.metadataUri; }

    await pool.query(
      `INSERT INTO tjdb_designs
         (design_id, designer_id, title, description, price_tgdp, price_inr, category,
          image_url, metadata_uri, design_hash, ipr_registered, status, sales_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,'active',0)`,
      [designId, req.uid, title, description||'', price, priceINR, category||'general',
       (Array.isArray(imageUrls) && imageUrls[0]) || '', metadataUri, designHash]
    );

    // Register IPR on-chain (best-effort)
    await recordOnChain('registerDesignIPR', async (signer, addr) => {
      const ABI = ['function registerDesign(bytes32 designHash, string metadataUri, address designer) returns (uint256)'];
      const ipr  = new ethers.Contract(addr.iprRegistry, ABI, signer);
      const tx   = await ipr.registerDesign(designHash, metadataUri, req.uid);
      const rcpt = await tx.wait();
      return { txHash: rcpt.hash };
    }, async (txHash) => {
      await pool.query(
        'UPDATE tjdb_designs SET ipr_tx_hash=$1, ipr_registered=true WHERE design_id=$2',
        [txHash, designId]
      );
    });

    res.json({ success: true, designId, designHash, metadataUri, ipfsHash });
  } catch (err) { next(err); }
});

// POST /tjdb/designs/:id/purchase
router.post('/designs/:id/purchase', verifyFirebaseToken, async (req, res, next) => {
  try {
    await requireKYC(req.uid);
    const designId    = req.params.id;
    const { tgdpAmount } = req.body;
    if (!tgdpAmount) throw apiError(400, 'INVALID_ARGUMENT', 'tgdpAmount required.');

    const dRes = await pool.query('SELECT * FROM tjdb_designs WHERE design_id = $1', [designId]);
    if (!dRes.rows.length) throw apiError(404, 'NOT_FOUND', 'Design not found.');
    const design = dRes.rows[0];
    if (design.status !== 'active') throw apiError(422, 'NOT_AVAILABLE', 'Design not available.');

    const DESIGNER_SHARE  = 0.85;
    const designerShare   = Math.round(tgdpAmount * DESIGNER_SHARE);
    const platformFee     = tgdpAmount - designerShare;
    const orderId         = generateId('ORD');
    const rate            = await getLBMARate();
    const priceINR        = Math.round((tgdpAmount / 10) * rate);

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
        `INSERT INTO tgdp_balances (uid, balance) VALUES ($1,$2)
         ON CONFLICT (uid) DO UPDATE SET balance = tgdp_balances.balance + $2, updated_at = NOW()`,
        [design.designer_id, designerShare]
      );
      await client.query(
        `INSERT INTO tjdb_orders
           (order_id, buyer_id, design_id, designer_id, tgdp_amount, price_inr,
            designer_share_tgdp, platform_fee_tgdp, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [orderId, req.uid, designId, design.designer_id, tgdpAmount, priceINR, designerShare, platformFee]
      );
      await client.query(
        'UPDATE tjdb_designs SET sales_count = sales_count + 1, total_revenue_tgdp = total_revenue_tgdp + $1, updated_at = NOW() WHERE design_id = $2',
        [tgdpAmount, designId]
      );
      await client.query(
        `UPDATE config SET value = jsonb_set(value, '{totalDesignRevenue}',
           to_jsonb(COALESCE((value->>'totalDesignRevenue')::numeric,0) + $1)),
           updated_at = NOW() WHERE key = 'revenue'`,
        [platformFee]
      );

      await client.query('COMMIT');

      // Record on-chain (best-effort)
      if (design.design_hash) {
        await recordOnChain('recordDesignSale', async (signer, addr) => {
          const ABI = [
            'function recordSale(uint256 designId, address buyer, uint256 amount)',
            'function getDesignIdByHash(bytes32 designHash) view returns (uint256)',
          ];
          const ipr       = new ethers.Contract(addr.iprRegistry, ABI, signer);
          const onChainId = await ipr.getDesignIdByHash(design.design_hash);
          if (Number(onChainId) === 0) return null;
          const tx = await ipr.recordSale(onChainId, req.uid, ethers.parseUnits(String(tgdpAmount), 18));
          const rcpt = await tx.wait();
          return { txHash: rcpt.hash };
        }, async (txHash) => {
          await pool.query('UPDATE tjdb_orders SET blockchain_tx_hash=$1 WHERE order_id=$2', [txHash, orderId]);
        });
      }

      res.json({ success: true, orderId, designerShare });
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
  const r = await pool.query('SELECT role FROM user_roles WHERE uid = $1 AND role = $2', [uid, role]);
  if (!r.rows.length) throw apiError(403, 'PERMISSION_DENIED', `Role '${role}' required.`);
}

function designRow(r) {
  return {
    id: r.design_id, designId: r.design_id, designerId: r.designer_id,
    title: r.title, description: r.description, category: r.category,
    price: Number(r.price_tgdp), priceINR: Number(r.price_inr),
    imageUrl: r.image_url, metadataUri: r.metadata_uri, designHash: r.design_hash,
    iprRegistered: r.ipr_registered, iprTxHash: r.ipr_tx_hash,
    status: r.status, salesCount: r.sales_count,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

module.exports = router;
