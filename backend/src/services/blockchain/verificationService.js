/**
 * NAGARSETU 3.1 — Blockchain Verification Service
 * 
 * Verifies operational database integrity against immutable permissioned ledger commitments.
 * Detects unauthorized database mutations, tampering, and provides non-sensitive audit proofs.
 * 
 * Standardized Verification Statuses:
 * - VERIFIED: Operational record strictly matches immutable blockchain commitment.
 * - PENDING_ANCHOR: Transaction queued in outbox awaiting ledger block commitment.
 * - INTEGRITY_MISMATCH: Unauthorized database change or data tampering detected.
 * - UNVERIFIABLE: No anchoring commitment found or operational record missing.
 * - LEDGER_UNAVAILABLE: Ledger is offline or unreachable; verification cannot be completed.
 */

const { query } = require('../../config/db');
const { generateComplaintCommitment, generateEvidenceCommitment, generateLocationCommitment } = require('./privacyCommitmentService');
const { ledgerAdapter } = require('./ledgerAdapter');

class BlockchainVerificationService {
  constructor(adapter = ledgerAdapter) {
    this.adapter = adapter;
  }

  /**
   * Verify complaint integrity against blockchain ledger
   */
  async verifyComplaintIntegrity(complaintId) {
    if (!complaintId) return { verified: false, status: 'UNVERIFIABLE', verification_status: 'UNVERIFIABLE', error: 'COMPLAINT_ID_REQUIRED' };

    // Check ledger availability first
    if (!this.adapter.isAvailable) {
      return {
        verified: false,
        status: 'LEDGER_UNAVAILABLE',
        verification_status: 'LEDGER_UNAVAILABLE',
        message: 'Permissioned ledger is currently unreachable. Verification cannot be confirmed.'
      };
    }

    // 1. Fetch current operational record from database
    const compRes = await query(
      `SELECT * FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`,
      [complaintId, complaintId, String(complaintId)]
    );

    if (!compRes.rows || compRes.rows.length === 0) {
      return { verified: false, status: 'UNVERIFIABLE', verification_status: 'UNVERIFIABLE', error: 'COMPLAINT_NOT_FOUND' };
    }
    const currentComplaint = compRes.rows[0];

    // 2. Fetch latest committed transaction on blockchain
    const tx = await this.adapter.getLatestEntityTransaction('complaint', String(currentComplaint.id));
    if (!tx) {
      // Check if outbox has a pending transaction
      const pendingRes = await query(
        `SELECT * FROM blockchain_transactions WHERE entity_type = 'complaint' AND entity_id = ? AND status = 'PENDING' LIMIT 1`,
        [String(currentComplaint.id)]
      ).catch(() => ({ rows: [] }));

      if (pendingRes.rows && pendingRes.rows.length > 0) {
        return {
          verified: false,
          tampered: false,
          status: 'PENDING_ANCHOR',
          verification_status: 'PENDING_ANCHOR',
          tx_id: pendingRes.rows[0].tx_id,
          message: 'Transaction is queued in durable outbox awaiting ledger block anchor.'
        };
      }

      return {
        verified: false,
        tampered: false,
        status: 'UNANCHORED',
        verification_status: 'UNVERIFIABLE',
        complaint_id: currentComplaint.id,
        message: 'No blockchain anchoring commitment found for this complaint record.'
      };
    }

    // 3. Re-calculate expected commitment using current operational database state
    const { commitmentHash: expectedCommitment } = generateComplaintCommitment(
      currentComplaint,
      tx.version,
      tx.previous_commitment_hash
    );

    const matches = expectedCommitment === tx.commitment_hash;

    return {
      verified: matches,
      tampered: !matches,
      status: matches ? 'INTACT' : 'TAMPER_DETECTED',
      verification_status: matches ? 'VERIFIED' : 'INTEGRITY_MISMATCH',
      complaint_id: currentComplaint.id,
      complaint_number: currentComplaint.complaint_number,
      latest_tx_id: tx.tx_id,
      block_number: tx.block_number,
      anchored_at: tx.anchored_at,
      version: tx.version,
      ledger_commitment: tx.commitment_hash,
      expected_commitment: expectedCommitment,
      finding: matches
        ? 'Operational record matches blockchain commitment byte-for-byte.'
        : 'Integrity mismatch: Operational database values differ from immutable blockchain commitment.'
    };
  }

