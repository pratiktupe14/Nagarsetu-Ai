const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../frontend/.env') });
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();

async function executeErasure() {
  console.log('================================================================');
  console.log('  STARTING NAGARSETU 3.1 PERMANENT COMPLAINT DATA ERASURE');
  console.log('================================================================\n');

  const auditResults = {
    sqlite: {},
    supabase: {},
    uploads: {},
    storage: {}
  };

  // -------------------------------------------------------------
  // 1. Local SQLite Database Erasure
  // -------------------------------------------------------------
  const dbPath = path.join(__dirname, '../../nagarsetu.sqlite');
  if (fs.existsSync(dbPath)) {
    console.log(`[SQLITE] Processing database at: ${dbPath}`);
    const db = new sqlite3.Database(dbPath);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        // Run as a single transaction
        db.run('BEGIN TRANSACTION;');

        // Delete child / dependent tables first
        db.run('DELETE FROM feedback;', function(err) {
          if (err) console.error('[SQLITE] Error deleting feedback:', err.message);
          else auditResults.sqlite.feedbackDeleted = this.changes;
        });

        db.run('DELETE FROM assignments;', function(err) {
          if (err) console.error('[SQLITE] Error deleting assignments:', err.message);
          else auditResults.sqlite.assignmentsDeleted = this.changes;
        });

        db.run('DELETE FROM complaint_status_history;', function(err) {
          if (err) console.error('[SQLITE] Error deleting complaint_status_history:', err.message);
          else auditResults.sqlite.statusHistoryDeleted = this.changes;
        });

        db.run('DELETE FROM recurring_issue_links;', function(err) {
          if (err) console.error('[SQLITE] Error deleting recurring_issue_links:', err.message);
          else auditResults.sqlite.recurringLinksDeleted = this.changes;
        });

        db.run('DELETE FROM complaint_evidence_versions;', function(err) {
          if (err) console.error('[SQLITE] Error deleting complaint_evidence_versions:', err.message);
          else auditResults.sqlite.evidenceVersionsDeleted = this.changes;
        });

        db.run('DELETE FROM notifications WHERE complaint_id IS NOT NULL;', function(err) {
          if (err) console.error('[SQLITE] Error deleting complaint notifications:', err.message);
          else auditResults.sqlite.complaintNotificationsDeleted = this.changes;
        });

        db.run("DELETE FROM blockchain_transactions WHERE entity_type IN ('complaint', 'evidence', 'location');", function(err) {
          if (err) console.error('[SQLITE] Error deleting blockchain_transactions:', err.message);
          else auditResults.sqlite.blockchainTransactionsDeleted = this.changes;
        });

        db.run("DELETE FROM super_admin_audit_logs WHERE target_type = 'complaint';", function(err) {
          if (err) console.error('[SQLITE] Error deleting super_admin_audit_logs:', err.message);
          else auditResults.sqlite.auditLogsDeleted = this.changes;
        });

        // Reset blockchain blocks to Genesis Block (Block 0) only
        db.run('DELETE FROM blockchain_blocks WHERE block_number > 0;', function(err) {
          if (err) console.error('[SQLITE] Error trimming blockchain_blocks:', err.message);
          else auditResults.sqlite.blockchainBlocksTrimmed = this.changes;
        });

        // Delete parent complaints table
        db.run('DELETE FROM complaints;', function(err) {
          if (err) {
            console.error('[SQLITE] Error deleting complaints:', err.message);
            db.run('ROLLBACK;');
            return reject(err);
          }
          auditResults.sqlite.complaintsDeleted = this.changes;
        });

        // Reset autoincrement sequence counters for cleared complaint tables
        db.run(
          "DELETE FROM sqlite_sequence WHERE name IN ('complaints', 'assignments', 'complaint_status_history', 'feedback', 'recurring_issue_links', 'complaint_evidence_versions', 'blockchain_transactions');",
          function(err) {
            if (err) console.warn('[SQLITE] Sequence reset note:', err.message);
          }
        );

        db.run('COMMIT;', (commitErr) => {
          if (commitErr) {
            console.error('[SQLITE] Transaction commit error:', commitErr.message);
            return reject(commitErr);
          }
          console.log('[SQLITE] Transaction successfully committed.');

          // Post-deletion verification query in SQLite
          db.get('SELECT COUNT(*) as count FROM complaints;', (cErr, cRow) => {
            auditResults.sqlite.remainingComplaints = cRow ? cRow.count : 0;
            db.get('SELECT COUNT(*) as count FROM assignments;', (aErr, aRow) => {
              auditResults.sqlite.remainingAssignments = aRow ? aRow.count : 0;
              db.get('SELECT COUNT(*) as count FROM complaint_status_history;', (hErr, hRow) => {
                auditResults.sqlite.remainingStatusHistory = hRow ? hRow.count : 0;
                db.get('SELECT COUNT(*) as count FROM feedback;', (fErr, fRow) => {
                  auditResults.sqlite.remainingFeedback = fRow ? fRow.count : 0;
                  db.get('SELECT COUNT(*) as count FROM notifications WHERE complaint_id IS NOT NULL;', (nErr, nRow) => {
                    auditResults.sqlite.remainingComplaintNotifications = nRow ? nRow.count : 0;
                    db.get('SELECT COUNT(*) as count FROM notifications WHERE complaint_id IS NULL;', (snErr, snRow) => {
                      auditResults.sqlite.preservedSystemNotifications = snRow ? snRow.count : 0;
                      db.get('SELECT COUNT(*) as count FROM users;', (uErr, uRow) => {
                        auditResults.sqlite.preservedUsers = uRow ? uRow.count : 0;
                        db.get('SELECT COUNT(*) as count FROM departments;', (dErr, dRow) => {
                          auditResults.sqlite.preservedDepartments = dRow ? dRow.count : 0;

                          // Execute VACUUM to reclaim disk space and purge free list pages
                          db.run('VACUUM;', (vErr) => {
                            if (vErr) console.warn('[SQLITE] VACUUM note:', vErr.message);
                            else console.log('[SQLITE] Database VACUUM completed successfully.');
                            db.close();
                            resolve();
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  // -------------------------------------------------------------
  // 2. Supabase PostgreSQL Erasure
  // -------------------------------------------------------------
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log(`\n[SUPABASE] Connecting to Supabase at: ${supabaseUrl}`);
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      // 1. Delete dependent tables if they have rows
      try { await supabase.from('feedback').delete().not('id', 'is', null); } catch (e) {}
      try { await supabase.from('assignments').delete().not('id', 'is', null); } catch (e) {}
      try { await supabase.from('complaint_status_history').delete().not('id', 'is', null); } catch (e) {}
      try { await supabase.from('notifications').delete().not('complaint_id', 'is', null); } catch (e) {}

      // 2. Delete all complaints
      const { count: beforeSupaCount } = await supabase.from('complaints').select('*', { count: 'exact', head: true });
      auditResults.supabase.complaintsBefore = beforeSupaCount || 0;

      const { error: delErr } = await supabase.from('complaints').delete().not('id', 'is', null);
      if (delErr) {
        console.warn('[SUPABASE] Notice on primary delete:', delErr.message);
        // Fallback filter
        await supabase.from('complaints').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }

      // Check remaining
      const { count: afterSupaCount } = await supabase.from('complaints').select('*', { count: 'exact', head: true });
      auditResults.supabase.remainingComplaints = afterSupaCount || 0;

      const { count: afterHistoryCount } = await supabase.from('complaint_status_history').select('*', { count: 'exact', head: true });
      auditResults.supabase.remainingStatusHistory = afterHistoryCount || 0;

      const { count: supaUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
      auditResults.supabase.preservedUsers = supaUsers || 0;

      const { count: supaProfiles } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
      auditResults.supabase.preservedProfiles = supaProfiles || 0;

      const { count: supaDepts } = await supabase.from('departments').select('*', { count: 'exact', head: true });
      auditResults.supabase.preservedDepartments = supaDepts || 0;

      console.log(`[SUPABASE] Erasure completed. Remaining complaints in Supabase: ${auditResults.supabase.remainingComplaints}`);
    } catch (supaErr) {
      console.error('[SUPABASE] Supabase erasure exception:', supaErr.message);
      auditResults.supabase.error = supaErr.message;
    }

    // -------------------------------------------------------------
    // 3. Supabase Storage Erasure
    // -------------------------------------------------------------
    try {
      const { data: issuesFiles } = await supabase.storage.from('issues').list('uploads');
      if (issuesFiles && issuesFiles.length > 0) {
        const filePaths = issuesFiles.map(f => `uploads/${f.name}`);
        await supabase.storage.from('issues').remove(filePaths);
        auditResults.storage.supabaseFilesDeleted = filePaths.length;
        console.log(`[SUPABASE STORAGE] Removed ${filePaths.length} objects from 'issues' bucket.`);
      } else {
        auditResults.storage.supabaseFilesDeleted = 0;
      }
    } catch (storageErr) {
      console.warn('[SUPABASE STORAGE] Cleanup note:', storageErr.message);
    }
  }

  // -------------------------------------------------------------
  // 4. Local Filesystem Evidence Uploads Erasure
  // -------------------------------------------------------------
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (fs.existsSync(uploadsDir)) {
    console.log(`\n[UPLOADS] Purging complaint evidence files in: ${uploadsDir}`);
    const files = fs.readdirSync(uploadsDir);
    let deletedCount = 0;
    let preservedCount = 0;

    for (const f of files) {
      if (f.toLowerCase() === 'civic-default.jpg') {
        preservedCount++;
        console.log(`[UPLOADS] PRESERVED core system asset: ${f}`);
        continue;
      }
      try {
        const filePath = path.join(uploadsDir, f);
        fs.unlinkSync(filePath);
        deletedCount++;
      } catch (e) {
        console.warn(`[UPLOADS] Could not delete ${f}:`, e.message);
      }
    }

    auditResults.uploads.deletedFiles = deletedCount;
    auditResults.uploads.preservedFiles = preservedCount;
    const remainingFiles = fs.readdirSync(uploadsDir);
    auditResults.uploads.remainingFiles = remainingFiles;
    console.log(`[UPLOADS] Deleted ${deletedCount} evidence files. Remaining in uploads/: ${remainingFiles.join(', ')}`);
  }

  console.log('\n================================================================');
  console.log('  PERMANENT COMPLAINT DATA ERASURE COMPLETE — AUDIT SUMMARY');
  console.log('================================================================');
  console.log(JSON.stringify(auditResults, null, 2));

  return auditResults;
}

executeErasure().catch(console.error);
