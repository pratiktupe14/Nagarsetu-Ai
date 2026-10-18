const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { upload } = require('../middleware/upload');
const { analyzeComplaintPhoto, getCurrentModel } = require('../services/aiService');
const { authenticateToken } = require('../middleware/auth');

/**
 * Local AI Health Check Endpoint
 * GET /api/ai/health
 */
router.get('/health', async (req, res) => {
  const raw = (process.env.PYTHON_AI_URL || process.env.AI_SERVICE_URL || 'http://localhost:8000/analyze').trim().replace(/\/+$/, '');
  const baseUrl = raw.endsWith('/analyze') ? raw.slice(0, -'/analyze'.length) : raw;
  const baseHealthUrl = `${baseUrl}/health`;

  let localAiReachable = false;
  let modelsLoaded = { civicmodel: false, wasteModel: false };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const headers = {};
    const apiKey = process.env.AI_INTERNAL_API_KEY || process.env.AI_SERVICE_API_KEY || process.env.INTERNAL_AI_SECRET || process.env.AI_SECRET_KEY;
    if (apiKey) {
      headers['X-Internal-API-Key'] = apiKey;
    }
    const healthRes = await fetch(baseHealthUrl, { signal: controller.signal, headers });
    clearTimeout(timeoutId);

    if (healthRes.ok) {
      const data = await healthRes.json();
      localAiReachable = true;
      if (data.models) modelsLoaded = data.models;
    }
  } catch (e) {
    localAiReachable = false;
  }

  return res.status(200).json({
    status: 'ok',
    aiConfigured: true,
    configured: true,
    reachable: localAiReachable,
    ai: 'local',
    framework: 'ultralytics',
    workflow: 'langgraph',
    models: modelsLoaded,
    model: getCurrentModel(),
    gemini: false
  });
});

/**
 * Common handler for multipart photo analysis
 */
