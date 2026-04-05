// ─── LBMA gold rate helpers ───────────────────────────────────────────────────

const pool = require('../db');

/** Get current LBMA rate per gram from config table. Falls back to 7342. */
async function getLBMARate() {
  try {
    const res = await pool.query("SELECT value FROM config WHERE key = 'lbma'");
    if (!res.rows.length) return 7342;
    const val = res.rows[0].value;
    const data = typeof val === 'string' ? JSON.parse(val) : val;
    return data.ratePerGram || 7342;
  } catch {
    return 7342;
  }
}

/**
 * Fetch live LBMA rate from Nasdaq Data Link + exchangerate-api.
 * Updates the config table. Returns new rate or null on failure.
 */
async function fetchAndRefreshLBMA() {
  const NASDAQ_API_KEY = process.env.NASDAQ_API_KEY;
  let ratePerGramINR, ratePerGramUSD, usdToInr;

  try {
    if (!NASDAQ_API_KEY) throw new Error('NASDAQ_API_KEY not set');

    const lbmaUrl = `https://data.nasdaq.com/api/v3/datasets/LBMA/GOLD.json?api_key=${NASDAQ_API_KEY}&rows=1`;
    const lbmaRes = await fetch(lbmaUrl);
    if (!lbmaRes.ok) throw new Error(`LBMA API ${lbmaRes.status}`);
    const lbmaJson = await lbmaRes.json();
    const latestRow = lbmaJson.dataset?.data?.[0];
    if (!latestRow || latestRow.length < 2) throw new Error('Unexpected LBMA response');
    const usdPerTroyOz = parseFloat(latestRow[1]);
    if (!usdPerTroyOz || isNaN(usdPerTroyOz)) throw new Error('Invalid LBMA USD value');
    ratePerGramUSD = usdPerTroyOz / 31.1034768;

    const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!fxRes.ok) throw new Error(`FX API ${fxRes.status}`);
    const fxJson = await fxRes.json();
    usdToInr = fxJson?.rates?.INR;
    if (!usdToInr || isNaN(usdToInr)) throw new Error('Invalid INR rate');

    ratePerGramINR = Math.round(ratePerGramUSD * usdToInr * 100) / 100;
    console.log(`[lbma] Updated: ₹${ratePerGramINR}/gram`);

    await pool.query(
      "UPDATE config SET value = $1, updated_at = NOW() WHERE key = 'lbma'",
      [JSON.stringify({
        ratePerGram:    ratePerGramINR,
        ratePerGramUSD: Math.round(ratePerGramUSD * 10000) / 10000,
        usdToInr:       Math.round(usdToInr * 100) / 100,
        currency:       'INR',
        source:         'LBMA',
        lastFetchError: null,
        updatedAt:      new Date().toISOString(),
      })]
    );
    return ratePerGramINR;

  } catch (err) {
    console.error('[lbma] Fetch failed, keeping existing rate:', err.message);
    // Persist error note without overwriting the good rate
    await pool.query(
      "UPDATE config SET value = config.value || $1::jsonb, updated_at = NOW() WHERE key = 'lbma'",
      [JSON.stringify({ lastFetchError: err.message, lastFetchAt: new Date().toISOString() })]
    ).catch(() => {});
    return null;
  }
}

module.exports = { getLBMARate, fetchAndRefreshLBMA };
