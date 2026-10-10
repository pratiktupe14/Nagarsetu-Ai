const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const dir = 'D:\\NAGARSETU\\drainage images';

const samples = {
  normal: 'images (10).jpg',
  blocked: 'images (1).jpg',
  damaged1: 'damaged-concrete-drain-cover-broken-260nw-2718087129.webp',
  damaged2: 'an-old-broken-storm-grate-in-the-middle-of-cracked-asphalt-3BC5NPC.jpg',
  overflow: '56694397.avif'
};

async function testOne(name, filename, filePathOverride) {
  const filePath = filePathOverride || path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    console.log(name, 'FILE NOT FOUND:', filePath);
    return;
  }
  const form = new FormData();
  form.append('image', fs.readFileSync(filePath), path.basename(filePath));
  form.append('domain', 'drainage');

  const res = await fetch('http://127.0.0.1:5000/api/ai/analyze', {
    method: 'POST',
    body: form.getBuffer(),
    headers: { ...form.getHeaders(), 'Authorization': 'Bearer demo-token-citizen' }
  });
  const data = await res.json();
  console.log(`[${name.toUpperCase()}] (${path.basename(filePath)}) -> HTTP ${res.status}`);
  console.log('   detected:', data.detected);
  console.log('   ai_status:', data.ai_status);
  console.log('   category:', data.category);
  console.log('   department:', data.department_code);
  console.log('   title:', data.title);
  console.log('   confidence:', data.confidence);
  console.log('   severity:', data.severity);
}

async function run() {
  for (const [k, v] of Object.entries(samples)) {
    await testOne(k, v);
  }
  // Also test an unrelated image (clean asphalt road)
  const cleanRoad = 'D:\\NAGARSETU\\normal pipe images\\10-inch-pvc-pipe.jpg';
  if (fs.existsSync(cleanRoad)) {
    await testOne('unrelated_pipe', null, cleanRoad);
  }
}
run();
