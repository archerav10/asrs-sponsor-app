const { decryptToken } = require('./crypto');

// Same pattern as lib/session.js's requireSession, but for the separate
// super-admin credential that gates the admin tooling itself (not tied
// to the Sponsors or Admin Accounts data).
function requireSuperAdmin(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) {
    const err = new Error('Not logged in.');
    err.statusCode = 401;
    throw err;
  }
  let payload;
  try {
    payload = decryptToken(token);
  } catch (e) {
    const err = new Error('Session expired. Please log in again.');
    err.statusCode = 401;
    throw err;
  }
  if (payload.accountType !== 'superadmin') {
    const err = new Error('Not authorized.');
    err.statusCode = 403;
    throw err;
  }
  return payload;
}

module.exports = { requireSuperAdmin };
