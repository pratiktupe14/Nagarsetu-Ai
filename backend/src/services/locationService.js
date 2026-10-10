const exifr = require('exifr');
const { query } = require('../config/db');

// Calculate distance in meters between two lat/lng pairs using Haversine formula
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of Earth in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Server-side EXIF GPS extraction using exifr
async function extractExifGps(filePath) {
  try {
    const gps = await exifr.gps(filePath);
    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
      return {
        latitude: gps.latitude,
        longitude: gps.longitude,
        hasExif: true
      };
    }
  } catch (err) {
    console.log('EXIF GPS extraction note:', err.message);
  }
  return { latitude: null, longitude: null, hasExif: false };
}

/**
 * Priority Location Resolver
 * Inputs:
 * - filePath: String path to uploaded image file
 * - liveLat, liveLng: optional numbers passed from client browser Geolocation API
 * - manualLat, manualLng: optional numbers if user manually dropped pin
 */
async function resolveLocation(filePath, liveLat, liveLng, manualLat, manualLng) {
  const exif = await extractExifGps(filePath);
  
  const hasLive = typeof liveLat === 'number' && typeof liveLng === 'number' && !isNaN(liveLat) && !isNaN(liveLng);
  const hasExif = exif.hasExif;
  const hasManual = typeof manualLat === 'number' && typeof manualLng === 'number' && !isNaN(manualLat) && !isNaN(manualLng);

  // Scenario 4: Both Live GPS and EXIF GPS exist & disagree significantly (>500m)
  if (hasLive && hasExif) {
    const dist = calculateDistanceMeters(liveLat, liveLng, exif.latitude, exif.longitude);
    if (dist > 500) {
      return {
        requiresUserChoice: true,
        options: {
          liveGps: { latitude: liveLat, longitude: liveLng, label: 'Current Device Location (Live GPS)' },
          exifGps: { latitude: exif.latitude, longitude: exif.longitude, label: 'Photo Location (EXIF Metadata)' }
        },
        distanceMeters: Math.round(dist),
        message: 'The photo location metadata differs significantly from your current location (>500m). Please select which location is correct.'
      };
    }
  }

  // Priority 1: Live in-app camera capture (passed from frontend as live_gps)
  if (hasLive && !hasManual) {
    return {
      latitude: liveLat,
      longitude: liveLng,
      location_source: 'live_gps',
      requiresUserChoice: false,
      requiresManualPin: false
    };
  }

  // Priority 2: Gallery photo with EXIF GPS intact
  if (hasExif && !hasManual) {
    return {
      latitude: exif.latitude,
      longitude: exif.longitude,
      location_source: 'exif_gps',
      requiresUserChoice: false,
      requiresManualPin: false
    };
  }

  // Priority 3: Manual Pin Drop (provided by user after prompt)
  if (hasManual) {
    return {
      latitude: manualLat,
      longitude: manualLng,
      location_source: 'manual_pin',
      requiresUserChoice: false,
      requiresManualPin: false
    };
  }

  // Fallback / Priority 3 trigger: EXIF stripped & no live GPS -> Prompt user for pin drop
  return {
    requiresManualPin: true,
    requiresUserChoice: false,
    message: "We couldn't detect the location for this photo. Please tap on the map to mark exactly where the issue is.",
    latitude: null,
    longitude: null
  };
}

