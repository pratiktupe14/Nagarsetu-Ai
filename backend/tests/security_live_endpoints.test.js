const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generateToken } = require('../src/middleware/auth');
const { resetAuthLimits } = require('../src/middleware/rateLimiter');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5000';

describe('NAGARSETU Live Endpoint Security & Authorization Boundary Integration', () => {

  test('1. Live OTP Lifecycle: Dynamic crypto OTP, bad OTP rejection, 3-attempt lockout, single-use consumption (ERROR-005)', async () => {
    const testMobile = '9888877771';

    // Step A: Request OTP
    const reqRes = await fetch(`${BASE_URL}/api/auth/otp-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: testMobile })
    });
    assert.strictEqual(reqRes.status, 200, 'OTP request must succeed');
    const reqBody = await reqRes.json();
    assert.ok(reqBody.testOtp, 'Test mode must return dynamic testOtp');
    const dynamicOtp = String(reqBody.testOtp);
    assert.match(dynamicOtp, /^\d{6}$/, 'OTP must be a 6-digit numeric string');

    // Step B: Verify wrong OTP returns 400
    const badRes1 = await fetch(`${BASE_URL}/api/auth/otp-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: testMobile, otp: '000000' })
    });
    assert.strictEqual(badRes1.status, 400, 'Incorrect OTP must return 400');
    const badBody1 = await badRes1.json();
    assert.strictEqual(badBody1.error, 'Invalid OTP code');

    // Step C: Attempt 2 with wrong OTP
    const badRes2 = await fetch(`${BASE_URL}/api/auth/otp-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: testMobile, otp: '111111' })
    });
    assert.strictEqual(badRes2.status, 400);

    // Step D: Attempt 3 with wrong OTP (reaches limit)
    const badRes3 = await fetch(`${BASE_URL}/api/auth/otp-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: testMobile, otp: '222222' })
    });
    assert.strictEqual(badRes3.status, 400);

    // Step E: Attempt 4 with wrong OTP -> locked out with 429
    const badRes4 = await fetch(`${BASE_URL}/api/auth/otp-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: testMobile, otp: '333333' })
    });
    assert.strictEqual(badRes4.status, 429, 'Subsequent invalid OTP attempt must trigger 429 lockout');
    const badBody4 = await badRes4.json();
    assert.ok(badBody4.error.includes('Too many invalid attempts'));

    // Step F: Fresh OTP request for clean account (isolates per-account brute-force backoff)
    const mobileSuccess = '9888877772';
    const cleanIpHeaders = { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.99' };
    const freshRes = await fetch(`${BASE_URL}/api/auth/otp-request`, {
      method: 'POST',
      headers: cleanIpHeaders,
      body: JSON.stringify({ mobile: mobileSuccess })
    });
    assert.strictEqual(freshRes.status, 200);
    const freshBody = await freshRes.json();
    const freshOtp = String(freshBody.testOtp);

    // Step G: Valid OTP verification succeeds
    const goodRes = await fetch(`${BASE_URL}/api/auth/otp-verify`, {
      method: 'POST',
      headers: cleanIpHeaders,
      body: JSON.stringify({ mobile: mobileSuccess, otp: freshOtp })
    });
    assert.strictEqual(goodRes.status, 200, 'Valid OTP must succeed');

    // Step H: Replay attack with same OTP must be rejected (single-use consumption)
    const replayRes = await fetch(`${BASE_URL}/api/auth/otp-verify`, {
      method: 'POST',
      headers: cleanIpHeaders,
      body: JSON.stringify({ mobile: mobileSuccess, otp: freshOtp })
    });
    assert.strictEqual(replayRes.status, 400, 'Replayed OTP must be rejected immediately');
  });

  test('2. Live Cross-Department Task Resolution: PWD staff cannot resolve Water Department complaint (ERROR-008)', async () => {
    // Step A: Submit a complaint routed to Water Supply Department (WTR)
    const subRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer demo-token-citizen'
      },
      body: JSON.stringify({
        category: 'Water',
        title: 'Broken pipeline near Shivaji Chowk',
        description: 'Major leak leaking drinking water on road.',
        priority: 'High',
        latitude: 18.5204,
        longitude: 73.8567,
        location_source: 'device_gps',
        location_accuracy_m: 10,
        location_address: 'Shivaji Chowk, Pune',
        department_code: 'WTR',
        photo_url: '/uploads/civic-default.jpg'
      })
    });
    assert.strictEqual(subRes.status, 201, 'Complaint submission must succeed');
    const subBody = await subRes.json();
    const complaintId = subBody.complaint_id;
    assert.ok(complaintId, 'Must return complaint_id');

    // Step B: Attempt resolution using PWD field staff token (demo-token-pwd-staff)
    const resolveRes = await fetch(`${BASE_URL}/api/staff/task/${complaintId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer demo-token-pwd-staff'
      },
      body: JSON.stringify({
        photo_after_url: '/uploads/clean.jpg',
        resolution_notes: 'PWD staff attempting unauthorized cross-department fix',
        work_performed: 'Unauthorized work'
      })
    });

    assert.strictEqual(
      resolveRes.status,
      403,
      'Staff from another department must be rejected with 403 Forbidden'
    );
    const resolveBody = await resolveRes.json();
    assert.ok(
      resolveBody.error.includes('Forbidden') && resolveBody.error.includes('another department'),
      'Must explain department boundary restriction'
    );
  });

  test('3. Live Citizen IDOR: Citizen cannot access another citizen private complaint (ERROR-002)', async () => {
    const tokenAlice = generateToken({
      id: 8811,
      name: 'Alice Citizen',
      mobile: '9711111111',
      email: 'alice@nagarsetu.gov.in',
      role: 'citizen'
    });

    const tokenBob = generateToken({
      id: 8822,
      name: 'Bob Citizen',
      mobile: '9722222222',
      email: 'bob@nagarsetu.gov.in',
      role: 'citizen'
    });

    // Step A: Alice submits a private complaint
    const subRes = await fetch(`${BASE_URL}/api/complaints/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlice}`
      },
      body: JSON.stringify({
        category: 'Roads',
        title: 'Alice Private Complaint on Lane 4',
        description: 'Road damage requiring attention.',
        priority: 'Medium',
        latitude: 18.5300,
        longitude: 73.8600,
        location_source: 'device_gps',
        location_accuracy_m: 15,
        location_address: 'Lane 4, Pune',
        department_code: 'PWD',
        photo_url: '/uploads/civic-default.jpg'
      })
    });
    assert.strictEqual(subRes.status, 201);
    const subBody = await subRes.json();
    const aliceComplaintId = subBody.complaint_id;

    // Step B: Alice can retrieve her own complaint
    const aliceGetRes = await fetch(`${BASE_URL}/api/complaints/${aliceComplaintId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlice}` }
    });
    assert.strictEqual(aliceGetRes.status, 200, 'Owner Alice must be able to view her complaint');

    // Step C: Bob attempts to view Alice complaint (IDOR attack)
    const bobGetRes = await fetch(`${BASE_URL}/api/complaints/${aliceComplaintId}`, {
      headers: { 'Authorization': `Bearer ${tokenBob}` }
    });
    assert.strictEqual(bobGetRes.status, 403, 'Unrelated Citizen Bob must receive HTTP 403 Forbidden');
    const bobBody = await bobGetRes.json();
    assert.strictEqual(bobBody.error, 'Forbidden: You can only view your own complaints');
  });

  test('4. Live Privilege Escalation Prevention: Citizen cannot call privileged APIs (ERROR-002 & ERROR-007)', async () => {
    const tokenCitizen = generateToken({
      id: 8833,
      name: 'Charlie Citizen',
      mobile: '9733333333',
      role: 'citizen'
    });

    // Attempt Super Admin route
    const saRes = await fetch(`${BASE_URL}/api/super-admin/audit-logs`, {
      headers: { 'Authorization': `Bearer ${tokenCitizen}` }
    });
    assert.strictEqual(saRes.status, 403, 'Citizen must receive 403 on Super Admin endpoints');

    // Attempt Officer assign-staff route
    const offRes = await fetch(`${BASE_URL}/api/officer/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenCitizen}`
      },
      body: JSON.stringify({ complaint_id: 1, staff_id: 2 })
    });
    assert.strictEqual(offRes.status, 403, 'Citizen must receive 403 on Officer assignment endpoints');

    // Attempt Public Registration role tampering
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Hacker User',
        mobile: '9744444444',
        password: 'Password@123',
        role: 'city_admin' // Privilege escalation attempt
      })
    });
    if (regRes.status === 201) {
      const regBody = await regRes.json();
      assert.strictEqual(regBody.user.role, 'citizen', 'Public registration must strictly enforce citizen role');
    }
  });

  test('5. Live Rate Limiter: Dummy Authorization header CANNOT bypass login rate limits (ERROR-006)', async () => {
    const testMobile = '9999988881';
    let hitRateLimit = false;

    // Send rapid failed login requests with dummy Authorization header
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy-attacker-bypass-token-12345'
        },
        body: JSON.stringify({
          mobile: testMobile,
          password: 'wrong_password_attempt'
        })
      });

      if (res.status === 429) {
        hitRateLimit = true;
        const body = await res.json();
        assert.ok(
          body.error.includes('Too many') || body.error.includes('locked') || body.error.includes('rate limit'),
          'Expected rate limit error message'
        );
        break;
      }
    }

    assert.strictEqual(
      hitRateLimit,
      true,
      'Live rate limiter must trigger HTTP 429 despite dummy Authorization header'
    );
  });

  test('6. Reverse-Proxy Security: Attacker cannot evade rate limit by rotating spoofed X-Forwarded-For headers', async () => {
    const targetMobile = '9999988882';
    let hitLockout = false;

    // Send rapid failed attempts with different spoofed X-Forwarded-For IPs
    for (let i = 0; i < 8; i++) {
      const spoofedIp = `198.51.100.${10 + i}`;
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': spoofedIp
        },
        body: JSON.stringify({
          mobile: targetMobile,
          password: 'wrong_password_attempt'
        })
      });

      if (res.status === 429) {
        hitLockout = true;
        break;
      }
    }

    assert.strictEqual(
      hitLockout,
      true,
      'Per-account and trusted proxy rate limiting must trigger 429 despite rotating spoofed X-Forwarded-For headers'
    );
  });

});
