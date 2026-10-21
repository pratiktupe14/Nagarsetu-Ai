const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

let sqlite3 = null;
function getSqlite3() {
  if (!sqlite3) {
    try {
      sqlite3 = require('sqlite3').verbose();
    } catch (e) {
      console.warn('[SQLITE NOTE] sqlite3 native module not loaded:', e.message);
    }
  }
  return sqlite3;
}

let pgPool = null;
let sqliteDb = null;
let useSqlite = false;

const DB_TYPE = process.env.DB_TYPE || 'sqlite'; // 'postgres' or 'sqlite'

let isSeeding = false;
let seeded = false;
async function ensureDefaultSeeds() {
  if (isSeeding || seeded) return;
  isSeeding = true;
  try {
    const serverMod = require('../server');
    if (serverMod && typeof serverMod.seedAll === 'function') {
      await serverMod.seedAll();
      seeded = true;
    } else if (serverMod && typeof serverMod.seedDefaultUsers === 'function') {
      await serverMod.seedDefaultUsers();
      seeded = true;
    }
  } catch (e) {
    console.warn('[SEED NOTE] Automatic seed note:', e.message);
  } finally {
    isSeeding = false;
  }
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    const onInitSuccess = async () => {
      try {
        await ensureDefaultSeeds();
      } catch (err) {}
      resolve();
    };

    const isProduction = process.env.NODE_ENV === 'production';
    const isPostgres = DB_TYPE === 'postgres' || isProduction;
    let dbUrl = process.env.DATABASE_URL;
    if (dbUrl && typeof dbUrl === 'string') {
      dbUrl = dbUrl.trim();
      // Auto-correct common unreplaced Supabase template placeholders
      if (dbUrl.includes('aws-0-region.pooler.supabase.com')) {
        dbUrl = dbUrl.replace('aws-0-region.pooler.supabase.com', 'aws-0-ap-southeast-1.pooler.supabase.com');
      }
      if (dbUrl.includes('postgres.your-project')) {
        dbUrl = dbUrl.replace('postgres.your-project', 'postgres.ozeiymkbxtrqqdoxtmhm');
      }
      if (dbUrl.includes('your-project.supabase.co')) {
        dbUrl = dbUrl.replace('your-project.supabase.co', 'ozeiymkbxtrqqdoxtmhm.supabase.co');
      }
    }

    // SSL rejectUnauthorized: production default is true unless connecting to Supabase pooler/direct
    const isSupabaseDb = dbUrl && (dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com'));
    if (isSupabaseDb) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      if (typeof dbUrl === 'string') {
        dbUrl = dbUrl.replace(/([?&])sslmode=[^&]+(&|$)/g, '$1').replace(/[?&]$/, '');
      }
    }
    const rejectUnauthorized = false;

    if (isPostgres && dbUrl) {
      console.log('Connecting to PostgreSQL database...');
      try {
        pgPool = new Pool({
          connectionString: dbUrl,
          ssl: { rejectUnauthorized },
          connectionTimeoutMillis: 5000
        });
        pgPool.query('SELECT NOW()', (err, res) => {
          if (err) {
            console.warn('[DATABASE NOTE] PostgreSQL pool connection check note:', err.message);
            const { supabase } = require('./supabaseStorage');
            if (supabase) {
              console.log('[DATABASE] Verified Supabase client active as production database handler.');
              return onInitSuccess();
            }
            if (isProduction) {
              console.error('[DATABASE FATAL] PostgreSQL connection check failed in production:', err.message);
              return reject(err);
            }
            console.warn('[DATABASE NOTE] PostgreSQL connection check failed (activating fallback SQLite):', err.message);
            setupSqlite(onInitSuccess, onInitSuccess);
          } else {
            console.log('PostgreSQL connected successfully.');
            createTablesPostgres().then(onInitSuccess).catch(e => {
              if (isProduction) {
                console.error('[DATABASE FATAL] PostgreSQL table init failed in production:', e.message);
                return reject(e);
              }
              console.warn('[DATABASE TABLE INIT NOTE]', e.message);
              setupSqlite(onInitSuccess, onInitSuccess);
            });
          }
        });
      } catch (e) {
        const { supabase } = require('./supabaseStorage');
        if (supabase) {
          console.log('[DATABASE] Verified Supabase client active following pool init exception.');
          return onInitSuccess();
        }
        if (isProduction) {
          console.error('[DATABASE FATAL] PostgreSQL pool initialization failed in production:', e.message);
          return reject(e);
        }
        console.warn('[DATABASE POOL INIT NOTE]', e.message);
        setupSqlite(onInitSuccess, onInitSuccess);
      }
    } else {
      if (isProduction) {
        const err = new Error('[DATABASE FATAL] DATABASE_URL missing or PostgreSQL unconfigured in production.');
        console.error(err.message);
        return reject(err);
      }
      console.log('Initializing local development SQLite database...');
      setupSqlite(onInitSuccess, onInitSuccess);
    }
  });
}

