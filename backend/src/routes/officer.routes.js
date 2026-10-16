const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const validateInput = require('../middleware/validateInput');
const { officerDashboardSchema, verifyComplaintSchema, assignStaffSchema } = require('../schemas/officer.schemas');
const { query } = require('../config/db');
const { notifyStatusChange } = require('../services/notificationService');

// Officer Auth Guard
router.use(authenticateToken);
router.use(requireRole(['officer', 'admin', 'city_admin', 'department_head']));

// Command Center Dashboard Complaints list with filters
router.get('/dashboard', validateInput(officerDashboardSchema), async (req, res) => {
  try {
    const { department_id, priority, status, search } = req.query;

    let sql = `
      SELECT c.*, d.name as department_name, u.name as citizen_name, u.mobile as citizen_mobile
      FROM complaints c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN users u ON c.citizen_id = u.id
      WHERE 1=1
    `;
    const params = [];

    let targetDeptId = department_id;

    if (req.user.role === 'department_head') {
      if (req.user.department_id) {
        targetDeptId = req.user.department_id;
      } else {
        const dhRes = await query(
          `SELECT department_id FROM department_heads WHERE (user_id = ? OR LOWER(email) = ?) AND status = 'active' ORDER BY id DESC LIMIT 1`,
          [req.user.id, (req.user.email || '').toLowerCase()]
        );
        if (dhRes.rows && dhRes.rows.length > 0) {
          targetDeptId = dhRes.rows[0].department_id;
        }
      }
    } else if (req.user.role === 'officer' && req.user.department_id) {
      targetDeptId = req.user.department_id;
    }

    if (targetDeptId) {
      sql += ` AND c.department_id = ?`;
      params.push(targetDeptId);
    }
    if (priority) {
      sql += ` AND c.priority = ?`;
      params.push(priority);
    }
    if (status) {
      sql += ` AND c.status = ?`;
      params.push(status);
    }
    if (search) {
      sql += ` AND (c.title LIKE ? OR c.category LIKE ? OR c.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY c.created_at DESC`;

    const result = await query(sql, params);
    return res.json({ complaints: result.rows });
  } catch (err) {
    console.error('Officer dashboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch dashboard complaints' });
  }
});


// Get available field staff for assignment (Only Active staff of user's department)
router.get('/staff-list', async (req, res) => {
  try {
    let sql = `SELECT id, name, mobile, email, employee_id, department_id, designation FROM users WHERE (role = 'service_staff' OR role = 'staff') AND LOWER(COALESCE(status, 'active')) = 'active'`;
    const params = [];

    if (req.user.role === 'department_head') {
      let targetDeptId = req.user.department_id;
      if (!targetDeptId) {
        const dhRes = await query(
          `SELECT department_id FROM department_heads WHERE (user_id = ? OR LOWER(email) = ?) AND status = 'active' ORDER BY id DESC LIMIT 1`,
          [req.user.id, (req.user.email || '').toLowerCase()]
        );
        if (dhRes.rows && dhRes.rows.length > 0) {
          targetDeptId = dhRes.rows[0].department_id;
        }
      }
      if (targetDeptId) {
        sql += ` AND department_id = ?`;
        params.push(targetDeptId);
      }
    }

    sql += ` ORDER BY name ASC`;

    const result = await query(sql, params);
    return res.json({ staff: result.rows });
  } catch (err) {
    console.error('Fetch staff list error:', err);
    return res.status(500).json({ error: 'Failed to fetch staff members' });
  }
});

// Verify & Approve / Reject Complaint
router.post('/verify', validateInput(verifyComplaintSchema), async (req, res) => {
  try {
    const { complaint_id, action, rejection_reason } = req.body;

    const compRes = await query(`SELECT citizen_id FROM complaints WHERE id = ?`, [complaint_id]);
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    const citizenId = compRes.rows[0].citizen_id;

    if (action === 'approve') {
      await query(`UPDATE complaints SET status = 'Verified', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [complaint_id]);
      await query(
        `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [complaint_id, 'Verified', 'Complaint verified and approved by municipal officer.', 'Municipal Review', req.user.name || 'Municipal Officer']
      ).catch(() => {});
      await notifyStatusChange(complaint_id, 'Verified', citizenId);
      return res.json({ message: 'Complaint verified and approved' });
    } else if (action === 'reject') {
      await query(`UPDATE complaints SET status = 'Rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [complaint_id]);
      await query(
        `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [complaint_id, 'Rejected', rejection_reason || 'Does not meet municipal criteria.', 'Municipal Review', req.user.name || 'Municipal Officer']
      ).catch(() => {});
      await notifyStatusChange(complaint_id, 'Rejected', citizenId, rejection_reason);
      return res.json({ message: 'Complaint rejected' });
    }

    return res.status(400).json({ error: 'Invalid action type' });
  } catch (err) {
    console.error('Officer verify error:', err);
    return res.status(500).json({ error: 'Failed to process verification' });
  }
});

