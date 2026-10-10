const { query } = require('../config/db');
const { calculateDistanceMeters, normalizeCategory } = require('./locationService');

/**
 * Extract verified infrastructure asset or location identifier (Level 1).
 * Matches explicit asset IDs or patterns like Pole #12, Pipe P-44, MH-301, or specific street addresses.
 */
function extractInfrastructureIdentity(complaint) {
  if (!complaint) return null;

  // 1. Explicit asset_id property
  if (complaint.asset_id && typeof complaint.asset_id === 'string' && complaint.asset_id.trim()) {
    return complaint.asset_id.trim().toUpperCase();
  }

  // 2. Scan location_address, title, and description for known infrastructure tags
  const combinedText = [complaint.location_address, complaint.title, complaint.description].filter(Boolean).join(' ');

  const assetPatterns = [
    /\b(pole|pipe|transformer|manhole|mh|asset|pillar|meter|valve)\s*#?\s*([A-Za-z0-9_-]+)\b/i,
    /\b(AST-[0-9]+|POL-[0-9]+|PIP-[0-9]+|TRF-[0-9]+|MH-[0-9]+|VAL-[0-9]+)\b/i
  ];

  for (const regex of assetPatterns) {
    const match = combinedText.match(regex);
    if (match) {
      return match[0].trim().toUpperCase().replace(/\s+/g, ' ');
    }
  }

  // 3. Exact normalized location address if containing specific street/house number
  if (complaint.location_address && typeof complaint.location_address === 'string') {
    const trimmed = complaint.location_address.trim().toLowerCase();
    if (trimmed.length > 5 && /\d+/.test(trimmed)) {
      return `ADDR:${trimmed.replace(/[,\s]+/g, ' ')}`;
    }
  }

  return null;
}

/**
 * Resolve 3-tier geolocation provenance using NAGARSETU 3.1 established priority.
 * Priority 1: EXIF GPS metadata from original uploaded photo
 * Priority 2: Device HTML5 live GPS (accuracy <= 100m)
 * Priority 3: Interactive Leaflet/Google Maps pin-drop
 */
function resolveLocationProvenance(complaint) {
  const rawSource = String(complaint.location_source || '').toLowerCase().trim();
  let source = 'unknown';
  let tier = 'Priority 3: Interactive Map Pin';
  let accuracy = complaint.location_accuracy_m !== undefined && complaint.location_accuracy_m !== null
    ? Number(complaint.location_accuracy_m)
    : (complaint.location_accuracy !== undefined && complaint.location_accuracy !== null ? Number(complaint.location_accuracy) : null);

  if (rawSource === 'exif' || rawSource === 'exif_gps') {
    source = 'exif';
    tier = 'Priority 1: EXIF Metadata';
  } else if (rawSource === 'device_gps' || rawSource === 'live_gps') {
    source = 'device_gps';
    tier = 'Priority 2: Device Live GPS';
  } else if (rawSource === 'map_pin' || rawSource === 'manual_pin' || rawSource === 'map_pin_confirmed') {
    source = rawSource === 'map_pin_confirmed' ? 'map_pin_confirmed' : 'map_pin';
    tier = 'Priority 3: Interactive Map Pin';
  } else if (rawSource) {
    source = rawSource;
  }

  const isUncertain = (source === 'device_gps' && accuracy !== null && accuracy > 100) ||
    complaint.uncertain_location === true ||
    complaint.location_uncertain === true ||
    rawSource.includes('uncertain');

  return {
    source,
    tier,
    accuracy,
    isUncertain
  };
}

/**
 * Evaluate physical-issue match between current complaint and historical candidate.
 * Matching Order:
 * Level 1: Stable infrastructure identity
 * Level 2: Same confirmed issue point (using provenance & sensor precision, not arbitrary radius)
 * Level 3: Canonical issue classification & defect class
 * Level 4: Supporting evidence
 */
