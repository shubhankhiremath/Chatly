/**
 * POST /api/auth/verify -> verifies a Firebase ID token
 * Body: { idToken }
 */
const { initFirebaseAdmin } = require('../../lib/firebaseAdmin');
const { json, badRequest, methodNotAllowed, parseBody } = require('../../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return badRequest(res, 'Invalid JSON');
  }

  const idToken = body.idToken;
  if (!idToken) return badRequest(res, 'Missing idToken');

  try {
    const admin = initFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    return json(res, 200, { uid: decoded.uid, email: decoded.email || null, name: decoded.name || null });
  } catch (e) {
    return json(res, 401, { error: 'Invalid token' });
  }
};