function isValidCoordinate(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function normalizeCategory(cat) {
  if (!cat || typeof cat !== 'string') return '';
  const raw = cat.trim().toLowerCase();
  if (raw.includes('street light') || raw.includes('streetlight') || raw.includes('electric') || raw.includes('light')) return 'streetlight';
  if (raw.includes('water') || raw.includes('leak') || raw.includes('pipeline')) return 'water';
  if (raw.includes('garbage') || raw.includes('waste') || raw.includes('trash') || raw.includes('sanitat')) return 'garbage';
  if (raw.includes('pothole') || raw.includes('road') || raw.includes('pwd')) return 'pothole';
  if (raw.includes('drain') || raw.includes('sewag') || raw.includes('sewer') || raw.includes('gutter')) return 'drainage';
  return raw.replace(/[^a-z0-9]/g, '');
}

// Find potential duplicate open complaints within radius (e.g. 100 meters)
async function checkForDuplicates(latitude, longitude, category, radiusMeters = 100) {
  try {
    if (latitude == null || longitude == null || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      return [];
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const normCat = normalizeCategory(category);

    // Bounding box prefilter: 1 deg lat ~= 111,000m
    const latDelta = (radiusMeters * 1.5) / 111000;
    const lngDelta = (radiusMeters * 1.5) / (111000 * Math.cos((lat * Math.PI) / 180) || 1);

    const minLat = lat - latDelta;
    const maxLat = lat + latDelta;
    const minLng = lng - Math.abs(lngDelta);
    const maxLng = lng + Math.abs(lngDelta);

    // Fetch active/unresolved complaints within bounding box
    const sql = `
      SELECT id, title, category, priority, status, latitude, longitude, created_at
      FROM complaints
      WHERE status NOT IN ('Resolved', 'Rejected', 'Closed')
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `;
    const res = await query(sql, [minLat, maxLat, minLng, maxLng]);
    const duplicates = [];

    for (const row of (res.rows || [])) {
      // Must match normalized category: a pothole must not match a streetlight complaint
      if (normCat && normalizeCategory(row.category) !== normCat) {
        continue;
      }

      const dist = calculateDistanceMeters(lat, lng, row.latitude, row.longitude);
      if (dist <= radiusMeters) {
        duplicates.push({
          complaint_id: row.id,
          title: row.title,
          category: row.category,
          status: row.status,
          distanceMeters: Math.round(dist)
        });
      }
    }

    return duplicates;
  } catch (err) {
    console.error('Error checking duplicates:', err);
    return [];
  }
}

/**
 * 3-Tier Geolocation Resolution with 100-Meter Validation
 * Priority 1: EXIF GPS from photo metadata
 * Priority 2: HTML5 Device GPS (must have accuracy <= 100m)
 * Priority 3: Interactive Leaflet/Google Map Pin Drop
 *
 * Consistency Check:
 * If EXIF vs Device GPS difference > 100m -> conflict / map confirmation required
 */
function resolveGeolocationTier({
  exifGps = null,
  deviceGps = null,
  mapPin = null,
  mapPinConfirmed = false
} = {}) {
  const isCoordValid = (c) =>
    c &&
    typeof c.latitude === 'number' &&
    typeof c.longitude === 'number' &&
    !isNaN(c.latitude) &&
    !isNaN(c.longitude) &&
    c.latitude >= -90 &&
    c.latitude <= 90 &&
    c.longitude >= -180 &&
    c.longitude <= 180;

  // Reject explicitly invalid coordinates if supplied
  if (exifGps && (typeof exifGps.latitude !== 'number' || typeof exifGps.longitude !== 'number' || !isCoordValid(exifGps))) {
    return { accepted: false, error: 'INVALID_COORDINATES', message: 'Invalid EXIF GPS coordinates' };
  }
  if (deviceGps && (typeof deviceGps.latitude !== 'number' || typeof deviceGps.longitude !== 'number' || !isCoordValid(deviceGps))) {
    return { accepted: false, error: 'INVALID_COORDINATES', message: 'Invalid Device GPS coordinates' };
  }
  if (mapPin && (typeof mapPin.latitude !== 'number' || typeof mapPin.longitude !== 'number' || !isCoordValid(mapPin))) {
    return { accepted: false, error: 'INVALID_COORDINATES', message: 'Invalid Map Pin coordinates' };
  }

  const validExif = isCoordValid(exifGps) ? exifGps : null;
  const validDevice = isCoordValid(deviceGps) ? deviceGps : null;
  const validMapPin = isCoordValid(mapPin) ? mapPin : null;

  // If user explicitly confirmed map pin (either manually or to resolve conflict)
  if (mapPinConfirmed && validMapPin) {
    return {
      accepted: true,
      latitude: validMapPin.latitude,
      longitude: validMapPin.longitude,
      location_source: validExif || validDevice ? 'map_pin_confirmed' : 'map_pin',
      requiresConfirmation: false,
      message: 'Location confirmed by map pin'
    };
  }

  // 100-Meter Consistency Check: EXIF vs Device GPS
  if (validExif && validDevice) {
    const dist = calculateDistanceMeters(validExif.latitude, validExif.longitude, validDevice.latitude, validDevice.longitude);
    if (dist > 100) {
      return {
        accepted: false,
        latitude: validExif.latitude,
        longitude: validExif.longitude,
        location_source: 'exif',
        requiresConfirmation: true,
        conflict: 'exif_vs_device',
        distanceMeters: Math.round(dist),
        message: `Photo GPS differs from Device GPS by ${Math.round(dist)}m (>100m). Please confirm location on map.`
      };
    }
  }

  // Priority 1: Hardware EXIF GPS
  if (validExif) {
    return {
      accepted: true,
      latitude: validExif.latitude,
      longitude: validExif.longitude,
      location_source: 'exif',
      accuracy: validExif.accuracy || null,
      requiresConfirmation: false,
      message: 'Location detected from photo GPS'
    };
  }

  // Priority 2: HTML5 Live GPS
  if (validDevice) {
    const acc = typeof validDevice.accuracy === 'number' && !isNaN(validDevice.accuracy) ? validDevice.accuracy : 15;
    if (acc <= 100) {
      return {
        accepted: true,
        latitude: validDevice.latitude,
        longitude: validDevice.longitude,
        location_source: 'device_gps',
        location_accuracy_m: acc,
        requiresConfirmation: false,
        message: `Live GPS verified (±${Math.round(acc)}m)`
      };
    } else {
      return {
        accepted: false,
        latitude: validDevice.latitude,
        longitude: validDevice.longitude,
        location_source: 'device_gps',
        location_accuracy_m: acc,
        requiresConfirmation: true,
        lowAccuracy: true,
        message: 'GPS accuracy low — please confirm on map'
      };
    }
  }

  // Priority 3: Interactive Map Pin
  if (validMapPin) {
    return {
      accepted: true,
      latitude: validMapPin.latitude,
      longitude: validMapPin.longitude,
      location_source: 'map_pin',
      requiresConfirmation: false,
      message: 'Location confirmed by map pin'
    };
  }

  return {
    accepted: false,
    latitude: null,
    longitude: null,
    location_source: null,
    requiresConfirmation: true,
    message: 'No valid location provided'
  };
}

/**
 * Angle-Invariant Same-Issue Image Duplicate Prevention
 * Rule: The SAME citizen must NEVER be allowed to report the SAME physical issue again within 100 meters,
 * regardless of angle, crop, rotation, resize, filename, lighting, compression, or status (even resolved/closed/SLA expired).
 */
async function checkCitizenAngleInvariantDuplicate({
  citizenId,
  latitude,
  longitude,
  primaryPhoto,
  category = null,
  simulatedVisualMatch = null,
  existingComplaintsList = null
}) {
  if (!citizenId || latitude == null || longitude == null || !primaryPhoto) {
    return { isDuplicate: false };
  }

  const { computeImageHash, compareImagesForSamePhysicalIssue, SAME_ISSUE_CONFIDENCE_THRESHOLD } = require('./aiService');
  const latNum = Number(latitude);
  const lngNum = Number(longitude);

  let candidates = [];
  if (Array.isArray(existingComplaintsList)) {
    candidates = existingComplaintsList.filter(c =>
      (String(c.citizen_id) === String(citizenId)) &&
      c.latitude != null && c.longitude != null
    );
  } else {
    // 100m bounding box: ~0.001 deg
    const latDelta = 0.0015;
    const lngDelta = 0.0015 / (Math.cos((latNum * Math.PI) / 180) || 1);

    const sql = `
      SELECT id, complaint_number, citizen_id, category, title, description, priority, status, latitude, longitude,
             photo_before_url, photo_front_url, primary_image_hash, created_at, sla_deadline
      FROM complaints
      WHERE (citizen_id = ? OR CAST(citizen_id AS TEXT) = ?)
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `;
    const res = await query(sql, [
      citizenId, String(citizenId),
      latNum - latDelta, latNum + latDelta,
      lngNum - Math.abs(lngDelta), lngNum + Math.abs(lngDelta)
    ]);
    candidates = res.rows || [];
  }

  // Filter within 100m permanent distance rule
  const nearby = [];
  for (const cand of candidates) {
    const dist = calculateDistanceMeters(latNum, lngNum, Number(cand.latitude), Number(cand.longitude));
    if (dist <= 100) {
      nearby.push({ cand, dist });
    }
  }

  // Sort nearest first, limit to max 10 candidates
  nearby.sort((a, b) => a.dist - b.dist);
  const limited = nearby.slice(0, 10);

  const newHash = computeImageHash(primaryPhoto);

  for (const { cand, dist } of limited) {
    // A different category (e.g. Garbage vs Pothole) cannot be the same physical issue
    if (category && cand.category && normalizeCategory(category) !== normalizeCategory(cand.category)) {
      continue;
    }

    const candPhoto = cand.photo_front_url || cand.photo_before_url || cand.photo_url;

    // Layer 1: Exact Hash Match (ignore fallback default placeholder)
    const isDefaultPhoto = (primaryPhoto && primaryPhoto.includes('civic-default.jpg')) || (candPhoto && candPhoto.includes('civic-default.jpg'));
    const candHash = cand.primary_image_hash || (candPhoto ? computeImageHash(candPhoto) : '');
    if (!isDefaultPhoto && newHash && candHash && newHash === candHash) {
      return {
        isDuplicate: true,
        match_type: 'exact',
        confidence: 100,
        existing_complaint_id: cand.complaint_number || cand.id,
        distance_m: Math.round(dist),
        message: 'You have already reported this issue within 100 metres.'
      };
    }

    // Layer 2: Visual / Angle-Invariant Match
    if (candPhoto) {
      const visualRes = await compareImagesForSamePhysicalIssue(primaryPhoto, candPhoto, {
        category,
        candCategory: cand.category,
        distanceMeters: dist,
        simulatedVisualMatch
      });

      if (visualRes.same_physical_issue && visualRes.confidence >= SAME_ISSUE_CONFIDENCE_THRESHOLD) {
        return {
          isDuplicate: true,
          match_type: 'visual',
          confidence: visualRes.confidence,
          existing_complaint_id: cand.complaint_number || cand.id,
          distance_m: Math.round(dist),
          reason: visualRes.reason,
          message: 'You have already reported this issue within 100 metres.'
        };
      }
    }
  }

  return { isDuplicate: false };
}

module.exports = {
  calculateDistanceMeters,
  extractExifGps,
  resolveLocation,
  resolveGeolocationTier,
  checkCitizenAngleInvariantDuplicate,
  checkForDuplicates,
  isValidCoordinate,
  normalizeCategory
};

