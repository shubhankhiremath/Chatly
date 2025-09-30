/**
 * Firebase Admin initialization and ID token verification.
 * SECURITY: Do NOT ship service account JSON to the client.
 *
 * TODO: Add Firebase service account JSON (base64) into env FIREBASE_SERVICE_ACCOUNT_JSON,
 * or set path to service account file.
 */
const admin = require('firebase-admin');

let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return admin;

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!admin.apps.length) {
    if (!base64 || base64 === 'BASE64_ENCODED_SERVICE_ACCOUNT_JSON_HERE') {
      console.warn('Firebase Admin not fully configured. Set FIREBASE_SERVICE_ACCOUNT_JSON.');
      // Initialize with default app if running locally and you have GOOGLE_APPLICATION_CREDENTIALS set
      try {
        admin.initializeApp();
      } catch (e) {
        // ignore for local fallback
      }
    } else {
      try {
        const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        admin.initializeApp({
          credential: admin.credential.cert(json)
        });
      } catch (e) {
        console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON. Ensure it is base64 JSON string.', e);
        admin.initializeApp();
      }
    }
  }
  initialized = true;
  return admin;
}

async function verifyIdTokenFromAuthHeader(req) {
  const adminApp = initFirebaseAdmin();
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  try {
    const decoded = await adminApp.auth().verifyIdToken(token);
    return decoded; // contains uid, email, name, etc.
  } catch (e) {
    return null;
  }
}

module.exports = {
  initFirebaseAdmin,
  verifyIdTokenFromAuthHeader
};