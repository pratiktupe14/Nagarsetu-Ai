const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { query, initDatabase } = require('../src/config/db');
const { resolveDepartmentByCode, CANONICAL_DEPARTMENTS } = require('../src/services/departmentService');

const app = require('../src/app');
let server;
let BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
let externalAiRunning = false;

const POTHOLE_IMG = path.resolve(__dirname, '../uploads/060423ab-81c3-4f4a-a6ab-0449404db247.jpg');
const CARDBOARD_IMG = path.resolve(__dirname, '../uploads/0ed0346b-10e8-4009-9928-80fce15a9749.jpg');

test.before(async () => {
  await initDatabase();

  let backendRunning = false;
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(500) });
    if (res.ok) backendRunning = true;
  } catch {}

  if (!backendRunning) {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    BASE_URL = `http://127.0.0.1:${server.address().port}`;
  }

  try {
    const pythonUrl = process.env.PYTHON_AI_URL || 'http://localhost:8000/analyze';
    const healthUrl = pythonUrl.replace(/\/analyze\/?$/, '/health');
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      externalAiRunning = data.reachable !== false;
    }
  } catch {
    externalAiRunning = false;
  }
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('1. Database Verification & Canonical Department Resolver', async () => {
  // Test resolveDepartmentByCode for PWD
  const pwdDept = await resolveDepartmentByCode('PWD');
  assert.ok(pwdDept, 'PWD department should resolve');
  assert.strictEqual(pwdDept.code, 'PWD', 'Department code should be PWD');
  assert.strictEqual(pwdDept.id, '8ed9f760-1314-427c-a515-c2a54d6df6d8', 'Authoritative PWD ID must be canonical UUID');
  assert.strictEqual(pwdDept.name, 'Public Works Department');
  assert.strictEqual(pwdDept.status, 'active');

  // Test resolveDepartmentByCode for SAN
  const sanDept = await resolveDepartmentByCode('SAN');
  assert.ok(sanDept, 'SAN department should resolve');
  assert.strictEqual(sanDept.code, 'SAN', 'Department code should be SAN');
  assert.strictEqual(sanDept.id, '9cabc1f2-fd10-48dd-a5cb-01d05197de22', 'Authoritative SAN ID must be canonical UUID');
  assert.strictEqual(sanDept.status, 'active');

  // Inspect actual database departments table
  const dbRows = await query('SELECT id, code, name, status FROM departments');
  assert.ok(dbRows.rows && dbRows.rows.length >= 7, 'Database must contain all 7 canonical departments');

  const dbPwd = dbRows.rows.find(d => d.code === 'PWD');
  assert.ok(dbPwd, 'PWD row must exist in departments table');
  assert.strictEqual(dbPwd.id, '8ed9f760-1314-427c-a515-c2a54d6df6d8', 'departments.id for PWD must be UUID in DB');
  assert.strictEqual(dbPwd.status, 'active', 'departments.status for PWD must be active');

  const dbSan = dbRows.rows.find(d => d.code === 'SAN');
  assert.ok(dbSan, 'SAN row must exist in departments table');
  assert.strictEqual(dbSan.id, '9cabc1f2-fd10-48dd-a5cb-01d05197de22', 'departments.id for SAN must be UUID in DB');
});

