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

const PERFECT_PIPE_IMG = 'D:\\NAGARSETU\\normal pipe images\\Screenshot 2026-10-09 011533.png';
const LEAKAGE_PIPE_IMG = 'D:\\NAGARSETU\\leaking pipes\\water-leaking-hole-industrial-hose-260nw-2609724773.jpg';
const BURST_PIPE_IMG = 'D:\\NAGARSETU\\leaking pipes\\burst-water-pipe.jpg';
const BLURRY_IMG = path.resolve(__dirname, 'fixtures/blurry.jpg');

const WTR_CANONICAL_UUID = 'ead370cc-459c-44f0-899f-8a97f0928beb';

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

test('1. Department Resolver Verification for WTR', async () => {
  const wtrDept = await resolveDepartmentByCode('WTR');
  assert.ok(wtrDept, 'WTR department should resolve');
  assert.strictEqual(wtrDept.code, 'WTR', 'Department code should be WTR');
  assert.strictEqual(wtrDept.id, WTR_CANONICAL_UUID, 'WTR ID must match canonical UUID');
  assert.strictEqual(wtrDept.status, 'active');
});

test('2. CASE 1: Real Perfect Pipe Safety (No complaint, No WTR routing, No staff)', async () => {
  assert.ok(fs.existsSync(PERFECT_PIPE_IMG), `Test image must exist at ${PERFECT_PIPE_IMG}`);

  const form = new FormData();
  form.append('image', fs.readFileSync(PERFECT_PIPE_IMG), 'normal_pipe.png');
  form.append('domain', 'pipe');

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
  assert.strictEqual(aiData.detected, false, 'Perfect pipe must NOT be detected as an issue');
  assert.strictEqual(aiData.ai_status, 'confirmed_normal');
  assert.strictEqual(aiData.review_required, false);
  assert.strictEqual(aiData.department_code, null, 'Must NOT route to any department');
  assert.strictEqual(aiData.departmentCode, null);
  assert.strictEqual(aiData.department_id, null);
});

test('3. CASE 2: Real Water Leakage -> WTR Routing -> DB Persistence -> Staff Assignment', async () => {
  assert.ok(fs.existsSync(LEAKAGE_PIPE_IMG), `Test image must exist at ${LEAKAGE_PIPE_IMG}`);

  const form = new FormData();
  form.append('image', fs.readFileSync(LEAKAGE_PIPE_IMG), 'leak_pipe.jpg');
  form.append('domain', 'pipe');

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
  assert.strictEqual(aiData.detected, true, 'Water leakage must be detected');
  assert.strictEqual(aiData.department_code, 'WTR');
  assert.strictEqual(aiData.category, 'Water Supply');

  // Submit complaint
  const uniqueLat = 19.9800 + (Math.random() * 0.05);
  const uniqueLng = 73.7900 + (Math.random() * 0.05);

  const submitPayload = {
    category: aiData.category,
    title: aiData.title || 'Water Leakage',
    description: aiData.description || 'Water leakage from civic pipe infrastructure',
    priority: aiData.priority || 'High',
    latitude: uniqueLat,
    longitude: uniqueLng,
    location_source: 'map_pin',
    department_code: 'WTR',
    photo_url: '/uploads/test-leakage-run.jpg',
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

  // Verify in Database directly
  const dbCompRes = await query(
    `SELECT c.id, c.department_id, c.category, c.status, c.latitude, c.longitude, c.photo_before_url, d.code as dept_code
     FROM complaints c
     JOIN departments d ON c.department_id = d.id
     WHERE c.id = ?`,
    [complaintId]
  );

  assert.ok(dbCompRes.rows && dbCompRes.rows.length === 1);
  const savedComp = dbCompRes.rows[0];
  assert.strictEqual(savedComp.department_id, WTR_CANONICAL_UUID, 'Must persist canonical WTR UUID');
  assert.strictEqual(savedComp.dept_code, 'WTR');
  assert.strictEqual(savedComp.category, 'Water Supply');
  assert.ok(savedComp.status === 'reported' || savedComp.status === 'Staff Assigned', 'Status must be reported or Staff Assigned');

  // Verify WTR Department Head sees it
  const wtrHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-wtr-head' }
  });
  assert.strictEqual(wtrHeadRes.status, 200);
  const wtrHeadData = await wtrHeadRes.json();
  const foundInWtr = wtrHeadData.complaints.find(c => String(c.id) === String(complaintId));
  assert.ok(foundInWtr, 'WTR Department Head MUST see the WTR complaint');

  // Assign WTR Staff (Kiran Patil, id: 30)
  const assignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-wtr-head'
    },
    body: JSON.stringify({
      complaint_id: complaintId,
      staff_id: 30
    })
  });

  assert.strictEqual(assignRes.status, 200);
  const assignData = await assignRes.json();
  assert.strictEqual(assignData.success, true);

  // Direct DB check of assignment persistence
  const checkDb = await query('SELECT status, assigned_staff_id, assigned_staff_name FROM complaints WHERE id = ?', [complaintId]);
  assert.strictEqual(checkDb.rows[0].status, 'Staff Assigned');
  assert.strictEqual(String(checkDb.rows[0].assigned_staff_id), '30');
});

