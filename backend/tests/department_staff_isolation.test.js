const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const { initDatabase, query } = require('../src/config/db');
const { generateToken } = require('../src/middleware/auth');
const departmentRoutes = require('../src/routes/department.routes');
const authRoutes = require('../src/routes/auth.routes');

describe('Department Head Staff Isolation & Security Suite', () => {
  let server;
  let baseUrl;

  // Generate tokens for test users
  const pwdHeadToken = generateToken({
    id: 11,
    name: 'Rahul Kumar',
    email: 'rahul.kumar@nagarsetu.gov.in',
    role: 'department_head',
    department_id: 1,
    department_code: 'PWD',
    department_name: 'Public Works Department (PWD)'
  });

  const sanHeadToken = generateToken({
    id: 12,
    name: 'Priya Patil',
    email: 'priya.patil@nagarsetu.gov.in',
    role: 'department_head',
    department_id: 2,
    department_code: 'SAN',
    department_name: 'Sanitation & Solid Waste Management'
  });

  const wtrHeadToken = generateToken({
    id: 13,
    name: 'Vikram Patil',
    email: 'vikram.patil@nagarsetu.gov.in',
    role: 'department_head',
    department_id: 3,
    department_code: 'WTR',
    department_name: 'Water Supply & Sewerage Board'
  });

  const cityAdminToken = generateToken({
    id: 1,
    name: 'City Admin',
    email: 'admin@nagarsetu.gov.in',
    role: 'city_admin',
    department_id: null
  });

  before(async () => {
    await initDatabase();
    const seedServiceStaff = require('../src/scripts/seedServiceStaff');
    if (seedServiceStaff) {
      await seedServiceStaff();
    }

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use('/api/department', departmentRoutes);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    }
  });

  test('1. Department Head (PWD) receives ONLY PWD field staff', async () => {
    const res = await fetch(`${baseUrl}/api/department/staff`, {
      headers: { Authorization: `Bearer ${pwdHeadToken}` }
    });

    assert.strictEqual(res.status, 200, 'Should return HTTP 200');
    const data = await res.json();
    assert.ok(Array.isArray(data.staff), 'Should return staff array');
    assert.strictEqual(data.staff.length, 6, 'PWD should have exactly 6 staff members');

    for (const staff of data.staff) {
      const isPwd = staff.employee_id.startsWith('STF-PWD') || String(staff.department_id) === '1';
      assert.ok(isPwd, `Staff ${staff.name} (${staff.employee_id}) must belong to PWD`);
      assert.ok(!staff.employee_id.startsWith('STF-SAN'), `Sanitation staff ${staff.name} must not be present`);
    }

    assert.strictEqual(data.summary.totalStaff, 6, 'Summary totalStaff should match filtered count');
  });

  test('2. Department Head CANNOT bypass filter via query params (?department_id=2, ?department=SAN, ?department_code=WTR)', async () => {
    // Attempt 1: Query by department_id=2 (Sanitation)
    const res1 = await fetch(`${baseUrl}/api/department/staff?department_id=2`, {
      headers: { Authorization: `Bearer ${pwdHeadToken}` }
    });
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    assert.strictEqual(data1.staff.length, 6, 'Tampered query department_id=2 must still return only 6 PWD staff');
    assert.ok(data1.staff.every(s => s.employee_id.startsWith('PWD-STF') || String(s.department_id) === '1'), 'All returned staff must still be PWD');

    // Attempt 2: Query by department=SAN
    const res2 = await fetch(`${baseUrl}/api/department/staff?department=SAN`, {
      headers: { Authorization: `Bearer ${pwdHeadToken}` }
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.staff.length, 6, 'Tampered query department=SAN must still return only 6 PWD staff');

    // Attempt 3: Query by department_code=WTR
    const res3 = await fetch(`${baseUrl}/api/department/staff?department_code=WTR`, {
      headers: { Authorization: `Bearer ${pwdHeadToken}` }
    });
    assert.strictEqual(res3.status, 200);
    const data3 = await res3.json();
    assert.strictEqual(data3.staff.length, 6, 'Tampered query department_code=WTR must still return only 6 PWD staff');
  });

  test('3. Department Head (Sanitation) receives ONLY Sanitation staff and NO PWD staff', async () => {
    const res = await fetch(`${baseUrl}/api/department/staff`, {
      headers: { Authorization: `Bearer ${sanHeadToken}` }
    });

    assert.strictEqual(res.status, 200, 'Should return HTTP 200');
    const data = await res.json();
    assert.ok(Array.isArray(data.staff), 'Should return staff array');
    assert.strictEqual(data.staff.length, 5, 'Sanitation should have exactly 5 staff members');

    for (const staff of data.staff) {
      const isSan = staff.employee_id.startsWith('SAN-STF') || String(staff.department_id) === '2';
      assert.ok(isSan, `Staff ${staff.name} (${staff.employee_id}) must belong to Sanitation`);
      assert.ok(!staff.employee_id.startsWith('PWD-STF'), `PWD staff must not be present`);
    }
  });

  test('3b. Department Head (Water WTR) receives ONLY Water staff and NO PWD staff', async () => {
    const res = await fetch(`${baseUrl}/api/department/staff`, {
      headers: { Authorization: `Bearer ${wtrHeadToken}` }
    });

    assert.strictEqual(res.status, 200, 'Should return HTTP 200');
    const data = await res.json();
    assert.ok(Array.isArray(data.staff), 'Should return staff array');
    assert.strictEqual(data.staff.length, 5, 'Water department should have exactly 5 staff members');

    for (const staff of data.staff) {
      const isWtr = staff.employee_id.startsWith('WTR-STF') || String(staff.department_id) === '3';
      assert.ok(isWtr, `Staff ${staff.name} (${staff.employee_id}) must belong to Water WTR`);
      assert.ok(!staff.employee_id.startsWith('PWD-STF'), `PWD staff must not be present`);
    }
  });

  test('4. City Admin sees ALL staff records (all 36 staff preserved)', async () => {
    const res = await fetch(`${baseUrl}/api/department/staff`, {
      headers: { Authorization: `Bearer ${cityAdminToken}` }
    });

    assert.strictEqual(res.status, 200, 'City Admin must receive HTTP 200');
    const data = await res.json();
    assert.ok(Array.isArray(data.staff), 'Should return staff array');
    assert.strictEqual(data.staff.length, 36, 'City Admin must see all 36 staff records across all departments');

    // Admin can also filter optionally when requested
    const filteredRes = await fetch(`${baseUrl}/api/department/staff?department_id=1`, {
      headers: { Authorization: `Bearer ${cityAdminToken}` }
    });
    const filteredData = await filteredRes.json();
    assert.strictEqual(filteredData.staff.length, 6, 'City Admin filtering for department 1 must see 6 PWD staff');
  });

  test('5. Department Head (PWD) assignable staff endpoint returns ONLY PWD staff', async () => {
    const res = await fetch(`${baseUrl}/api/department/staff/assignable`, {
      headers: { Authorization: `Bearer ${pwdHeadToken}` }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.staff));
    assert.ok(data.staff.length > 0, 'Should return assignable staff');
    for (const staff of data.staff) {
      assert.ok(staff.employee_id.startsWith('PWD-STF') || String(staff.department_id) === '1' || String(staff.department_id) === '8ed9f760-1314-427c-a515-c2a54d6df6d8' || staff.department_code === 'PWD');
    }
  });

  test('6. Cross-department staff assignment is rejected with 403 Forbidden', async () => {
    // Insert a test PWD complaint
    const ins = await query(`
      INSERT INTO complaints (complaint_number, title, department_id, status, citizen_id, photo_before_url, category, latitude, longitude, location_source)
      VALUES ('CMP-TEST-PWD-01', 'Pothole on Main Rd', 1, 'Submitted', 1, 'https://example.com/photo.jpg', 'Roads', 19.9975, 73.7898, 'GPS')
    `);
    const compRes = await query(`SELECT id FROM complaints WHERE complaint_number = 'CMP-TEST-PWD-01'`);
    const complaintId = compRes.rows[0].id;

    // Dynamically query actual PWD staff and Sanitation staff from database
    const pwdStaffRow = await query(`SELECT id FROM users WHERE (department_id = 1 OR department_id = '8ed9f760-1314-427c-a515-c2a54d6df6d8') AND (role = 'service_staff' OR role = 'staff') LIMIT 1`);
    const sanStaffRow = await query(`SELECT id FROM users WHERE (department_id = 2 OR department_id = '9cabc1f2-fd10-48dd-a5cb-01d05197de22') AND (role = 'service_staff' OR role = 'staff') LIMIT 1`);
    const pwdStaffId = pwdStaffRow.rows[0]?.id || 101;
    const sanStaffId = sanStaffRow.rows[0]?.id || 106;

    // PWD Dept Head attempts to assign Sanitation staff member
    const resForbidden = await fetch(`${baseUrl}/api/department/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pwdHeadToken}`
      },
      body: JSON.stringify({
        complaint_id: complaintId,
        staff_id: sanStaffId
      })
    });

    assert.strictEqual(resForbidden.status, 403, 'Cross-department staff assignment must return 403 Forbidden');
    const errData = await resForbidden.json();
    assert.ok(errData.error.includes('Forbidden'), 'Error message must indicate Forbidden');

    // PWD Dept Head assigns PWD staff member -> must succeed
    const resSuccess = await fetch(`${baseUrl}/api/department/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pwdHeadToken}`
      },
      body: JSON.stringify({
        complaint_id: complaintId,
        staff_id: pwdStaffId
      })
    });

    assert.strictEqual(resSuccess.status, 200, 'In-department staff assignment must succeed');
    const succData = await resSuccess.json();
    assert.strictEqual(succData.success, true);
    assert.strictEqual(succData.staff_id, pwdStaffId);
  });
});
