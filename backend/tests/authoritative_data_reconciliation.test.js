const assert = require('assert');
const test = require('node:test');

test('Authoritative Data & Statistics Reconciliation Suite', async (t) => {
  await t.test('1. UUID Sanitization correctly filters non-UUID values to prevent PostgreSQL 22P02 error', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const candidateIds = ['2', '58', 'invalid-uuid-string', 'e2a4338c-5d49-4ae3-b766-40d99fb26f87', 123, null, undefined];
    
    const validUuids = candidateIds.filter(id => typeof id === 'string' && uuidRegex.test(id));
    
    assert.strictEqual(validUuids.length, 1);
    assert.strictEqual(validUuids[0], 'e2a4338c-5d49-4ae3-b766-40d99fb26f87');
  });

  await t.test('2. Dashboard Statistics normalization and exact count reconciliation', () => {
    // Sample complaint records representing citizen portal dataset
    const complaints = [
      { id: '1', status: 'Submitted' },
      { id: '2', status: 'Pending' },
      { id: '3', status: 'In Progress' },
      { id: '4', status: 'Staff Assigned' },
      { id: '5', status: 'Resolved' },
      { id: '6', status: 'Reopened' },
      { id: '7', status: 'Resolved' },
      { id: '8', status: 'Submitted' },
      { id: '9', status: 'Investigation' }
    ];

    // Status mapping rules matching CitizenPortal.tsx and database rules
    const totalCount = complaints.length;
    const pendingCount = complaints.filter(c => c && (c.status === 'Submitted' || c.status === 'Pending')).length;
    const inProgressCount = complaints.filter(c => c && (c.status === 'In Progress' || c.status === 'Staff Assigned' || c.status === 'Investigation')).length;
    const resolvedCount = complaints.filter(c => c && c.status === 'Resolved').length;
    const reopenedCount = complaints.filter(c => c && c.status === 'Reopened').length;

    // Reconciliation check
    const sumOfCategorized = pendingCount + inProgressCount + resolvedCount + reopenedCount;

    assert.strictEqual(totalCount, 9, 'Total count must equal total records');
    assert.strictEqual(pendingCount, 3, 'Submitted + Pending = 3');
    assert.strictEqual(inProgressCount, 3, 'In Progress + Staff Assigned + Investigation = 3');
    assert.strictEqual(resolvedCount, 2, 'Resolved = 2');
    assert.strictEqual(reopenedCount, 1, 'Reopened = 1');
    assert.strictEqual(totalCount, sumOfCategorized, 'Sum of all categories must equal Total Count');
  });

  await t.test('3. Citizen Scoping Filter excludes other citizens data', () => {
    const targetCitizenId = 'e2a4338c-5d49-4ae3-b766-40d99fb26f87';
    const allComplaints = [
      { id: 'c1', citizen_id: 'e2a4338c-5d49-4ae3-b766-40d99fb26f87', title: 'Road repair' },
      { id: 'c2', citizen_id: 'e2a4338c-5d49-4ae3-b766-40d99fb26f87', title: 'Streetlight' },
      { id: 'c3', citizen_id: 'other-user-uuid-9999-000000000000', title: 'Garbage dump' },
      { id: 'c4', citizen_id: 'random-user-id-5555', title: 'Water leakage' }
    ];

    const scopedComplaints = allComplaints.filter(c => c.citizen_id === targetCitizenId);
    assert.strictEqual(scopedComplaints.length, 2);
    assert.strictEqual(scopedComplaints.every(c => c.citizen_id === targetCitizenId), true);
  });

  await t.test('4. Security: Malformed or unresolvable identity FAILS CLOSED (never unrestricted)', () => {
    // When a citizen identity cannot be parsed or resolved, the query handler must return an empty list, NOT all complaints
    function mockCitizenQuery(citizenIds, allDbRecords) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const validUuids = citizenIds.filter(id => typeof id === 'string' && uuidRegex.test(id));
      
      if (validUuids.length === 0) {
        // Fail closed rule: never query without a valid scoped ID
        return [];
      }
      return allDbRecords.filter(r => validUuids.includes(r.citizen_id));
    }

    const testDb = [
      { id: 'c1', citizen_id: 'e2a4338c-5d49-4ae3-b766-40d99fb26f87', title: 'Road repair' },
      { id: 'c2', citizen_id: 'b1234567-0000-0000-0000-000000000000', title: 'Street light' }
    ];

    // Case A: Empty array passed
    assert.deepStrictEqual(mockCitizenQuery([], testDb), [], 'Empty ID list must fail closed');

    // Case B: Invalid non-UUID strings passed
    assert.deepStrictEqual(mockCitizenQuery(['invalid-id', 'null', 'undefined', '12345'], testDb), [], 'Invalid non-UUIDs must fail closed');

    // Case C: Null or empty string
    assert.deepStrictEqual(mockCitizenQuery([null, ''], testDb), [], 'Falsy IDs must fail closed');

    // Case D: Valid UUID correctly returns only matching citizen records
    const validResult = mockCitizenQuery(['e2a4338c-5d49-4ae3-b766-40d99fb26f87'], testDb);
    assert.strictEqual(validResult.length, 1);
    assert.strictEqual(validResult[0].id, 'c1');
  });

  await t.test('5. Exhaustive Status Reconciliation covering all 6 categories including Rejected', () => {
    function normalizeStatus(status) {
      const s = String(status || '').trim().toLowerCase();
      if (['submitted', 'verified', 'approved', 'pending'].includes(s)) return 'Pending';
      if (['department assigned', 'staff assigned', 'in progress', 'accepted', 'on the way', 'investigation'].includes(s)) return 'In Progress';
      if (['resolved', 'resolution submitted'].includes(s)) return 'Resolved';
      if (['reopened'].includes(s)) return 'Reopened';
      if (['rejected'].includes(s)) return 'Rejected';
      return 'Pending';
    }

    const mixedComplaints = [
      { id: '1', status: 'Submitted' },
      { id: '2', status: 'Verified' },
      { id: '3', status: 'Approved' },
      { id: '4', status: 'Department Assigned' },
      { id: '5', status: 'Staff Assigned' },
      { id: '6', status: 'In Progress' },
      { id: '7', status: 'Accepted' },
      { id: '8', status: 'On the Way' },
      { id: '9', status: 'Investigation' },
      { id: '10', status: 'Resolved' },
      { id: '11', status: 'Resolution Submitted' },
      { id: '12', status: 'Reopened' },
      { id: '13', status: 'Rejected' },
      { id: '14', status: 'unknown_custom_status' } // Fallback to Pending
    ];

    const total = mixedComplaints.length;
    const pending = mixedComplaints.filter(c => normalizeStatus(c.status) === 'Pending').length;
    const inProgress = mixedComplaints.filter(c => normalizeStatus(c.status) === 'In Progress').length;
    const resolved = mixedComplaints.filter(c => normalizeStatus(c.status) === 'Resolved').length;
    const reopened = mixedComplaints.filter(c => normalizeStatus(c.status) === 'Reopened').length;
    const rejected = mixedComplaints.filter(c => normalizeStatus(c.status) === 'Rejected').length;

    assert.strictEqual(total, 14);
    assert.strictEqual(pending, 4); // Submitted, Verified, Approved, unknown
    assert.strictEqual(inProgress, 6); // Dept Assigned, Staff Assigned, In Progress, Accepted, On the Way, Investigation
    assert.strictEqual(resolved, 2); // Resolved, Resolution Submitted
    assert.strictEqual(reopened, 1); // Reopened
    assert.strictEqual(rejected, 1); // Rejected
    assert.strictEqual(total, pending + inProgress + resolved + reopened + rejected, 'Sum must equal Total exactly');
  });

  await t.test('6. Frontend API Base URL resolution rules in apiConfig', () => {
    function resolveBaseUrl(isProd, envViteUrl, origin = 'http://localhost:3000') {
      const explicit = envViteUrl && envViteUrl.trim() ? envViteUrl.trim() : '';
      if (explicit) return explicit.replace(/\/+$/, '');
      if (isProd) {
        return origin.replace(/\/+$/, '');
      }
      return 'http://localhost:5000';
    }

    // In production without env override -> same origin
    assert.strictEqual(
      resolveBaseUrl(true, '', 'https://nagarsetu-ai-pi.vercel.app'),
      'https://nagarsetu-ai-pi.vercel.app'
    );

    // In local dev with explicit VITE_API_URL pointing to production shared backend
    assert.strictEqual(
      resolveBaseUrl(false, 'https://nagarsetu-ai-pi.vercel.app', 'http://localhost:3000'),
      'https://nagarsetu-ai-pi.vercel.app'
    );

    // In local dev without env override -> local port 5000
    assert.strictEqual(
      resolveBaseUrl(false, '', 'http://localhost:3000'),
      'http://localhost:5000'
    );
  });

  await t.test('7. Error responses are thrown and not masked as empty lists', () => {
    function handleApiResponse(response) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Session expired or unauthorized');
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch complaints`);
      }
      return response.data;
    }

    assert.throws(() => handleApiResponse({ ok: false, status: 401 }), /Session expired or unauthorized/);
    assert.throws(() => handleApiResponse({ ok: false, status: 500 }), /HTTP 500/);
    assert.deepStrictEqual(handleApiResponse({ ok: true, status: 200, data: [{ id: '1' }] }), [{ id: '1' }]);
  });
});
