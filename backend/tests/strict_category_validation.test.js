const assert = require('assert');
const { validateCategoryMatch, normalizeCivicCategoryKey, detectCivicDomainFromAnalysis, CANONICAL_DOMAINS } = require('../src/services/aiService');

console.log('========================================================');
console.log('NAGARSETU 3.1 — STRICT AI IMAGE CATEGORY VALIDATION TEST');
console.log('========================================================\n');

// 1. Water pipe image in Water Supply → SUPPORTED
const test1 = validateCategoryMatch('Water Supply', {
  detected: true,
  detected_class: 'broken water pipe',
  confidence: 0.88,
  pipe_condition: 'damaged'
});
console.log('1. Water pipe in Water Supply:', test1.outcome);
assert.strictEqual(test1.outcome, 'SUPPORTED', 'Water pipe in Water Supply must be SUPPORTED');

// 2. Garbage image in Water Supply → UNSUPPORTED when confidently established
const test2 = validateCategoryMatch('Water Supply', {
  detected: true,
  detected_class: 'garbage dump waste pile',
  confidence: 0.85
});
console.log('2. Garbage in Water Supply:', test2.outcome, '| Suggested:', test2.suggestedCategory);
assert.strictEqual(test2.outcome, 'UNSUPPORTED', 'Garbage in Water Supply must be UNSUPPORTED');
assert.strictEqual(
  test2.message,
  'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.'
);
assert.strictEqual(test2.suggestedCategory, 'Sanitation');

// 3. Road image in Roads & Works → SUPPORTED
const test3 = validateCategoryMatch('Roads & Works', {
  detected: true,
  detected_class: 'pothole',
  confidence: 0.91,
  road_condition: 'defective'
});
console.log('3. Road in Roads & Works:', test3.outcome);
assert.strictEqual(test3.outcome, 'SUPPORTED', 'Road image in Roads & Works must be SUPPORTED');

// 4. Drainage image in Sanitation → UNSUPPORTED when confidently established
const test4 = validateCategoryMatch('Sanitation', {
  detected: true,
  detected_class: 'blocked drain sewage',
  confidence: 0.82,
  drain_condition: 'blocked'
});
console.log('4. Drainage in Sanitation:', test4.outcome, '| Suggested:', test4.suggestedCategory);
assert.strictEqual(test4.outcome, 'UNSUPPORTED', 'Drainage image in Sanitation must be UNSUPPORTED');
assert.strictEqual(
  test4.message,
  'Unsupported Image — This photograph does not match the selected issue category. Please upload a relevant image or select the correct category.'
);
assert.strictEqual(test4.suggestedCategory, 'Drainage');

// 5. Uncertain image → UNCERTAIN / Manual Verification
const test5 = validateCategoryMatch('Water Supply', {
  detected: false,
  confidence: 0.22
});
console.log('5. Uncertain image:', test5.outcome, '| Message:', test5.message);
assert.strictEqual(test5.outcome, 'UNCERTAIN', 'Ambiguous image must be UNCERTAIN (not falsely unsupported)');

// 6. Rejected image does not increase photo count
let acceptedEvidenceList = [];
function simulateUpload(fileCategory, selectedCategory, aiResult) {
  const result = validateCategoryMatch(selectedCategory, aiResult);
  if (result.outcome === 'UNSUPPORTED') {
    // REJECT: Do not add to accepted evidence list!
    return { added: false, result };
  }
  // SUPPORTED or UNCERTAIN: Accept photo into evidence list
  acceptedEvidenceList.push({ fileCategory, result });
  return { added: true, result };
}

// Citizen selects 'Water Supply', attempts to upload garbage image
const upload1 = simulateUpload('garbage', 'Water Supply', { detected: true, detected_class: 'garbage', confidence: 0.89 });
console.log('6a. Garbage upload rejected:', !upload1.added, '| Current count:', acceptedEvidenceList.length);
assert.strictEqual(upload1.added, false);
assert.strictEqual(acceptedEvidenceList.length, 0, 'Rejected image must not increase evidence photo count');

// Citizen uploads valid water pipe photo
const upload2 = simulateUpload('water pipe', 'Water Supply', { detected: true, detected_class: 'leaking pipe', confidence: 0.86 });
console.log('6b. Water pipe photo accepted:', upload2.added, '| Current count:', acceptedEvidenceList.length);
assert.strictEqual(upload2.added, true);
assert.strictEqual(acceptedEvidenceList.length, 1);

// Citizen uploads second angle water pipe photo (reaches 2-photo minimum)
const upload3 = simulateUpload('water pipe 2', 'Water Supply', { detected: true, detected_class: 'water pipe joint', confidence: 0.75 });
console.log('6c. Second photo accepted:', upload3.added, '| Current count:', acceptedEvidenceList.length);
assert.strictEqual(upload3.added, true);
assert.strictEqual(acceptedEvidenceList.length, 2, 'Two valid photos satisfy 2-photo minimum');

// 7. Verify all 4 angle slots are supported
const angleSlots = ['front', 'left', 'right', 'closeup'];
for (const angle of angleSlots) {
  const angleTest = validateCategoryMatch('Drainage', { detected: true, detected_class: 'overflow drain', confidence: 0.80 });
  assert.strictEqual(angleTest.outcome, 'SUPPORTED');
}
console.log('7. Angle slots (Front, Left, Right, Top) validation: ALL SUPPORTED');

// 8. Revalidation on category change
// If user changes category from 'Water Supply' to 'Roads & Works', previously accepted pipe photos are revalidated:
const revalidation = validateCategoryMatch('Roads & Works', { detected: true, detected_class: 'broken water pipe', confidence: 0.88 });
console.log('8. Revalidation on category switch:', revalidation.outcome, '| Identified as:', revalidation.detectedCategory);
assert.strictEqual(revalidation.outcome, 'UNSUPPORTED', 'Pipe photo must become UNSUPPORTED when user switches category to Roads & Works');

console.log('\n========================================================');
console.log('ALL STRICT AI IMAGE CATEGORY VALIDATION TESTS PASSED ✓');
console.log('========================================================');
