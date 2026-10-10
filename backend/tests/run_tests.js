const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Ensure a single unified test database across all processes
const sharedTestDbPath = process.env.TEST_DB_PATH || path.join(os.tmpdir(), `nagarsetu-ci-test-${Date.now()}.sqlite`);
process.env.TEST_DB_PATH = sharedTestDbPath;
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';

const app = require('../src/app');
const { initDatabase } = require('../src/config/db');
const { seedDefaultUsers, seed7DemoDepartmentHeads } = require('../src/server');
const seedServiceStaff = require('../src/scripts/seedServiceStaff');

async function main() {
  console.log('[CI TEST RUNNER] Preparing test environment with shared database:', sharedTestDbPath);

  // 1. Initialize SQLite Database & Seed Core Roles
  await initDatabase();
  await seedDefaultUsers();
  await seed7DemoDepartmentHeads();
  await seedServiceStaff();

  // 2. Ensure test fixture upload images exist for tests expecting uploads
  const uploadsDir = path.resolve(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const cleanFixture = path.resolve(__dirname, 'fixtures/clean.jpg');
  if (fs.existsSync(cleanFixture)) {
    const requiredUploads = [
      '060423ab-81c3-4f4a-a6ab-0449404db247.jpg',
      '0ed0346b-10e8-4009-9928-80fce15a9749.jpg',
      'test-pothole.jpg',
      'civic-default.jpg'
    ];
    for (const name of requiredUploads) {
      const target = path.join(uploadsDir, name);
      if (!fs.existsSync(target)) {
        try { fs.copyFileSync(cleanFixture, target); } catch {}
      }
    }
  }

  // 3. Start Backend Express API on port 5000 if not already running
  let backendServer = null;
  let backendRunning = false;
  try {
    const res = await fetch('http://127.0.0.1:5000/api/health', { signal: AbortSignal.timeout(400) });
    if (res.ok) backendRunning = true;
  } catch {}

  if (!backendRunning) {
    backendServer = app.listen(5000, '0.0.0.0');
    await new Promise((resolve) => backendServer.once('listening', resolve));
    console.log('[CI TEST RUNNER] In-process Backend API listening on port 5000.');
  } else {
    console.log('[CI TEST RUNNER] External Backend API already active on port 5000.');
  }

  // 4. Start Mock Python AI microservice on port 8000 if not already running
  let mockAiServer = null;
  let aiRunning = false;
  try {
    const res = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(400) });
    if (res.ok) aiRunning = true;
  } catch {}

  if (!aiRunning) {
    mockAiServer = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'ok',
          reachable: true,
          ready: true,
          models: { civicmodel: true, wasteModel: true, waterPipeModel: true, drainageModel: true }
        }));
      }

      if (req.url === '/analyze') {
        let chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString();
          res.writeHead(200, { 'Content-Type': 'application/json' });

          if (bodyStr.includes('blurry.jpg')) {
            return res.end(JSON.stringify({
              success: true,
              detected: false,
              confidence: 0.25,
              reviewRequired: true,
              ai_status: 'manual_review',
              road_condition: 'uncertain',
              department_code: null,
              departmentCode: null
            }));
          }

          if (bodyStr.includes('grass') || bodyStr.includes('non_road')) {
            return res.end(JSON.stringify({
              success: true,
              detected: false,
              confidence: 0.2,
              reviewRequired: true,
              ai_status: 'manual_review',
              road_condition: 'non_road',
              department_code: null,
              departmentCode: null,
              explanation: { reason: 'Image does not contain a recognizable road surface.' }
            }));
          }

          if (bodyStr.includes('normal_drain.jpg') || (bodyStr.includes('drainage') && bodyStr.includes('normal'))) {
            return res.end(JSON.stringify({
              success: true,
              condition: 'normal',
              drain_condition: 'normal',
              detected: false,
              confidence: 0.95,
              ai_status: 'confirmed_normal',
              model: 'drainage_model.pt',
              reviewRequired: false,
              department_code: null,
              departmentCode: null,
              complaint: null,
              explanation: { reason: 'Normal, functional drainage.' }
            }));
          }

          if (bodyStr.includes('drainage') || bodyStr.includes('drain') || bodyStr.includes('blocked_drain') || bodyStr.includes('damaged_drain') || bodyStr.includes('overflow')) {
            const isDamaged = bodyStr.includes('damaged') || bodyStr.includes('slab') || bodyStr.includes('broken');
            return res.end(JSON.stringify({
              success: true,
              detected: true,
              confidence: 0.88,
              category: 'Drainage',
              model: 'drainage_model.pt',
              ai_status: 'confirmed',
              drain_condition: isDamaged ? 'damaged' : 'blocked',
              complaint: {
                category: 'Drainage',
                issueType: isDamaged ? 'Damaged Drain / Broken Slab' : 'Blocked Drain',
                departmentName: 'Drainage & Sewage Department',
                departmentCode: 'DRN',
                severity: 'High',
                priority: 'High',
                confidenceScore: 0.88
              },
              primaryDetection: { class: isDamaged ? 'damaged_drain' : 'blocked_drain' },
              detections: [{ class: isDamaged ? 'damaged_drain' : 'blocked_drain' }]
            }));
          }

          if (bodyStr.includes('normal pipe') || bodyStr.includes('perfect') || bodyStr.includes('Screenshot') || (bodyStr.includes('pipe') && bodyStr.includes('normal'))) {
            return res.end(JSON.stringify({
              success: true,
              condition: 'normal',
              pipe_condition: 'normal',
              detected: false,
              confidence: 0.95,
              ai_status: 'confirmed_normal',
              model: 'water_pipe_model.pt',
              reviewRequired: false,
              department_code: null,
              departmentCode: null,
              complaint: null,
              explanation: { reason: 'Normal pipe with no visible leak.' }
            }));
          }

          if (bodyStr.includes('pipe') || bodyStr.includes('water') || bodyStr.includes('leak') || bodyStr.includes('burst')) {
            const isLeak = bodyStr.includes('industrial-hose') || bodyStr.includes('images (20)') || bodyStr.includes('images (3)');
            const isBurst = !isLeak && (bodyStr.includes('burst') || bodyStr.includes('broken') || bodyStr.includes('114662673') || bodyStr.includes('images (6)') || bodyStr.includes('12.32.25'));
            return res.end(JSON.stringify({
              success: true,
              detected: true,
              confidence: 0.91,
              category: 'Water Supply',
              model: 'water_pipe_model.pt',
              ai_status: 'confirmed',
              pipe_condition: 'damaged',
              complaint: {
                category: 'Water Supply',
                issueType: isBurst ? 'Broken Water Pipe' : 'Water Leakage',
                departmentName: 'Water Supply & Sewerage Board',
                departmentCode: 'WTR',
                severity: 'High',
                priority: 'High',
                confidenceScore: 0.91
              },
              primaryDetection: { class: isBurst ? 'broken_pipe' : 'water_leakage' },
              detections: [{ class: isBurst ? 'broken_pipe' : 'water_leakage' }]
            }));
          }

          if (bodyStr.includes('clean.jpg') || bodyStr.includes('repaired_patch') || bodyStr.includes('shadow') || bodyStr.includes('lane_markings') || (bodyStr.includes('road') && bodyStr.includes('clean'))) {
            return res.end(JSON.stringify({
              success: true,
              road_condition: 'clean',
              detected: false,
              confidence: 0.92,
              ai_status: 'confirmed_clean',
              model: 'civicmodel.pt',
              reviewRequired: false,
              department_code: null,
              departmentCode: null,
              complaint: null,
              explanation: { reason: 'Clean road surface.' }
            }));
          }

          if (bodyStr.includes('waste') || bodyStr.includes('garbage') || bodyStr.includes('sanitat') || bodyStr.includes('cardboard')) {
            return res.end(JSON.stringify({
              success: true,
              detected: true,
              confidence: 0.88,
              category: 'Sanitation',
              model: 'waste_model.pt',
              ai_status: 'confirmed',
              complaint: {
                category: 'Sanitation',
                issueType: 'Garbage Dump',
                departmentName: 'Sanitation & Waste Management',
                departmentCode: 'SAN',
                severity: 'Medium',
                priority: 'Medium',
                confidenceScore: 0.88
              },
              primaryDetection: { class: 'garbage' },
              detections: [{ class: 'garbage' }]
            }));
          }

          // Default fallback detection (Pothole / Road defect)
          return res.end(JSON.stringify({
            success: true,
            detected: true,
            confidence: 0.89,
            category: 'Roads',
            model: 'civicmodel.pt',
            ai_status: 'confirmed',
            road_condition: 'defective',
            complaint: {
              category: 'Roads',
              issueType: 'Pothole',
              departmentName: 'Public Works Department',
              departmentCode: 'PWD',
              severity: 'High',
              priority: 'High',
              confidenceScore: 0.89
            },
            primaryDetection: { class: 'Pothole' },
            detections: [{ class: 'Pothole' }]
          }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => mockAiServer.listen(8000, '0.0.0.0', resolve));
    console.log('[CI TEST RUNNER] Mock Python AI microservice listening on port 8000.');
  }

  // 5. Execute Node native test runner
  console.log('[CI TEST RUNNER] Starting backend tests...');
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1'], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_TYPE: 'sqlite',
      TEST_DB_PATH: sharedTestDbPath,
      TEST_BASE_URL: 'http://127.0.0.1:5000',
      PYTHON_AI_URL: 'http://127.0.0.1:8000/analyze'
    }
  });

  child.on('exit', (code) => {
    console.log(`[CI TEST RUNNER] Test execution completed with exit code ${code || 0}.`);
    if (backendServer) backendServer.close();
    if (mockAiServer) mockAiServer.close();
    try {
      if (fs.existsSync(sharedTestDbPath)) fs.unlinkSync(sharedTestDbPath);
    } catch {}
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error('[CI TEST RUNNER FATAL]', err);
  process.exit(1);
});
