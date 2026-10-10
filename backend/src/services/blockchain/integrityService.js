/**
 * NAGARSETU 3.1 — Blockchain Integrity Service
 * 
 * Orchestrates cryptographic commitment generation and non-blocking asynchronous
 * anchoring to the permissioned blockchain ledger.
 */

const { query } = require('../../config/db');
const { EVENT_TYPES } = require('./eventSchemas');
const {
  generateComplaintCommitment,
  generateEvidenceCommitment,
  generateLocationCommitment,
  generatePseudonym,
  computeHmacSha256
} = require('./privacyCommitmentService');
const { ledgerAdapter } = require('./ledgerAdapter');

class BlockchainIntegrityService {
  constructor(adapter = ledgerAdapter) {
    this.adapter = adapter;
  }

  /**
   * Record initial complaint submission integrity event
   */
  async recordComplaintSubmission(complaint) {
    if (!complaint || (!complaint.id && !complaint.complaint_number)) {
      return null;
    }

    try {
      const complaintId = String(complaint.id || complaint.complaint_number);
      const { commitmentHash, citizenPseudonym, locationCommitment, evidenceCommitment } =
        generateComplaintCommitment(complaint, 1, null);

      const metadata = {
        action: 'SUBMISSION',
        version: 1,
        category: String(complaint.category || '').toLowerCase(),
        department_id: String(complaint.department_id || ''),
        citizen_pseudonym: citizenPseudonym,
        location_commitment: locationCommitment,
        evidence_commitment: evidenceCommitment
      };

      const receipt = await this.adapter.submitTransaction({
        entityType: 'complaint',
        entityId: complaintId,
        eventType: EVENT_TYPES.COMPLAINT_SUBMITTED,
        version: 1,
        commitmentHash,
        previousCommitmentHash: null,
        metadata
      });

      return {
        anchored: receipt.status === 'COMMITTED',
        txId: receipt.txId,
        commitmentHash,
        blockNumber: receipt.blockNumber || null,
        receipt
      };
    } catch (err) {
      console.warn('[BLOCKCHAIN INTEGRITY ERROR] Non-fatal submission note:', err.message);
      return { anchored: false, error: err.message };
    }
  }

  /**
   * Record complaint staff assignment event
   */
  async recordAssignment(complaint, staffId, staffName = '', assignedBy = 'HOD') {
    if (!complaint || !complaint.id) return null;
    try {
      const complaintId = String(complaint.id);
      const prevTx = await this.adapter.getLatestEntityTransaction('complaint', complaintId);
      const nextVersion = prevTx ? Number(prevTx.version) + 1 : 2;
      const prevCommitmentHash = prevTx ? prevTx.commitment_hash : null;

      const compRes = await query(`SELECT * FROM complaints WHERE id = ?`, [complaintId]);
      const baseRecord = compRes.rows?.[0] || {};
      const updatedComplaint = { ...baseRecord, ...complaint, status: 'Staff Assigned', assigned_staff_id: staffId };
      const { commitmentHash } = generateComplaintCommitment(updatedComplaint, nextVersion, prevCommitmentHash);

      const metadata = {
        action: 'STAFF_ASSIGNED',
        version: nextVersion,
        staff_pseudonym: generatePseudonym(staffId, 'staff'),
        assigned_by_pseudonym: generatePseudonym(assignedBy, 'admin')
      };

      const receipt = await this.adapter.submitTransaction({
        entityType: 'complaint',
        entityId: complaintId,
        eventType: EVENT_TYPES.COMPLAINT_ASSIGNED,
        version: nextVersion,
        commitmentHash,
        previousCommitmentHash: prevCommitmentHash,
        metadata
      });

      return {
        anchored: receipt.status === 'COMMITTED',
        txId: receipt.txId,
        version: nextVersion,
        commitmentHash,
        receipt
      };
    } catch (err) {
      console.warn('[BLOCKCHAIN INTEGRITY ERROR] Assignment note:', err.message);
      return { anchored: false, error: err.message };
    }
  }

  /**
   * Record status update or administrative state change
   */
  async recordStatusUpdate(complaint, newStatus, updatedBy = 'Staff', remark = '') {
    if (!complaint || !complaint.id) return null;

    try {
      const complaintId = String(complaint.id);
      const prevTx = await this.adapter.getLatestEntityTransaction('complaint', complaintId);
      const nextVersion = prevTx ? Number(prevTx.version) + 1 : 2;
      const prevCommitmentHash = prevTx ? prevTx.commitment_hash : null;

      const compRes = await query(`SELECT * FROM complaints WHERE id = ? OR complaint_number = ?`, [complaintId, complaintId]);
      const baseRecord = compRes.rows?.[0] || {};
      const updatedComplaint = { ...baseRecord, ...complaint, status: newStatus };
      const { commitmentHash } = generateComplaintCommitment(updatedComplaint, nextVersion, prevCommitmentHash);

      const metadata = {
        action: 'STATUS_UPDATE',
        version: nextVersion,
        new_status: newStatus,
        actor_pseudonym: generatePseudonym(updatedBy, 'staff'),
        remark_commitment: computeHmacSha256(String(remark || ''), 'remark')
      };

      const receipt = await this.adapter.submitTransaction({
        entityType: 'complaint',
        entityId: complaintId,
        eventType: EVENT_TYPES.STATUS_UPDATED,
        version: nextVersion,
        commitmentHash,
        previousCommitmentHash: prevCommitmentHash,
        metadata
      });

      return {
        anchored: receipt.status === 'COMMITTED',
        txId: receipt.txId,
        version: nextVersion,
        commitmentHash,
        receipt
      };
    } catch (err) {
      console.warn('[BLOCKCHAIN INTEGRITY ERROR] Non-fatal status update note:', err.message);
      return { anchored: false, error: err.message };
    }
  }