  /**
   * Verify evidence version integrity
   */
  async verifyEvidenceIntegrity(complaintId) {
    if (!this.adapter.isAvailable) {
      return { verified: false, status: 'LEDGER_UNAVAILABLE', verification_status: 'LEDGER_UNAVAILABLE' };
    }

    const tx = await this.adapter.getLatestEntityTransaction('evidence', String(complaintId));
    if (!tx) {
      return { verified: false, status: 'UNANCHORED', verification_status: 'UNVERIFIABLE', message: 'No evidence transaction on blockchain.' };
    }

    const compRes = await query(`SELECT photo_before_url, primary_image_hash FROM complaints WHERE id = ?`, [complaintId]);
    const photo = compRes.rows?.[0]?.primary_image_hash || compRes.rows?.[0]?.photo_before_url;
    const expectedCommitment = generateEvidenceCommitment(photo, { version: tx.version });

    const matches = expectedCommitment === tx.commitment_hash;
    return {
      verified: matches,
      tampered: !matches,
      status: matches ? 'INTACT' : 'TAMPER_DETECTED',
      verification_status: matches ? 'VERIFIED' : 'INTEGRITY_MISMATCH',
      tx_id: tx.tx_id,
      block_number: tx.block_number,
      ledger_commitment: tx.commitment_hash
    };
  }

  /**
   * Verify location integrity
   */
  async verifyLocationIntegrity(complaintId) {
    if (!this.adapter.isAvailable) {
      return { verified: false, status: 'LEDGER_UNAVAILABLE', verification_status: 'LEDGER_UNAVAILABLE' };
    }

    const tx = await this.adapter.getLatestEntityTransaction('location', String(complaintId));
    if (!tx) {
      return { verified: false, status: 'UNANCHORED', verification_status: 'UNVERIFIABLE', message: 'No location transaction on blockchain.' };
    }

    const compRes = await query(`SELECT latitude, longitude, location_accuracy_m FROM complaints WHERE id = ?`, [complaintId]);
    if (!compRes.rows || compRes.rows.length === 0) {
      return { verified: false, status: 'UNVERIFIABLE', verification_status: 'UNVERIFIABLE', error: 'COMPLAINT_NOT_FOUND' };
    }

    const row = compRes.rows[0];
    const expectedCommitment = generateLocationCommitment(row.latitude, row.longitude);
    const matches = expectedCommitment === tx.commitment_hash;

    return {
      verified: matches,
      tampered: !matches,
      status: matches ? 'INTACT' : 'TAMPER_DETECTED',
      verification_status: matches ? 'VERIFIED' : 'INTEGRITY_MISMATCH',
      tx_id: tx.tx_id,
      block_number: tx.block_number,
      ledger_commitment: tx.commitment_hash
    };
  }

  /**
   * Fetch full receipt details for an auditor or Super Admin
   */
  async getReceiptDetails(txId) {
    return this.adapter.getTransactionReceipt(txId);
  }

  /**
   * Comprehensive ledger diagnostics for Super Admin
   */
  async getLedgerDiagnostics() {
    await this.adapter.ensureSchema();
    const blocksCountRes = await query(`SELECT COUNT(*) as count FROM blockchain_blocks`).catch(() => ({ rows: [{ count: 0 }] }));
    const txCountRes = await query(`SELECT COUNT(*) as count FROM blockchain_transactions WHERE status = 'COMMITTED'`).catch(() => ({ rows: [{ count: 0 }] }));
    const pendingCountRes = await query(`SELECT COUNT(*) as count FROM blockchain_transactions WHERE status = 'PENDING'`).catch(() => ({ rows: [{ count: 0 }] }));
    const deadLetterRes = await query(`SELECT COUNT(*) as count FROM blockchain_transactions WHERE status = 'DEAD_LETTER'`).catch(() => ({ rows: [{ count: 0 }] }));
    const recentBlocksRes = await query(`SELECT * FROM blockchain_blocks ORDER BY block_number DESC LIMIT 5`).catch(() => ({ rows: [] }));

    return {
      framework: this.adapter.getFrameworkInfo(),
      blocks_count: Number(blocksCountRes.rows?.[0]?.count || 0),
      committed_transactions_count: Number(txCountRes.rows?.[0]?.count || 0),
      pending_outbox_count: Number(pendingCountRes.rows?.[0]?.count || 0),
      dead_letter_count: Number(deadLetterRes.rows?.[0]?.count || 0),
      recent_blocks: recentBlocksRes.rows || []
    };
  }
}

const verificationService = new BlockchainVerificationService();

module.exports = {
  BlockchainVerificationService,
  verificationService
};
