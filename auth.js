const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminHash) {
    return res.status(500).json({
      error: 'Server not configured: run "node src/create-admin.js" to set an admin password.',
    });
  }

  if (email !== adminEmail || !bcrypt.compareSync(password || '', adminHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  req.session.authed = true;
  req.session.email = email;
  res.json({ ok: true, email });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (req.session && req.session.authed) return res.json({ email: req.session.email });
  res.status(401).json({ error: 'Not authenticated' });
});

module.exports = { router, requireAuth };
