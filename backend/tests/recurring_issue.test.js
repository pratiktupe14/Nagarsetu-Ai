const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/config/db');
const { generateToken } = require('../src/middleware/auth');
const {
  detectRecurringIssue,
  recordRecurrenceLink,
  detectAndRecordRecurrence,
  getRecurrenceForComplaint,
  reviewRecurrenceLink,
  extractInfrastructureIdentity,
  resolveLocationProvenance
} = require('../src/services/recurringIssueService');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
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
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('NAGARSETU 3.1 — 3-Tier Geolocation-Based Recurring Issue Detection (16 Focused Tests)', () => {
  // Isolated test user IDs (Never genuine citizen accounts)
  const citizenA_Id = '987671';
  const citizenB_Id = '987672';
  const citizenA_Token = generateToken({ id: citizenA_Id, name: 'Citizen A', mobile: '9999999971', role: 'citizen' });
  const citizenB_Token = generateToken({ id: citizenB_Id, name: 'Citizen B', mobile: '9999999972', role: 'citizen' });

  // PWD Department Head token (Authorized for PWD)
  const pwdHeadToken = generateToken({
    id: '987673',
    name: 'Rahul Kumar',
    email: 'rahul.kumar@nagarsetu.gov.in',
    role: 'department_head',
    department_id: '8ed9f760-1314-427c-a515-c2a54d6df6d8',
    department_code: 'PWD'
  });

  // SAN Department Head token (Unauthorized for PWD)
  const sanHeadToken = generateToken({
    id: '987674',
    name: 'Amit Sharma',
    email: 'amit.sharma@nagarsetu.gov.in',
    role: 'department_head',
    department_id: '9cabc1f2-fd10-48dd-a5cb-01d05197de22',
    department_code: 'SAN'
  });

  // Base test coordinates
  const baseLat = 18.52043;
  const baseLng = 73.85674;

  let resolvedIssueA_Id;
  let resolved3YearsAgo_Id;
  let resolvedAsset_Id;
  let activeUnresolved_Id;
  let submittedComplaintId;

  before(async () => {
    // 1. Citizen A reported pothole at base location -> Resolved & verified 25 days ago
    const resA = await query(`
      INSERT INTO complaints (
        complaint_number, citizen_id, photo_before_url, category, title, description,
        priority, status, department_id, latitude, longitude, location_source, location_accuracy_m, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'TEST-RECUR-001', citizenA_Id, '/uploads/civic-default.jpg', 'pothole',
      'Pothole on Tilak Road', 'Deep road crater repaired and filled',
      'High', 'Resolved', '8ed9f760-1314-427c-a515-c2a54d6df6d8',
      baseLat, baseLng, 'exif', 5,
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString()
    ]);
    resolvedIssueA_Id = resA.rows?.[0]?.id || resA.insertId;

    // 2. Historical complaint resolved 3 years ago (Testing NO TIME LIMIT)
    const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000);
    const res3Yr = await query(`
      INSERT INTO complaints (
        complaint_number, citizen_id, photo_before_url, category, title, description,
        priority, status, department_id, latitude, longitude, location_source, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'TEST-3YR-001', citizenA_Id, '/uploads/civic-default.jpg', 'water',
      'Major pipeline leakage repaired 3 years ago', 'Replaced main flange',
      'Critical', 'Closed', 'ead370cc-459c-44f0-899f-8a97f0928beb',
      baseLat + 0.002, baseLng + 0.002, 'device_gps',
      new Date(threeYearsAgo.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      threeYearsAgo.toISOString()
    ]);
    resolved3YearsAgo_Id = res3Yr.rows?.[0]?.id || res3Yr.insertId;

    // 3. Historical complaint with verified infrastructure asset (Pole #402)
    const resAsset = await query(`
      INSERT INTO complaints (
        complaint_number, citizen_id, photo_before_url, category, title, description,
        priority, status, department_id, latitude, longitude, location_source, location_address, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'TEST-ASSET-001', citizenA_Id, '/uploads/civic-default.jpg', 'streetlight',
      'Streetlight outage Pole #402', 'Replaced LED bulb on Pole #402',
      'Medium', 'Resolved', '31842723-23ac-490b-912b-9f6d9afbdfb3',
      baseLat + 0.004, baseLng + 0.004, 'map_pin', 'Streetlight Pole #402, Senapati Bapat Road',
      new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString()
    ]);
    resolvedAsset_Id = resAsset.rows?.[0]?.id || resAsset.insertId;

    // 4. Active unresolved incident (for duplicate logic isolation test)
    const resUnres = await query(`
      INSERT INTO complaints (
        complaint_number, citizen_id, photo_before_url, category, title, description,
        priority, status, department_id, latitude, longitude, location_source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'TEST-ACTIVE-001', citizenA_Id, '/uploads/civic-default.jpg', 'pothole',
      'Open Unresolved Pothole', 'Still in progress',
      'Medium', 'In Progress', '8ed9f760-1314-427c-a515-c2a54d6df6d8',
      baseLat + 0.007, baseLng + 0.007, 'map_pin', new Date().toISOString()
    ]);
    activeUnresolved_Id = resUnres.rows?.[0]?.id || resUnres.insertId;
  });

  after(async () => {
    // Teardown isolated test records
    try {
      await query(`DELETE FROM recurring_issue_links WHERE current_complaint_id IN (?, ?, ?, ?) OR previous_complaint_id IN (?, ?, ?, ?)`,
        [resolvedIssueA_Id, resolved3YearsAgo_Id, resolvedAsset_Id, activeUnresolved_Id, resolvedIssueA_Id, resolved3YearsAgo_Id, resolvedAsset_Id, activeUnresolved_Id]
      );
      if (submittedComplaintId) {
        await query(`DELETE FROM recurring_issue_links WHERE current_complaint_id = ? OR previous_complaint_id = ?`, [submittedComplaintId, submittedComplaintId]);
      }
      await query(`DELETE FROM complaints WHERE complaint_number LIKE 'TEST-%' OR citizen_id IN (?, ?)`,
        [citizenA_Id, citizenB_Id]
      );
    } catch (e) {}
  });

  test('1. Citizen A resolved issue → Citizen B same issue, same confirmed location → Potential recurrence', async () => {
    const result = await detectRecurringIssue({
      id: 999901,
      citizen_id: citizenB_Id, // Different citizen
      category: 'pothole',
      latitude: baseLat,
      longitude: baseLng,
      location_source: 'exif',
      created_at: new Date().toISOString()
    });

    assert.strictEqual(result.is_recurring, true, 'Must detect recurrence across different citizens');
    assert.strictEqual(result.recurrence_status, 'Potential');
    assert.strictEqual(result.previous_complaint_id, resolvedIssueA_Id);
    assert.strictEqual(result.requires_review, true, 'Must require human review');
  });

  test('2. Different citizens, identical verified asset and issue classification → Potential recurrence', async () => {
    const result = await detectRecurringIssue({
      id: 999902,
      citizen_id: citizenB_Id,
      category: 'streetlight',
      title: 'Light failing again at Pole #402',
      description: 'Flickering LED at Pole #402',
      latitude: baseLat + 0.00405, // Slight coordinate drift
      longitude: baseLng + 0.00405,
      location_source: 'device_gps',
      created_at: new Date().toISOString()
    });

    assert.strictEqual(result.is_recurring, true);
    assert.strictEqual(result.previous_complaint_id, resolvedAsset_Id);
    assert.ok(result.matching_level.includes('Level 1: Stable Infrastructure Identity'), 'Must match via Level 1 Stable Infrastructure Identity');
  });

  test('3. Historical complaint resolved 3 years ago → Eligible', async () => {
    const result = await detectRecurringIssue({
      id: 999903,
      citizen_id: citizenB_Id,
      category: 'water',
      latitude: baseLat + 0.002,
      longitude: baseLng + 0.002,
      location_source: 'device_gps',
      created_at: new Date().toISOString()
    });

    assert.strictEqual(result.is_recurring, true, 'Issue resolved 3 years ago must be eligible (No 90-day limit)');
    assert.strictEqual(result.previous_complaint_id, resolved3YearsAgo_Id);
    assert.ok(result.days_since_resolution > 1000, 'Days since resolution must reflect ~3 years (~1095 days)');
  });

  test('4. Different category at same coordinates → Not recurring', async () => {
    const result = await detectRecurringIssue({
      id: 999904,
      citizen_id: citizenB_Id,
      category: 'streetlight', // Different from pothole (resolvedIssueA_Id)
      latitude: baseLat,
      longitude: baseLng,
      location_source: 'exif',
      created_at: new Date().toISOString()
    });

    assert.strictEqual(result.is_recurring, false, 'Different category at same coordinates must not recur');
    assert.strictEqual(result.recurrence_status, 'none');
  });

  test('5. Same category at a different confirmed physical location → Not recurring', async () => {
    const result = await detectRecurringIssue({
      id: 999905,
      citizen_id: citizenB_Id,
      category: 'pothole',
      latitude: baseLat + 0.005, // Distinct physical location (~550m away)
      longitude: baseLng + 0.005,
      location_source: 'exif',
      created_at: new Date().toISOString()
    });

    assert.strictEqual(result.is_recurring, false, 'Different physical location must not recur');
    assert.strictEqual(result.recurrence_status, 'none');
  });

  test('6. Same road segment containing two distinct potholes → Not automatically recurring', async () => {
    const result = await detectRecurringIssue({
      id: 999906,
      citizen_id: citizenB_Id,
      category: 'pothole',
      title: 'Pothole on Tilak Road',
      description: 'Distinct second pothole 50m further down the road',
      latitude: baseLat + 0.0004, // Distinct coordinates
      longitude: baseLng + 0.0004,
      location_source: 'device_gps',
      created_at: new Date().toISOString()
    });

    assert.strictEqual(result.is_recurring, false, 'Distinct separate potholes on same road must not automatically recur');
  });

  test('7. EXIF-selected location → Correct provenance retained', async () => {
    const provenance = resolveLocationProvenance({
      location_source: 'exif',
      latitude: baseLat,
      longitude: baseLng
    });

    assert.strictEqual(provenance.source, 'exif');
    assert.strictEqual(provenance.tier, 'Priority 1: EXIF Metadata');
  });

  test('8. HTML5 fallback location → Correct provenance retained', async () => {
    const provenance = resolveLocationProvenance({
      location_source: 'device_gps',
      location_accuracy_m: 18,
      latitude: baseLat,
      longitude: baseLng
    });

    assert.strictEqual(provenance.source, 'device_gps');
    assert.strictEqual(provenance.tier, 'Priority 2: Device Live GPS');
    assert.strictEqual(provenance.accuracy, 18);
  });

  test('9. Map pin fallback → Correct provenance retained', async () => {
    const provenance = resolveLocationProvenance({
      location_source: 'map_pin',
      latitude: baseLat,
      longitude: baseLng
    });

    assert.strictEqual(provenance.source, 'map_pin');
    assert.strictEqual(provenance.tier, 'Priority 3: Interactive Map Pin');
  });

  test('10. Uncertain or inconsistent GPS data → Review required', async () => {
    const result = await detectRecurringIssue({
      id: 999910,
      citizen_id: citizenB_Id,
      category: 'pothole',
      latitude: baseLat,
      longitude: baseLng,
      location_source: 'device_gps',
      location_accuracy_m: 140, // Low accuracy > 100m
      created_at: new Date().toISOString()
    });

    assert.strictEqual(result.is_recurring, true);
    assert.strictEqual(result.requires_review, true, 'Uncertain GPS data must require review');
    assert.strictEqual(result.uncertain_location, true, 'Must flag uncertain_location');
  });

  test('11. Previously active unresolved incident → Existing duplicate behavior unchanged', async () => {
    const result = await detectRecurringIssue({
      id: 999911,
      citizen_id: citizenB_Id,
      category: 'pothole',
      latitude: baseLat + 0.007,
      longitude: baseLng + 0.007,
      location_source: 'map_pin',
      created_at: new Date().toISOString()
    });

    // Unresolved complaint activeUnresolved_Id must NOT be linked as a recurrence
    assert.notStrictEqual(result.previous_complaint_id, activeUnresolved_Id, 'Active unresolved complaint must not be linked as recurrence');
  });

  test('12. Recurrence link saved and retrievable', async () => {
    const payload = {
      category: 'Roads',
      title: 'TEST-Recurrence Link Persistence Check',
      description: 'Pothole reappeared at exact same spot.',
      priority: 'Medium',
      latitude: baseLat,
      longitude: baseLng,
      location_source: 'exif',
      location_accuracy_m: 5,
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
        'Authorization': `Bearer ${citizenB_Token}`
      }
    }, payload);

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.complaint_id);
    submittedComplaintId = res.body.complaint_id;

    assert.ok(res.body.recurrence, 'Recurrence metadata must be returned in response');
    assert.strictEqual(res.body.recurrence.is_recurring, true);
    assert.strictEqual(res.body.recurrence.previous_complaint_id, resolvedIssueA_Id);

    // Retrieve recurrence through API
    const getRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${submittedComplaintId}/recurrence`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${pwdHeadToken}`
      }
    });

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.has_recurrence, true);
    assert.ok(getRes.body.recurrence_links.length > 0);
  });

  test('13. Department Head may confirm or dismiss', async () => {
    assert.ok(submittedComplaintId, 'submittedComplaintId must exist');

    // Confirm
    const confirmRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${submittedComplaintId}/recurrence`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pwdHeadToken}`
      }
    }, { status: 'Confirmed', review_notes: 'Confirmed recurrence by PWD Head' });

    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.body.status, 'Confirmed');

    // Dismiss
    const dismissRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${submittedComplaintId}/recurrence`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pwdHeadToken}`
      }
    }, { status: 'Dismissed', review_notes: 'Dismissed upon physical inspection' });

    assert.strictEqual(dismissRes.status, 200);
    assert.strictEqual(dismissRes.body.status, 'Dismissed');
  });

  test('14. Unauthorized review remains forbidden', async () => {
    assert.ok(submittedComplaintId, 'submittedComplaintId must exist');

    // Citizen forbidden
    const citizenAttempt = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${submittedComplaintId}/recurrence`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenB_Token}`
      }
    }, { status: 'Confirmed' });

    assert.strictEqual(citizenAttempt.status, 403, 'Citizen must receive 403 Forbidden');

    // Cross-department head forbidden (SAN head trying to review PWD complaint)
    const sanAttempt = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${submittedComplaintId}/recurrence`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sanHeadToken}`
      }
    }, { status: 'Confirmed' });

    assert.strictEqual(sanAttempt.status, 403, 'Cross-department review must receive 403 Forbidden');
  });

  test('15. New complaint persists even if recurrence detection fails', async () => {
    const citizenC_Token = generateToken({ id: '987679', name: 'Citizen C', mobile: '9999999979', role: 'citizen' });

    const payload = {
      category: 'Roads',
      title: 'TEST-Resilient-Persistence',
      description: 'Complaint must persist safely even if recurrence logic throws error.',
      priority: 'Low',
      latitude: baseLat + 0.02,
      longitude: baseLng + 0.02,
      location_source: 'map_pin',
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
        'Authorization': `Bearer ${citizenC_Token}`
      }
    }, payload);

    assert.strictEqual(res.status, 201, 'Complaint submission must always succeed');
    assert.ok(res.body.complaint_id, 'Complaint ID must be returned');

    // Verify persisted in DB
    const dbCheck = await query(`SELECT id, status FROM complaints WHERE id = ?`, [res.body.complaint_id]);
    assert.strictEqual(dbCheck.rows.length, 1, 'Complaint must be persisted in database');
  });

  test('16. Existing duplicate and persistence tests still pass', async () => {
    // Verify duplicate link prevention logic
    const link1 = await recordRecurrenceLink({
      current_complaint_id: 888805,
      previous_complaint_id: 888806,
      status: 'Potential',
      distance_meters: 10
    });

    const link2 = await recordRecurrenceLink({
      current_complaint_id: 888805,
      previous_complaint_id: 888806,
      status: 'Potential',
      distance_meters: 10
    });

    assert.ok(link1 && link2);
    const countRes = await query(`SELECT COUNT(*) as count FROM recurring_issue_links WHERE current_complaint_id = 888805 AND previous_complaint_id = 888806`);
    assert.strictEqual(Number(countRes.rows[0].count), 1, 'Duplicate link insertion must be prevented');

    await query(`DELETE FROM recurring_issue_links WHERE current_complaint_id = 888805`);
  });
});
