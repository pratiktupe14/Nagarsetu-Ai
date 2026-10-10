const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { requireSuperAdmin } = require('../middleware/superAdminAuth');
const { logSuperAdminAction, getAuditLogs } = require('../services/superAdminAuditService');
const { resolveDepartmentByCode, resolveDepartmentByCodeSync } = require('../services/departmentService');

const JWT_SECRET = process.env.JWT_SECRET || 'nagarsetu-jwt-secret-key-2024-secure';

// Dedicated Super Admin Login (Strict: email + password, checks super_admin role)
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const userRes = await query(
      `SELECT id, name, email, password_hash, role, status FROM users WHERE LOWER(email) = ?`,
      [cleanEmail]
    );

    if (!userRes.rows || userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid Super Admin credentials.' });
    }

    const user = userRes.rows[0];

    // Must have exact role 'super_admin'
    if (user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden: Account does not have Super Admin authorization.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Super Admin account is currently inactive or suspended.' });
    }

    const isValid = await bcrypt.compare(String(password), user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid Super Admin credentials.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'super_admin'
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    await logSuperAdminAction({
      adminId: user.id,
      adminEmail: user.email,
      action: 'LOGIN',
      targetType: 'auth',
      targetId: String(user.id),
      reason: 'Developer authenticated into Super Admin Control Center',
      req
    });

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'super_admin'
      }
    });
  } catch (err) {
    console.error('[SUPER ADMIN LOGIN ERROR]', err);
    return res.status(500).json({ error: 'Super Admin authentication failed.' });
  }
});

// Verify current session
router.get('/auth/me', requireSuperAdmin, (req, res) => {
  return res.json({
    user: {
      id: req.superAdmin.id,
      name: req.superAdmin.name,
      email: req.superAdmin.email,
      role: 'super_admin'
    }
  });
});

// System Overview Metrics
router.get('/overview', requireSuperAdmin, async (req, res) => {
  try {
    const totalComplaintsRes = await query(`SELECT COUNT(*) as count FROM complaints WHERE (is_archived IS NULL OR is_archived = 0)`);
    const statusCountsRes = await query(`SELECT status, COUNT(*) as count FROM complaints GROUP BY status`);
    const deptCountsRes = await query(`SELECT department_id, COUNT(*) as count FROM complaints GROUP BY department_id`);
    const userCountsRes = await query(`SELECT role, COUNT(*) as count FROM users GROUP BY role`);
    const auditCountRes = await query(`SELECT COUNT(*) as count FROM super_admin_audit_logs`);
    const recurringCountRes = await query(`SELECT COUNT(*) as count FROM recurring_issue_links`);

    const statusCounts = {};
    (statusCountsRes.rows || []).forEach(r => { statusCounts[r.status || 'Unknown'] = Number(r.count); });

    const userCounts = {};
    (userCountsRes.rows || []).forEach(r => { userCounts[r.role || 'citizen'] = Number(r.count); });

    return res.json({
      success: true,
      total_complaints: Number(totalComplaintsRes.rows?.[0]?.count || 0),
      status_breakdown: statusCounts,
      user_breakdown: userCounts,
      total_audit_events: Number(auditCountRes.rows?.[0]?.count || 0),
      total_recurring_links: Number(recurringCountRes.rows?.[0]?.count || 0),
      server_time: new Date().toISOString()
    });
  } catch (err) {
    console.error('[SUPER ADMIN OVERVIEW ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve system overview.' });
  }
});

