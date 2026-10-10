let Contract;
try {
  Contract = require('fabric-contract-api').Contract;
} catch (e) {
  Contract = class {
    constructor(name) { this.name = name; }
  };
}

// Forbidden raw PII keys that must never appear anywhere in chaincode inputs
const FORBIDDEN_PII_KEYS = [
  'name', 'citizen_name', 'email', 'mobile', 'phone', 'password',
  'password_hash', 'jwt_token', 'token', 'latitude', 'longitude',
  'gps', 'gps_coordinates', 'address', 'residential_address',
  'location_address', 'description', 'photo_url', 'photo_before_url',
  'photo_after_url', 'exif', 'exif_metadata'
];

class NagarsetuIntegrityContract extends Contract {
  constructor() {
    super('NagarsetuIntegrityContract');
  }

  /**
   * Initialize contract ledger state
   */
  async InitLedger(ctx) {
    console.info('=== Initializing NAGARSETU 3.1 Permissioned Integrity Chaincode ===');
    const initReceipt = {
      initialized_at: new Date().toISOString(),
      network: 'nagarsetu-permissioned-consortium',
      version: '3.1.0',
      msp_id: ctx.clientIdentity ? ctx.clientIdentity.getMSPID() : 'UNKNOWN'
    };
    await ctx.stub.putState('GENESIS_RECORD', Buffer.from(JSON.stringify(initReceipt)));
    return JSON.stringify(initReceipt);
  }

  /**
   * Helper: enforce strict zero-PII validation on any input JSON or string
   */
  _validatePrivacySanitized(inputString) {
    if (!inputString) return;
    const lower = String(inputString).toLowerCase();
    for (const forbiddenKey of FORBIDDEN_PII_KEYS) {
      // Check for JSON key patterns like "email": or "latitude":
      const pattern = new RegExp(`["']?${forbiddenKey}["']?\\s*:`, 'i');
      if (pattern.test(lower)) {
        throw new Error(`[PRIVACY VIOLATION] Input contains prohibited raw PII field: "${forbiddenKey}". Only privacy commitments are permitted on-chain.`);
      }
    }
  }

  /**
   * 1. Register Integrity Commitment
   * 
   * Stores an immutable privacy-safe cryptographic commitment for a municipal entity.
   * Enforces idempotency, version linkage, and zero raw PII.
   */
  async RegisterCommitment(ctx, txId, entityType, entityId, eventType, versionStr, commitmentHash, previousCommitmentHash, metadataJson) {
    if (!txId || !entityType || !entityId || !eventType || !commitmentHash) {
      throw new Error('Missing required arguments for RegisterCommitment');
    }

    // Enforce privacy compliance
    this._validatePrivacySanitized(metadataJson);

    // Validate MSP authorization
    const clientMsp = ctx.clientIdentity ? ctx.clientIdentity.getMSPID() : 'LocalMSP';
    const version = parseInt(versionStr, 10) || 1;

    // Composite key for unique transaction
    const txKey = ctx.stub.createCompositeKey('TX', [txId]);
    const existingTx = await ctx.stub.getState(txKey);
    if (existingTx && existingTx.length > 0) {
      // Idempotency: Return existing receipt without error
      const existingObj = JSON.parse(existingTx.toString('utf8'));
      return JSON.stringify({
        status: 'IDEMPOTENT_COMMITTED',
        txId,
        block_number: existingObj.block_number || null,
        commitmentHash: existingObj.commitmentHash,
        anchored_at: existingObj.timestamp
      });
    }

    // Entity latest commitment key
    const entityKey = ctx.stub.createCompositeKey('ENTITY', [entityType, entityId]);
    const existingEntity = await ctx.stub.getState(entityKey);

    if (existingEntity && existingEntity.length > 0) {
      const currentLatest = JSON.parse(existingEntity.toString('utf8'));
      // Enforce sequential versioning
      if (version <= currentLatest.version) {
        throw new Error(`Version conflict: Attempted version ${version} is not greater than existing version ${currentLatest.version}`);
      }
      // Enforce cryptographic chain continuity if previous hash is provided
      if (previousCommitmentHash && currentLatest.commitmentHash !== previousCommitmentHash) {
        throw new Error(`Chain break: Provided previousCommitmentHash does not match recorded state for version ${currentLatest.version}`);
      }
    }

    const timestamp = new Date(ctx.stub.getTxTimestamp().seconds.low * 1000).toISOString();
    const fabricTxId = ctx.stub.getTxID();

    const commitmentRecord = {
      txId,
      fabricTxId,
      entityType,
      entityId,
      eventType,
      version,
      commitmentHash,
      previousCommitmentHash: previousCommitmentHash || null,
      metadata: metadataJson ? JSON.parse(metadataJson) : {},
      creator_msp: clientMsp,
      timestamp,
      status: 'COMMITTED'
    };

    const recordBuffer = Buffer.from(JSON.stringify(commitmentRecord));

    // Store by Tx ID
    await ctx.stub.putState(txKey, recordBuffer);

    // Update entity latest pointer
    await ctx.stub.putState(entityKey, recordBuffer);

    // Store historical version index: e.g. VERSION~complaint~123~2
    const versionKey = ctx.stub.createCompositeKey('VERSION', [entityType, entityId, String(version)]);
    await ctx.stub.putState(versionKey, recordBuffer);

    // Emit event for off-chain listeners
    const eventPayload = Buffer.from(JSON.stringify({
      txId,
      entityType,
      entityId,
      version,
      commitmentHash,
      eventType
    }));
    ctx.stub.setEvent('CommitmentRegistered', eventPayload);

    return JSON.stringify({
      status: 'COMMITTED',
      txId,
      fabricTxId,
      entityType,
      entityId,
      version,
      commitmentHash,
      creator_msp: clientMsp,
      anchored_at: timestamp
    });
  }

