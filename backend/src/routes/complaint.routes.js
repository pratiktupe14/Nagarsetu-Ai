const express = require('express');
const router = express.Router();
const path = require('path');
const { uploadSingleImage } = require('../middleware/upload');
const { authenticateToken, optionalAuthenticateToken } = require('../middleware/auth');
const { complaintSubmitLimiter } = require('../middleware/rateLimiter');
const validateInput = require('../middleware/validateInput');
const { createComplaintSchema, addFeedbackSchema } = require('../schemas/complaint.schemas');
const { query } = require('../config/db');
const { resolveLocation, checkForDuplicates, calculateDistanceMeters, normalizeCategory } = require('../services/locationService');
const { analyzeComplaintPhoto, validateCategoryMatch } = require('../services/aiService');
const { notifyStatusChange } = require('../services/notificationService');
const { resolveDepartmentByCode, resolveDepartmentByCodeSync } = require('../services/departmentService');

// No-cache middleware for dynamic complaint data
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

/**
 * Resolves all authorized citizen identifiers (including canonical SQLite user IDs,
 * demo UUIDs, and legacy prefixes) for a given authenticated citizen.
 * Guarantees complaints persist and remain retrievable across portals regardless of
 * session identifier format.
 */
async function resolveAuthorizedCitizenIds(user) {
  const ids = new Set();
  if (!user) return ids;
  const rawId = user.id != null ? String(user.id) : '';
  const mobile = user.mobile ? String(user.mobile) : '';
  const email = user.email ? String(user.email).toLowerCase() : '';
  const name = user.name ? String(user.name).toLowerCase() : '';

  if (rawId) {
    ids.add(rawId);
    ids.add(Number(rawId));
  }
  if (user.supabase_uid) {
    ids.add(String(user.supabase_uid));
  }

  if (mobile || email) {
    try {
      const uRes = await query('SELECT id FROM users WHERE mobile = ? OR LOWER(email) = ?', [mobile, email]);
      if (uRes.rows && uRes.rows.length > 0) {
        for (const row of uRes.rows) {
          ids.add(String(row.id));
          ids.add(Number(row.id));
        }
      }
    } catch (e) {}

    try {
      const { DEMO_USER_TOKENS } = require('../middleware/auth');
      if (DEMO_USER_TOKENS) {
        for (const dt of Object.values(DEMO_USER_TOKENS)) {
          if ((mobile && dt.mobile === mobile) || (email && dt.email && dt.email.toLowerCase() === email)) {
            if (dt.id) {
              ids.add(String(dt.id));
              if (!isNaN(Number(dt.id))) ids.add(Number(dt.id));
            }
            if (dt.legacy_id) {
              ids.add(String(dt.legacy_id));
              ids.add(Number(dt.legacy_id));
            }
          }
        }
      }
    } catch (e) {}

    // Resolve authoritative Supabase profile UUID
    try {
      const { supabase } = require('../config/supabaseStorage');
      if (supabase) {
        const filters = [];
        if (mobile) {
          const rawDigits = mobile.replace(/\D/g, '');
          const norm = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
          filters.push(`mobile.eq.${mobile}`, `mobile.eq.${norm}`);
        }
        if (email) filters.push(`email.ilike.${email}`);
        if (filters.length > 0) {
          const { data: prof } = await supabase.from('profiles').select('id').or(filters.join(',')).maybeSingle();
          if (prof && prof.id) {
            ids.add(String(prof.id));
          }
        }
      }
    } catch (e) {}
  }

  return ids;
}

async function isCitizenComplaintOwner(complaintCitizenId, user) {
  if (!complaintCitizenId || !user) return false;
  const ids = await resolveAuthorizedCitizenIds(user);
  return ids.has(String(complaintCitizenId)) || ids.has(Number(complaintCitizenId));
}

// Dedicated photo upload endpoint for complaints (persists to /uploads or Supabase storage)
router.post('/upload', authenticateToken, uploadSingleImage('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    const host = req.get('host');
    const protocol = req.protocol || 'http';
    const photoUrl = req.file.publicUrl || req.file.supabaseUrl || (req.file.filename ? `/uploads/${req.file.filename}` : '/uploads/temp-photo.jpg');
    
    // Normalize relative /uploads/ path to full URL
    const fullUrl = photoUrl.startsWith('/uploads/') ? `${protocol}://${host}${photoUrl}` : photoUrl;

    return res.json({
      success: true,
      url: fullUrl,
      publicUrl: fullUrl,
      relativeUrl: photoUrl.startsWith('/uploads/') ? photoUrl : `/uploads/${path.basename(photoUrl)}`,
      filename: req.file.filename || path.basename(photoUrl)
    });
  } catch (err) {
    console.error('Complaint image upload error:', err);
    return res.status(500).json({ error: 'Failed to upload complaint image' });
  }
});

/**
 * Normalizes complaint photo URLs so relative /uploads/ paths are returned as fully qualified URLs.
 */
function normalizeComplaintPhotoUrls(complaint, req) {
  if (!complaint || typeof complaint !== 'object') return complaint;
  const protocol = req?.protocol || 'http';
  const host = (req?.get && req.get('host')) || req?.headers?.host || 'localhost:5000';
  const baseUrl = `${protocol}://${host}`;

  const formatUrl = (url, fallbackToDefault = false) => {
    if (!url || typeof url !== 'string') {
      return fallbackToDefault ? `${baseUrl}/uploads/civic-default.jpg` : '';
    }
    const trimmed = url.trim();
    if (!trimmed || trimmed === '' || trimmed === 'undefined' || trimmed === 'null' || trimmed.startsWith('blob:')) {
      return fallbackToDefault ? `${baseUrl}/uploads/civic-default.jpg` : '';
    }
    if (trimmed.startsWith('/uploads/')) {
      return `${baseUrl}${trimmed}`;
    }
    if (trimmed.startsWith('uploads/')) {
      return `${baseUrl}/${trimmed}`;
    }
    return trimmed;
  };

  const c = { ...complaint };
  const rawPrimary = c.photo_before_url || c.photo_front_url || c.photo_url;
  c.photo_before_url = formatUrl(rawPrimary, true);
  c.photo_front_url = formatUrl(c.photo_front_url || rawPrimary, true);
  if (c.photo_after_url) c.photo_after_url = formatUrl(c.photo_after_url, false);
  if (c.photo_left_url) c.photo_left_url = formatUrl(c.photo_left_url, false);
  if (c.photo_right_url) c.photo_right_url = formatUrl(c.photo_right_url, false);
  if (c.photo_closeup_url) c.photo_closeup_url = formatUrl(c.photo_closeup_url, false);

  if (c.angle_photos) {
    try {
      const parsed = typeof c.angle_photos === 'string' ? JSON.parse(c.angle_photos) : c.angle_photos;
      if (Array.isArray(parsed)) {
        c.angle_photos = parsed.map(item => ({
          ...item,
          url: formatUrl(item?.url)
        }));
      }
    } catch (e) {}
  }

  if (c.additional_photos) {
    try {
      const parsed = typeof c.additional_photos === 'string' ? JSON.parse(c.additional_photos) : c.additional_photos;
      if (Array.isArray(parsed)) {
        c.additional_photos = parsed.map(formatUrl);
      }
    } catch (e) {}
  }

  return c;
}

// Step 1: Upload photo, extract location (EXIF / Live GPS / Pin), call AI analyzer
router.post('/analyze-upload', authenticateToken, uploadSingleImage('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided' });
    }

    const photoUrl = req.file.publicUrl || req.file.supabaseUrl || (req.file.filename ? `/uploads/${req.file.filename}` : '/uploads/temp-photo.jpg');
    const fileInput = req.file.buffer || req.file.path || req.file;

    const liveLat = req.body.liveLat ? parseFloat(req.body.liveLat) : null;
    const liveLng = req.body.liveLng ? parseFloat(req.body.liveLng) : null;
    const manualLat = req.body.manualLat ? parseFloat(req.body.manualLat) : null;
    const manualLng = req.body.manualLng ? parseFloat(req.body.manualLng) : null;

    // Resolve location according to exact priority specification
    const locationRes = await resolveLocation(fileInput, liveLat, liveLng, manualLat, manualLng);

    // If client needs to make a decision due to 500m+ conflict between EXIF and Live GPS
    if (locationRes.requiresUserChoice) {
      return res.json({
        step: 'location_conflict_resolution',
        photo_url: photoUrl,
        location_conflict: locationRes
      });
    }

    // If EXIF stripped and no live GPS provided -> trigger mandatory map pin-drop step
    if (locationRes.requiresManualPin) {
      return res.json({
        step: 'manual_pin_required',
        photo_url: photoUrl,
        message: locationRes.message
      });
    }

    // Run AI Vision Analysis
    const reqDomain = req.body?.domain || (req.body?.category ? (req.body.category.toLowerCase().includes('water') ? 'pipe' : req.body.category.toLowerCase().includes('drain') ? 'drainage' : req.body.category.toLowerCase().includes('sanit') ? 'waste' : 'road') : null);
    const aiAnalysis = await analyzeComplaintPhoto(fileInput, { domain: reqDomain });

    // Check potential duplicate complaints within 100m radius
    const duplicates = await checkForDuplicates(locationRes.latitude, locationRes.longitude, aiAnalysis.category, 100);

    const categoryValidation = req.body?.category 
      ? validateCategoryMatch(req.body.category, aiAnalysis)
      : null;

    return res.json({
      step: 'review_and_confirm',
      photo_url: photoUrl,
      location: {
        latitude: locationRes.latitude,
        longitude: locationRes.longitude,
        source: locationRes.location_source
      },
      ai: aiAnalysis,
      category_validation: categoryValidation,
      duplicates_found: duplicates
    });
  } catch (err) {
    console.error('Analyze upload error:', err);
    return res.status(500).json({ error: 'Failed to process and analyze photo.' });
  }
});