// Search & List Complaints across all departments and citizens
router.get('/complaints', requireSuperAdmin, async (req, res) => {
  try {
    const { search, status, department_id, category, priority, page = 1, limit = 25, include_archived = 'false' } = req.query;

    let sql = `
      SELECT c.*, d.name as department_name, d.code as department_code,
             u.name as citizen_name, u.mobile as citizen_mobile
      FROM complaints c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN users u ON c.citizen_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (include_archived !== 'true') {
      sql += ` AND (c.is_archived IS NULL OR c.is_archived = 0)`;
    }

    if (status) {
      sql += ` AND c.status = ?`;
      params.push(status);
    }

    if (department_id) {
      sql += ` AND (c.department_id = ? OR CAST(c.department_id AS TEXT) = ?)`;
      params.push(department_id, String(department_id));
    }

    if (category) {
      sql += ` AND LOWER(c.category) = LOWER(?)`;
      params.push(category);
    }

    if (priority) {
      sql += ` AND LOWER(c.priority) = LOWER(?)`;
      params.push(priority);
    }

    if (search) {
      sql += ` AND (c.complaint_number LIKE ? OR c.title LIKE ? OR c.description LIKE ? OR u.name LIKE ? OR u.mobile LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    sql += ` ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
    const offset = (Number(page) - 1) * Number(limit);
    params.push(Number(limit), Number(offset));

    const result = await query(sql, params);
    return res.json({
      success: true,
      complaints: result.rows || [],
      page: Number(page),
      limit: Number(limit)
    });
  } catch (err) {
    console.error('[SUPER ADMIN COMPLAINTS LIST ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve complaints.' });
  }
});

// Get Comprehensive Complaint Detail with Evidence Versions & Audit History
router.get('/complaints/:id', requireSuperAdmin, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const compRes = await query(`
      SELECT c.*, d.name as department_name, d.code as department_code,
             u.name as citizen_name, u.mobile as citizen_mobile, u.email as citizen_email
      FROM complaints c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN users u ON c.citizen_id = u.id
      WHERE c.id = ? OR c.complaint_number = ? OR CAST(c.id AS TEXT) = ?
    `, [complaintId, complaintId, String(complaintId)]);

    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }

    const complaint = compRes.rows[0];

    // Fetch evidence versions history
    const evidenceRes = await query(
      `SELECT * FROM complaint_evidence_versions WHERE complaint_id = ? ORDER BY version_number ASC`,
      [complaint.id]
    );

    // Fetch audit history for this specific complaint
    const auditRes = await query(
      `SELECT * FROM super_admin_audit_logs WHERE target_type = 'complaint' AND target_id = ? ORDER BY created_at DESC`,
      [String(complaint.id)]
    );

    // Fetch complaint status history
    const statusHistRes = await query(
      `SELECT * FROM complaint_status_history WHERE complaint_id = ? ORDER BY created_at ASC`,
      [complaint.id]
    );

    // Fetch recurrence links
    const recurrenceRes = await query(
      `SELECT * FROM recurring_issue_links WHERE current_complaint_id = ? OR previous_complaint_id = ?`,
      [complaint.id, complaint.id]
    );

    return res.json({
      success: true,
      complaint,
      evidence_versions: evidenceRes.rows || [],
      audit_logs: auditRes.rows || [],
      status_history: statusHistRes.rows || [],
      recurrence_links: recurrenceRes.rows || []
    });
  } catch (err) {
    console.error('[SUPER ADMIN COMPLAINT DETAIL ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve complaint detail.' });
  }
});

// Authorized Complaint Correction & Update
router.patch('/complaints/:id', requireSuperAdmin, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const { title, description, category, department_id, priority, status, assigned_staff_id, reason } = req.body;

    const currentRes = await query(`SELECT * FROM complaints WHERE id = ? OR complaint_number = ?`, [complaintId, complaintId]);
    if (!currentRes.rows || currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    const current = currentRes.rows[0];

    const updates = [];
    const params = [];
    const changes = {};

    if (title !== undefined && title !== current.title) {
      updates.push(`title = ?`);
      params.push(title);
      changes.title = { from: current.title, to: title };
    }

    if (description !== undefined && description !== current.description) {
      updates.push(`description = ?`);
      params.push(description);
      changes.description = { from: current.description, to: description };
    }

    if (category !== undefined && category !== current.category) {
      updates.push(`category = ?`);
      params.push(category);
      changes.category = { from: current.category, to: category };
    }

    if (department_id !== undefined && String(department_id) !== String(current.department_id)) {
      const canonical = resolveDepartmentByCodeSync(department_id);
      updates.push(`department_id = ?`);
      params.push(canonical.id);
      changes.department_id = { from: current.department_id, to: canonical.id };
    }

    if (priority !== undefined && priority !== current.priority) {
      updates.push(`priority = ?`);
      params.push(priority);
      changes.priority = { from: current.priority, to: priority };
    }

    if (status !== undefined && status !== current.status) {
      updates.push(`status = ?`);
      params.push(status);
      changes.status = { from: current.status, to: status };

      // Record in status history
      await query(
        `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [current.id, status, reason || 'Super Admin administrative status correction', 'Super Admin Console', req.superAdmin.name || 'Developer']
      );
    }

    if (assigned_staff_id !== undefined && String(assigned_staff_id) !== String(current.assigned_staff_id)) {
      updates.push(`assigned_staff_id = ?`);
      params.push(assigned_staff_id);
      changes.assigned_staff_id = { from: current.assigned_staff_id, to: assigned_staff_id };
    }

    if (updates.length === 0) {
      return res.json({ success: true, message: 'No changes detected.', complaint: current });
    }

    updates.push(`updated_at = ?`);
    params.push(new Date().toISOString());

    params.push(current.id);
    const updateSql = `UPDATE complaints SET ${updates.join(', ')} WHERE id = ?`;
    await query(updateSql, params);

    // Audit log
    await logSuperAdminAction({
      adminId: req.superAdmin.id,
      adminEmail: req.superAdmin.email,
      action: 'COMPLAINT_UPDATE',
      targetType: 'complaint',
      targetId: String(current.id),
      changes,
      reason: reason || 'Administrative correction by Super Admin',
      req
    });

    const updatedRes = await query(`SELECT * FROM complaints WHERE id = ?`, [current.id]);

    try {
      const { integrityService } = require('../services/blockchain');
      integrityService.recordStatusUpdate(updatedRes.rows[0], updatedRes.rows[0].status, req.superAdmin.email, reason);
    } catch (bErr) {}

    return res.json({
      success: true,
      message: 'Complaint successfully corrected.',
      complaint: updatedRes.rows[0],
      changes
    });
  } catch (err) {
    console.error('[SUPER ADMIN COMPLAINT UPDATE ERROR]', err);
    return res.status(500).json({ error: 'Failed to update complaint.' });
  }
});