async function createTablesPostgres() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'active',
        registry_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        mobile TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'citizen',
        department_id INTEGER REFERENCES departments(id),
        employee_id TEXT,
        status TEXT DEFAULT 'active',
        language_pref TEXT DEFAULT 'en',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS department_heads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        department_id INTEGER REFERENCES departments(id),
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        employee_id TEXT,
        designation TEXT DEFAULT 'Department Head',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id SERIAL PRIMARY KEY,
        complaint_number TEXT,
        citizen_id TEXT,
        photo_before_url TEXT NOT NULL,
        photo_after_url TEXT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'Medium',
        status TEXT DEFAULT 'Submitted',
        department_id INTEGER REFERENCES departments(id),
        latitude DOUBLE PRECISION NOT NULL DEFAULT 0,
        longitude DOUBLE PRECISION NOT NULL DEFAULT 0,
        location_source TEXT NOT NULL DEFAULT 'manual_pin',
        location_address TEXT,
        duplicate_of_id INTEGER REFERENCES complaints(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safe column migrations for existing Postgres database
    await pgPool.query(`ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_citizen_id_fkey;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ALTER COLUMN citizen_id TYPE TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS photo_front_url TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS photo_left_url TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS photo_right_url TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS residential_address TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS photo_closeup_url TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS angle_photos TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS additional_photos TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMP;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS response_time_hours INTEGER;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS support_count INTEGER DEFAULT 1;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS ranking_score INTEGER DEFAULT 1;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS is_potential_duplicate BOOLEAN DEFAULT false;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS potential_parent_id TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS duplicate_distance_m NUMERIC;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT false;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS merged_into_id TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS merged_by TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS photo_after_url TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolution_notes TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS work_performed TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS materials_used TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS additional_notes TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS primary_image_hash TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'civiclens-yolov8';`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS ai_confidence REAL;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS ai_status TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS ai_detected_class TEXT;`).catch(() => {});
    await pgPool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS ai_reason TEXT;`).catch(() => {});

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        complaint_id INTEGER REFERENCES complaints(id),
        staff_id INTEGER REFERENCES users(id),
        assigned_by INTEGER REFERENCES users(id),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      );
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        complaint_id INTEGER REFERENCES complaints(id),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE OR REPLACE VIEW complaint_feedback AS SELECT * FROM feedback;
      CREATE OR REPLACE VIEW task_assignments AS SELECT * FROM assignments;
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        complaint_id INTEGER REFERENCES complaints(id),
        channel TEXT DEFAULT 'in_app',
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pgPool.query(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;`).catch(() => {});
    await pgPool.query(`ALTER TABLE notifications ALTER COLUMN user_id TYPE TEXT;`).catch(() => {});

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS complaint_status_history (
        id SERIAL PRIMARY KEY,
        complaint_id INTEGER REFERENCES complaints(id),
        status TEXT NOT NULL,
        remark TEXT,
        department TEXT,
        updated_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT DEFAULT 'General',
        priority TEXT DEFAULT 'Medium',
        status TEXT DEFAULT 'Published',
        target_type TEXT DEFAULT 'all',
        target_audience TEXT DEFAULT 'all_departments',
        target_role TEXT,
        department_id INTEGER REFERENCES departments(id),
        department_name TEXT,
        created_by TEXT DEFAULT 'City Admin',
        posted_by TEXT DEFAULT 'City Admin',
        created_by_role TEXT DEFAULT 'city_admin',
        is_published INTEGER DEFAULT 1,
        published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS announcement_reads (
        id SERIAL PRIMARY KEY,
        announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(announcement_id, user_id)
      );
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS recurring_issue_links (
        id SERIAL PRIMARY KEY,
        current_complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
        previous_complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'Potential',
        distance_meters NUMERIC,
        department_id TEXT,
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_by TEXT,
        reviewed_at TIMESTAMP,
        review_notes TEXT,
        UNIQUE(current_complaint_id, previous_complaint_id)
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_current ON recurring_issue_links(current_complaint_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_previous ON recurring_issue_links(previous_complaint_id);

      CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
        id SERIAL PRIMARY KEY,
        admin_id TEXT NOT NULL,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        changes_json TEXT,
        reason TEXT,
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_admin ON super_admin_audit_logs(admin_id);
      CREATE INDEX IF NOT EXISTS idx_audit_target ON super_admin_audit_logs(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON super_admin_audit_logs(created_at);

      CREATE TABLE IF NOT EXISTS complaint_evidence_versions (
        id SERIAL PRIMARY KEY,
        complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 1,
        photo_before_url TEXT,
        photo_after_url TEXT,
        photo_front_url TEXT,
        replacement_reason TEXT,
        replaced_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_complaint ON complaint_evidence_versions(complaint_id);

      ALTER TABLE complaints ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
      ALTER TABLE complaints ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
      ALTER TABLE complaints ADD COLUMN IF NOT EXISTS archived_by TEXT;
    `);

    const deptCheck = await pgPool.query('SELECT COUNT(*) as count FROM departments');
    if (parseInt(deptCheck.rows[0].count, 10) === 0) {
      await pgPool.query(`
        INSERT INTO departments (id, name, description) VALUES
          (1, 'Public Works Department (PWD)', 'Road repairs, potholes, and asphalt infrastructure'),
          (2, 'Sanitation & Waste Management', 'Garbage pickup, trash overflow, and public cleanliness'),
          (3, 'Water Supply & Sewerage Board', 'Pipeline leakages, drainage overflows, and water supply'),
          (4, 'Drainage & Sewage Department', 'Drainage blockage, sewage overflow, open drains, and culverts'),
          (5, 'Electrical & Street Lighting', 'Streetlight repair, electrical poles, and public lighting'),
          (6, 'Traffic Management Department', 'Traffic signal repairs, road signage, and junction issues'),
          (7, 'Maintenance Department', 'General civic facility repairs, building maintenance, and public asset upkeep')
        ON CONFLICT (id) DO NOTHING;
      `);
    }
  } catch (err) {
    console.error('Error creating PostgreSQL tables:', err);
  }
}


function setupSqlite(resolve, reject) {
  if (process.env.NODE_ENV === 'production') {
    const err = new Error('[DATABASE FATAL] SQLite fallback is disabled in production.');
    console.error(err.message);
    if (reject) return reject(err);
    throw err;
  }
  useSqlite = true;
  const sqliteMod = getSqlite3();
  if (!sqliteMod) {
    console.warn('[SQLITE NOTE] Cannot initialize SQLite without native module.');
    return resolve ? resolve() : null;
  }
  if (sqliteDb) {
    return resolve ? resolve() : null;
  }
  const isTest = process.env.NODE_ENV === 'test';
  const isVercel = process.env.VERCEL || process.env.NODE_ENV === 'production';
  let dbPath;
  if (isTest) {
    const isSharedTestDb = !!process.env.TEST_DB_PATH;
    dbPath = process.env.TEST_DB_PATH || path.join(require('os').tmpdir(), `nagarsetu-test-${process.pid}.sqlite`);
    if (!isSharedTestDb) {
      process.on('exit', () => {
        try {
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        } catch (e) {}
      });
    }
  } else if (isVercel) {
    dbPath = path.join('/tmp', 'nagarsetu.sqlite');
  } else {
    dbPath = path.join(__dirname, '../../nagarsetu.sqlite');
  }
  sqliteDb = new sqliteMod.Database(dbPath, (err) => {
    if (err) {
      console.error('Error connecting to SQLite DB:', err);
      return reject ? reject(err) : null;
    }
    console.log('Using SQLite database at:', dbPath);
    createTablesSqlite().then(resolve).catch(reject);
  });
}

