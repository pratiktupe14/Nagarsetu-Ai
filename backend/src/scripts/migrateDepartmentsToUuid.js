/**
 * Migration Script: Migrate departments table to canonical UUID schema
 */
const db = require('../config/db');
const { CANONICAL_DEPARTMENTS } = require('../services/departmentService');

async function migrateDepartments() {
  await db.initDatabase();
  console.log('[MIGRATION] Migrating departments table to canonical UUIDs...');

  try {
    await db.query('DROP TABLE IF EXISTS departments_old');
    await db.query('ALTER TABLE departments RENAME TO departments_old');
  } catch (err) {
    console.log('[MIGRATION] Table rename note:', err.message);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      registry_id INTEGER
    )
  `);

  for (const dept of CANONICAL_DEPARTMENTS) {
    await db.query(
      `INSERT OR REPLACE INTO departments (id, code, name, description, status, registry_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [dept.id, dept.code, dept.name, dept.description, dept.status, dept.registry_id]
    );
  }

  const check = await db.query('SELECT * FROM departments');
  console.log('[MIGRATION] Departments currently in DB:', check.rows);

  // Sync department_heads
  await db.query("UPDATE department_heads SET department_id = '8ed9f760-1314-427c-a515-c2a54d6df6d8' WHERE email = 'rahul.kumar@nagarsetu.gov.in'");
  await db.query("UPDATE department_heads SET department_id = '9cabc1f2-fd10-48dd-a5cb-01d05197de22' WHERE email = 'amit.sharma@nagarsetu.gov.in'");
  await db.query("UPDATE department_heads SET department_id = 'ead370cc-459c-44f0-899f-8a97f0928beb' WHERE email = 'vikram.patil@nagarsetu.gov.in'");
  await db.query("UPDATE department_heads SET department_id = 'ee73cb82-cc47-4333-b7d6-4491353c1354' WHERE email = 'sanjay.more@nagarsetu.gov.in'");
  await db.query("UPDATE department_heads SET department_id = '31842723-23ac-490b-912b-9f6d9afbdfb3' WHERE email = 'aditya.joshi@nagarsetu.gov.in'");
  await db.query("UPDATE department_heads SET department_id = 'ae5e4d0c-996f-4d81-9528-d642664c93ae' WHERE email = 'rohan.deshmukh@nagarsetu.gov.in'");
  await db.query("UPDATE department_heads SET department_id = '71542723-23ac-490b-912b-9f6d9afbdfb7' WHERE email = 'kunal.kulkarni@nagarsetu.gov.in'");

  // Sync users (staff) department_id to canonical UUIDs
  for (const dept of CANONICAL_DEPARTMENTS) {
    await db.query(
      `UPDATE users SET department_id = ? WHERE (department_id = ? OR CAST(department_id AS TEXT) = ?) AND role = 'service_staff'`,
      [dept.id, dept.registry_id, String(dept.registry_id)]
    );
  }

  // Sync complaints
  for (const dept of CANONICAL_DEPARTMENTS) {
    await db.query(
      `UPDATE complaints SET department_id = ? WHERE department_id = ? OR CAST(department_id AS TEXT) = ?`,
      [dept.id, dept.registry_id, String(dept.registry_id)]
    );
  }

  console.log('[MIGRATION] Migration completed successfully.');
}

if (require.main === module) {
  migrateDepartments().then(() => process.exit(0)).catch(err => {
    console.error('[MIGRATION FATAL]', err);
    process.exit(1);
  });
}

module.exports = { migrateDepartments };
