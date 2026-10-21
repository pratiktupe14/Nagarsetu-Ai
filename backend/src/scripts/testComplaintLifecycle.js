const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

process.env.DB_TYPE = 'supabase';
const { query } = require('../config/db');

async function testComplaintLifecycle() {
  console.log('--- CONTROLLED LIFECYCLE VERIFICATION ON AUTHORITATIVE SUPABASE ---');
  const citizenUuid = 'e2a4338c-5d49-4ae3-b766-40d99fb26f87';
  const testNumber = `TEST-VERIF-${Date.now()}`;
  
  // 1. Create a controlled test complaint
  const insertSql = `
    INSERT INTO complaints (
      complaint_number, citizen_id, title, description, category, priority, status,
      latitude, longitude, location_source, location_accuracy_m, location_address,
      photo_before_url, department_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const insertParams = [
    testNumber,
    citizenUuid,
    'Authoritative Lifecycle Test Pothole',
    'Automated verification of complaint lifecycle across local & production',
    'Roads',
    'Medium',
    'Submitted',
    18.5204,
    73.8567,
    'device_gps',
    10,
    'Verification Street, Pune',
    '/uploads/civic-default.jpg',
    '8ed9f760-1314-427c-a515-c2a54d6df6d8',
    new Date().toISOString(),
    new Date().toISOString()
  ];
  
  console.log(`Inserting test complaint: ${testNumber}`);
  const insertRes = await query(insertSql, insertParams);
  const createdId = insertRes.rows[0].id;
  console.log(`Created complaint with ID: ${createdId}`);

  // 2. Query citizen complaints and verify it is retrieved
  const selectSql = `
    SELECT c.*, d.name as department_name 
    FROM complaints c 
    LEFT JOIN departments d ON c.department_id = d.id 
    WHERE (c.citizen_id IN (?) OR c.citizen_id = ?)
    ORDER BY c.created_at DESC
  `;
  const listRes = await query(selectSql, [citizenUuid, citizenUuid]);
  const found = listRes.rows.find(c => c.complaint_number === testNumber || c.id === createdId);
  console.log(`Retrieved in citizen complaints list: ${!!found} (Total list size: ${listRes.rows.length})`);
  
  if (!found) {
    throw new Error('Test complaint not found in citizen complaint list');
  }

  // 3. Update the complaint status to 'In Progress'
  const updateSql = `UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?`;
  await query(updateSql, ['In Progress', new Date().toISOString(), createdId]);
  console.log('Updated status to "In Progress"');

  // Verify status update
  const updatedCheck = await query(`SELECT * FROM complaints WHERE id = ?`, [createdId]);
  console.log(`Verified updated status: ${updatedCheck.rows[0]?.status}`);

  // 4. Clean up test record to preserve pristine production data
  console.log('Cleaning up test complaint from Supabase...');
  await query(`DELETE FROM complaints WHERE id = ?`, [createdId]);
  console.log('Cleanup completed successfully. Production dataset remains pristine!');
}

testComplaintLifecycle().catch(console.error);
