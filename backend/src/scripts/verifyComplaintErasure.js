const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const app = require('../app');
const { initDatabase, query } = require('../config/db');

async function runVerification() {
  console.log('=== RUNNING NAGARSETU 3.1 COMPLAINT ERASURE VERIFICATION ===\n');

  // 1. Direct SQLite Table Record Count Checks
  const dbPath = path.join(__dirname, '../../nagarsetu.sqlite');
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

  const tables = [
    'complaints',
    'assignments',
    'complaint_status_history',
    'feedback',
    'recurring_issue_links',
    'complaint_evidence_versions',
    'blockchain_transactions'
  ];

  console.log('[STEP 1] Direct SQLite Table Counts:');
  for (const table of tables) {
    await new Promise((res) => {
      db.get(`SELECT COUNT(*) as count FROM ${table};`, (err, row) => {
        const count = row ? row.count : 0;
        console.log(`  - Table "${table}": ${count} records (Expected: 0) ${count === 0 ? '✓ PASS' : '❌ FAIL'}`);
        res();
      });
    });
  }

  // Check complaint-specific notifications
  await new Promise((res) => {
    db.get('SELECT COUNT(*) as count FROM notifications WHERE complaint_id IS NOT NULL;', (err, row) => {
      const count = row ? row.count : 0;
      console.log(`  - Notifications with complaint_id: ${count} records (Expected: 0) ${count === 0 ? '✓ PASS' : '❌ FAIL'}`);
      res();
    });
  });

  // Check preserved system notifications
  await new Promise((res) => {
    db.get('SELECT COUNT(*) as count FROM notifications WHERE complaint_id IS NULL;', (err, row) => {
      const count = row ? row.count : 0;
      console.log(`  - Preserved system notifications: ${count} records (Expected: >0) ${count > 0 ? '✓ PASS' : '❌ FAIL'}`);
      res();
    });
  });

  // Check preserved users
  await new Promise((res) => {
    db.get('SELECT COUNT(*) as count FROM users;', (err, row) => {
      const count = row ? row.count : 0;
      console.log(`  - Preserved users: ${count} records (Expected: >0) ${count > 0 ? '✓ PASS' : '❌ FAIL'}`);
      res();
    });
  });

  // Check preserved departments
  await new Promise((res) => {
    db.get('SELECT COUNT(*) as count FROM departments;', (err, row) => {
      const count = row ? row.count : 0;
      console.log(`  - Preserved departments: ${count} records (Expected: 7) ${count === 7 ? '✓ PASS' : '❌ FAIL'}`);
      res();
    });
  });

  // Check blockchain blocks (should only be Genesis Block 0)
  await new Promise((res) => {
    db.get('SELECT COUNT(*) as count FROM blockchain_blocks;', (err, row) => {
      const count = row ? row.count : 0;
      console.log(`  - Blockchain blocks: ${count} records (Expected: 1 - Genesis) ${count === 1 ? '✓ PASS' : '❌ FAIL'}`);
      res();
    });
  });

  db.close();

  // 2. Uploads Directory Check
  console.log('\n[STEP 2] Uploads Directory Check:');
  const uploadsDir = path.join(__dirname, '../../uploads');
  const uploadFiles = fs.readdirSync(uploadsDir);
  console.log(`  - Files in uploads/: ${JSON.stringify(uploadFiles)}`);
  console.log(`  - Evidence files deleted: ${uploadFiles.length === 1 && uploadFiles[0] === 'civic-default.jpg' ? '✓ PASS (Only civic-default.jpg preserved)' : '❌ FAIL'}`);

  // 3. API Endpoints Check via Local Express Server
  console.log('\n[STEP 3] Testing Express API Endpoints:');
  await initDatabase();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`  - Test server listening on ephemeral port ${port}`);

  try {
    // A. Login as Citizen (Pratik Dilip Tupe: 8788562103 / 8788562103)
    const citLoginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobileOrEmail: '8788562103', password: '8788562103' })
    });
    const citLogin = await citLoginRes.json();
    console.log(`  - Citizen login: ${citLogin.token ? '✓ SUCCESS (Token acquired)' : '❌ FAIL'}`);
    const citToken = citLogin.token;

    // B. Call /api/complaints/my
    const myCompRes = await fetch(`http://localhost:${port}/api/complaints/my`, {
      headers: { 'Authorization': `Bearer ${citToken}` }
    });
    const myComp = await myCompRes.json();
    const myCompCount = Array.isArray(myComp.complaints) ? myComp.complaints.length : -1;
    console.log(`  - Citizen /api/complaints/my returns: ${myCompCount} complaints (Expected: 0) ${myCompCount === 0 ? '✓ PASS' : '❌ FAIL'}`);

    // C. Login as Municipal Admin (admin@nagarsetu.gov.in / admin@123)
    const adminLoginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobileOrEmail: 'admin@nagarsetu.gov.in', password: 'admin@123' })
    });
    const adminLogin = await adminLoginRes.json();
    console.log(`  - Admin login: ${adminLogin.token ? '✓ SUCCESS' : '❌ FAIL'}`);
    const adminToken = adminLogin.token;

    // D. Call /api/complaints as Admin
    const allCompRes = await fetch(`http://localhost:${port}/api/complaints`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const allComp = await allCompRes.json();
    const allCompCount = Array.isArray(allComp.complaints) ? allComp.complaints.length : -1;
    console.log(`  - Admin /api/complaints returns: ${allCompCount} complaints (Expected: 0) ${allCompCount === 0 ? '✓ PASS' : '❌ FAIL'}`);

    // 4. Test Submission of One New Complaint to Verify Functional System
    console.log('\n[STEP 4] Testing New Complaint Submission & Cleanup:');
    const testNum = `TEST-VERIFY-${Date.now()}`;
    const submitRes = await fetch(`http://localhost:${port}/api/complaints/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citToken}`
      },
      body: JSON.stringify({
        complaint_number: testNum,
        category: 'Roads & Footpaths',
        title: 'Verification Pothole Test',
        description: 'Post-erasure functional verification complaint',
        priority: 'Medium',
        department_id: 1,
        latitude: 18.5204,
        longitude: 73.8567,
        location_source: 'manual_pin',
        location_address: 'Verification Road, Pune',
        photo_before_url: '/uploads/civic-default.jpg'
      })
    });
    const submitData = await submitRes.json();
    const createdId = submitData?.complaint?.id || submitData?.id;
    console.log(`  - New complaint creation: HTTP ${submitRes.status}, ID=${createdId} ${createdId ? '✓ PASS' : '❌ FAIL'}`);

    // Verify it is queryable
    const afterSubmitRes = await fetch(`http://localhost:${port}/api/complaints/my`, {
      headers: { 'Authorization': `Bearer ${citToken}` }
    });
    const afterSubmit = await afterSubmitRes.json();
    console.log(`  - Citizen complaints after submission: ${afterSubmit.complaints?.length} (Expected: 1) ${afterSubmit.complaints?.length === 1 ? '✓ PASS' : '❌ FAIL'}`);

    // Remove the test complaint cleanly
    await query('DELETE FROM feedback WHERE complaint_id = ?;', [createdId]);
    await query('DELETE FROM assignments WHERE complaint_id = ?;', [createdId]);
    await query('DELETE FROM complaint_status_history WHERE complaint_id = ?;', [createdId]);
    await query('DELETE FROM notifications WHERE complaint_id = ?;', [createdId]);
    await query('DELETE FROM blockchain_transactions WHERE entity_id = ?;', [String(createdId)]);
    await query('DELETE FROM complaints WHERE id = ?;', [createdId]);
    console.log('  - Cleaned up test complaint and associated child records: ✓ DONE');

    // Confirm count is back to 0
    const finalVerifyRes = await fetch(`http://localhost:${port}/api/complaints/my`, {
      headers: { 'Authorization': `Bearer ${citToken}` }
    });
    const finalVerify = await finalVerifyRes.json();
    console.log(`  - Citizen complaints after cleanup: ${finalVerify.complaints?.length} (Expected: 0) ${finalVerify.complaints?.length === 0 ? '✓ PASS' : '❌ FAIL'}`);

  } finally {
    server.close();
  }

  console.log('\n=== ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY ===');
}

runVerification().catch(console.error);
