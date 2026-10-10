const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const NagarsetuIntegrityContract = require('../lib/NagarsetuIntegrityContract');

class MockStub {
  constructor() {
    this.state = new Map();
    this.txId = 'FABRIC-TX-MOCK-001';
    this.timestamp = { seconds: { low: 1728518400 } }; // Epoch timestamp
    this.events = [];
  }

  createCompositeKey(prefix, attributes) {
    return `${prefix}~${attributes.join('~')}`;
  }

  async putState(key, value) {
    this.state.set(key, Buffer.from(value));
  }

  async getState(key) {
    return this.state.get(key) || null;
  }

  getTxID() {
    return this.txId;
  }

  getTxTimestamp() {
    return this.timestamp;
  }

  setEvent(name, payload) {
    this.events.push({ name, payload: payload.toString('utf8') });
  }

  async getStateByPartialCompositeKey(prefix, attributes) {
    const searchPrefix = `${prefix}~${attributes.join('~')}`;
    const matching = [];
    for (const [k, v] of this.state.entries()) {
      if (k.startsWith(searchPrefix)) {
        matching.push({ value: v });
      }
    }
    let idx = 0;
    return {
      next: async () => {
        if (idx < matching.length) {
          return { value: matching[idx++], done: false };
        }
        return { done: true };
      },
      close: async () => {}
    };
  }
}

class MockContext {
  constructor() {
    this.stub = new MockStub();
    this.clientIdentity = {
      getMSPID: () => 'MunicipalAuthorityMSP'
    };
  }
}