// Reusable SLA / Response Time Calculation Helpers
function getDefaultResponseTimeHours(category, department) {
  const normCat = String(category || '').trim().toLowerCase();
  const normDept = String(department || '').trim().toLowerCase();

  // 1. Water Leakage: 24 Hours (Specific rule prioritized)
  if (
    normCat.includes('water leak') ||
    normCat.includes('water') ||
    normCat.includes('pipeline') ||
    normDept.includes('water') ||
    normDept === 'wtr'
  ) {
    return 24;
  }

  // 2. Garbage / Sanitation: 24 Hours
  if (
    normCat.includes('garbage') ||
    normCat.includes('waste') ||
    normCat.includes('sanitat') ||
    normCat.includes('trash') ||
    normCat.includes('clean') ||
    normDept.includes('sanitat') ||
    normDept.includes('waste') ||
    normDept === 'san'
  ) {
    return 24;
  }

  // 3. Drainage: 48 Hours
  if (
    normCat.includes('drain') ||
    normCat.includes('sewer') ||
    normCat.includes('sewag') ||
    normCat.includes('gutter') ||
    normDept.includes('drain') ||
    normDept.includes('sewag') ||
    normDept === 'drn'
  ) {
    return 48;
  }

  // 4. Streetlight / Electricity: 48 Hours
  if (
    normCat.includes('street light') ||
    normCat.includes('streetlight') ||
    normCat.includes('street-light') ||
    normCat.includes('electric') ||
    normCat.includes('light') ||
    normDept.includes('electric') ||
    normDept.includes('street light') ||
    normDept.includes('streetlight') ||
    normDept.includes('light') ||
    normDept === 'ele'
  ) {
    return 48;
  }

  // 5. PWD / Roads: 15 Days (360 Hours)
  if (
    normCat.includes('pothole') ||
    normCat.includes('road') ||
    normCat.includes('bridge') ||
    normCat.includes('pwd') ||
    normCat.includes('public works') ||
    normDept.includes('public works') ||
    normDept.includes('road') ||
    normDept.includes('pwd') ||
    normDept === 'pwd'
  ) {
    return 15 * 24; // 360 hours
  }

  // 6. Default for all other departments/categories: 4 Days (96 Hours)
  return 4 * 24; // 96 hours
}

function calculateSlaDeadline(createdAt, category, department) {
  const hours = getDefaultResponseTimeHours(category, department);
  const baseDate = createdAt ? new Date(createdAt) : new Date();
  const deadlineDate = new Date(baseDate.getTime() + hours * 60 * 60 * 1000);
  return {
    hours,
    deadline: deadlineDate.toISOString()
  };
}

