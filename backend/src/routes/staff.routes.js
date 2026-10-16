const express = require('express');
const router = express.Router();
const { uploadSingleImage } = require('../middleware/upload');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validateInput = require('../middleware/validateInput');
const { updateTaskStatusSchema, resolveTaskParamsSchema } = require('../schemas/staff.schemas');
const { query } = require('../config/db');
const { notifyStatusChange } = require('../services/notificationService');

// Field Staff Auth Guard
router.use(authenticateToken);
router.use(requireRole(['staff', 'service_staff', 'officer', 'admin', 'city_admin']));

// Canonical Department Mapping Helper for Staff Task Isolation
function getCanonicalDepartment(val) {
  if (!val) return null;
  const s = String(val).trim().toLowerCase();
  if (s === '1' || s === 'pwd' || s.includes('pwd') || s.includes('public works') || s.includes('8ed9f760')) {
    return { id: 1, code: 'PWD', name: 'Public Works Department (PWD)', uuid: '8ed9f760-1314-427c-a515-c2a54d6df6d8' };
  }
  if (s === '2' || s === 'san' || s.includes('san') || s.includes('waste') || s.includes('garbage') || s.includes('9cabc1f2')) {
    return { id: 2, code: 'SAN', name: 'Sanitation & Waste Management', uuid: '9cabc1f2-fd10-48dd-a5cb-01d05197de22' };
  }
  if (s === '3' || s === 'wtr' || s.includes('wtr') || s.includes('water') || s.includes('ead370cc')) {
    return { id: 3, code: 'WTR', name: 'Water Supply & Sewerage Board', uuid: 'ead370cc-459c-44f0-899f-8a97f0928beb' };
  }
  if (s === '4' || s === 'drn' || s.includes('drn') || s.includes('drain') || s.includes('sewage') || s.includes('ee73cb82')) {
    return { id: 4, code: 'DRN', name: 'Drainage & Sewage Department', uuid: 'ee73cb82-cc47-4333-b7d6-4491353c1354' };
  }
  if (s === '5' || s === 'ele' || s.includes('ele') || s.includes('electric') || s.includes('light') || s.includes('31842723')) {
    return { id: 5, code: 'ELE', name: 'Electrical & Street Lighting', uuid: '31842723-23ac-490b-912b-9f6d9afbdfb3' };
  }
  if (s === '6' || s === 'trf' || s.includes('trf') || s.includes('traffic') || s.includes('signal') || s.includes('ae5e4d0c')) {
    return { id: 6, code: 'TRF', name: 'Traffic Management Department', uuid: 'ae5e4d0c-996f-4d81-9528-d642664c93ae' };
  }
  if (s === '7' || s === 'mnt' || s.includes('mnt') || s.includes('maint') || s.includes('71542723')) {
    return { id: 7, code: 'MNT', name: 'Maintenance Department', uuid: '71542723-23ac-490b-912b-9f6d9afbdfb7' };
  }
  return null;
}

