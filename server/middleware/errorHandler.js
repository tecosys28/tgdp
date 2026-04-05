// ─── Central error handler ────────────────────────────────────────────────────

function errorHandler(err, req, res, next) {
  // Known API errors thrown as { status, code, message }
  if (err.status && err.code) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, status: err.status } });
  }
  console.error('[server] Unhandled error:', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error.', status: 500 } });
}

/**
 * Create a structured API error.
 * Usage: throw apiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient TGDP balance.')
 */
function apiError(status, code, message) {
  const err = new Error(message);
  err.status  = status;
  err.code    = code;
  return err;
}

module.exports = { errorHandler, apiError };
