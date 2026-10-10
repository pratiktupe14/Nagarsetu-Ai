const bcrypt = require('bcryptjs');
const { query } = require('../config/db');

const OFFICIAL_DEPARTMENTS = [
  {
    code: 'PWD',
    name: 'Public Works Department',
    searchTerms: ['Public Works Department', 'Public Works', 'PWD'],
    description: 'Asphalt road repairs, pothole filling, sidewalk paving, and structural civic infrastructure maintenance.',
    headName: 'Rahul Kumar',
    email: 'rahul.kumar@nagarsetu.gov.in',
    mobile: '9822000001',
    employeeId: 'EMP-PWD-001'
  },
  {
    code: 'SAN',
    name: 'Sanitation & Waste Management',
    searchTerms: ['Sanitation & Waste Management', 'Sanitation & Solid Waste Management', 'Sanitation'],
    description: 'Solid waste collection, dumpster clearing, street sweeping, market sanitation, and public hygiene.',
    headName: 'Amit Sharma',
    email: 'amit.sharma@nagarsetu.gov.in',
    mobile: '9822000002',
    employeeId: 'EMP-SAN-001'
  },
  {
    code: 'WTR',
    name: 'Water Supply & Sewerage Board',
    searchTerms: ['Water Supply & Sewerage Board', 'Water Supply'],
    description: 'Potable water mains, underground pipeline leakage sealing, valve control, and water network maintenance.',
    headName: 'Vikram Patil',
    email: 'vikram.patil@nagarsetu.gov.in',
    mobile: '9822000003',
    employeeId: 'EMP-WTR-001'
  },
  {
    code: 'DRN',
    name: 'Drainage & Sewage Department',
    searchTerms: ['Drainage & Sewage Department', 'Drainage & Sewerage Department', 'Drainage Department'],
    description: 'Drainage blockage, sewage overflow, open drains, culverts, and storm channels.',
    headName: 'Sanjay More',
    email: 'sanjay.more@nagarsetu.gov.in',
    mobile: '9822000004',
    employeeId: 'EMP-DRN-001'
  },
  {
    code: 'ELE',
    name: 'Electrical & Street Lighting',
    searchTerms: ['Electrical & Street Lighting', 'Electrical & Lighting Department', 'Electrical Department'],
    description: 'Streetlight repair, electrical poles, transformer inspection, and public lighting.',
    headName: 'Aditya Joshi',
    email: 'aditya.joshi@nagarsetu.gov.in',
    mobile: '9822000005',
    employeeId: 'EMP-ELE-001'
  },
  {
    code: 'TRF',
    name: 'Traffic Management Department',
    searchTerms: ['Traffic Management Department', 'Traffic Management'],
    description: 'Traffic signal repairs, road signage, lane markings, and junction safety.',
    headName: 'Rohan Deshmukh',
    email: 'rohan.deshmukh@nagarsetu.gov.in',
    mobile: '9822000006',
    employeeId: 'EMP-TRF-001'
  },
  {
    code: 'MNT',
    name: 'Maintenance Department',
    searchTerms: ['Maintenance Department', 'Building Maintenance'],
    description: 'General civic facility repairs, building maintenance, public park upkeep, and municipal asset management.',
    headName: 'Kunal Kulkarni',
    email: 'kunal.kulkarni@nagarsetu.gov.in',
    mobile: '9822000007',
    employeeId: 'EMP-MNT-001'
  }
];

const OFFICIAL_EMAILS = OFFICIAL_DEPARTMENTS.map((d) => d.email.toLowerCase());
const DEMO_PASSWORD = process.env.DEMO_HEAD_PASSWORD || 'head@123';