  /**
   * Record evidence replacement or versioning event
   */
  async recordEvidenceReplacement(complaintId, versionNumber, photoUrl, reason = '', replacedBy = 'Super Admin') {
    if (!complaintId) return null;

    try {
      const prevTx = await this.adapter.getLatestEntityTransaction('evidence', String(complaintId));
      const prevCommitmentHash = prevTx ? prevTx.commitment_hash : null;
      const evidenceCommitment = generateEvidenceCommitment(photoUrl, { version: versionNumber });

      const metadata = {
        action: 'EVIDENCE_REPLACED',
        version: versionNumber,
        actor_pseudonym: generatePseudonym(replacedBy, 'admin'),
        reason_commitment: computeHmacSha256(String(reason || ''), 'reason')
      };

      const receipt = await this.adapter.submitTransaction({
        entityType: 'evidence',
        entityId: String(complaintId),
        eventType: EVENT_TYPES.EVIDENCE_REPLACED,
        version: versionNumber,
        commitmentHash: evidenceCommitment,
        previousCommitmentHash: prevCommitmentHash,
        metadata
      });

      return {
        anchored: receipt.status === 'COMMITTED',
        txId: receipt.txId,
        commitmentHash: evidenceCommitment,
        receipt
      };
    } catch (err) {
      console.warn('[BLOCKCHAIN INTEGRITY ERROR] Evidence note:', err.message);
      return { anchored: false, error: err.message };
    }
  }

  /**
   * Record location correction event
   */
  async recordLocationCorrection(complaintId, lat, lng, reason = '', correctedBy = 'Super Admin') {
    if (!complaintId) return null;

    try {
      const prevTx = await this.adapter.getLatestEntityTransaction('location', String(complaintId));
      const nextVersion = prevTx ? Number(prevTx.version) + 1 : 1;
      const prevCommitmentHash = prevTx ? prevTx.commitment_hash : null;

      const locationCommitment = generateLocationCommitment(lat, lng);

      const metadata = {
        action: 'LOCATION_CORRECTED',
        version: nextVersion,
        actor_pseudonym: generatePseudonym(correctedBy, 'admin'),
        reason_commitment: computeHmacSha256(String(reason || ''), 'reason')
      };

      const receipt = await this.adapter.submitTransaction({
        entityType: 'location',
        entityId: String(complaintId),
        eventType: EVENT_TYPES.LOCATION_CORRECTED,
        version: nextVersion,
        commitmentHash: locationCommitment,
        previousCommitmentHash: prevCommitmentHash,
        metadata
      });

      return {
        anchored: receipt.status === 'COMMITTED',
        txId: receipt.txId,
        version: nextVersion,
        commitmentHash: locationCommitment,
        receipt
      };
    } catch (err) {
      console.warn('[BLOCKCHAIN INTEGRITY ERROR] Location note:', err.message);
      return { anchored: false, error: err.message };
    }
  }

  /**
   * Record Super Admin immutable administrative operation
   */
  async recordSuperAdminOperation(adminEmail, action, targetType, targetId, reason = '') {
    try {
      const operationCommitment = computeHmacSha256({
        action,
        target_type: targetType,
        target_id: String(targetId || ''),
        reason
      }, 'super_admin_audit');

      const metadata = {
        action,
        target_type: targetType,
        admin_pseudonym: generatePseudonym(adminEmail, 'super_admin'),
        reason_commitment: computeHmacSha256(String(reason || ''), 'reason')
      };

      const receipt = await this.adapter.submitTransaction({
        entityType: targetType || 'super_admin',
        entityId: String(targetId || 'SYSTEM'),
        eventType: EVENT_TYPES.SUPER_ADMIN_CORRECTION,
        version: 1,
        commitmentHash: operationCommitment,
        previousCommitmentHash: null,
        metadata
      });

      return {
        anchored: receipt.status === 'COMMITTED',
        txId: receipt.txId,
        receipt
      };
    } catch (err) {
      console.warn('[BLOCKCHAIN INTEGRITY ERROR] Super admin operation note:', err.message);
      return { anchored: false, error: err.message };
    }
  }
}

const integrityService = new BlockchainIntegrityService();

module.exports = {
  BlockchainIntegrityService,
  integrityService
};
