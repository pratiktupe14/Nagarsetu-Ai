const express = require('express');
const router = express.Router();
const http = require('http');
const validateInput = require('../middleware/validateInput');
const {
  geocodeSchema,
  reverseGeocodeSchema,
  directionsSchema,
  validateLocationSchema
} = require('../schemas/maps.schemas');

function getAiBaseUrl() {
  const raw = (process.env.AI_SERVICE_URL || process.env.PYTHON_AI_URL || 'http://localhost:8000').trim();
  return raw.replace(/\/analyze\/?$/, '').replace(/\/+$/, '');
}

async function postToPythonService(endpoint, body) {
  try {
    const baseUrl = getAiBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${baseUrl}${cleanEndpoint}`;

    const headers = { 'Content-Type': 'application/json' };
    const apiKey = process.env.AI_INTERNAL_API_KEY || process.env.AI_SERVICE_API_KEY || process.env.INTERNAL_AI_SECRET || process.env.AI_SECRET_KEY;
    if (apiKey) {
      headers['X-Internal-API-Key'] = apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[MAPS SERVICE ERROR] Python service returned status ${res.status}:`, errText);
      return { status: 'ERROR', message: 'Unable to process map request at this time.' };
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[MAPS SERVICE TIMEOUT] Request timed out after 5s');
      return { status: 'TIMEOUT', message: 'Google Maps service request timed out.' };
    }
    console.error('[MAPS SERVICE EXCEPTION]:', err.message);
    return { status: 'SERVICE_UNAVAILABLE', message: 'Maps service is currently unavailable.' };
  }
}

// POST /api/maps/geocode
router.post('/geocode', validateInput(geocodeSchema), async (req, res) => {
  const { address } = req.body;
  const result = await postToPythonService('/google-maps/geocode', { address });
  return res.json(result);
});

// POST /api/maps/reverse-geocode
router.post('/reverse-geocode', validateInput(reverseGeocodeSchema), async (req, res) => {
  const { latitude, longitude } = req.body;
  const result = await postToPythonService('/google-maps/reverse-geocode', {
    latitude: Number(latitude),
    longitude: Number(longitude)
  });
  return res.json(result);
});

// POST /api/maps/directions
router.post('/directions', validateInput(directionsSchema), async (req, res) => {
  const { origin_latitude, origin_longitude, destination_latitude, destination_longitude, mode } = req.body;
  const result = await postToPythonService('/google-maps/directions', {
    origin_latitude: Number(origin_latitude),
    origin_longitude: Number(origin_longitude),
    destination_latitude: Number(destination_latitude),
    destination_longitude: Number(destination_longitude),
    mode: mode || 'driving'
  });
  return res.json(result);
});

// POST /api/maps/validate
router.post('/validate', validateInput(validateLocationSchema), async (req, res) => {
  const { latitude, longitude } = req.body;
  const result = await postToPythonService('/google-maps/validate', {
    latitude: Number(latitude),
    longitude: Number(longitude)
  });
  return res.json(result);
});

module.exports = router;
