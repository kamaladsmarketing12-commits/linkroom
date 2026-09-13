require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const { migrate } = require('./db');
migrate(); // safe to run on every boot - CREATE TABLE IF NOT EXISTS

const { router: authRouter } = require('./routes/auth');
const apiRouter = require('./routes/api');
const redirectRouter = require('./routes/redirect');

const app = express();

// If you're behind a reverse proxy (nginx, Cloudflare, a PaaS), this makes
// req.ip / X-Forwarded-For handling correct. Adjust the trust level to match
// your actual proxy topology - see README "Deploying behind a proxy".
app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12, // 12h
  },
}));

// --- Dashboard (static SPA) + its API, under /dashboard and /api ---
app.use('/dashboard', express.static(path.join(__dirname, '..', 'public')));
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

// --- Public redirect + tracking pixel routes live at the domain root,
//     so short links look like yourdomain.com/promo1 rather than
//     yourdomain.com/r/promo1. This must be mounted AFTER /dashboard and
//     /api so those paths aren't swallowed as slugs. ---
app.use('/', redirectRouter);

app.get('/', (req, res) => res.redirect('/dashboard'));

app.use((req, res) => {
  res.status(404).send('Not found');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`prettylink-clone listening on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
});
