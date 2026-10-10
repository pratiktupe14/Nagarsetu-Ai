const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clampScore, calculateRiskAssessment } = require('./riskMatrixService');

// Canonical Allowed Categories
const ALLOWED_CATEGORIES = [
  'Roads',
  'Water',
  'Drainage',
  'Sanitation',
  'Electricity',
  'Traffic',
  'Trees & Parks',
  'Public Infrastructure',
  'Parking',
  'Public Property',
  'Construction',
  'Flooding',
  'Safety Hazards'
];

const CATEGORY_DEPARTMENT_MAP = {
  'Roads': 'Public Works Department',
  'Water': 'Water Supply & Sewerage Board',
  'Drainage': 'Drainage & Sewage Department',
  'Sanitation': 'Sanitation & Waste Management',
  'Electricity': 'Electrical & Street Lighting',
  'Traffic': 'Traffic Management Department',
  'Trees & Parks': 'Maintenance Department',
  'Public Infrastructure': 'Public Works Department',
  'Parking': 'Traffic Management Department',
  'Public Property': 'Maintenance Department',
  'Construction': 'Public Works Department',
  'Flooding': 'Drainage & Sewage Department',
  'Safety Hazards': 'Maintenance Department'
};

const CANONICAL_DEPT_IDS = {
  'PWD': 1,
  'SAN': 2,
  'WTR': 3,
  'ELE': 4,
  'TRF': 5,
  'MNT': 6,
  'DRN': 7
};

function normalizeCategory(cat) {
  if (!cat) return 'Roads';
  const c = String(cat).trim();
  const directMatch = ALLOWED_CATEGORIES.find(a => a.toLowerCase() === c.toLowerCase());
  if (directMatch) return directMatch;

  const lower = c.toLowerCase();
  if (lower.includes('road') || lower.includes('pothole') || lower.includes('asphalt') || lower.includes('pavement')) return 'Roads';
  if (lower.includes('garbage') || lower.includes('waste') || lower.includes('trash') || lower.includes('sanitat') || lower.includes('dump')) return 'Sanitation';
  if (lower.includes('water') || lower.includes('pipe') || lower.includes('leakage') || lower.includes('supply')) return 'Water';
  if (lower.includes('drain') || lower.includes('sewag') || lower.includes('gutter') || lower.includes('manhole')) return 'Drainage';
  if (lower.includes('electr') || lower.includes('light') || lower.includes('wire') || lower.includes('cable') || lower.includes('pole')) return 'Electricity';
  if (lower.includes('traffic') || lower.includes('signal') || lower.includes('signboard') || lower.includes('zebra')) return 'Traffic';
  if (lower.includes('tree') || lower.includes('park') || lower.includes('garden') || lower.includes('branch')) return 'Trees & Parks';
  if (lower.includes('parking') || lower.includes('encroach')) return 'Parking';
  if (lower.includes('flood') || lower.includes('waterlog') || lower.includes('submerg')) return 'Flooding';
  if (lower.includes('hazard') || lower.includes('safety') || lower.includes('danger') || lower.includes('pit') || lower.includes('collapse')) return 'Safety Hazards';
  if (lower.includes('construction') || lower.includes('debris') || lower.includes('demolit')) return 'Construction';
  if (lower.includes('property') || lower.includes('fence') || lower.includes('bench') || lower.includes('monument')) return 'Public Property';
  if (lower.includes('infrastruct') || lower.includes('footpath') || lower.includes('bridge') || lower.includes('railing')) return 'Public Infrastructure';

  return 'Roads';
}

function normalizePriority(p) {
  if (!p) return 'Medium';
  const lower = String(p).toLowerCase().trim();
  if (lower === 'critical') return 'Critical';
  if (lower === 'high') return 'High';
  if (lower === 'low') return 'Low';
  return 'Medium';
}

function getCurrentModel() {
  return 'CivicLens YOLOv8 (Local CV)';
}

/**
 * Resolves the Python AI microservice inference URL safely, preventing duplicate /analyze segments
 */
function resolveAiAnalyzeUrl() {
  const raw = (process.env.PYTHON_AI_URL || 'http://localhost:8000/analyze').trim().replace(/\/+$/, '');
  return raw.endsWith('/analyze') ? raw : `${raw}/analyze`;
}

/**
 * Calls local Python FastAPI microservice (LangGraph + YOLOv8)
 */
