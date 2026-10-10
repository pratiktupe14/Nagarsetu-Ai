require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { authRateLimiter, publicRateLimiter, authedRateLimiter, authenticatedRateLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const complaintRoutes = require('./routes/complaint.routes');
const officerRoutes = require('./routes/officer.routes');
const staffRoutes = require('./routes/staff.routes');
const adminRoutes = require('./routes/admin.routes');
const departmentRoutes = require('./routes/department.routes');
const notificationRoutes = require('./routes/notification.routes');
const announcementRoutes = require('./routes/announcement.routes');
const mapsRoutes = require('./routes/maps.routes');
const aiRoutes = require('./routes/ai.routes');
const superAdminRoutes = require('./routes/superAdmin.routes');

const app = express();

// Security Headers: Helmet (if installed)
try {
  const helmet = require('helmet');
  app.use(helmet({ crossOriginResourcePolicy: false }));
} catch (e) {
  // TODO: Helmet is not installed. Add 'helmet' to dependencies for production security headers.
}

// Security Headers & Core Middleware
const isDev = process.env.NODE_ENV !== 'production';

function resolveAllowedOrigins() {
  const list = [];
  if (process.env.FRONTEND_URL) {
    list.push(process.env.FRONTEND_URL.trim());
  }
  if (process.env.CORS_ALLOWED_ORIGINS) {
    process.env.CORS_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => list.push(s));
  }
  if (isDev) {
    list.push('http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173');
  }
  return list;
}

const allowedOrigins = resolveAllowedOrigins();

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (isDev && (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || /^http:\/\/\[::1\]:\d+$/.test(origin) || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('[::1]'))) {
      return callback(null, true);
    }
    if (isDev) {
      return callback(null, true);
    }
    return callback(new Error(`CORS Error: Origin '${origin}' is not authorized.`));
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static uploads safely with proper CORS & CORP headers
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const serverlessUploadsDir = path.join('/tmp', 'uploads');
const localUploadsDir = path.join(__dirname, '../uploads');

[serverlessUploadsDir, localUploadsDir].forEach((dir) => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {}
});

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data: *; style-src 'unsafe-inline'");
  res.setHeader('Content-Disposition', 'inline');
  next();
}, express.static(localUploadsDir), express.static(serverlessUploadsDir));

// Root Welcome & Health Check Endpoints
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'NAGARSETU Express Backend API is live on Vercel',
    health: '/api/health',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'NAGARSETU API Root',
    health: '/api/health',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', publicRateLimiter, (req, res) => {
  res.json({
    success: true,
    message: 'NAGARSETU Backend is running',
    status: 'ok',
    service: 'NAGARSETU Express Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Register API Routes with Appropriate Rate Limiters
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/maps', publicRateLimiter, mapsRoutes);
app.use('/api/ai', authedRateLimiter || publicRateLimiter, aiRoutes);

app.use('/api/complaints', authedRateLimiter || authenticatedRateLimiter, complaintRoutes);
app.use('/api/officer', authedRateLimiter || authenticatedRateLimiter, officerRoutes);
app.use('/api/staff', authedRateLimiter || authenticatedRateLimiter, staffRoutes);
app.use('/api/admin', authedRateLimiter || authenticatedRateLimiter, adminRoutes);
app.use('/api/departments', authedRateLimiter || authenticatedRateLimiter, departmentRoutes);
app.use('/api/department', authedRateLimiter || authenticatedRateLimiter, departmentRoutes);
app.use('/api/notifications', authedRateLimiter || authenticatedRateLimiter, notificationRoutes);
app.use('/api/announcements', authedRateLimiter || authenticatedRateLimiter, announcementRoutes);
app.use('/api/super-admin', superAdminRoutes);

// Centralized Error Handling Middleware (Prevents stack trace / information leakage)
app.use(errorHandler);

module.exports = app;
