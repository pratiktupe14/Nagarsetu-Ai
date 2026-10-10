const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { query, initDatabase } = require('../src/config/db');
const { resolveDepartmentByCode } = require('../src/services/departmentService');

const app = require('../src/app');
let server;
let BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
let externalAiRunning = false;

const NORMAL_DRAIN_IMG = 'D:\\NAGARSETU\\drainage images\\images (16).jpg';
const BLOCKED_DRAIN_IMG = 'D:\\NAGARSETU\\drainage images\\images (1).jpg';
const DAMAGED_DRAIN_IMG = 'D:\\NAGARSETU\\drainage images\\images (24).jpg';
const OVERFLOW_DRAIN_IMG = 'D:\\NAGARSETU\\drainage images\\56694397.avif';
const BLURRY_IMG = path.resolve(__dirname, 'fixtures/blurry.jpg');

const DRN_CANONICAL_UUID = 'ee73cb82-cc47-4333-b7d6-4491353c1354';

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

test('1. Department Resolver Verification for DRN', async () => {
  const drnDept = await resolveDepartmentByCode('DRN');
  assert.ok(drnDept, 'DRN department should resolve');
  assert.strictEqual(drnDept.code, 'DRN', 'Department code should be DRN');
  assert.strictEqual(drnDept.id, DRN_CANONICAL_UUID, 'DRN ID must match canonical UUID');
  assert.strictEqual(drnDept.status, 'active');
});

test('2. CASE 1: Real Normal Drain Safety (No complaint, No DRN routing, No staff)', async () => {
  assert.ok(fs.existsSync(NORMAL_DRAIN_IMG), `Test image must exist at ${NORMAL_DRAIN_IMG}`);

  const form = new FormData();
  form.append('image', fs.readFileSync(NORMAL_DRAIN_IMG), 'normal_drain.jpg');
  form.append('domain', 'drainage');

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
  assert.strictEqual(aiData.detected, false, 'Normal drain must NOT be detected as an issue');
  assert.strictEqual(aiData.ai_status, 'confirmed_normal');
  assert.strictEqual(aiData.review_required, false);
  assert.strictEqual(aiData.department_code, null, 'Must NOT route to any department');
  assert.strictEqual(aiData.departmentCode, null);
  assert.strictEqual(aiData.department_id, null);
  assert.strictEqual(aiData.complaint, null, 'Must NOT generate a complaint');
});

