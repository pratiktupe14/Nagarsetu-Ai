const { test, describe } = require('node:test');
const assert = require('node:assert');
const http = require('http');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { generateToken } = require('../src/middleware/auth');

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

describe('Critical Complaint Persistence & Multi-Portal Retrieval Verification', () => {
  let createdComplaintId;
  let createdComplaintNumber;
  const user58Token = generateToken({ id: 58, name: 'Pratik Dilip Tupe', mobile: '8788562103', role: 'citizen' });

  test('1. Citizen submits new complaint and receives 201 Created with complaint_id', async () => {
    const lat = 18.5204 + (Math.random() * 0.08);
    const lng = 73.8567 + (Math.random() * 0.08);
    const payload = {
      category: 'Roads',
      title: 'Pothole on DP Road nearTupe Vasti',
      description: 'Severe road surface damage requiring asphalt patching.',
      priority: 'High',
      latitude: lat,
      longitude: lng,
      location_source: 'device_gps',
      location_accuracy_m: 20,
      location_address: 'DP Road, Pune',
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
        'Authorization': 'Bearer demo-token-citizen'
      }
    }, payload);

    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.complaint_id, 'Must return complaint_id');
    assert.ok(res.body.complaint_number, 'Must return complaint_number');

    createdComplaintId = res.body.complaint_id;
    createdComplaintNumber = res.body.complaint_number;
  });

  test('2. Citizen portal retrieves persisted complaint using demo-token-citizen', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/complaints/my',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer demo-token-citizen',
        'Cache-Control': 'no-cache'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.complaints), 'Must return complaints array');
    const match = res.body.complaints.find(c => c.complaint_number === createdComplaintNumber || c.id === createdComplaintId);
    assert.ok(match, 'Newly submitted complaint must be retrievable on Citizen Portal');
  });

  test('3. Citizen portal retrieves persisted complaint using user 58 JWT token', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/complaints/my',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + user58Token,
        'Cache-Control': 'no-cache'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.complaints), 'Must return complaints array');
    const match = res.body.complaints.find(c => c.complaint_number === createdComplaintNumber || c.id === createdComplaintId);
    assert.ok(match, 'Complaint must be retrievable with canonical citizen 58 token');
  });

  test('4. Admin portal retrieves persisted complaint using demo-token-city-admin', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/complaints?scope=all',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer demo-token-city-admin',
        'Cache-Control': 'no-cache'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.complaints), 'Must return complaints array');
    const match = res.body.complaints.find(c => c.complaint_number === createdComplaintNumber || c.id === createdComplaintId);
    assert.ok(match, 'Complaint must be retrievable on City Admin Portal');
  });

  test('5. PWD Department Head portal retrieves persisted complaint', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/department/complaints',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer demo-token-dept-head',
        'Cache-Control': 'no-cache'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.complaints), 'Must return complaints array');
    const match = res.body.complaints.find(c => c.complaint_number === createdComplaintNumber || c.id === createdComplaintId);
    assert.ok(match, 'Complaint must be retrievable on PWD Department Head Portal');
  });

  test('6. Unrelated department (Water) does not see PWD complaint (Isolation)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/department/complaints',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer demo-token-wtr-head',
        'Cache-Control': 'no-cache'
      }
    });

    assert.strictEqual(res.status, 200);
    const match = res.body.complaints?.find(c => c.complaint_number === createdComplaintNumber || c.id === createdComplaintId);
    assert.strictEqual(Boolean(match), false, 'Water department must not see PWD complaint');
  });

  test('7. Citizen can view complaint detail without 403 Forbidden', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${createdComplaintId}`,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer demo-token-citizen',
        'Cache-Control': 'no-cache'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.complaint);
    assert.strictEqual(res.body.complaint.complaint_number, createdComplaintNumber);
  });
});
