const express = require('express');
const { db } = require('../db');
const { parseUserAgent } = require('../lib/useragent');
const { geolocate } = require('../lib/geolocation');
const { hashIp, visitorHash } = require('../lib/hash');

const router = express.Router();

const UNIQUE_WINDOW_HOURS = Number(process.env.UNIQUE_WINDOW_HOURS || 24);

const getLinkBySlug = db.prepare('SELECT * FROM links WHERE slug = ? AND active = 1');
const insertClick = db.prepare(`
  INSERT INTO clicks (
    link_id, ip_hash, visitor_hash, is_unique, referrer, referrer_host,
    user_agent, device_type, browser, os, country, region, city,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content
  ) VALUES (
    @link_id, @ip_hash, @visitor_hash, @is_unique, @referrer, @referrer_host,
    @user_agent, @device_type, @browser, @os, @country, @region, @city,
    @utm_source, @utm_medium, @utm_campaign, @utm_term, @utm_content
  )
`);
const findRecentVisitor = db.prepare(`
  SELECT id FROM clicks
  WHERE link_id = ? AND visitor_hash = ?
    AND clicked_at > datetime('now', ?)
  LIMIT 1
`);
const insertConversion = db.prepare(`
  INSERT INTO conversions (link_id, click_id, value, label, visitor_hash)
  VALUES (@link_id, @click_id, @value, @label, @visitor_hash)
`);
const findLatestClickForVisitor = db.prepare(`
  SELECT id FROM clicks WHERE link_id = ? AND visitor_hash = ? ORDER BY clicked_at DESC LIMIT 1
`);

function getClientIp(req) {
  // Respects a trusted reverse proxy's X-Forwarded-For (see README on
  // setting `app.set('trust proxy', ...)` correctly before relying on this).
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}

function buildTargetUrl(link, incomingQuery) {
  const target = new URL(link.target_url);
  if (link.pass_utm) {
    for (const [key, value] of Object.entries(incomingQuery)) {
      // Forward UTM params (and any other query params) onto the destination,
      // without clobbering params the destination URL already hard-codes.
      if (!target.searchParams.has(key)) target.searchParams.set(key, value);
    }
  }
  return target.toString();
}

function renderInterstitial(kind, targetUrl, title) {
  const safeUrl = targetUrl.replace(/"/g, '&quot;');
  const safeTitle = (title || 'Redirecting…').replace(/</g, '&lt;');
  if (kind === 'meta') {
    return `<!doctype html><html><head><meta charset="utf-8">
<title>${safeTitle}</title>
<meta http-equiv="refresh" content="0; url=${safeUrl}">
<link rel="canonical" href="${safeUrl}">
</head><body>
<p>Redirecting you to <a href="${safeUrl}">${safeUrl}</a>…</p>
</body></html>`;
  }
  // js
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${safeTitle}</title>
<link rel="canonical" href="${safeUrl}">
</head><body>
<p>Redirecting you to <a href="${safeUrl}">${safeUrl}</a>…</p>
<script>window.location.replace(${JSON.stringify(targetUrl)});</script>
</body></html>`;
}

// GET /:slug  - the actual redirect
router.get('/:slug', async (req, res, next) => {
  const link = getLinkBySlug.get(req.params.slug);
  if (!link) return next(); // fall through to 404 handler

  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';
  const { device_type, browser, os, is_bot } = parseUserAgent(ua);
  const referrer = req.headers['referer'] || req.headers['referrer'] || null;
  let referrerHost = null;
  try { referrerHost = referrer ? new URL(referrer).hostname : null; } catch (_) {}

  const vHash = visitorHash(ip, ua);
  const recent = findRecentVisitor.get(link.id, vHash, `-${UNIQUE_WINDOW_HOURS} hours`);
  const isUnique = recent ? 0 : 1;

  // Geolocation and DB write happen without delaying the redirect response
  // more than necessary; we await geolocation because it's usually the
  // slowest step, but it's capped at ~2.5s and fails soft (see lib/geolocation.js).
  const geo = is_bot ? { country: null, region: null, city: null } : await geolocate(ip);

  let clickId = null;
  if (!is_bot) {
    const info = insertClick.run({
      link_id: link.id,
      ip_hash: hashIp(ip),
      visitor_hash: vHash,
      is_unique: isUnique,
      referrer,
      referrer_host: referrerHost,
      user_agent: ua,
      device_type,
      browser,
      os,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      utm_source: req.query.utm_source || null,
      utm_medium: req.query.utm_medium || null,
      utm_campaign: req.query.utm_campaign || null,
      utm_term: req.query.utm_term || null,
      utm_content: req.query.utm_content || null,
    });
    clickId = info.lastInsertRowid;
  }

  const targetUrl = buildTargetUrl(link, req.query);

  switch (link.redirect_type) {
    case '302':
      return res.redirect(302, targetUrl);
    case 'meta':
      res.set('Cache-Control', 'no-store');
      return res.status(200).send(renderInterstitial('meta', targetUrl, link.title));
    case 'js':
      res.set('Cache-Control', 'no-store');
      return res.status(200).send(renderInterstitial('js', targetUrl, link.title));
    case '301':
    default:
      return res.redirect(301, targetUrl);
  }
});

// GET /pixel/:slug.gif - invisible 1x1 tracking pixel for conversion events.
// Embed as: <img src="https://yourdomain/pixel/promo1.gif" width="1" height="1" style="display:none" alt="">
const GIF_1x1 = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);

router.get('/pixel/:slug.gif', (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  res.status(200).end(GIF_1x1);

  // Fire-and-forget conversion logging; never block the pixel response on it.
  const link = db.prepare('SELECT id FROM links WHERE slug = ?').get(req.params.slug);
  if (!link) return;

  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';
  const vHash = visitorHash(ip, ua);
  const lastClick = findLatestClickForVisitor.get(link.id, vHash);

  insertConversion.run({
    link_id: link.id,
    click_id: lastClick ? lastClick.id : null,
    value: req.query.value ? Number(req.query.value) : null,
    label: req.query.label || 'conversion',
    visitor_hash: vHash,
  });
});

module.exports = router;