test('3. CASE 2: Real Blocked Drain -> DRN Routing -> DB Persistence -> Staff Assignment', async () => {
  assert.ok(fs.existsSync(BLOCKED_DRAIN_IMG), `Test image must exist at ${BLOCKED_DRAIN_IMG}`);

  const form = new FormData();
  form.append('image', fs.readFileSync(BLOCKED_DRAIN_IMG), 'blocked_drain.jpg');
  form.append('domain', 'drainage');

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
  assert.strictEqual(aiData.detected, true, 'Blocked drain must be detected');
  assert.strictEqual(aiData.department_code, 'DRN', 'Must route to Drainage Department (DRN)');
  assert.strictEqual(aiData.category, 'Drainage', 'Category must be Drainage');
  assert.ok(aiData.confidence >= 0.70, `Confidence should be strong (got ${aiData.confidence})`);

  // Citizen creates complaint via /api/complaints/submit
  const uniqueLat = 18.5204 + (Math.random() * 0.05);
  const uniqueLng = 73.8567 + (Math.random() * 0.05);

  const compPayload = {
    title: aiData.title || aiData.complaint?.title || 'Blocked Drain / Gutter',
    description: aiData.description || aiData.complaint?.description || 'Heavy debris and garbage blocking drainage water flow.',
    category: 'Drainage',
    department_code: 'DRN',
    priority: 'High',
    latitude: uniqueLat,
    longitude: uniqueLng,
    location_source: 'map_pin',
    photo_url: '/uploads/blocked-drain.jpg',
    ai_status: aiData.ai_status,
    ai_confidence: aiData.confidence,
    ai_model: aiData.model || 'drainage_model.pt',
    ai_detected_class: 'blocked_drain',
    ai_reason: 'Blocked drain detected with accumulated waste or debris obstructing water flow.'
  };

  const createRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify(compPayload)
  });

  assert.strictEqual(createRes.status, 201, 'Complaint should be created successfully');
  const createData = await createRes.json();
  assert.ok(createData.complaint, 'Response should contain complaint object');
  const complaintId = createData.complaint.id;
  assert.ok(complaintId, 'Complaint should have an ID');

  // Verify in SQLite database
  const dbCompRes = await query(
    `SELECT c.id, c.department_id, c.category, c.status, d.code as dept_code
     FROM complaints c
     JOIN departments d ON c.department_id = d.id
     WHERE c.id = ?`,
    [complaintId]
  );
  assert.strictEqual(dbCompRes.rows.length, 1, 'Complaint must exist in database');
  const savedComp = dbCompRes.rows[0];

  assert.strictEqual(savedComp.department_id, DRN_CANONICAL_UUID, 'Must persist canonical DRN UUID');
  assert.strictEqual(savedComp.dept_code, 'DRN', 'Must persist DRN department code');
  assert.strictEqual(savedComp.category, 'Drainage', 'Must persist Drainage category');

  // DRN Head assigns Sunil Patil (id 35)
  const assignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-drn-head'
    },
    body: JSON.stringify({
      complaint_id: complaintId,
      staff_id: 35
    })
  });

  assert.strictEqual(assignRes.status, 200, 'Staff assignment should succeed');
  const assignData = await assignRes.json();
  assert.strictEqual(assignData.success, true);

  // Direct DB check of assignment persistence
  const checkDb = await query('SELECT status, assigned_staff_id FROM complaints WHERE id = ?', [complaintId]);
  assert.strictEqual(checkDb.rows[0].status, 'Staff Assigned');
  assert.strictEqual(String(checkDb.rows[0].assigned_staff_id), '35');
});

test('4. CASE 3: Real Damaged Drain (Broken Slab) -> DRN Routing -> High Severity', async () => {
  assert.ok(fs.existsSync(DAMAGED_DRAIN_IMG), `Test image must exist at ${DAMAGED_DRAIN_IMG}`);

  const form = new FormData();
  form.append('image', fs.readFileSync(DAMAGED_DRAIN_IMG), 'damaged_drain.jpg');
  form.append('domain', 'drainage');

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
  assert.strictEqual(aiData.detected, true, 'Damaged drain must be detected');
  assert.strictEqual(aiData.department_code, 'DRN', 'Must route to Drainage (DRN)');
  assert.strictEqual(aiData.category, 'Drainage');
  assert.strictEqual(aiData.issue_type, 'Damaged Drain / Broken Slab');
  assert.strictEqual(aiData.severity, 'High');
  assert.ok(aiData.confidence >= 0.70);

  // Persistence check via submit
  const uniqueLat = 18.5300 + (Math.random() * 0.05);
  const uniqueLng = 73.8600 + (Math.random() * 0.05);

  const createRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify({
      title: 'Damaged Drain / Broken Slab',
      description: 'Collapsed concrete drain slab creating dangerous opening on sidewalk.',
      category: 'Drainage',
      department_code: 'DRN',
      priority: 'High',
      latitude: uniqueLat,
      longitude: uniqueLng,
      location_source: 'map_pin',
      photo_url: '/uploads/damaged-drain-slab.jpg',
      ai_status: aiData.ai_status,
      ai_confidence: aiData.confidence,
      ai_model: aiData.model,
      ai_detected_class: 'damaged_drain',
      ai_reason: 'Damaged drainage structure detected with broken slab or collapsed cover posing safety hazards.'
    })
  });

  assert.strictEqual(createRes.status, 201);
  const created = await createRes.json();
  const dbRes = await query('SELECT department_id FROM complaints WHERE id = ?', [created.complaint.id]);
  assert.strictEqual(dbRes.rows[0].department_id, DRN_CANONICAL_UUID);
});