test('2. Complete PWD Pothole Flow: Image -> LangGraph -> DB UUID -> Complaint -> PWD Head', async () => {
  assert.ok(fs.existsSync(POTHOLE_IMG), `Test image must exist at ${POTHOLE_IMG}`);

  // Step 2a: AI analysis
  const form = new FormData();
  form.append('image', fs.readFileSync(POTHOLE_IMG), 'test_pothole.jpg');

  const aiRes = await fetch(`${BASE_URL}/api/ai/analyze`, {
    method: 'POST',
    body: form.getBuffer(),
    headers: {
      ...form.getHeaders(),
      'Authorization': 'Bearer demo-token-citizen'
    }
  });

  assert.strictEqual(aiRes.status, 200, 'AI analyze request should succeed');
  const aiData = await aiRes.json();
  assert.strictEqual(aiData.success, true);
  assert.strictEqual(aiData.detected, true);
  assert.strictEqual(aiData.department_code, 'PWD');
  assert.strictEqual(aiData.department_id, 1, 'AI registry ID for PWD must be 1');
  assert.ok(aiData.confidence >= 0.45, 'Confidence must be at least 45%');

  // Step 2b: Submit complaint with unique coordinates (> 100m from prior test locations)
  const uniqueLat = 19.9975 + (Math.random() * 0.05);
  const uniqueLng = 73.7898 + (Math.random() * 0.05);

  const submitPayload = {
    category: aiData.category,
    title: aiData.title,
    description: aiData.description,
    priority: aiData.priority,
    latitude: uniqueLat,
    longitude: uniqueLng,
    location_source: 'map_pin',
    department_code: aiData.department_code,
    department_id: aiData.department_id,
    photo_url: '/uploads/test-pothole-run.jpg',
    ai_model: aiData.ai_model,
    ai_confidence: aiData.ai_confidence,
    ai_status: aiData.ai_status,
    ai_detected_class: aiData.ai_detected_class,
    ai_reason: aiData.ai_reason
  };

  const submitRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify(submitPayload)
  });

  assert.strictEqual(submitRes.status, 201, 'Submit should return 201 Created');
  const submitData = await submitRes.json();
  assert.ok(submitData.complaint, 'Complaint object must be returned');
  const complaintId = submitData.complaint.id;

  // Step 2c: Query database directly
  const dbCompRes = await query(
    `SELECT c.id, c.complaint_number, c.department_id, c.ai_model, c.ai_confidence, c.ai_status, c.ai_detected_class, c.ai_reason,
            d.id as dept_table_id, d.code as dept_code, d.name as dept_name
     FROM complaints c
     JOIN departments d ON c.department_id = d.id
     WHERE c.id = ?`,
    [complaintId]
  );

  assert.ok(dbCompRes.rows && dbCompRes.rows.length === 1, 'Complaint must join cleanly with departments table');
  const savedComp = dbCompRes.rows[0];

  // Section 5 Verification Requirements:
  // complaint.department_id = departments.id
  // departments.code = "PWD"
  assert.strictEqual(savedComp.department_id, savedComp.dept_table_id, 'complaint.department_id must equal departments.id');
  assert.strictEqual(savedComp.department_id, '8ed9f760-1314-427c-a515-c2a54d6df6d8', 'Stored department_id must be canonical PWD UUID');
  assert.strictEqual(savedComp.dept_code, 'PWD', 'departments.code must be "PWD"');

  // Verify preserved AI metadata
  assert.ok(savedComp.ai_model.includes('civicmodel.pt') || savedComp.ai_model.includes('civiclens'), 'ai_model must be preserved');
  assert.ok(Number(savedComp.ai_confidence) > 0, 'ai_confidence must be preserved');
  assert.ok(['confirmed', 'suggested'].includes(savedComp.ai_status), 'ai_status must be confirmed or suggested');
  assert.strictEqual(savedComp.ai_detected_class.toLowerCase(), 'pothole', 'ai_detected_class must be Pothole');
  assert.ok(savedComp.ai_reason && savedComp.ai_reason.length > 5, 'ai_reason must be preserved');

  // Step 2d: Verify PWD Department Head sees the complaint
  const pwdHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-dept-head' }
  });
  assert.strictEqual(pwdHeadRes.status, 200);
  const pwdHeadData = await pwdHeadRes.json();
  const foundInPwd = pwdHeadData.complaints.find(c => String(c.id) === String(complaintId));
  assert.ok(foundInPwd, 'PWD Department Head MUST see the PWD complaint');
});