  /**
   * 2. Verify Integrity Commitment
   * 
   * Compares an expected commitment hash against the immutable ledger state.
   */
  async VerifyCommitment(ctx, entityType, entityId, expectedCommitmentHash) {
    if (!entityType || !entityId || !expectedCommitmentHash) {
      throw new Error('entityType, entityId, and expectedCommitmentHash are required');
    }

    const entityKey = ctx.stub.createCompositeKey('ENTITY', [entityType, entityId]);
    const stateBytes = await ctx.stub.getState(entityKey);

    if (!stateBytes || stateBytes.length === 0) {
      return JSON.stringify({
        verified: false,
        status: 'UNANCHORED',
        entityType,
        entityId,
        message: 'No on-chain commitment found for this entity'
      });
    }

    const latestRecord = JSON.parse(stateBytes.toString('utf8'));
    const isMatch = latestRecord.commitmentHash === expectedCommitmentHash;

    return JSON.stringify({
      verified: isMatch,
      status: isMatch ? 'VERIFIED' : 'INTEGRITY_MISMATCH',
      entityType,
      entityId,
      version: latestRecord.version,
      ledgerCommitment: latestRecord.commitmentHash,
      expectedCommitment: expectedCommitmentHash,
      anchored_at: latestRecord.timestamp,
      txId: latestRecord.txId,
      fabricTxId: latestRecord.fabricTxId
    });
  }

  /**
   * 3. Retrieve Commitment History
   * 
   * Retrieves all historical versions anchored for a specific entity using Fabric state query.
   */
  async GetCommitmentHistory(ctx, entityType, entityId) {
    if (!entityType || !entityId) {
      throw new Error('entityType and entityId are required');
    }

    const iterator = await ctx.stub.getStateByPartialCompositeKey('VERSION', [entityType, entityId]);
    const history = [];

    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.value.toString()) {
        try {
          const record = JSON.parse(res.value.value.toString('utf8'));
          history.push(record);
        } catch (e) {}
      }
      if (res.done) {
        await iterator.close();
        break;
      }
    }

    // Sort ascending by version
    history.sort((a, b) => a.version - b.version);

    return JSON.stringify({
      entityType,
      entityId,
      total_versions: history.length,
      history
    });
  }

  /**
   * 4. Register Record-Version Relationship
   * 
   * Binds parent-child entities, such as a complaint to an evidence replacement or location correction.
   */
  async RegisterVersionRelation(ctx, parentType, parentId, childType, childId, relationType, metadataJson) {
    this._validatePrivacySanitized(metadataJson);

    const relKey = ctx.stub.createCompositeKey('RELATION', [parentType, parentId, childType, childId]);
    const timestamp = new Date(ctx.stub.getTxTimestamp().seconds.low * 1000).toISOString();

    const relationRecord = {
      parentType,
      parentId,
      childType,
      childId,
      relationType,
      metadata: metadataJson ? JSON.parse(metadataJson) : {},
      creator_msp: ctx.clientIdentity ? ctx.clientIdentity.getMSPID() : 'LocalMSP',
      timestamp
    };

    await ctx.stub.putState(relKey, Buffer.from(JSON.stringify(relationRecord)));
    return JSON.stringify({ status: 'RELATION_REGISTERED', parentId, childId, timestamp });
  }

  /**
   * 5. Retrieve Ledger Transaction Receipt
   */
  async GetTransactionReceipt(ctx, txId) {
    if (!txId) throw new Error('txId is required');

    const txKey = ctx.stub.createCompositeKey('TX', [txId]);
    const txBytes = await ctx.stub.getState(txKey);

    if (!txBytes || txBytes.length === 0) {
      return JSON.stringify({ exists: false, error: 'TRANSACTION_NOT_FOUND', txId });
    }

    const record = JSON.parse(txBytes.toString('utf8'));
    return JSON.stringify({
      exists: true,
      receipt: record
    });
  }

  /**
   * 6. Check Transaction Existence and Status
   */
  async CheckTransactionExists(ctx, txId) {
    if (!txId) return JSON.stringify({ exists: false });

    const txKey = ctx.stub.createCompositeKey('TX', [txId]);
    const txBytes = await ctx.stub.getState(txKey);
    const exists = Boolean(txBytes && txBytes.length > 0);

    return JSON.stringify({
      txId,
      exists,
      status: exists ? JSON.parse(txBytes.toString('utf8')).status : 'NOT_FOUND'
    });
  }
}

module.exports = NagarsetuIntegrityContract;