// Image & Evidence Versioning & Replacement
router.post('/complaints/:id/evidence', requireSuperAdmin, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const { photo_before_url, photo_front_url, photo_after_url, reason } = req.body;

    if (!photo_before_url && !photo_front_url && !photo_after_url) {
      return res.status(400).json({ error: 'At least one replacement image URL must be provided.' });
    }

    const currentRes = await query(`SELECT * FROM complaints WHERE id = ? OR complaint_number = ?`, [complaintId, complaintId]);
    if (!currentRes.rows || currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    const current = currentRes.rows[0];

    // Get current version count for this complaint
    const versionCountRes = await query(
      `SELECT COUNT(*) as count FROM complaint_evidence_versions WHERE complaint_id = ?`,
      [current.id]
    );
    const nextVersion = Number(versionCountRes.rows?.[0]?.count || 0) + 1;

    // 1. Preserve current active images into evidence versions history table
    await query(`
      INSERT INTO complaint_evidence_versions 
        (complaint_id, version_number, photo_before_url, photo_after_url, photo_front_url, replacement_reason, replaced_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      current.id,
      nextVersion,
      current.photo_before_url,
      current.photo_after_url,
      current.photo_front_url,
      reason || 'Archived prior evidence before Super Admin replacement',
      req.superAdmin.email
    ]);

    // 2. Update active images on the complaint
    const newBefore = photo_before_url || current.photo_before_url;
    const newFront = photo_front_url || photo_before_url || current.photo_front_url;
    const newAfter = photo_after_url !== undefined ? photo_after_url : current.photo_after_url;

    await query(`
      UPDATE complaints 
      SET photo_before_url = ?, photo_front_url = ?, photo_after_url = ?, updated_at = ?
      WHERE id = ?
    `, [newBefore, newFront, newAfter, new Date().toISOString(), current.id]);

    // 3. Log audit record
    await logSuperAdminAction({
      adminId: req.superAdmin.id,
      adminEmail: req.superAdmin.email,
      action: 'EVIDENCE_REPLACE',
      targetType: 'complaint',
      targetId: String(current.id),
      changes: {
        version_archived: nextVersion,
        before_replaced: current.photo_before_url !== newBefore,
        after_replaced: current.photo_after_url !== newAfter
      },
      reason: reason || 'Super Admin evidence replacement',
      req
    });

    try {
      const { integrityService } = require('../services/blockchain');
      integrityService.recordEvidenceReplacement(current.id, nextVersion, newBefore, reason, req.superAdmin.email);
    } catch (bErr) {}

    return res.json({
      success: true,
      message: `Evidence version #${nextVersion} archived. Active complaint photos updated.`,
      new_photos: {
        photo_before_url: newBefore,
        photo_front_url: newFront,
        photo_after_url: newAfter
      }
    });
  } catch (err) {
    console.error('[SUPER ADMIN EVIDENCE ERROR]', err);
    return res.status(500).json({ error: 'Failed to update complaint evidence.' });
  }
});

