// ─── Firebase token verification middleware ───────────────────────────────────
// Verifies the Authorization: Bearer <idToken> on every protected route.
// Works with both the live Firebase project and the local Auth emulator.

const admin = require('firebase-admin');

// Initialise Firebase Admin once (idempotent)
if (!admin.apps.length) {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    // Emulator mode — no real credentials needed
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'tgdp-d4a3d' });
  } else {
    // Production — uses GOOGLE_APPLICATION_CREDENTIALS env var
    admin.initializeApp();
  }
}

/**
 * Express middleware.  Attaches req.uid (string) and req.firebaseUser (decoded token).
 * Returns 401 if missing / invalid token.
 */
async function verifyFirebaseToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required.', status: 401 } });
  }
  const token = header.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid          = decoded.uid;
    req.firebaseUser = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token.', status: 401 } });
  }
}

module.exports = { verifyFirebaseToken, admin };
