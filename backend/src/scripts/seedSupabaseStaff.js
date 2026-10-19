const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const STAFF_LIST = [
  // 1. PWD
  { code: 'PWD', name: 'Amit Patil', employee_id: 'PWD-STF-001', email: 'amit.patil@nagarsetu.gov.in', mobile: '9822010001', department_name: 'Roads & Public Works (PWD)' },
  { code: 'PWD', name: 'Sagar Jadhav', employee_id: 'PWD-STF-002', email: 'sagar.jadhav@nagarsetu.gov.in', mobile: '9822010002', department_name: 'Roads & Public Works (PWD)' },
  { code: 'PWD', name: 'Nikhil Shinde', employee_id: 'PWD-STF-003', email: 'nikhil.shinde@nagarsetu.gov.in', mobile: '9822010003', department_name: 'Roads & Public Works (PWD)' },
  { code: 'PWD', name: 'Rohit More', employee_id: 'PWD-STF-004', email: 'rohit.more@nagarsetu.gov.in', mobile: '9822010004', department_name: 'Roads & Public Works (PWD)' },
  { code: 'PWD', name: 'Akash Pawar', employee_id: 'PWD-STF-005', email: 'akash.pawar@nagarsetu.gov.in', mobile: '9822010005', department_name: 'Roads & Public Works (PWD)' },

  // 2. SAN
  { code: 'SAN', name: 'Prashant Mane', employee_id: 'SAN-STF-001', email: 'prashant.mane@nagarsetu.gov.in', mobile: '9822010006', department_name: 'Sanitation & Waste Management' },
  { code: 'SAN', name: 'Ganesh Chavan', employee_id: 'SAN-STF-002', email: 'ganesh.chavan@nagarsetu.gov.in', mobile: '9822010007', department_name: 'Sanitation & Waste Management' },
  { code: 'SAN', name: 'Mahesh Kadam', employee_id: 'SAN-STF-003', email: 'mahesh.kadam@nagarsetu.gov.in', mobile: '9822010008', department_name: 'Sanitation & Waste Management' },
  { code: 'SAN', name: 'Swapnil Bhosale', employee_id: 'SAN-STF-004', email: 'swapnil.bhosale@nagarsetu.gov.in', mobile: '9822010009', department_name: 'Sanitation & Waste Management' },
  { code: 'SAN', name: 'Deepak Wagh', employee_id: 'SAN-STF-005', email: 'deepak.wagh@nagarsetu.gov.in', mobile: '9822010010', department_name: 'Sanitation & Waste Management' },

  // 3. WTR
  { code: 'WTR', name: 'Kiran Patil', employee_id: 'WTR-STF-001', email: 'kiran.patil@nagarsetu.gov.in', mobile: '9822010011', department_name: 'Water Supply & Sewerage Board' },
  { code: 'WTR', name: 'Manoj Shinde', employee_id: 'WTR-STF-002', email: 'manoj.shinde@nagarsetu.gov.in', mobile: '9822010012', department_name: 'Water Supply & Sewerage Board' },
  { code: 'WTR', name: 'Sachin More', employee_id: 'WTR-STF-003', email: 'sachin.more@nagarsetu.gov.in', mobile: '9822010013', department_name: 'Water Supply & Sewerage Board' },
  { code: 'WTR', name: 'Ajay Jadhav', employee_id: 'WTR-STF-004', email: 'ajay.jadhav@nagarsetu.gov.in', mobile: '9822010014', department_name: 'Water Supply & Sewerage Board' },
  { code: 'WTR', name: 'Vivek Pawar', employee_id: 'WTR-STF-005', email: 'vivek.pawar@nagarsetu.gov.in', mobile: '9822010015', department_name: 'Water Supply & Sewerage Board' },

  // 4. DRN
  { code: 'DRN', name: 'Sunil Patil', employee_id: 'DRN-STF-001', email: 'sunil.patil@nagarsetu.gov.in', mobile: '9822010016', department_name: 'Drainage & Sewage Department' },
  { code: 'DRN', name: 'Ramesh More', employee_id: 'DRN-STF-002', email: 'ramesh.more@nagarsetu.gov.in', mobile: '9822010017', department_name: 'Drainage & Sewage Department' },
  { code: 'DRN', name: 'Santosh Jadhav', employee_id: 'DRN-STF-003', email: 'santosh.jadhav@nagarsetu.gov.in', mobile: '9822010018', department_name: 'Drainage & Sewage Department' },
  { code: 'DRN', name: 'Dinesh Shinde', employee_id: 'DRN-STF-004', email: 'dinesh.shinde@nagarsetu.gov.in', mobile: '9822010019', department_name: 'Drainage & Sewage Department' },
  { code: 'DRN', name: 'Pravin Pawar', employee_id: 'DRN-STF-005', email: 'pravin.pawar@nagarsetu.gov.in', mobile: '9822010020', department_name: 'Drainage & Sewage Department' },

  // 5. ELE
  { code: 'ELE', name: 'Rahul Joshi', employee_id: 'ELE-STF-001', email: 'rahul.joshi@nagarsetu.gov.in', mobile: '9822010021', department_name: 'Electrical & Street Lighting' },
  { code: 'ELE', name: 'Sameer Kulkarni', employee_id: 'ELE-STF-002', email: 'sameer.kulkarni@nagarsetu.gov.in', mobile: '9822010022', department_name: 'Electrical & Street Lighting' },
  { code: 'ELE', name: 'Tejas Deshmukh', employee_id: 'ELE-STF-003', email: 'tejas.deshmukh@nagarsetu.gov.in', mobile: '9822010023', department_name: 'Electrical & Street Lighting' },
  { code: 'ELE', name: 'Omkar Patil', employee_id: 'ELE-STF-004', email: 'omkar.patil@nagarsetu.gov.in', mobile: '9822010024', department_name: 'Electrical & Street Lighting' },
  { code: 'ELE', name: 'Harshad More', employee_id: 'ELE-STF-005', email: 'harshad.more@nagarsetu.gov.in', mobile: '9822010025', department_name: 'Electrical & Street Lighting' },

  // 6. TRF
  { code: 'TRF', name: 'Rohan Patil', employee_id: 'TRF-STF-001', email: 'rohan.patil@nagarsetu.gov.in', mobile: '9822010026', department_name: 'Traffic Management Department' },
  { code: 'TRF', name: 'Vishal Jadhav', employee_id: 'TRF-STF-002', email: 'vishal.jadhav@nagarsetu.gov.in', mobile: '9822010027', department_name: 'Traffic Management Department' },
  { code: 'TRF', name: 'Tushar More', employee_id: 'TRF-STF-003', email: 'tushar.more@nagarsetu.gov.in', mobile: '9822010028', department_name: 'Traffic Management Department' },
  { code: 'TRF', name: 'Nitin Shinde', employee_id: 'TRF-STF-004', email: 'nitin.shinde@nagarsetu.gov.in', mobile: '9822010029', department_name: 'Traffic Management Department' },
  { code: 'TRF', name: 'Amol Pawar', employee_id: 'TRF-STF-005', email: 'amol.pawar@nagarsetu.gov.in', mobile: '9822010030', department_name: 'Traffic Management Department' },

  // 7. MNT
  { code: 'MNT', name: 'Kunal Patil', employee_id: 'MNT-STF-001', email: 'kunal.patil@nagarsetu.gov.in', mobile: '9822010031', department_name: 'Maintenance Department' },
  { code: 'MNT', name: 'Ganesh More', employee_id: 'MNT-STF-002', email: 'ganesh.more@nagarsetu.gov.in', mobile: '9822010032', department_name: 'Maintenance Department' },
  { code: 'MNT', name: 'Mayur Jadhav', employee_id: 'MNT-STF-003', email: 'mayur.jadhav@nagarsetu.gov.in', mobile: '9822010033', department_name: 'Maintenance Department' },
  { code: 'MNT', name: 'Sachin Pawar', employee_id: 'MNT-STF-004', email: 'sachin.pawar@nagarsetu.gov.in', mobile: '9822010034', department_name: 'Maintenance Department' },
  { code: 'MNT', name: 'Yogesh Shinde', employee_id: 'MNT-STF-005', email: 'yogesh.shinde@nagarsetu.gov.in', mobile: '9822010035', department_name: 'Maintenance Department' }
];

