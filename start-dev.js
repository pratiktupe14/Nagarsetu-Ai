const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

console.log('=======================================================');
console.log('  Starting NAGARSETU 3.1 (AI, Backend & Frontend Dev)  ');
console.log('=======================================================');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function getPythonExecutable() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  const candidates = isWin ? [
    path.join(__dirname, 'ai_service', 'venv', 'Scripts', 'python.exe'),
    path.join(__dirname, 'ai_service', '.venv', 'Scripts', 'python.exe'),
    path.join(__dirname, 'venv', 'Scripts', 'python.exe'),
    path.join(__dirname, '.venv', 'Scripts', 'python.exe')
  ] : [
    path.join(__dirname, 'ai_service', 'venv', 'bin', 'python'),
    path.join(__dirname, 'ai_service', '.venv', 'bin', 'python'),
    path.join(__dirname, 'venv', 'bin', 'python'),
    path.join(__dirname, '.venv', 'bin', 'python')
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return isWin ? 'python' : 'python3';
}

function checkAiHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  const aiPort = process.env.AI_PORT || 8000;
  let aiProcess = null;

  const alreadyHealthy = await checkAiHealth(aiPort);
  if (alreadyHealthy) {
    console.log(`[AI Service] Already running and healthy at port ${aiPort}. Reusing instance.`);
  } else {
    const pythonCmd = getPythonExecutable();
    console.log(`[AI Service] Starting Python FastAPI on port ${aiPort} using ${pythonCmd}...`);
    aiProcess = spawn(pythonCmd, ['main.py'], {
      cwd: path.join(__dirname, 'ai_service'),
      env: { ...process.env, PORT: String(aiPort) },
      stdio: 'inherit',
      shell: isWin
    });

    aiProcess.on('error', (err) => {
      console.error(`[AI Service] Failed to start:`, err.message);
    });
  }

  // 1. Start Express Backend API on Port 5000
  const backend = spawn(npmCmd, ['start'], {
    cwd: path.join(__dirname, 'backend'),
    stdio: 'inherit',
    shell: true
  });

  // 2. Start Vite Frontend Server on Port 3000
  const frontend = spawn(npmCmd, ['run', 'dev'], {
    cwd: path.join(__dirname, 'frontend'),
    stdio: 'inherit',
    shell: true
  });

  const cleanup = () => {
    if (aiProcess && !aiProcess.killed) {
      try {
        if (isWin) {
          spawn('taskkill', ['/pid', String(aiProcess.pid), '/f', '/t']);
        } else {
          aiProcess.kill('SIGTERM');
        }
      } catch (e) {}
    }
    if (backend && !backend.killed) {
      try {
        if (isWin) {
          spawn('taskkill', ['/pid', String(backend.pid), '/f', '/t']);
        } else {
          backend.kill('SIGTERM');
        }
      } catch (e) {}
    }
    if (frontend && !frontend.killed) {
      try {
        if (isWin) {
          spawn('taskkill', ['/pid', String(frontend.pid), '/f', '/t']);
        } else {
          frontend.kill('SIGTERM');
        }
      } catch (e) {}
    }
    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
})();
