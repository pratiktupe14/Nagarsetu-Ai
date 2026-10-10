const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/config/db');
const { generateToken } = require('../src/middleware/auth');
const {
  EVENT_TYPES,
  canonicalSerialize,
  validatePrivacySanitized,
  computeHmacSha256,
  generatePseudonym,
  generateLocationCommitment,
  generateEvidenceCommitment,
  generateComplaintCommitment,
  ledgerAdapter,
  integrityService,
  verificationService
} = require('../src/services/blockchain');

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

describe('NAGARSETU 3.1 — Blockchain Data Integrity & Privacy Protection (17 Focused Tests)', () => {
  // Test citizen and Super Admin tokens
  const testCitizenId = '987681';
  const citizenToken = generateToken({ id: testCitizenId, name: 'Blockchain Test Citizen', mobile: '9999999981', role: 'citizen' });

  // Super Admin token
  const superAdminToken = generateToken({
    id: '999999',
    name: 'Super Admin Developer',
    email: 'developer@nagarsetu.gov.in',
    role: 'super_admin'
  });

  // Base test coordinates
  const baseLat = 18.5312;
  const baseLng = 73.8445;

  let testComplaintId;
  let testTxId;

  before(async () => {
    await ledgerAdapter.ensureSchema();

    // Ensure super admin account exists in database for strict middleware check
    await query(`
      INSERT OR REPLACE INTO users (id, name, email, mobile, password_hash, role, status)
      VALUES (?, ?, ?, ?, 'hash', 'super_admin', 'active')
    `, ['999999', 'Super Admin Developer', 'developer@nagarsetu.gov.in', '9999999999']).catch(() => {});

    // Clean up any stale records from test citizen
    await query(`DELETE FROM blockchain_transactions WHERE entity_id IN (SELECT CAST(id AS TEXT) FROM complaints WHERE citizen_id = ?)`, [testCitizenId]).catch(() => {});
    await query(`DELETE FROM complaints WHERE citizen_id = ?`, [testCitizenId]).catch(() => {});

    // Insert an isolated test complaint
    const insertRes = await query(`
      INSERT INTO complaints (
        complaint_number, citizen_id, photo_before_url, category, title, description,
        priority, status, department_id, latitude, longitude, location_accuracy_m, location_source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'TEST-BC-001', testCitizenId, '/uploads/civic-default.jpg', 'Roads',
      'Blockchain Test Pothole', 'Integrity verification record',
      'Medium', 'Submitted', '8ed9f760-1314-427c-a515-c2a54d6df6d8',
      baseLat, baseLng, 5, 'exif', new Date().toISOString()
    ]);
    testComplaintId = insertRes.rows?.[0]?.id || insertRes.insertId;
  });

  after(async () => {
    ledgerAdapter.setLedgerAvailable(true);
    try {
      await query(`DELETE FROM blockchain_transactions WHERE entity_id = ? OR tx_id LIKE 'TEST-%'`, [String(testComplaintId)]);
      await query(`DELETE FROM complaints WHERE id = ? OR complaint_number = 'TEST-BC-001'`, [testComplaintId]);
    } catch (e) {}
  });

  test('1. Deterministic commitment generation', () => {
    const objA = { z: 1, a: 'test', m: { b: 2, a: 1 } };
    const objB = { a: 'test', m: { a: 1, b: 2 }, z: 1 };

    const serializedA = canonicalSerialize(objA);
    const serializedB = canonicalSerialize(objB);
    assert.strictEqual(serializedA, serializedB, 'Different key orders must produce identical canonical string');

    const commitA = computeHmacSha256(objA, 'test');
    const commitB = computeHmacSha256(objB, 'test');
    assert.strictEqual(commitA, commitB, 'Commitments must be strictly deterministic');
  });

  test('2. Different content generates different commitments', () => {
    const commit1 = computeHmacSha256({ status: 'Submitted', id: 1 }, 'test');
    const commit2 = computeHmacSha256({ status: 'Resolved', id: 1 }, 'test');
    assert.notStrictEqual(commit1, commit2, 'Different statuses must produce distinct commitments');
  });

  test('3. No plaintext personal data appears in ledger payloads', () => {
    // validatePrivacySanitized throws if PII is detected
    assert.throws(() => {
      validatePrivacySanitized({ name: 'Pratik Tupe', status: 'Submitted' });
    }, /Plaintext PII key "name" is forbidden/);

    assert.throws(() => {
      validatePrivacySanitized({ citizen_name: 'John Doe', action: 'CREATE' });
    }, /Plaintext PII key "citizen_name" is forbidden/);

    assert.throws(() => {
      validatePrivacySanitized({ phone: '9876543210' });
    }, /Plaintext PII key "phone" is forbidden/);

    // Pseudonym generator masks citizen identity
    const pseudonym = generatePseudonym('987681', 'citizen');
    assert.ok(pseudonym.startsWith('PSN-CIT-'));
    assert.strictEqual(pseudonym.includes('987681'), false, 'Pseudonym must not contain raw user ID');
  });

  test('4. No GPS or EXIF metadata appears on-chain', () => {
    assert.throws(() => {
      validatePrivacySanitized({ latitude: 18.52, longitude: 73.85 });
    }, /Plaintext PII key "latitude" is forbidden/);

    assert.throws(() => {
      validatePrivacySanitized({ exif: { camera: 'iPhone' } });
    }, /Plaintext PII key "exif" is forbidden/);

    // Location commitment blinds coordinates
    const locCommit = generateLocationCommitment(18.52043, 73.85674, 5);
    assert.strictEqual(typeof locCommit, 'string');
    assert.strictEqual(locCommit.length, 64);
    assert.strictEqual(locCommit.includes('18.52'), false, 'Commitment must not reveal coordinate plaintext');
  });

  test('5. Authorized event generation succeeds', async () => {
    const comp = {
      id: testComplaintId,
      complaint_number: 'TEST-BC-001',
      citizen_id: testCitizenId,
      category: 'Roads',
      priority: 'Medium',
      status: 'Submitted',
      department_id: '8ed9f760-1314-427c-a515-c2a54d6df6d8',
      latitude: baseLat,
      longitude: baseLng,
      location_accuracy_m: 5,
      photo_before_url: '/uploads/civic-default.jpg'
    };

    const res = await integrityService.recordComplaintSubmission(comp);
    assert.strictEqual(res.anchored, true);
    assert.ok(res.txId);
    assert.ok(res.commitmentHash);
    testTxId = res.txId;

    // Verify in database
    const txDb = await query(`SELECT * FROM blockchain_transactions WHERE tx_id = ?`, [testTxId]);
    assert.strictEqual(txDb.rows.length, 1);
    assert.strictEqual(txDb.rows[0].status, 'COMMITTED');
    assert.ok(txDb.rows[0].block_number >= 1);
  });

  test('6. Unauthorized ledger mutation is rejected', async () => {
    // Citizen role attempting to call Super Admin verification endpoint
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/blockchain/verify/complaint/${testComplaintId}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenToken}`
      }
    });

    assert.strictEqual(res.status, 403, 'Unauthorized role must be rejected with 403 Forbidden');
  });

  test('7. Duplicate delivery is idempotent', async () => {
    const duplicateTxId = `TEST-IDEMP-${Date.now()}`;
    const txPayload = {
      txId: duplicateTxId,
      entityType: 'complaint',
      entityId: 'TEST-IDEMP-ENTITY',
      eventType: EVENT_TYPES.COMPLAINT_SUBMITTED,
      version: 1,
      commitmentHash: computeHmacSha256({ test: 'idempotent' }, 'test'),
      metadata: { action: 'IDEMPOTENCY_TEST' }
    };

    const res1 = await ledgerAdapter.submitTransaction(txPayload);
    const res2 = await ledgerAdapter.submitTransaction(txPayload);

    assert.strictEqual(res2.idempotent, true, 'Second submission must return idempotent receipt');
    assert.strictEqual(res1.txId, res2.txId);

    const countRes = await query(`SELECT COUNT(*) as count FROM blockchain_transactions WHERE tx_id = ?`, [duplicateTxId]);
    assert.strictEqual(Number(countRes.rows[0].count), 1, 'Database must have exactly 1 transaction record');
  });

  test('8. Event ordering remains correct', async () => {
    const comp = {
      id: testComplaintId,
      status: 'Submitted',
      category: 'Roads',
      department_id: '8ed9f760-1314-427c-a515-c2a54d6df6d8'
    };

    const updateRes = await integrityService.recordStatusUpdate(comp, 'In Progress', 'Field Officer', 'Repairs underway');
    assert.strictEqual(updateRes.anchored, true);
    assert.strictEqual(updateRes.version, 2, 'Version must increment to 2');

    // Update operational DB to match authorized workflow
    await query(`UPDATE complaints SET status = 'In Progress' WHERE id = ?`, [testComplaintId]);

    const txV1 = await query(`SELECT * FROM blockchain_transactions WHERE entity_id = ? AND version = 1`, [String(testComplaintId)]);
    const txV2 = await query(`SELECT * FROM blockchain_transactions WHERE entity_id = ? AND version = 2`, [String(testComplaintId)]);

    assert.ok(txV1.rows.length > 0 && txV2.rows.length > 0);
    assert.strictEqual(txV2.rows[0].previous_commitment_hash, txV1.rows[0].commitment_hash, 'V2 must link to V1 commitment hash');
    assert.ok(Number(txV2.rows[0].block_number) >= Number(txV1.rows[0].block_number), 'Block numbers must increment monotonically');
  });

  test('9. Tampering is detected during verification', async () => {
    // Current state matches blockchain
    const verifyBefore = await verificationService.verifyComplaintIntegrity(testComplaintId);
    assert.strictEqual(verifyBefore.verified, true, 'Legitimate record must verify');
    assert.strictEqual(verifyBefore.tampered, false);

    // Simulate unauthorized database tampering (e.g. rogue SQL modification of status/priority)
    await query(`UPDATE complaints SET priority = 'Critical' WHERE id = ?`, [testComplaintId]);

    const verifyAfter = await verificationService.verifyComplaintIntegrity(testComplaintId);
    assert.strictEqual(verifyAfter.verified, false, 'Tampered record must fail verification');
    assert.strictEqual(verifyAfter.tampered, true);
    assert.strictEqual(verifyAfter.status, 'TAMPER_DETECTED');

    // Restore to legitimate state
    await query(`UPDATE complaints SET priority = 'Medium' WHERE id = ?`, [testComplaintId]);
    const verifyRestored = await verificationService.verifyComplaintIntegrity(testComplaintId);
    assert.strictEqual(verifyRestored.verified, true);
  });

  test('10. Ledger unavailability is reported correctly', async () => {
    ledgerAdapter.setLedgerAvailable(false);

    const pendingTxId = `TEST-OFFLINE-${Date.now()}`;
    const res = await ledgerAdapter.submitTransaction({
      txId: pendingTxId,
      entityType: 'complaint',
      entityId: String(testComplaintId),
      eventType: EVENT_TYPES.STATUS_UPDATED,
      version: 3,
      commitmentHash: computeHmacSha256({ offline: true }, 'test'),
      metadata: { action: 'OFFLINE_TEST' }
    });

    assert.strictEqual(res.status, 'PENDING');
    assert.strictEqual(res.queued, true);

    const diag = await verificationService.getLedgerDiagnostics();
    assert.strictEqual(diag.framework.status, 'UNAVAILABLE');
    assert.ok(diag.pending_outbox_count >= 1);
  });

  test('11. Pending events are retried safely', async () => {
    // Restore ledger
    ledgerAdapter.setLedgerAvailable(true);

    const retryRes = await ledgerAdapter.processPendingOutbox();
    assert.ok(retryRes.processed >= 1, 'Must process pending outbox events');

    const diag = await verificationService.getLedgerDiagnostics();
    assert.strictEqual(diag.pending_outbox_count, 0, 'Pending outbox should be drained');
  });

  test('12. Evidence version integrity works', async () => {
    await query(`UPDATE complaints SET photo_before_url = '/uploads/new-photo.jpg' WHERE id = ?`, [testComplaintId]);
    const evRes = await integrityService.recordEvidenceReplacement(testComplaintId, 2, '/uploads/new-photo.jpg', 'Replaced evidence', 'Super Admin');
    assert.strictEqual(evRes.anchored, true);

    const evVerify = await verificationService.verifyEvidenceIntegrity(testComplaintId);
    assert.strictEqual(evVerify.verified, true);
    assert.strictEqual(evVerify.tampered, false);
  });

  test('13. Location correction creates a new version proof', async () => {
    const locRes = await integrityService.recordLocationCorrection(testComplaintId, baseLat + 0.001, baseLng + 0.001, 'Corrected by Super Admin');
    assert.strictEqual(locRes.anchored, true);

    const locTx = await query(`SELECT * FROM blockchain_transactions WHERE entity_type = 'location' AND entity_id = ?`, [String(testComplaintId)]);
    assert.ok(locTx.rows.length > 0);
    assert.strictEqual(locTx.rows[0].status, 'COMMITTED');
  });

  test('14. Super Admin verification is properly authorized', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/super-admin/blockchain/verify/complaint/${testComplaintId}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${superAdminToken}`
      }
    });

    assert.strictEqual(res.status, 200, 'Super Admin must receive 200 OK');
    assert.strictEqual(res.body.success, true);
    assert.ok('verified' in res.body);

    // Diagnostics endpoint check
    const diagRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/super-admin/blockchain/status',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });

    assert.strictEqual(diagRes.status, 200);
    assert.ok(diagRes.body.blocks_count >= 1);
  });

  test('15. Existing citizen complaint submission remains functional', async () => {
    const payload = {
      category: 'Street Lighting',
      title: 'TEST-BC-Submission-Flow',
      description: 'Verifying complaint submission completes normally with blockchain anchoring.',
      priority: 'Low',
      latitude: baseLat + 0.1,
      longitude: baseLng + 0.1,
      location_source: 'map_pin',
      department_code: 'ELE',
      photo_url: '/uploads/street-light-test.jpg'
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

    assert.strictEqual(res.status, 201, 'Submission must succeed with 201');
    assert.ok(res.body.complaint_id);

    // Verify blockchain committed for this new complaint
    const bcTx = await query(`SELECT * FROM blockchain_transactions WHERE entity_id = ?`, [String(res.body.complaint_id)]);
    assert.ok(bcTx.rows.length > 0, 'New complaint must have blockchain commitment');
    assert.strictEqual(bcTx.rows[0].status, 'COMMITTED');

    // Cleanup
    await query(`DELETE FROM blockchain_transactions WHERE entity_id = ?`, [String(res.body.complaint_id)]);
    await query(`DELETE FROM complaints WHERE id = ?`, [res.body.complaint_id]);
  });

  test('16. Existing complaint retrieval remains functional', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${testComplaintId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });

    assert.strictEqual(res.status, 200, 'Complaint retrieval must succeed');
    assert.strictEqual(res.body.complaint.id, testComplaintId);
    assert.strictEqual(res.body.complaint.title, 'Blockchain Test Pothole');
  });

  test('17. Existing recurrence detection remains functional', async () => {
    const { detectRecurringIssue } = require('../src/services/recurringIssueService');
    const result = await detectRecurringIssue({
      id: 999988,
      category: 'pothole',
      latitude: baseLat,
      longitude: baseLng,
      location_source: 'exif',
      created_at: new Date().toISOString()
    });

    // Valid recurrence interface check
    assert.ok('is_recurring' in result);
    assert.ok('recurrence_status' in result);
  });
});