async function seedSupabaseStaff() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('[SEED NOTE] SUPABASE_URL or SUPABASE_ANON_KEY not configured. Skipping Supabase staff seeding.');
    return;
  }
  console.log('Fetching Supabase departments...');
  const dRes = await fetch(`${SUPABASE_URL}/rest/v1/departments?select=*`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
  });
  const depts = await dRes.json();
  console.log('Fetched departments:', depts.map(d => `${d.code}:${d.id}`));

  const deptMap = {};
  if (Array.isArray(depts)) {
    depts.forEach(d => {
      if (d.code) deptMap[d.code.toUpperCase()] = d.id;
    });
  }

  console.log('\nSeeding 35 Service Staff to Supabase profiles table...');
  let successCount = 0;

  for (const s of STAFF_LIST) {
    const deptId = deptMap[s.code] || null;
    
    // Check if profile exists by email
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(s.email)}`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const existing = await pRes.json();

    const payload = {
      full_name: s.name,
      email: s.email,
      mobile: s.mobile,
      role: 'service_staff',
      department_id: deptId,
      employee_id: s.employee_id,
      status: 'active',
      language_pref: 'en'
    };

    if (Array.isArray(existing) && existing.length > 0) {
      // Update
      const upRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (upRes.ok) {
        console.log(`[UPDATED] ${s.name} (${s.employee_id}) -> Dept ${s.code}`);
        successCount++;
      } else {
        console.error(`[UPDATE FAILED] ${s.name}:`, await upRes.text());
      }
    } else {
      // Insert
      const inRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
      });
      if (inRes.ok) {
        console.log(`[CREATED] ${s.name} (${s.employee_id}) -> Dept ${s.code}`);
        successCount++;
      } else {
        console.error(`[CREATE FAILED] ${s.name}:`, await inRes.text());
      }
    }
  }

  console.log(`\nSupabase Service Staff Seeding complete. Total verified: ${successCount}/35`);
}

seedSupabaseStaff();
