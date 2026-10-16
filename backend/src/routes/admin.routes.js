const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validateInput = require('../middleware/validateInput');
const {
  createUserSchema,
  updateUserSchema,
  createDeptHeadSchema,
  createDepartmentSchema,
  assignStaffSchema,
  reassignComplaintSchema
} = require('../schemas/admin.schemas');
const { query } = require('../config/db');

// Admin Auth Guard & No-Cache Middleware
router.use(authenticateToken);
router.use(requireRole(['admin', 'city_admin']));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Admin Analytics summary
router.get('/analytics', async (req, res) => {
  try {
    const totalSql = `SELECT COUNT(*) as total FROM complaints`;
    const totalRes = await query(totalSql);

    const resolvedSql = `SELECT COUNT(*) as resolved FROM complaints WHERE status = 'Resolved'`;
    const resolvedRes = await query(resolvedSql);

    const pendingSql = `SELECT COUNT(*) as pending FROM complaints WHERE status IN ('Submitted', 'Verified', 'Assigned', 'In Progress')`;
    const pendingRes = await query(pendingSql);

    const categorySql = `SELECT category, COUNT(*) as count FROM complaints GROUP BY category`;
    const categoryRes = await query(categorySql);

    const deptSql = `
      SELECT d.name as department_name, COUNT(c.id) as total_complaints,
             SUM(CASE WHEN c.status = 'Resolved' THEN 1 ELSE 0 END) as resolved_count
      FROM departments d
      LEFT JOIN complaints c ON c.department_id = d.id
      GROUP BY d.id, d.name
    `;
    const deptRes = await query(deptSql);

    return res.json({
      metrics: {
        total_complaints: totalRes.rows[0].total || 0,
        resolved_complaints: resolvedRes.rows[0].resolved || 0,
        pending_complaints: pendingRes.rows[0].pending || 0,
        resolution_rate: totalRes.rows[0].total > 0 ? Math.round((resolvedRes.rows[0].resolved / totalRes.rows[0].total) * 100) : 0
      },
      by_category: categoryRes.rows,
      by_department: deptRes.rows
    });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ error: 'Failed to fetch admin analytics' });
  }
});

// Admin Hotspots map data
router.get('/hotspots', async (req, res) => {
  try {
    const sql = `
      SELECT id, category, title, status, priority, latitude, longitude, created_at
      FROM complaints
    `;
    const result = await query(sql);
    return res.json({ complaints: result.rows });
  } catch (err) {
    console.error('Hotspots error:', err);
    return res.status(500).json({ error: 'Failed to fetch hotspot data' });
  }
});