async function callLocalAiService(fileBuffer, mimeType, originalName, domain = null) {
  const pythonUrl = resolveAiAnalyzeUrl();

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append('file', blob, originalName);
  if (domain) {
    formData.append('domain', domain);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout for model loading

  try {
    const headers = {};
    if (process.env.AI_INTERNAL_API_KEY) {
      headers['X-Internal-API-Key'] = process.env.AI_INTERNAL_API_KEY;
    }

    const response = await fetch(pythonUrl, {
      method: 'POST',
      body: formData,
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Python AI service responded with status ${response.status}: ${errText}`);
    }

    const json = await response.json();
    return json;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Generates a single coherent paragraph containing at least five meaningful sentences
 * describing the visible civic defect based on visual evidence, physical damage characteristics,
 * visible severity, potential public impact (distinguishing inference from observation),
 * and required municipal inspection and corrective action.
 */
function generateProfessionalCivicDescription(analysisData = {}) {
  const category = (analysisData.category || '').toLowerCase();
  const issueType = (analysisData.issueType || analysisData.issue_type || analysisData.title || '').toLowerCase();
  const rawClass = (analysisData.detected_class || analysisData.primaryClass || '').toLowerCase();
  const severity = analysisData.severity || 'High';
  const departmentName = analysisData.departmentName || analysisData.department || 'the responsible municipal department';
  const confidence = analysisData.confidence ? Math.round(Number(analysisData.confidence) * 100) : 92;

  // 1. Water Supply & Piping Infrastructure
  if (category.includes('water') || issueType.includes('pipe') || issueType.includes('leak') || rawClass.includes('pipe') || rawClass.includes('leak')) {
    const isRupture = issueType.includes('broken') || rawClass.includes('broken');
    const s1 = isRupture
      ? `Photographic evidence captured from the site reveals an active structural rupture affecting municipal water supply piping infrastructure.`
      : `Photographic evidence captured from the site reveals observable water leakage discharging from municipal piping infrastructure.`;
    const s2 = isRupture
      ? `Visual examination identifies localized pipe material fracture with pressurized water dispersion escaping across the adjacent surface area.`
      : `Physical inspection indicates fluid seepage and moisture pooling along the exposed conduit joint with approximately ${confidence}% visual confidence.`;
    const s3 = `The visible defect represents a ${severity.toLowerCase()}-severity utility condition demonstrating clear physical compromise that impairs steady localized distribution.`;
    const s4 = `While surface water discharge is directly confirmed in the photograph, inferred secondary consequences include gradual subsurface soil weakening, localized erosion, and potable water loss if left uncontained.`;
    const s5 = `Prompt on-site technical inspection and pipe restoration by ${departmentName} are necessary to isolate the supply line and complete durable repairs.`;
    return `${s1} ${s2} ${s3} ${s4} ${s5}`;
  }

  // 2. Road Surface & Potholes
  if (category.includes('road') || issueType.includes('pothole') || issueType.includes('road') || rawClass.includes('pothole')) {
    const s1 = `The uploaded photograph documents a distinct road surface defect consisting of an open pothole within the public vehicular roadway.`;
    const s2 = `Visual evidence demonstrates asphalt displacement with broken pavement margins and exposed base-course aggregate across the traffic corridor.`;
    const s3 = `The crater represents a ${severity.toLowerCase()}-severity roadway hazard displaying clear physical degradation that impedes continuous vehicular movement.`;
    const s4 = `Visual observations establish the pavement cavity directly, while inferred public impacts include sudden vehicular swerving, tire puncture risk, and progressive roadbed deterioration from repetitive axle loads.`;
    const s5 = `Targeted site inspection and bituminous asphalt patch remediation by ${departmentName} are required to level the thoroughfare and safeguard daily transit.`;
    return `${s1} ${s2} ${s3} ${s4} ${s5}`;
  }

  // 3. Sanitation & Waste Management
  if (category.includes('sanitat') || category.includes('waste') || category.includes('garbage') || issueType.includes('waste') || issueType.includes('garbage') || rawClass.includes('waste') || rawClass.includes('garbage')) {
    const s1 = `Visual analysis of the uploaded image identifies uncontained solid municipal waste accumulating along the public corridor.`;
    const s2 = `Observable physical evidence confirms scattered refuse bags, plastic packaging, and mixed municipal discards discarded upon the open ground.`;
    const s3 = `The accumulation represents a ${severity.toLowerCase()}-severity sanitary concern exhibiting untended refuse that obstructs orderly pedestrian access.`;
    const s4 = `Direct visual inspection verifies the uncollected litter pile, whereas inferred public impacts encompass foul odor dispersion, pest harborage, and potential stormwater drain blockages during heavy rain.`;
    const s5 = `Prompt dispatch of municipal clearing crews and localized sanitation treatment by ${departmentName} are necessary to remove all refuse and restore environmental cleanliness.`;
    return `${s1} ${s2} ${s3} ${s4} ${s5}`;
  }

  // 4. Drainage & Sewage Infrastructure
  if (category.includes('drain') || category.includes('sewag') || category.includes('flood') || issueType.includes('drain') || rawClass.includes('drain')) {
    const isOverflow = issueType.includes('overflow') || rawClass.includes('overflow');
    const s1 = isOverflow
      ? `Photographic evidence documents an active drainage overflow spilling runoff water across the surrounding public precinct.`
      : `Photographic evidence documents a compromised drainage channel obstructed by accumulated debris and sedimentation.`;
    const s2 = `Visible physical indicators confirm restricted hydraulic passage with foreign particulate matter gathered along the curb channel.`;
    const s3 = `The drainage structure presents a ${severity.toLowerCase()}-severity operational impediment exhibiting substantial silt buildup that impedes normal water flow.`;
    const s4 = `While waterway constriction is directly confirmed by visual inspection, inferred hazards include wastewater pooling, pedestrian inconvenience, and street flooding during peak runoff events.`;
    const s5 = `Expedited desilting and channel clearing operations by ${departmentName} are required to restore adequate drainage capacity and prevent localized waterlogging.`;
    return `${s1} ${s2} ${s3} ${s4} ${s5}`;
  }

  // 5. General / Public Infrastructure Defects
  const s1 = `Photographic evidence submitted reveals a noticeable civic infrastructure defect requiring municipal maintenance attention.`;
  const s2 = `Visual inspection identifies localized physical degradation and material wear affecting public utility assets in the area.`;
  const s3 = `The condition exhibits a ${severity.toLowerCase()}-severity civic concern with observable physical compromise that diminishes public asset reliability.`;
  const s4 = `While physical wear is directly verified in the uploaded photograph, inferred consequences include gradual structural decline and service interruption for neighborhood residents if neglected.`;
  const s5 = `A focused field assessment and remedial maintenance by ${departmentName} are necessary to restore normal operating standards and ensure citizen safety.`;
  return `${s1} ${s2} ${s3} ${s4} ${s5}`;
}

/**
 * Analyzes complaint photo using the local Python AI microservice.
 * Completely free of Gemini dependencies.
 */
async function analyzeComplaintPhoto(fileInput, options = {}) {
  let fileBuffer = null;
  let mimeType = 'image/jpeg';
  let originalName = 'uploaded-photo.jpg';

  if (Buffer.isBuffer(fileInput)) {
    fileBuffer = fileInput;
  } else if (fileInput && typeof fileInput === 'object') {
    if (Buffer.isBuffer(fileInput.buffer)) {
      fileBuffer = fileInput.buffer;
    } else if (fileInput.path && fs.existsSync(fileInput.path)) {
      fileBuffer = fs.readFileSync(fileInput.path);
    }
    if (fileInput.mimetype) mimeType = fileInput.mimetype;
    if (fileInput.originalname) {
      originalName = fileInput.originalname;
      const ext = path.extname(originalName).toLowerCase();
      if (ext === '.avif') mimeType = 'image/avif';
      else if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
    }
  } else if (typeof fileInput === 'string') {
    if (!fs.existsSync(fileInput)) {
      const errObj = new Error(`Image file not found at ${fileInput}`);
      errObj.statusCode = 400;
      errObj.errorCode = 'INVALID_IMAGE';
      throw errObj;
    }
    fileBuffer = fs.readFileSync(fileInput);
    const ext = path.extname(fileInput).toLowerCase();
    if (ext === '.png') mimeType = 'image/png';
    if (ext === '.webp') mimeType = 'image/webp';
    if (ext === '.avif') mimeType = 'image/avif';
    originalName = path.basename(fileInput);
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    const errObj = new Error('Uploaded photo payload is empty (0 bytes).');
    errObj.statusCode = 400;
    errObj.errorCode = 'INVALID_IMAGE';
    throw errObj;
  }

  const imageHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const analysisId = crypto.randomUUID();

  try {
    const pythonResult = await callLocalAiService(fileBuffer, mimeType, originalName, options.domain);
    const roadCondition = pythonResult.road_condition || null;
    const aiStatus = pythonResult.ai_status || pythonResult.aiStatus || 'manual_review';
    const isPipeDomain = Boolean(options.domain && ['pipe', 'water', 'leak', 'leakage'].includes(options.domain.toLowerCase()));
    const isDrainDomain = Boolean(options.domain && ['drain', 'drainage', 'sewage', 'gutter'].includes(options.domain.toLowerCase()));
    const isCleanRoad = (roadCondition === 'clean' || aiStatus === 'confirmed_clean') && !isPipeDomain && !isDrainDomain;
    const isUncertainRoad = roadCondition === 'uncertain' && !isPipeDomain && !isDrainDomain;
    const isNormalDrain = (pythonResult.drain_condition === 'normal' || (isDrainDomain && (pythonResult.condition === 'normal' || aiStatus === 'confirmed_normal')));
    const isNormalPipe = (pythonResult.pipe_condition === 'normal' || (isPipeDomain && (pythonResult.condition === 'normal' || aiStatus === 'confirmed_normal')));
    const isUncertainPipe = (pythonResult.pipe_condition === 'uncertain' || (isPipeDomain && !pythonResult.detected && (aiStatus === 'manual_review' || roadCondition === 'uncertain') && !pythonResult.complaint));
    const hasValidComplaint = Boolean(pythonResult.detected || pythonResult.complaint || (pythonResult.detections && pythonResult.detections.length > 0));

    if (isNormalDrain) {
      // CASE: NORMAL DRAIN - Clean, functional drainage, confirmed normal
      const confidence = Number(pythonResult.confidence || 0.95);
      const normDesc = pythonResult.explanation?.reason || 'The uploaded image shows normal, functional drainage with no visible blockage, damage, or overflow.';

      return {
        success: true,
        analysis_domain: options.domain || 'drainage',
        condition: 'normal',
        drain_condition: 'normal',
        detected: false,
        detected_class: null,
        confidence: confidence,
        confidence_level: 'HIGH',
        ai_status: 'confirmed_normal',
        aiStatus: 'confirmed_normal',
        review_required: false,
        reviewRequired: false,
        category: null,
        issue_type: null,
        title: null,
        description: normDesc,
        severity: 'None',
        priority: 'None',
        department: null,
        recommended_department: null,
        department_code: null,
        departmentCode: null,
        department_id: null,
        model: pythonResult.model || 'drainage_model.pt',
        ai_model: pythonResult.model || 'drainage_model.pt',
        ai_confidence: confidence,
        ai_detected_class: null,
        ai_reason: normDesc,
        analysis_id: analysisId,
        image_hash: imageHash,
        primaryDetection: null,
        detections: [],
        analysis: pythonResult.analysis || {
          visualImpactScore: 0.0,
          detectionCount: 0,
          hasMultipleDetections: false,
          allDetections: []
        },
        complaint: null,
        explanation: {
          detectedIssue: 'Normal Drainage',
          confidence: confidence,
          confidenceLevel: 'HIGH',
          visualImpact: 0.0,
          reason: normDesc
        },
        transparencyNotice: 'Drainage condition verified: Normal — no complaint required.',
        message: '✓ DRAINAGE CONDITION: NORMAL',
        drain_analysis: pythonResult.drain_analysis,
        risk: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0,
          risk_score: 0,
          severity: 'None'
        },
        risk_quadrants: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0
        },
        human_safety: 0,
        public_disruption: 0,
        health_environment: 0,
        physical_severity: 0,
        risk_score: 0,
        detected_features: [],
        needs_manual_verification: false
      };
    } else if (isNormalPipe) {
      // CASE: PERFECT / NORMAL PIPE - No leakage or damage, confirmed normal pipe
      const confidence = Number(pythonResult.confidence || 0.95);
      const normDesc = 'The uploaded image shows a normal pipe with no visible leakage or significant damage.';

      return {
        success: true,
        analysis_domain: options.domain || 'pipe',
        condition: 'normal',
        pipe_condition: 'normal',
        detected: false,
        detected_class: null,
        confidence: confidence,
        confidence_level: 'HIGH',
        ai_status: 'confirmed_normal',
        aiStatus: 'confirmed_normal',
        review_required: false,
        reviewRequired: false,
        category: null,
        issue_type: null,
        title: null,
        description: normDesc,
        severity: 'None',
        priority: 'None',
        department: null,
        recommended_department: null,
        department_code: null,
        departmentCode: null,
        department_id: null,
        model: pythonResult.model || 'water_pipe_model.pt',
        ai_model: pythonResult.model || 'water_pipe_model.pt',
        ai_confidence: confidence,
        ai_detected_class: null,
        ai_reason: normDesc,
        analysis_id: analysisId,
        image_hash: imageHash,
        primaryDetection: null,
        detections: [],
        analysis: pythonResult.analysis || {
          visualImpactScore: 0.0,
          detectionCount: 0,
          hasMultipleDetections: false,
          allDetections: []
        },
        complaint: null,
        explanation: {
          detectedIssue: 'Normal Pipe',
          confidence: confidence,
          confidenceLevel: 'HIGH',
          visualImpact: 0.0,
          reason: normDesc
        },
        transparencyNotice: 'Pipe condition verified: Normal — no complaint required.',
        message: '✓ PIPE CONDITION: NORMAL',
        pipe_analysis: pythonResult.pipe_analysis,
        risk: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0,
          risk_score: 0,
          severity: 'None'
        },
        risk_quadrants: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0
        },
        human_safety: 0,
        public_disruption: 0,
        health_environment: 0,
        physical_severity: 0,
        risk_score: 0,
        detected_features: [],
        needs_manual_verification: false
      };
    } else if (isCleanRoad) {
      // CASE 2: CLEAN / NORMAL ROAD - No pothole detected, confirmed clean road
      const confidence = Number(pythonResult.confidence || 0.92);
      const cleanDesc = 'The uploaded road image shows no visible pothole or significant road defect.';

      return {
        success: true,
        analysis_domain: options.domain || 'road',
        road_condition: 'clean',
        detected: false,
        detected_class: null,
        confidence: confidence,
        confidence_level: 'HIGH',
        ai_status: 'confirmed_clean',
        aiStatus: 'confirmed_clean',
        review_required: false,
        reviewRequired: false,
        category: 'Road Condition',
        issue_type: 'No Road Defect',
        title: 'No Road Defect',
        description: cleanDesc,
        severity: 'None',
        priority: 'None',
        department: null,
        recommended_department: null,
        department_code: null,
        departmentCode: null,
        department_id: null,
        model: pythonResult.model || 'road_condition_analyzer',
        ai_model: pythonResult.model || 'road_condition_analyzer',
        ai_confidence: confidence,
        ai_detected_class: null,
        ai_reason: cleanDesc,
        analysis_id: analysisId,
        image_hash: imageHash,
        primaryDetection: null,
        detections: [],
        analysis: pythonResult.analysis || {
          visualImpactScore: 0.0,
          detectionCount: 0,
          hasMultipleDetections: false,
          allDetections: []
        },
        complaint: null,
        explanation: {
          detectedIssue: 'Clean Road',
          confidence: confidence,
          confidenceLevel: 'HIGH',
          visualImpact: 0.0,
          reason: cleanDesc
        },
        transparencyNotice: 'Road condition verified: Clean — no complaint required.',
        message: '✓ Road appears clean. No pothole or visible road defect was detected.',
        road_analysis: pythonResult.road_analysis,
        risk: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0,
          risk_score: 0,
          severity: 'None'
        },
        risk_quadrants: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0
        },
        human_safety: 0,
        public_disruption: 0,
        health_environment: 0,
        physical_severity: 0,
        risk_score: 0,
        detected_features: [],
        needs_manual_verification: false
      };
    } else if (isUncertainPipe) {
      // CASE: AMBIGUOUS / UNCERTAIN PIPE IMAGE - Manual review with pipe-specific wording
      const uncMsg = pythonResult.explanation?.reason || pythonResult.message || 'Pipe condition could not be verified confidently. Please verify details manually or upload a clearer pipe image.';
      const conf = Number(pythonResult.confidence || 0.0);

      return {
        success: true,
        analysis_domain: options.domain || 'pipe',
        condition: 'uncertain',
        pipe_condition: 'uncertain',
        road_condition: 'non_road',
        detected: false,
        detected_class: null,
        confidence: conf,
        confidence_level: 'LOW',
        ai_status: 'manual_review',
        aiStatus: 'manual_review',
        review_required: true,
        reviewRequired: true,
        category: 'Water',
        issue_type: 'Pipe Condition Needs Review',
        title: 'Pipe Condition Needs Review',
        description: uncMsg,
        severity: 'Medium',
        priority: 'Medium',
        department: 'Water Supply & Sewerage Board',
        recommended_department: 'Water Supply & Sewerage Board',
        department_code: 'WTR',
        departmentCode: 'WTR',
        department_id: CANONICAL_DEPT_IDS['WTR'] || 3,
        model: pythonResult.model || 'water_pipe_model.pt',
        ai_model: pythonResult.model || 'water_pipe_model.pt',
        ai_confidence: conf,
        ai_detected_class: null,
        ai_reason: uncMsg,
        analysis_id: analysisId,
        image_hash: imageHash,
        primaryDetection: null,
        detections: [],
        analysis: pythonResult.analysis || {
          visualImpactScore: 0.0,
          detectionCount: 0,
          hasMultipleDetections: false,
          allDetections: []
        },
        complaint: null,
        explanation: {
          detectedIssue: 'Pipe Review Required',
          confidence: conf,
          confidenceLevel: 'LOW',
          visualImpact: 0.0,
          reason: uncMsg
        },
        transparencyNotice: '⚠ Pipe condition could not be verified confidently. Please verify details manually.',
        message: uncMsg,
        risk: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0,
          risk_score: 0,
          severity: 'None'
        },
        risk_quadrants: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0
        },
        human_safety: 0,
        public_disruption: 0,
        health_environment: 0,
        physical_severity: 0,
        risk_score: 0,
        detected_features: [],
        needs_manual_verification: true
      };
    } else if (isUncertainRoad) {
      // CASE 3: UNCERTAIN ROAD - Blurry, low contrast, or ambiguous road condition
      const uncMsg = 'Road condition could not be verified confidently. Please upload a clearer road image.';

      return {
        success: true,
        analysis_domain: options.domain || 'road',
        road_condition: 'uncertain',
        detected: false,
        detected_class: null,
        confidence: 0.0,
        confidence_level: 'LOW',
        ai_status: 'manual_review',
        aiStatus: 'manual_review',
        review_required: true,
        reviewRequired: true,
        category: 'Road Condition',
        issue_type: 'Uncertain Road Condition',
        title: 'Uncertain Road Condition',
        description: uncMsg,
        severity: 'None',
        priority: 'None',
        department: null,
        recommended_department: null,
        department_code: null,
        departmentCode: null,
        department_id: null,
        model: pythonResult.model || 'road_condition_analyzer',
        ai_model: pythonResult.model || 'road_condition_analyzer',
        ai_confidence: 0.0,
        ai_detected_class: null,
        ai_reason: uncMsg,
        analysis_id: analysisId,
        image_hash: imageHash,
        primaryDetection: null,
        detections: [],
        analysis: pythonResult.analysis || {
          visualImpactScore: 0.0,
          detectionCount: 0,
          hasMultipleDetections: false,
          allDetections: []
        },
        complaint: null,
        explanation: {
          detectedIssue: 'Uncertain Road',
          confidence: 0.0,
          confidenceLevel: 'LOW',
          visualImpact: 0.0,
          reason: uncMsg
        },
        transparencyNotice: '⚠ Road condition could not be verified confidently.',
        message: uncMsg,
        road_analysis: pythonResult.road_analysis,
        risk: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0,
          risk_score: 0,
          severity: 'None'
        },
        risk_quadrants: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0
        },
        human_safety: 0,
        public_disruption: 0,
        health_environment: 0,
        physical_severity: 0,
        risk_score: 0,
        detected_features: [],
        needs_manual_verification: true
      };
    } else if (hasValidComplaint && pythonResult.complaint) {
      // CASE 1: REAL DEFECT DETECTED (Pothole -> PWD, Waste -> SAN)
      const comp = pythonResult.complaint;
      const deptCode = comp.departmentCode || 'PWD';
      const deptId = comp.departmentId || CANONICAL_DEPT_IDS[deptCode] || 1;
      const confidence = Number(comp.confidenceScore || pythonResult.confidence || 0.85);
      const isRoadDefect = (comp.category === 'Roads' || pythonResult.primaryDetection?.class === 'Pothole');

      const risk = pythonResult.risk || {
        human_safety: 2,
        public_disruption: 2,
        health_environment: 0,
        physical_severity: 2,
        risk_score: 6,
        severity: comp.severity || 'High'
      };

      const explanation = pythonResult.explanation || {
        detectedIssue: pythonResult.primaryDetection?.class || comp.issueType,
        confidence: confidence,
        confidenceLevel: pythonResult.primaryDetection?.confidenceLevel || (confidence >= 0.75 ? 'HIGH' : 'MEDIUM'),
        reason: comp.reason || 'Civic defect identified by local vision agent.'
      };

      const professionalDesc = generateProfessionalCivicDescription({
        category: comp.category,
        issueType: comp.issueType,
        detected_class: pythonResult.primaryDetection?.class || comp.issueType,
        severity: comp.severity,
        departmentName: comp.departmentName,
        confidence: confidence,
        detectionCount: (pythonResult.detections || []).length,
        visualImpactScore: pythonResult.primaryDetection?.bbox_area_ratio || 0.0,
        detections: pythonResult.detections || []
      });
      comp.description = professionalDesc;

      return {
        success: true,
        analysis_domain: options.domain || pythonResult.domain || (comp.category === 'Water Supply' ? 'pipe' : comp.category === 'Drainage' ? 'drainage' : comp.category === 'Sanitation' ? 'waste' : 'road'),
        road_condition: isRoadDefect ? 'defective' : (roadCondition || 'non_road'),
        detected: true,
        detected_class: pythonResult.primaryDetection?.class || comp.issueType,
        aiStatus: pythonResult.aiStatus,
        ai_status: pythonResult.ai_status || pythonResult.aiStatus,
        analysis_id: analysisId,
        image_hash: imageHash,
        model: pythonResult.model || 'civicmodel.pt',
        category: comp.category,
        issue_type: comp.issueType,
        title: comp.issueType,
        description: professionalDesc,
        priority: comp.priority,
        severity: comp.severity,
        department: comp.departmentName,
        recommended_department: comp.departmentName,
        department_code: deptCode,
        departmentCode: deptCode,
        department_id: deptId,
        confidence: confidence,
        confidence_level: explanation.confidenceLevel,
        primaryDetection: pythonResult.primaryDetection,
        detections: pythonResult.detections || [],
        analysis: pythonResult.analysis || {
          visualImpactScore: pythonResult.primaryDetection?.bbox_area_ratio || 0.0,
          detectionCount: (pythonResult.detections || []).length,
          hasMultipleDetections: (pythonResult.detections || []).length > 1,
          allDetections: pythonResult.detections || []
        },
        complaint: comp,
        explanation: explanation,
        reviewRequired: Boolean(pythonResult.reviewRequired),
        review_required: Boolean(pythonResult.reviewRequired),
        transparencyNotice: pythonResult.transparencyNotice || (pythonResult.aiStatus === 'confirmed' ? 'AI-generated — please review before submitting.' : 'AI suggestion — please verify.'),
        ai_model: pythonResult.model || 'civicmodel.pt',
        ai_confidence: confidence,
        ai_detected_class: pythonResult.primaryDetection?.class || null,
        ai_reason: explanation.reason,
        road_analysis: pythonResult.road_analysis,
        risk: risk,
        risk_quadrants: {
          human_safety: risk.human_safety || 0,
          public_disruption: risk.public_disruption || 0,
          health_environment: risk.health_environment || 0,
          physical_severity: risk.physical_severity || 0
        },
        human_safety: risk.human_safety || 0,
        public_disruption: risk.public_disruption || 0,
        health_environment: risk.health_environment || 0,
        physical_severity: risk.physical_severity || 0,
        risk_score: risk.risk_score || 0,
        detected_features: (pythonResult.detections || []).map(d => d.class),
        needs_manual_verification: Boolean(pythonResult.reviewRequired)
      };
    } else {
      // Unconfirmed or below confidence threshold -> allow citizen manual entry
      const message = pythonResult.message || 'Unable to identify a verified civic issue in the uploaded photo.';
      const explanation = pythonResult.explanation || {
        detectedIssue: 'None',
        confidence: Number(pythonResult.confidence || 0.0),
        confidenceLevel: 'LOW',
        reason: 'AI could not confidently identify this issue. Routed for manual citizen review.'
      };

      return {
        success: true,
        analysis_domain: options.domain || null,
        road_condition: roadCondition || 'uncertain',
        detected: false,
        detected_class: null,
        aiStatus: pythonResult.aiStatus || 'manual_review',
        ai_status: pythonResult.ai_status || pythonResult.aiStatus || 'manual_review',
        analysis_id: analysisId,
        image_hash: imageHash,
        model: pythonResult.model || 'none',
        category: 'Other Civic Issue',
        issue_type: 'Manual Entry Required',
        title: 'Manual Entry Required',
        description: 'Unable to confidently identify the civic issue. Please select details manually.',
        priority: 'Medium',
        severity: 'LOW',
        department: null,
        recommended_department: null,
        department_code: null,
        departmentCode: null,
        department_id: null,
        confidence: Number(pythonResult.confidence || 0.0),
        confidence_level: 'LOW',
        primaryDetection: pythonResult.primaryDetection || null,
        detections: pythonResult.detections || [],
        analysis: pythonResult.analysis || {
          visualImpactScore: 0.0,
          detectionCount: 0,
          hasMultipleDetections: false,
          allDetections: []
        },
        complaint: null,
        explanation: explanation,
        reviewRequired: true,
        review_required: true,
        transparencyNotice: pythonResult.transparencyNotice || 'AI could not confidently identify this issue.',
        ai_model: pythonResult.model || 'none',
        ai_confidence: Number(pythonResult.confidence || 0.0),
        ai_detected_class: pythonResult.primaryDetection?.class || null,
        ai_reason: explanation.reason,
        road_analysis: pythonResult.road_analysis,
        message: message,
        risk: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0,
          risk_score: 0,
          severity: 'Low'
        },
        risk_quadrants: {
          human_safety: 0,
          public_disruption: 0,
          health_environment: 0,
          physical_severity: 0
        },
        human_safety: 0,
        public_disruption: 0,
        health_environment: 0,
        physical_severity: 0,
        risk_score: 0,
        detected_features: [],
        needs_manual_verification: true
      };
    }
  } catch (err) {
    console.warn(`[NAGARSETU AI] Local AI microservice unavailable: ${err.message}. Providing manual review fallback.`);
    const isPipe = Boolean(options.domain && ['pipe', 'water', 'leak', 'leakage'].includes(options.domain.toLowerCase()));
    const isDrain = Boolean(options.domain && ['drain', 'drainage', 'sewage', 'gutter'].includes(options.domain.toLowerCase()));
    const isWaste = Boolean(options.domain && ['waste', 'garbage', 'sanitation', 'trash'].includes(options.domain.toLowerCase()));

    let fallbackCat = 'Other Civic Issue';
    let fallbackDept = null;
    let fallbackCode = null;
    let fallbackId = null;

    if (isPipe) {
      fallbackCat = 'Water';
      fallbackDept = 'Water Supply & Sewerage Board';
      fallbackCode = 'WTR';
      fallbackId = CANONICAL_DEPT_IDS['WTR'] || 3;
    } else if (isDrain) {
      fallbackCat = 'Drainage';
      fallbackDept = 'Drainage & Sewage Department';
      fallbackCode = 'DRN';
      fallbackId = CANONICAL_DEPT_IDS['DRN'] || 7;
    } else if (isWaste) {
      fallbackCat = 'Sanitation';
      fallbackDept = 'Sanitation & Waste Management';
      fallbackCode = 'SAN';
      fallbackId = CANONICAL_DEPT_IDS['SAN'] || 2;
    } else if (options.domain && ['road', 'roads'].includes(options.domain.toLowerCase())) {
      fallbackCat = 'Roads';
      fallbackDept = 'Public Works Department';
      fallbackCode = 'PWD';
      fallbackId = 1;
    }

    return {
      success: true,
      ai_available: false,
      detected: false,
      aiStatus: 'manual_review',
      ai_status: 'manual_review',
      review_required: true,
      reviewRequired: true,
      analysis_id: analysisId,
      image_hash: imageHash,
      model: 'manual_fallback',
      category: fallbackCat,
      title: 'AI Analysis Unavailable',
      description: 'AI analysis unavailable. Please enter complaint details manually.',
      priority: 'Medium',
      severity: 'LOW',
      department: fallbackDept,
      recommended_department: fallbackDept,
      department_code: fallbackCode,
      departmentCode: fallbackCode,
      department_id: fallbackId,
      confidence: 0.0,
      primaryDetection: null,
      detections: [],
      complaint: null,
      message: 'AI analysis unavailable. Please enter complaint details manually.',
      risk: {
        human_safety: 1,
        public_disruption: 1,
        health_environment: 0,
        physical_severity: 1,
        risk_score: 3,
        severity: 'Medium'
      },
      risk_quadrants: {
        human_safety: 1,
        public_disruption: 1,
        health_environment: 0,
        physical_severity: 1
      },
      human_safety: 1,
      public_disruption: 1,
      health_environment: 0,
      physical_severity: 1,
      risk_score: 3,
      detected_features: [],
      needs_manual_verification: true
    };
  }
}

const SAME_ISSUE_CONFIDENCE_THRESHOLD = 85;

function computeImageHash(fileInput) {
  try {
    let buf = null;
    if (Buffer.isBuffer(fileInput)) {
      buf = fileInput;
    } else if (fileInput && typeof fileInput === 'object' && Buffer.isBuffer(fileInput.buffer)) {
      buf = fileInput.buffer;
    } else if (typeof fileInput === 'string') {
      if (fileInput.startsWith('data:image')) {
        const base64Data = fileInput.split(',')[1];
        if (base64Data) buf = Buffer.from(base64Data, 'base64');
      } else if (fs.existsSync(fileInput)) {
        buf = fs.readFileSync(fileInput);
      } else if (fileInput.trim() !== '') {
        buf = Buffer.from(fileInput.trim());
      }
    }
    if (buf && buf.length > 0) {
      return crypto.createHash('sha256').update(buf).digest('hex');
    }
  } catch (e) {}
  return '';
}

async function compareImagesForSamePhysicalIssue(img1, img2, options = {}) {
  if (options.simulatedVisualMatch) {
    return {
      same_physical_issue: Boolean(options.simulatedVisualMatch.same_physical_issue),
      confidence: Number(options.simulatedVisualMatch.confidence || 0),
      match_type: 'visual',
      reason: options.simulatedVisualMatch.reason || 'Visual feature match'
    };
  }

  const hash1 = computeImageHash(img1);
  const hash2 = computeImageHash(img2);
  if (hash1 && hash2 && hash1 === hash2) {
    return {
      same_physical_issue: true,
      confidence: 100,
      match_type: 'exact',
      reason: 'Exact image binary hash match (SHA-256)'
    };
  }

  return {
    same_physical_issue: false,
    confidence: 0,
    match_type: 'visual',
    reason: 'Distinct images'
  };
}

const CANONICAL_DOMAINS = {
  water: {
    id: 'Water',
    label: 'Water Supply',
    aliases: ['water', 'water supply', 'water supply & sewerage board', 'pipe', 'pipeline', 'wtr', 'water leakage', 'broken water pipe'],
    defectKeywords: ['pipe', 'leak', 'leakage', 'burst', 'water_leakage', 'broken_pipe', 'rupture', 'conduit']
  },
  roads: {
    id: 'Roads',
    label: 'Roads & Works',
    aliases: ['roads', 'roads & works', 'road', 'pwd', 'public works', 'public works department', 'pothole', 'road damage'],
    defectKeywords: ['pothole', 'asphalt', 'crater', 'road_damage', 'pavement', 'crack']
  },
  drainage: {
    id: 'Drainage',
    label: 'Drainage',
    aliases: ['drainage', 'drainage & sewage department', 'drainage & sewage', 'drain', 'sewer', 'gutter', 'drn', 'flooding'],
    defectKeywords: ['drain', 'clog', 'gutter', 'sewer', 'blocked_drain', 'damaged_drain', 'overflow', 'overflowing_drain', 'culvert']
  },
  sanitation: {
    id: 'Sanitation',
    label: 'Sanitation',
    aliases: ['sanitation', 'sanitation & waste management', 'sanitation & waste', 'garbage', 'waste', 'san', 'trash', 'litter', 'dump'],
    defectKeywords: ['garbage', 'waste', 'trash', 'refuse', 'litter', 'debris', 'dump', 'bio_waste']
  }
};

function normalizeCivicCategoryKey(cat) {
  if (!cat) return null;
  const s = String(cat).trim().toLowerCase();
  for (const [key, info] of Object.entries(CANONICAL_DOMAINS)) {
    if (info.id.toLowerCase() === s || info.label.toLowerCase() === s) return info.id;
    if (info.aliases.some(a => s.includes(a) || a.includes(s))) return info.id;
  }
  return null;
}

function detectCivicDomainFromAnalysis(aiResult) {
  if (!aiResult) return null;
  const cat = String(aiResult.category || '').toLowerCase();
  const rawClass = String(aiResult.detected_class || aiResult.ai_detected_class || aiResult.primaryDetection?.class || '').toLowerCase();
  const issue = String(aiResult.issue_type || aiResult.title || '').toLowerCase();
  const domain = String(aiResult.analysis_domain || aiResult.domain || '').toLowerCase();

  for (const [key, info] of Object.entries(CANONICAL_DOMAINS)) {
    if (info.defectKeywords.some(kw => rawClass.includes(kw) || issue.includes(kw))) {
      return info.id;
    }
  }

  if (aiResult.pipe_condition === 'damaged' || aiResult.pipe_condition === 'uncertain') return 'Water';
  if (aiResult.drain_condition === 'damaged' || aiResult.drain_condition === 'blocked') return 'Drainage';
  if (aiResult.road_condition === 'defective') return 'Roads';

  for (const [key, info] of Object.entries(CANONICAL_DOMAINS)) {
    if (info.aliases.some(a => cat.includes(a))) {
      return info.id;
    }
  }

  if (domain === 'pipe' || domain === 'water') return 'Water';
  if (domain === 'road' || domain === 'roads') return 'Roads';
  if (domain === 'drainage' || domain === 'drain') return 'Drainage';
  if (domain === 'waste' || domain === 'sanitation') return 'Sanitation';

  return null;
}

function validateCategoryMatch(selectedCategory, aiResult) {
  const normSelected = normalizeCivicCategoryKey(selectedCategory);
  if (!normSelected) {
    return {
      outcome: 'UNCERTAIN',
      message: 'Category validation requires manual verification.'
    };
  }

  if (!aiResult) {
    return {
      outcome: 'UNCERTAIN',
      selectedCategory: normSelected,
      message: 'AI validation could not be completed. You may proceed with manual verification.'
    };
  }

  const confidence = Number(aiResult.confidence || 0);
  const detected = Boolean(aiResult.detected);
  const detectedDomain = detectCivicDomainFromAnalysis(aiResult);
  const isCleanRoad = aiResult.road_condition === 'clean' || aiResult.aiStatus === 'confirmed_clean';

  // Outcome 1: SUPPORTED — Reliable image evidence matches the selected category.
  if (detected && detectedDomain === normSelected && confidence >= 0.40) {
    return {
      outcome: 'SUPPORTED',
      selectedCategory: normSelected,
      detectedCategory: detectedDomain,
      confidence,
      message: `Image evidence reliably matches the selected issue category (${CANONICAL_DOMAINS[normSelected.toLowerCase()]?.label || normSelected}).`
    };
  }

  // Outcome 2: UNSUPPORTED — Reliable image evidence identifies a different issue category or clearly unrelated content.
  if (detected && detectedDomain && detectedDomain !== normSelected && confidence >= 0.50) {
    const suggestedLabel = CANONICAL_DOMAINS[detectedDomain.toLowerCase()]?.label || detectedDomain;
    return {
      outcome: 'UNSUPPORTED',
      selectedCategory: normSelected,
      detectedCategory: detectedDomain,
      suggestedCategory: suggestedLabel,
      confidence,
      message: 'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.'
    };
  }

  if (isCleanRoad && normSelected !== 'Roads' && confidence >= 0.70) {
    return {
      outcome: 'UNSUPPORTED',
      selectedCategory: normSelected,
      detectedCategory: 'Roads',
      suggestedCategory: 'Roads & Works',
      confidence,
      message: 'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.'
    };
  }

  // Outcome 3: UNCERTAIN — AI cannot reliably identify the issue. Do not falsely classify as unsupported.
  return {
    outcome: 'UNCERTAIN',
    selectedCategory: normSelected,
    detectedCategory: detectedDomain || null,
    confidence,
    message: 'The AI cannot reliably identify the issue. You may retake the photo, upload a clearer view, or proceed with manual verification.'
  };
}

module.exports = {
  analyzeComplaintPhoto,
  computeImageHash,
  compareImagesForSamePhysicalIssue,
  SAME_ISSUE_CONFIDENCE_THRESHOLD,
  getCurrentModel,
  ALLOWED_CATEGORIES,
  CATEGORY_DEPARTMENT_MAP,
  normalizeCategory,
  normalizePriority,
  generateProfessionalCivicDescription,
  validateCategoryMatch,
  normalizeCivicCategoryKey,
  detectCivicDomainFromAnalysis,
  CANONICAL_DOMAINS
};