test('5. CASE 4: Real Drain Overflow -> DRN Routing', async () => {
  assert.ok(fs.existsSync(OVERFLOW_DRAIN_IMG), `Test image must exist at ${OVERFLOW_DRAIN_IMG}`);

  const form = new FormData();
  form.append('image', fs.readFileSync(OVERFLOW_DRAIN_IMG), 'overflow_drain.avif');
  form.append('domain', 'drainage');

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
  assert.strictEqual(aiData.detected, true, 'Drain overflow must be detected');
  assert.strictEqual(aiData.department_code, 'DRN');
  assert.strictEqual(aiData.category, 'Drainage');
});

test('6. CASE 5: Ambiguous / Low Contrast Image Safety (Manual Review)', async () => {
  assert.ok(fs.existsSync(BLURRY_IMG), `Test blurry image must exist at ${BLURRY_IMG}`);
  const form = new FormData();
  form.append('image', fs.readFileSync(BLURRY_IMG), 'blurry.jpg');

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
  assert.strictEqual(aiData.detected, false);
  assert.strictEqual(aiData.review_required, true);
  assert.strictEqual(aiData.department_code, null, 'Must NOT route ambiguous image to any department');
});

test('7. CASE 6: Cross-Department Security & Dashboard Isolation', async () => {
  // Query a DRN complaint
  const drnCompRes = await query(
    `SELECT id FROM complaints WHERE department_id = ? ORDER BY id DESC LIMIT 1`,
    [DRN_CANONICAL_UUID]
  );
  assert.ok(drnCompRes.rows && drnCompRes.rows.length > 0, 'Should have at least 1 DRN complaint');
  const drnCompId = drnCompRes.rows[0].id;

  // 1. Fetch complaints as PWD Head: Must NOT show DRN complaints
  const pwdHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-dept-head' }
  });
  assert.strictEqual(pwdHeadRes.status, 200);
  const pwdHeadData = await pwdHeadRes.json();
  const inPwd = (pwdHeadData.complaints || []).some(c => String(c.id) === String(drnCompId));
  assert.strictEqual(inPwd, false, 'PWD Head must NOT see DRN complaint');

  // 2. Fetch complaints as WTR Head: Must NOT show DRN complaints
  const wtrHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-wtr-head' }
  });
  assert.strictEqual(wtrHeadRes.status, 200);
  const wtrHeadData = await wtrHeadRes.json();
  const inWtr = (wtrHeadData.complaints || []).some(c => String(c.id) === String(drnCompId));
  assert.strictEqual(inWtr, false, 'WTR Head must NOT see DRN complaint');

  // 3. Fetch complaints as SAN Head: Must NOT show DRN complaints
  const sanHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-san-head' }
  });
  assert.strictEqual(sanHeadRes.status, 200);
  const sanHeadData = await sanHeadRes.json();
  const inSan = (sanHeadData.complaints || []).some(c => String(c.id) === String(drnCompId));
  assert.strictEqual(inSan, false, 'SAN Head must NOT see DRN complaint');

  // 4. Fetch complaints as DRN Head: MUST see DRN complaints
  const drnHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-drn-head' }
  });
  assert.strictEqual(drnHeadRes.status, 200);
  const drnHeadData = await drnHeadRes.json();
  const inDrn = (drnHeadData.complaints || []).some(c => String(c.id) === String(drnCompId));
  assert.strictEqual(inDrn, true, 'DRN Head MUST see their department complaint');

  // 5. Cross-staff assignment IDOR protection: Non-DRN staff must be rejected with 403
  const staffAttemptRes = await fetch(`${BASE_URL}/api/staff/task/${drnCompId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-pwd-staff'
    },
    body: JSON.stringify({ status: 'In Progress' })
  });
  assert.strictEqual(staffAttemptRes.status, 403, 'Non-assigned, non-DRN staff must be rejected with 403');
});

test('8. CASE 7: Full Complete DRN Lifecycle (Reported -> Assigned -> In Progress -> Resolved -> Verified)', async () => {
  // Step A: Citizen submits blocked drain complaint
  const uniqueLat = 18.5400 + (Math.random() * 0.05);
  const uniqueLng = 73.8700 + (Math.random() * 0.05);

  const subRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify({
      category: 'Drainage',
      title: 'Severe Municipal Drain Clog',
      description: 'End-to-end drainage lifecycle validation complaint.',
      priority: 'High',
      latitude: uniqueLat,
      longitude: uniqueLng,
      location_source: 'map_pin',
      department_code: 'DRN',
      photo_url: '/uploads/blocked-drain-lifecycle.jpg',
      ai_model: 'drainage_model.pt',
      ai_confidence: 0.95,
      ai_status: 'confirmed',
      ai_detected_class: 'blocked_drain',
      ai_reason: 'Blocked drain detected with accumulated waste or debris obstructing water flow.'
    })
  });

  assert.strictEqual(subRes.status, 201);
  const compData = await subRes.json();
  const compId = compData.complaint.id;

  // Step B: DRN Head assigns Sunil Patil (id 35)
  const assignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-drn-head'
    },
    body: JSON.stringify({ complaint_id: compId, staff_id: 35 })
  });
  assert.strictEqual(assignRes.status, 200);

  // Step C: DRN Field Staff sets status to 'In Progress'
  const inProgRes = await fetch(`${BASE_URL}/api/staff/task/${compId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-drn-staff'
    },
    body: JSON.stringify({ status: 'In Progress' })
  });
  assert.strictEqual(inProgRes.status, 200);

  // Step D: DRN Field Staff resolves task with evidence photo and completion report
  const form = new FormData();
  form.append('photo', fs.readFileSync(NORMAL_DRAIN_IMG), 'drain-cleared.jpg');
  form.append('photo_after_url', '/uploads/drain-cleared-complete.jpg');
  form.append('resolution_notes', 'Drainage line completely cleared of silt and plastics; storm water flow restored.');
  form.append('materials_used', 'Municipal suction unit, jetting nozzle, manual dredging shovels');

  const resolveRes = await fetch(`${BASE_URL}/api/staff/task/${compId}/resolve`, {
    method: 'POST',
    body: form.getBuffer(),
    headers: {
      ...form.getHeaders(),
      'Authorization': 'Bearer demo-token-drn-staff'
    }
  });
  assert.strictEqual(resolveRes.status, 200);

  // Step E: DRN Department Head verifies and confirms resolution
  const verifyRes = await fetch(`${BASE_URL}/api/department/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-drn-head'
    },
    body: JSON.stringify({
      complaint_id: compId,
      status: 'Resolved'
    })
  });
  assert.strictEqual(verifyRes.status, 200);

  // Step F: Citizen submits feedback on resolved complaint
  const feedbackRes = await fetch(`${BASE_URL}/api/complaints/${compId}/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify({
      complaint_id: Number(compId),
      rating: 5,
      comment: 'Drainage line is completely clean and clear now. Excellent prompt work by DRN!'
    })
  });
  assert.strictEqual(feedbackRes.status, 200);

  // Final DB Check
  const finalDbCheck = await query('SELECT status, photo_after_url FROM complaints WHERE id = ?', [compId]);
  assert.strictEqual(finalDbCheck.rows[0].status, 'Resolved');
  assert.ok(finalDbCheck.rows[0].photo_after_url && finalDbCheck.rows[0].photo_after_url.length > 0);

  const fbCheck = await query('SELECT rating, comment FROM feedback WHERE complaint_id = ?', [compId]);
  assert.strictEqual(fbCheck.rows.length, 1);
  assert.strictEqual(fbCheck.rows[0].rating, 5);
});
