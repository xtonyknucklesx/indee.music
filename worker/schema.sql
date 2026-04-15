CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roles TEXT NOT NULL,
  name TEXT,
  city TEXT,
  answers TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_responses_submitted ON responses(submitted_at);
CREATE INDEX IF NOT EXISTS idx_responses_roles ON responses(roles);