// CRUD Users
router.get('/users', async (req, res) => {
  try {
    const sql = `SELECT id, name, mobile, email, role, language_pref, created_at FROM users ORDER BY id DESC`;
    const result = await query(sql);
    return res.json({ users: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', validateInput(createUserSchema), async (req, res) => {
  try {
    const { name, mobile, email, password, role = 'citizen', language_pref = 'en' } = req.body;

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const sql = `
      INSERT INTO users (name, mobile, email, password_hash, role, language_pref)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const result = await query(sql, [name, mobile, email || null, password_hash, role, language_pref]);

    return res.status(201).json({ message: 'User created successfully', id: result.rows[0].id });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id', validateInput(updateUserSchema), async (req, res) => {
  try {
    const { name, mobile, email, role, language_pref } = req.body;
    const sql = `
      UPDATE users 
      SET name = COALESCE(?, name), 
          mobile = COALESCE(?, mobile), 
          email = COALESCE(?, email), 
          role = COALESCE(?, role), 
          language_pref = COALESCE(?, language_pref)
      WHERE id = ?
    `;
    await query(sql, [
      name !== undefined ? name : null,
      mobile !== undefined ? mobile : null,
      email !== undefined ? email : null,
      role !== undefined ? role : null,
      language_pref !== undefined ? language_pref : null,
      req.params.id
    ]);
    return res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await query(`DELETE FROM users WHERE id = ?`, [req.params.id]);
    return res.json({ message: 'User deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// CRUD Departments
router.get('/departments', async (req, res) => {
  try {
    const result = await query(`SELECT * FROM departments ORDER BY id ASC`);
    let depts = result.rows;
    if (!depts || depts.length === 0) {
      const { memStore } = require('../config/db');
      depts = memStore.departments || [];
    }
    return res.json({ departments: depts });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

router.post('/departments', validateInput(createDepartmentSchema), async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await query(`INSERT INTO departments (name, description) VALUES (?, ?)`, [name, description || '']);
    return res.status(201).json({ message: 'Department created', id: result.rows[0].id });
  } catch (err) {
    console.error('Create department error:', err);
    return res.status(500).json({ error: 'Failed to create department' });
  }
});

// ==========================================
// DEPARTMENT HEADS MANAGEMENT ENDPOINTS
// ==========================================

router.get('/department-heads', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    const whereClause = showAll ? '' : "WHERE LOWER(dh.status) = 'active'";
    const sql = `
      SELECT dh.*, d.name as department_name, d.description as department_description,
             u.id as linked_user_id, u.role as user_role, u.status as user_status
      FROM department_heads dh
      LEFT JOIN departments d ON d.id = dh.department_id
      LEFT JOIN users u ON u.id = dh.user_id OR LOWER(u.email) = LOWER(dh.email)
      ${whereClause}
      ORDER BY COALESCE(dh.updated_at, dh.created_at) DESC, dh.id DESC
    `;
    const result = await query(sql);
    let heads = result.rows;
    if (!heads || heads.length === 0) {
      const { memStore } = require('../config/db');
      heads = memStore.department_heads || [];
    }
    return res.json({ department_heads: heads });
  } catch (err) {
    console.error('Error fetching department heads:', err);
    return res.status(500).json({ error: 'Failed to fetch department heads' });
  }
});

// Helper function to resolve string code/name/ID to actual database department ID
async function resolveDepartmentId(deptInput) {
  if (!deptInput) return null;
  if (typeof deptInput === 'number' && !isNaN(deptInput)) return deptInput;
  const parsedNum = Number(deptInput);
  if (!isNaN(parsedNum) && parsedNum > 0) return parsedNum;

  const str = String(deptInput).trim();
  const uuidMap = {
    '8ed9f760-1314-427c-a515-c2a54d6df6d8': 1,
    '9cabc1f2-fd10-48dd-a5cb-01d05197de22': 2,
    'ead370cc-459c-44f0-899f-8a97f0928beb': 3,
    'ee73cb82-cc47-4333-b7d6-4491353c1354': 4,
    '31842723-23ac-490b-912b-9f6d9afbdfb3': 5,
    'ae5e4d0c-996f-4d81-9528-d642664c93ae': 6,
    '71542723-23ac-490b-912b-9f6d9afbdfb7': 7
  };
  if (uuidMap[str.toLowerCase()]) return uuidMap[str.toLowerCase()];

  const deptRes = await query(
    `SELECT id FROM departments WHERE id = ? OR name LIKE ? OR description LIKE ? LIMIT 1`,
    [str, `%${str}%`, `%${str}%`]
  );
  if (deptRes.rows && deptRes.rows.length > 0) {
    return deptRes.rows[0].id;
  }

  const strUpper = str.toUpperCase();
  if (strUpper.includes('SAN')) {
    const r = await query(`SELECT id FROM departments WHERE name LIKE '%Sanitation%' LIMIT 1`);
    if (r.rows && r.rows.length > 0) return r.rows[0].id;
  }
  if (strUpper.includes('WTR') || strUpper.includes('WATER')) {
    const r = await query(`SELECT id FROM departments WHERE name LIKE '%Water%' LIMIT 1`);
    if (r.rows && r.rows.length > 0) return r.rows[0].id;
  }
  if (strUpper.includes('DRN') || strUpper.includes('DRAIN') || strUpper.includes('SEWER')) {
    const r = await query(`SELECT id FROM departments WHERE name LIKE '%Drain%' OR name LIKE '%Sewer%' LIMIT 1`);
    if (r.rows && r.rows.length > 0) return r.rows[0].id;
  }
  if (strUpper.includes('ELE') || strUpper.includes('LIGHT')) {
    const r = await query(`SELECT id FROM departments WHERE name LIKE '%Electric%' OR name LIKE '%Light%' LIMIT 1`);
    if (r.rows && r.rows.length > 0) return r.rows[0].id;
  }
  if (strUpper.includes('TRF') || strUpper.includes('TRAF')) {
    const r = await query(`SELECT id FROM departments WHERE name LIKE '%Traffic%' LIMIT 1`);
    if (r.rows && r.rows.length > 0) return r.rows[0].id;
  }
  if (strUpper.includes('PWD') || strUpper.includes('ROAD') || strUpper.includes('WORK')) {
    const r = await query(`SELECT id FROM departments WHERE name LIKE '%Public Works%' OR name LIKE '%PWD%' LIMIT 1`);
    if (r.rows && r.rows.length > 0) return r.rows[0].id;
  }
  if (strUpper.includes('MNT') || strUpper.includes('MAINT')) {
    const r = await query(`SELECT id FROM departments WHERE name LIKE '%Maintenance%' LIMIT 1`);
    if (r.rows && r.rows.length > 0) return r.rows[0].id;
  }

  return null;
}


// POST Create or Appoint Department Head
router.post('/department-heads', async (req, res) => {
  try {
    const { name, fullName, email, phone, mobile, employeeId, departmentId, designation, password, status = 'active' } = req.body;
    const cleanName = (fullName || name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (mobile || phone || '').trim() || '+91 98220 00000';
    const cleanEmpId = (employeeId || '').trim();
    const cleanDeptId = await resolveDepartmentId(departmentId);

    if (!cleanName || !cleanEmail || !cleanDeptId) {
      return res.status(400).json({ error: 'Name, email, and a valid department selection are required.' });
    }

    // Email Uniqueness Check & User Upsert
    const emailCheck = await query(`SELECT id, email, role FROM users WHERE LOWER(email) = ?`, [cleanEmail]);
    let existingUser = emailCheck.rows && emailCheck.rows.length > 0 ? emailCheck.rows[0] : null;

    // Password Hashing
    let passwordHash = null;
    if (password && password.trim().length >= 6) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
    } else {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash('Nagarsetu@2026', salt);
    }

    let userId;
    if (existingUser) {
      userId = existingUser.id;
      await query(
        `UPDATE users SET name = ?, mobile = ?, email = ?, password_hash = ?, role = 'department_head', department_id = ?, employee_id = ?, status = ? WHERE id = ? OR LOWER(email) = ?`,
        [cleanName, cleanPhone, cleanEmail, passwordHash, cleanDeptId, cleanEmpId, status, userId, cleanEmail]
      );
    } else {
      const insertUserRes = await query(
        `INSERT INTO users (name, mobile, email, password_hash, role, department_id, employee_id, status) VALUES (?, ?, ?, ?, 'department_head', ?, ?, ?)`,
        [cleanName, cleanPhone, cleanEmail, passwordHash, cleanDeptId, cleanEmpId, status]
      );
      userId = insertUserRes.rows[0].id;
    }

    // If status is active, deactivate previous active heads for this department
    if (status === 'active') {
      await query(`UPDATE department_heads SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE department_id = ? AND (user_id != ? AND LOWER(email) != ?)`, [cleanDeptId, userId, cleanEmail]);
      await query(`UPDATE users SET status = 'inactive' WHERE department_id = ? AND role = 'department_head' AND id != ? AND LOWER(email) != ?`, [cleanDeptId, userId, cleanEmail]);
    }

    // Insert or Update department_heads record
    const dhCheck = await query(`SELECT id FROM department_heads WHERE user_id = ? OR email = ?`, [userId, cleanEmail]);
    if (dhCheck.rows && dhCheck.rows.length > 0) {
      await query(
        `UPDATE department_heads SET user_id = ?, department_id = ?, name = ?, email = ?, phone = ?, employee_id = ?, designation = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [userId, cleanDeptId, cleanName, cleanEmail, cleanPhone, cleanEmpId, designation || 'Department Head', status, dhCheck.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO department_heads (user_id, department_id, name, email, phone, employee_id, designation, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, cleanDeptId, cleanName, cleanEmail, cleanPhone, cleanEmpId, designation || 'Department Head', status]
      );
    }

    // Read-back updated department_head record from database
    const readBackRes = await query(
      `SELECT dh.*, d.name as department_name FROM department_heads dh LEFT JOIN departments d ON dh.department_id = d.id WHERE dh.user_id = ? OR dh.email = ?`,
      [userId, cleanEmail]
    );
    const updatedHead = readBackRes.rows && readBackRes.rows.length > 0 ? readBackRes.rows[0] : null;

    return res.status(201).json({
      message: 'Department Head saved successfully',
      department_head: updatedHead,
      user_id: userId,
      department_id: cleanDeptId,
      status
    });
  } catch (err) {
    console.error('Error saving department head:', err);
    return res.status(500).json({ error: 'Failed to save Department Head. Please try again later.' });
  }
});

// PUT Update Department Head by ID
router.put('/department-heads/:id', async (req, res) => {
  try {
    const headId = req.params.id;
    const { name, fullName, email, phone, mobile, employeeId, departmentId, designation, password, status } = req.body;

    const dhRes = await query(`SELECT * FROM department_heads WHERE id = ? OR user_id = ?`, [headId, headId]);
    const uRes = await query(`SELECT * FROM users WHERE id = ? OR email = ?`, [headId, email || '']);

    if ((!dhRes.rows || dhRes.rows.length === 0) && (!uRes.rows || uRes.rows.length === 0)) {
      return res.status(404).json({ error: 'Department Head not found.' });
    }

    const currentHead = dhRes.rows[0] || {};
    const currentUser = uRes.rows[0] || {};
    const targetUserId = currentHead.user_id || currentUser.id;
    const targetEmail = currentHead.email || currentUser.email;

    const newName = (fullName || name || currentHead.name || currentUser.name).trim();
    const newEmail = (email || targetEmail).trim().toLowerCase();
    const newPhone = (mobile || phone || currentHead.phone || currentUser.mobile || '+91 98220 00000').trim();
    const newEmpId = (employeeId !== undefined ? employeeId : (currentHead.employee_id || currentUser.employee_id || '')).trim();
    const newDeptId = departmentId ? (await resolveDepartmentId(departmentId)) : (currentHead.department_id || currentUser.department_id);
    const newStatus = status || currentHead.status || currentUser.status || 'active';

    // Email Uniqueness check if email changed
    if (targetEmail && newEmail !== targetEmail.toLowerCase()) {
      const emailCheck = await query(`SELECT id FROM users WHERE LOWER(email) = ? AND id != ? AND LOWER(email) != ?`, [newEmail, targetUserId, targetEmail.toLowerCase()]);
      if (emailCheck.rows && emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Email address is already in use.' });
      }
    }

    // Password Hash update if provided
    let passwordHash = null;
    if (password && password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    // Update Users Auth Account
    if (passwordHash) {
      await query(
        `UPDATE users SET name = ?, mobile = ?, email = ?, password_hash = ?, department_id = ?, employee_id = ?, status = ? WHERE id = ? OR email = ?`,
        [newName, newPhone, newEmail, passwordHash, newDeptId, newEmpId, newStatus, targetUserId, targetEmail]
      );
    } else {
      await query(
        `UPDATE users SET name = ?, mobile = ?, email = ?, department_id = ?, employee_id = ?, status = ? WHERE id = ? OR email = ?`,
        [newName, newPhone, newEmail, newDeptId, newEmpId, newStatus, targetUserId, targetEmail]
      );
    }

    // Update Department Heads record
    if (currentHead.id) {
      await query(
        `UPDATE department_heads SET name = ?, email = ?, phone = ?, employee_id = ?, department_id = ?, designation = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newName, newEmail, newPhone, newEmpId, newDeptId, designation || currentHead.designation || 'Department Head', newStatus, currentHead.id]
      );
    } else {
      await query(
        `INSERT INTO department_heads (user_id, department_id, name, email, phone, employee_id, designation, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [targetUserId, newDeptId, newName, newEmail, newPhone, newEmpId, designation || 'Department Head', newStatus]
      );
    }

    // Read-back updated department_head record
    const readBackRes = await query(
      `SELECT dh.*, d.name as department_name FROM department_heads dh LEFT JOIN departments d ON dh.department_id = d.id WHERE dh.user_id = ? OR dh.email = ?`,
      [targetUserId, newEmail]
    );
    const updatedHead = readBackRes.rows && readBackRes.rows.length > 0 ? readBackRes.rows[0] : null;

    return res.json({
      message: 'Department Head updated successfully',
      department_head: updatedHead
    });
  } catch (err) {
    console.error('Error updating department head:', err);
    return res.status(500).json({ error: 'Failed to update Department Head. Please try again later.' });
  }
});

// Deactivate Department Head
router.post('/department-heads/:id/deactivate', async (req, res) => {
  try {
    const headId = req.params.id;
    const dhRes = await query(`SELECT * FROM department_heads WHERE id = ? OR user_id = ?`, [headId, headId]);
    if (dhRes.rows && dhRes.rows.length > 0) {
      const head = dhRes.rows[0];
      await query(`UPDATE department_heads SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ? OR user_id = ?`, [headId, headId]);
      await query(`UPDATE users SET status = 'inactive' WHERE id = ? OR email = ?`, [head.user_id, head.email]);
    } else {
      await query(`UPDATE users SET status = 'inactive' WHERE id = ?`, [headId]);
    }
    return res.json({ message: 'Department Head deactivated successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to deactivate Department Head' });
  }
});

// Reactivate Department Head
router.post('/department-heads/:id/reactivate', async (req, res) => {
  try {
    const headId = req.params.id;
    const dhRes = await query(`SELECT * FROM department_heads WHERE id = ? OR user_id = ?`, [headId, headId]);
    if (dhRes.rows && dhRes.rows.length > 0) {
      const head = dhRes.rows[0];
      await query(`UPDATE department_heads SET status = 'inactive' WHERE department_id = ?`, [head.department_id]);
      await query(`UPDATE department_heads SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? OR user_id = ?`, [headId, headId]);
      await query(`UPDATE users SET status = 'active' WHERE id = ? OR email = ?`, [head.user_id, head.email]);
    } else {
      await query(`UPDATE users SET status = 'active' WHERE id = ?`, [headId]);
    }
    return res.json({ message: 'Department Head reactivated successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reactivate Department Head' });
  }
});

// DELETE Department Head by ID or Department ID
router.delete('/department-heads/:id', async (req, res) => {
  try {
    const paramId = req.params.id;
    if (!paramId) {
      return res.status(400).json({ error: 'Department Head ID or Department selection is required.' });
    }

    // Try finding by department_heads.id, user_id, or department_id
    let dhRes = await query(
      `SELECT * FROM department_heads WHERE id = ? OR user_id = ? OR department_id = ?`,
      [paramId, paramId, paramId]
    );

    // If not found directly, try resolving department ID string/code
    if ((!dhRes.rows || dhRes.rows.length === 0) && isNaN(Number(paramId))) {
      const cleanDeptId = await resolveDepartmentId(paramId);
      if (cleanDeptId) {
        dhRes = await query(`SELECT * FROM department_heads WHERE department_id = ?`, [cleanDeptId]);
      }
    }

    if (!dhRes.rows || dhRes.rows.length === 0) {
      // Check if user table has a department_head for this ID/department
      const uRes = await query(
        `SELECT * FROM users WHERE (id = ? OR department_id = ?) AND role = 'department_head'`,
        [paramId, paramId]
      );
      if (!uRes.rows || uRes.rows.length === 0) {
        return res.status(404).json({ error: 'Department Head not found.' });
      }
    }

    // Filter active head records
    const allRecords = dhRes.rows || [];
    const activeHead = allRecords.find((r) => r.status === 'active') || allRecords[0];

    if (allRecords.length > 0 && allRecords.every((r) => r.status !== 'active')) {
      // All head records for this department/head are already inactive
      return res.status(400).json({ error: 'Department Head is already unassigned.' });
    }

    const headIdToDeactivate = activeHead?.id;
    const userIdToDetach = activeHead?.user_id;
    const deptIdToDetach = activeHead?.department_id || paramId;
    const targetEmail = activeHead?.email;

    // 1. Update department_heads table to set status = 'inactive'
    if (headIdToDeactivate) {
      await query(
        `UPDATE department_heads SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ? OR department_id = ?`,
        [headIdToDeactivate, deptIdToDetach]
      );
    } else {
      await query(
        `UPDATE department_heads SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE department_id = ?`,
        [deptIdToDetach]
      );
    }

    // 2. Update users table: remove department_head role and detach department_id
    if (userIdToDetach || targetEmail) {
      await query(
        `UPDATE users SET role = 'citizen', department_id = NULL WHERE id = ? OR LOWER(email) = LOWER(?)`,
        [userIdToDetach || -1, targetEmail || '']
      );
    } else {
      await query(
        `UPDATE users SET role = 'citizen', department_id = NULL WHERE department_id = ? AND role = 'department_head'`,
        [deptIdToDetach]
      );
    }

    return res.json({
      success: true,
      message: 'Department Head removed successfully'
    });
  } catch (err) {
    console.error('Error deleting department head:', err);
    return res.status(500).json({ error: 'Unable to remove Department Head. Please try again.' });
  }
});

module.exports = router;

