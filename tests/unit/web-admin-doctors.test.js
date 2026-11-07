// Unit tests: admin Doctors page helpers (suspension reason, who can be suspended, status shown, error mapping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adminDoctorErrorKey, canSuspend, displayStatus, validateSuspensionReason } from '../../apps/web/src/features/admin/doctorAdmin.js';

test('a suspension reason of 10–500 characters is required', () => {
  assert.equal(validateSuspensionReason(''), 'adminDoctors.errors.reasonShort');
  assert.equal(validateSuspensionReason('   too short  '), 'adminDoctors.errors.reasonShort');
  assert.equal(validateSuspensionReason('Licence under investigation.'), null);
  assert.equal(validateSuspensionReason('x'.repeat(501)), 'adminDoctors.errors.reasonLong');
});

test('only active doctors who are not the admin themself can be suspended; suspension wins in the badge', () => {
  assert.equal(canSuspend({ accountStatus: 'ACTIVE', userId: 'u1' }, 'admin'), true);
  assert.equal(canSuspend({ accountStatus: 'SUSPENDED', userId: 'u1' }, 'admin'), false);
  assert.equal(canSuspend({ accountStatus: 'ACTIVE', userId: 'admin' }, 'admin'), false);
  assert.equal(displayStatus({ accountStatus: 'SUSPENDED', verificationStatus: 'VERIFIED' }), 'SUSPENDED');
  assert.equal(displayStatus({ accountStatus: 'ACTIVE', verificationStatus: 'PENDING' }), 'PENDING');
});

test('API errors map to translated messages in both languages', () => {
  const en = JSON.parse(readFileSync(new URL('../../apps/web/src/locales/en.json', import.meta.url), 'utf8'));
  const so = JSON.parse(readFileSync(new URL('../../apps/web/src/locales/so.json', import.meta.url), 'utf8'));
  for (const code of ['DOCTOR_ALREADY_SUSPENDED', 'SELF_ACTION_FORBIDDEN', 'SOMETHING_ELSE']) {
    const key = adminDoctorErrorKey({ code }).split('.');
    assert.equal(typeof key.reduce((n, k) => n?.[k], en), 'string', code);
    assert.equal(typeof key.reduce((n, k) => n?.[k], so), 'string', code);
  }
  assert.equal(adminDoctorErrorKey({ code: 'SOMETHING_ELSE' }), 'adminDoctors.apiErrors.GENERIC');
});
