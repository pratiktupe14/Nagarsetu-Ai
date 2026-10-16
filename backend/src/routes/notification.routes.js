const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const validateInput = require('../middleware/validateInput');
const { markReadSchema } = require('../schemas/notification.schemas');
const { query } = require('../config/db');

router.use(authenticateToken);

// Get user notifications
router.get('/my', async (req, res) => {
  try {
    const sql = `
      SELECT n.*, c.title as complaint_title
      FROM notifications n
      LEFT JOIN complaints c ON n.complaint_id = c.id
      WHERE n.user_id = ?
      ORDER BY n.sent_at DESC
      LIMIT 50
    `;
    const result = await query(sql, [req.user.id]);
    return res.json({ notifications: result.rows });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notifications read
router.post('/mark-read', validateInput(markReadSchema), async (req, res) => {
  try {
    const { notification_id } = req.body;
    if (notification_id) {
      await query(`UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?`, [notification_id, req.user.id]);
    } else {
      await query(`UPDATE notifications SET is_read = TRUE WHERE user_id = ?`, [req.user.id]);
    }
    return res.json({ message: 'Notifications marked as read' });
  } catch (err) {
    console.error('Mark read notifications error:', err);
    return res.status(500).json({ error: 'Failed to update notifications' });
  }
});

module.exports = router;
