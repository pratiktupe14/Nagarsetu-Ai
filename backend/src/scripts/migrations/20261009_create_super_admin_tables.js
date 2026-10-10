/**
 * Migration: 20261009_create_super_admin_tables
 * Description: Creates super_admin_audit_logs and complaint_evidence_versions tables,
 * and adds archival tracking columns to complaints table for NAGARSETU 3.1.
 * Fully reversible via up() and down().
 */

const upPostgres = `
CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
  id SERIAL PRIMARY KEY,
  admin_id TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  changes_json TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON super_admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON super_admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON super_admin_audit_logs(created_at);

CREATE TABLE IF NOT EXISTS complaint_evidence_versions (
  id SERIAL PRIMARY KEY,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  photo_before_url TEXT,
  photo_after_url TEXT,
  photo_front_url TEXT,
  replacement_reason TEXT,
  replaced_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_evidence_complaint ON complaint_evidence_versions(complaint_id);

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS archived_by TEXT;
`;

const downPostgres = `
DROP TABLE IF EXISTS complaint_evidence_versions;
DROP TABLE IF EXISTS super_admin_audit_logs;
ALTER TABLE complaints DROP COLUMN IF EXISTS is_archived;
ALTER TABLE complaints DROP COLUMN IF EXISTS archived_at;
ALTER TABLE complaints DROP COLUMN IF EXISTS archived_by;
`;

const upSqlite = `
CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  changes_json TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON super_admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON super_admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON super_admin_audit_logs(created_at);

CREATE TABLE IF NOT EXISTS complaint_evidence_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  photo_before_url TEXT,
  photo_after_url TEXT,
  photo_front_url TEXT,
  replacement_reason TEXT,
  replaced_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_complaint ON complaint_evidence_versions(complaint_id);
`;

const downSqlite = `
DROP TABLE IF EXISTS complaint_evidence_versions;
DROP TABLE IF EXISTS super_admin_audit_logs;
`;

async function up(db) {
  if (db.query) {
    await db.query(upPostgres);
  } else if (db.exec) {
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
  name: '20261009_create_super_admin_tables',
  up,
  down,
  upPostgres,
  downPostgres,
  upSqlite,
  downSqlite
};
