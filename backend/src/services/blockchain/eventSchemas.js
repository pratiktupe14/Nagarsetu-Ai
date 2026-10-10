/**
 * NAGARSETU 3.1 — Blockchain Event Schemas & Deterministic Serialization
 * 
 * Strict Privacy Rule: Plaintext PII (names, emails, phones, GPS coordinates,
 * physical addresses, descriptions, photos) must NEVER appear in on-chain payloads.
 */

const EVENT_TYPES = {
  // Citizen account events
  CITIZEN_ACCOUNT_CREATED: 'CITIZEN_ACCOUNT_CREATED',
  CITIZEN_ACCOUNT_UPDATED: 'CITIZEN_ACCOUNT_UPDATED',
  CITIZEN_ACCOUNT_SUSPENDED: 'CITIZEN_ACCOUNT_SUSPENDED',
  CITIZEN_ACCOUNT_REACTIVATED: 'CITIZEN_ACCOUNT_REACTIVATED',

  // Complaint lifecycle events
  COMPLAINT_SUBMITTED: 'COMPLAINT_SUBMITTED',
  COMPLAINT_ASSIGNED: 'COMPLAINT_ASSIGNED',
  COMPLAINT_ACCEPTED: 'COMPLAINT_ACCEPTED',
  STATUS_UPDATED: 'STATUS_UPDATED',
  RESOLUTION_VERIFIED: 'RESOLUTION_VERIFIED',
  COMPLAINT_REOPENED: 'COMPLAINT_REOPENED',
  COMPLAINT_ARCHIVED: 'COMPLAINT_ARCHIVED',

  // Evidence management events
  EVIDENCE_CREATED: 'EVIDENCE_CREATED',
  EVIDENCE_REPLACED: 'EVIDENCE_REPLACED',
  EVIDENCE_ARCHIVED: 'EVIDENCE_ARCHIVED',

  // Location events
  LOCATION_COMMITTED: 'LOCATION_COMMITTED',
  LOCATION_CORRECTED: 'LOCATION_CORRECTED',

  // Super Admin administrative operations
  SUPER_ADMIN_CORRECTION: 'SUPER_ADMIN_CORRECTION',
  SUPER_ADMIN_DELETION_APPROVED: 'SUPER_ADMIN_DELETION_APPROVED'
};

// Forbidden raw PII field keys that must NEVER enter ledger payloads
const FORBIDDEN_PII_KEYS = new Set([
  'name',
  'citizen_name',
  'email',
  'mobile',
  'phone',
  'password',
  'password_hash',
  'jwt_token',
  'token',
  'latitude',
  'longitude',
  'gps',
  'gps_coordinates',
  'address',
  'residential_address',
  'location_address',
  'description',
  'photo_url',
  'photo_before_url',
  'photo_after_url',
  'exif',
  'exif_metadata'
]);

/**
 * Deterministic Canonical Serialization (RFC 8785 JSON Canonicalization compatible)
 * Recursively sorts keys alphabetically, strips undefined, normalizes numbers, produces exact byte-for-byte deterministic string.
 */
function canonicalSerialize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalSerialize(item)).join(',') + ']';
  }

  const sortedKeys = Object.keys(obj).sort();
  const pairs = [];

  for (const key of sortedKeys) {
    const val = obj[key];
    if (val !== undefined) {
      pairs.push(JSON.stringify(key) + ':' + canonicalSerialize(val));
    }
  }

  return '{' + pairs.join(',') + '}';
}

/**
 * Validate that an on-chain payload contains zero plaintext PII.
 * Throws an Error if any forbidden PII keys are detected.
 */
function validatePrivacySanitized(payload, path = '') {
  if (!payload || typeof payload !== 'object') return;

  for (const key of Object.keys(payload)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_PII_KEYS.has(key.toLowerCase())) {
      throw new Error(`[BLOCKCHAIN PRIVACY VIOLATION] Plaintext PII key "${currentPath}" is forbidden from on-chain payload.`);
    }

    const value = payload[key];
    if (typeof value === 'object' && value !== null) {
      validatePrivacySanitized(value, currentPath);
    }
  }
}

module.exports = {
  EVENT_TYPES,
  FORBIDDEN_PII_KEYS,
  canonicalSerialize,
  validatePrivacySanitized
};