test('4. CASE 3: Clear Broken Pipe (burst-water-pipe.jpg) -> Broken Water Pipe -> WTR Routing', async () => {
  assert.ok(fs.existsSync(BURST_PIPE_IMG), `Test image must exist at ${BURST_PIPE_IMG}`);

  const form = new FormData();
  form.append('image', fs.readFileSync(BURST_PIPE_IMG), 'burst_pipe.jpg');
  form.append('domain', 'pipe');

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
  assert.strictEqual(aiData.category, 'Water Supply');
  assert.strictEqual(aiData.department_code, 'WTR');
  assert.strictEqual(aiData.title, 'Broken Water Pipe');
  assert.ok(aiData.confidence >= 0.80, 'Clear rupture should have high confidence');

  // Submit and verify persistence
  const uniqueLat = 19.9700 + (Math.random() * 0.05);
  const uniqueLng = 73.7800 + (Math.random() * 0.05);

  const subRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify({
      category: 'Water Supply',
      title: 'Broken Water Pipe',
      description: 'Major pipe rupture detected',
      priority: 'High',
      latitude: uniqueLat,
      longitude: uniqueLng,
      location_source: 'map_pin',
      department_code: 'WTR',
      photo_url: '/uploads/burst-water-pipe.jpg',
      ai_model: 'water_pipe_model.pt',
      ai_confidence: aiData.confidence,
      ai_status: 'confirmed',
      ai_detected_class: 'broken_pipe',
      ai_reason: 'Broken water pipe detected posing risk of water loss and structural damage.'
    })
  });

  assert.strictEqual(subRes.status, 201);
  const subData = await subRes.json();
  const burstCompId = subData.complaint.id;

  const dbRes = await query('SELECT department_id FROM complaints WHERE id = ?', [burstCompId]);
  assert.strictEqual(dbRes.rows[0].department_id, WTR_CANONICAL_UUID, 'Must persist WTR UUID for broken pipe');
});

