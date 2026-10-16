/**
 * NAGARSETU Security Middleware — Configurable Rate Limiter
 * Provides rate limiting for:
 * 1. Auth routes (per-IP + per-account exponential backoff with res.clearAuthAttempts())
 * 2. Public endpoints (Health, Maps, Geocoding)
 * 3. Authenticated actions (Complaints, Admin, Staff, Officer)
 */

const rateLimit = require('express-rate-limit');

// Helper to parse env int with fallback
const getEnvInt = (key, fallback) => {
  const val = parseInt(process.env[key], 10);
  return !isNaN(val) && val > 0 ? val : fallback;
};

/**
 * In-Memory Exponential Backoff Tracker for Authentication Routes.
 * Combines per-IP and per-account (mobile/email) attempt tracking.
 */
const authAttemptTracker = new Map();

// Periodic cleanup of stale attempt records (unref'd for serverless event-loop safety)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of authAttemptTracker.entries()) {
    if (record.blockedUntil && record.blockedUntil < now && record.resetAt < now) {
      authAttemptTracker.delete(key);
    }
  }
}, 10 * 60 * 1000);

if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

/**
 * Custom Exponential Backoff Auth Rate Limiter
 * Enforces per-IP and per-account limits with progressive retry delays instead of hard lockout.
 */
function authRateLimiter(req, res, next) {
  // Only authenticated profile operations and session inspection are exempted from credential-guessing limits
  if (req.path === '/profile' || req.path === '/me') {
    return next();
  }

  const windowMs = getEnvInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000); // Default 15 minutes
  const maxAttempts = getEnvInt('RATE_LIMIT_AUTH_MAX', 5); // Allow 5 free attempts before backoff
  const baseBackoffSec = getEnvInt('RATE_LIMIT_AUTH_BACKOFF_BASE_SEC', 30); // 30s base multiplier

  // Express evaluates trusted reverse proxies via 'trust proxy'.
  // Using req.ip prevents client-side IP spoofing via arbitrary X-Forwarded-For headers.
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const identifier = req.body && (req.body.mobile || req.body.email || req.body.mobileOrEmail);
  const cleanId = identifier ? String(identifier).trim().toLowerCase() : '';

  const ipKey = `ip_${ip}`;
  const accountKey = cleanId ? `account_${cleanId}` : null;

  const now = Date.now();

  // Helper to retrieve or create record
  const getRecord = (key) => {
    let rec = authAttemptTracker.get(key);
    if (!rec || rec.resetAt < now) {
      rec = { count: 0, blockedUntil: 0, resetAt: now + windowMs };
      authAttemptTracker.set(key, rec);
    }
    return rec;
  };

  const ipRecord = getRecord(ipKey);
  const accountRecord = accountKey ? getRecord(accountKey) : null;

  // Check if either IP or account is currently blocked
  const ipBlockedMs = ipRecord.blockedUntil - now;
  const accountBlockedMs = accountRecord ? accountRecord.blockedUntil - now : 0;
  const maxBlockedMs = Math.max(ipBlockedMs, accountBlockedMs);

  if (maxBlockedMs > 0) {
    const retryAfterSeconds = Math.ceil(maxBlockedMs / 1000);
    res.setHeader('Retry-After', retryAfterSeconds);
    return res.status(429).json({
      error: 'Too many authentication attempts. Please try again later.',
      retryAfterSeconds
    });
  }

  // Increment attempt count on request trigger
  ipRecord.count += 1;
  if (accountRecord) accountRecord.count += 1;

  // Calculate exponential backoff if max attempts exceeded
  const checkAndApplyBackoff = (rec) => {
    if (rec.count > maxAttempts) {
      const exponent = rec.count - maxAttempts;
      // Exponential backoff: baseSec * (2 ^ (exponent - 1)) capped at 1 hour max delay
      const delaySec = Math.min(baseBackoffSec * Math.pow(2, exponent - 1), 3600);
      rec.blockedUntil = Date.now() + (delaySec * 1000);
    }
  };

  checkAndApplyBackoff(ipRecord);
  if (accountRecord) checkAndApplyBackoff(accountRecord);

  // Helper attached to res so route handlers can clear attempts upon successful login/register
  res.clearAuthAttempts = () => {
    authAttemptTracker.delete(ipKey);
    if (accountKey) authAttemptTracker.delete(accountKey);
  };

  next();
}
// TODO: Use a shared Redis/Upstash rate-limit store for distributed/serverless production.

