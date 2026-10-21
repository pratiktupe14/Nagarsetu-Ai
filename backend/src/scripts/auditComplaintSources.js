const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../../frontend/.env') });
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();

async function runAudit() {
  const report = {
    sqlite: {},
    supabase: {},
    storage: {},
    uploadsDir: {}
  };

  console.log('=== STARTING READ-ONLY COMPLAINT DATA AUDIT ===\n');

  // 1. Audit SQLite database
  const sqlitePath = path.join(__dirname, '../../nagarsetu.sqlite');
  report.sqlite.path = sqlitePath;
  report.sqlite.exists = fs.existsSync(sqlitePath);
  if (report.sqlite.exists) {
    report.sqlite.fileSize = fs.statSync(sqlitePath).size;
    await new Promise((resolve) => {
      const db = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY, async (err) => {
        if (err) {
          report.sqlite.error = err.message;
          return resolve();
        }

        // Get all tables
        db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", async (tErr, tables) => {
          if (tErr) {
            report.sqlite.error = tErr.message;
            db.close();
            return resolve();
          }

          report.sqlite.tables = {};
          const tableNames = tables.map(t => t.name);

          for (const tableName of tableNames) {
            await new Promise((resTable) => {
              db.get(`SELECT COUNT(*) as count FROM "${tableName}"`, (cErr, row) => {
                if (!cErr && row) {
                  report.sqlite.tables[tableName] = row.count;
                } else {
                  report.sqlite.tables[tableName] = `Error: ${cErr?.message}`;
                }
                resTable();
              });
            });
          }

          // Specific check for notifications linked to complaints vs general
          if (tableNames.includes('notifications')) {
            await new Promise((resNotif) => {
              db.get("SELECT COUNT(*) as count FROM notifications WHERE complaint_id IS NOT NULL", (err, row) => {
                report.sqlite.complaintNotifications = row ? row.count : 0;
                resNotif();
              });
            });
            await new Promise((resNotif) => {
              db.get("SELECT COUNT(*) as count FROM notifications WHERE complaint_id IS NULL", (err, row) => {
                report.sqlite.otherNotifications = row ? row.count : 0;
                resNotif();
              });
            });
          }

          // Sample complaints if any
          if (tableNames.includes('complaints')) {
            await new Promise((resComp) => {
              db.all("SELECT id, complaint_number, citizen_id, title, status, category, created_at FROM complaints LIMIT 5", (err, rows) => {
                report.sqlite.sampleComplaints = rows || [];
                resComp();
              });
            });
          }

          db.close();
          resolve();
        });
      });
    });
  }

  // 2. Audit Supabase PostgreSQL database
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  report.supabase.url = supabaseUrl;
  report.supabase.hasKey = !!supabaseKey;

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const targetTables = [
        'complaints',
        'assignments',
        'feedback',
        'complaint_status_history',
        'recurring_issue_links',
        'complaint_evidence_versions',
        'notifications',
        'users',
        'departments',
        'department_heads',
        'announcements',
        'announcement_reads',
        'super_admin_audit_logs',
        'profiles'
      ];

      report.supabase.tables = {};

      for (const t of targetTables) {
        try {
          const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
          if (error) {
            report.supabase.tables[t] = `Error: ${error.message}`;
          } else {
            report.supabase.tables[t] = count;
          }
        } catch (e) {
          report.supabase.tables[t] = `Exception: ${e.message}`;
        }
      }

      // Check complaint-specific notifications in Supabase
      try {
        const { count: compNotifCount } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).not('complaint_id', 'is', null);
        report.supabase.complaintNotifications = compNotifCount || 0;
        const { count: nullNotifCount } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).is('complaint_id', null);
        report.supabase.otherNotifications = nullNotifCount || 0;
      } catch (e) {}

      // Sample complaints in Supabase
      try {
        const { data: supaComplaints } = await supabase.from('complaints').select('id, complaint_number, citizen_id, title, status, category, created_at').limit(5);
        report.supabase.sampleComplaints = supaComplaints || [];
      } catch (e) {}

      // 3. Audit Supabase Storage
      try {
        const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
        if (bErr) {
          report.storage.error = bErr.message;
        } else {
          report.storage.buckets = buckets.map(b => b.name);
          report.storage.files = {};

          for (const b of buckets) {
            try {
              const { data: files, error: fErr } = await supabase.storage.from(b.name).list('', { limit: 100 });
              if (fErr) {
                report.storage.files[b.name] = `Error: ${fErr.message}`;
              } else {
                report.storage.files[b.name] = files.map(f => ({ name: f.name, id: f.id, metadata: f.metadata }));
                // Also check 'uploads' subfolder if present
                const { data: uploadFiles } = await supabase.storage.from(b.name).list('uploads', { limit: 100 });
                if (uploadFiles && uploadFiles.length > 0) {
                  report.storage.files[`${b.name}/uploads`] = uploadFiles.map(f => ({ name: f.name, id: f.id }));
                }
              }
            } catch (fe) {
              report.storage.files[b.name] = `Exception: ${fe.message}`;
            }
          }
        }
      } catch (sErr) {
        report.storage.error = sErr.message;
      }

    } catch (e) {
      report.supabase.error = e.message;
    }
  }

  // 4. Audit local backend/uploads
  const uploadsPath = path.join(__dirname, '../../uploads');
  if (fs.existsSync(uploadsPath)) {
    const files = fs.readdirSync(uploadsPath);
    report.uploadsDir.count = files.length;
    let totalSize = 0;
    for (const f of files) {
      try {
        totalSize += fs.statSync(path.join(uploadsPath, f)).size;
      } catch (e) {}
    }
    report.uploadsDir.totalSizeBytes = totalSize;
    report.uploadsDir.sampleFiles = files.slice(0, 10);
  } else {
    report.uploadsDir.exists = false;
  }

  console.log(JSON.stringify(report, null, 2));
}

runAudit().catch(console.error);