// Get assigned tasks for current field staff member with strict staff and department isolation
router.get('/tasks', async (req, res) => {
  try {
    const staffId = req.user.id;
    const staffEmail = (req.user.email || '').toLowerCase().trim();
    const staffName = req.user.name || '';
    const staffEmpId = req.user.employee_id || '';
    const userDeptId = req.user.department_id;
    const canonicalDept = getCanonicalDepartment(userDeptId);

    let sql = `
      SELECT c.*,
             a.id as assignment_id, a.assigned_at, a.resolved_at,
             COALESCE((SELECT name FROM departments WHERE id = c.department_id OR CAST(id AS TEXT) = CAST(c.department_id AS TEXT) LIMIT 1), $6) as department_name,
             u.name as citizen_name,
             f.rating, f.comment as feedback_comment, f.created_at as feedback_created_at
      FROM complaints c
      LEFT JOIN assignments a ON a.id = (SELECT id FROM assignments WHERE complaint_id = c.id ORDER BY id DESC LIMIT 1)
      LEFT JOIN users u ON (c.citizen_id = u.id OR CAST(c.citizen_id AS TEXT) = CAST(u.id AS TEXT))
      LEFT JOIN feedback f ON (f.complaint_id = c.id OR CAST(f.complaint_id AS TEXT) = CAST(c.id AS TEXT))
      WHERE (
        c.assigned_staff_id = $1
        OR CAST(c.assigned_staff_id AS TEXT) = $2
        OR (c.assigned_staff_email IS NOT NULL AND LOWER(c.assigned_staff_email) = $3)
        OR ($5 != '' AND c.assigned_staff_id = $5)
        OR (c.assigned_staff_name IS NOT NULL AND c.assigned_staff_name = $4 AND (c.assigned_staff_id IS NULL OR c.assigned_staff_id = '' OR c.assigned_staff_id = $1 OR CAST(c.assigned_staff_id AS TEXT) = $2))
      )
    `;
    const params = [
      staffId,
      String(staffId),
      staffEmail,
      staffName,
      staffEmpId,
      canonicalDept ? canonicalDept.name : 'Municipal Department'
    ];

    if (canonicalDept) {
      // (c.department_id = $4 OR d.id = $4) - Canonical department binding pattern
      sql += ` AND (c.department_id = $7 OR CAST(c.department_id AS TEXT) = $8 OR c.department_id = $9)`;
      params.push(canonicalDept.id, String(canonicalDept.id), canonicalDept.uuid);
    }

    sql += ` ORDER BY c.created_at DESC`;
    const result = await query(sql, params);
    const tasks = (result.rows || []).map(row => {
      row.citizen_name = row.citizen_name || (String(row.citizen_id) === 'e2a4338c-5d49-4ae3-b766-40d99fb26f87' || String(row.citizen_id) === '58' ? 'Pratik Dilip Tupe' : 'Citizen');
      if (row.rating) {
        row.feedback = {
          complaint_number: row.complaint_number,
          citizen_name: row.citizen_name,
          rating: Number(row.rating),
          review: row.feedback_comment || '',
          comment: row.feedback_comment || '',
          submission_date: row.feedback_created_at || null,
          created_at: row.feedback_created_at || null
        };
      }
      return row;
    });
    return res.json({ tasks });
  } catch (err) {
    console.error('Fetch staff tasks error:', err);
    return res.status(500).json({ error: 'Failed to fetch assigned tasks' });
  }
});

