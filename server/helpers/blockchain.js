// ─── Blockchain helpers (Polygon Amoy) ───────────────────────────────────────
// Reads contract addresses from PostgreSQL config table.
// All blockchain operations are best-effort / non-fatal.

const { ethers } = require('ethers');
const pool       = require('../db');

const RPC_URL = process.env.POLYGON_RPC_URL || 'https://rpc-amoy.polygon.technology';

async function getContractAddresses() {
  try {
    const res = await pool.query("SELECT value FROM config WHERE key = 'contracts'");
    if (!res.rows.length) return null;
    const val = res.rows[0].value;
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch (e) {
    return null;
  }
}

function getRegistrarSigner() {
  const pk = process.env.REGISTRAR_PRIVATE_KEY;
  if (!pk) return null;
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  return new ethers.Wallet(pk, provider);
}

/**
 * Record an operation on-chain.
 * @param {string}   operation  e.g. 'mint'
 * @param {Function} fn         async (signer, addresses) => { txHash }
 * @param {Function} [onTxHash] called with txHash after confirmed — use to persist
 */
async function recordOnChain(operation, fn, onTxHash) {
  try {
    const addresses = await getContractAddresses();
    if (!addresses) {
      console.log(`[blockchain] Contracts not deployed — skipping ${operation}`);
      return null;
    }
    const signer = getRegistrarSigner();
    if (!signer) {
      console.log('[blockchain] REGISTRAR_PRIVATE_KEY not set — skipping');
      return null;
    }
    const result = await fn(signer, addresses);
    if (onTxHash && result?.txHash) await onTxHash(result.txHash);
    console.log(`[blockchain] ${operation} recorded: ${result?.txHash}`);
    return result;
  } catch (err) {
    console.error(`[blockchain] ${operation} failed (non-fatal):`, err.message);
    return null;
  }
}

module.exports = { recordOnChain, ethers };
