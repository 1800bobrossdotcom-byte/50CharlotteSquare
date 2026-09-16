-- Charlotte Square analytics — Cloudflare D1 (SQLite).
-- Apply with:  wrangler d1 execute charlotte-analytics --file=./schema.sql --remote

-- One row per pageview or named event.
--
-- There is no IP column and no cookie. `visitor` is a SHA-256 of
-- (day + server salt + IP + user agent), truncated — it groups a person's hits
-- within one day and becomes a different value at midnight, so it cannot be
-- followed across days and cannot be reversed to an IP. That is what lets this
-- run without a consent banner.
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,                     -- unix seconds, UTC
  day      TEXT    NOT NULL,                     -- YYYY-MM-DD, for cheap grouping
  kind     TEXT    NOT NULL DEFAULT 'pageview',  -- pageview | tour_request | phone_click | …
  path     TEXT    NOT NULL,
  ref      TEXT,                                 -- referrer HOST only, never the full URL
  country  TEXT,
  device   TEXT,                                 -- mobile | tablet | desktop
  style    TEXT,                                 -- which design style was active
  meta     TEXT,                                 -- small JSON blob for event detail
  visitor  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_day      ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_day_kind ON events(day, kind);
CREATE INDEX IF NOT EXISTS idx_events_day_path ON events(day, path);
CREATE INDEX IF NOT EXISTS idx_events_visitor  ON events(day, visitor);

-- Brute-force throttle for the admin login, keyed by IP.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip     TEXT    PRIMARY KEY,
  fails  INTEGER NOT NULL DEFAULT 0,
  until  INTEGER NOT NULL DEFAULT 0   -- locked out until this unix second
);
