const { test, describe, before, after } = require('node:test');
const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { initDatabase, query } = require('../src/config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

function generateToken(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
}

const citizenAToken = generateToken({ id: 'c-cit-a-101', role: 'citizen', name: 'Citizen A', mobile: '9999900001' });
const citizenBToken = generateToken({ id: 'c-cit-b-102', role: 'citizen', name: 'Citizen B', mobile: '9999900002' });
const citizenCToken = generateToken({ id: 'c-cit-c-103', role: 'citizen', name: 'Citizen C', mobile: '9999900003' });
const deptHeadToken = generateToken({ id: 'u-dh-1', role: 'department_head', name: 'Dept Head', email: 'dh@nagarsetu.gov.in' });

let app;
let server;
let baseUrl;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      reqOptions.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Nearby Duplicate Detection, Merge, Ranking, and Repeat-Complaint Restriction', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    await initDatabase();
    await query(`DELETE FROM complaints WHERE latitude BETWEEN 18.515 AND 18.525 AND longitude BETWEEN 73.850 AND 73.865`).catch(() => {});

    app = express();
    app.use(express.json());
    app.use('/api/complaints', require('../src/routes/complaint.routes'));

    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    if (server) server.close();
  });

  let masterComplaintId;
  let masterComplaintNumber;
  let citizenBComplaintId;
  let citizenCComplaintId;

  test('TEST 1: Citizen A reports pothole -> success, support_count = 1', async () => {
    const payload = {
      title: 'Road Pothole on MG Road',
      category: 'Pothole',
      priority: 'Medium',
      latitude: 18.5204,
      longitude: 73.8567,
      description: 'Dangerous pothole near junction'
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenAToken);
    assert.strictEqual(res.status, 201, `Expected 201 created, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.complaint_id, 'Should return complaint_id');
    masterComplaintId = res.body.complaint_id;
    masterComplaintNumber = res.body.complaint_number;

    // Verify in DB
    const dbRes = await query(`SELECT support_count, ranking_score FROM complaints WHERE id = ?`, [masterComplaintId]);
    assert.strictEqual(dbRes.rows[0].support_count, 1, 'Initial support_count should be 1');
  });

  test('TEST 2: Citizen A reports same pothole again within 500m before SLA expires -> 409 Conflict', async () => {
    const payload = {
      title: 'Same Road Pothole again',
      category: 'pothole',
      priority: 'Medium',
      latitude: 18.5205, // ~15 meters away
      longitude: 73.8568
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenAToken);
    assert.strictEqual(res.status, 409, `Expected 409 Conflict, got ${res.status}`);
    assert.ok(res.body.error.includes('already reported'), 'Error message should indicate active report restriction');
    assert.ok(res.body.existing_complaint_id, 'Should include existing_complaint_id');
  });

  test('TEST 3: Citizen A reports garbage issue in same area -> success (different issue category)', async () => {
    const payload = {
      title: 'Garbage Dump Overflow',
      category: 'Garbage',
      priority: 'High',
      latitude: 18.5204,
      longitude: 73.8567
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenAToken);
    assert.strictEqual(res.status, 201, `Different category should be allowed, got ${res.status}`);
  });

  test('TEST 4: Citizen A reports another pothole >500m away -> success', async () => {
    const payload = {
      title: 'Another Pothole in distant location',
      category: 'Pothole',
      priority: 'Low',
      latitude: 18.5350, // ~1.6km away
      longitude: 73.8700
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenAToken);
    assert.strictEqual(res.status, 201, `Pothole >500m away should be allowed, got ${res.status}`);
  });

  test('TEST 5: Citizen B reports same pothole within 500m -> success, is_potential_duplicate = true', async () => {
    const payload = {
      title: 'Citizen B Pothole Report',
      category: 'pothole',
      priority: 'Medium',
      latitude: 18.5206, // ~25m away from master
      longitude: 73.8568
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenBToken);
    assert.strictEqual(res.status, 201, `Other citizen should succeed, got ${res.status}`);
    citizenBComplaintId = res.body.complaint_id;

    const dbRes = await query(`SELECT is_potential_duplicate, potential_parent_id FROM complaints WHERE id = ?`, [citizenBComplaintId]);
    assert.ok(dbRes.rows[0].is_potential_duplicate, 'Should flag as potential duplicate');
    assert.strictEqual(String(dbRes.rows[0].potential_parent_id), String(masterComplaintId), 'Should link to master complaint');
  });

  test('TEST 6: Department Head merges Citizen B complaint -> master support_count increases to 2', async () => {
    const res = await makeRequest('POST', `/api/complaints/${citizenBComplaintId}/merge`, { target_complaint_id: masterComplaintId }, deptHeadToken);
    assert.strictEqual(res.status, 200, `Merge request should succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.support_count, 2, 'Support count should increase to 2');

    const dbRes = await query(`SELECT is_merged, merged_into_id FROM complaints WHERE id = ?`, [citizenBComplaintId]);
    assert.ok(dbRes.rows[0].is_merged, 'Duplicate complaint should be marked as merged');
    assert.strictEqual(String(dbRes.rows[0].merged_into_id), String(masterComplaintId));
  });

  test('TEST 7: Citizen C reports same issue & merged -> support_count = 3 and ranking increases', async () => {
    const payload = {
      title: 'Citizen C Pothole Report',
      category: 'Pothole',
      priority: 'Medium',
      latitude: 18.5204,
      longitude: 73.8567
    };

    const submitRes = await makeRequest('POST', '/api/complaints/submit', payload, citizenCToken);
    assert.strictEqual(submitRes.status, 201);
    citizenCComplaintId = submitRes.body.complaint_id;

    const mergeRes = await makeRequest('POST', `/api/complaints/${citizenCComplaintId}/merge`, { target_complaint_id: masterComplaintId }, deptHeadToken);
    assert.strictEqual(mergeRes.status, 200);
    assert.strictEqual(mergeRes.body.support_count, 3, 'Support count should increase to 3');
    assert.ok(mergeRes.body.ranking_score > 3, 'Ranking score should reflect support + severity weight');
  });

  test('TEST 8: Citizen A reports same issue AFTER SLA expiration -> allowed', async () => {
    // Manually set SLA deadline of master complaint into the past
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await query(`UPDATE complaints SET sla_deadline = ? WHERE id = ?`, [pastDate, masterComplaintId]);

    const payload = {
      title: 'Citizen A Repeat Pothole After SLA Expired',
      category: 'Pothole',
      priority: 'Medium',
      latitude: 18.5204,
      longitude: 73.8567
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenAToken);
    assert.strictEqual(res.status, 201, `Expired SLA should allow repeat report from same citizen, got ${res.status}`);
  });

  test('TEST 9: Citizen cannot manipulate server-controlled fields (merged_into_id, support_count)', async () => {
    const payload = {
      title: 'Malicious Payload',
      category: 'Pothole',
      latitude: 18.5000,
      longitude: 73.8000,
      support_count: 9999,
      ranking_score: 9999,
      merged_into_id: '123'
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenAToken);
    assert.strictEqual(res.status, 201);
    const dbRes = await query(`SELECT support_count, ranking_score, merged_into_id FROM complaints WHERE id = ?`, [res.body.complaint_id]);
    assert.strictEqual(dbRes.rows[0].support_count, 1, 'Server must enforce initial support_count = 1');
    assert.strictEqual(dbRes.rows[0].merged_into_id, null, 'Server must enforce null merged_into_id on creation');
  });

  test('TEST 10: Wrong category inside 500m does NOT become duplicate', async () => {
    const payload = {
      title: 'Street Light Out',
      category: 'Street Light',
      latitude: 18.5204,
      longitude: 73.8567
    };

    const res = await makeRequest('POST', '/api/complaints/submit', payload, citizenBToken);
    assert.strictEqual(res.status, 201);

    const dbRes = await query(`SELECT is_potential_duplicate FROM complaints WHERE id = ?`, [res.body.complaint_id]);
    assert.strictEqual(Boolean(dbRes.rows[0].is_potential_duplicate), false, 'Different category should not be flagged as duplicate');
  });
});
