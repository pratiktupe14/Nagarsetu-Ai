const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const http = require('http');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { generateToken } = require('../src/middleware/auth');
const { query } = require('../src/config/db');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('NAGARSETU 3.1 — Citizen Feedback With Visible Name Integration', () => {
  let complaintId;
  let complaintNumber;

  // Tokens
  const ownerCitizenToken = 'demo-token-citizen'; // Maps to Pratik Dilip Tupe, id 58 / e2a4338c-5d49-4ae3-b766-40d99fb26f87
  const otherCitizenToken = generateToken({
    id: 999888,
    name: 'Sneha Kulkarni',
    email: 'sneha.kulkarni@example.com',
    role: 'citizen'
  });
  const adminToken = 'demo-token-city-admin';
  const pwdHodToken = 'demo-token-dept-head'; // PWD Department Head
  const wtrHodToken = 'demo-token-wtr-head';  // Water Department Head
  const assignedStaffToken = 'demo-token-pwd-staff'; // Rohit More, id 23, PWD
  const unassignedStaffToken = generateToken({
    id: 9944,
    name: 'Unassigned Staff Member',
    email: 'unassigned@nagarsetu.gov.in',
    role: 'service_staff',
    department_id: '8ed9f760-1314-427c-a515-c2a54d6df6d8'
  });

  const feedbackReviewText = 'Excellent asphalt patching! Smooth road and finished within 24 hours.';
  const feedbackStarRating = 5;

  before(async () => {
    // Ensure Pratik Dilip Tupe is present in SQLite users table
    try {
      await query(`
        INSERT OR IGNORE INTO users (id, name, mobile, email, role, status)
        VALUES ('e2a4338c-5d49-4ae3-b766-40d99fb26f87', 'Pratik Dilip Tupe', '8788562103', 'citizen8788@nagarsetu.gov.in', 'citizen', 'active')
      `);
      await query(`
        INSERT OR IGNORE INTO users (id, name, mobile, email, role, status)
        VALUES (58, 'Pratik Dilip Tupe', '8788562103', 'citizen8788@nagarsetu.gov.in', 'citizen', 'active')
      `);
    } catch (e) {
      // ignore if exists
    }
  });

  test('1. Setup: Submit isolated complaint under citizen Pratik Dilip Tupe', async () => {
    const lat = 18.5204 + (Math.random() * 0.05);
    const lng = 73.8567 + (Math.random() * 0.05);
    const payload = {
      category: 'Roads',
      title: 'Deep pothole on Tupe Vasti DP Road',
      description: 'Vehicle damage risk. Urgent patching needed.',
      priority: 'High',
      latitude: lat,
      longitude: lng,
      location_source: 'device_gps',
      location_accuracy_m: 10,
      location_address: 'Tupe Vasti, Hadapsar, Pune',
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
        'Authorization': `Bearer ${ownerCitizenToken}`
      }
    }, payload);

    assert.strictEqual(res.status, 201, `Failed to submit complaint: ${JSON.stringify(res.body)}`);
    complaintId = res.body.complaint_id;
    complaintNumber = res.body.complaint_number;
    assert.ok(complaintId);
    assert.ok(complaintNumber);

    // Assign to Rohit More (id 23) and mark Resolved for testing feedback
    await query(
      `UPDATE complaints
       SET status = 'Resolved',
           assigned_staff_id = '23',
           assigned_staff_name = 'Rohit More',
           assigned_staff_email = 'rohit.more@nagarsetu.gov.in',
           department_id = '8ed9f760-1314-427c-a515-c2a54d6df6d8'
       WHERE id = ?`,
      [complaintId]
    );

    // Insert assignment record (let SQLite autoincrement integer id)
    await query(
      `INSERT INTO assignments (complaint_id, staff_id, assigned_by, assigned_at, resolved_at)
       VALUES (?, 23, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [complaintId]
    );
  });

  test('2. Unauthorized citizen cannot submit feedback for another user complaint', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${otherCitizenToken}`
      }
    }, {
      rating: 4,
      comment: 'Attempted unauthorized feedback'
    });

    assert.strictEqual(res.status, 403, 'Must return 403 Forbidden for non-owner citizen');
  });

  test('3. Staff cannot submit feedback (citizen-only action)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${assignedStaffToken}`
      }
    }, {
      rating: 5,
      comment: 'Staff trying to submit review'
    });

    assert.strictEqual(res.status, 403, 'Must return 403 Forbidden for staff role submitting feedback');
  });

  test('4. Citizen submits rating and review (ignoring client-supplied name spoofing)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerCitizenToken}`
      }
    }, {
      rating: feedbackStarRating,
      comment: feedbackReviewText,
      // Attempt to spoof registered name in body - backend must ignore and resolve strictly from DB
      citizen_name: 'Fake Spoofed Name 999'
    });

    assert.strictEqual(res.status, 200, `Expected 200, got: ${JSON.stringify(res.body)}`);
    assert.match(res.body.message, /successfully/i);
  });

  test('5. Duplicate feedback submission is prevented', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerCitizenToken}`
      }
    }, {
      rating: 1,
      comment: 'Second attempt should fail'
    });

    assert.strictEqual(res.status, 400, 'Duplicate feedback submission must be rejected with 400 Bad Request');
  });

  test('6. City Admin retrieves feedback: Registered name visible, correct rating & review', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.complaint_number, complaintNumber);
    assert.strictEqual(res.body.citizen_name, 'Pratik Dilip Tupe', 'Admin must see registered citizen name');
    assert.notStrictEqual(res.body.citizen_name, 'Anonymous Citizen', 'Must remove Anonymous Citizen');
    assert.notStrictEqual(res.body.citizen_name, 'Fake Spoofed Name 999', 'Must not trust spoofed body name');
    assert.strictEqual(res.body.rating, feedbackStarRating);
    assert.strictEqual(res.body.review, feedbackReviewText);
    assert.ok(res.body.submission_date, 'Must include feedback submission date');

    // Verify zero PII leak
    assert.strictEqual(res.body.mobile, undefined);
    assert.strictEqual(res.body.citizen_mobile, undefined);
    assert.strictEqual(res.body.email, undefined);
    assert.strictEqual(res.body.password, undefined);
    assert.strictEqual(res.body.password_hash, undefined);
    assert.strictEqual(res.body.residential_address, undefined);
  });

  test('7. Authorized Department Head (PWD) retrieves exact same feedback information', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${pwdHodToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.complaint_number, complaintNumber);
    assert.strictEqual(res.body.citizen_name, 'Pratik Dilip Tupe', 'HOD must see registered citizen name');
    assert.strictEqual(res.body.rating, feedbackStarRating);
    assert.strictEqual(res.body.review, feedbackReviewText);
    assert.ok(res.body.submission_date);

    // Verify zero PII leak
    assert.strictEqual(res.body.citizen_mobile, undefined);
    assert.strictEqual(res.body.email, undefined);
  });

  test('8. Assigned Field Staff (Rohit More) retrieves exact same feedback information', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${assignedStaffToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.complaint_number, complaintNumber);
    assert.strictEqual(res.body.citizen_name, 'Pratik Dilip Tupe', 'Assigned staff must see registered citizen name');
    assert.strictEqual(res.body.rating, feedbackStarRating);
    assert.strictEqual(res.body.review, feedbackReviewText);
    assert.ok(res.body.submission_date);

    // Verify zero PII leak
    assert.strictEqual(res.body.citizen_mobile, undefined);
    assert.strictEqual(res.body.email, undefined);
  });

  test('9. Unassigned staff is blocked from accessing feedback (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${unassignedStaffToken}`
      }
    });

    assert.strictEqual(res.status, 403, 'Unassigned staff must be denied access');
    assert.match(res.body.error, /not assigned/i);
  });

  test('10. Different department HOD (Water) is blocked from accessing PWD feedback (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${wtrHodToken}`
      }
    });

    assert.strictEqual(res.status, 403, 'Cross-department HOD access must be denied');
  });

  test('11. Unauthorized citizen is blocked from viewing feedback (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${otherCitizenToken}`
      }
    });

    assert.strictEqual(res.status, 403, 'Other citizen must be denied access to feedback');
  });

  test('12. Full complaint detail endpoint exposes registered name and feedback object to Admin, HOD, and Staff without PII leaks', async () => {
    // City Admin Check
    const adminRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminRes.status, 200);
    assert.strictEqual(adminRes.body.complaint.citizen_name, 'Pratik Dilip Tupe');
    assert.ok(adminRes.body.complaint.feedback, 'Feedback object must be attached to complaint detail');
    assert.strictEqual(adminRes.body.complaint.feedback.citizen_name, 'Pratik Dilip Tupe');
    assert.strictEqual(adminRes.body.complaint.feedback.rating, 5);
    assert.strictEqual(adminRes.body.complaint.feedback.review, feedbackReviewText);
    assert.ok(!adminRes.body.complaint.citizen_mobile, 'Citizen mobile must be redacted for non-owner');
    assert.ok(!adminRes.body.complaint.password_hash, 'Password hash must be redacted');

    // HOD Check
    const hodRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${pwdHodToken}` }
    });
    assert.strictEqual(hodRes.status, 200);
    assert.strictEqual(hodRes.body.complaint.citizen_name, 'Pratik Dilip Tupe');
    assert.ok(hodRes.body.complaint.feedback);
    assert.strictEqual(hodRes.body.complaint.feedback.citizen_name, 'Pratik Dilip Tupe');
    assert.strictEqual(hodRes.body.complaint.feedback.rating, 5);
    assert.ok(!hodRes.body.complaint.citizen_mobile, 'Citizen mobile must be redacted for HOD');

    // Assigned Staff Check
    const staffRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${assignedStaffToken}` }
    });
    assert.strictEqual(staffRes.status, 200);
    assert.strictEqual(staffRes.body.complaint.citizen_name, 'Pratik Dilip Tupe');
    assert.ok(staffRes.body.complaint.feedback);
    assert.strictEqual(staffRes.body.complaint.feedback.citizen_name, 'Pratik Dilip Tupe');
    assert.strictEqual(staffRes.body.complaint.feedback.rating, 5);
    assert.ok(!staffRes.body.complaint.citizen_mobile, 'Citizen mobile must be redacted for Staff');
  });

  test('13. Multi-portal list endpoints include consistent citizen_name and feedback object', async () => {
    // 1. Admin List
    const adminListRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/complaints?scope=all',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminListRes.status, 200);
    const adminComp = adminListRes.body.complaints.find(c => String(c.id) === String(complaintId) || c.complaint_number === complaintNumber);
    assert.ok(adminComp, 'Complaint must be in Admin list');
    assert.strictEqual(adminComp.citizen_name, 'Pratik Dilip Tupe');
    assert.ok(adminComp.feedback, 'Admin list item must have feedback object');
    assert.strictEqual(adminComp.feedback.citizen_name, 'Pratik Dilip Tupe');
    assert.strictEqual(adminComp.feedback.rating, 5);

    // 2. Department Head List
    const hodListRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/department/complaints',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${pwdHodToken}` }
    });
    assert.strictEqual(hodListRes.status, 200);
    const hodComp = hodListRes.body.complaints.find(c => String(c.id) === String(complaintId) || c.complaint_number === complaintNumber);
    assert.ok(hodComp, 'Complaint must be in HOD list');
    assert.strictEqual(hodComp.citizen_name, 'Pratik Dilip Tupe');
    assert.ok(hodComp.feedback, 'HOD list item must have feedback object');
    assert.strictEqual(hodComp.feedback.citizen_name, 'Pratik Dilip Tupe');
    assert.strictEqual(hodComp.feedback.rating, 5);

    // 3. Staff Tasks List
    const staffListRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/staff/tasks',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${assignedStaffToken}` }
    });
    assert.strictEqual(staffListRes.status, 200);
    const staffTask = staffListRes.body.tasks.find(t => String(t.id) === String(complaintId) || t.complaint_number === complaintNumber);
    assert.ok(staffTask, 'Task must be in Staff tasks list');
    assert.strictEqual(staffTask.citizen_name, 'Pratik Dilip Tupe');
    assert.ok(staffTask.feedback, 'Staff task must have feedback object');
    assert.strictEqual(staffTask.feedback.citizen_name, 'Pratik Dilip Tupe');
    assert.strictEqual(staffTask.feedback.rating, 5);
  });

  test('14. Fallback behavior: When registered citizen name is missing, display "Citizen"', async () => {
    // Insert orphan complaint with autoincremented id
    const insRes = await query(
      `INSERT INTO complaints (complaint_number, citizen_id, title, description, category, priority, status, department_id, assigned_staff_id, created_at, photo_before_url, latitude, longitude, location_source)
       VALUES (?, '9999999', 'Broken Bench', 'Bench broken in park', 'Roads', 'Low', 'Resolved', '8ed9f760-1314-427c-a515-c2a54d6df6d8', '23', CURRENT_TIMESTAMP, '/uploads/civic-default.jpg', 18.52, 73.85, 'device_gps')`,
      [`FALLBACK-${Date.now()}`]
    );
    const orphanComplaintId = insRes.rows?.[0]?.id;
    assert.ok(orphanComplaintId);

    await query(
      `INSERT INTO feedback (complaint_id, rating, comment)
       VALUES (?, 4, 'Good job repairing the bench')`,
      [orphanComplaintId]
    );

    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${orphanComplaintId}/feedback`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.citizen_name, 'Citizen', 'When user is unknown, display fallback "Citizen" rather than inventing an identity');
    assert.strictEqual(res.body.rating, 4);

    // Clean up fallback test row
    await query(`DELETE FROM feedback WHERE complaint_id = ?`, [orphanComplaintId]);
    await query(`DELETE FROM complaints WHERE id = ?`, [orphanComplaintId]);
  });
});
