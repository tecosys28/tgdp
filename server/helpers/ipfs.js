// ─── IPFS / Pinata helper (server-side) ──────────────────────────────────────
// Reads Pinata JWT from the config table in PostgreSQL.
// All IPFS operations are non-fatal.

const pool = require('../db');

let _cfPinataJWT = null;

async function getPinataJWT() {
  if (_cfPinataJWT) return _cfPinataJWT;
  try {
    const res = await pool.query("SELECT value FROM config WHERE key = 'ipfs'");
    if (!res.rows.length) return null;
    const val = res.rows[0].value || {};
    const jwt = val.pinataJWT;
    if (!jwt) return null;
    _cfPinataJWT = jwt;
    return jwt;
  } catch (e) {
    console.warn('[ipfs] getPinataJWT error:', e.message);
    return null;
  }
}

/**
 * Pin a JSON object to IPFS via Pinata.
 * Returns { ipfsHash, metadataUri } or null on failure.
 */
async function pinJSONToIPFS(content, name, keyvalues = {}) {
  try {
    const jwt = await getPinataJWT();
    if (!jwt) return null;
    const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        pinataContent:  content,
        pinataMetadata: { name, keyvalues },
        pinataOptions:  { cidVersion: 1 },
      }),
    });
    if (!res.ok) { console.warn('[ipfs]', name, 'pin failed:', await res.text()); return null; }
    const json = await res.json();
    return { ipfsHash: json.IpfsHash, metadataUri: `ipfs://${json.IpfsHash}` };
  } catch (e) {
    console.warn('[ipfs] pinJSONToIPFS error:', e.message);
    return null;
  }
}

module.exports = { pinJSONToIPFS };
