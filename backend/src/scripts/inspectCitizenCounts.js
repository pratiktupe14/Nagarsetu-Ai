const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../frontend/.env') });
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();

async function inspectCitizenCounts() {
  const dbPath = path.join(__dirname, '../../nagarsetu.sqlite');
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

  console.log('--- SQLITE CITIZEN COMPLAINT BREAKDOWN ---');
  await new Promise(r => {
    db.all("SELECT citizen_id, COUNT(*) as count FROM complaints GROUP BY citizen_id", (err, rows) => {
      console.log('Complaints by citizen_id in SQLite:', rows);
      r();
    });
  });

  await new Promise(r => {
    db.all("SELECT status, COUNT(*) as count FROM complaints GROUP BY status", (err, rows) => {
      console.log('Complaints by status in SQLite:', rows);
      r();
    });
  });

  // Check blockchain tables
  await new Promise(r => {
    db.all("SELECT * FROM blockchain_transactions LIMIT 5", (err, rows) => {
      console.log('Sample blockchain_transactions in SQLite:', rows);
      r();
    });
  });

  await new Promise(r => {
    db.all("SELECT * FROM blockchain_blocks LIMIT 3", (err, rows) => {
      console.log('Sample blockchain_blocks in SQLite:', rows);
      r();
    });
  });

  // Check super_admin_audit_logs
  await new Promise(r => {
    db.all("SELECT target_type, COUNT(*) as count FROM super_admin_audit_logs GROUP BY target_type", (err, rows) => {
      console.log('super_admin_audit_logs by target_type in SQLite:', rows);
      r();
    });
  });

  db.close();

  // Supabase
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: supaGroups } = await supabase.from('complaints').select('status, citizen_id');
    console.log('\n--- SUPABASE COMPLAINT SUMMARY ---');
    console.log('Total Supabase complaints:', supaGroups?.length);
    const statusCounts = {};
    const citizenCounts = {};
    (supaGroups || []).forEach(c => {
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      citizenCounts[c.citizen_id] = (citizenCounts[c.citizen_id] || 0) + 1;
    });
    console.log('Supabase by status:', statusCounts);
    console.log('Supabase by citizen_id:', citizenCounts);

    // Let's check storage bucket 'issues' directly
    const { data: issuesFiles, error: issuesErr } = await supabase.storage.from('issues').list('');
    console.log('\n--- SUPABASE STORAGE "issues" BUCKET ---');
    if (issuesErr) {
      console.log('Error listing root of issues bucket:', issuesErr.message);
    } else {
      console.log('Issues root files count:', issuesFiles?.length, issuesFiles);
    }

    const { data: uploadFiles, error: uploadErr } = await supabase.storage.from('issues').list('uploads');
    if (uploadErr) {
      console.log('Error listing issues/uploads:', uploadErr.message);
    } else {
      console.log('Issues uploads files count:', uploadFiles?.length);
      if (uploadFiles && uploadFiles.length > 0) {
        console.log('Sample uploads files:', uploadFiles.slice(0, 5));
      }
    }
  }
}

inspectCitizenCounts().catch(console.error);
