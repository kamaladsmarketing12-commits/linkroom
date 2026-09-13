const crypto = require('crypto');

// Salt rotates via env so hashes aren't reversible/rainbow-tableable across deployments.
// We deliberately never store raw IPs (see README compliance notes on GDPR/CCPA).
const SALT = process.env.SESSION_SECRET || 'dev-salt-change-me';

function sha256(input) {
  return crypto.createHash('sha256').update(SALT + '|' + input).digest('hex');
}

function hashIp(ip) {
  return ip ? sha256(ip) : null;
}

// Combines IP + user agent so the "unique click" window survives IP churn
// less, but doesn't require cookies/consent to compute.
function visitorHash(ip, userAgent) {
  return sha256(`${ip || ''}::${userAgent || ''}`);
}

module.exports = { hashIp, visitorHash };