// Step 2: Final Complaint Submission (supports both /submit and /)
const submitComplaintHandler = async (req, res) => {
  try {
    const {
      complaint_number,
      photo_url,
      photo_before_url,
      photo_front_url,
      photo_left_url,
      photo_right_url,
      photo_closeup_url,
      angle_photos,
      additional_photos,
      category,
      title,
      description,
      priority = 'Medium',
      latitude,
      longitude,
      location_source,
      location_address,
      department_id,
      department_name,
      department_code,
      department,
      duplicate_of_id,
      ai_model,
      ai_confidence,
      ai_status,
      ai_detected_class,
      ai_reason
    } = req.body;

    // Strict 3-Tier Geolocation Resolution & 100-Meter Validation
    const latNum = Number(latitude);
    const lngNum = Number(longitude);
    if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: 'Invalid latitude or longitude coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.' });
    }

    let normLocationSource = String(location_source || '').toLowerCase().trim();
    if (normLocationSource === 'live_gps') normLocationSource = 'device_gps';
    if (normLocationSource === 'exif_gps') normLocationSource = 'exif';
    if (normLocationSource === 'manual_pin') normLocationSource = 'map_pin';

    const validSources = ['exif', 'device_gps', 'map_pin', 'map_pin_confirmed'];
    if (!validSources.includes(normLocationSource)) {
      return res.status(400).json({ error: `Invalid location_source "${location_source}". Allowed values: ${validSources.join(', ')}` });
    }

    const accuracyNum = req.body.location_accuracy_m !== undefined && req.body.location_accuracy_m !== null
      ? Number(req.body.location_accuracy_m)
      : (req.body.location_accuracy !== undefined && req.body.location_accuracy !== null ? Number(req.body.location_accuracy) : null);

    if (accuracyNum !== null && (isNaN(accuracyNum) || accuracyNum < 0)) {
      return res.status(400).json({ error: 'location_accuracy_m must be a non-negative number' });
    }

    if (normLocationSource === 'device_gps' && accuracyNum !== null && accuracyNum > 100) {
      return res.status(400).json({ error: 'Device GPS accuracy is lower than 100m. Please confirm defect location on the map.' });
    }

    // Strict Backend AI Category Validation (Prevents unsupported images from being saved as accepted evidence)
    if (category) {
      const aiPayload = {
        category: req.body.ai_category || category,
        detected_class: ai_detected_class,
        confidence: ai_confidence,
        detected: Boolean(ai_detected_class),
        aiStatus: ai_status,
        road_condition: req.body.road_condition,
        pipe_condition: req.body.pipe_condition,
        drain_condition: req.body.drain_condition
      };
      const catValidation = validateCategoryMatch(category, aiPayload);
      if (catValidation.outcome === 'UNSUPPORTED') {
        return res.status(400).json({
          error: catValidation.message,
          unsupported_category: true,
          suggested_category: catValidation.suggestedCategory
        });
      }
    }

    // Always generate complaint_number authoritatively on the server side
    const finalComplaintNumber = `NS-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    // Authoritatively resolve canonical department via single canonical resolver
    let resolvedDept = null;
    const rawDeptInput = department_code || (department_id && String(department_id).length <= 4 ? String(department_id) : null) || department || department_name;

    if (rawDeptInput) {
      resolvedDept = await resolveDepartmentByCode(rawDeptInput);
    } else if (department_id) {
      resolvedDept = await resolveDepartmentByCode(department_id);
    }

    // Infer from category if not resolved
    if (!resolvedDept && category) {
      let deptCode = 'PWD';
      const catLower = (category || '').toLowerCase();
      if (catLower.includes('water') || catLower.includes('pipeline') || catLower.includes('leak')) deptCode = 'WTR';
      else if (catLower.includes('garbage') || catLower.includes('waste') || catLower.includes('sanitat') || catLower.includes('clean')) deptCode = 'SAN';
      else if (catLower.includes('drain') || catLower.includes('sewag') || catLower.includes('sewer') || catLower.includes('gutter')) deptCode = 'DRN';
      else if (catLower.includes('street') || catLower.includes('electric') || catLower.includes('light')) deptCode = 'ELE';
      else if (catLower.includes('traffic') || catLower.includes('signal') || catLower.includes('sign')) deptCode = 'TRF';
      else if (catLower.includes('maintenance') || catLower.includes('park') || catLower.includes('facility')) deptCode = 'MNT';
      else if (catLower.includes('pothole') || catLower.includes('road') || catLower.includes('bridge')) deptCode = 'PWD';

      resolvedDept = await resolveDepartmentByCode(deptCode);
    }

    if (!resolvedDept) {
      resolvedDept = await resolveDepartmentByCode('PWD');
    }

    const finalDeptCode = resolvedDept.code;
    const finalDeptName = resolvedDept.name;
    const finalDeptId = resolvedDept.id; // Authoritative database UUID from canonical departments table

    const finalPhotoUrl = photo_url || photo_front_url || photo_before_url || '/uploads/civic-default.jpg';
    const finalPhotoFront = photo_front_url || finalPhotoUrl;
    const finalPhotoLeft = photo_left_url || null;
    const finalPhotoRight = photo_right_url || null;
    const finalPhotoCloseup = photo_closeup_url || null;
    const finalAnglePhotos = angle_photos ? (typeof angle_photos === 'string' ? angle_photos : JSON.stringify(angle_photos)) : null;
    const finalAdditionalPhotos = additional_photos ? (typeof additional_photos === 'string' ? additional_photos : JSON.stringify(additional_photos)) : null;

    const citizenId = req.user?.id ? String(req.user.id) : (req.body?.citizen_id ? String(req.body.citizen_id) : '1');

    // Authoritative server-side SLA deadline calculation (ignores client-supplied deadline/response time)
    const { hours: slaHours, deadline: slaDeadline } = calculateSlaDeadline(
      new Date(),
      category,
      finalDeptCode || finalDeptName
    );

    // --- ANGLE-INVARIANT SAME-ISSUE IMAGE DUPLICATE PREVENTION (100M Permanent Rule) ---
    const { checkCitizenAngleInvariantDuplicate } = require('../services/locationService');
    const angleInvariantCheck = await checkCitizenAngleInvariantDuplicate({
      citizenId,
      latitude: latNum,
      longitude: lngNum,
      primaryPhoto: (photo_url || photo_front_url || photo_before_url) ? (finalPhotoFront || finalPhotoUrl) : null,
      category,
      simulatedVisualMatch: req.body?.simulatedVisualMatch
    });

    if (angleInvariantCheck.isDuplicate) {
      return res.status(409).json({
        error: 'You have already reported this issue within 100 metres.',
        error_code: 'ISSUE_ALREADY_REPORTED_BY_CITIZEN',
        message: 'You have already reported this issue within 100 metres.',
        existing_complaint_id: String(angleInvariantCheck.existing_complaint_id),
        distance_m: angleInvariantCheck.distance_m,
        match_type: angleInvariantCheck.match_type,
        confidence: angleInvariantCheck.confidence
      });
    }

    // --- DUPLICATE DETECTION & SAME CITIZEN REPEAT-COMPLAINT RESTRICTION (500M Radius) ---
    const lat = Number(latitude);
    const lng = Number(longitude);
    const normCat = normalizeCategory(category);

    let sameCitizenActiveMatch = null;
    let otherCitizenNearbyMatch = null;

    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const latDelta = (500 * 1.5) / 111000;
      const lngDelta = (500 * 1.5) / (111000 * Math.cos((lat * Math.PI) / 180) || 1);

      try {
        const nearbySql = `
          SELECT id, complaint_number, citizen_id, category, priority, status, latitude, longitude, sla_deadline, created_at
          FROM complaints
          WHERE (status NOT IN ('Resolved', 'Rejected', 'Closed') OR status IS NULL)
            AND (is_merged IS NULL OR is_merged = false OR is_merged = 0)
            AND latitude BETWEEN ? AND ?
            AND longitude BETWEEN ? AND ?
        `;
        const nearbyRes = await query(nearbySql, [lat - latDelta, lat + latDelta, lng - Math.abs(lngDelta), lng + Math.abs(lngDelta)]);
        const openNearby = nearbyRes.rows || [];

        for (const candidate of openNearby) {
          if (normalizeCategory(candidate.category) !== normCat) continue;
          const dist = calculateDistanceMeters(lat, lng, Number(candidate.latitude), Number(candidate.longitude));
          if (dist > 500) continue;

          const isSameCitizen = String(candidate.citizen_id) === String(citizenId);
          const now = new Date();
          const slaExp = candidate.sla_deadline ? new Date(candidate.sla_deadline) : new Date(new Date(candidate.created_at || Date.now()).getTime() + 4 * 24 * 60 * 60 * 1000);
          const isSlaActive = now < slaExp;

          if (isSameCitizen && isSlaActive) {
            sameCitizenActiveMatch = { candidate, dist, slaExp };
            break; // Highest priority: block same citizen repeat active report
          } else if (!isSameCitizen) {
            if (!otherCitizenNearbyMatch || dist < otherCitizenNearbyMatch.dist) {
              otherCitizenNearbyMatch = { candidate, dist };
            }
          }
        }
      } catch (dupCheckErr) {
        console.warn('Duplicate pre-check note:', dupCheckErr.message);
      }
    }

    // STEP 6: If same citizen active duplicate found -> Reject with 409 Conflict
    if (sameCitizenActiveMatch) {
      const { candidate, slaExp } = sameCitizenActiveMatch;
      const remainingMs = Math.max(0, slaExp.getTime() - Date.now());
      const remainingMins = Math.round(remainingMs / (1000 * 60));
      const remainingHours = (remainingMs / (1000 * 60 * 60)).toFixed(1);
      const remainingTimeStr = remainingMins < 60 ? `${remainingMins} minutes` : `${remainingHours} hours`;

      return res.status(409).json({
        error: 'You already reported this issue within the active response period.',
        existing_complaint_id: String(candidate.id),
        complaint_number: candidate.complaint_number || '',
        sla_deadline: candidate.sla_deadline ? new Date(candidate.sla_deadline).toISOString() : slaExp.toISOString(),
        remaining_time: remainingTimeStr
      });
    }

    // Other citizen duplicate match flag
    let isPotentialDuplicate = false;
    let potentialParentId = null;
    let duplicateDistanceM = null;

    if (otherCitizenNearbyMatch) {
      isPotentialDuplicate = true;
      potentialParentId = String(otherCitizenNearbyMatch.candidate.id);
      duplicateDistanceM = Math.round(otherCitizenNearbyMatch.dist);
    }

    // Calculate 4-Quadrant Risk Matrix & Priority Rank
    const { calculateRiskAssessment } = require('../services/riskMatrixService');
    const riskAssessment = calculateRiskAssessment({
      safety_score: req.body.safety_score,
      disruption_score: req.body.disruption_score,
      health_environment_score: req.body.health_environment_score,
      defect_severity_score: req.body.defect_severity_score,
      support_count: 1,
      sla_deadline: slaDeadline,
      category,
      priority,
      ai_evidence: req.body.ai_evidence || description
    });

    const initialSupportCount = 1;
    const initialRankingScore = riskAssessment.priority_rank;
    const computedPriority = riskAssessment.severity.charAt(0).toUpperCase() + riskAssessment.severity.slice(1).toLowerCase();

    const { computeImageHash } = require('../services/aiService');
    const primaryImageHash = computeImageHash(finalPhotoFront || finalPhotoUrl);

    const insertSql = `
      INSERT INTO complaints (
        complaint_number, citizen_id, photo_before_url, category, title, description, priority,
        status, department_id, latitude, longitude, location_source, location_accuracy_m, primary_image_hash, location_address, duplicate_of_id,
        photo_front_url, photo_left_url, photo_right_url, photo_closeup_url, angle_photos, additional_photos,
        sla_deadline, response_time_hours, support_count, ranking_score, is_potential_duplicate,
        potential_parent_id, duplicate_distance_m,
        safety_score, disruption_score, health_environment_score, defect_severity_score, risk_score, priority_rank,
        ai_model, ai_confidence, ai_status, ai_detected_class, ai_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(insertSql, [
      finalComplaintNumber,
      citizenId,
      finalPhotoUrl,
      category,
      title,
      description || '',
      computedPriority,
      finalDeptId,
      latNum,
      lngNum,
      normLocationSource,
      accuracyNum,
      primaryImageHash,
      location_address || '',
      duplicate_of_id || null,
      finalPhotoFront,
      finalPhotoLeft,
      finalPhotoRight,
      finalPhotoCloseup,
      finalAnglePhotos,
      finalAdditionalPhotos,
      slaDeadline,
      slaHours,
      initialSupportCount,
      initialRankingScore,
      isPotentialDuplicate,
      potentialParentId,
      duplicateDistanceM,
      riskAssessment.safety_score,
      riskAssessment.disruption_score,
      riskAssessment.health_environment_score,
      riskAssessment.defect_severity_score,
      riskAssessment.risk_score,
      riskAssessment.priority_rank,
      ai_model || 'civiclens-yolov8',
      ai_confidence !== undefined && ai_confidence !== null ? Number(ai_confidence) : null,
      ai_status || 'confirmed',
      ai_detected_class || null,
      ai_reason || null
    ]);

    const complaintId = result.rows[0].id;

    // Record initial status history
    try {
      const deptNameRes = await query(`SELECT name FROM departments WHERE id = ?`, [finalDeptId]);
      const deptName = deptNameRes.rows?.[0]?.name || 'Municipal Triage Queue';
      await query(
        `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [complaintId, 'Submitted', 'Complaint registered successfully by citizen.', deptName, 'Citizen']
      );
    } catch (hErr) {
      console.warn('Failed to record initial status history:', hErr.message);
    }

    // Dual-write to Supabase so complaint persists across serverless lambda containers
    let supaComplaintId = null;
    if (process.env.NODE_ENV !== 'test') {
      try {
        const { getSupabaseClient } = require('../middleware/auth');
        const supabase = getSupabaseClient();
        if (supabase) {
        const DEPT_UUID_MAP = {
          '1': '8ed9f760-1314-427c-a515-c2a54d6df6d8',
          '2': '9cabc1f2-fd10-48dd-a5cb-01d05197de22',
          '3': 'ead370cc-459c-44f0-899f-8a97f0928beb',
          '4': 'ee73cb82-cc47-4333-b7d6-4491353c1354',
          '5': '31842723-23ac-490b-912b-9f6d9afbdfb3',
          '6': 'ae5e4d0c-996f-4d81-9528-d642664c93ae',
          '7': '71542723-23ac-490b-912b-9f6d9afbdfb7',
          PWD: '8ed9f760-1314-427c-a515-c2a54d6df6d8',
          SAN: '9cabc1f2-fd10-48dd-a5cb-01d05197de22',
          WTR: 'ead370cc-459c-44f0-899f-8a97f0928beb',
          DRN: 'ee73cb82-cc47-4333-b7d6-4491353c1354',
          ELE: '31842723-23ac-490b-912b-9f6d9afbdfb3',
          TRF: 'ae5e4d0c-996f-4d81-9528-d642664c93ae',
          MNT: '71542723-23ac-490b-912b-9f6d9afbdfb7'
        };
        const canonicalResolvedDept = resolveDepartmentByCodeSync(String(finalDeptId)) || resolveDepartmentByCodeSync(String(department_id));
        const supaDeptId = DEPT_UUID_MAP[String(finalDeptId)] || (canonicalResolvedDept ? canonicalResolvedDept.id : (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(department_id)) ? String(department_id) : '8ed9f760-1314-427c-a515-c2a54d6df6d8'));

        let supaCitizenId = null;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(citizenId))) {
          supaCitizenId = String(citizenId);
        } else if (req.user && req.user.supabase_uid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.user.supabase_uid))) {
          supaCitizenId = String(req.user.supabase_uid);
        } else if (req.user && req.user.email) {
          try {
            const { data: supaProf } = await supabase.from('profiles').select('id').eq('email', req.user.email.toLowerCase()).maybeSingle();
            if (supaProf && supaProf.id) supaCitizenId = supaProf.id;
          } catch (e) {}
        }

        let parsedAnglePhotos = null;
        try { if (finalAnglePhotos) parsedAnglePhotos = JSON.parse(finalAnglePhotos); } catch {}
        let parsedAdditionalPhotos = null;
        try { if (finalAdditionalPhotos) parsedAdditionalPhotos = JSON.parse(finalAdditionalPhotos); } catch {}

        const { data: supaComp, error: supaErr } = await supabase.from('complaints').insert([{
          complaint_number: finalComplaintNumber,
          citizen_id: supaCitizenId,
          photo_before_url: finalPhotoUrl,
          photo_front_url: finalPhotoFront,
          photo_left_url: finalPhotoLeft,
          photo_right_url: finalPhotoRight,
          photo_closeup_url: finalPhotoCloseup,
          angle_photos: parsedAnglePhotos,
          additional_photos: parsedAdditionalPhotos,
          category,
          title,
          description: description || '',
          priority,
          status: 'Submitted',
          department_id: supaDeptId,
          latitude,
          longitude,
          location_source: location_source || 'manual_pin',
          location_address: location_address || '',
          sla_deadline: slaDeadline,
          response_time_hours: slaHours,
          ai_category: req.body.ai_category || category,
          ai_specific_issue: req.body.ai_specific_issue || category,
          ai_confidence: req.body.ai_confidence || 0.85,
          ai_severity: req.body.ai_severity || priority,
          ai_urgency: req.body.ai_urgency || priority,
          ai_evidence: req.body.ai_evidence || description || '',
          ai_model: req.body.ai_model || 'civiclens-yolov8',
          ai_analyzed_at: req.body.ai_analyzed_at || new Date().toISOString()
        }]).select().maybeSingle();

        if (supaErr && supaErr.message && supaErr.message.includes('additional_photos')) {
          const { data: supaCompRetry, error: supaRetryErr } = await supabase.from('complaints').insert([{
            complaint_number: finalComplaintNumber,
            citizen_id: supaCitizenId,
            photo_before_url: finalPhotoUrl,
            photo_front_url: finalPhotoFront,
            photo_left_url: finalPhotoLeft,
            photo_right_url: finalPhotoRight,
            photo_closeup_url: finalPhotoCloseup,
            angle_photos: parsedAnglePhotos,
            category,
            title,
            description: description || '',
            priority,
            status: 'Submitted',
            department_id: supaDeptId,
            latitude,
            longitude,
            location_source: location_source || 'manual_pin',
            location_address: location_address || '',
            sla_deadline: slaDeadline,
            response_time_hours: slaHours,
            ai_category: req.body.ai_category || category,
            ai_specific_issue: req.body.ai_specific_issue || category,
            ai_confidence: req.body.ai_confidence || 0.85,
            ai_severity: req.body.ai_severity || priority,
            ai_urgency: req.body.ai_urgency || priority,
            ai_evidence: req.body.ai_evidence || description || '',
            ai_model: req.body.ai_model || 'civiclens-yolov8',
            ai_analyzed_at: req.body.ai_analyzed_at || new Date().toISOString()
          }]).select().maybeSingle();

          if (supaCompRetry?.id) {
            supaComplaintId = supaCompRetry.id;
          }
          if (supaRetryErr) {
            console.warn('Supabase mirror retry note:', supaRetryErr.message);
          }
        } else if (supaComp?.id) {
          supaComplaintId = supaComp.id;
        } else if (supaErr) {
          console.warn('Supabase mirror insert note:', supaErr.message);
        }
      }
    } catch (sErr) {
      console.warn('Supabase mirror insert exception:', sErr.message);
    }
  }

    // Trigger automatic staff assignment based on department workload, availability, and performance
    let currentStatus = 'Submitted';
    let assignedStaffId = null;
    let assignedStaffName = null;
    let assignedStaffEmail = null;
    let assignedAt = null;

    try {
      const { autoAssignComplaint } = require('../services/autoAssignmentService');
      const assignResult = await autoAssignComplaint(complaintId, finalDeptId, {
        priority,
        citizenId,
        departmentName: finalDeptName
      });

      if (assignResult.assigned && assignResult.staff) {
        currentStatus = 'Staff Assigned';
        assignedStaffId = String(assignResult.staff.id);
        assignedStaffName = assignResult.staff.name;
        assignedStaffEmail = assignResult.staff.email;
        assignedAt = new Date().toISOString();
      }
    } catch (assignErr) {
      console.warn('Auto-assignment non-fatal exception:', assignErr.message);
    }

    // Send initial submission notification (if not already notified by auto-assignment)
    if (currentStatus === 'Submitted') {
      await notifyStatusChange(complaintId, 'Submitted', citizenId).catch(nErr => {
        console.warn('Initial submission notification note:', nErr.message);
      });
    }

    // Trigger recurring issue detection (non-blocking, additive)
    let recurrenceInfo = null;
    try {
      const { detectAndRecordRecurrence } = require('../services/recurringIssueService');
      recurrenceInfo = await detectAndRecordRecurrence({
        id: complaintId,
        complaint_number: finalComplaintNumber,
        category,
        title,
        description,
        latitude: latNum,
        longitude: lngNum,
        location_source: normLocationSource,
        location_accuracy_m: accuracyNum,
        location_address: location_address || '',
        department_id: finalDeptId,
        ai_detected_class,
        created_at: new Date().toISOString()
      });
    } catch (recErr) {
      console.warn('Recurring issue detection non-fatal error:', recErr.message);
    }

    // Anchor initial complaint cryptographic commitment on permissioned blockchain (non-blocking, additive)
    try {
      const { integrityService } = require('../services/blockchain');
      await integrityService.recordComplaintSubmission({
        id: complaintId,
        complaint_number: finalComplaintNumber,
        citizen_id: citizenId,
        category,
        priority: computedPriority,
        status: 'Submitted',
        department_id: finalDeptId,
        latitude: latNum,
        longitude: lngNum,
        location_accuracy_m: accuracyNum,
        primary_image_hash: primaryImageHash,
        photo_before_url: finalPhotoUrl,
        created_at: new Date().toISOString()
      });
    } catch (bImportErr) {
      console.warn('[BLOCKCHAIN INTEGRITY SERVICE NOTE]', bImportErr.message);
    }

    const returnedId = complaintId || supaComplaintId || finalComplaintNumber;

    return res.status(201).json({
      message: 'Complaint submitted successfully',
      complaint_id: returnedId,
      complaint_number: finalComplaintNumber,
      recurrence: recurrenceInfo || null,
      complaint: normalizeComplaintPhotoUrls({
        id: returnedId,
        complaint_number: finalComplaintNumber,
        citizen_id: citizenId,
        photo_before_url: finalPhotoUrl,
        photo_front_url: finalPhotoFront,
        photo_left_url: finalPhotoLeft,
        photo_right_url: finalPhotoRight,
        photo_closeup_url: finalPhotoCloseup,
        angle_photos: angle_photos || [],
        additional_photos: additional_photos || [],
        category,
        title,
        description: description || '',
        priority,
        status: currentStatus,
        assigned_staff_id: assignedStaffId,
        assigned_staff_name: assignedStaffName,
        assigned_staff_email: assignedStaffEmail,
        assigned_at: assignedAt,
        department_id: finalDeptId,
        department_name: finalDeptName,
        department_code: finalDeptCode,
        latitude: latNum,
        longitude: lngNum,
        location_source: normLocationSource,
        location_accuracy_m: accuracyNum,
        location_address: location_address || '',
        sla_deadline: slaDeadline,
        response_time_hours: slaHours,
        safety_score: riskAssessment.safety_score,
        disruption_score: riskAssessment.disruption_score,
        health_environment_score: riskAssessment.health_environment_score,
        defect_severity_score: riskAssessment.defect_severity_score,
        risk_score: riskAssessment.risk_score,
        priority_rank: riskAssessment.priority_rank,
        recurrence: recurrenceInfo || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, req)
    });
  } catch (err) {
    console.error('Submit complaint error:', err);
    return res.status(500).json({ error: 'Failed to submit complaint' });
  }
};

router.post('/submit', authenticateToken, complaintSubmitLimiter, validateInput(createComplaintSchema), submitComplaintHandler);
router.post('/', authenticateToken, complaintSubmitLimiter, validateInput(createComplaintSchema), submitComplaintHandler);

// Analytics for recurring issues (Authorized staff / department heads / admins only)
router.get('/recurring/analytics', authenticateToken, async (req, res) => {
  try {
    const userRole = (req.user?.role || 'citizen').toLowerCase();
    if (!['admin', 'city_admin', 'department_head', 'overseer', 'officer'].includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Access restricted to authorized personnel.' });
    }

    let deptId = req.query.department_id || null;
    if (userRole === 'department_head') {
      const userCanonical = resolveDepartmentByCodeSync(req.user.department_id || req.user.department_code);
      deptId = userCanonical.id;
    }

    const { getRecurringAnalytics } = require('../services/recurringIssueService');
    const analytics = await getRecurringAnalytics({ department_id: deptId });
    return res.json(analytics);
  } catch (err) {
    console.error('Error fetching recurrence analytics:', err);
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get recurrence details for a complaint
router.get('/:id/recurrence', authenticateToken, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const userRole = (req.user?.role || 'citizen').toLowerCase();

    const compRes = await query(
      `SELECT id, complaint_number, citizen_id, department_id, category, status FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`,
      [complaintId, complaintId, String(complaintId)]
    );

    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    const complaint = compRes.rows[0];

    // Citizen can view their own complaint's recurrence status
    if (userRole === 'citizen') {
      const isOwner = await isCitizenComplaintOwner(complaint.citizen_id, req.user);
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: You can only view recurrence for your own complaints.' });
      }
    } else if (userRole === 'department_head') {
      // Department Head isolation
      const userDept = req.user.department_id || req.user.department_code;
      const userCanonical = resolveDepartmentByCodeSync(userDept);
      const compCanonical = resolveDepartmentByCodeSync(complaint.department_id);
      if (userCanonical.code !== compCanonical.code) {
        return res.status(403).json({ error: 'Forbidden: Unauthorized department access. You can only view complaints for your department.' });
      }
    } else if (!['admin', 'city_admin', 'overseer', 'officer', 'staff', 'service_staff'].includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Unauthorized access.' });
    }

    const { getRecurrenceForComplaint } = require('../services/recurringIssueService');
    const recurrenceLinks = await getRecurrenceForComplaint(complaint.id);

    return res.json({
      complaint_id: complaint.id,
      has_recurrence: recurrenceLinks.length > 0,
      recurrence_count: recurrenceLinks.length,
      recurrence_links: recurrenceLinks
    });
  } catch (err) {
    console.error('Error fetching recurrence details:', err);
    return res.status(500).json({ error: 'Failed to retrieve recurrence details' });
  }
});

// Review and confirm or dismiss a potential recurrence
router.patch('/:id/recurrence', authenticateToken, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const userRole = (req.user?.role || 'citizen').toLowerCase();

    // Prevent citizens from reviewing/confirming recurrences
    if (userRole === 'citizen') {
      return res.status(403).json({ error: 'Forbidden: Citizens cannot review or confirm recurrence links.' });
    }

    const authorizedRoles = ['department_head', 'admin', 'city_admin', 'overseer', 'officer'];
    if (!authorizedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to review recurrence.' });
    }

    const compRes = await query(
      `SELECT id, complaint_number, citizen_id, department_id, category, status FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`,
      [complaintId, complaintId, String(complaintId)]
    );

    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    const complaint = compRes.rows[0];

    // Department Head isolation
    if (userRole === 'department_head') {
      const userDept = req.user.department_id || req.user.department_code;
      const userCanonical = resolveDepartmentByCodeSync(userDept);
      const compCanonical = resolveDepartmentByCodeSync(complaint.department_id);
      if (userCanonical.code !== compCanonical.code) {
        return res.status(403).json({ error: 'Forbidden: You can only review recurrences for your authorized department.' });
      }
    }

    const { status, review_notes } = req.body;
    if (!status || !['Confirmed', 'Dismissed', 'Potential'].includes(status)) {
      return res.status(400).json({ error: 'Valid status required: Confirmed, Dismissed, or Potential' });
    }

    const { reviewRecurrenceLink } = require('../services/recurringIssueService');
    const result = await reviewRecurrenceLink(complaint.id, {
      status,
      reviewedBy: req.user.id || req.user.name || 'Department Head',
      reviewNotes: review_notes
    });

    return res.json({
      message: `Recurrence status updated to ${status}`,
      complaint_id: complaint.id,
      ...result
    });
  } catch (err) {
    console.error('Error reviewing recurrence:', err);
    return res.status(500).json({ error: err.message || 'Failed to review recurrence' });
  }
});

// Merge duplicate complaint into master complaint (Authorized Overseer / Department Head / City Admin only)
router.post('/:id/merge', authenticateToken, async (req, res) => {
  try {
    const userRole = req.user?.role || 'citizen';
    if (!['department_head', 'city_admin', 'overseer', 'admin', 'officer'].includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Only authorized overseers/department heads can merge complaints.' });
    }

    const duplicateId = req.params.id;
    const { target_complaint_id } = req.body;

    if (!target_complaint_id) {
      return res.status(400).json({ error: 'target_complaint_id is required' });
    }

    // Fetch duplicate complaint
    const dupRes = await query(`SELECT * FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`, [duplicateId, duplicateId, duplicateId]);
    if (!dupRes.rows || dupRes.rows.length === 0) {
      return res.status(404).json({ error: 'Duplicate complaint not found' });
    }
    const duplicateComp = dupRes.rows[0];

    // Fetch master complaint
    const masterRes = await query(`SELECT * FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`, [target_complaint_id, target_complaint_id, target_complaint_id]);
    if (!masterRes.rows || masterRes.rows.length === 0) {
      return res.status(404).json({ error: 'Target master complaint not found' });
    }
    const masterComp = masterRes.rows[0];

    const dist = calculateDistanceMeters(
      Number(duplicateComp.latitude), Number(duplicateComp.longitude),
      Number(masterComp.latitude), Number(masterComp.longitude)
    );

    const nowIso = new Date().toISOString();
    const userId = String(req.user.id);

    // 1. Mark duplicate complaint as merged
    await query(
      `UPDATE complaints 
       SET is_merged = ?, merged_into_id = ?, merged_at = ?, merged_by = ?, is_potential_duplicate = ?
       WHERE id = ?`,
      [true, String(masterComp.id), nowIso, userId, false, duplicateComp.id]
    );

    // 2. Check if citizen already counted toward master complaint
    const dupCitizenId = String(duplicateComp.citizen_id);
    const existingContributorsRes = await query(
      `SELECT citizen_id FROM complaints WHERE id = ? OR merged_into_id = ? OR CAST(id AS TEXT) = ?`,
      [masterComp.id, String(masterComp.id), String(masterComp.id)]
    );
    const existingCitizenIds = (existingContributorsRes.rows || []).map(r => String(r.citizen_id));

    // Current support count of master
    let currentSupport = masterComp.support_count || 1;
    // Count how many times dupCitizenId is in existingCitizenIds before this merge
    const countPrior = existingCitizenIds.filter(id => id === dupCitizenId).length;

    let newSupport = currentSupport;
    if (countPrior <= 1) {
      // First time this citizen is being merged into master
      newSupport = currentSupport + 1;
    }

    // 3. Recalculate ranking score and 4-quadrant priority rank
    const p = String(masterComp.priority || '').toLowerCase();
    const severityWeight = p === 'critical' ? 8 : (p === 'high' ? 5 : (p === 'medium' ? 2 : 0));
    const isOverdue = masterComp.sla_deadline && new Date() > new Date(masterComp.sla_deadline);
    const overdueWeight = isOverdue ? 4 : 0;
    const newRankingScore = newSupport + severityWeight + overdueWeight;

    const baseRiskScore = Number(masterComp.risk_score ?? (p === 'critical' ? 10 : (p === 'high' ? 7 : (p === 'medium' ? 4 : 1))));
    const newPriorityRank = (baseRiskScore * 10) + Math.min(newSupport, 10) + (isOverdue ? 10 : 0);

    await query(
      `UPDATE complaints SET support_count = ?, ranking_score = ?, priority_rank = ? WHERE id = ?`,
      [newSupport, newRankingScore, newPriorityRank, masterComp.id]
    );

    // 4. History log
    try {
      await query(
        `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [
          duplicateComp.id,
          'Merged',
          `Complaint ${duplicateComp.complaint_number || duplicateComp.id} merged into ${masterComp.complaint_number || masterComp.id}. Distance: ${Math.round(dist)} m. Reason: Same issue within 500 m`,
          'Overseer Review',
          String(req.user.name || req.user.email || 'Authorized Staff')
        ]
      );
    } catch (hErr) {}

    return res.json({
      success: true,
      message: `Merged complaint ${duplicateComp.complaint_number || duplicateComp.id} into ${masterComp.complaint_number || masterComp.id}`,
      master_complaint_id: masterComp.id,
      support_count: newSupport,
      ranking_score: newRankingScore,
      priority_rank: newPriorityRank
    });
  } catch (err) {
    console.error('Merge complaint error:', err);
    return res.status(500).json({ error: 'Failed to merge complaints' });
  }
});