// Location & GPS Correction
router.patch('/complaints/:id/location', requireSuperAdmin, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const { latitude, longitude, location_address, reason } = req.body;

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid latitude or longitude coordinates.' });
    }

    const currentRes = await query(`SELECT * FROM complaints WHERE id = ? OR complaint_number = ?`, [complaintId, complaintId]);
    if (!currentRes.rows || currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    const current = currentRes.rows[0];

    const changes = {
      latitude: { from: current.latitude, to: lat },
      longitude: { from: current.longitude, to: lng },
      location_address: { from: current.location_address, to: location_address || current.location_address }
    };

    await query(`
      UPDATE complaints 
      SET latitude = ?, longitude = ?, location_address = ?, location_source = 'map_pin_confirmed', updated_at = ?
      WHERE id = ?
    `, [lat, lng, location_address || current.location_address || '', new Date().toISOString(), current.id]);

    await logSuperAdminAction({
      adminId: req.superAdmin.id,
      adminEmail: req.superAdmin.email,
      action: 'LOCATION_CORRECT',
      targetType: 'complaint',
      targetId: String(current.id),
      changes,
      reason: reason || 'GPS coordinates corrected by Super Admin',
      req
    });

    try {
      const { integrityService } = require('../services/blockchain');
      integrityService.recordLocationCorrection(current.id, lat, lng, reason, req.superAdmin.email);
    } catch (bErr) {}

    return res.json({
      success: true,
      message: 'Complaint location updated and synchronized.',
      changes
    });
  } catch (err) {
    console.error('[SUPER ADMIN LOCATION ERROR]', err);
    return res.status(500).json({ error: 'Failed to correct complaint location.' });
  }
});

// Archival & Restoration
router.post('/complaints/:id/archive', requireSuperAdmin, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const { reason } = req.body;

    const compRes = await query(`SELECT id FROM complaints WHERE id = ? OR complaint_number = ?`, [complaintId, complaintId]);
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    const id = compRes.rows[0].id;

    await query(`
      UPDATE complaints 
      SET is_archived = 1, archived_at = ?, archived_by = ?, updated_at = ?
      WHERE id = ?
    `, [new Date().toISOString(), req.superAdmin.email, new Date().toISOString(), id]);

    await logSuperAdminAction({
      adminId: req.superAdmin.id,
      adminEmail: req.superAdmin.email,
      action: 'ARCHIVE',
      targetType: 'complaint',
      targetId: String(id),
      reason: reason || 'Archived by Super Admin',
      req
    });

    return res.json({ success: true, message: `Complaint #${id} successfully archived.` });
  } catch (err) {
    console.error('[SUPER ADMIN ARCHIVE ERROR]', err);
    return res.status(500).json({ error: 'Failed to archive complaint.' });
  }
});

router.post('/complaints/:id/restore', requireSuperAdmin, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const { reason } = req.body;

    const compRes = await query(`SELECT id FROM complaints WHERE id = ? OR complaint_number = ?`, [complaintId, complaintId]);
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    const id = compRes.rows[0].id;

    await query(`
      UPDATE complaints 
      SET is_archived = 0, archived_at = null, archived_by = null, updated_at = ?
      WHERE id = ?
    `, [new Date().toISOString(), id]);

    await logSuperAdminAction({
      adminId: req.superAdmin.id,
      adminEmail: req.superAdmin.email,
      action: 'RESTORE',
      targetType: 'complaint',
      targetId: String(id),
      reason: reason || 'Restored by Super Admin',
      req
    });

    return res.json({ success: true, message: `Complaint #${id} restored.` });
  } catch (err) {
    console.error('[SUPER ADMIN RESTORE ERROR]', err);
    return res.status(500).json({ error: 'Failed to restore complaint.' });
  }
});