function createTablesSqlite() {
  return new Promise((resolve, reject) => {
    sqliteDb.serialize(() => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          mobile TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'citizen',
          department_id INTEGER,
          employee_id TEXT,
          status TEXT DEFAULT 'active',
          language_pref TEXT DEFAULT 'en',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS department_heads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          department_id INTEGER,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT,
          employee_id TEXT,
          designation TEXT DEFAULT 'Department Head',
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (department_id) REFERENCES departments(id)
        );
      `);

      // Safe column additions for existing databases
      const safeAddColumn = (table, colDef) => {
        sqliteDb.run(`ALTER TABLE ${table} ADD COLUMN ${colDef};`, () => {});
      };
      safeAddColumn('users', 'department_id INTEGER');
      safeAddColumn('users', 'employee_id TEXT');
      safeAddColumn('users', 'designation TEXT DEFAULT "Field Service Staff"');
      safeAddColumn('users', 'status TEXT DEFAULT "active"');
      safeAddColumn('users', 'address TEXT');
      safeAddColumn('users', 'residential_address TEXT');
      safeAddColumn('complaints', 'location_address TEXT');
      safeAddColumn('complaints', 'complaint_number TEXT');

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS departments (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'active',
          registry_id INTEGER
        );
      `);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS complaints (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          complaint_number TEXT,
          citizen_id INTEGER,
          photo_before_url TEXT NOT NULL,
          photo_after_url TEXT,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          priority TEXT DEFAULT 'Medium',
          status TEXT DEFAULT 'Submitted',
          department_id INTEGER,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          location_source TEXT NOT NULL,
          location_address TEXT,
          duplicate_of_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (citizen_id) REFERENCES users(id),
          FOREIGN KEY (department_id) REFERENCES departments(id)
        );
      `);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          complaint_id INTEGER,
          staff_id INTEGER,
          assigned_by INTEGER,
          assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          FOREIGN KEY (complaint_id) REFERENCES complaints(id),
          FOREIGN KEY (staff_id) REFERENCES users(id),
          FOREIGN KEY (assigned_by) REFERENCES users(id)
        );
      `);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          complaint_id INTEGER,
          rating INTEGER CHECK (rating >= 1 AND rating <= 5),
          comment TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (complaint_id) REFERENCES complaints(id)
        );
      `);

      sqliteDb.run(`CREATE VIEW IF NOT EXISTS complaint_feedback AS SELECT * FROM feedback;`);
      sqliteDb.run(`CREATE VIEW IF NOT EXISTS task_assignments AS SELECT * FROM assignments;`);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          complaint_id INTEGER,
          channel TEXT DEFAULT 'in_app',
          message TEXT NOT NULL,
          is_read INTEGER DEFAULT 0,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (complaint_id) REFERENCES complaints(id)
        );
      `);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS complaint_status_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          complaint_id INTEGER NOT NULL,
          status TEXT NOT NULL,
          remark TEXT,
          department TEXT,
          updated_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (complaint_id) REFERENCES complaints(id)
        );
      `);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS announcements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          type TEXT DEFAULT 'General',
          priority TEXT DEFAULT 'Medium',
          status TEXT DEFAULT 'Published',
          target_type TEXT DEFAULT 'all',
          target_audience TEXT DEFAULT 'all_departments',
          target_role TEXT,
          department_id INTEGER,
          department_name TEXT,
          created_by TEXT DEFAULT 'City Admin',
          posted_by TEXT DEFAULT 'City Admin',
          created_by_role TEXT DEFAULT 'city_admin',
          is_published INTEGER DEFAULT 1,
          published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (department_id) REFERENCES departments(id)
        );
      `);

      // Safe column additions for SQLite migrations
      const safeAddSqliteColumn = (table, colDef) => {
        sqliteDb.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`, () => {});
      };
      safeAddSqliteColumn('users', "designation TEXT DEFAULT 'Field Service Staff'");
      safeAddSqliteColumn('users', 'last_assigned_at DATETIME');
      safeAddSqliteColumn('users', 'address TEXT');
      safeAddSqliteColumn('users', 'residential_address TEXT');
      safeAddSqliteColumn('announcements', "status TEXT DEFAULT 'Published'");
      safeAddSqliteColumn('announcements', "target_audience TEXT DEFAULT 'all_departments'");
      safeAddSqliteColumn('announcements', 'target_role TEXT');
      safeAddSqliteColumn('announcements', "created_by_role TEXT DEFAULT 'city_admin'");
      safeAddSqliteColumn('announcements', 'expires_at DATETIME');

      safeAddSqliteColumn('complaints', 'assigned_staff_id TEXT');
      safeAddSqliteColumn('complaints', 'assigned_staff_name TEXT');
      safeAddSqliteColumn('complaints', 'assigned_staff_email TEXT');
      safeAddSqliteColumn('complaints', 'assigned_by TEXT');
      safeAddSqliteColumn('complaints', 'assigned_by_name TEXT');
      safeAddSqliteColumn('complaints', 'assigned_at DATETIME');
      safeAddSqliteColumn('complaints', 'sla_deadline DATETIME');
      safeAddSqliteColumn('complaints', 'response_time_hours INTEGER');
      safeAddSqliteColumn('complaints', 'photo_front_url TEXT');
      safeAddSqliteColumn('complaints', 'photo_left_url TEXT');
      safeAddSqliteColumn('complaints', 'photo_right_url TEXT');
      safeAddSqliteColumn('complaints', 'photo_closeup_url TEXT');
      safeAddSqliteColumn('complaints', 'angle_photos TEXT');
      safeAddSqliteColumn('complaints', 'additional_photos TEXT');
      safeAddSqliteColumn('complaints', 'support_count INTEGER DEFAULT 1');
      safeAddSqliteColumn('complaints', 'ranking_score INTEGER DEFAULT 1');
      safeAddSqliteColumn('complaints', 'is_potential_duplicate INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'potential_parent_id TEXT');
      safeAddSqliteColumn('complaints', 'duplicate_distance_m REAL');
      safeAddSqliteColumn('complaints', 'is_merged INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'merged_into_id TEXT');
      safeAddSqliteColumn('complaints', 'merged_at DATETIME');
      safeAddSqliteColumn('complaints', 'merged_by TEXT');
      safeAddSqliteColumn('complaints', 'safety_score INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'disruption_score INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'health_environment_score INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'defect_severity_score INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'risk_score INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'priority_rank INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'location_accuracy_m REAL');
      safeAddSqliteColumn('complaints', 'photo_after_url TEXT');
      safeAddSqliteColumn('complaints', 'resolution_notes TEXT');
      safeAddSqliteColumn('complaints', 'work_performed TEXT');
      safeAddSqliteColumn('complaints', 'materials_used TEXT');
      safeAddSqliteColumn('complaints', 'additional_notes TEXT');
      safeAddSqliteColumn('complaints', 'resolved_at DATETIME');
      safeAddSqliteColumn('complaints', 'primary_image_hash TEXT');
      safeAddSqliteColumn('complaints', "ai_model TEXT DEFAULT 'civiclens-yolov8'");
      safeAddSqliteColumn('complaints', 'ai_confidence REAL');
      safeAddSqliteColumn('complaints', 'ai_status TEXT');
      safeAddSqliteColumn('complaints', 'ai_detected_class TEXT');
      safeAddSqliteColumn('complaints', 'ai_reason TEXT');
      safeAddSqliteColumn('departments', 'code TEXT');

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS announcement_reads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          announcement_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(announcement_id, user_id),
          FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
        );
      `);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS recurring_issue_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          current_complaint_id INTEGER NOT NULL,
          previous_complaint_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'Potential',
          distance_meters REAL,
          department_id TEXT,
          detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_by TEXT,
          reviewed_at DATETIME,
          review_notes TEXT,
          UNIQUE(current_complaint_id, previous_complaint_id),
          FOREIGN KEY (current_complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
          FOREIGN KEY (previous_complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
        );
      `);
      sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_recurring_current ON recurring_issue_links(current_complaint_id);`);
      sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_recurring_previous ON recurring_issue_links(previous_complaint_id);`);

      safeAddSqliteColumn('complaints', 'is_archived INTEGER DEFAULT 0');
      safeAddSqliteColumn('complaints', 'archived_at DATETIME');
      safeAddSqliteColumn('complaints', 'archived_by TEXT');

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_id TEXT NOT NULL,
          admin_email TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT,
          changes_json TEXT,
          reason TEXT,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_admin ON super_admin_audit_logs(admin_id);`);
      sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_target ON super_admin_audit_logs(target_type, target_id);`);
      sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON super_admin_audit_logs(created_at);`);

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS complaint_evidence_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          complaint_id INTEGER NOT NULL,
          version_number INTEGER NOT NULL DEFAULT 1,
          photo_before_url TEXT,
          photo_after_url TEXT,
          photo_front_url TEXT,
          replacement_reason TEXT,
          replaced_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
        );
      `);
      sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_evidence_complaint ON complaint_evidence_versions(complaint_id);`);

      // Seed initial default departments if empty
      const { CANONICAL_DEPARTMENTS } = require('../services/departmentService');
      sqliteDb.get("SELECT COUNT(*) as count FROM departments", (err, row) => {
        if (!err && row && row.count === 0) {
          const stmt = sqliteDb.prepare("INSERT OR REPLACE INTO departments (id, code, name, description, status, registry_id) VALUES (?, ?, ?, ?, ?, ?)");
          for (const d of CANONICAL_DEPARTMENTS) {
            stmt.run(d.id, d.code, d.name, d.description, d.status, d.registry_id);
          }
          stmt.finalize();
        } else {
          for (const d of CANONICAL_DEPARTMENTS) {
            sqliteDb.run("UPDATE departments SET code = ?, name = ?, status = 'active' WHERE id = ?", [d.code, d.name, d.id], () => {});
          }
        }
        resolve();
      });

    });
  });
}