test('3. Complete Sanitation Cardboard Flow: Image -> LangGraph -> DB UUID -> Complaint -> SAN Head', async () => {
  assert.ok(fs.existsSync(CARDBOARD_IMG), `Test image must exist at ${CARDBOARD_IMG}`);

  // Step 3a: AI analysis
  const form = new FormData();
  form.append('image', fs.readFileSync(CARDBOARD_IMG), 'test_cardboard.jpg');

  const aiRes = await fetch(`${BASE_URL}/api/ai/analyze`, {
    method: 'POST',
    body: form.getBuffer(),
    headers: {
      ...form.getHeaders(),
      'Authorization': 'Bearer demo-token-citizen'
    }
  });

  assert.strictEqual(aiRes.status, 200);
  const aiData = await aiRes.json();
  assert.strictEqual(aiData.success, true);
  assert.strictEqual(aiData.detected, true);
  assert.strictEqual(aiData.department_code, 'SAN');
  assert.strictEqual(aiData.department_id, 2, 'AI registry ID for SAN must be 2');

  // Step 3b: Submit complaint with distinct coordinates
  const uniqueLat = 19.9123 + (Math.random() * 0.05);
  const uniqueLng = 73.8123 + (Math.random() * 0.05);

  const submitPayload = {
    category: aiData.category,
    title: aiData.title,
    description: aiData.description,
    priority: aiData.priority,
    latitude: uniqueLat,
    longitude: uniqueLng,
    location_source: 'map_pin',
    department_code: aiData.department_code,
    department_id: aiData.department_id,
    photo_url: '/uploads/test-cardboard-run.jpg',
    ai_model: aiData.ai_model,
    ai_confidence: aiData.ai_confidence,
    ai_status: aiData.ai_status,
    ai_detected_class: aiData.ai_detected_class,
    ai_reason: aiData.ai_reason
  };

  const submitRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify(submitPayload)
  });

  assert.strictEqual(submitRes.status, 201);
  const submitData = await submitRes.json();
  const complaintId = submitData.complaint.id;

  // Step 3c: Query database directly
  const dbCompRes = await query(
    `SELECT c.id, c.department_id, d.id as dept_table_id, d.code as dept_code
     FROM complaints c
     JOIN departments d ON c.department_id = d.id
     WHERE c.id = ?`,
    [complaintId]
  );

  assert.ok(dbCompRes.rows && dbCompRes.rows.length === 1);
  const savedComp = dbCompRes.rows[0];
  assert.strictEqual(savedComp.department_id, savedComp.dept_table_id);
  assert.strictEqual(savedComp.department_id, '9cabc1f2-fd10-48dd-a5cb-01d05197de22', 'Stored department_id must be canonical SAN UUID');
  assert.strictEqual(savedComp.dept_code, 'SAN');

  // Step 3d: Verify Sanitation Department Head sees the complaint
  const sanHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-sanitation-head' }
  });
  assert.strictEqual(sanHeadRes.status, 200);
  const sanHeadData = await sanHeadRes.json();
  const foundInSan = sanHeadData.complaints.find(c => String(c.id) === String(complaintId));
  assert.ok(foundInSan, 'Sanitation Department Head MUST see the SAN complaint');
});

test('4. Cross-Department Isolation', async () => {
  // Fetch PWD complaints
  const pwdRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-dept-head' }
  });
  const pwdData = await pwdRes.json();

  // Fetch SAN complaints
  const sanRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-sanitation-head' }
  });
  const sanData = await sanRes.json();

  const pwdIds = new Set(pwdData.complaints.map(c => String(c.id)));
  const sanIds = new Set(sanData.complaints.map(c => String(c.id)));

  // Strict isolation: No intersection
  for (const id of sanIds) {
    assert.strictEqual(pwdIds.has(id), false, `SAN complaint #${id} must NOT appear in PWD Head view`);
  }
  for (const id of pwdIds) {
    assert.strictEqual(sanIds.has(id), false, `PWD complaint #${id} must NOT appear in Sanitation Head view`);
  }
});