// Permanent Protected Deletion (Requires confirmation string: "PERMANENT_DELETE")
router.delete('/complaints/:id', requireSuperAdmin, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const confirm = (req.body?.confirm || req.query?.confirm || '').toString().trim().toUpperCase();
    const reason = req.body?.reason || req.query?.reason;

    if (confirm !== 'PERMANENT_DELETE') {
      return res.status(400).json({
        error: 'Confirmation failed: Must provide confirm: "PERMANENT_DELETE" to proceed.'
      });
    }

    const compRes = await query(`SELECT id, complaint_number FROM complaints WHERE id = ? OR complaint_number = ?`, [complaintId, complaintId]);
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    const target = compRes.rows[0];

    // Safely delete dependent records
    try { await query(`DELETE FROM complaint_status_history WHERE complaint_id = ?`, [target.id]); } catch (e) {}
    try { await query(`DELETE FROM complaint_evidence_versions WHERE complaint_id = ?`, [target.id]); } catch (e) {}
    try { await query(`DELETE FROM recurring_issue_links WHERE current_complaint_id = ? OR previous_complaint_id = ?`, [target.id, target.id]); } catch (e) {}
    try { await query(`DELETE FROM feedback WHERE complaint_id = ?`, [target.id]); } catch (e) {}
    try { await query(`DELETE FROM assignments WHERE complaint_id = ? OR CAST(complaint_id AS TEXT) = ?`, [target.id, String(target.id)]); } catch (e) {}
    try { await query(`DELETE FROM task_assignments WHERE complaint_id = ? OR CAST(complaint_id AS TEXT) = ?`, [target.id, String(target.id)]); } catch (e) {}
    try { await query(`DELETE FROM notifications WHERE complaint_id = ?`, [target.id]); } catch (e) {}
    await query(`DELETE FROM complaints WHERE id = ?`, [target.id]);

    await logSuperAdminAction({
      adminId: req.superAdmin.id,
      adminEmail: req.superAdmin.email,
      action: 'PERMANENT_DELETE',
      targetType: 'complaint',
      targetId: String(target.id),
      reason: reason || 'Permanently deleted by Super Admin with confirmation',
      req
    });

    return res.json({ success: true, message: `Complaint #${target.complaint_number || target.id} permanently deleted.` });
  } catch (err) {
    console.error('[SUPER ADMIN DELETE ERROR]', err);
    return res.status(500).json({ error: 'Failed to delete complaint.' });
  }
});

// User Management (Excludes password_hash)
router.get('/users', requireSuperAdmin, async (req, res) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;

    let sql = `SELECT id, name, email, mobile, role, department_id, employee_id, status, created_at FROM users WHERE 1=1`;
    const params = [];

    if (role) {
      sql += ` AND role = ?`;
      params.push(role);
    }

    if (search) {
      sql += ` AND (name LIKE ? OR email LIKE ? OR mobile LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const offset = (Number(page) - 1) * Number(limit);
    params.push(Number(limit), Number(offset));

    const result = await query(sql, params);
    return res.json({
      success: true,
      users: result.rows || [],
      page: Number(page),
      limit: Number(limit)
    });
  } catch (err) {
    console.error('[SUPER ADMIN USERS ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// Suspend or Reactivate User
router.patch('/users/:id/status', requireSuperAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { status, reason } = req.body;

    if (!['active', 'suspended', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active, suspended, or inactive.' });
    }

    // Prevent self-suspension
    if (String(req.superAdmin.id) === String(userId)) {
      return res.status(400).json({ error: 'Cannot suspend your own Super Admin account.' });
    }

    const userRes = await query(`SELECT id, email, role, status FROM users WHERE id = ?`, [userId]);
    if (!userRes.rows || userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const targetUser = userRes.rows[0];

    await query(`UPDATE users SET status = ? WHERE id = ?`, [status, targetUser.id]);

    await logSuperAdminAction({
      adminId: req.superAdmin.id,
      adminEmail: req.superAdmin.email,
      action: 'USER_STATUS_CHANGE',
      targetType: 'user',
      targetId: String(targetUser.id),
      changes: { from: targetUser.status, to: status },
      reason: reason || `User status changed to ${status}`,
      req
    });

    return res.json({ success: true, message: `User #${targetUser.id} status updated to ${status}.` });
  } catch (err) {
    console.error('[SUPER ADMIN USER STATUS ERROR]', err);
    return res.status(500).json({ error: 'Failed to update user status.' });
  }
});

