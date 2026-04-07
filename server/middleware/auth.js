// ─── Firebase token verification middleware ────────────────────────────────────
// Verifies Authorization: Bearer <idToken> on every protected route.
//
// Credential resolution order (first match wins):
//   1. FIREBASE_SERVICE_ACCOUNT_JSON — full service account JSON, base64-encoded.
//      Best for Render/PaaS where you cannot mount files.
//      In Render dashboard: Settings → Environment → add secret env var.
//      Generate the value with:
//        base64 -w0 serviceAccountKey.json   (Linux/Mac)
//        [Convert]::ToBase64String([IO.File]::ReadAllBytes('serviceAccountKey.json'))  (PowerShell)
//   2. GOOGLE_APPLICATION_CREDENTIALS — path to serviceAccountKey.json file.
//      Works on VMs / local dev with a real key file.
//   3. Application Default Credentials (ADC) — used automatically on GCP/Cloud Run.
//   4. Emulator mode — FIREBASE_AUTH_EMULATOR_HOST set → no credentials needed.

const admin = require('firebase-admin');

if (!process.env.FIREBASE_PROJECT_ID) {
  process.stderr.write('[auth] WARNING: FIREBASE_PROJECT_ID not set\n');
}

function buildCredential() {
  // Option 1: base64-encoded JSON in env var (Render-friendly)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
      const serviceAccount = JSON.parse(json);
      return admin.credential.cert(serviceAccount);
    } catch (e) {
      process.stderr.write(`[auth] ERROR parsing FIREBASE_SERVICE_ACCOUNT_JSON: ${e.message}\n`);
    }
  }

  // Option 2: GOOGLE_APPLICATION_CREDENTIALS file path — admin SDK picks this up automatically
  // Option 3: ADC — also automatic
  // Both handled by admin.credential.applicationDefault()
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    // Emulator mode — no real credentials needed
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  } else {
    admin.initializeApp({
      credential:  buildCredential(),
      ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}),
    });
  }
}

async function verifyFirebaseToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Login required.', status: 401 },
    });
  }
  const token = header.slice(7);
  try {
    const decoded       = await admin.auth().verifyIdToken(token);
    req.uid             = decoded.uid;
    req.firebaseUser    = decoded;
    next();
  } catch {
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token.', status: 401 },
    });
  }
}

module.exports = { verifyFirebaseToken, admin };
