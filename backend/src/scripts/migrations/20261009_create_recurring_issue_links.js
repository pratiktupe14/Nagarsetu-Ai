/**
 * Migration: 20261009_create_recurring_issue_links
 * Description: Creates the recurring_issue_links table and indices for NAGARSETU 3.1.
 * Fully reversible via up() and down().
 */

const upPostgres = `
CREATE TABLE IF NOT EXISTS recurring_issue_links (
  id SERIAL PRIMARY KEY,
  current_complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  previous_complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Potential',
  distance_meters NUMERIC,
  department_id TEXT,
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  UNIQUE(current_complaint_id, previous_complaint_id)
);
CREATE INDEX IF NOT EXISTS idx_recurring_current ON recurring_issue_links(current_complaint_id);
CREATE INDEX IF NOT EXISTS idx_recurring_previous ON recurring_issue_links(previous_complaint_id);
`;

const downPostgres = `
DROP INDEX IF EXISTS idx_recurring_previous;
DROP INDEX IF EXISTS idx_recurring_current;
DROP TABLE IF EXISTS recurring_issue_links;
`;

const upSqlite = `
CREATE TABLE IF NOT EXISTS recurring_issue_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  current_complaint_id INTEGER NOT NULL,
  previous_complaint_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Potential',
  distance_meters REAL,
  department_id TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT,
  reviewed_at DATETIME,
  review_notes TEXT,
  UNIQUE(current_complaint_id, previous_complaint_id),
  FOREIGN KEY (current_complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recurring_current ON recurring_issue_links(current_complaint_id);
CREATE INDEX IF NOT EXISTS idx_recurring_previous ON recurring_issue_links(previous_complaint_id);
`;

const downSqlite = `
DROP INDEX IF EXISTS idx_recurring_previous;
DROP INDEX IF EXISTS idx_recurring_current;
DROP TABLE IF EXISTS recurring_issue_links;
`;

async function up(db) {
  if (db.query) {
    // Postgres client or pool
    await db.query(upPostgres);
  } else if (db.exec) {
    // SQLite
    await new Promise((resolve, reject) => {
      db.exec(upSqlite, (err) => (err ? reject(err) : resolve()));
    });
  }
}

async function down(db) {
  if (db.query) {
    await db.query(downPostgres);
  } else if (db.exec) {
    await new Promise((resolve, reject) => {
      db.exec(downSqlite, (err) => (err ? reject(err) : resolve()));
    });
  }
}

module.exports = {
  name: '20261009_create_recurring_issue_links',
  up,
  down,
  upPostgres,
  downPostgres,
  upSqlite,
  downSqlite
};