// Assign complaint to staff member
router.post('/assign', validateInput(assignStaffSchema), async (req, res) => {
  try {
    const { complaint_id, staff_id } = req.body;

    const compRes = await query(`SELECT citizen_id, department_id FROM complaints WHERE id = ?`, [complaint_id]);
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    const complaint = compRes.rows[0];

    const staffRes = await query(`SELECT id, name, department_id, status FROM users WHERE id = ?`, [staff_id]);
    if (!staffRes.rows || staffRes.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    const staff = staffRes.rows[0];

    if ((staff.status || 'active').toLowerCase() !== 'active') {
      return res.status(400).json({ error: `Cannot assign task: Staff member '${staff.name}' is currently inactive.` });
    }

    // Department Authorization check
    const userRole = req.user.role || 'citizen';
    const isAdmin = ['admin', 'city_admin'].includes(userRole);
    if (!isAdmin) {
      let userDeptId = req.user.department_id;
      if (userRole === 'department_head' && !userDeptId) {
        const dhRes = await query(`SELECT department_id FROM department_heads WHERE (user_id = ? OR LOWER(email) = ?) AND status = 'active' ORDER BY id DESC LIMIT 1`, [req.user.id, (req.user.email || '').toLowerCase()]);
        if (dhRes.rows && dhRes.rows.length > 0) userDeptId = dhRes.rows[0].department_id;
      }
      if (userDeptId && complaint.department_id && String(userDeptId) !== String(complaint.department_id)) {
        return res.status(403).json({ error: 'Forbidden: You cannot assign complaints outside your department.' });
      }
      if (userDeptId && staff.department_id && String(userDeptId) !== String(staff.department_id)) {
        return res.status(403).json({ error: 'Forbidden: You cannot assign staff members belonging to another department.' });
      }
    }

    // Record assignment
    const assignSql = `
      INSERT INTO assignments (complaint_id, staff_id, assigned_by, assigned_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;
    await query(assignSql, [complaint_id, staff_id, req.user.id]);

    // Update complaint status & assigned staff fields
    let updateSql = `
      UPDATE complaints 
      SET status = 'Staff Assigned',
          assigned_staff_id = ?,
          assigned_staff_name = ?,
          assigned_by = ?,
          assigned_by_name = ?,
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `;
    await query(updateSql, [staff.id, staff.name, req.user.id, req.user.name || 'Municipal Officer', complaint_id]);

    // Record status history
    try {
      await query(
        `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [complaint_id, 'Staff Assigned', `Assigned to field staff ${staff.name}.`, 'Department Operations', req.user.name || 'Municipal Officer']
      );
    } catch (hErr) {}

    // Trigger Notification
    await notifyStatusChange(complaint_id, 'Staff Assigned', complaint.citizen_id);

    return res.json({ success: true, message: 'Complaint assigned to field staff successfully' });
  } catch (err) {
    console.error('Officer assign error:', err);
    return res.status(500).json({ error: 'Failed to assign complaint' });
  }
});

// List duplicate complaints
router.get('/duplicates', async (req, res) => {
  try {
    const sql = `
      SELECT c.*, d.name as department_name, orig.title as original_title
      FROM complaints c
      LEFT JOIN departments d ON c.department_id = d.id
      INNER JOIN complaints orig ON c.duplicate_of_id = orig.id
      ORDER BY c.created_at DESC
    `;
    const result = await query(sql);
    return res.json({ duplicates: result.rows });
  } catch (err) {
    console.error('Duplicates list error:', err);
    return res.status(500).json({ error: 'Failed to fetch duplicates' });
  }
});

module.exports = router;
