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
  visitor  TEXT    NOT NULL,
  -- Campaign tags from the address they landed on (?utm_source=facebook…),
  -- pageviews only. Lowercased and capped by /api/collect; never the full URL.
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  variant      TEXT                              -- a | b | c, set only by the /tour/ test
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

-- One row per contact-form inquiry.
--
-- Written before the notification email is attempted, and the write is what
-- decides whether the visitor is told it worked. An email provider that is
-- misconfigured, rate-limited or simply not set up yet then costs a
-- notification, never a lead: everything is still here and still in the
-- dashboard. `notified` records which of those two happened.
CREATE TABLE IF NOT EXISTS inquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,                 -- unix seconds, UTC
  day        TEXT    NOT NULL,                 -- YYYY-MM-DD
  first_name TEXT    NOT NULL,
  last_name  TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  phone      TEXT,
  interest   TEXT,                             -- tour | availability | pricing | question
  plan       TEXT,                             -- 1 | 2 | 3, or null for no preference
  move_in    TEXT,                             -- YYYY-MM
  source     TEXT,                             -- how they heard about us
  message    TEXT,
  country    TEXT,
  notified   INTEGER NOT NULL DEFAULT 0,       -- 1 once the email actually left
  notify_err TEXT,                             -- why it did not, in the provider's words
  handled    INTEGER NOT NULL DEFAULT 0,       -- for marking off in the dashboard
  -- Where it came from. form and variant arrive with the submission; the rest
  -- is copied from the same visitor's first pageview that day, server-side,
  -- so no cookie was ever needed to remember it.
  form         TEXT,                           -- contact | tour
  variant      TEXT,                           -- a | b | c
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  referrer     TEXT,                           -- host only
  landing      TEXT,                           -- first page they saw
  ai           TEXT,                           -- JSON: Claude's summary and draft reply
  ai_err       TEXT                            -- why there is none, when there is none
);

CREATE INDEX IF NOT EXISTS idx_inquiries_ts      ON inquiries(ts DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_day     ON inquiries(day);
CREATE INDEX IF NOT EXISTS idx_inquiries_handled ON inquiries(handled, ts DESC);

-- Per-IP submission throttle, same shape as login_attempts.
CREATE TABLE IF NOT EXISTS inquiry_attempts (
  ip     TEXT    PRIMARY KEY,
  count  INTEGER NOT NULL DEFAULT 0,
  window INTEGER NOT NULL DEFAULT 0   -- unix second the current window opened
);

-- Claude's plain-English read of the dashboard, one per date range per day, so
-- reopening the dashboard does not pay for the same answer twice.
CREATE TABLE IF NOT EXISTS insights (
  key   TEXT    PRIMARY KEY,           -- '<days>|<last day>'
  ts    INTEGER NOT NULL,
  body  TEXT    NOT NULL               -- JSON
);

-- Upgrading a database created before 25 September 2026? Everything above is
-- IF NOT EXISTS, but SQLite has no ADD COLUMN IF NOT EXISTS, so the new columns
-- need adding once. Run these one at a time; "duplicate column name" just means
-- that one is already there.
--   ALTER TABLE inquiries ADD COLUMN notify_err TEXT;
--   ALTER TABLE events    ADD COLUMN utm_source TEXT;
--   ALTER TABLE events    ADD COLUMN utm_medium TEXT;
--   ALTER TABLE events    ADD COLUMN utm_campaign TEXT;
--   ALTER TABLE events    ADD COLUMN variant TEXT;
--   ALTER TABLE inquiries ADD COLUMN form TEXT;
--   ALTER TABLE inquiries ADD COLUMN variant TEXT;
--   ALTER TABLE inquiries ADD COLUMN utm_source TEXT;
--   ALTER TABLE inquiries ADD COLUMN utm_medium TEXT;
--   ALTER TABLE inquiries ADD COLUMN utm_campaign TEXT;
--   ALTER TABLE inquiries ADD COLUMN referrer TEXT;
--   ALTER TABLE inquiries ADD COLUMN landing TEXT;
--   ALTER TABLE inquiries ADD COLUMN ai TEXT;
--   ALTER TABLE inquiries ADD COLUMN ai_err TEXT;