function isValidUuid(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

async function cleanAndSyncDepartmentHeads() {
  console.log('================================================================');
  console.log(' PERMANENT DATABASE CLEANUP & SYNC: 7 ACTIVE DEPARTMENT HEADS   ');
  console.log('================================================================');

  try {
    // 1. Synchronize & Ensure 7 Official Departments exist in local DB
    const deptIdMap = {};
    for (const dMeta of OFFICIAL_DEPARTMENTS) {
      let deptId = null;
      for (const term of dMeta.searchTerms) {
        const findRes = await query(
          `SELECT id, name FROM departments WHERE name LIKE ? LIMIT 1`,
          [`%${term}%`]
        );
        if (findRes.rows && findRes.rows.length > 0) {
          deptId = findRes.rows[0].id;
          break;
        }
      }

      if (!deptId) {
        const insRes = await query(
          `INSERT INTO departments (name, description) VALUES (?, ?)`,
          [dMeta.name, dMeta.description]
        );
        deptId = insRes.rows[0].id;
        console.log(`[LOCAL DB] Created department: '${dMeta.name}' (ID: ${deptId})`);
      } else {
        await query(
          `UPDATE departments SET name = ?, description = ? WHERE id = ?`,
          [dMeta.name, dMeta.description, deptId]
        );
      }
      deptIdMap[dMeta.code] = deptId;
    }

    // 2. Deactivate ALL obsolete department heads in local DB (emails not in official list)
    console.log('[LOCAL DB] Deactivating obsolete department head records...');
    for (const dMeta of OFFICIAL_DEPARTMENTS) {
      const cleanEmail = dMeta.email.toLowerCase();
      const targetDeptId = deptIdMap[dMeta.code];

      await query(
        `UPDATE department_heads SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE department_id = ? AND LOWER(email) != ?`,
        [targetDeptId, cleanEmail]
      );
    }

    const obsoleteUsers = await query(
      `SELECT id, email, name FROM users WHERE role = 'department_head'`
    );
    if (obsoleteUsers.rows) {
      for (const u of obsoleteUsers.rows) {
        if (!u.email || !OFFICIAL_EMAILS.includes(u.email.toLowerCase())) {
          console.log(`[LOCAL DB] Demoting obsolete user: '${u.name}' (${u.email}) to role = 'citizen'`);
          await query(
            `UPDATE users SET role = 'citizen', status = 'inactive', department_id = NULL WHERE id = ?`,
            [u.id]
          );
        }
      }
    }

    // 3. Upsert 7 Official Active Department Heads in local DB
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, salt);

    for (const dMeta of OFFICIAL_DEPARTMENTS) {
      const cleanEmail = dMeta.email.toLowerCase();
      const targetDeptId = deptIdMap[dMeta.code];

      const userCheck = await query(`SELECT id, email FROM users WHERE LOWER(email) = ? OR mobile = ?`, [cleanEmail, dMeta.mobile]);
      let userId = null;

      if (userCheck.rows && userCheck.rows.length > 0) {
        userId = userCheck.rows[0].id;
        await query(
          `UPDATE users SET name = ?, mobile = ?, email = ?, password_hash = ?, role = 'department_head', department_id = ?, employee_id = ?, status = 'active' WHERE id = ?`,
          [dMeta.headName, dMeta.mobile, cleanEmail, passwordHash, targetDeptId, dMeta.employeeId, userId]
        );
      } else {
        const insUser = await query(
          `INSERT INTO users (name, mobile, email, password_hash, role, department_id, employee_id, status) VALUES (?, ?, ?, ?, 'department_head', ?, ?, 'active')`,
          [dMeta.headName, dMeta.mobile, cleanEmail, passwordHash, targetDeptId, dMeta.employeeId]
        );
        userId = insUser.rows[0].id;
      }

      const dhCheck = await query(
        `SELECT id FROM department_heads WHERE user_id = ? OR LOWER(email) = ?`,
        [userId, cleanEmail]
      );

      if (dhCheck.rows && dhCheck.rows.length > 0) {
        await query(
          `UPDATE department_heads SET user_id = ?, department_id = ?, name = ?, email = ?, phone = ?, employee_id = ?, designation = 'Department Head', status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [userId, targetDeptId, dMeta.headName, cleanEmail, `+91 ${dMeta.mobile}`, dMeta.employeeId, dhCheck.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO department_heads (user_id, department_id, name, email, phone, employee_id, designation, status) VALUES (?, ?, ?, ?, ?, ?, 'Department Head', 'active')`,
          [userId, targetDeptId, dMeta.headName, cleanEmail, `+91 ${dMeta.mobile}`, dMeta.employeeId]
        );
      }
      console.log(`[LOCAL DB] Active Head verified: ${dMeta.code} -> ${dMeta.headName} (${cleanEmail})`);
    }

    // 4. Synchronize Supabase Database (if configured)
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ozeiymkbxtrqqdoxtmhm.supabase.co';
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZWl5bWtieHRycXFkb3h0bWhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjk1MzEsImV4cCI6MjEwMjgwNTUzMX0.6nQemY46XsG89kK5f_ONpAvrmI_buXX-VlpgLRY_sqs';

    let supabase = null;
    try {
      const { createClient } = require('../../frontend/node_modules/@supabase/supabase-js');
      supabase = createClient(supabaseUrl, supabaseAnonKey);
    } catch (e) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(supabaseUrl, supabaseAnonKey);
      } catch (err) {}
    }

    if (supabase) {
      console.log('\n[SUPABASE DB] Synchronizing Supabase records...');

      // 4a. Read existing departments from Supabase
      const { data: existingSupaDepts } = await supabase.from('departments').select('*');
      const supaDeptMap = {};

      for (const dMeta of OFFICIAL_DEPARTMENTS) {
        let sDept = (existingSupaDepts || []).find((d) => (d.code || '').toUpperCase() === dMeta.code || (d.name || '').includes(dMeta.name));
        if (sDept) {
          supaDeptMap[dMeta.code] = sDept.id;
          if (!sDept.code) {
            await supabase.from('departments').update({ code: dMeta.code }).eq('id', sDept.id);
          }
        }
      }

      // Default fallback department UUID for any unmapped code (e.g. MNT)
      const defaultSupaDeptId = supaDeptMap['ELE'] || supaDeptMap['PWD'] || '31842723-23ac-490b-912b-9f6d9afbdfb3';

      // 4b. Deactivate obsolete records in Supabase `department_heads`
      const { data: allSupaHeads } = await supabase.from('department_heads').select('*');
      if (allSupaHeads) {
        for (const sh of allSupaHeads) {
          if (!sh.email || !OFFICIAL_EMAILS.includes(sh.email.toLowerCase())) {
            console.log(`[SUPABASE DB] Deactivating obsolete department head: '${sh.name}' (${sh.email})`);
            await supabase
              .from('department_heads')
              .update({ status: 'inactive', updated_at: new Date().toISOString() })
              .eq('id', sh.id);
          }
        }
      }

      // 4c. Demote obsolete profiles in Supabase `profiles`
      const { data: allSupaProfiles } = await supabase.from('profiles').select('*').eq('role', 'department_head');
      if (allSupaProfiles) {
        for (const p of allSupaProfiles) {
          if (!p.email || !OFFICIAL_EMAILS.includes(p.email.toLowerCase())) {
            console.log(`[SUPABASE DB] Demoting obsolete profile: '${p.full_name}' (${p.email}) to role = 'citizen'`);
            await supabase
              .from('profiles')
              .update({ role: 'citizen', status: 'inactive', updated_at: new Date().toISOString() })
              .eq('id', p.id);
          }
        }
      }

      // 4d. Upsert the official active Department Heads into Supabase `department_heads` & `profiles`
      for (const dMeta of OFFICIAL_DEPARTMENTS) {
        const cleanEmail = dMeta.email.toLowerCase();
        const targetDeptId = supaDeptMap[dMeta.code] || defaultSupaDeptId;

        // Check profiles for existing user ID
        const { data: profUser } = await supabase
          .from('profiles')
          .select('id, email')
          .eq('email', cleanEmail)
          .maybeSingle();

        const supaUserId = (profUser?.id && isValidUuid(profUser.id)) ? profUser.id : null;

        if (supaUserId) {
          await supabase.from('profiles').upsert({
            id: supaUserId,
            full_name: dMeta.headName,
            email: cleanEmail,
            mobile: `+91 ${dMeta.mobile}`,
            role: 'department_head',
            department_id: targetDeptId,
            employee_id: dMeta.employeeId,
            status: 'active',
            updated_at: new Date().toISOString()
          });

          await supabase.from('user_roles').upsert({
            user_id: supaUserId,
            role: 'department_head'
          });
        }

        // Search department_heads by email first
        const { data: dhByEmail } = await supabase
          .from('department_heads')
          .select('*')
          .eq('email', cleanEmail);

        if (dhByEmail && dhByEmail.length > 0) {
          const { error: upErr } = await supabase
            .from('department_heads')
            .update({
              department_id: targetDeptId,
              name: dMeta.headName,
              phone: `+91 ${dMeta.mobile}`,
              employee_id: dMeta.employeeId,
              designation: 'Department Head',
              status: 'active',
              updated_at: new Date().toISOString()
            })
            .eq('id', dhByEmail[0].id);

          if (upErr) console.error(`[SUPABASE DB] Update error for ${dMeta.code}:`, upErr);
        } else {
          const payload = {
            department_id: targetDeptId,
            name: dMeta.headName,
            email: cleanEmail,
            phone: `+91 ${dMeta.mobile}`,
            employee_id: dMeta.employeeId,
            designation: 'Department Head',
            status: 'active',
            updated_at: new Date().toISOString()
          };
          if (supaUserId) payload.user_id = supaUserId;

          const { error: insErr } = await supabase
            .from('department_heads')
            .insert([payload]);

          if (insErr) console.error(`[SUPABASE DB] Insert error for ${dMeta.code}:`, insErr);
        }

        console.log(`[SUPABASE DB] Active Head verified: ${dMeta.code} -> ${dMeta.headName} (${cleanEmail})`);
      }
    }

    console.log('================================================================');
    console.log('  SUCCESSFULLY CLEANED & SYNCHRONIZED 7 ACTIVE DEPARTMENT HEADS ');
    console.log('================================================================');
    return true;
  } catch (err) {
    console.error('Error cleaning and synchronizing department heads:', err);
    return false;
  }
}

module.exports = cleanAndSyncDepartmentHeads;

if (require.main === module) {
  cleanAndSyncDepartmentHeads().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
