import assert from 'node:assert/strict';
import { test } from 'node:test';

// Unit 30a P2: a red PR must be blocked. Never merged.
test('30a P2: this test fails on purpose', () => {
  assert.equal(1, 2);
});
