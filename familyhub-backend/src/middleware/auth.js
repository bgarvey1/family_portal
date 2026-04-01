const { OAuth2Client } = require('google-auth-library');
const config = require('../config');

const oauthClient = new OAuth2Client();

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

async function requireOidc(req, res, next) {
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && apiKeyHeader === config.apiKey) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing credentials' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    await oauthClient.verifyIdToken({ idToken: token });
    next();
  } catch (err) {
    console.error('OIDC verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized: invalid OIDC token' });
  }
}

module.exports = { requireApiKey, requireOidc };
