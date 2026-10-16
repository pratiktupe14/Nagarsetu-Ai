const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDatabase, query } = require('./config/db');
const app = require('./app');

const PORT = process.env.PORT || 5000;

// Initial Seed Users for fast demo testing
async function seedDefaultUsers() {
  try {
    const salt = await bcrypt.genSalt(10);
    const citizenPass = process.env.DEMO_CITIZEN_PASSWORD || '8788562103';
    const adminPass = process.env.DEMO_ADMIN_PASSWORD || 'admin@123';
    const citizenHash = await bcrypt.hash(citizenPass, salt);
    const adminHash = await bcrypt.hash(adminPass, salt);
    const defaultPass = process.env.DEMO_USER_PASSWORD || 'password123';
    const defaultHash = await bcrypt.hash(defaultPass, salt);

    // 1. Citizen Seed Account (8788562103 / 8788562103)
    const citizenCheck = await query(
      `SELECT id FROM users WHERE mobile = '8788562103' OR mobile = '+918788562103' OR mobile = '+91 8788562103' OR LOWER(email) = 'citizen8788562103@nagarsetu.gov.in'`
    );
    if (citizenCheck.rows && citizenCheck.rows.length > 0) {
      console.log('Seeded citizen 8788562103 exists (retaining existing credentials).');
    } else {
      await query(
        `INSERT INTO users (name, mobile, email, password_hash, role, language_pref, status) VALUES (?, ?, ?, ?, 'citizen', 'en', 'active')`,
        ['Pratik Dilip Tupe', '8788562103', 'citizen8788562103@nagarsetu.gov.in', citizenHash]
      );
      console.log('Seeded citizen 8788562103 inserted.');
    }

    // 2. City Admin (admin@nagarsetu.gov.in / admin@123)
    const adminCheck = await query(
      `SELECT id FROM users WHERE LOWER(email) = 'admin@nagarsetu.gov.in' OR mobile = '9876543213' OR mobile = '+919876543213'`
    );
    if (adminCheck.rows && adminCheck.rows.length > 0) {
      console.log('City Admin exists (retaining existing credentials).');
    } else {
      await query(
        `INSERT INTO users (name, mobile, email, password_hash, role, language_pref, status) VALUES (?, ?, ?, ?, 'city_admin', 'en', 'active')`,
        ['Municipal Admin', '9876543213', 'admin@nagarsetu.gov.in', adminHash]
      );
      console.log('City Admin inserted.');
    }

    // 3. Initial generic users if empty
    const resCount = await query(`SELECT COUNT(*) as count FROM users`);
    if (resCount.rows && resCount.rows[0].count <= 2) {
      const extraUsers = [
        { name: 'Rahul Sharma (Citizen)', mobile: '9876543210', email: 'rahul@citizen.nagarsetu.gov.in', role: 'citizen', lang: 'en', passHash: defaultHash },
        { name: 'Inspector V. K. Patil (Officer)', mobile: '9876543211', email: 'officer@nagarsetu.gov.in', role: 'officer', lang: 'en', passHash: defaultHash }
      ];
      for (const u of extraUsers) {
        const uCheck = await query(`SELECT id FROM users WHERE mobile = ? OR email = ? LIMIT 1`, [u.mobile, u.email]);
        if (!uCheck.rows || uCheck.rows.length === 0) {
          await query(
            `INSERT INTO users (name, mobile, email, password_hash, role, language_pref, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [u.name, u.mobile, u.email, u.passHash, u.role, u.lang]
          );
        }
      }
    }
  } catch (err) {
    console.error('Error seeding default users:', err);
  }
}

const seed7DemoDepartmentHeads = require('./scripts/seedDemoDepartmentHeads');
const seedServiceStaff = require('./scripts/seedServiceStaff');

async function seedAll() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_DATA !== 'true') {
    console.log('[SECURITY] Production environment detected: Skipping automatic demo seed scripts to protect live database.');
    return;
  }
  await seedDefaultUsers();
  await seed7DemoDepartmentHeads();
  await seedServiceStaff();
}

if (require.main === module) {
  initDatabase()
    .then(async () => {
      await seedAll();
      app.listen(PORT, () => {
        console.log(`=======================================================`);
        console.log(`  NAGARSETU Backend API running on http://localhost:${PORT}`);
        console.log(`=======================================================`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize database:', err);
    });
}

module.exports = {
  seedDefaultUsers,
  seed7DemoDepartmentHeads,
  seedServiceStaff,
  seedAll
};

