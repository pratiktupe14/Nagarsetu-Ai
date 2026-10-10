const bcrypt = require('bcryptjs');
const { query, initDatabase } = require('../config/db');

const SERVICE_STAFF_DEFINITIONS = [
  // 0. Primary Demo Staff — Ramesh Kumar (36th Staff)
  { deptCode: 'PWD', search: 'Public Works', name: 'Ramesh Kumar', employee_id: 'STF-001', email: 'staff@nagarsetu.gov.in', mobile: '9876543212' },

  // 1. PWD — 5 Staff
  { deptCode: 'PWD', search: 'Public Works', name: 'Amit Patil', employee_id: 'PWD-STF-001', email: 'amit.patil@nagarsetu.gov.in', mobile: '9822010001' },
  { deptCode: 'PWD', search: 'Public Works', name: 'Sagar Jadhav', employee_id: 'PWD-STF-002', email: 'sagar.jadhav@nagarsetu.gov.in', mobile: '9822010002' },
  { deptCode: 'PWD', search: 'Public Works', name: 'Nikhil Shinde', employee_id: 'PWD-STF-003', email: 'nikhil.shinde@nagarsetu.gov.in', mobile: '9822010003' },
  { deptCode: 'PWD', search: 'Public Works', name: 'Rohit More', employee_id: 'PWD-STF-004', email: 'rohit.more@nagarsetu.gov.in', mobile: '9822010004' },
  { deptCode: 'PWD', search: 'Public Works', name: 'Akash Pawar', employee_id: 'PWD-STF-005', email: 'akash.pawar@nagarsetu.gov.in', mobile: '9822010005' },

  // 2. Sanitation — 5 Staff
  { deptCode: 'SAN', search: 'Sanitation', name: 'Prashant Mane', employee_id: 'SAN-STF-001', email: 'prashant.mane@nagarsetu.gov.in', mobile: '9822010006' },
  { deptCode: 'SAN', search: 'Sanitation', name: 'Ganesh Chavan', employee_id: 'SAN-STF-002', email: 'ganesh.chavan@nagarsetu.gov.in', mobile: '9822010007' },
  { deptCode: 'SAN', search: 'Sanitation', name: 'Mahesh Kadam', employee_id: 'SAN-STF-003', email: 'mahesh.kadam@nagarsetu.gov.in', mobile: '9822010008' },
  { deptCode: 'SAN', search: 'Sanitation', name: 'Swapnil Bhosale', employee_id: 'SAN-STF-004', email: 'swapnil.bhosale@nagarsetu.gov.in', mobile: '9822010009' },
  { deptCode: 'SAN', search: 'Sanitation', name: 'Deepak Wagh', employee_id: 'SAN-STF-005', email: 'deepak.wagh@nagarsetu.gov.in', mobile: '9822010010' },

  // 3. Water Supply — 5 Staff
  { deptCode: 'WTR', search: 'Water', name: 'Kiran Patil', employee_id: 'WTR-STF-001', email: 'kiran.patil@nagarsetu.gov.in', mobile: '9822010011' },
  { deptCode: 'WTR', search: 'Water', name: 'Manoj Shinde', employee_id: 'WTR-STF-002', email: 'manoj.shinde@nagarsetu.gov.in', mobile: '9822010012' },
  { deptCode: 'WTR', search: 'Water', name: 'Sachin More', employee_id: 'WTR-STF-003', email: 'sachin.more@nagarsetu.gov.in', mobile: '9822010013' },
  { deptCode: 'WTR', search: 'Water', name: 'Ajay Jadhav', employee_id: 'WTR-STF-004', email: 'ajay.jadhav@nagarsetu.gov.in', mobile: '9822010014' },
  { deptCode: 'WTR', search: 'Water', name: 'Vivek Pawar', employee_id: 'WTR-STF-005', email: 'vivek.pawar@nagarsetu.gov.in', mobile: '9822010015' },

  // 4. Drainage & Sewage — 5 Staff
  { deptCode: 'DRN', search: 'Drainage', name: 'Sunil Patil', employee_id: 'DRN-STF-001', email: 'sunil.patil@nagarsetu.gov.in', mobile: '9822010016' },
  { deptCode: 'DRN', search: 'Drainage', name: 'Ramesh More', employee_id: 'DRN-STF-002', email: 'ramesh.more@nagarsetu.gov.in', mobile: '9822010017' },
  { deptCode: 'DRN', search: 'Drainage', name: 'Santosh Jadhav', employee_id: 'DRN-STF-003', email: 'santosh.jadhav@nagarsetu.gov.in', mobile: '9822010018' },
  { deptCode: 'DRN', search: 'Drainage', name: 'Dinesh Shinde', employee_id: 'DRN-STF-004', email: 'dinesh.shinde@nagarsetu.gov.in', mobile: '9822010019' },
  { deptCode: 'DRN', search: 'Drainage', name: 'Pravin Pawar', employee_id: 'DRN-STF-005', email: 'pravin.pawar@nagarsetu.gov.in', mobile: '9822010020' },

  // 5. Electrical & Street Lighting — 5 Staff
  { deptCode: 'ELE', search: 'Electrical', name: 'Rahul Joshi', employee_id: 'ELE-STF-001', email: 'rahul.joshi@nagarsetu.gov.in', mobile: '9822010021' },
  { deptCode: 'ELE', search: 'Electrical', name: 'Sameer Kulkarni', employee_id: 'ELE-STF-002', email: 'sameer.kulkarni@nagarsetu.gov.in', mobile: '9822010022' },
  { deptCode: 'ELE', search: 'Electrical', name: 'Tejas Deshmukh', employee_id: 'ELE-STF-003', email: 'tejas.deshmukh@nagarsetu.gov.in', mobile: '9822010023' },
  { deptCode: 'ELE', search: 'Electrical', name: 'Omkar Patil', employee_id: 'ELE-STF-004', email: 'omkar.patil@nagarsetu.gov.in', mobile: '9822010024' },
  { deptCode: 'ELE', search: 'Electrical', name: 'Harshad More', employee_id: 'ELE-STF-005', email: 'harshad.more@nagarsetu.gov.in', mobile: '9822010025' },

  // 6. Traffic Management — 5 Staff
  { deptCode: 'TRF', search: 'Traffic', name: 'Rohan Patil', employee_id: 'TRF-STF-001', email: 'rohan.patil@nagarsetu.gov.in', mobile: '9822010026' },
  { deptCode: 'TRF', search: 'Traffic', name: 'Vishal Jadhav', employee_id: 'TRF-STF-002', email: 'vishal.jadhav@nagarsetu.gov.in', mobile: '9822010027' },
  { deptCode: 'TRF', search: 'Traffic', name: 'Tushar More', employee_id: 'TRF-STF-003', email: 'tushar.more@nagarsetu.gov.in', mobile: '9822010028' },
  { deptCode: 'TRF', search: 'Traffic', name: 'Nitin Shinde', employee_id: 'TRF-STF-004', email: 'nitin.shinde@nagarsetu.gov.in', mobile: '9822010029' },
  { deptCode: 'TRF', search: 'Traffic', name: 'Amol Pawar', employee_id: 'TRF-STF-005', email: 'amol.pawar@nagarsetu.gov.in', mobile: '9822010030' },

  // 7. Maintenance — 5 Staff
  { deptCode: 'MNT', search: 'Maintenance', name: 'Kunal Patil', employee_id: 'MNT-STF-001', email: 'kunal.patil@nagarsetu.gov.in', mobile: '9822010031' },
  { deptCode: 'MNT', search: 'Maintenance', name: 'Ganesh More', employee_id: 'MNT-STF-002', email: 'ganesh.more@nagarsetu.gov.in', mobile: '9822010032' },
  { deptCode: 'MNT', search: 'Maintenance', name: 'Mayur Jadhav', employee_id: 'MNT-STF-003', email: 'mayur.jadhav@nagarsetu.gov.in', mobile: '9822010033' },
  { deptCode: 'MNT', search: 'Maintenance', name: 'Sachin Pawar', employee_id: 'MNT-STF-004', email: 'sachin.pawar@nagarsetu.gov.in', mobile: '9822010034' },
  { deptCode: 'MNT', search: 'Maintenance', name: 'Yogesh Shinde', employee_id: 'MNT-STF-005', email: 'yogesh.shinde@nagarsetu.gov.in', mobile: '9822010035' }
];