/**
 * Granular client identifier helper for authenticated actions and complaint submissions.
 * Resolves verified authenticated user ID (req.user.id) or falls back to client IP.
 * Does NOT trust unverified token decodes from headers.
 */
function getAuthedClientKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';

  if (req.user && req.user.id) {
    return `user_${req.user.id}_${ip}`;
  }

  return `ip_${ip}`;
}

/**
 * Resolves shared Redis rate-limit store if REDIS_URL and adapter are configured.
 * Safely falls back to process-local MemoryStore if Redis is unconfigured or unavailable,
 * preventing unhandled crash while reporting required production multi-instance config.
 */
function resolveRateLimitStore(prefix) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_REST_API_URL;
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[RATE LIMIT WARNING] REDIS_URL is not set in production. Rate limits are degrading to process-local memory enforcement for ${prefix}. Configure REDIS_URL for distributed multi-instance synchronization.`);
    }
    return undefined; // uses default MemoryStore
  }
  try {
    const { RedisStore } = require('rate-limit-redis');
    const { createClient } = require('redis');
    const client = createClient({ url: redisUrl });
    client.on('error', (err) => console.warn(`[REDIS RATE LIMIT NOTE] Client error on ${prefix}:`, err.message));
    client.connect().catch((err) => console.warn(`[REDIS RATE LIMIT NOTE] Connection failed on ${prefix}:`, err.message));
    return new RedisStore({
      sendCommand: (...args) => client.sendCommand(args),
      prefix: `nagarsetu_rl_${prefix}:`
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[REDIS RATE LIMIT WARNING] REDIS_URL provided but rate-limit-redis/redis client not loadable (${err.message}). Using fallback memory store for ${prefix}.`);
    }
    return undefined;
  }
}

// 2. Public Endpoints Rate Limiter (Health, Geocoding, public maps)
const publicRateLimiter = rateLimit({
  windowMs: getEnvInt('RATE_LIMIT_PUBLIC_WINDOW_MS', 15 * 60 * 1000), // 15 minutes
  max: getEnvInt('RATE_LIMIT_PUBLIC_MAX', 100), // 100 requests per 15 minutes
  store: resolveRateLimitStore('public'),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: {
    error: 'Too many requests from this IP. Please try again later.'
  }
});

// 3. Authenticated User Actions Rate Limiter (Complaints, Admin, Staff, Officer)
// Applies to mutating actions (POST/PUT/DELETE/PATCH). Skips read queries (GET, HEAD, OPTIONS)
// so that dashboard viewing, polling, duplicate checks, and maps never deplete action rate limit quotas.
const authedRateLimiter = rateLimit({
  windowMs: getEnvInt('RATE_LIMIT_AUTHED_WINDOW_MS', 15 * 60 * 1000), // 15 minutes
  max: getEnvInt('RATE_LIMIT_AUTHED_MAX', 300), // 300 requests per 15 minutes
  keyGenerator: getAuthedClientKey,
  store: resolveRateLimitStore('authed'),
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: {
    error: 'Action rate limit exceeded. Please slow down your requests.'
  }
});

// 4. Dedicated Complaint Submission Rate Limiter
// Specifically protects POST /api/complaints/submit against abuse/bots while guaranteeing
// legitimate citizen complaint submissions always have their own isolated submission allowance.
const complaintSubmitLimiter = rateLimit({
  windowMs: getEnvInt('RATE_LIMIT_COMPLAINT_WINDOW_MS', 15 * 60 * 1000), // 15 minutes
  max: getEnvInt('RATE_LIMIT_COMPLAINT_MAX', 30), // 30 complaint submissions per 15 min per citizen
  keyGenerator: getAuthedClientKey,
  store: resolveRateLimitStore('complaint'),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: {
    error: 'Action rate limit exceeded. Please slow down your requests.'
  }
});

module.exports = {
  authRateLimiter,
  publicRateLimiter,
  authedRateLimiter,
  authenticatedRateLimiter: authedRateLimiter,
  complaintSubmitLimiter,
  getAuthedClientKey,
  resetAuthLimits: () => authAttemptTracker.clear()
};
