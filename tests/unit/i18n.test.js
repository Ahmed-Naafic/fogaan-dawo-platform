import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditTranslations } from '../../scripts/check-i18n.mjs';

test('English and Somali dictionaries have identical keys', () => {
  const r = auditTranslations();
  assert.deepEqual(r.missingInSo, []);
  assert.deepEqual(r.extraInSo, []);
  assert.equal(r.enCount, r.soCount);
});

test('every static translation key used in the web app is defined', () => {
  assert.deepEqual(auditTranslations().undefinedKeys, []);
});