const DEMO_PASSWORD = process.env.DEMO_STAFF_PASSWORD || 'staff@123';

async function seedServiceStaff() {
  await initDatabase();
  console.log('Starting Service Staff Seeding (35 Total Accounts)...');

  // Build dynamic department mapping
  const deptsRes = await query(`SELECT id, name FROM departments`);
  const deptMap = {};
  for (const d of (deptsRes.rows || [])) {
    const n = (d.name || '').toLowerCase();
    if (n.includes('public works') || n.includes('pwd')) deptMap['PWD'] = d.id;
    else if (n.includes('sanitat') || n.includes('waste')) deptMap['SAN'] = d.id;
    else if (n.includes('water')) deptMap['WTR'] = d.id;
    else if (n.includes('drain') || n.includes('sewag')) deptMap['DRN'] = d.id;
    else if (n.includes('electr') || n.includes('light')) deptMap['ELE'] = d.id;
    else if (n.includes('traffic')) deptMap['TRF'] = d.id;
    else if (n.includes('maint')) deptMap['MNT'] = d.id;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, salt);

  let createdCount = 0;
  let updatedCount = 0;

  for (const item of SERVICE_STAFF_DEFINITIONS) {
    const cleanEmail = item.email.toLowerCase();
    const deptId = deptMap[item.deptCode] || null;

    // Check if account already exists by email or employee_id
    const existing = await query(
      `SELECT id, department_id, status FROM users WHERE LOWER(email) = $1 OR employee_id = $2`,
      [cleanEmail, item.employee_id]
    );

    if (existing.rows && existing.rows.length > 0) {
      const existingUser = existing.rows[0];
      // Update department, password, role, status to active
      await query(
        `UPDATE users
         SET name = $1,
             mobile = $2,
             password_hash = $3,
             role = 'service_staff',
             department_id = $4,
             employee_id = $5,
             designation = 'Field Service Staff',
             status = 'active'
         WHERE id = $6`,
        [item.name, item.mobile, passwordHash, deptId, item.employee_id, existingUser.id]
      );
      updatedCount++;
      console.log(`Updated staff: ${item.name} (${item.employee_id}) -> Dept ${deptId}`);
    } else {
      // Insert new user
      await query(
        `INSERT INTO users 
         (name, mobile, email, password_hash, role, department_id, employee_id, designation, status, language_pref)
         VALUES ($1, $2, $3, $4, 'service_staff', $5, $6, 'Field Service Staff', 'active', 'en')`,
        [item.name, item.mobile, cleanEmail, passwordHash, deptId, item.employee_id]
      );
      createdCount++;
      console.log(`Created staff: ${item.name} (${item.employee_id}) -> Dept ${deptId}`);
    }
  }

  // Summary per department verification
  console.log('\n--- VERIFICATION OF SERVICE STAFF COUNTS PER DEPARTMENT ---');
  for (const d of (deptsRes.rows || [])) {
    const res = await query(
      `SELECT COUNT(*) as count FROM users WHERE (role = 'service_staff' OR role = 'staff') AND (department_id = $1 OR CAST(department_id AS TEXT) = $1) AND LOWER(COALESCE(status, 'active')) = 'active'`,
      [d.id]
    );
    console.log(`${d.code || 'Dept'} (${d.name}): ${res.rows[0]?.count || 0} Active Staff`);
  }

  console.log(`\nSeeding completed cleanly! Created: ${createdCount}, Updated: ${updatedCount}`);
}

module.exports = seedServiceStaff;

if (require.main === module) {
  seedServiceStaff()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed to seed Service Staff:', err);
      process.exit(1);
    });
}