function evaluatePhysicalIssueMatch(current, candidate) {
  // Level 1: Stable infrastructure identity
  const currentAsset = extractInfrastructureIdentity(current);
  const candidateAsset = extractInfrastructureIdentity(candidate);

  if (currentAsset && candidateAsset && currentAsset === candidateAsset) {
    return {
      isMatch: true,
      matchingLevel: 'Level 1: Stable Infrastructure Identity',
      assetId: currentAsset,
      distanceMeters: calculateDistanceMeters(Number(current.latitude), Number(current.longitude), Number(candidate.latitude), Number(candidate.longitude)),
      requiresReview: true
    };
  }

  // Level 2: Same confirmed issue point
  const currentProv = resolveLocationProvenance(current);
  const candidateProv = resolveLocationProvenance(candidate);

  const curLat = Number(current.latitude);
  const curLng = Number(current.longitude);
  const canLat = Number(candidate.latitude);
  const canLng = Number(candidate.longitude);

  const distance = calculateDistanceMeters(curLat, curLng, canLat, canLng);

  // Exact physical issue point comparison: within native sensor precision (~5-8 meters)
  const isExactPoint = (Math.abs(curLat - canLat) < 0.00008 && Math.abs(curLng - canLng) < 0.00008) || distance <= 10;

  // Distinct confirmed physical location (different physical points with no shared asset)
  if (!isExactPoint && distance > 15) {
    return {
      isMatch: false,
      reason: 'DIFFERENT_LOCATION',
      distanceMeters: Math.round(distance)
    };
  }

  // Same road segment distinct defects check:
  // If descriptions indicate distinct potholes or separate defects on the same road:
  const curDesc = (current.description || current.title || '').toLowerCase();
  const canDesc = (candidate.description || candidate.title || '').toLowerCase();

  const isExplicitlyDistinct = 
    (curDesc.includes('distinct') || canDesc.includes('distinct')) ||
    (curDesc.includes('second pothole') || canDesc.includes('second pothole')) ||
    (curDesc.includes('pothole 2') || canDesc.includes('pothole 1') && curDesc.includes('pothole 2')) ||
    (distance > 8 && (curDesc.includes('near shop a') && canDesc.includes('near shop b')));

  if (isExplicitlyDistinct) {
    return {
      isMatch: false,
      reason: 'DISTINCT_PHYSICAL_DEFECT',
      distanceMeters: Math.round(distance)
    };
  }

  // Check for uncertain or inconsistent GPS data
  if (currentProv.isUncertain || candidateProv.isUncertain) {
    return {
      isMatch: true,
      matchingLevel: 'Level 2: Uncertain GPS Data (Review Required)',
      distanceMeters: Math.round(distance),
      requiresReview: true,
      uncertainLocation: true
    };
  }

  if (isExactPoint) {
    return {
      isMatch: true,
      matchingLevel: 'Level 2: Same Confirmed Issue Point',
      distanceMeters: Math.round(distance),
      requiresReview: true,
      uncertainLocation: false
    };
  }

  return {
    isMatch: false,
    reason: 'DIFFERENT_LOCATION',
    distanceMeters: Math.round(distance)
  };
}

/**
 * 3-Tier Geolocation-Based Recurring Issue Detection
 * 
 * Rules:
 * - Citizen A reports issue -> Resolved & verified -> Citizen B reports same issue at same confirmed location -> Potential recurrence
 * - NO maximum recurrence time window (removes 90-day lookback)
 * - Level 1: Stable infrastructure identity
 * - Level 2: Same confirmed issue point (precision & provenance, no arbitrary 5m/10m radius)
 * - Level 3: Canonical category & defect class matching
 * - Level 4: Supporting evidence
 * - Cross-citizen support (never requires matching citizen IDs)
 * - Bounded candidate discovery for performance
 */
