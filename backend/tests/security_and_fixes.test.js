const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('NAGARSETU Security & Reliability Audit Verification', () => {

  test('1. Authentication Backdoor Elimination', () => {
    const authRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/auth.routes.js'), 'utf8');
    
    // Verify that dynamic account insertion in login route is gone
    assert.strictEqual(
      authRouteFile.includes("INSERT INTO users (name, mobile, email, password_hash, role, department_id, employee_id, status) VALUES (?, ?, ?, ?, 'department_head'"),
      false,
      'Department Head auto-registration backdoor must not exist in login route'
    );
  });

  test('2. Hardcoded Supabase Secrets Removal', () => {
    const storageFile = fs.readFileSync(path.join(__dirname, '../src/config/supabaseStorage.js'), 'utf8');
    
    // Verify hardcoded JWT tokens are removed
    assert.strictEqual(
      storageFile.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
      false,
      'Hardcoded Supabase Anon JWT token must be removed from supabaseStorage.js'
    );
    assert.strictEqual(
      storageFile.includes('https://ozeiymkbxtrqqdoxtmhm.supabase.co'),
      false,
      'Hardcoded Supabase URL fallback must be removed'
    );
  });

  test('3. JWT Secret Production Enforceability', () => {
    const authMiddlewareFile = fs.readFileSync(path.join(__dirname, '../src/middleware/auth.js'), 'utf8');
    
    assert.strictEqual(
      authMiddlewareFile.includes('[SECURITY FATAL] JWT_SECRET environment variable is missing in production.'),
      true,
      'JWT_SECRET must throw fatal security error in production mode if missing'
    );
  });

  test('4. OTP Universal Bypass Gated in Production', () => {
    const authRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/auth.routes.js'), 'utf8');
    
    // In production, demoOtp must not be unconditionally returned, and simulated OTP must not be accepted
    assert.strictEqual(
      authRouteFile.includes('Live SMS OTP gateway is not configured for production'),
      true,
      'Simulated OTP must be gated behind non-production environment'
    );
  });

  test('5. Complaints Route Protected with Authentication & IDOR Guard', () => {
    const complaintRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/complaint.routes.js'), 'utf8');
    
    assert.strictEqual(
      complaintRouteFile.includes("router.get('/', authenticateToken"),
      true,
      'GET /api/complaints must require authenticateToken'
    );

    assert.strictEqual(
      complaintRouteFile.includes('delete complaint.citizen_mobile'),
      true,
      'GET /api/complaints/:id must protect citizen mobile PII from unauthorized citizens'
    );
  });

  test('6. Staff Tasks SQL Query Parameter Alignment', () => {
    const staffRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/staff.routes.js'), 'utf8');
    
    assert.strictEqual(
      staffRouteFile.includes('(c.department_id = $4 OR d.id = $4)'),
      true,
      'Staff query must bind department_id to parameter $4'
    );
    assert.strictEqual(
      staffRouteFile.includes('(c.department_id = $3 OR d.id = $3)'),
      false,
      'Staff query must not compare integer department_id with text staff name ($3)'
    );
  });

  test('7. Demo bearer token rejected in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test_production_secret_32_chars_long!!';
    try {
      // Clear require cache to ensure clean re-initialization
      delete require.cache[require.resolve('../src/middleware/auth')];
      const { authenticateToken } = require('../src/middleware/auth');
      const req = {
        headers: { authorization: 'Bearer demo-token-city-admin' }
      };
      let statusCode = 0;
      let nextCalled = false;
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        }
      };
      const next = () => {
        nextCalled = true;
      };

      await authenticateToken(req, res, next);
      assert.strictEqual(nextCalled, false, 'next() should not be called for demo token in production');
      assert.strictEqual(statusCode === 401 || statusCode === 403, true, `Status should be 401 or 403, got ${statusCode}`);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.JWT_SECRET = originalSecret;
      delete require.cache[require.resolve('../src/middleware/auth')];
    }
  });

  test('8. Demo token endpoint returns 404 in production', () => {
    const authRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/auth.routes.js'), 'utf8');
    assert.strictEqual(
      authRouteFile.includes('if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test")'),
      true,
      'demo-token endpoint must check environment and block production'
    );
    assert.strictEqual(
      authRouteFile.includes('return res.status(404).json({ error: "Not found" })'),
      true,
      'demo-token endpoint must return 404 in production'
    );
  });

  test('9. Public registration enforces citizen role and rejects privilege escalation', () => {
    const authRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/auth.routes.js'), 'utf8');
    assert.strictEqual(
      authRouteFile.includes("const role = 'citizen';"),
      true,
      'Public registration must strictly force citizen role'
    );
  });

  test('10. Optional auth leaves req.user null for anonymous or invalid tokens', async () => {
    const { optionalAuthenticateToken } = require('../src/middleware/auth');
    
    // Case A: No token
    let reqA = { headers: {} };
    let nextA = false;
    await optionalAuthenticateToken(reqA, {}, () => { nextA = true; });
    assert.strictEqual(nextA, true);
    assert.strictEqual(reqA.user, null, 'req.user must be null when no token provided');

    // Case B: Invalid/malformed token
    let reqB = { headers: { authorization: 'Bearer invalid-junk-token' } };
    let nextB = false;
    await optionalAuthenticateToken(reqB, {}, () => { nextB = true; });
    assert.strictEqual(nextB, true);
    assert.strictEqual(reqB.user, null, 'req.user must not become a demo citizen for invalid token');
  });

  test('11. Complaint lookup returns 404 and has no latest-complaint fallback', () => {
    const complaintRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/complaint.routes.js'), 'utf8');
    assert.strictEqual(
      complaintRouteFile.includes("return res.status(404).json({ error: 'Complaint not found' });"),
      true,
      'Complaint route must return 404 when complaint is not found'
    );
    assert.strictEqual(
      complaintRouteFile.includes('ORDER BY created_at DESC LIMIT 1'),
      false,
      'Complaint lookup must not fall back to latest complaint'
    );
  });

  test('12. Rate Limiter does NOT bypass sensitive auth endpoints with dummy Authorization header (ERROR-006)', () => {
    const rateLimiterFile = fs.readFileSync(path.join(__dirname, '../src/middleware/rateLimiter.js'), 'utf8');
    assert.strictEqual(
      rateLimiterFile.includes("req.headers && req.headers['authorization']"),
      false,
      'Auth rate limiter must never skip limiting based on arbitrary Authorization header presence'
    );
    assert.strictEqual(
      rateLimiterFile.includes("req.path === '/profile' || req.path === '/me'"),
      true,
      'Only read-only profile/me paths may be exempt from login rate limits'
    );
  });

  test('13. OTP Verification Lifecycle: Dynamic OTP, Rejection of Bad OTP, Lockout (ERROR-005)', () => {
    const authRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/auth.routes.js'), 'utf8');
    // Ensure hardcoded 123456 bypass is eliminated
    assert.strictEqual(
      authRouteFile.includes("otp === '123456'"),
      false,
      'Hardcoded 123456 OTP bypass must not exist in auth route'
    );
    assert.strictEqual(
      authRouteFile.includes("crypto.randomInt(100000, 1000000)"),
      true,
      'Dynamic cryptographically secure random OTP generation must be used'
    );
    assert.strictEqual(
      authRouteFile.includes("attempts >= 3"),
      true,
      'Three failed OTP attempts must result in lockout'
    );
  });

  test('14. Department Head Synchronization Prevents Unsafe Demotion (ERROR-004)', () => {
    const cleanSyncFile = fs.readFileSync(path.join(__dirname, '../src/scripts/cleanAndSyncDepartmentHeads.js'), 'utf8');
    assert.strictEqual(
      cleanSyncFile.includes("SET role = 'citizen'"),
      false,
      'cleanAndSyncDepartmentHeads must never demote active department heads to citizen'
    );
    // Preserves existing credentials by not overwriting password_hash on UPDATE
    assert.strictEqual(
      cleanSyncFile.includes("UPDATE users SET name = ?, mobile = ?, email = ?, role = 'department_head', department_id = ?, employee_id = ?, status = 'active' WHERE id = ?"),
      true,
      'cleanAndSyncDepartmentHeads must preserve existing user password hashes'
    );
  });

  test('15. Staff Cross-Department Resolution Rejection with 403 Forbidden (ERROR-008)', () => {
    const staffRouteFile = fs.readFileSync(path.join(__dirname, '../src/routes/staff.routes.js'), 'utf8');
    assert.strictEqual(
      staffRouteFile.includes("Forbidden: You cannot resolve complaints belonging to another department"),
      true,
      'Staff must be strictly rejected with 403 when attempting to resolve another department complaint'
    );
    assert.strictEqual(
      staffRouteFile.includes("task 1118"),
      false,
      'Temporary test task injection 1118 must be removed'
    );
  });

});


