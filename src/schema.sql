-- PrettyLink clone schema (SQLite)

CREATE TABLE IF NOT EXISTS links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  target_url      TEXT NOT NULL,
  redirect_type   TEXT NOT NULL DEFAULT '301'
                  CHECK (redirect_type IN ('301','302','meta','js')),
  title           TEXT,
  group_name      TEXT,
  pass_utm        INTEGER NOT NULL DEFAULT 1,   -- 1 = forward query params/UTMs to target
  cloak           INTEGER NOT NULL DEFAULT 0,   -- 1 = show meta/js interstitial that hides target in address bar
  active          INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_links_slug ON links(slug);

CREATE TABLE IF NOT EXISTS clicks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id         INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash         TEXT,               -- salted hash of IP, not raw IP (privacy)
  visitor_hash    TEXT,               -- hash(ip+UA) used for unique-click windowing
  is_unique       INTEGER NOT NULL DEFAULT 0,
  referrer        TEXT,
  referrer_host   TEXT,
  user_agent      TEXT,
  device_type     TEXT,               -- desktop / mobile / tablet / bot / other
  browser         TEXT,
  os              TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_term        TEXT,
  utm_content     TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);

CREATE TABLE IF NOT EXISTS conversions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id         INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  click_id        INTEGER REFERENCES clicks(id) ON DELETE SET NULL,
  converted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  value           REAL,
  label           TEXT,               -- e.g. "newsletter_signup", "purchase"
  visitor_hash    TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversions_link_id ON conversions(link_id);
