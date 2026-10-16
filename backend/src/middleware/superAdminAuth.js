const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { getJwtSecret } = require('./auth');

/**
 * Super Admin strict authentication & authorization middleware.
 * - Demo tokens are explicitly REJECTED.
 * - Requires valid signed JWT with role 'super_admin'.
 * - Verifies user exists in database, has role 'super_admin', and status 'active'.
 * - Attaches req.superAdmin to request.
 */
async function requireSuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized: Authentication token required for Super Admin Control Center.'
      });
    }

    // Explicitly reject any demo tokens
    if (token.startsWith('demo-token-') || token === 'demo-token') {
      return res.status(403).json({
        error: 'Forbidden: Demo tokens are not permitted in Super Admin Control Center.'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (jwtErr) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid or expired Super Admin token.'
      });
    }

    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({
        error: 'Forbidden: Super Admin privileges required.'
      });
    }

    // Server-side database verification of exact account status & role
    const userRes = await query(
      `SELECT id, name, email, role, status FROM users WHERE id = ? OR email = ?`,
      [decoded.id, decoded.email]
    );

    if (!userRes.rows || userRes.rows.length === 0) {
      return res.status(403).json({
        error: 'Forbidden: Super Admin account not found.'
      });
    }

    const user = userRes.rows[0];

    if (user.role !== 'super_admin') {
      return res.status(403).json({
        error: 'Forbidden: User is not authorized as Super Admin.'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        error: 'Forbidden: Super Admin account is suspended or inactive.'
      });
    }

    req.user = user;
    req.superAdmin = user;
    next();
  } catch (err) {
    console.error('[SUPER ADMIN AUTH ERROR]', err);
    return res.status(500).json({ error: 'Super Admin authentication verification failed.' });
  }
}

module.exports = {
  requireSuperAdmin
};