test('5. Staff Assignment by Canonical Department', async () => {
  // Query a recent PWD complaint
  const pwdCompRes = await query(
    `SELECT id FROM complaints WHERE department_id = '8ed9f760-1314-427c-a515-c2a54d6df6d8' ORDER BY id DESC LIMIT 1`
  );
  assert.ok(pwdCompRes.rows && pwdCompRes.rows.length > 0, 'Should have at least 1 PWD complaint');
  const pwdCompId = pwdCompRes.rows[0].id;

  // 1. Assign PWD staff (Rohit More, employee_id PWD-STF-004)
  const rohitRes = await query(`SELECT id FROM users WHERE employee_id = 'PWD-STF-004' OR email = 'rohit.more@nagarsetu.gov.in' LIMIT 1`);
  const rohitId = rohitRes.rows?.[0]?.id || 23;

  const sanRes = await query(`SELECT id FROM users WHERE employee_id = 'SAN-STF-001' OR email = 'prashant.mane@nagarsetu.gov.in' LIMIT 1`);
  const sanStaffId = sanRes.rows?.[0]?.id || 26;

  const assignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-dept-head'
    },
    body: JSON.stringify({
      complaint_id: pwdCompId,
      staff_id: rohitId
    })
  });

  const assignText = await assignRes.text();
  assert.strictEqual(assignRes.status, 200, `Assignment should succeed: ${assignText}`);
  const assignData = JSON.parse(assignText);
  assert.strictEqual(assignData.success, true);
  assert.strictEqual(assignData.status || assignData.complaint?.status, 'Staff Assigned');

  // Verify in database directly
  const checkDb = await query('SELECT status, assigned_staff_id, assigned_staff_name FROM complaints WHERE id = ?', [pwdCompId]);
  assert.strictEqual(checkDb.rows[0].status, 'Staff Assigned');
  assert.strictEqual(String(checkDb.rows[0].assigned_staff_id), String(rohitId));

  // 2. Security Check: Attempting to assign SAN staff to PWD complaint MUST FAIL
  const invalidAssignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-dept-head'
    },
    body: JSON.stringify({
      complaint_id: pwdCompId,
      staff_id: sanStaffId // Sanitation staff
    })
  });

  assert.strictEqual(invalidAssignRes.status, 403, 'Cross-department staff assignment must be rejected with 403 Forbidden');
});

test('6. Complete Citizen Lifecycle: Submit -> Staff Assigned -> In Progress -> Resolved -> Verified', async () => {
  // 1. Citizen submits pothole complaint
  const uniqueLat = 19.8500 + (Math.random() * 0.05);
  const uniqueLng = 73.7200 + (Math.random() * 0.05);

  const subRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify({
      category: 'Roads',
      title: 'Lifecycle Test Pothole',
      description: 'Automated full lifecycle test defect',
      priority: 'High',
      latitude: uniqueLat,
      longitude: uniqueLng,
      location_source: 'map_pin',
      department_code: 'PWD',
      photo_url: '/uploads/lifecycle-test.jpg',
      ai_model: 'civicmodel.pt',
      ai_confidence: 0.88,
      ai_status: 'confirmed',
      ai_detected_class: 'Pothole',
      ai_reason: 'Pothole defect identified with 88.0% confidence.'
    })
  });

  assert.strictEqual(subRes.status, 201);
  const compData = await subRes.json();
  const compId = compData.complaint.id;

  // 2. Department Head assigns Rohit More (PWD)
  const rohitRes6 = await query(`SELECT id FROM users WHERE employee_id = 'PWD-STF-004' OR email = 'rohit.more@nagarsetu.gov.in' LIMIT 1`);
  const rohitId6 = rohitRes6.rows?.[0]?.id || 23;

  const assignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-dept-head'
    },
    body: JSON.stringify({ complaint_id: compId, staff_id: rohitId6 })
  });
  assert.strictEqual(assignRes.status, 200);

  // 3. Field Staff sets status to 'In Progress'
  const inProgRes = await fetch(`${BASE_URL}/api/staff/task/${compId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-pwd-staff'
    },
    body: JSON.stringify({ status: 'In Progress' })
  });
  assert.strictEqual(inProgRes.status, 200);

  // 4. Field Staff resolves task with evidence photo
  const form = new FormData();
  form.append('photo', fs.readFileSync(POTHOLE_IMG), 'resolved.jpg');
  form.append('photo_after_url', '/uploads/lifecycle-resolved.jpg');
  form.append('resolution_notes', 'Pothole asphalt patch completed and compacted successfully.');
  form.append('materials_used', 'Cold mix asphalt, bitumen emulsion, plate compactor');

  const resolveRes = await fetch(`${BASE_URL}/api/staff/task/${compId}/resolve`, {
    method: 'POST',
    body: form.getBuffer(),
    headers: {
      ...form.getHeaders(),
      'Authorization': 'Bearer demo-token-pwd-staff'
    }
  });
  const resText = await resolveRes.text();
  assert.strictEqual(resolveRes.status, 200, `Resolve should return 200: ${resText}`);

  // 5. Department Head verifies and confirms resolution
  const verifyRes = await fetch(`${BASE_URL}/api/department/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-dept-head'
    },
    body: JSON.stringify({
      complaint_id: compId,
      status: 'Resolved'
    })
  });
  assert.strictEqual(verifyRes.status, 200);

  // 6. Citizen tracking check
  const trackRes = await fetch(`${BASE_URL}/api/complaints/${compId}`, {
    headers: { 'Authorization': 'Bearer demo-token-citizen' }
  });
  assert.strictEqual(trackRes.status, 200);
  const trackData = await trackRes.json();
  const c = trackData.complaint || trackData;
  assert.strictEqual(c.status, 'Resolved', 'Citizen must see complaint status as Resolved');
  assert.ok((c.photo_after_url && c.photo_after_url.length > 5) || (c.photo_after && c.photo_after.length > 5), 'Resolution evidence must be visible to citizen');
});

