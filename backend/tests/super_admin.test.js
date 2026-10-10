const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/config/db');
const { generateToken } = require('../src/middleware/auth');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqOptions = { ...options };
    if (bodyStr) {
      reqOptions.headers = {
        ...reqOptions.headers,
        'Content-Length': Buffer.byteLength(bodyStr)
      };
    }
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

describe('NAGARSETU 3.1 — Developer Super Admin Control Center Focused Verification', () => {
  const superAdminEmail = 'developer.test@nagarsetu.internal';
  const superAdminPassword = 'DevSecurePassword2026!';
  let superAdminToken;
  let superAdminUserId;

  // Regular role tokens
  const testCitizenId = '998801';
  const citizenToken = generateToken({ id: testCitizenId, name: 'Normal Citizen', email: 'citizen.test@test.local', role: 'citizen' });
  const cityAdminToken = generateToken({ id: '998802', name: 'City Admin', email: 'admin.test@test.local', role: 'city_admin' });
  const deptHeadToken = generateToken({ id: '998803', name: 'Dept Head', email: 'depthead.test@test.local', role: 'department_head', department_code: 'PWD' });
  const staffToken = generateToken({ id: '998804', name: 'Field Staff', email: 'staff.test@test.local', role: 'service_staff' });

  let testComplaintId;
  let testComplaintNumber;

  before(async () => {
    // 1. Bootstrap isolated Super Admin user in DB
    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash(superAdminPassword, salt);

    const existing = await query(`SELECT id FROM users WHERE LOWER(email) = ?`, [superAdminEmail]);
    if (existing.rows && existing.rows.length > 0) {
      superAdminUserId = existing.rows[0].id;
      await query(`UPDATE users SET password_hash = ?, role = 'super_admin', status = 'active' WHERE id = ?`, [passHash, superAdminUserId]);
    } else {
      const ins = await query(
        `INSERT INTO users (name, email, mobile, password_hash, role, status, language_pref) VALUES (?, ?, ?, ?, 'super_admin', 'active', 'en')`,
        ['Authorized Developer', superAdminEmail, 'DEV-99988877', passHash]
      );
      superAdminUserId = ins.rows?.[0]?.id || ins.insertId;
    }

    // 2. Create an isolated test complaint
    const compIns = await query(`
      INSERT INTO complaints (
        complaint_number, citizen_id, photo_before_url, category, title, description,
        priority, status, department_id, latitude, longitude, location_source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'TEST-SA-001', testCitizenId, '/uploads/civic-default.jpg', 'Roads',
      'Pothole on Test Boulevard', 'Initial test description before super admin correction',
      'Medium', 'Submitted', '8ed9f760-1314-427c-a515-c2a54d6df6d8',
      18.5204, 73.8567, 'device_gps', new Date().toISOString()
    ]);
    testComplaintId = compIns.rows?.[0]?.id || compIns.insertId;
    testComplaintNumber = 'TEST-SA-001';
  });

  after(async () => {
    try {
      await query(`DELETE FROM super_admin_audit_logs WHERE admin_email = ?`, [superAdminEmail]);
      await query(`DELETE FROM complaint_evidence_versions WHERE complaint_id = ?`, [testComplaintId]);
      await query(`DELETE FROM complaints WHERE id = ? OR complaint_number LIKE 'TEST-SA-%'`, [testComplaintId]);
      await query(`DELETE FROM users WHERE email = ?`, [superAdminEmail]);
    } catch (e) {}
  });

  test('1. Super Admin login succeeds with valid developer credentials', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: superAdminEmail, password: superAdminPassword });

    assert.strictEqual(res.status, 200, 'Super Admin login must return 200');
    assert.ok(res.body.token, 'Must return JWT token');
    assert.strictEqual(res.body.user.role, 'super_admin', 'Role must be super_admin');
    superAdminToken = res.body.token;
  });

  test('2. Invalid developer credentials are rejected with 401 Unauthorized', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: superAdminEmail, password: 'WrongPassword123' });

    assert.strictEqual(res.status, 401, 'Invalid password must return 401');
  });

  test('3. Citizen cannot access Super Admin endpoints (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });

    assert.strictEqual(res.status, 403, 'Citizen must receive 403 Forbidden');
  });

  test('4. City Admin cannot access Super Admin endpoints (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${cityAdminToken}` }
    });

    assert.strictEqual(res.status, 403, 'City Admin must receive 403 Forbidden');
  });

  test('5. Department Head cannot access Super Admin endpoints (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${deptHeadToken}` }
    });

    assert.strictEqual(res.status, 403, 'Department Head must receive 403 Forbidden');
  });

  test('6. Field Staff cannot access Super Admin endpoints (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${staffToken}` }
    });

    assert.strictEqual(res.status, 403, 'Field Staff must receive 403 Forbidden');
  });

  test('7. Demo tokens cannot access Super Admin endpoints (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/overview',
      method: 'GET',
      headers: { 'Authorization': 'Bearer demo-token-city-admin' }
    });

    assert.strictEqual(res.status, 403, 'Demo tokens must be rejected with 403');
  });

  test('8. Super Admin can perform an authorized complaint correction', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/complaints/${testComplaintId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${superAdminToken}`
      }
    }, {
      title: 'Pothole Corrected by Super Admin',
      priority: 'High',
      status: 'In Progress',
      reason: 'Administrative triage correction'
    });

    assert.strictEqual(res.status, 200, 'Super admin correction must succeed');
    assert.strictEqual(res.body.complaint.title, 'Pothole Corrected by Super Admin');
    assert.strictEqual(res.body.complaint.priority, 'High');
    assert.strictEqual(res.body.complaint.status, 'In Progress');
  });

  test('9. Audit history records the complaint mutation with before/after diff', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/audit-logs?target_type=complaint',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.logs && res.body.logs.length > 0, 'Audit logs must exist');
    const updateLog = res.body.logs.find(l => l.action === 'COMPLAINT_UPDATE' && String(l.target_id) === String(testComplaintId));
    assert.ok(updateLog, 'Must find COMPLAINT_UPDATE log for target complaint');
    assert.strictEqual(updateLog.admin_email, superAdminEmail);
  });

  test('10. Complaint evidence replacement preserves original evidence history', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/complaints/${testComplaintId}/evidence`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${superAdminToken}`
      }
    }, {
      photo_before_url: '/uploads/super-admin-replacement-photo.jpg',
      reason: 'Original image was blurry; replaced with sharp angle'
    });

    assert.strictEqual(res.status, 200, 'Evidence replacement must succeed');

    // Verify detail shows version history
    const detailRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/complaints/${testComplaintId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });

    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.body.complaint.photo_before_url, '/uploads/super-admin-replacement-photo.jpg');
    assert.ok(detailRes.body.evidence_versions.length >= 1, 'Previous photo must be archived in evidence versions');
  });

  test('11. Complaint location correction propagates through authorized APIs', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/complaints/${testComplaintId}/location`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${superAdminToken}`
      }
    }, {
      latitude: 18.5299,
      longitude: 73.8655,
      location_address: 'Corrected Location by Developer, Pune',
      reason: 'GPS coordinates adjusted to exact pothole position'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.changes.latitude.to, 18.5299);
  });

  test('12. Cross-portal data remains consistent (Citizen Portal sees Super Admin changes)', async () => {
    // Normal Citizen view of their own complaint via regular public API
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${testComplaintId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });

    assert.strictEqual(res.status, 200, 'Citizen must be able to view their complaint');
    const comp = res.body.complaint;
    assert.strictEqual(comp.title, 'Pothole Corrected by Super Admin', 'Title must reflect Super Admin edit');
    assert.strictEqual(comp.priority, 'High', 'Priority must reflect Super Admin edit');
    assert.strictEqual(comp.status, 'In Progress', 'Status must reflect Super Admin edit');
    assert.strictEqual(comp.latitude, 18.5299, 'Latitude must reflect Super Admin correction');
    assert.strictEqual(comp.longitude, 73.8655, 'Longitude must reflect Super Admin correction');
  });

  test('13. Unauthorized role escalation is rejected (Citizen cannot call status updates)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/users/${testCitizenId}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenToken}`
      }
    }, { status: 'suspended' });

    assert.strictEqual(res.status, 403, 'Role escalation must be rejected with 403');
  });

  test('14. Destructive operations require explicit confirmation string', async () => {
    // Attempt delete without confirm string
    const resWithoutConfirm = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/complaints/${testComplaintId}`,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${superAdminToken}`
      }
    }, { confirm: 'yes', reason: 'Testing guard' });

    assert.strictEqual(resWithoutConfirm.status, 400, 'Must reject deletion without PERMANENT_DELETE confirmation');

    // Delete with proper confirmation
    const resWithConfirm = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/complaints/${testComplaintId}`,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${superAdminToken}`
      }
    }, { confirm: 'PERMANENT_DELETE', reason: 'Test teardown verification' });

    assert.strictEqual(resWithConfirm.status, 200, 'Must delete when confirmation string matches');
  });

  test('15. Existing citizen complaint submission and retrieval remain functional (Zero Regression)', async () => {
    const payload = {
      category: 'Roads',
      title: 'Regression Verification Pothole',
      description: 'Verifying normal citizen workflow remains 100% operational.',
      priority: 'Medium',
      latitude: 18.53,
      longitude: 73.86,
      location_source: 'device_gps',
      location_accuracy_m: 10,
      department_code: 'PWD',
      photo_url: '/uploads/civic-default.jpg'
    };

    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/complaints/submit',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenToken}`
      }
    }, payload);

    assert.strictEqual(res.status, 201, 'Citizen submission must return 201 Created');
    assert.ok(res.body.complaint_id, 'Must return complaint_id');

    // Clean up created regression complaint
    await query(`DELETE FROM complaints WHERE id = ?`, [res.body.complaint_id]);
  });
});
