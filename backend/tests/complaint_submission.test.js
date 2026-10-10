const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const app = require('../src/app');
const { initDatabase } = require('../src/config/db');

describe('Citizen Complaint Submission Flow with Demo & JWT Auth', () => {
  let server;
  let baseUrl;

  before(async () => {
    await initDatabase();
    const { query } = require('../src/config/db');
    await query("DELETE FROM complaints WHERE complaint_number LIKE 'NS-%'").catch(() => {});
    await query("UPDATE users SET name = 'Pratik Dilip Tupe' WHERE mobile = '8788562103'").catch(() => {});
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
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

  test('1. POST /api/complaints/submit with demo-token-citizen succeeds with 201 Created', async () => {
    const payload = {
      complaint_number: `NS-${Date.now()}`,
      photo_url: '/uploads/test-pothole.jpg',
      category: 'Pothole & Road Damage',
      title: 'Deep pothole on MG Road near City Hospital',
      description: 'Severe road surface damage causing traffic hazard',
      priority: 'High',
      department_id: 1,
      latitude: 18.5204,
      longitude: 73.8567,
      location_source: 'live_gps',
      location_address: 'MG Road, Pune, Maharashtra'
    };

    const res = await fetch(`${baseUrl}/api/complaints/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer demo-token-citizen'
      },
      body: JSON.stringify(payload)
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201, `Expected HTTP 201, got ${res.status}: ${JSON.stringify(body)}`);
    assert.strictEqual(body.message, 'Complaint submitted successfully');
    assert.ok(body.complaint_id, 'Must return complaint_id');
  });

  test('2. POST /api/auth/demo-token returns signed JWT and valid citizen profile', async () => {
    const res = await fetch(`${baseUrl}/api/auth/demo-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'citizen' })
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.token, 'Must return JWT token');
    assert.strictEqual(body.user?.role, 'citizen');
    assert.strictEqual(body.user?.name, 'Pratik Dilip Tupe');
  });

  test('3. GET /api/auth/me accepts demo-token-citizen and returns Pratik Dilip Tupe', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Authorization': 'Bearer demo-token-citizen' }
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.user?.name, 'Pratik Dilip Tupe');
    assert.strictEqual(body.user?.role, 'citizen');
  });

  test('4. POST /api/complaints/submit with 4-angle evidence images persists all angles to database', async () => {
    const complaintNum = `NS-ANGLE-${Date.now()}`;
    const payload = {
      complaint_number: complaintNum,
      photo_url: 'https://example.com/front-photo.jpg',
      photo_front_url: 'https://example.com/front-photo.jpg',
      photo_left_url: 'https://example.com/left-photo.jpg',
      photo_right_url: 'https://example.com/right-photo.jpg',
      photo_closeup_url: 'https://example.com/closeup-photo.jpg',
      angle_photos: [
        { angle: 'front', label: 'Front View', url: 'https://example.com/front-photo.jpg' },
        { angle: 'left', label: 'Left View', url: 'https://example.com/left-photo.jpg' },
        { angle: 'right', label: 'Right View', url: 'https://example.com/right-photo.jpg' },
        { angle: 'closeup', label: 'Close-up Detail', url: 'https://example.com/closeup-photo.jpg' }
      ],
      additional_photos: [
        'https://example.com/left-photo.jpg',
        'https://example.com/right-photo.jpg',
        'https://example.com/closeup-photo.jpg'
      ],
      category: 'Pothole & Road Damage',
      title: 'Four-angle documented crater on College Road',
      description: 'Documented with Front, Left, Right and Close-up detail angles for road repair.',
      priority: 'High',
      department_id: 1,
      latitude: 19.9975,
      longitude: 73.7898,
      location_source: 'live_gps',
      location_address: 'College Road, Nashik, Maharashtra'
    };

    const res = await fetch(`${baseUrl}/api/complaints/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer demo-token-citizen'
      },
      body: JSON.stringify(payload)
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201, `Expected HTTP 201, got ${res.status}: ${JSON.stringify(body)}`);
    assert.ok(body.complaint_id, 'Must return complaint_id');

    // Query back complaint directly to verify persistence of all 4 angles
    const getRes = await fetch(`${baseUrl}/api/complaints/my`, {
      headers: {
        'Authorization': 'Bearer demo-token-citizen'
      }
    });
    assert.strictEqual(getRes.status, 200);
    const getBody = await getRes.json();
    const myComplaints = Array.isArray(getBody) ? getBody : (getBody.complaint || getBody.complaints || []);
    const serverComplaintNumber = body.complaint_number || body.complaint?.complaint_number;
    const saved = myComplaints.find((c) => String(c.id) === String(body.complaint_id) || (serverComplaintNumber && c.complaint_number === serverComplaintNumber));
    assert.ok(saved, `Saved complaint ${serverComplaintNumber || body.complaint_id} should be returned in my complaints`);
    assert.strictEqual(saved.photo_front_url, 'https://example.com/front-photo.jpg');
    assert.strictEqual(saved.photo_left_url, 'https://example.com/left-photo.jpg');
    assert.strictEqual(saved.photo_right_url, 'https://example.com/right-photo.jpg');
    assert.strictEqual(saved.photo_closeup_url, 'https://example.com/closeup-photo.jpg');
  });

  test('5. Citizen complaint submission requires authentication', async () => {
    const res = await fetch(`${baseUrl}/api/complaints/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthenticated test' })
    });
    assert.strictEqual(res.status, 401, 'Unauthenticated request must be rejected with 401');
  });

  test('6. Read queries (GET) do not deplete action rate limit quota for complaint submission', async () => {
    // Perform multiple read queries simulating browsing, map updates, and notifications
    for (let i = 0; i < 20; i++) {
      const readRes = await fetch(`${baseUrl}/api/complaints/my`, {
        headers: { 'Authorization': 'Bearer demo-token-citizen' }
      });
      assert.strictEqual(readRes.status, 200);
    }

    // Now submit a complaint - it must succeed and NOT be blocked by 429
    const complaintNum = `NS-READTEST-${Date.now()}`;
    const payload = {
      complaint_number: complaintNum,
      photo_url: 'https://example.com/front-test.jpg',
      category: 'Pothole & Road Damage',
      title: 'Road crack tested after multiple read operations',
      description: 'Checking that read queries never starve write action rate limits',
      priority: 'Medium',
      department_id: 1,
      latitude: 19.9123,
      longitude: 73.8123,
      location_source: 'live_gps'
    };

    const submitRes = await fetch(`${baseUrl}/api/complaints/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer demo-token-citizen'
      },
      body: JSON.stringify(payload)
    });

    const submitBody = await submitRes.json();
    assert.strictEqual(submitRes.status, 201, `Submission must succeed with 201, got ${submitRes.status}: ${JSON.stringify(submitBody)}`);
    assert.strictEqual(submitBody.message, 'Complaint submitted successfully');
  });

  test('7. Dedicated rate limiter isolates user and protects against excessive automated flooding', async () => {
    // Use an isolated unique token to test the complaintSubmitLimiter threshold
    const spamToken = `spam-test-token-${Date.now()}`;
    const { generateToken } = require('../src/middleware/auth');
    const token = generateToken({
      id: `spam-user-${Date.now()}`,
      name: 'Spam Tester',
      email: `spam-${Date.now()}@test.com`,
      role: 'citizen'
    });

    let rateLimited = false;
    // Attempt rapid submissions above the 30-submission threshold
    for (let i = 0; i < 35; i++) {
      const res = await fetch(`${baseUrl}/api/complaints/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          complaint_number: `NS-SPAM-${Date.now()}-${i}`,
          photo_url: 'https://example.com/test.jpg',
          category: 'Garbage & Sanitation',
          title: `Rapid submission test #${i}`,
          department_id: 2,
          latitude: 19.9975,
          longitude: 73.7898
        })
      });

      if (res.status === 429) {
        rateLimited = true;
        const errBody = await res.json();
        assert.ok(errBody.error, 'Must provide rate limit error message');
        break;
      }
    }

    assert.ok(rateLimited, 'Genuine excessive complaint flooding must trigger rate limit (429)');
  });

  test('8. Server-side authoritative SLA deadline calculation per business rules', async () => {
    const { getDefaultResponseTimeHours, calculateSlaDeadline } = require('../src/routes/complaint.routes');

    // Rule tests:
    // PWD -> 15 days (360 hours)
    assert.strictEqual(getDefaultResponseTimeHours('Pothole & Road Damage', 'PWD'), 360);
    assert.strictEqual(getDefaultResponseTimeHours('Road maintenance', 'Public Works Department'), 360);

    // Streetlight -> 48 hours
    assert.strictEqual(getDefaultResponseTimeHours('Streetlight Failure', 'ELE'), 48);
    assert.strictEqual(getDefaultResponseTimeHours('Street light not working', 'Electrical'), 48);

    // Water Leakage -> 24 hours
    assert.strictEqual(getDefaultResponseTimeHours('Water Leakage', 'Water Supply'), 24);
    assert.strictEqual(getDefaultResponseTimeHours('Pipeline burst with water leak', 'WTR'), 24);

    // Garbage -> 24 hours
    assert.strictEqual(getDefaultResponseTimeHours('Garbage & Waste Pile', 'Sanitation'), 24);
    assert.strictEqual(getDefaultResponseTimeHours('Solid waste dumping', 'SAN'), 24);

    // Drainage -> 48 hours
    assert.strictEqual(getDefaultResponseTimeHours('Drainage Overflow', 'Drainage'), 48);
    assert.strictEqual(getDefaultResponseTimeHours('Gutter blockage', 'DRN'), 48);

    // Remaining / unknown department -> 4 days (96 hours)
    assert.strictEqual(getDefaultResponseTimeHours('Park maintenance', 'Gardens'), 96);
    assert.strictEqual(getDefaultResponseTimeHours('General civic inquiry', 'Administration'), 96);

    // Deterministic fixed timestamp test
    const fixedTime = '2026-10-01T10:00:00.000Z';
    const pwdSla = calculateSlaDeadline(fixedTime, 'Roads', 'PWD');
    assert.strictEqual(pwdSla.hours, 360);
    assert.strictEqual(pwdSla.deadline, '2026-10-16T10:00:00.000Z');

    const streetSla = calculateSlaDeadline(fixedTime, 'Street light', 'ELE');
    assert.strictEqual(streetSla.hours, 48);
    assert.strictEqual(streetSla.deadline, '2026-10-03T10:00:00.000Z');

    const waterSla = calculateSlaDeadline(fixedTime, 'Water Leakage', 'WTR');
    assert.strictEqual(waterSla.hours, 24);
    assert.strictEqual(waterSla.deadline, '2026-10-02T10:00:00.000Z');

    const garbageSla = calculateSlaDeadline(fixedTime, 'Garbage dumping', 'SAN');
    assert.strictEqual(garbageSla.hours, 24);
    assert.strictEqual(garbageSla.deadline, '2026-10-02T10:00:00.000Z');

    const drainageSla = calculateSlaDeadline(fixedTime, 'Drain blockage', 'DRN');
    assert.strictEqual(drainageSla.hours, 48);
    assert.strictEqual(drainageSla.deadline, '2026-10-03T10:00:00.000Z');

    const otherSla = calculateSlaDeadline(fixedTime, 'Civic tree trimming', 'Horticulture');
    assert.strictEqual(otherSla.hours, 96);
    assert.strictEqual(otherSla.deadline, '2026-10-05T10:00:00.000Z');

    // Verify submission ignores client-supplied sla_deadline
    const { generateToken } = require('../src/middleware/auth');
    const slaCitizenToken = generateToken({
      id: `sla-user-${Date.now()}`,
      name: 'SLA Tester',
      email: `sla-${Date.now()}@test.com`,
      role: 'citizen'
    });
    const clientFakeDeadline = '2099-01-01T00:00:00.000Z';
    const res = await fetch(`${baseUrl}/api/complaints/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${slaCitizenToken}`
      },
      body: JSON.stringify({
        complaint_number: `NS-SLA-${Date.now()}`,
        photo_url: '/uploads/test-water.jpg',
        category: 'Water Leakage',
        title: 'Water pipe leak near central square',
        department_id: 3,
        latitude: 19.9975,
        longitude: 73.7898,
        sla_deadline: clientFakeDeadline,
        response_time_hours: 9999
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.ok(data.complaint);
    assert.strictEqual(data.complaint.response_time_hours, 24, 'Must enforce server-side 24h for Water Leakage');
    assert.notStrictEqual(data.complaint.sla_deadline, clientFakeDeadline, 'Must ignore client-supplied sla_deadline');
  });
});
