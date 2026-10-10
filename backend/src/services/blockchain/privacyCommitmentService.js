/**
 * NAGARSETU 3.1 — Privacy Commitment Service
 * 
 * Provides keyed HMAC-SHA-256 cryptographic commitments, pseudonymous identifiers,
 * and zero-exposure blinding for sensitive user data, GPS coordinates, and evidence.
 */

const crypto = require('crypto');
const { canonicalSerialize } = require('./eventSchemas');

// HMAC Secret managed via environment variable
const HMAC_SECRET = process.env.BLOCKCHAIN_HMAC_SECRET || 'nagarsetu_dev_secret_blockchain_integrity_key_2026';

/**
 * Standard SHA-256 hash helper
 */
function computeSha256(data) {
  const content = typeof data === 'string' ? data : canonicalSerialize(data);
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Keyed HMAC-SHA-256 commitment helper
 */
function computeHmacSha256(data, domain = 'general') {
  const content = typeof data === 'string' ? data : canonicalSerialize(data);
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(`[NAGARSETU:${domain}]` + content, 'utf8');
  return hmac.digest('hex');
}

/**
 * Derive pseudonymous identifier for citizens or staff without exposing raw user ID/phone/email
 */
function generatePseudonym(rawIdentifier, domain = 'citizen') {
  if (!rawIdentifier) return 'PSN-ANONYMOUS';
  const digest = computeHmacSha256(String(rawIdentifier), `pseudonym:${domain}`);
  return `PSN-${domain.toUpperCase().slice(0, 3)}-${digest.slice(0, 16)}`;
}

/**
 * Generate blinded cryptographic commitment for GPS coordinates and accuracy.
 * Raw coordinates are NEVER stored on-chain.
 */
function generateLocationCommitment(lat, lng, accuracy = null) {
  if (lat == null || lng == null) return null;
  const canonicalCoords = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)},acc:${accuracy != null ? Number(accuracy).toFixed(2) : 'none'}`;
  return computeHmacSha256(canonicalCoords, 'location');
}

/**
 * Generate cryptographic commitment for complaint evidence (photos/documents).
 * Raw image files and EXIF are NEVER stored on-chain.
 */
function generateEvidenceCommitment(photoUrlOrHash, metadata = {}) {
  if (!photoUrlOrHash) return null;
  const canonicalEvidence = {
    ref: String(photoUrlOrHash),
    meta: metadata || {}
  };
  return computeHmacSha256(canonicalEvidence, 'evidence');
}

/**
 * Generate comprehensive complaint commitment from operational complaint record.
 * Chains canonical fields deterministically.
 */
function generateComplaintCommitment(complaint, version = 1, previousCommitmentHash = null) {
  const citizenPseudonym = generatePseudonym(complaint.citizen_id, 'citizen');
  const locationCommitment = generateLocationCommitment(complaint.latitude, complaint.longitude, complaint.location_accuracy_m);
  const evidenceCommitment = generateEvidenceCommitment(
    complaint.primary_image_hash || complaint.photo_before_url || complaint.photo_front_url,
    { model: complaint.ai_model || 'civiclens' }
  );

  const canonicalFields = {
    complaint_id: String(complaint.id || complaint.complaint_number),
    category: String(complaint.category || '').toLowerCase().trim(),
    department_id: String(complaint.department_id || ''),
    priority: String(complaint.priority || 'Medium'),
    status: String(complaint.status || 'Submitted'),
    citizen_pseudonym: citizenPseudonym,
    location_commitment: locationCommitment,
    evidence_commitment: evidenceCommitment,
    version: Number(version || 1),
    previous_commitment: previousCommitmentHash || null
  };

  const commitmentHash = computeHmacSha256(canonicalFields, 'complaint_record');

  return {
    commitmentHash,
    canonicalFields,
    citizenPseudonym,
    locationCommitment,
    evidenceCommitment
  };
}

module.exports = {
  HMAC_SECRET,
  computeSha256,
  computeHmacSha256,
  generatePseudonym,
  generateLocationCommitment,
  generateEvidenceCommitment,
  generateComplaintCommitment
};
