import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, greetingKey } from '../../apps/web/src/lib/format.js';

test('formatClock pads minutes and seconds', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(28 * 60 + 14), '28:14');
  assert.equal(formatClock(61), '01:01');
});

test('greetingKey follows the time of day', () => {
  assert.equal(greetingKey(new Date(2026, 10, 2, 8)), 'greeting.morning');
  assert.equal(greetingKey(new Date(2026, 10, 2, 13)), 'greeting.afternoon');
  assert.equal(greetingKey(new Date(2026, 10, 2, 20)), 'greeting.evening');
});