async function handlePhotoAnalysis(req, res) {
  const reqTime = new Date().toISOString();
  console.log(`[${reqTime}] [NAGARSETU Local AI] Request received: ${req.method} ${req.originalUrl}`);

  try {
    if (!req.file || (!req.file.buffer && !req.file.path)) {
      console.error(`[${reqTime}] [NAGARSETU Local AI] Error: No photo file provided.`);
      return res.status(400).json({
        success: false,
        error: 'INVALID_IMAGE',
        message: 'No photo file provided in request. Expected multipart field "photo" or "image".'
      });
    }

    let buffer = req.file.buffer;
    if (!buffer && req.file.path && fs.existsSync(req.file.path)) {
      buffer = fs.readFileSync(req.file.path);
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_IMAGE',
        message: 'Uploaded photo file is empty (0 bytes).'
      });
    }

    const domain = req.body?.domain || null;

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    let fileMime = req.file.mimetype || 'image/jpeg';
    if (ext === '.avif') fileMime = 'image/avif';
    else if (ext === '.png') fileMime = 'image/png';
    else if (ext === '.webp') fileMime = 'image/webp';
    else if (ext === '.jpg' || ext === '.jpeg') fileMime = 'image/jpeg';

    // Call local AI Service via LangGraph + YOLOv8 pipeline
    const aiAnalysis = await analyzeComplaintPhoto({
      buffer,
      mimetype: fileMime,
      originalname: req.file.originalname || 'photo.jpg',
      size: buffer.length
    }, { domain });

    const photoUrl = req.file?.publicUrl || req.file?.supabaseUrl || (req.file?.filename ? `/uploads/${req.file.filename}` : undefined);
    if (photoUrl) {
      aiAnalysis.photo_url = photoUrl;
    }

    const riskObject = {
      human_safety: aiAnalysis.risk?.human_safety ?? aiAnalysis.human_safety ?? 0,
      public_disruption: aiAnalysis.risk?.public_disruption ?? aiAnalysis.public_disruption ?? 0,
      health_environment: aiAnalysis.risk?.health_environment ?? aiAnalysis.health_environment ?? 0,
      physical_severity: aiAnalysis.risk?.physical_severity ?? aiAnalysis.physical_severity ?? 0,
      risk_score: aiAnalysis.risk?.risk_score ?? aiAnalysis.risk_score ?? 0,
      severity: aiAnalysis.risk?.severity || aiAnalysis.severity || 'Medium'
    };

    return res.status(200).json({
      success: true,
      road_condition: aiAnalysis.road_condition || null,
      detected: aiAnalysis.detected,
      detected_class: aiAnalysis.detected_class || aiAnalysis.ai_detected_class || null,
      aiStatus: aiAnalysis.aiStatus,
      ai_status: aiAnalysis.ai_status || aiAnalysis.aiStatus,
      review_required: Boolean(aiAnalysis.review_required ?? aiAnalysis.reviewRequired ?? false),
      reviewRequired: Boolean(aiAnalysis.reviewRequired ?? aiAnalysis.review_required ?? false),
      model: aiAnalysis.model,
      analysis_domain: aiAnalysis.analysis_domain || domain || null,
      category: aiAnalysis.category,
      issue_type: aiAnalysis.issue_type || aiAnalysis.title,
      title: aiAnalysis.title,
      description: aiAnalysis.description,
      priority: aiAnalysis.priority,
      severity: aiAnalysis.severity,
      department: aiAnalysis.department || null,
      department_code: aiAnalysis.department_code || null,
      departmentCode: aiAnalysis.department_code || null,
      department_id: aiAnalysis.department_id || null,
      confidence: aiAnalysis.confidence,
      explanation: typeof aiAnalysis.explanation === 'string' ? aiAnalysis.explanation : (aiAnalysis.explanation?.reason || aiAnalysis.description),
      explanation_details: aiAnalysis.explanation,
      primaryDetection: aiAnalysis.primaryDetection,
      detections: aiAnalysis.detections || [],
      complaint: aiAnalysis.complaint,
      road_analysis: aiAnalysis.road_analysis,
      risk: riskObject,
      // Canonical AI metadata fields for complaint persistence & auditing:
      ai_model: aiAnalysis.ai_model || aiAnalysis.model || 'civicmodel.pt',
      ai_confidence: aiAnalysis.ai_confidence !== undefined ? aiAnalysis.ai_confidence : aiAnalysis.confidence,
      ai_detected_class: aiAnalysis.ai_detected_class || aiAnalysis.detected_class || null,
      ai_reason: aiAnalysis.ai_reason || (typeof aiAnalysis.explanation === 'string' ? aiAnalysis.explanation : aiAnalysis.explanation?.reason) || '',
      // Compatibility fields for client components:
      recommended_department: aiAnalysis.department || null,
      risk_quadrants: aiAnalysis.risk_quadrants || {
        human_safety: riskObject.human_safety,
        public_disruption: riskObject.public_disruption,
        health_environment: riskObject.health_environment,
        physical_severity: riskObject.physical_severity
      },
      human_safety: riskObject.human_safety,
      public_disruption: riskObject.public_disruption,
      health_environment: riskObject.health_environment,
      physical_severity: riskObject.physical_severity,
      risk_score: riskObject.risk_score,
      risk_assessment: aiAnalysis.risk_assessment,
      photo_url: photoUrl,
      ai: aiAnalysis,
      message: aiAnalysis.message
    });
  } catch (err) {
    console.error(`[${reqTime}] [NAGARSETU AI] Express analyze route error:`, err.message);
    const statusCode = err.statusCode || 500;
    const errorCode = err.errorCode || 'AI_PROCESSING_ERROR';
    return res.status(statusCode).json({
      success: false,
      error: errorCode,
      message: err.message || 'AI Vision analysis is temporarily unavailable.'
    });
  }
}

/**
 * Direct Image Vision Analysis Endpoint
 * POST /api/ai/analyze
 */
router.post('/analyze', (req, res, next) => {
  if (req.headers['authorization']) {
    return authenticateToken(req, res, next);
  }
  next();
}, (req, res, next) => {
  // Support both 'photo' and 'image' multipart field names
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'image', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      if (err.name === 'MulterError') {
        return res.status(400).json({
          success: false,
          error: 'INVALID_IMAGE',
          message: `Multer upload error: ${err.message}. Expected multipart field "photo" or "image".`
        });
      }
      return next(err);
    }
    // Normalize file reference to req.file
    req.file = req.files?.photo?.[0] || req.files?.image?.[0] || null;
    next();
  });
}, handlePhotoAnalysis);

/**
 * Alias endpoint for Section 7:
 * POST /api/ai/analyze-complaint-image
 */
router.post('/analyze-complaint-image', (req, res, next) => {
  if (req.headers['authorization']) {
    return authenticateToken(req, res, next);
  }
  next();
}, (req, res, next) => {
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'image', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_IMAGE',
        message: `Upload error: ${err.message}`
      });
    }
    req.file = req.files?.photo?.[0] || req.files?.image?.[0] || null;
    next();
  });
}, handlePhotoAnalysis);

module.exports = router;