describe('NAGARSETU 3.1 — Hyperledger Fabric Smart Contract Unit Tests', () => {
  let contract;
  let ctx;

  beforeEach(() => {
    contract = new NagarsetuIntegrityContract();
    ctx = new MockContext();
  });

  test('1. InitLedger creates genesis state and records MSP identity', async () => {
    const resStr = await contract.InitLedger(ctx);
    const res = JSON.parse(resStr);
    assert.strictEqual(res.network, 'nagarsetu-permissioned-consortium');
    assert.strictEqual(res.msp_id, 'MunicipalAuthorityMSP');
  });

  test('2. RegisterCommitment succeeds for valid privacy-sanitized metadata', async () => {
    const txId = 'TX-TEST-001';
    const metadata = JSON.stringify({ category: 'roads', action: 'SUBMISSION' });
    const commitmentHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef';

    const resStr = await contract.RegisterCommitment(
      ctx, txId, 'complaint', '101', 'COMPLAINT_SUBMITTED', '1', commitmentHash, null, metadata
    );
    const res = JSON.parse(resStr);

    assert.strictEqual(res.status, 'COMMITTED');
    assert.strictEqual(res.txId, txId);
    assert.strictEqual(res.version, 1);
    assert.strictEqual(res.creator_msp, 'MunicipalAuthorityMSP');
  });

  test('3. RegisterCommitment rejects raw PII fields (Privacy Enforcement)', async () => {
    const txId = 'TX-TEST-PII';
    const metadataWithPii = JSON.stringify({
      category: 'roads',
      citizen_name: 'John Doe', // FORBIDDEN PII KEY
      email: 'john@example.com'
    });

    await assert.rejects(
      async () => {
        await contract.RegisterCommitment(
          ctx, txId, 'complaint', '102', 'COMPLAINT_SUBMITTED', '1', 'hash123', null, metadataWithPii
        );
      },
      /PRIVACY VIOLATION/
    );
  });

  test('4. RegisterCommitment is idempotent for identical txId', async () => {
    const txId = 'TX-IDEMPOTENT-001';
    const metadata = JSON.stringify({ category: 'sanitation' });
    const commitment = 'hash-commit-111';

    await contract.RegisterCommitment(ctx, txId, 'complaint', '103', 'COMPLAINT_SUBMITTED', '1', commitment, null, metadata);

    // Call second time with same txId
    const secondCallStr = await contract.RegisterCommitment(ctx, txId, 'complaint', '103', 'COMPLAINT_SUBMITTED', '1', commitment, null, metadata);
    const secondCall = JSON.parse(secondCallStr);

    assert.strictEqual(secondCall.status, 'IDEMPOTENT_COMMITTED');
    assert.strictEqual(secondCall.txId, txId);
  });

  test('5. VerifyCommitment detects intact matches and tampering mismatches', async () => {
    const txId = 'TX-VERIFY-001';
    const commitment = 'true-hash-555';
    await contract.RegisterCommitment(ctx, txId, 'complaint', '104', 'COMPLAINT_SUBMITTED', '1', commitment, null, '{}');

    // Positive verify
    const okRes = JSON.parse(await contract.VerifyCommitment(ctx, 'complaint', '104', commitment));
    assert.strictEqual(okRes.verified, true);
    assert.strictEqual(okRes.status, 'VERIFIED');

    // Negative verify (tampered hash)
    const tamperedRes = JSON.parse(await contract.VerifyCommitment(ctx, 'complaint', '104', 'forged-hash-666'));
    assert.strictEqual(tamperedRes.verified, false);
    assert.strictEqual(tamperedRes.status, 'INTEGRITY_MISMATCH');
  });

  test('6. Versioning requires sequential versions and chain linkage', async () => {
    const v1Hash = 'v1-hash-111';
    const v2Hash = 'v2-hash-222';

    // Register v1
    await contract.RegisterCommitment(ctx, 'TX-V1', 'complaint', '105', 'COMPLAINT_SUBMITTED', '1', v1Hash, null, '{}');

    // Register v2 linking to v1Hash
    const v2Res = JSON.parse(
      await contract.RegisterCommitment(ctx, 'TX-V2', 'complaint', '105', 'STATUS_UPDATED', '2', v2Hash, v1Hash, '{}')
    );
    assert.strictEqual(v2Res.version, 2);

    // Attempting v2 again should fail with version conflict
    await assert.rejects(
      async () => {
        await contract.RegisterCommitment(ctx, 'TX-V2-DUP', 'complaint', '105', 'STATUS_UPDATED', '2', 'hash-other', v1Hash, '{}');
      },
      /Version conflict/
    );

    // Attempting v3 with incorrect previous hash should fail with chain break
    await assert.rejects(
      async () => {
        await contract.RegisterCommitment(ctx, 'TX-V3-BAD', 'complaint', '105', 'STATUS_UPDATED', '3', 'v3-hash', 'wrong-prev-hash', '{}');
      },
      /Chain break/
    );
  });

  test('7. GetCommitmentHistory returns chronologically sorted versions', async () => {
    await contract.RegisterCommitment(ctx, 'TX-H1', 'complaint', '106', 'COMPLAINT_SUBMITTED', '1', 'hash-h1', null, '{}');
    await contract.RegisterCommitment(ctx, 'TX-H2', 'complaint', '106', 'STATUS_UPDATED', '2', 'hash-h2', 'hash-h1', '{}');

    const historyRes = JSON.parse(await contract.GetCommitmentHistory(ctx, 'complaint', '106'));
    assert.strictEqual(historyRes.total_versions, 2);
    assert.strictEqual(historyRes.history[0].version, 1);
    assert.strictEqual(historyRes.history[1].version, 2);
  });

  test('8. CheckTransactionExists returns true for existing and false for unknown', async () => {
    await contract.RegisterCommitment(ctx, 'TX-EXISTS', 'complaint', '107', 'COMPLAINT_SUBMITTED', '1', 'hash', null, '{}');

    const exRes = JSON.parse(await contract.CheckTransactionExists(ctx, 'TX-EXISTS'));
    assert.strictEqual(exRes.exists, true);
    assert.strictEqual(exRes.status, 'COMMITTED');

    const notExRes = JSON.parse(await contract.CheckTransactionExists(ctx, 'TX-UNKNOWN'));
    assert.strictEqual(notExRes.exists, false);
    assert.strictEqual(notExRes.status, 'NOT_FOUND');
  });
});
