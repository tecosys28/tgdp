/**
 * Generate a short prefixed ID identical to the Cloud Function version.
 * e.g. generateId('MINT') → 'MINT-M0X7K4ABC12'
 */
function generateId(prefix) {
  return prefix + '-' + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substr(2, 5).toUpperCase();
}

module.exports = { generateId };