test('5. CASE 4: Additional Broken Pipe Images (AVIF, joint fracture, burst opening)', async () => {
  const brokenCases = [
    { name: '114662673.avif', path: 'D:\\NAGARSETU\\leaking pipes\\114662673.avif' },
    { name: 'images (6).jpg', path: 'D:\\NAGARSETU\\leaking pipes\\images (6).jpg' },
    { name: 'WhatsApp Image 2026-10-09 at 12.32.25 AM.jpeg', path: 'D:\\NAGARSETU\\leaking pipes\\WhatsApp Image 2026-10-09 at 12.32.25 AM.jpeg' }
  ];

  for (const item of brokenCases) {
    assert.ok(fs.existsSync(item.path), `Image must exist at ${item.path}`);
    const form = new FormData();
    form.append('image', fs.readFileSync(item.path), item.name);
    form.append('domain', 'pipe');

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
    assert.strictEqual(aiData.success, true, `Analysis must succeed for ${item.name}`);
    assert.strictEqual(aiData.detected, true, `Should detect issue for ${item.name}`);
    assert.strictEqual(aiData.department_code, 'WTR', `Must route to WTR for ${item.name}`);
    assert.strictEqual(aiData.title, 'Broken Water Pipe', `Must identify as Broken Water Pipe for ${item.name}`);
  }
});

test('6. CASE 5: Additional Water Leakage Images (drip, spray, jet)', async () => {
  const leakCases = [
    { name: 'images (20).jpg', path: 'D:\\NAGARSETU\\leaking pipes\\images (20).jpg' },
    { name: 'images (3).jpg', path: 'D:\\NAGARSETU\\leaking pipes\\images (3).jpg' },
    { name: 'WhatsApp Image 2026-10-09 at 12.33.38 AM.jpeg', path: 'D:\\NAGARSETU\\leaking pipes\\WhatsApp Image 2026-10-09 at 12.33.38 AM.jpeg' }
  ];

  for (const item of leakCases) {
    assert.ok(fs.existsSync(item.path), `Image must exist at ${item.path}`);
    const form = new FormData();
    form.append('image', fs.readFileSync(item.path), item.name);
    form.append('domain', 'pipe');

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
    assert.strictEqual(aiData.success, true, `Analysis must succeed for ${item.name}`);
    assert.strictEqual(aiData.detected, true, `Should detect issue for ${item.name}`);
    assert.strictEqual(aiData.department_code, 'WTR', `Must route to WTR for ${item.name}`);
    assert.strictEqual(aiData.title, 'Water Leakage', `Must identify as Water Leakage for ${item.name}`);
  }
});

