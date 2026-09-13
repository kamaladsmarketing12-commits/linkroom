const express = require('express');
const { db } = require('../db');
const { toCsv } = require('../lib/csv');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const RESERVED_SLUGS = new Set(['dashboard', 'api', 'pixel', 'favicon.ico']);

function allowedDomains() {
  return (process.env.ALLOWED_TARGET_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function validateTargetUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return { ok: false, error: 'Target URL is not a valid absolute URL (include https://).' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, error: 'Only http/https target URLs are allowed.' };
  }
  const allow = allowedDomains();
  if (allow.length && !allow.includes(url.hostname.toLowerCase())) {
    return { ok: false, error: `Target domain "${url.hostname}" is not in ALLOWED_TARGET_DOMAINS.` };
  }
  return { ok: true };
}

// ---------- Links CRUD ----------

router.get('/links', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM clicks c WHERE c.link_id = l.id) AS total_clicks,
      (SELECT COUNT(*) FROM clicks c WHERE c.link_id = l.id AND c.is_unique = 1) AS unique_clicks,
      (SELECT COUNT(*) FROM conversions v WHERE v.link_id = l.id) AS total_conversions
    FROM links l
    ORDER BY l.created_at DESC
  `).all();
  res.json(rows);
});

router.get('/links/:id', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  res.json(link);
});

router.post('/links', (req, res) => {
  const { slug, target_url, redirect_type = '301', title, group_name, pass_utm = 1, cloak = 0, notes } = req.body || {};

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Slug must be 1-64 chars: letters, numbers, - or _.' });
  }
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return res.status(400).json({ error: `"${slug}" is reserved and can't be used as a slug.` });
  }
  if (!['301', '302', 'meta', 'js'].includes(redirect_type)) {
    return res.status(400).json({ error: 'Invalid redirect_type.' });
  }
  const check = validateTargetUrl(target_url || '');
  if (!check.ok) return res.status(400).json({ error: check.error });

  try {
    const info = db.prepare(`
      INSERT INTO links (slug, target_url, redirect_type, title, group_name, pass_utm, cloak, notes)
      VALUES (@slug, @target_url, @redirect_type, @title, @group_name, @pass_utm, @cloak, @notes)
    `).run({
      slug, target_url, redirect_type,
      title: title || null, group_name: group_name || null,
      pass_utm: pass_utm ? 1 : 0, cloak: cloak ? 1 : 0,
      notes: notes || null,
    });
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(link);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: `Slug "${slug}" is already taken.` });
    }
    res.status(500).json({ error: 'Failed to create link.' });
  }
});

