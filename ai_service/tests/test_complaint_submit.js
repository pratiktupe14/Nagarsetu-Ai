const http = require('http');
const { query } = require('../../backend/src/config/db');

const payload = JSON.stringify({
  category: 'Roads',
  title: 'Road Damage / Pothole',
  description: 'Road damage / pothole detected from the uploaded image.',
  priority: 'High',
  severity: 'High',
  department_code: 'PWD',
  department_id: 1,
  department_name: 'Public Works Department',
  latitude: 18.5350,
  longitude: 73.8700,
  location_source: 'map_pin',
  photo_url: '/uploads/060423ab-81c3-4f4a-a6ab-0449404db247.jpg',
  ai_model: 'civicmodel.pt',
  ai_confidence: 0.6435,
  ai_status: 'suggested',
  ai_detected_class: 'Pothole',
  ai_reason: 'Road damage / pothole detected with 64% confidence across 5 visible locations. Evaluated as High severity based on 11.0% visual impact.'
});

const req = http.request(
  {
    hostname: 'localhost',
    port: 5000,
    path: '/api/complaints/submit',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': 'Bearer demo-token-citizen'
    }
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', async () => {
      console.log('STATUS:', res.statusCode);
      const parsed = JSON.parse(data);
      console.log('COMPLAINT NUMBER:', parsed.complaint_number);
      const cId = parsed.complaint_id;

      // Verify AI metadata in database
      const dbCheck = await query('SELECT id, complaint_number, ai_model, ai_confidence, ai_status, ai_detected_class, ai_reason, department_id FROM complaints WHERE id = ?', [cId]);
      console.log('PERSISTED COMPLAINT ROW:', dbCheck.rows[0]);

      process.exit(0);
    });
  }
);

req.on('error', (e) => {
  console.error('ERROR:', e);
  process.exit(1);
});

req.write(payload);
req.end();
