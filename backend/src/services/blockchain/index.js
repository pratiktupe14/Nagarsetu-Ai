/**
 * NAGARSETU 3.1 — Blockchain Module Exports
 */

const { EVENT_TYPES, canonicalSerialize, validatePrivacySanitized } = require('./eventSchemas');
const {
  HMAC_SECRET,
  computeSha256,
  computeHmacSha256,
  generatePseudonym,
  generateLocationCommitment,
  generateEvidenceCommitment,
  generateComplaintCommitment
} = require('./privacyCommitmentService');
const { PermissionedLedgerAdapter, ledgerAdapter } = require('./ledgerAdapter');
const { BlockchainIntegrityService, integrityService } = require('./integrityService');
const { BlockchainVerificationService, verificationService } = require('./verificationService');
const { KeyManagementService, keyManagementService } = require('./keyManagementService');
const { FabricGatewayConnector, fabricConnector } = require('./fabricGatewayConnector');

module.exports = {
  EVENT_TYPES,
  canonicalSerialize,
  validatePrivacySanitized,
  HMAC_SECRET,
  computeSha256,
  computeHmacSha256,
  generatePseudonym,
  generateLocationCommitment,
  generateEvidenceCommitment,
  generateComplaintCommitment,
  PermissionedLedgerAdapter,
  ledgerAdapter,
  BlockchainIntegrityService,
  integrityService,
  BlockchainVerificationService,
  verificationService,
  KeyManagementService,
  keyManagementService,
  FabricGatewayConnector,
  fabricConnector
};