// Admin / Department Head manual override for severity & risk scores
router.patch('/:id/risk', authenticateToken, async (req, res) => {
  try {
    const userRole = req.user?.role || 'citizen';
    if (!['admin', 'city_admin', 'department_head', 'officer'].includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Only Admins or Department Heads can override severity or risk scores' });
    }

    const complaintId = req.params.id;
    const { severity, safety_score, disruption_score, health_environment_score, defect_severity_score, reason } = req.body;

    const compRes = await query(`SELECT * FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`, [complaintId, complaintId, complaintId]);
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    const comp = compRes.rows[0];

    const oldSeverity = comp.priority || comp.severity || 'Medium';
    let targetSeverity = severity ? severity.trim().toUpperCase() : oldSeverity.toUpperCase();
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(targetSeverity)) {
      targetSeverity = 'MEDIUM';
    }
    const normalizedNewSeverity = targetSeverity.charAt(0).toUpperCase() + targetSeverity.slice(1).toLowerCase();

    const { calculateRiskAssessment } = require('../services/riskMatrixService');
    const assessed = calculateRiskAssessment({
      safety_score: safety_score !== undefined ? safety_score : comp.safety_score,
      disruption_score: disruption_score !== undefined ? disruption_score : comp.disruption_score,
      health_environment_score: health_environment_score !== undefined ? health_environment_score : comp.health_environment_score,
      defect_severity_score: defect_severity_score !== undefined ? defect_severity_score : comp.defect_severity_score,
      support_count: comp.support_count || 1,
      sla_deadline: comp.sla_deadline,
      priority: normalizedNewSeverity
    });

    const finalPriority = severity ? normalizedNewSeverity : (assessed.severity.charAt(0).toUpperCase() + assessed.severity.slice(1).toLowerCase());

    await query(
      `UPDATE complaints 
       SET priority = ?, safety_score = ?, disruption_score = ?, health_environment_score = ?, defect_severity_score = ?, risk_score = ?, priority_rank = ?, updated_at = ?
       WHERE id = ?`,
      [
        finalPriority,
        assessed.safety_score,
        assessed.disruption_score,
        assessed.health_environment_score,
        assessed.defect_severity_score,
        assessed.risk_score,
        assessed.priority_rank,
        new Date().toISOString(),
        comp.id
      ]
    );

    // Record audit history
    try {
      await query(
        `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [
          comp.id,
          comp.status || 'Updated',
          `Severity overridden from ${oldSeverity} to ${finalPriority}. Reason: ${reason || 'Administrative risk review'}.`,
          'Administration',
          String(req.user.name || req.user.email || 'Admin/HOD')
        ]
      );
    } catch (hErr) {}

    return res.json({
      success: true,
      message: 'Risk assessment & severity updated successfully',
      complaint_id: comp.id,
      old_severity: oldSeverity,
      new_severity: finalPriority,
      risk_score: assessed.risk_score,
      priority_rank: assessed.priority_rank,
      updated_by: req.user.name || req.user.email,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Risk override error:', err);
    return res.status(500).json({ error: 'Failed to override risk assessment' });
  }
});

// Get complaint status history timeline with role-aware authorization
router.get('/:id/history', authenticateToken, async (req, res) => {
  try {
    const compRes = await query(
      `SELECT id, citizen_id, department_id, assigned_staff_id, assigned_staff_email 
       FROM complaints 
       WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`,
      [req.params.id, req.params.id, req.params.id]
    );
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const complaint = compRes.rows[0];
    const user = req.user;
    const userRole = user?.role || 'citizen';
    const isOwner = await isCitizenComplaintOwner(complaint.citizen_id, user);
    const isAdmin = ['admin', 'city_admin'].includes(userRole);
    const isDeptHeadOrOfficer = ['department_head', 'officer'].includes(userRole);
    const isStaff = ['staff', 'service_staff'].includes(userRole);

    if (userRole === 'citizen') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: You can only view your own complaints history' });
      }
    } else if (isStaff) {
      const isAssigned = (complaint.assigned_staff_id && String(complaint.assigned_staff_id) === String(user.id)) ||
        (complaint.assigned_staff_email && complaint.assigned_staff_email.toLowerCase() === (user.email || '').toLowerCase());
      if (!isAssigned) {
        const assignCheck = await query(
          `SELECT id FROM assignments WHERE (complaint_id = ? OR CAST(complaint_id AS TEXT) = ?) AND (staff_id = ? OR CAST(staff_id AS TEXT) = ?)`,
          [complaint.id, String(complaint.id), user.id, String(user.id)]
        );
        if (!assignCheck.rows || assignCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Forbidden: You are not assigned to this complaint' });
        }
      }
    } else if (isDeptHeadOrOfficer) {
      if (user.department_id && complaint.department_id && String(user.department_id) !== String(complaint.department_id)) {
        return res.status(403).json({ error: 'Forbidden: Access denied for this department' });
      }
    } else if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Unauthorized access' });
    }

    const historyRes = await query(
      `SELECT h.* FROM complaint_status_history h
       WHERE h.complaint_id = ? OR CAST(h.complaint_id AS TEXT) = ?
       ORDER BY h.created_at ASC`,
      [complaint.id, String(complaint.id)]
    );
    return res.json({ history: historyRes.rows || [] });
  } catch (err) {
    console.error('Fetch complaint status history error:', err);
    return res.status(500).json({ error: 'Failed to fetch status history' });
  }
});

// Helper to safely merge authorized records from both PostgreSQL and Supabase
function mergeComplaintRows(primaryList = [], secondaryList = [], sortByOperational = false) {
  const mergedMap = new Map();
  const getRecordKey = (c) => c.complaint_number || String(c.id);

  const mergeTwo = (newer, older) => {
    const result = { ...newer };
    const fieldsToFill = [
      'latitude',
      'longitude',
      'department_id',
      'department_name',
      'category',
      'priority',
      'status',
      'photo_url',
      'image_url',
      'assigned_staff_id',
      'assigned_staff_name',
      'sla_deadline',
      'location_address',
      'description',
      'title',
      'citizen_id',
      'citizen_name',
      'citizen_mobile',
      'safety_score',
      'disruption_score',
      'health_environment_score',
      'defect_severity_score',
      'risk_score',
      'priority_rank'
    ];
    for (const f of fieldsToFill) {
      if ((result[f] === null || result[f] === undefined || result[f] === '') && older[f] !== null && older[f] !== undefined && older[f] !== '') {
        result[f] = older[f];
      }
    }
    return result;
  };

  for (const c of [...primaryList, ...secondaryList]) {
    if (!c) continue;
    const key = getRecordKey(c);
    if (!mergedMap.has(key)) {
      mergedMap.set(key, c);
    } else {
      const existing = mergedMap.get(key);
      const existingTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
      const newTime = new Date(c.updated_at || c.created_at || 0).getTime();
      if (newTime >= existingTime) {
        mergedMap.set(key, mergeTwo(c, existing));
      } else {
        mergedMap.set(key, mergeTwo(existing, c));
      }
    }
  }

  const items = Array.from(mergedMap.values());
  if (sortByOperational) {
    const severityOrder = { critical: 1, high: 2, medium: 3, low: 4 };
    return items.sort((a, b) => {
      const sevA = severityOrder[String(a.priority || a.severity || '').toLowerCase()] || 5;
      const sevB = severityOrder[String(b.priority || b.severity || '').toLowerCase()] || 5;
      if (sevA !== sevB) {
        return sevA - sevB;
      }
      const rankA = Number(a.priority_rank ?? a.ranking_score ?? 0);
      const rankB = Number(b.priority_rank ?? b.ranking_score ?? 0);
      if (rankA !== rankB) {
        return rankB - rankA;
      }
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });
  }

  return items.sort((a, b) => {
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

// Get all complaints for Admin / Portals (Citizens only list their own complaints)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userRole = req.user?.role || 'citizen';
    const isCitizen = userRole === 'citizen';
    const isDeptHead = userRole === 'department_head';

    let sql = `
      SELECT c.*, d.name as department_name, f.rating, f.comment as feedback_comment, f.created_at as feedback_created_at
      ${!isCitizen ? ', u.name as citizen_name' : ''}
      FROM complaints c
      LEFT JOIN departments d ON (CAST(c.department_id AS TEXT) = CAST(d.id AS TEXT) OR c.department_id = d.code)
      LEFT JOIN feedback f ON (f.complaint_id = c.id OR CAST(f.complaint_id AS TEXT) = CAST(c.id AS TEXT))
      ${!isCitizen ? 'LEFT JOIN users u ON (c.citizen_id = u.id OR CAST(c.citizen_id AS TEXT) = CAST(u.id AS TEXT))' : ''}
    `;
    const params = [];

    if (isCitizen) {
      const allowedIds = Array.from(await resolveAuthorizedCitizenIds(req.user));
      if (allowedIds.length > 0) {
        const placeholders = allowedIds.map(() => '?').join(', ');
        sql += ` WHERE (c.citizen_id IN (${placeholders}) OR CAST(c.citizen_id AS TEXT) IN (${placeholders}))`;
        params.push(...allowedIds, ...allowedIds.map(String));
      } else {
        const rawCitizenId = req.user?.id != null ? String(req.user.id) : '';
        sql += ` WHERE (c.citizen_id = ? OR CAST(c.citizen_id AS TEXT) = ?)`;
        params.push(rawCitizenId, rawCitizenId);
      }
    } else if (isDeptHead && (req.user?.department_id || req.user?.department_code)) {
      const rawDept = req.user.department_id || req.user.department_code;
      const deptCode = req.user.department_code || (String(rawDept).length <= 4 ? String(rawDept) : null);
      let canonicalDept = null;
      if (deptCode) {
        canonicalDept = await resolveDepartmentByCode(deptCode);
      } else if (rawDept) {
        canonicalDept = await resolveDepartmentByCode(rawDept);
      }
      if (canonicalDept) {
        sql += ` WHERE (c.department_id = ? OR c.department_id = ? OR d.id = ? OR d.code = ? OR d.registry_id = ?)`;
        params.push(canonicalDept.id, canonicalDept.registry_id, canonicalDept.id, canonicalDept.code, canonicalDept.registry_id);
      } else {
        sql += ` WHERE (c.department_id = ? OR CAST(c.department_id AS TEXT) = ? OR d.id = ? OR CAST(d.id AS TEXT) = ?)`;
        params.push(req.user.department_id, String(req.user.department_id), req.user.department_id, String(req.user.department_id));
      }
    }
    sql += ` ORDER BY c.created_at DESC`;
    const result = await query(sql, params);
    const pgRows = result.rows || [];

    const mappedRows = pgRows.map(c => {
      const norm = normalizeComplaintPhotoUrls(c, req);
      norm.citizen_name = norm.citizen_name || (String(norm.citizen_id) === 'e2a4338c-5d49-4ae3-b766-40d99fb26f87' || String(norm.citizen_id) === '58' ? 'Pratik Dilip Tupe' : 'Citizen');
      if (norm.rating) {
        norm.feedback = {
          complaint_number: norm.complaint_number,
          citizen_name: norm.citizen_name,
          rating: Number(norm.rating),
          review: norm.feedback_comment || '',
          comment: norm.feedback_comment || '',
          submission_date: norm.feedback_created_at || null,
          created_at: norm.feedback_created_at || null
        };
      }
      return norm;
    });

    return res.json({ complaints: mappedRows });
  } catch (err) {
    console.error('Fetch all complaints error:', err);
    return res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

// Get user's complaint history
router.get('/my', authenticateToken, async (req, res) => {
  try {
    let sql = `
      SELECT c.*, d.name as department_name, f.rating, f.comment as feedback_comment
      FROM complaints c
      LEFT JOIN departments d ON (CAST(c.department_id AS TEXT) = CAST(d.id AS TEXT) OR c.department_id = d.code)
      LEFT JOIN feedback f ON f.complaint_id = c.id
    `;
    const params = [];
    const allowedIds = Array.from(await resolveAuthorizedCitizenIds(req.user));
    if (allowedIds.length > 0) {
      const placeholders = allowedIds.map(() => '?').join(', ');
      sql += ` WHERE (c.citizen_id IN (${placeholders}) OR CAST(c.citizen_id AS TEXT) IN (${placeholders}))`;
      params.push(...allowedIds, ...allowedIds.map(String));
    } else {
      const rawCitizenId = req.user?.id != null ? String(req.user.id) : '';
      sql += ` WHERE (c.citizen_id = ? OR CAST(c.citizen_id AS TEXT) = ?)`;
      params.push(rawCitizenId, rawCitizenId);
    }
    sql += ` ORDER BY c.created_at DESC`;
    const result = await query(sql, params);
    const pgRows = result.rows || [];

    return res.json({ complaints: pgRows.map(c => normalizeComplaintPhotoUrls(c, req)) });
  } catch (err) {
    console.error('Fetch my complaints error:', err);
    return res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

// Get single complaint by ID with strict role-aware authorization
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const idParam = req.params.id;
    const sql = `
      SELECT c.*, d.name as department_name,
             u.name as citizen_name, u.mobile as citizen_mobile,
             f.rating, f.comment as feedback_comment, f.created_at as feedback_created_at
      FROM complaints c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN users u ON c.citizen_id = u.id
      LEFT JOIN feedback f ON f.complaint_id = c.id
      WHERE c.id = ? OR c.complaint_number = ? OR CAST(c.id AS TEXT) = ?
    `;
    let result = await query(sql, [idParam, idParam, idParam]);
    let complaint = result.rows && result.rows.length > 0 ? result.rows[0] : null;

    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const user = req.user;
    const userRole = user?.role || 'citizen';
    const isOwner = await isCitizenComplaintOwner(complaint.citizen_id, user);
    const isAdmin = ['admin', 'city_admin'].includes(userRole);
    const isDeptHeadOrOfficer = ['department_head', 'officer'].includes(userRole);
    const isStaff = ['staff', 'service_staff'].includes(userRole);

    if (userRole === 'citizen') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: You can only view your own complaints' });
      }
    } else if (isStaff) {
      const isAssigned = (complaint.assigned_staff_id && String(complaint.assigned_staff_id) === String(user.id)) ||
        (complaint.assigned_staff_email && complaint.assigned_staff_email.toLowerCase() === (user.email || '').toLowerCase());
      if (!isAssigned) {
        const assignCheck = await query(
          `SELECT id FROM assignments WHERE (complaint_id = ? OR CAST(complaint_id AS TEXT) = ?) AND (staff_id = ? OR CAST(staff_id AS TEXT) = ?)`,
          [complaint.id, String(complaint.id), user.id, String(user.id)]
        );
        if (!assignCheck.rows || assignCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Forbidden: You are not assigned to this complaint' });
        }
      }
    } else if (isDeptHeadOrOfficer) {
      if (user.department_id && complaint.department_id && String(user.department_id) !== String(complaint.department_id)) {
        return res.status(403).json({ error: 'Forbidden: Access denied for this department' });
      }
    } else if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Unauthorized access' });
    }

    // IDOR Protection: Redact citizen mobile and private details for non-owners
    if (!isOwner) {
      delete complaint.citizen_mobile;
      delete complaint.password_hash;
      delete complaint.email;
      delete complaint.residential_address;
    }

    // Resolve registered citizen name through authentic ownership relationship
    let registeredCitizenName = complaint.citizen_name;
    if (!registeredCitizenName || registeredCitizenName.trim() === '' || registeredCitizenName.toLowerCase() === 'anonymous citizen' || registeredCitizenName.toLowerCase() === 'anonymous') {
      try {
        const uRes = await query(
          `SELECT name FROM users WHERE id = ? OR CAST(id AS TEXT) = ? LIMIT 1`,
          [complaint.citizen_id, String(complaint.citizen_id)]
        );
        if (uRes.rows?.[0]?.name) {
          registeredCitizenName = uRes.rows[0].name;
        } else if (String(complaint.citizen_id) === 'e2a4338c-5d49-4ae3-b766-40d99fb26f87' || String(complaint.citizen_id) === '58') {
          registeredCitizenName = 'Pratik Dilip Tupe';
        } else {
          registeredCitizenName = 'Citizen';
        }
      } catch {
        registeredCitizenName = 'Citizen';
      }
    }
    complaint.citizen_name = registeredCitizenName || 'Citizen';

    if (complaint.rating) {
      complaint.feedback = {
        complaint_number: complaint.complaint_number,
        citizen_name: complaint.citizen_name,
        rating: Number(complaint.rating),
        review: complaint.feedback_comment || '',
        comment: complaint.feedback_comment || '',
        submission_date: complaint.feedback_created_at || null,
        created_at: complaint.feedback_created_at || null
      };
    } else {
      complaint.feedback = null;
    }

    // Fetch assignment details if any (without exposing staff mobile)
    try {
      const assignSql = `
        SELECT a.id, a.complaint_id, a.staff_id, a.assigned_by, a.assigned_at, a.resolved_at,
               s.name as staff_name, o.name as officer_name
        FROM assignments a
        LEFT JOIN users s ON a.staff_id = s.id
        LEFT JOIN users o ON a.assigned_by = o.id
        WHERE a.complaint_id = ?
        ORDER BY a.assigned_at DESC LIMIT 1
      `;
      const assignRes = await query(assignSql, [complaint.id]);
      complaint.assignment = assignRes.rows && assignRes.rows.length > 0 ? assignRes.rows[0] : null;
    } catch (aErr) {
      complaint.assignment = null;
    }

    // Recurrence details if present
    try {
      const { getRecurrenceForComplaint } = require('../services/recurringIssueService');
      const recLinks = await getRecurrenceForComplaint(complaint.id);
      if (recLinks && recLinks.length > 0) {
        complaint.recurring_issue = {
          is_recurring: true,
          recurrence_status: recLinks[0].status,
          previous_complaint_id: recLinks[0].previous_complaint_id,
          previous_complaint_number: recLinks[0].previous_complaint_number,
          distance_meters: recLinks[0].distance_meters,
          links: recLinks
        };
      } else {
        complaint.recurring_issue = null;
      }
    } catch (rErr) {
      complaint.recurring_issue = null;
    }

    return res.json({ complaint: normalizeComplaintPhotoUrls(complaint, req) });
  } catch (err) {
    console.error('Fetch complaint detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch complaint details' });
  }
});

// Cryptographic Data Integrity Verification endpoint
router.get('/:id/blockchain-verify', authenticateToken, async (req, res) => {
  try {
    const idParam = req.params.id;
    const compRes = await query(
      `SELECT id, complaint_number, citizen_id, department_id, assigned_staff_id, assigned_staff_email FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`,
      [idParam, idParam, idParam]
    );
    const complaint = compRes.rows?.[0];
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found', status: 'UNVERIFIABLE' });
    }

    const user = req.user;
    const userRole = user?.role || 'citizen';
    const isOwner = await isCitizenComplaintOwner(complaint.citizen_id, user);
    const isAdmin = ['admin', 'city_admin'].includes(userRole);
    const isDeptHeadOrOfficer = ['department_head', 'officer'].includes(userRole);
    const isStaff = ['staff', 'service_staff'].includes(userRole);

    if (userRole === 'citizen') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: You can only verify your own complaints' });
      }
    } else if (isStaff) {
      const isAssigned = (complaint.assigned_staff_id && String(complaint.assigned_staff_id) === String(user.id)) ||
        (complaint.assigned_staff_email && complaint.assigned_staff_email.toLowerCase() === (user.email || '').toLowerCase());
      if (!isAssigned) {
        return res.status(403).json({ error: 'Forbidden: You are not assigned to this complaint' });
      }
    } else if (isDeptHeadOrOfficer) {
      if (user.department_id && complaint.department_id && String(user.department_id) !== String(complaint.department_id)) {
        return res.status(403).json({ error: 'Forbidden: Access denied for this department' });
      }
    } else if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Unauthorized access' });
    }

    const { verificationService } = require('../services/blockchain');
    const result = await verificationService.verifyComplaintIntegrity(complaint.id);
    return res.json(result);
  } catch (err) {
    console.error('Blockchain verification error:', err);
    return res.status(500).json({ error: 'Failed to verify blockchain integrity', status: 'UNVERIFIABLE' });
  }
});

// Dedicated GET /api/complaints/:id/feedback with role-based access control
router.get('/:id/feedback', authenticateToken, async (req, res) => {
  try {
    const idParam = req.params.id;
    const sql = `
      SELECT c.id, c.complaint_number, c.citizen_id, c.department_id, c.assigned_staff_id, c.assigned_staff_email,
             u.name as citizen_name,
             f.rating, f.comment as feedback_comment, f.created_at as feedback_created_at
      FROM complaints c
      LEFT JOIN users u ON (c.citizen_id = u.id OR CAST(c.citizen_id AS TEXT) = CAST(u.id AS TEXT))
      LEFT JOIN feedback f ON (f.complaint_id = c.id OR CAST(f.complaint_id AS TEXT) = CAST(c.id AS TEXT))
      WHERE c.id = ? OR c.complaint_number = ? OR CAST(c.id AS TEXT) = ?
    `;
    const result = await query(sql, [idParam, idParam, idParam]);
    const complaint = result.rows && result.rows.length > 0 ? result.rows[0] : null;

    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const user = req.user;
    const userRole = user?.role || 'citizen';
    const isOwner = await isCitizenComplaintOwner(complaint.citizen_id, user);
    const isAdmin = ['admin', 'city_admin'].includes(userRole);
    const isDeptHeadOrOfficer = ['department_head', 'officer'].includes(userRole);
    const isStaff = ['staff', 'service_staff'].includes(userRole);

    if (userRole === 'citizen') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: You can only view feedback for your own complaints' });
      }
    } else if (isStaff) {
      const isAssigned = (complaint.assigned_staff_id && String(complaint.assigned_staff_id) === String(user.id)) ||
        (complaint.assigned_staff_email && complaint.assigned_staff_email.toLowerCase() === (user.email || '').toLowerCase());
      if (!isAssigned) {
        const assignCheck = await query(
          `SELECT id FROM assignments WHERE (complaint_id = ? OR CAST(complaint_id AS TEXT) = ?) AND (staff_id = ? OR CAST(staff_id AS TEXT) = ?)`,
          [complaint.id, String(complaint.id), user.id, String(user.id)]
        );
        if (!assignCheck.rows || assignCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Forbidden: You are not assigned to this complaint' });
        }
      }
    } else if (isDeptHeadOrOfficer) {
      if (user.department_id && complaint.department_id && String(user.department_id) !== String(complaint.department_id)) {
        return res.status(403).json({ error: 'Forbidden: Access denied for this department' });
      }
    } else if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Unauthorized access' });
    }

    if (!complaint.rating) {
      return res.status(404).json({ error: 'No feedback found for this complaint' });
    }

    let citizenName = complaint.citizen_name;
    if (!citizenName || citizenName === 'Citizen' || citizenName.trim() === '') {
      try {
        const uRes = await query(`SELECT name FROM users WHERE id = ? OR CAST(id AS TEXT) = ? LIMIT 1`, [complaint.citizen_id, String(complaint.citizen_id)]);
        citizenName = uRes.rows?.[0]?.name || (String(complaint.citizen_id) === 'e2a4338c-5d49-4ae3-b766-40d99fb26f87' || String(complaint.citizen_id) === '58' ? 'Pratik Dilip Tupe' : 'Citizen');
      } catch {
        citizenName = 'Citizen';
      }
    }

    return res.json({
      complaint_number: complaint.complaint_number,
      citizen_name: citizenName || 'Citizen',
      rating: Number(complaint.rating),
      review: complaint.feedback_comment || '',
      comment: complaint.feedback_comment || '',
      submission_date: complaint.feedback_created_at
    });
  } catch (err) {
    console.error('Fetch feedback error:', err);
    return res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Submit Feedback for resolved complaint
router.post('/:id/feedback', authenticateToken, validateInput(addFeedbackSchema), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (req.user?.role !== 'citizen') {
      return res.status(403).json({ error: 'Only citizens can submit complaint feedback' });
    }

    const compRes = await query(
      `SELECT id, citizen_id, status FROM complaints WHERE id = ? OR complaint_number = ? OR CAST(id AS TEXT) = ?`,
      [req.params.id, req.params.id, req.params.id]
    );
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const complaint = compRes.rows[0];
    const isOwner = await isCitizenComplaintOwner(complaint.citizen_id, req.user);
    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden: You can only provide feedback for your own complaint' });
    }

    const resolvedStatuses = ['Resolved', 'Closed', 'Completed', 'Resolution Submitted', 'Completed — Pending Verification'];
    if (!resolvedStatuses.includes(complaint.status)) {
      return res.status(400).json({ error: 'Feedback can only be submitted for resolved or completed complaints' });
    }

    const existingFeedback = await query(
      `SELECT id FROM feedback WHERE complaint_id = ? OR CAST(complaint_id AS TEXT) = ?`,
      [complaint.id, String(complaint.id)]
    );
    if (existingFeedback.rows && existingFeedback.rows.length > 0) {
      return res.status(400).json({ error: 'Feedback has already been submitted for this complaint' });
    }

    const insertSql = `
      INSERT INTO feedback (complaint_id, rating, comment)
      VALUES (?, ?, ?)
    `;
    await query(insertSql, [complaint.id, rating, comment || '']);

    return res.json({ message: 'Feedback submitted successfully' });
  } catch (err) {
    console.error('Submit feedback error:', err);
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

router.getDefaultResponseTimeHours = getDefaultResponseTimeHours;
router.calculateSlaDeadline = calculateSlaDeadline;

module.exports = router;
