const { decryptToken } = require('./crypto');

// Reads the session token from the Authorization header (Bearer <token>)
// and decrypts it. Throws a 401-tagged error on anything missing/expired —
// callers should catch and return err.statusCode / err.message directly.
function requireSession(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) {
    const err = new Error('Missing session.');
    err.statusCode = 401;
    throw err;
  }
  try {
    return decryptToken(token);
  } catch (e) {
    const err = new Error('Session expired. Please log in again.');
    err.statusCode = 401;
    throw err;
  }
}

module.exports = { requireSession };