test('7. Consecutive Request Performance Test (Models Loaded Once)', async () => {
  for (let i = 1; i <= 3; i++) {
    const form = new FormData();
    form.append('image', fs.readFileSync(POTHOLE_IMG), 'perf.jpg');

    const startTime = Date.now();
    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });
    const elapsed = Date.now() - startTime;

    assert.strictEqual(res.status, 200, `Request #${i} should return 200 OK`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.detected, true);
    console.log(`[PERF] Request #${i} finished in ${elapsed}ms (Status: OK)`);
  }
});

test('8. Error Handling Tests', async () => {
  // Empty file upload
  const formEmpty = new FormData();
  formEmpty.append('image', Buffer.alloc(0), 'empty.jpg');

  const emptyRes = await fetch(`${BASE_URL}/api/ai/analyze`, {
    method: 'POST',
    body: formEmpty.getBuffer(),
    headers: {
      ...formEmpty.getHeaders(),
      'Authorization': 'Bearer demo-token-citizen'
    }
  });

  assert.ok(emptyRes.status >= 400, 'Empty file must return an HTTP error code');
  const errData = await emptyRes.json().catch(() => ({}));
  assert.ok(errData.success === false || errData.error !== undefined, 'Response must indicate failure');
});

test('9. Dedicated Clean Road & Road Condition Verification Suite', async (t) => {
  const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

  await t.test('9a. Clearly Clean Road -> Confirmed Clean (No PWD routing)', async () => {
    const cleanImgPath = path.join(FIXTURES_DIR, 'clean.jpg');
    assert.ok(fs.existsSync(cleanImgPath), 'Clean road fixture must exist');

    const form = new FormData();
    form.append('image', fs.readFileSync(cleanImgPath), 'clean_road.jpg');
    form.append('domain', 'road');

    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.detected, false, 'Clean road must not detect defects');
    assert.strictEqual(data.road_condition, 'clean', 'road_condition must be clean');
    assert.strictEqual(data.ai_status, 'confirmed_clean');
    assert.strictEqual(data.review_required, false);
    assert.strictEqual(data.category, 'Road Condition');
    assert.strictEqual(data.issue_type, 'No Road Defect');
    assert.strictEqual(data.severity, 'None');
    assert.strictEqual(data.priority, 'None');
    assert.strictEqual(data.department_code, null, 'Must NOT route clean road to PWD');
    assert.strictEqual(data.department_id, null, 'department_id must be null for clean road');
    assert.ok(data.confidence >= 0.75, 'Confidence must be high for confirmed clean road');
  });

  await t.test('9b. Clear Pothole -> Defective & Routes to PWD', async () => {
    assert.ok(fs.existsSync(POTHOLE_IMG), 'Pothole image must exist');

    const form = new FormData();
    form.append('image', fs.readFileSync(POTHOLE_IMG), 'pothole.jpg');
    form.append('domain', 'road');

    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.detected, true);
    assert.strictEqual(data.road_condition, 'defective');
    assert.strictEqual(data.detected_class, 'Pothole');
    assert.strictEqual(data.department_code, 'PWD');
    assert.strictEqual(data.department_id, 1);
  });

  await t.test('9c. Repaired Road Patch -> Not A Pothole (Clean or Uncertain)', async () => {
    const patchImgPath = path.join(FIXTURES_DIR, 'repaired_patch.jpg');
    assert.ok(fs.existsSync(patchImgPath), 'Repaired patch fixture must exist');

    const form = new FormData();
    form.append('image', fs.readFileSync(patchImgPath), 'repaired_patch.jpg');
    form.append('domain', 'road');

    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.notStrictEqual(data.detected_class, 'Pothole', 'Bitumen patch must NOT be marked as Pothole');
    assert.ok(['clean', 'uncertain'].includes(data.road_condition), 'Repaired patch should be clean or uncertain');
    if (data.road_condition === 'clean') {
      assert.strictEqual(data.department_code, null);
    }
  });

  await t.test('9d. Road with Shadows -> Not A Pothole (Clean or Uncertain)', async () => {
    const shadowImgPath = path.join(FIXTURES_DIR, 'shadow.jpg');
    assert.ok(fs.existsSync(shadowImgPath), 'Shadow fixture must exist');

    const form = new FormData();
    form.append('image', fs.readFileSync(shadowImgPath), 'shadow.jpg');
    form.append('domain', 'road');

    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.notStrictEqual(data.detected_class, 'Pothole', 'Shadow must NOT be marked as Pothole');
    assert.ok(['clean', 'uncertain'].includes(data.road_condition));
  });

  await t.test('9e. Road with Lane Markings -> Confirmed Clean', async () => {
    const laneImgPath = path.join(FIXTURES_DIR, 'lane_markings.jpg');
    assert.ok(fs.existsSync(laneImgPath), 'Lane markings fixture must exist');

    const form = new FormData();
    form.append('image', fs.readFileSync(laneImgPath), 'lane_markings.jpg');
    form.append('domain', 'road');

    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.detected, false);
    assert.strictEqual(data.road_condition, 'clean');
    assert.strictEqual(data.department_code, null);
  });

  await t.test('9f. Blurry Road Image -> Uncertain & Manual Review Required', async () => {
    const blurryImgPath = path.join(FIXTURES_DIR, 'blurry.jpg');
    assert.ok(fs.existsSync(blurryImgPath), 'Blurry road fixture must exist');

    const form = new FormData();
    form.append('image', fs.readFileSync(blurryImgPath), 'blurry.jpg');
    form.append('domain', 'road');

    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.detected, false);
    assert.strictEqual(data.road_condition, 'uncertain');
    assert.strictEqual(data.ai_status, 'manual_review');
    assert.strictEqual(data.review_required, true);
  });

  await t.test('9g. Non-Road Image -> Not Marked as Clean or Pothole', async () => {
    const nonRoadImgPath = path.join(FIXTURES_DIR, 'non_road.jpg');
    assert.ok(fs.existsSync(nonRoadImgPath), 'Non-road fixture must exist');

    const form = new FormData();
    form.append('image', fs.readFileSync(nonRoadImgPath), 'grass.jpg');

    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer demo-token-citizen'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.detected, false);
    assert.notStrictEqual(data.road_condition, 'clean', 'Non-road must never be claimed as clean road');
    assert.strictEqual(data.ai_status, 'manual_review');
    assert.strictEqual(data.review_required, true);
  });
});