router.put('/links/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Link not found' });

  const {
    slug = existing.slug,
    target_url = existing.target_url,
    redirect_type = existing.redirect_type,
    title = existing.title,
    group_name = existing.group_name,
    pass_utm = existing.pass_utm,
    cloak = existing.cloak,
    active = existing.active,
    notes = existing.notes,
  } = req.body || {};

  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid slug.' });
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return res.status(400).json({ error: `"${slug}" is reserved and can't be used as a slug.` });
  }
  if (!['301', '302', 'meta', 'js'].includes(redirect_type)) {
    return res.status(400).json({ error: 'Invalid redirect_type.' });
  }
  const check = validateTargetUrl(target_url);
  if (!check.ok) return res.status(400).json({ error: check.error });

  try {
    db.prepare(`
      UPDATE links SET
        slug = @slug, target_url = @target_url, redirect_type = @redirect_type,
        title = @title, group_name = @group_name, pass_utm = @pass_utm,
        cloak = @cloak, active = @active, notes = @notes, updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id: req.params.id, slug, target_url, redirect_type, title, group_name,
      pass_utm: pass_utm ? 1 : 0, cloak: cloak ? 1 : 0, active: active ? 1 : 0, notes,
    });
    res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: `Slug "${slug}" is already taken.` });
    }
    res.status(500).json({ error: 'Failed to update link.' });
  }
});

router.post('/links/:id/toggle', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  db.prepare("UPDATE links SET active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(link.active ? 0 : 1, link.id);
  res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(link.id));
});

router.delete('/links/:id', (req, res) => {
  const info = db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Link not found' });
  res.json({ ok: true });
});

// ---------- Analytics ----------

router.get('/links/:id/stats', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const days = Math.min(Number(req.query.days) || 30, 365);

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_clicks,
      SUM(is_unique) AS unique_clicks
    FROM clicks WHERE link_id = ? AND clicked_at > datetime('now', ?)
  `).get(link.id, `-${days} days`);

  const totalConversions = db.prepare(`
    SELECT COUNT(*) AS n FROM conversions WHERE link_id = ? AND converted_at > datetime('now', ?)
  `).get(link.id, `-${days} days`).n;

  const clicksOverTime = db.prepare(`
    SELECT date(clicked_at) AS day, COUNT(*) AS clicks, SUM(is_unique) AS unique_clicks
    FROM clicks
    WHERE link_id = ? AND clicked_at > datetime('now', ?)
    GROUP BY day ORDER BY day ASC
  `).all(link.id, `-${days} days`);

  const topReferrers = db.prepare(`
    SELECT COALESCE(referrer_host, '(direct)') AS referrer_host, COUNT(*) AS clicks
    FROM clicks
    WHERE link_id = ? AND clicked_at > datetime('now', ?)
    GROUP BY referrer_host ORDER BY clicks DESC LIMIT 10
  `).all(link.id, `-${days} days`);

  const deviceBreakdown = db.prepare(`
    SELECT COALESCE(device_type, 'unknown') AS device_type, COUNT(*) AS clicks
    FROM clicks
    WHERE link_id = ? AND clicked_at > datetime('now', ?)
    GROUP BY device_type ORDER BY clicks DESC
  `).all(link.id, `-${days} days`);

  const browserBreakdown = db.prepare(`
    SELECT COALESCE(browser, 'unknown') AS browser, COUNT(*) AS clicks
    FROM clicks
    WHERE link_id = ? AND clicked_at > datetime('now', ?)
    GROUP BY browser ORDER BY clicks DESC LIMIT 10
  `).all(link.id, `-${days} days`);

  const topCampaigns = db.prepare(`
    SELECT COALESCE(utm_campaign, '(none)') AS utm_campaign, COUNT(*) AS clicks
    FROM clicks
    WHERE link_id = ? AND clicked_at > datetime('now', ?)
    GROUP BY utm_campaign ORDER BY clicks DESC LIMIT 10
  `).all(link.id, `-${days} days`);

  const topLocations = db.prepare(`
    SELECT COALESCE(country, 'unknown') AS country, COUNT(*) AS clicks
    FROM clicks
    WHERE link_id = ? AND clicked_at > datetime('now', ?)
    GROUP BY country ORDER BY clicks DESC LIMIT 10
  `).all(link.id, `-${days} days`);

  res.json({
    link,
    totals: {
      total_clicks: totals.total_clicks || 0,
      unique_clicks: totals.unique_clicks || 0,
      total_conversions: totalConversions || 0,
    },
    clicksOverTime, topReferrers, deviceBreakdown, browserBreakdown, topCampaigns, topLocations,
  });
});

router.get('/links/:id/export.csv', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const rows = db.prepare(`
    SELECT clicked_at, is_unique, referrer_host, device_type, browser, os,
           country, region, city, utm_source, utm_medium, utm_campaign, utm_term, utm_content
    FROM clicks WHERE link_id = ? ORDER BY clicked_at DESC
  `).all(link.id);

  const csv = toCsv(rows);
  res.set({
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${link.slug}-clicks.csv"`,
  });
  res.send(csv);
});

// Dashboard-wide overview (all links)
router.get('/overview', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);

  const totals = db.prepare(`
    SELECT COUNT(*) AS total_clicks, SUM(is_unique) AS unique_clicks
    FROM clicks WHERE clicked_at > datetime('now', ?)
  `).get(`-${days} days`);

  const linkCount = db.prepare('SELECT COUNT(*) AS n FROM links').get().n;
  const activeCount = db.prepare('SELECT COUNT(*) AS n FROM links WHERE active = 1').get().n;
  const conversionCount = db.prepare(`
    SELECT COUNT(*) AS n FROM conversions WHERE converted_at > datetime('now', ?)
  `).get(`-${days} days`).n;

  const clicksOverTime = db.prepare(`
    SELECT date(clicked_at) AS day, COUNT(*) AS clicks, SUM(is_unique) AS unique_clicks
    FROM clicks WHERE clicked_at > datetime('now', ?)
    GROUP BY day ORDER BY day ASC
  `).all(`-${days} days`);

  const topLinks = db.prepare(`
    SELECT l.id, l.slug, l.title, COUNT(c.id) AS clicks
    FROM links l LEFT JOIN clicks c ON c.link_id = l.id AND c.clicked_at > datetime('now', ?)
    GROUP BY l.id ORDER BY clicks DESC LIMIT 10
  `).all(`-${days} days`);

  res.json({
    totals: {
      total_clicks: totals.total_clicks || 0,
      unique_clicks: totals.unique_clicks || 0,
      total_conversions: conversionCount || 0,
      link_count: linkCount,
      active_count: activeCount,
    },
    clicksOverTime, topLinks,
  });
});

module.exports = router;
