const { query } = require('../config/db');

/**
 * Record an immutable audit log entry for any Super Admin action.
 */
async function logSuperAdminAction({
  adminId,
  adminEmail,
  action,
  targetType,
  targetId = null,
  changes = null,
  reason = null,
  req = null
}) {
  try {
    const ipAddress = req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || req?.ip || '127.0.0.1';
    const changesJson = changes ? (typeof changes === 'string' ? changes : JSON.stringify(changes)) : null;

    const sql = `
      INSERT INTO super_admin_audit_logs 
        (admin_id, admin_email, action, target_type, target_id, changes_json, reason, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await query(sql, [
      String(adminId || 'super_admin'),
      String(adminEmail || 'developer@nagarsetu.local'),
      String(action),
      String(targetType || 'general'),
      targetId ? String(targetId) : null,
      changesJson,
      reason ? String(reason) : null,
      String(ipAddress)
    ]);
  } catch (err) {
    console.error('[AUDIT LOGGING ERROR]', err.message);
  }
}

/**
 * Fetch audit logs with filtering and pagination.
 */
async function getAuditLogs({ limit = 50, offset = 0, action = null, targetType = null, targetId = null } = {}) {
  try {
    let sql = `SELECT * FROM super_admin_audit_logs WHERE 1=1`;
    const params = [];

    if (action) {
      sql += ` AND action = ?`;
      params.push(action);
    }
    if (targetType) {
      sql += ` AND target_type = ?`;
      params.push(targetType);
    }
    if (targetId) {
      sql += ` AND target_id = ?`;
      params.push(String(targetId));
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const res = await query(sql, params);
    return res.rows || [];
  } catch (err) {
    console.error('[AUDIT FETCH ERROR]', err.message);
    return [];
  }
}

module.exports = {
  logSuperAdminAction,
  getAuditLogs
};
