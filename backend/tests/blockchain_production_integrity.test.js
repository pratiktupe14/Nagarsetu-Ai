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
  computeSha256,
  computeHmacSha256,
  generatePseudonym,
  generateLocationCommitment,
  generateEvidenceCommitment,
  generateComplaintCommitment,
  ledgerAdapter,
  integrityService,
  verificationService,
  keyManagementService,
  fabricConnector
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

describe('NAGARSETU 3.1 — Master Blockchain Production & Privacy Suite', () => {
  const citizenId = 'e2a4338c-5d49-4ae3-b766-40d99fb26f87';
  const ownerCitizenToken = 'demo-token-citizen';
  const otherCitizenToken = generateToken({
    id: 887766,
    name: 'Unauthorized Citizen',
    email: 'other@example.com',
    role: 'citizen'
  });
  const adminToken = 'demo-token-city-admin';
  const pwdStaffToken = 'demo-token-pwd-staff'; // Rohit More, id 23, PWD
  const unassignedStaffToken = generateToken({
    id: 7711,
    name: 'Unassigned Staff',
    role: 'service_staff',
    department_id: '8ed9f760-1314-427c-a515-c2a54d6df6d8'
  });

  let testComplaintId;
  let testComplaintNumber;

  before(async () => {
    await ledgerAdapter.ensureSchema();
    ledgerAdapter.setLedgerAvailable(true);

    // Create an isolated complaint for blockchain lifecycle tests
    const lat = 18.5204 + (Math.random() * 0.05);
    const lng = 73.8567 + (Math.random() * 0.05);
    const payload = {
      category: 'Roads',
      title: 'Blockchain Master Verification Pothole',
      description: 'Critical road defect requiring verified integrity anchor',
      priority: 'High',
      latitude: lat,
      longitude: lng,
      location_source: 'device_gps',
      location_accuracy_m: 8,
      location_address: 'Hadapsar Bypass, Pune',
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

    assert.strictEqual(res.status, 201);
    testComplaintId = res.body.complaint_id;
    testComplaintNumber = res.body.complaint_number;
    assert.ok(testComplaintId);

    // Assign to Rohit More (id 23)
    await query(
      `UPDATE complaints
       SET status = 'Staff Assigned',
           assigned_staff_id = '23',
           assigned_staff_name = 'Rohit More',
           assigned_staff_email = 'rohit.more@nagarsetu.gov.in',
           department_id = '8ed9f760-1314-427c-a515-c2a54d6df6d8'
       WHERE id = ?`,
      [testComplaintId]
    );

    // Record assignment on blockchain
    await integrityService.recordAssignment({ id: testComplaintId, department_id: '8ed9f760-1314-427c-a515-c2a54d6df6d8' }, '23', 'Rohit More', 'HOD');
  });

  after(async () => {
    ledgerAdapter.setLedgerAvailable(true);
    ledgerAdapter.stopOutboxWorker();
    try {
      await query(`DELETE FROM blockchain_transactions WHERE entity_id IN (?, 'test_offline_entity')`, [String(testComplaintId)]);
      await query(`DELETE FROM complaints WHERE id = ?`, [testComplaintId]);
    } catch (e) {}
  });

  // =========================================================================
  // 1. BLOCKCHAIN INTEGRITY & CONSISTENCY TESTS
  // =========================================================================
  test('1. Complaint submission generates deterministic privacy commitment and anchors block', async () => {
    const latestTx = await ledgerAdapter.getLatestEntityTransaction('complaint', String(testComplaintId));
    assert.ok(latestTx, 'Transaction must be committed in ledger');
    assert.strictEqual(latestTx.status, 'COMMITTED');
    assert.ok(latestTx.block_number >= 1, 'Block number must be anchored');
    assert.ok(latestTx.commitment_hash);
  });

  test('2. Transaction idempotency prevents duplicate block anchoring', async () => {
    const existingTxId = `TX-IDEM-${Date.now()}`;
    const firstAnchor = await ledgerAdapter.submitTransaction({
      txId: existingTxId,
      entityType: 'test_entity',
      entityId: '999',
      eventType: EVENT_TYPES.COMPLAINT_SUBMITTED,
      version: 1,
      commitmentHash: 'abc123hash',
      metadata: { test: true }
    });

    assert.strictEqual(firstAnchor.status, 'COMMITTED');

    // Submit identical txId again
    const secondAnchor = await ledgerAdapter.submitTransaction({
      txId: existingTxId,
      entityType: 'test_entity',
      entityId: '999',
      eventType: EVENT_TYPES.COMPLAINT_SUBMITTED,
      version: 1,
      commitmentHash: 'abc123hash',
      metadata: { test: true }
    });

    assert.strictEqual(secondAnchor.idempotent, true);
    assert.strictEqual(secondAnchor.txId, existingTxId);
  });

  test('3. Outbox queues events when ledger is offline and flushes on recovery', async () => {
    ledgerAdapter.setLedgerAvailable(false);

    const offlineTxId = `TX-OFFLINE-${Date.now()}`;
    const queuedRes = await ledgerAdapter.submitTransaction({
      txId: offlineTxId,
      entityType: 'test_offline_entity',
      entityId: 'offline-item-123',
      eventType: EVENT_TYPES.STATUS_UPDATED,
      version: 1,
      commitmentHash: 'offline_commitment_hash',
      metadata: { action: 'QUEUED_OFFLINE' }
    });

    assert.strictEqual(queuedRes.status, 'PENDING');
    assert.strictEqual(queuedRes.queued, true);

    // Re-enable ledger and trigger outbox flush
    ledgerAdapter.setLedgerAvailable(true);
    const flushRes = await ledgerAdapter.processPendingOutbox();
    assert.ok(flushRes.processed >= 1, 'Outbox must process pending transactions');

    // Confirm transaction is now COMMITTED
    const receipt = await ledgerAdapter.getTransactionReceipt(offlineTxId);
    assert.strictEqual(receipt.tx.status, 'COMMITTED');
    assert.ok(receipt.tx.block_number != null);
  });

  test('4. Dead-letter protection: events with retry_count >= 10 are safely isolated', async () => {
    const deadLetterTxId = `TX-POISON-${Date.now()}`;
    await query(`
      INSERT INTO blockchain_transactions (tx_id, block_number, entity_type, entity_id, event_type, version, commitment_hash, metadata_json, status, retry_count)
      VALUES (?, NULL, 'test_poison', '999', 'POISON_EVENT', 1, 'hash_poison', '{}', 'PENDING', 10)
    `, [deadLetterTxId]);

    await ledgerAdapter.processPendingOutbox();

    const checkRes = await query(`SELECT status FROM blockchain_transactions WHERE tx_id = ?`, [deadLetterTxId]);
    assert.strictEqual(checkRes.rows?.[0]?.status, 'DEAD_LETTER');

    await query(`DELETE FROM blockchain_transactions WHERE tx_id = ?`, [deadLetterTxId]);
  });

  test('5. Cryptographic tampering detection flags modified database fields', async () => {
    // Current database state should verify as intact
    const originalVerify = await verificationService.verifyComplaintIntegrity(testComplaintId);
    assert.strictEqual(originalVerify.verified, true);
    assert.strictEqual(originalVerify.status, 'INTACT');
    assert.strictEqual(originalVerify.verification_status, 'VERIFIED');

    // Simulate unauthorized malicious database modification
    await query(`UPDATE complaints SET priority = 'Low', status = 'Tampered' WHERE id = ?`, [testComplaintId]);

    const tamperedVerify = await verificationService.verifyComplaintIntegrity(testComplaintId);
    assert.strictEqual(tamperedVerify.verified, false);
    assert.strictEqual(tamperedVerify.tampered, true);
    assert.strictEqual(tamperedVerify.status, 'TAMPER_DETECTED');
    assert.strictEqual(tamperedVerify.verification_status, 'INTEGRITY_MISMATCH');

    // Restore legitimate state
    await query(`UPDATE complaints SET priority = 'High', status = 'Staff Assigned' WHERE id = ?`, [testComplaintId]);
    const restoredVerify = await verificationService.verifyComplaintIntegrity(testComplaintId);
    assert.strictEqual(restoredVerify.verified, true);
  });

  test('6. Legitimate administrative state update creates chained version', async () => {
    await query(`UPDATE complaints SET status = 'In Progress' WHERE id = ?`, [testComplaintId]);
    const updateReceipt = await integrityService.recordStatusUpdate(
      { id: testComplaintId, priority: 'High', status: 'In Progress' },
      'In Progress',
      'Rohit More',
      'Staff began repair work on site'
    );

    assert.strictEqual(updateReceipt.anchored, true);
    assert.ok(updateReceipt.version >= 2);

    const verifyRes = await verificationService.verifyComplaintIntegrity(testComplaintId);
    assert.strictEqual(verifyRes.verified, true);
    assert.strictEqual(verifyRes.version, updateReceipt.version);
  });

  test('7. Super Admin diagnostics report accurate ledger blocks, transactions, and framework', async () => {
    const diag = await verificationService.getLedgerDiagnostics();
    assert.ok(diag.blocks_count >= 1);
    assert.ok(diag.committed_transactions_count >= 1);
    assert.ok(diag.framework.validatorNode);
    assert.strictEqual(diag.framework.channel, 'nagarsetu-channel');
  });

  // =========================================================================
  // 2. PRIVACY ENFORCEMENT TESTS
  // =========================================================================
  test('8. Zero plaintext PII in ledger metadata: rejected by validator', () => {
    const piiPayload = {
      action: 'SUBMISSION',
      citizen_name: 'Pratik Tupe', // PII
      latitude: 18.5204            // RAW GPS
    };

    assert.throws(() => {
      validatePrivacySanitized(piiPayload);
    }, /PRIVACY VIOLATION/);
  });

  test('9. No raw GPS coordinates or photos on-chain: stored as keyed HMAC commitments', () => {
    const lat = 18.520432;
    const lng = 73.856743;
    const locCommit = generateLocationCommitment(lat, lng, 10);
    assert.strictEqual(typeof locCommit, 'string');
    assert.strictEqual(locCommit.length, 64); // SHA-256 hex string
    assert.strictEqual(locCommit.includes('18.5204'), false);

    const pseud = generatePseudonym('8788562103', 'citizen');
    assert.strictEqual(pseud.startsWith('PSN-CIT-'), true);
    assert.strictEqual(pseud.includes('8788562103'), false);
  });

  // =========================================================================
  // 3. RBAC & ENDPOINT AUTHORIZATION TESTS
  // =========================================================================
  test('10. Owner citizen can verify their complaint integrity via API', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${testComplaintId}/blockchain-verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${ownerCitizenToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verified, true);
    assert.strictEqual(res.body.verification_status, 'VERIFIED');
  });

  test('11. Non-owner citizen is denied verification access (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${testComplaintId}/blockchain-verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${otherCitizenToken}` }
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /only verify your own complaints/i);
  });

  test('12. Assigned field staff can verify task integrity', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${testComplaintId}/blockchain-verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${pwdStaffToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verified, true);
  });

  test('13. Unassigned staff is denied verification access (403 Forbidden)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${testComplaintId}/blockchain-verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${unassignedStaffToken}` }
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /not assigned/i);
  });

  test('14. City Admin can verify any complaint integrity', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${testComplaintId}/blockchain-verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.verified, true);
    assert.strictEqual(res.body.verification_status, 'VERIFIED');
  });

  // =========================================================================
  // 4. KEY MANAGEMENT & CONNECTOR INTEGRATION
  // =========================================================================
  test('15. Key management status confirms versioning and KMS integration readiness', () => {
    const status = keyManagementService.getKeyManagementStatus();
    assert.ok(status.provider);
    assert.ok(status.keyVersion);
    assert.strictEqual(typeof status.hasProductionSecret, 'boolean');
  });

  test('16. Fabric Gateway connector provides honest staging topology status', () => {
    const gatewayStatus = fabricConnector.getConnectionStatus();
    assert.strictEqual(gatewayStatus.channel, 'nagarsetu-channel');
    assert.strictEqual(gatewayStatus.mspId, 'MunicipalAuthorityMSP');
    assert.strictEqual(gatewayStatus.connected, false); // Honest staging report: local adapter active
    assert.strictEqual(gatewayStatus.mode, 'LOCAL_PERMISSIONED_ADAPTER_ACTIVE');
  });
});