// Audit Logs Retrieval
router.get('/audit-logs', requireSuperAdmin, async (req, res) => {
  try {
    const { limit = 50, offset = 0, action, target_type, target_id } = req.query;
    const logs = await getAuditLogs({
      limit: Number(limit),
      offset: Number(offset),
      action,
      targetType: target_type,
      targetId: target_id
    });
    return res.json({ success: true, logs });
  } catch (err) {
    console.error('[SUPER ADMIN AUDIT LOGS ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

// System & Database Health Check
router.get('/health', requireSuperAdmin, async (req, res) => {
  try {
    const dbTest = await query(`SELECT 1 as test`);
    const isDbConnected = Boolean(dbTest.rows && dbTest.rows.length > 0);

    return res.json({
      success: true,
      database: isDbConnected ? 'Healthy' : 'Degraded',
      node_version: process.version,
      uptime_seconds: Math.floor(process.uptime()),
      memory_usage_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[SUPER ADMIN HEALTH ERROR]', err);
    return res.status(500).json({ error: 'Failed to perform health check.' });
  }
});

// ==========================================
// BLOCKCHAIN DATA INTEGRITY & AUDIT ENDPOINTS
// ==========================================

// Ledger framework diagnostics & health
router.get('/blockchain/status', requireSuperAdmin, async (req, res) => {
  try {
    const { verificationService } = require('../services/blockchain');
    const status = await verificationService.getLedgerDiagnostics();
    return res.json({ success: true, ...status });
  } catch (err) {
    console.error('[BLOCKCHAIN STATUS ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve blockchain status.' });
  }
});

// Verify complaint record integrity against blockchain commitment
router.post('/blockchain/verify/complaint/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { verificationService } = require('../services/blockchain');
    const result = await verificationService.verifyComplaintIntegrity(req.params.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[BLOCKCHAIN VERIFY COMPLAINT ERROR]', err);
    return res.status(500).json({ error: 'Failed to verify complaint integrity.' });
  }
});

// Verify evidence version integrity
router.post('/blockchain/verify/evidence/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { verificationService } = require('../services/blockchain');
    const result = await verificationService.verifyEvidenceIntegrity(req.params.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[BLOCKCHAIN VERIFY EVIDENCE ERROR]', err);
    return res.status(500).json({ error: 'Failed to verify evidence integrity.' });
  }
});

// Verify location correction history
router.post('/blockchain/verify/location/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { verificationService } = require('../services/blockchain');
    const result = await verificationService.verifyLocationIntegrity(req.params.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[BLOCKCHAIN VERIFY LOCATION ERROR]', err);
    return res.status(500).json({ error: 'Failed to verify location integrity.' });
  }
});

// Inspect transaction receipt & block proof
router.get('/blockchain/receipts/:txId', requireSuperAdmin, async (req, res) => {
  try {
    const { verificationService } = require('../services/blockchain');
    const receipt = await verificationService.getReceiptDetails(req.params.txId);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });
    return res.json({ success: true, ...receipt });
  } catch (err) {
    console.error('[BLOCKCHAIN RECEIPT ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch transaction receipt.' });
  }
});

// View pending or failed outbox events
router.get('/blockchain/outbox', requireSuperAdmin, async (req, res) => {
  try {
    const pending = await query(`SELECT * FROM blockchain_transactions WHERE status != 'COMMITTED' ORDER BY rowid ASC LIMIT 50`);
    return res.json({ success: true, outbox: pending.rows || [] });
  } catch (err) {
    console.error('[BLOCKCHAIN OUTBOX ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch outbox transactions.' });
  }
});

// Trigger asynchronous outbox retry
router.post('/blockchain/outbox/retry', requireSuperAdmin, async (req, res) => {
  try {
    const { ledgerAdapter } = require('../services/blockchain');
    const result = await ledgerAdapter.processPendingOutbox();
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[BLOCKCHAIN RETRY ERROR]', err);
    return res.status(500).json({ error: 'Failed to process pending outbox.' });
  }
});

module.exports = router;