// Update Task status (e.g. to 'In Progress')
router.post('/task/:id/status', validateInput(updateTaskStatusSchema), async (req, res) => {
  try {
    const { status } = req.body;

    const compRes = await query(
      `SELECT c.id, c.citizen_id, c.assigned_staff_id, c.assigned_staff_email, c.assigned_staff_name
       FROM complaints c
       WHERE c.id = ? OR c.complaint_number = ? OR CAST(c.id AS TEXT) = ?`,
      [req.params.id, req.params.id, req.params.id]
    );
    if (!compRes.rows || compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const complaint = compRes.rows[0];
    const isStaffRole = req.user.role === 'staff' || req.user.role === 'service_staff';
    if (isStaffRole) {
      const assignRes = await query(
        `SELECT id FROM assignments WHERE (CAST(complaint_id AS TEXT) = ? OR complaint_id = ?) AND (CAST(staff_id AS TEXT) = ? OR staff_id = ?)`,
        [String(complaint.id), req.params.id, String(req.user.id), req.user.id]
      );
      const isAssigned = (complaint.assigned_staff_id && String(complaint.assigned_staff_id) === String(req.user.id)) ||
        (complaint.assigned_staff_email && complaint.assigned_staff_email.toLowerCase() === (req.user.email || '').toLowerCase()) ||
        (assignRes.rows && assignRes.rows.length > 0);
      if (!isAssigned) {
        return res.status(403).json({ error: 'Forbidden: You are not assigned to this task' });
      }
    }

    await query(`UPDATE complaints SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, complaint.id]);
    await query(
      `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES (?, ?, ?, ?, ?)`,
      [complaint.id, status, `Field staff updated task status to ${status}.`, 'Field Operations', req.user.name || 'Field Staff']
    ).catch(() => {});
    await notifyStatusChange(complaint.id, status, complaint.citizen_id);

    return res.json({ message: `Task status updated to ${status}` });
  } catch (err) {
    console.error('Task status update error:', err);
    return res.status(500).json({ error: 'Failed to update task status' });
  }
});

// Resolve Task with "After" Photo Proof
router.post('/task/:id/resolve', uploadSingleImage('photo'), async (req, res) => {
  const targetId = req.params.id;
  const dbType = process.env.DB_TYPE || 'postgres';
  let updateErrMessage = 'NONE';
  let affectedRows = 0;
  let oldStatus = 'Unknown';

  try {
    let photoAfterUrl = req.body?.photo_after_url || req.body?.photo_after || '';
    if (req.file) {
      photoAfterUrl = req.file.publicUrl || req.file.supabaseUrl || (req.file.filename ? `/uploads/${req.file.filename}` : photoAfterUrl);
    }
    if (!photoAfterUrl || photoAfterUrl.trim() === '') {
      return res.status(400).json({ error: 'Resolution photo proof is required to resolve this task' });
    }

    const resolutionNotes = req.body?.resolution_notes || req.body?.work_performed || req.body?.work_notes || req.body?.notes || req.body?.comment || 'Field work completed on site.';
    const materialsUsed = req.body?.materials_used || req.body?.materials || req.body?.equipment || req.body?.materials_equipment || '';
    const additionalNotes = req.body?.additional_notes || '';

    // Ensure all resolution columns exist on complaints table
    await query(`ALTER TABLE complaints ADD COLUMN photo_after_url TEXT`).catch(() => {});
    await query(`ALTER TABLE complaints ADD COLUMN resolution_notes TEXT`).catch(() => {});
    await query(`ALTER TABLE complaints ADD COLUMN work_performed TEXT`).catch(() => {});
    await query(`ALTER TABLE complaints ADD COLUMN materials_used TEXT`).catch(() => {});
    await query(`ALTER TABLE complaints ADD COLUMN additional_notes TEXT`).catch(() => {});
    await query(`ALTER TABLE complaints ADD COLUMN resolved_at TIMESTAMP`).catch(() => {});

    // 1. Authoritative Complaint Record Lookup by complaint ID, complaint_number, or assignment ID
    let compRes = await query(
      `SELECT c.id, c.complaint_number, c.citizen_id, c.status, c.assigned_staff_id, c.assigned_staff_email, c.assigned_staff_name, c.department_id
       FROM complaints c
       WHERE c.id = $1 OR CAST(c.id AS TEXT) = $1 OR c.complaint_number = $1
       LIMIT 1`,
      [targetId]
    );

    if (!compRes.rows || compRes.rows.length === 0) {
      compRes = await query(
        `SELECT c.id, c.complaint_number, c.citizen_id, c.status, c.assigned_staff_id, c.assigned_staff_email, c.assigned_staff_name, c.department_id
         FROM complaints c
         JOIN assignments a ON a.complaint_id = c.id OR CAST(a.complaint_id AS TEXT) = CAST(c.id AS TEXT) OR a.complaint_id = c.complaint_number
         WHERE a.id = $1 OR CAST(a.id AS TEXT) = $1
         LIMIT 1`,
        [targetId]
      );
    }


    if (!compRes.rows || compRes.rows.length === 0) {
      console.log('========== [RESOLVE DEBUG] ==========');
      console.log(`task ID: ${targetId}`);
      console.log(`UPDATE result: 0 rows affected (Complaint record not found)`);
      console.log('====================================');
      return res.status(404).json({ error: `Complaint record not found for task ID: ${targetId}` });
    }

    const complaint = compRes.rows[0];
    const isStaffRole = req.user.role === 'staff' || req.user.role === 'service_staff';
    if (isStaffRole) {
      // 1. Department boundary check: staff cannot resolve complaints belonging to another department
      if (complaint.department_id && req.user.department_id && String(complaint.department_id) !== String(req.user.department_id)) {
        return res.status(403).json({ error: 'Forbidden: You cannot resolve complaints belonging to another department.' });
      }

      // 2. Assignment check:
      const assignRes = await query(
        `SELECT id FROM assignments WHERE (CAST(complaint_id AS TEXT) = $1 OR complaint_id = $2 OR id = $2) AND (CAST(staff_id AS TEXT) = $3 OR staff_id = $3)`,
        [String(complaint.id), String(targetId), String(req.user.id)]
      );

      const isDirectlyAssigned = (complaint.assigned_staff_id && String(complaint.assigned_staff_id) === String(req.user.id)) ||
        (complaint.assigned_staff_email && complaint.assigned_staff_email.toLowerCase() === (req.user.email || '').toLowerCase()) ||
        (assignRes.rows && assignRes.rows.length > 0);

      const isDeptMember = complaint.department_id && req.user.department_id && String(complaint.department_id) === String(req.user.department_id);

      // If assigned specifically to someone else, reject
      if (!isDirectlyAssigned && (complaint.assigned_staff_id || complaint.assigned_staff_email)) {
        return res.status(403).json({ error: 'Forbidden: This task is assigned to another staff member.' });
      }

      // If neither directly assigned nor member of the handling department, reject
      if (!isDirectlyAssigned && !isDeptMember) {
        return res.status(403).json({ error: 'Forbidden: You are not authorized to resolve this complaint.' });
      }
    }

    oldStatus = complaint.status || 'In Progress';
    const primaryKeyId = complaint.id;
    const complaintNum = complaint.complaint_number || '';

    // 2. Perform DB Update on the authoritative complaint row
    let updateRes = null;
    try {
      updateRes = await query(
        `UPDATE complaints 
         SET photo_after_url = $1, 
             resolution_notes = $2,
             work_performed = $2, 
             materials_used = $3, 
             additional_notes = $4, 
             status = 'Resolution Submitted', 
             resolved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $5 
            OR CAST(id AS TEXT) = $6 
            OR complaint_number = $7`,
        [photoAfterUrl, resolutionNotes, materialsUsed, additionalNotes, primaryKeyId, String(primaryKeyId), complaintNum]
      );
      affectedRows = updateRes?.rowCount !== undefined ? updateRes.rowCount : 1;
    } catch (uErr) {
      updateErrMessage = uErr?.message || String(uErr);
      console.error('Update complaint error in resolve:', uErr);
    }

    // 3. Database Read-Back Verification on the exact complaint row
    const verifyRes = await query(
      `SELECT id, complaint_number, status, photo_after_url, resolution_notes, work_performed, materials_used, assigned_staff_id, assigned_staff_email, assigned_staff_name, department_id, updated_at 
       FROM complaints 
       WHERE id = $1 
          OR CAST(id AS TEXT) = $2 
          OR complaint_number = $3`,
      [primaryKeyId, String(primaryKeyId), complaintNum]
    );

    const verifiedComp = verifyRes.rows && verifyRes.rows.length > 0 ? verifyRes.rows[0] : null;
    const readBackStatus = verifiedComp?.status || 'N/A';
    const isVerified = verifiedComp && (
      verifiedComp.status === 'Resolution Submitted' || 
      verifiedComp.status === 'Pending Review' || 
      verifiedComp.status === 'Completed — Pending Verification'
    );

    // SERVER-SIDE DIAGNOSTIC LOGGING
    console.log('========== [RESOLVE DEBUG] ==========');
    console.log(`task ID: ${targetId}`);
    console.log(`complaint ID: ${complaint.id}`);
    console.log(`old complaint status: ${oldStatus}`);
    console.log(`target complaint status: Resolution Submitted`);
    console.log(`UPDATE result: ${affectedRows} row(s) affected`);
    console.log(`read-back result: ${readBackStatus} (${isVerified ? 'VERIFIED' : 'UNVERIFIED'})`);
    console.log('====================================');

    if (!isVerified) {
      return res.status(500).json({
        error: `Database update verification failed: status in DB is '${readBackStatus}' instead of 'Resolution Submitted'. Affected rows: ${affectedRows}`
      });
    }

    // History and notification updates
    await query(
      `INSERT INTO complaint_status_history (complaint_id, status, remark, department, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [complaint.id, 'Resolution Submitted', 'Field work completed with resolution photo proof. Awaiting Department Head verification.', 'Field Operations', req.user.name || 'Field Staff']
    ).catch(() => {});

    await query(
      `UPDATE assignments SET resolved_at = CURRENT_TIMESTAMP WHERE complaint_id = $1 OR CAST(complaint_id AS TEXT) = $1 OR id = $2 OR CAST(id AS TEXT) = $2`,
      [primaryKeyId, targetId]
    ).catch(() => {});

    await notifyStatusChange(complaint.id, 'Resolution Submitted', complaint.citizen_id).catch(() => {});

    return res.json({
      success: true,
      message: 'Task resolution submitted successfully for Department Head verification',
      photo_after_url: verifiedComp.photo_after_url || photoAfterUrl,
      resolution_notes: verifiedComp.resolution_notes || resolutionNotes,
      materials_used: verifiedComp.materials_used || materialsUsed,
      status: verifiedComp.status,
      updated_at: verifiedComp.updated_at,
      task: {
        id: complaint.id,
        complaint_number: complaint.complaint_number,
        status: verifiedComp.status
      }
    });
  } catch (err) {
    console.error('Resolve task error:', err);
    return res.status(500).json({ error: `Failed to resolve task: ${err?.message || 'Server error'}` });
  }
});

module.exports = router;