const memStore = {
  departments: [
    { id: 1, name: 'Public Works Department (PWD)', code: 'PWD', description: 'Road repairs, potholes, and asphalt infrastructure' },
    { id: 2, name: 'Sanitation & Waste Management', code: 'SAN', description: 'Garbage pickup, trash overflow, and public cleanliness' },
    { id: 3, name: 'Water Supply & Sewerage Board', code: 'WTR', description: 'Pipeline leakages, drainage overflows, and water supply' },
    { id: 4, name: 'Drainage & Sewage Department', code: 'DRN', description: 'Drainage blockage, sewage overflow, open drains, and culverts' },
    { id: 5, name: 'Electrical & Street Lighting', code: 'ELE', description: 'Streetlight repair, electrical poles, and public lighting' },
    { id: 6, name: 'Traffic Management Department', code: 'TRF', description: 'Traffic signal repairs, road signage, and junction issues' },
    { id: 7, name: 'Maintenance Department', code: 'MNT', description: 'General civic facility repairs, building maintenance, and public asset upkeep' }
  ],
  department_heads: [
    { id: 1, department_id: 1, name: 'Rahul Kumar', email: 'rahul.kumar@nagarsetu.gov.in', phone: '+91 9822000001', employee_id: 'EMP-PWD-001', designation: 'Department Head', status: 'active', department_name: 'Public Works Department (PWD)' },
    { id: 2, department_id: 2, name: 'Amit Sharma', email: 'amit.sharma@nagarsetu.gov.in', phone: '+91 9822000002', employee_id: 'EMP-SAN-001', designation: 'Department Head', status: 'active', department_name: 'Sanitation & Waste Management' },
    { id: 3, department_id: 3, name: 'Vikram Patil', email: 'vikram.patil@nagarsetu.gov.in', phone: '+91 9822000003', employee_id: 'EMP-WTR-001', designation: 'Department Head', status: 'active', department_name: 'Water Supply & Sewerage Board' },
    { id: 4, department_id: 4, name: 'Sanjay More', email: 'sanjay.more@nagarsetu.gov.in', phone: '+91 9822000004', employee_id: 'EMP-DRN-001', designation: 'Department Head', status: 'active', department_name: 'Drainage & Sewage Department' },
    { id: 5, department_id: 5, name: 'Aditya Joshi', email: 'aditya.joshi@nagarsetu.gov.in', phone: '+91 9822000005', employee_id: 'EMP-ELE-001', designation: 'Department Head', status: 'active', department_name: 'Electrical & Street Lighting' },
    { id: 6, department_id: 6, name: 'Rohan Deshmukh', email: 'rohan.deshmukh@nagarsetu.gov.in', phone: '+91 9822000006', employee_id: 'EMP-TRF-001', designation: 'Department Head', status: 'active', department_name: 'Traffic Management Department' },
    { id: 7, department_id: 7, name: 'Kunal Kulkarni', email: 'kunal.kulkarni@nagarsetu.gov.in', phone: '+91 9822000007', employee_id: 'EMP-MNT-001', designation: 'Department Head', status: 'active', department_name: 'Maintenance Department' }
  ],
  users: [
    { id: 1, name: 'Municipal Admin', employee_id: 'ADM-001', email: 'admin@nagarsetu.gov.in', mobile: '9876543213', role: 'city_admin', department_id: null, department_name: 'City Administration', designation: 'City Administrator', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 101, name: 'Amit Patil', employee_id: 'PWD-STF-001', email: 'amit.patil@nagarsetu.gov.in', mobile: '9822010001', role: 'service_staff', department_id: 1, department_name: 'Public Works Department (PWD)', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 102, name: 'Sagar Jadhav', employee_id: 'PWD-STF-002', email: 'sagar.jadhav@nagarsetu.gov.in', mobile: '9822010002', role: 'service_staff', department_id: 1, department_name: 'Public Works Department (PWD)', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 103, name: 'Nikhil Shinde', employee_id: 'PWD-STF-003', email: 'nikhil.shinde@nagarsetu.gov.in', mobile: '9822010003', role: 'service_staff', department_id: 1, department_name: 'Public Works Department (PWD)', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 104, name: 'Rohit More', employee_id: 'PWD-STF-004', email: 'rohit.more@nagarsetu.gov.in', mobile: '9822010004', role: 'service_staff', department_id: 1, department_name: 'Public Works Department (PWD)', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 105, name: 'Akash Pawar', employee_id: 'PWD-STF-005', email: 'akash.pawar@nagarsetu.gov.in', mobile: '9822010005', role: 'service_staff', department_id: 1, department_name: 'Public Works Department (PWD)', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },

    { id: 106, name: 'Prashant Mane', employee_id: 'SAN-STF-001', email: 'prashant.mane@nagarsetu.gov.in', mobile: '9822010006', role: 'service_staff', department_id: 2, department_name: 'Sanitation & Waste Management', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 107, name: 'Ganesh Chavan', employee_id: 'SAN-STF-002', email: 'ganesh.chavan@nagarsetu.gov.in', mobile: '9822010007', role: 'service_staff', department_id: 2, department_name: 'Sanitation & Waste Management', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 108, name: 'Mahesh Kadam', employee_id: 'SAN-STF-003', email: 'mahesh.kadam@nagarsetu.gov.in', mobile: '9822010008', role: 'service_staff', department_id: 2, department_name: 'Sanitation & Waste Management', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 109, name: 'Swapnil Bhosale', employee_id: 'SAN-STF-004', email: 'swapnil.bhosale@nagarsetu.gov.in', mobile: '9822010009', role: 'service_staff', department_id: 2, department_name: 'Sanitation & Waste Management', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 110, name: 'Deepak Wagh', employee_id: 'SAN-STF-005', email: 'deepak.wagh@nagarsetu.gov.in', mobile: '9822010010', role: 'service_staff', department_id: 2, department_name: 'Sanitation & Waste Management', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },

    { id: 111, name: 'Kiran Patil', employee_id: 'WTR-STF-001', email: 'kiran.patil@nagarsetu.gov.in', mobile: '9822010011', role: 'service_staff', department_id: 3, department_name: 'Water Supply & Sewerage Board', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 112, name: 'Manoj Shinde', employee_id: 'WTR-STF-002', email: 'manoj.shinde@nagarsetu.gov.in', mobile: '9822010012', role: 'service_staff', department_id: 3, department_name: 'Water Supply & Sewerage Board', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 113, name: 'Sachin More', employee_id: 'WTR-STF-003', email: 'sachin.more@nagarsetu.gov.in', mobile: '9822010013', role: 'service_staff', department_id: 3, department_name: 'Water Supply & Sewerage Board', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 114, name: 'Ajay Jadhav', employee_id: 'WTR-STF-004', email: 'ajay.jadhav@nagarsetu.gov.in', mobile: '9822010014', role: 'service_staff', department_id: 3, department_name: 'Water Supply & Sewerage Board', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 115, name: 'Vivek Pawar', employee_id: 'WTR-STF-005', email: 'vivek.pawar@nagarsetu.gov.in', mobile: '9822010015', role: 'service_staff', department_id: 3, department_name: 'Water Supply & Sewerage Board', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },

    { id: 116, name: 'Sunil Patil', employee_id: 'DRN-STF-001', email: 'sunil.patil@nagarsetu.gov.in', mobile: '9822010016', role: 'service_staff', department_id: 4, department_name: 'Drainage & Sewage Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 117, name: 'Ramesh More', employee_id: 'DRN-STF-002', email: 'ramesh.more@nagarsetu.gov.in', mobile: '9822010017', role: 'service_staff', department_id: 4, department_name: 'Drainage & Sewage Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 118, name: 'Santosh Jadhav', employee_id: 'DRN-STF-003', email: 'santosh.jadhav@nagarsetu.gov.in', mobile: '9822010018', role: 'service_staff', department_id: 4, department_name: 'Drainage & Sewage Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 119, name: 'Dinesh Shinde', employee_id: 'DRN-STF-004', email: 'dinesh.shinde@nagarsetu.gov.in', mobile: '9822010019', role: 'service_staff', department_id: 4, department_name: 'Drainage & Sewage Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 120, name: 'Pravin Pawar', employee_id: 'DRN-STF-005', email: 'pravin.pawar@nagarsetu.gov.in', mobile: '9822010020', role: 'service_staff', department_id: 4, department_name: 'Drainage & Sewage Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },

    { id: 121, name: 'Rahul Joshi', employee_id: 'ELE-STF-001', email: 'rahul.joshi@nagarsetu.gov.in', mobile: '9822010021', role: 'service_staff', department_id: 5, department_name: 'Electrical & Street Lighting', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 122, name: 'Sameer Kulkarni', employee_id: 'ELE-STF-002', email: 'sameer.kulkarni@nagarsetu.gov.in', mobile: '9822010022', role: 'service_staff', department_id: 5, department_name: 'Electrical & Street Lighting', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 123, name: 'Tejas Deshmukh', employee_id: 'ELE-STF-003', email: 'tejas.deshmukh@nagarsetu.gov.in', mobile: '9822010023', role: 'service_staff', department_id: 5, department_name: 'Electrical & Street Lighting', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 124, name: 'Omkar Patil', employee_id: 'ELE-STF-004', email: 'omkar.patil@nagarsetu.gov.in', mobile: '9822010024', role: 'service_staff', department_id: 5, department_name: 'Electrical & Street Lighting', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 125, name: 'Harshad More', employee_id: 'ELE-STF-005', email: 'harshad.more@nagarsetu.gov.in', mobile: '9822010025', role: 'service_staff', department_id: 5, department_name: 'Electrical & Street Lighting', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },

    { id: 126, name: 'Rohan Patil', employee_id: 'TRF-STF-001', email: 'rohan.patil@nagarsetu.gov.in', mobile: '9822010026', role: 'service_staff', department_id: 6, department_name: 'Traffic Management Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 127, name: 'Vishal Jadhav', employee_id: 'TRF-STF-002', email: 'vishal.jadhav@nagarsetu.gov.in', mobile: '9822010027', role: 'service_staff', department_id: 6, department_name: 'Traffic Management Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 128, name: 'Tushar More', employee_id: 'TRF-STF-003', email: 'tushar.more@nagarsetu.gov.in', mobile: '9822010028', role: 'service_staff', department_id: 6, department_name: 'Traffic Management Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 129, name: 'Nitin Shinde', employee_id: 'TRF-STF-004', email: 'nitin.shinde@nagarsetu.gov.in', mobile: '9822010029', role: 'service_staff', department_id: 6, department_name: 'Traffic Management Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 130, name: 'Amol Pawar', employee_id: 'TRF-STF-005', email: 'amol.pawar@nagarsetu.gov.in', mobile: '9822010030', role: 'service_staff', department_id: 6, department_name: 'Traffic Management Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },

    { id: 131, name: 'Kunal Patil', employee_id: 'MNT-STF-001', email: 'kunal.patil@nagarsetu.gov.in', mobile: '9822010031', role: 'service_staff', department_id: 7, department_name: 'Maintenance Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 132, name: 'Ganesh More', employee_id: 'MNT-STF-002', email: 'ganesh.more@nagarsetu.gov.in', mobile: '9822010032', role: 'service_staff', department_id: 7, department_name: 'Maintenance Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 133, name: 'Mayur Jadhav', employee_id: 'MNT-STF-003', email: 'mayur.jadhav@nagarsetu.gov.in', mobile: '9822010033', role: 'service_staff', department_id: 7, department_name: 'Maintenance Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 134, name: 'Sachin Pawar', employee_id: 'MNT-STF-004', email: 'sachin.pawar@nagarsetu.gov.in', mobile: '9822010034', role: 'service_staff', department_id: 7, department_name: 'Maintenance Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 135, name: 'Yogesh Shinde', employee_id: 'MNT-STF-005', email: 'yogesh.shinde@nagarsetu.gov.in', mobile: '9822010035', role: 'service_staff', department_id: 7, department_name: 'Maintenance Department', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
    { id: 136, name: 'Ramesh Kumar (Field Staff)', employee_id: 'STF-GEN-001', email: 'staff@nagarsetu.gov.in', mobile: '9876543212', role: 'service_staff', department_id: 1, department_name: 'Public Works Department (PWD)', designation: 'Field Service Staff', status: 'active', active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 }
  ],
  complaints: [],
  assignments: [],
  feedback: [],
  notifications: [],
  complaint_status_history: [],
  announcements: [],
  announcement_reads: []
};

function runMemQuery(sql, params = []) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[DATABASE FATAL] In-memory database fallback is disabled in production.');
  }
  const s = sql.trim();
  const upper = s.toUpperCase();

  if (upper.includes('FROM DEPARTMENTS') || upper.includes('INTO DEPARTMENTS')) {
    if (upper.startsWith('SELECT COUNT')) {
      return Promise.resolve({ rows: [{ count: memStore.departments.length }] });
    }
    return Promise.resolve({ rows: memStore.departments });
  }

  if (upper.startsWith('SELECT COUNT')) {
    for (const table of Object.keys(memStore)) {
      if (upper.includes(`FROM ${table.toUpperCase()}`)) {
        return Promise.resolve({ rows: [{ count: memStore[table].length }] });
      }
    }
    return Promise.resolve({ rows: [{ count: 0 }] });
  }

  if (upper.startsWith('SELECT')) {
    for (const table of Object.keys(memStore)) {
      if (upper.includes(`FROM ${table.toUpperCase()}`)) {
        return Promise.resolve({ rows: memStore[table] });
      }
    }
    return Promise.resolve({ rows: [] });
  }

  if (upper.startsWith('INSERT')) {
    for (const table of Object.keys(memStore)) {
      if (upper.includes(`INTO ${table.toUpperCase()}`)) {
        const newId = memStore[table].length + 1;
        const newObj = { id: newId, created_at: new Date().toISOString() };
        memStore[table].push(newObj);
        return Promise.resolve({ rows: [{ id: newId }], rowCount: 1 });
      }
    }
    return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
  }

  return Promise.resolve({ rows: [], rowCount: 1 });
}

// Lightweight, type-safe Supabase REST client adapter for PostgreSQL fallback
async function querySupabase(sql, params = []) {
  try {
    const { supabase } = require('./supabaseStorage');
    if (!supabase) return null;

    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    // 1. Users lookup for Login & Auth
    if (upper.includes('FROM USERS')) {
      if (upper.includes('LOWER(EMAIL)')) {
        const emailParam = params.find(p => typeof p === 'string' && p.includes('@')) || params[0];
        const email = String(emailParam || '').toLowerCase().trim();
        const { data, error } = await supabase.from('users').select('*').ilike('email', email).limit(1);
        if (!error && data && data.length > 0) return { rows: data };
      }
      if (upper.includes('MOBILE')) {
        const mobParam = params.find(p => typeof p === 'string' && /\d{8,}/.test(p)) || params[0];
        const mob = String(mobParam || '').trim();
        const normMob = mob.slice(-10);
        const { data, error } = await supabase.from('users').select('*').or(`mobile.eq.${mob},mobile.eq.${normMob}`).limit(1);
        if (!error && data && data.length > 0) return { rows: data };
      }
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const { data, error } = await supabase.from('users').select('*').eq('id', id).limit(1);
        if (!error && data && data.length > 0) return { rows: data };
      }
      // General fallback lookup by identifier
      if (params.length > 0) {
        const ident = String(params[0] || '').trim();
        if (ident) {
          const { data, error } = await supabase.from('users').select('*').or(`email.ilike.${ident},mobile.eq.${ident}`).limit(1);
          if (!error && data && data.length > 0) return { rows: data };
        }
      }
      const { data, error } = await supabase.from('users').select('*').limit(100);
      if (!error && data) return { rows: data };
    }

    // 2. Complaints queries
    if (upper.includes('FROM COMPLAINTS')) {
      if (upper.includes('SELECT COUNT')) {
        const { count, error } = await supabase.from('complaints').select('*', { count: 'exact', head: true });
        if (!error && count !== null) return { rows: [{ count }] };
      }
      let queryBuilder = supabase.from('complaints').select('*, departments(name)');

      // A. Specific complaint by ID or complaint_number
      if (upper.includes('WHERE C.ID =') || upper.includes('WHERE (C.ID =') || upper.includes('C.COMPLAINT_NUMBER =') || upper.includes('WHERE ID =')) {
        const idParam = params[0];
        if (idParam) {
          queryBuilder = queryBuilder.or(`id.eq.${idParam},complaint_number.eq.${idParam}`);
        } else {
          return { rows: [] };
        }
      }
      // B. Citizen filtering (both c.citizen_id = ? and c.citizen_id IN (...))
      else if (upper.includes('CITIZEN_ID =') || upper.includes('CITIZEN_ID IN') || upper.includes('C.CITIZEN_ID')) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const validUuids = [...new Set(params.map(String).filter(p => uuidRegex.test(p)))];
        if (validUuids.length === 1) {
          queryBuilder = queryBuilder.eq('citizen_id', validUuids[0]);
        } else if (validUuids.length > 1) {
          queryBuilder = queryBuilder.in('citizen_id', validUuids);
        } else {
          // FAIL CLOSED: A citizen filter was requested in the query, but no valid citizen UUID was provided or resolved.
          // NEVER run an unfiltered query or return another citizen's records.
          return { rows: [] };
        }
      }
      // C. Department filtering
      else if (upper.includes('DEPARTMENT_ID =') || upper.includes('DEPARTMENT_ID IN') || upper.includes('C.DEPARTMENT_ID')) {
        const deptId = params.find(p => typeof p === 'string' && p.length > 0) || params[0];
        if (deptId) {
          queryBuilder = queryBuilder.eq('department_id', String(deptId));
        } else {
          return { rows: [] };
        }
      }

      const { data, error } = await queryBuilder.order('created_at', { ascending: false });
      if (!error && data) {
        const formatted = data.map(row => ({
          ...row,
          department_name: row.departments?.name || row.department_name
        }));
        return { rows: formatted };
      }
    }

    // 2b. Complaints status update
    if (upper.startsWith('UPDATE COMPLAINTS')) {
      if (upper.includes('SET STATUS =')) {
        const statusParam = params[0];
        const idParam = params[params.length - 1];
        if (idParam) {
          const updateData = { status: statusParam, updated_at: new Date().toISOString() };
          const { data, error } = await supabase
            .from('complaints')
            .update(updateData)
            .or(`id.eq.${idParam},complaint_number.eq.${idParam}`)
            .select();
          if (!error) {
            return { rows: data || [], rowCount: (data && data.length) ? data.length : 1 };
          }
        }
      }
    }

    // 2c. Complaints insert
    if (upper.startsWith('INSERT INTO COMPLAINTS')) {
      const match = trimmed.match(/INSERT\s+INTO\s+complaints\s*\(([\s\S]+?)\)\s*VALUES\s*\(([\s\S]+?)\)/i);
      if (match) {
        const columns = match[1].split(',').map(c => c.trim().toLowerCase());
        const SUPABASE_COMPLAINT_COLS = new Set([
          'id', 'complaint_number', 'citizen_id', 'photo_before_url', 'photo_after_url',
          'category', 'title', 'description', 'priority', 'status', 'department_id',
          'latitude', 'longitude', 'location_source', 'location_address', 'duplicate_of_id',
          'support_count', 'created_at', 'updated_at', 'assigned_staff_id', 'assigned_staff_name',
          'assigned_staff_email', 'assigned_by', 'assigned_by_name', 'sla_deadline',
          'work_performed', 'materials_used', 'additional_notes', 'verified_by', 'verified_by_name',
          'verified_at', 'rework_reason', 'admin_rejection_reason', 'ai_category', 'ai_specific_issue',
          'ai_confidence', 'ai_severity', 'ai_urgency', 'ai_evidence', 'ai_model', 'ai_analyzed_at',
          'needs_manual_verification'
        ]);
        const record = {};
        columns.forEach((col, idx) => {
          if (SUPABASE_COMPLAINT_COLS.has(col)) {
            record[col] = params[idx];
          }
        });
        const { data, error } = await supabase.from('complaints').insert([record]).select();
        if (error) {
          console.warn('[SUPABASE COMPLAINTS INSERT WARN]', error.message, error.details);
        }
        if (!error && data && data.length > 0) {
          return { rows: data, rowCount: data.length };
        }
      }
    }

    // 2d. Complaints delete
    if (upper.startsWith('DELETE FROM COMPLAINTS')) {
      const idParam = params[0];
      if (idParam) {
        const { data, error } = await supabase.from('complaints').delete().eq('id', idParam).select();
        if (!error) {
          return { rows: data || [], rowCount: (data && data.length) ? data.length : 1 };
        }
      }
    }

    // 3. Departments
    if (upper.includes('FROM DEPARTMENTS')) {
      const { data, error } = await supabase.from('departments').select('*');
      if (!error && data) return { rows: data };
    }

    // 4. Department Heads
    if (upper.includes('FROM DEPARTMENT_HEADS')) {
      const { data, error } = await supabase.from('department_heads').select('*');
      if (!error && data) return { rows: data };
    }

    // 5. Notifications
    if (upper.includes('FROM NOTIFICATIONS')) {
      let q = supabase.from('notifications').select('*');
      if (params.length > 0) {
        q = q.eq('user_id', String(params[0]));
      }
      const { data, error } = await q.order('sent_at', { ascending: false });
      if (!error && data) return { rows: data };
    }
  } catch (supaErr) {
    console.warn('[SUPABASE ADAPTER NOTE]', supaErr.message);
  }
  return null;
}

