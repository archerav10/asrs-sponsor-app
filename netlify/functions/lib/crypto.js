const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('APP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with: openssl rand -hex 32');
  }
  return Buffer.from(hex, 'hex');
}

// Encrypts a payload plus an expiry into a single opaque token.
// No server-side storage — the token itself is the state, decrypted and
// checked on the next request. Matches the existing AES-256-CBC OTP pattern.
function encryptToken(payload, ttlSeconds) {
  const data = JSON.stringify(Object.assign({}, payload, { exp: Date.now() + ttlSeconds * 1000 }));
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function decryptToken(token) {
  const raw = Buffer.from(token, 'base64');
  const iv = raw.subarray(0, 16);
  const encrypted = raw.subarray(16);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const payload = JSON.parse(decrypted.toString('utf8'));
  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error('Token expired');
  }
  return payload;
}

module.exports = { encryptToken, decryptToken };