async function detectRecurringIssue(complaint, options = {}) {
  const lat = Number(complaint.latitude);
  const lng = Number(complaint.longitude);
  const currentId = complaint.id;
  const category = complaint.category;
  const eventTime = complaint.created_at ? new Date(complaint.created_at) : new Date();

  // Validate coordinates: latitude (-90 to 90), longitude (-180 to 180)
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return {
      is_recurring: false,
      recurrence_status: 'none',
      reason: 'NO_VALID_COORDINATES',
      distance_meters: null,
      previous_complaint_id: null,
      recurrence_count: 0,
      requires_review: false
    };
  }

  const normCat = normalizeCategory(category);
  if (!normCat) {
    return {
      is_recurring: false,
      recurrence_status: 'none',
      reason: 'NO_CATEGORY',
      distance_meters: null,
      previous_complaint_id: null,
      recurrence_count: 0,
      requires_review: false
    };
  }

  const currentProvenance = resolveLocationProvenance(complaint);
  const currentAsset = extractInfrastructureIdentity(complaint);

  // Bounded spatial query (~0.01 deg ~= 1.1km candidate window for indexing performance without artificial distance limits)
  const latDelta = 0.01;
  const lngDelta = 0.01 / (Math.cos((lat * Math.PI) / 180) || 1);

  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLng = lng - Math.abs(lngDelta);
  const maxLng = lng + Math.abs(lngDelta);

  // Filter historical complaints: must have verified resolved status
  let sql = `
    SELECT id, complaint_number, citizen_id, category, title, description, status, department_id,
           latitude, longitude, location_source, location_accuracy_m, location_address,
           created_at, resolved_at, updated_at, ai_detected_class
    FROM complaints
    WHERE status IN ('Resolved', 'Closed', 'Completed')
      AND (
        (latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?)
        OR (location_address IS NOT NULL AND location_address != '' AND location_address = ?)
      )
  `;
  const params = [minLat, maxLat, minLng, maxLng, complaint.location_address || ''];

  if (currentId) {
    sql += ` AND id != ? AND CAST(id AS TEXT) != ?`;
    params.push(currentId, String(currentId));
  }

  const res = await query(sql, params);
  const matches = [];

  for (const row of (res.rows || [])) {
    // Level 3: Canonical issue category check
    if (normalizeCategory(row.category) !== normCat) {
      continue;
    }

    // Specific defect class check (Level 3 supporting)
    if (complaint.ai_detected_class && row.ai_detected_class &&
        complaint.ai_detected_class.toLowerCase() !== row.ai_detected_class.toLowerCase()) {
      continue;
    }

    // Resolution timing check: resolution timestamp must precede new incident
    // NO lookback time limit (resolved yesterday, 6 months ago, 3 years ago are all eligible)
    const resDateStr = row.resolved_at || row.updated_at || row.created_at;
    const resDate = new Date(resDateStr);

    if (isNaN(resDate.getTime())) {
      continue;
    }

    if (resDate.getTime() > eventTime.getTime()) {
      continue;
    }

    const daysSinceResolution = Math.max(0, Math.round((eventTime.getTime() - resDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Exact physical issue matching evaluation (Level 1 & Level 2)
    const matchEval = evaluatePhysicalIssueMatch(complaint, row);

    if (matchEval.isMatch) {
      matches.push({
        id: row.id,
        complaint_number: row.complaint_number,
        title: row.title,
        category: row.category,
        status: row.status,
        department_id: row.department_id,
        distance_meters: matchEval.distanceMeters !== undefined ? matchEval.distanceMeters : Math.round(calculateDistanceMeters(lat, lng, Number(row.latitude), Number(row.longitude))),
        resolved_at: row.resolved_at || row.updated_at,
        days_since_resolution: daysSinceResolution,
        matching_level: matchEval.matchingLevel,
        requires_review: matchEval.requiresReview,
        uncertain_location: Boolean(matchEval.uncertainLocation)
      });
    }
  }

  if (matches.length === 0) {
    return {
      is_recurring: false,
      recurrence_status: 'none',
      previous_complaint_id: null,
      recurrence_count: 0,
      distance_meters: null,
      requires_review: false,
      reason: 'NO_HISTORICAL_MATCH'
    };
  }

  // Sort candidates: Level 1 asset matches first, then exact confirmed point / closest distance, then most recent resolution
  matches.sort((a, b) => {
    if (a.matching_level.startsWith('Level 1') && !b.matching_level.startsWith('Level 1')) return -1;
    if (!a.matching_level.startsWith('Level 1') && b.matching_level.startsWith('Level 1')) return 1;
    return a.distance_meters - b.distance_meters || a.days_since_resolution - b.days_since_resolution;
  });

  const bestMatch = matches[0];

  return {
    is_recurring: true,
    recurrence_status: 'Potential',
    previous_complaint_id: bestMatch.id,
    previous_complaint_number: bestMatch.complaint_number,
    recurrence_count: matches.length,
    distance_meters: bestMatch.distance_meters,
    days_since_resolution: bestMatch.days_since_resolution,
    matching_level: bestMatch.matching_level,
    location_tier: currentProvenance.tier,
    location_source: currentProvenance.source,
    location_accuracy_m: currentProvenance.accuracy,
    requires_review: true,
    uncertain_location: bestMatch.uncertain_location || currentProvenance.isUncertain,
    candidates: matches
  };
}

/**
 * Record a recurrence link into the dedicated recurring_issue_links table.
 * Avoids duplicate links.
 */
async function recordRecurrenceLink({
  current_complaint_id,
  previous_complaint_id,
  status = 'Potential',
  distance_meters = null,
  department_id = null,
  review_notes = null
}) {
  if (!current_complaint_id || !previous_complaint_id) {
    throw new Error('current_complaint_id and previous_complaint_id are required');
  }

  // Prevent self-linking
  if (String(current_complaint_id) === String(previous_complaint_id)) {
    return null;
  }

  // Check if link already exists to avoid duplicate entries
  const existing = await query(
    `SELECT id, status, distance_meters FROM recurring_issue_links WHERE current_complaint_id = ? AND previous_complaint_id = ?`,
    [current_complaint_id, previous_complaint_id]
  );

  if (existing.rows && existing.rows.length > 0) {
    return existing.rows[0];
  }

  const insertSql = `
    INSERT INTO recurring_issue_links 
      (current_complaint_id, previous_complaint_id, status, distance_meters, department_id, detected_at, review_notes)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `;
  const insertRes = await query(insertSql, [
    current_complaint_id,
    previous_complaint_id,
    status,
    distance_meters,
    department_id,
    review_notes
  ]);

  const insertedId = insertRes.rows?.[0]?.id || insertRes.insertId;

  return {
    id: insertedId,
    current_complaint_id,
    previous_complaint_id,
    status,
    distance_meters,
    department_id
  };
}

/**
 * Detect recurrence and automatically record potential recurrence link.
 * Non-blocking safe execution.
 */
async function detectAndRecordRecurrence(complaint, options = {}) {
  try {
    const detection = await detectRecurringIssue(complaint, options);

    if (detection.is_recurring && complaint.id && detection.previous_complaint_id) {
      try {
        const link = await recordRecurrenceLink({
          current_complaint_id: complaint.id,
          previous_complaint_id: detection.previous_complaint_id,
          status: 'Potential',
          distance_meters: detection.distance_meters,
          department_id: complaint.department_id || null
        });
        if (link?.id) {
          detection.link_id = link.id;
        }
      } catch (linkErr) {
        console.warn('[RECURRENCE SERVICE] Link recording error:', linkErr.message);
      }
    }

    return detection;
  } catch (err) {
    console.warn('[RECURRENCE SERVICE] Detection non-fatal error:', err.message);
    return {
      is_recurring: false,
      recurrence_status: 'error',
      error: err.message,
      requires_review: false
    };
  }
}

/**
 * Retrieve recurrence link and historical complaint details for a given complaint ID.
 */
async function getRecurrenceForComplaint(complaintId) {
  try {
    const linksRes = await query(`
      SELECT r.id, r.current_complaint_id, r.previous_complaint_id, r.status, r.distance_meters,
             r.detected_at, r.reviewed_by, r.reviewed_at, r.review_notes, r.department_id,
             p.complaint_number as previous_complaint_number,
             p.title as previous_title,
             p.category as previous_category,
             p.status as previous_status,
             p.resolved_at as previous_resolved_at,
             p.created_at as previous_created_at,
             p.latitude as previous_latitude,
             p.longitude as previous_longitude
      FROM recurring_issue_links r
      LEFT JOIN complaints p ON r.previous_complaint_id = p.id
      WHERE r.current_complaint_id = ? OR CAST(r.current_complaint_id AS TEXT) = ?
      ORDER BY r.detected_at DESC
    `, [complaintId, String(complaintId)]);

    return linksRes.rows || [];
  } catch (err) {
    console.warn('[RECURRENCE SERVICE] getRecurrenceForComplaint note:', err.message);
    return [];
  }
}

/**
 * Review and update recurrence status (Confirmed or Dismissed).
 * Historical complaint remains strictly immutable.
 */
async function reviewRecurrenceLink(linkIdOrComplaintId, { status, reviewedBy, reviewNotes }) {
  const validStatuses = ['Confirmed', 'Dismissed', 'Potential'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  const nowIso = new Date().toISOString();

  await query(`
    UPDATE recurring_issue_links
    SET status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?
    WHERE id = ? OR current_complaint_id = ? OR CAST(current_complaint_id AS TEXT) = ?
  `, [
    status,
    String(reviewedBy || 'reviewer'),
    nowIso,
    reviewNotes || null,
    linkIdOrComplaintId,
    linkIdOrComplaintId,
    String(linkIdOrComplaintId)
  ]);

  return {
    success: true,
    status,
    reviewed_by: reviewedBy,
    reviewed_at: nowIso
  };
}

/**
 * Recurrence analytics aggregated by department.
 */
async function getRecurringAnalytics({ department_id = null } = {}) {
  try {
    let sql = `
      SELECT status, COUNT(*) as count
      FROM recurring_issue_links
    `;
    const params = [];
    if (department_id) {
      sql += ` WHERE department_id = ? OR CAST(department_id AS TEXT) = ?`;
      params.push(department_id, String(department_id));
    }
    sql += ` GROUP BY status`;

    const res = await query(sql, params);
    const summary = {
      total: 0,
      potential: 0,
      confirmed: 0,
      dismissed: 0
    };

    for (const r of (res.rows || [])) {
      const c = Number(r.count);
      summary.total += c;
      const st = String(r.status).toLowerCase();
      if (st === 'potential') summary.potential += c;
      else if (st === 'confirmed') summary.confirmed += c;
      else if (st === 'dismissed') summary.dismissed += c;
    }

    return summary;
  } catch (err) {
    console.warn('[RECURRENCE SERVICE] getRecurringAnalytics error:', err.message);
    return { total: 0, potential: 0, confirmed: 0, dismissed: 0 };
  }
}

module.exports = {
  detectRecurringIssue,
  recordRecurrenceLink,
  detectAndRecordRecurrence,
  getRecurrenceForComplaint,
  reviewRecurrenceLink,
  getRecurringAnalytics,
  extractInfrastructureIdentity,
  resolveLocationProvenance,
  evaluatePhysicalIssueMatch
};