test('7. CASE 6: Ambiguous Image Safety (No false confident civic complaint)', async () => {
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

test('8. Security & Cross-Department Isolation for WTR Complaints', async () => {
  // Query a WTR complaint
  const wtrCompRes = await query(
    `SELECT id FROM complaints WHERE department_id = ? ORDER BY id DESC LIMIT 1`,
    [WTR_CANONICAL_UUID]
  );
  assert.ok(wtrCompRes.rows && wtrCompRes.rows.length > 0);
  const wtrCompId = wtrCompRes.rows[0].id;

  // 1. Fetch complaints as PWD Head
  const pwdHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-dept-head' }
  });
  const pwdHeadData = await pwdHeadRes.json();
  const inPwd = pwdHeadData.complaints.some(c => String(c.id) === String(wtrCompId));
  assert.strictEqual(inPwd, false, 'PWD Head must NOT see WTR complaint');

  // 2. Fetch complaints as Sanitation Head
  const sanHeadRes = await fetch(`${BASE_URL}/api/department/complaints`, {
    headers: { 'Authorization': 'Bearer demo-token-sanitation-head' }
  });
  const sanHeadData = await sanHeadRes.json();
  const inSan = sanHeadData.complaints.some(c => String(c.id) === String(wtrCompId));
  assert.strictEqual(inSan, false, 'Sanitation Head must NOT see WTR complaint');

  // 3. WTR Head attempts to assign PWD staff (id 23) to WTR complaint -> MUST FAIL with 403
  const invalidAssignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-wtr-head'
    },
    body: JSON.stringify({
      complaint_id: wtrCompId,
      staff_id: 23 // PWD staff
    })
  });
  assert.strictEqual(invalidAssignRes.status, 403, 'Cross-department staff assignment must return 403');

  // 4. Non-WTR staff (PWD staff) attempting to access or update WTR complaint -> MUST FAIL with 403
  const staffAttemptRes = await fetch(`${BASE_URL}/api/staff/task/${wtrCompId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-pwd-staff'
    },
    body: JSON.stringify({ status: 'In Progress' })
  });
  assert.strictEqual(staffAttemptRes.status, 403, 'Non-assigned, non-WTR staff must be rejected with 403');
});

test('9. Full Citizen & Department Lifecycle for Pipe Defect: Reported -> Assigned -> In Progress -> Resolved -> Verified', async () => {
  // Step A: Citizen submits broken pipe complaint
  const uniqueLat = 19.9600 + (Math.random() * 0.05);
  const uniqueLng = 73.7700 + (Math.random() * 0.05);

  const subRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-citizen'
    },
    body: JSON.stringify({
      category: 'Water Supply',
      title: 'Water Main Rupture',
      description: 'Underground high pressure leak on 5th avenue pipeline',
      priority: 'High',
      latitude: uniqueLat,
      longitude: uniqueLng,
      location_source: 'map_pin',
      department_code: 'WTR',
      photo_url: '/uploads/lifecycle-pipe-burst.jpg',
      ai_model: 'water_pipe_model.pt',
      ai_confidence: 0.92,
      ai_status: 'confirmed',
      ai_detected_class: 'broken_pipe',
      ai_reason: 'Broken water pipe detected posing risk of water loss and structural damage.'
    })
  });

  assert.strictEqual(subRes.status, 201);
  const compData = await subRes.json();
  const compId = compData.complaint.id;

  // Step B: WTR Head assigns Kiran Patil (id 30)
  const assignRes = await fetch(`${BASE_URL}/api/department/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-wtr-head'
    },
    body: JSON.stringify({ complaint_id: compId, staff_id: 30 })
  });
  assert.strictEqual(assignRes.status, 200);

  // Step C: WTR Field Staff sets status to 'In Progress'
  const inProgRes = await fetch(`${BASE_URL}/api/staff/task/${compId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-wtr-staff'
    },
    body: JSON.stringify({ status: 'In Progress' })
  });
  assert.strictEqual(inProgRes.status, 200);

  // Step D: WTR Field Staff resolves task with evidence photo and completion report
  const form = new FormData();
  form.append('photo', fs.readFileSync(PERFECT_PIPE_IMG), 'pipe-repaired.png');
  form.append('photo_after_url', '/uploads/pipe-repair-complete.jpg');
  form.append('resolution_notes', 'Pipe joint excavated, fractured collar replaced with new ductile iron sleeve, pressure tested to 6 bar.');
  form.append('materials_used', '150mm ductile iron coupling sleeve, sealing gaskets, stainless steel bolts');

  const resolveRes = await fetch(`${BASE_URL}/api/staff/task/${compId}/resolve`, {
    method: 'POST',
    body: form.getBuffer(),
    headers: {
      ...form.getHeaders(),
      'Authorization': 'Bearer demo-token-wtr-staff'
    }
  });
  assert.strictEqual(resolveRes.status, 200);

  // Step E: WTR Department Head verifies and confirms resolution
  const verifyRes = await fetch(`${BASE_URL}/api/department/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-wtr-head'
    },
    body: JSON.stringify({
      complaint_id: compId,
      status: 'Resolved'
    })
  });
  assert.strictEqual(verifyRes.status, 200);

  // Step F: Citizen tracking check
  const trackRes = await fetch(`${BASE_URL}/api/complaints/${compId}`, {
    headers: { 'Authorization': 'Bearer demo-token-citizen' }
  });
  assert.strictEqual(trackRes.status, 200);
  const trackData = await trackRes.json();
  const c = trackData.complaint || trackData;
  assert.strictEqual(c.status, 'Resolved', 'Citizen must see complaint status as Resolved');
  assert.ok((c.photo_after_url && c.photo_after_url.length > 5) || (c.photo_after && c.photo_after.length > 5), 'Resolution photo evidence must be visible to citizen');
});