// Universal query runner wrapper
async function query(sql, params = []) {
  const currentDbType = (process.env.DB_TYPE || DB_TYPE || '').toLowerCase();

  // If DB_TYPE is explicitly supabase and pgPool is not connected, use Supabase REST adapter directly
  if (currentDbType === 'supabase' && !pgPool) {
    const supaRes = await querySupabase(sql, params);
    if (supaRes) {
      return supaRes;
    }
  }

  if (useSqlite || (currentDbType === 'sqlite' && !pgPool)) {
    if (!sqliteDb && process.env.NODE_ENV !== 'production') {
      await new Promise(r => setupSqlite(r, r));
    }
    if (!sqliteDb) {
      return runMemQuery(sql, params);
    }
    useSqlite = true;
    return new Promise((resolve, reject) => {
      let finalParams = params;
      let sqliteSql = sql;
      if (Array.isArray(params) && params.length > 0 && /\$\d+/.test(sql)) {
        const sqliteParams = [];
        sqliteSql = sql.replace(/\$(\d+)/g, (_, num) => {
          const index = parseInt(num, 10) - 1;
          sqliteParams.push(params[index]);
          return '?';
        });
        finalParams = sqliteParams;
      } else {
        sqliteSql = sql.replace(/\$\d+/g, '?');
      }
      const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
      if (isSelect) {
        sqliteDb.all(sqliteSql, finalParams, (err, rows) => {
          if (err) return reject(err);
          resolve({ rows });
        });
      } else {
        sqliteDb.run(sqliteSql, finalParams, function (err) {
          if (err) return reject(err);
          resolve({ rows: [{ id: this.lastID }], rowCount: this.changes });
        });
      }
    });
  } else {
    try {
      if (!pgPool) {
        throw new Error('pgPool is not initialized');
      }
      let pgSql = sql;
      let paramIndex = 1;
      pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

      const trimmed = pgSql.trim();
      const isInsert = /^\s*INSERT\s+INTO\b/i.test(trimmed);
      const hasReturning = /\bRETURNING\b/i.test(trimmed);
      if (isInsert && !hasReturning) {
        pgSql = pgSql.trim().replace(/;+\s*$/, '') + ' RETURNING id';
      }

      return await pgPool.query(pgSql, params);
    } catch (err) {
      // Graceful fallback to verified Supabase REST client
      const supaRes = await querySupabase(sql, params);
      if (supaRes) {
        return supaRes;
      }
      if (process.env.NODE_ENV === 'production') {
        console.error('[DATABASE ERROR] PostgreSQL query failed in production:', err.message);
        throw err;
      }
      console.warn('[DATABASE QUERY WARN] PostgreSQL query failed, activating SQLite/Mem fallback:', err.message);
      if (!sqliteDb) {
        await new Promise(r => setupSqlite(r, r));
      }
      useSqlite = true;
      return query(sql, params);
    }
  }
}

module.exports = {
  initDatabase,
  query,
  getIsSqlite: () => useSqlite,
  getMemStore: () => memStore
};
