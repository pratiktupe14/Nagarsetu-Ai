/**
 * Canonical Department Service for NAGARSETU 3.1
 * Single Source of Truth for Department Resolution, UUID Mapping, and Lifecycle Integrity.
 * 
 * Never route by display-name strings.
 * Canonical resolution flow:
 *   AI (departmentCode: "PWD", departmentRegistryId: 1)
 *     ↓
 *   resolveDepartmentByCode("PWD")
 *     ↓
 *   Canonical departments table
 *     ↓
 *   Authoritative Database UUID ("8ed9f760-1314-427c-a515-c2a54d6df6d8")
 *     ↓
 *   complaints.department_id
 */

const { query } = require('../config/db');

// Authoritative Canonical Department Registry
const CANONICAL_DEPARTMENTS = [
  {
    id: '8ed9f760-1314-427c-a515-c2a54d6df6d8',
    code: 'PWD',
    name: 'Public Works Department',
    description: 'Road repairs, potholes, asphalt infrastructure, and civic road maintenance',
    registry_id: 1,
    status: 'active'
  },
  {
    id: '9cabc1f2-fd10-48dd-a5cb-01d05197de22',
    code: 'SAN',
    name: 'Sanitation & Waste Management',
    description: 'Garbage pickup, solid waste clearing, dumpsters, and public cleanliness',
    registry_id: 2,
    status: 'active'
  },
  {
    id: 'ead370cc-459c-44f0-899f-8a97f0928beb',
    code: 'WTR',
    name: 'Water Supply & Sewerage Board',
    description: 'Pipeline leakages, potable water mains, valve control, and water supply',
    registry_id: 3,
    status: 'active'
  },
  {
    id: 'ee73cb82-cc47-4333-b7d6-4491353c1354',
    code: 'DRN',
    name: 'Drainage & Sewage Department',
    description: 'Drainage blockage, sewage overflow, open drains, culverts, and storm channels',
    registry_id: 4,
    status: 'active'
  },
  {
    id: '31842723-23ac-490b-912b-9f6d9afbdfb3',
    code: 'ELE',
    name: 'Electrical & Street Lighting',
    description: 'Streetlight repair, electrical poles, transformer inspection, and public lighting',
    registry_id: 5,
    status: 'active'
  },
  {
    id: 'ae5e4d0c-996f-4d81-9528-d642664c93ae',
    code: 'TRF',
    name: 'Traffic Management Department',
    description: 'Traffic signal repairs, road signage, lane markings, and junction safety',
    registry_id: 6,
    status: 'active'
  },
  {
    id: '71542723-23ac-490b-912b-9f6d9afbdfb7',
    code: 'MNT',
    name: 'Maintenance Department',
    description: 'General civic facility repairs, building maintenance, public park upkeep, and asset management',
    registry_id: 7,
    status: 'active'
  }
];

// Fast in-memory lookup indexes
const CODE_INDEX = new Map();
const UUID_INDEX = new Map();
const REGISTRY_ID_INDEX = new Map();

for (const d of CANONICAL_DEPARTMENTS) {
  CODE_INDEX.set(d.code.toUpperCase(), d);
  UUID_INDEX.set(d.id.toLowerCase(), d);
  REGISTRY_ID_INDEX.set(String(d.registry_id), d);
  REGISTRY_ID_INDEX.set(Number(d.registry_id), d);
}

/**
 * Resolves canonical department by department code (e.g. "PWD", "SAN").
 * Authoritatively returns the database UUID, canonical code, and canonical name.
 * 
 * @param {string} code - Department code (e.g. "PWD", "SAN", "WTR")
 * @returns {Promise<{ id: string, code: string, name: string, status: string, registry_id: number }>}
 */
async function resolveDepartmentByCode(code) {
  if (!code) {
    const defaultDept = CANONICAL_DEPARTMENTS[0]; // PWD default
    return {
      id: defaultDept.id,
      code: defaultDept.code,
      name: defaultDept.name,
      status: defaultDept.status,
      registry_id: defaultDept.registry_id
    };
  }

  const cleanCode = String(code).trim().toUpperCase();

  // 1. Direct memory cache hit
  const memHit = CODE_INDEX.get(cleanCode) || REGISTRY_ID_INDEX.get(cleanCode) || UUID_INDEX.get(String(code).toLowerCase());

  // 2. Query authoritative database departments table
  try {
    const res = await query(
      `SELECT id, code, name, status, description, registry_id 
       FROM departments 
       WHERE UPPER(code) = ? OR id = ? OR CAST(registry_id AS TEXT) = ? 
       LIMIT 1`,
      [cleanCode, String(code), cleanCode]
    );

    if (res.rows && res.rows.length > 0) {
      const row = res.rows[0];
      const matchedCanonical = CODE_INDEX.get((row.code || '').toUpperCase()) || memHit;
      return {
        id: String(row.id),
        code: String(row.code || matchedCanonical?.code || cleanCode),
        name: String(row.name || matchedCanonical?.name || 'Municipal Department'),
        status: String(row.status || 'active'),
        registry_id: Number(row.registry_id || matchedCanonical?.registry_id || 1)
      };
    }
  } catch (err) {
    console.warn('[DEPARTMENT_RESOLVER] DB lookup note:', err.message);
  }

  // 3. Fallback to canonical registry
  if (memHit) {
    return {
      id: memHit.id,
      code: memHit.code,
      name: memHit.name,
      status: memHit.status,
      registry_id: memHit.registry_id
    };
  }

  // 4. Default fallback to PWD
  const fallback = CANONICAL_DEPARTMENTS[0];
  return {
    id: fallback.id,
    code: fallback.code,
    name: fallback.name,
    status: fallback.status,
    registry_id: fallback.registry_id
  };
}

/**
 * Synchronous resolver for token verification / middleware
 */
function resolveDepartmentByCodeSync(code) {
  if (!code) return CANONICAL_DEPARTMENTS[0];
  const clean = String(code).trim().toUpperCase();
  const found = CODE_INDEX.get(clean) || REGISTRY_ID_INDEX.get(clean) || UUID_INDEX.get(String(code).toLowerCase());
  return found || CANONICAL_DEPARTMENTS[0];
}

/**
 * Gets all canonical departments
 */
function getAllCanonicalDepartments() {
  return [...CANONICAL_DEPARTMENTS];
}

module.exports = {
  CANONICAL_DEPARTMENTS,
  resolveDepartmentByCode,
  resolveDepartmentByCodeSync,
  getAllCanonicalDepartments
};
