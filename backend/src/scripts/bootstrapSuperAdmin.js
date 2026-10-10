/**
 * Bootstrap Super Admin Account for NAGARSETU 3.1
 * CLI-only tool executed by the authorized developer from server console.
 * Usage:
 *   node src/scripts/bootstrapSuperAdmin.js <email> <password> [name]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDatabase, query } = require('../config/db');

async function bootstrap() {
  const args = process.argv.slice(2);
  const email = (args[0] || process.env.SUPER_ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const password = args[1] || process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD || '';
  const name = args[2] || process.env.SUPER_ADMIN_BOOTSTRAP_NAME || 'Lead Developer & Architect';

  if (!email || !password) {
    console.error('=================================================================');
    console.error('ERROR: Email and password are required to bootstrap Super Admin.');
    console.error('Usage: node src/scripts/bootstrapSuperAdmin.js <email> <password> [name]');
    console.error('=================================================================');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('ERROR: Super Admin password must be at least 8 characters long.');
    process.exit(1);
  }

  await initDatabase();

  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(password, salt);

  // Check if account already exists
  const existing = await query(`SELECT id, email, role FROM users WHERE LOWER(email) = ?`, [email]);

  let userId;
  if (existing.rows && existing.rows.length > 0) {
    userId = existing.rows[0].id;
    await query(
      `UPDATE users SET name = ?, password_hash = ?, role = 'super_admin', status = 'active' WHERE id = ?`,
      [name, passwordHash, userId]
    );
    console.log(`[BOOTSTRAP SUCCESS] Existing user #${userId} (${email}) elevated to Super Admin.`);
  } else {
    // Generate unique mobile for Super Admin record
    const dummyMobile = `DEV-${Date.now().toString().slice(-8)}`;
    const insertRes = await query(
      `INSERT INTO users (name, email, mobile, password_hash, role, status, language_pref)
       VALUES (?, ?, ?, ?, 'super_admin', 'active', 'en')`,
      [name, email, dummyMobile, passwordHash]
    );
    userId = insertRes.rows?.[0]?.id || insertRes.insertId;
    console.log(`[BOOTSTRAP SUCCESS] Created new Super Admin account #${userId} (${email}).`);
  }

  console.log(`Super Admin identity verified and active.`);
  process.exit(0);
}

if (require.main === module) {
  bootstrap().catch(err => {
    console.error('[BOOTSTRAP FATAL]', err);
    process.exit(1);
  });
}

module.exports = { bootstrap };
